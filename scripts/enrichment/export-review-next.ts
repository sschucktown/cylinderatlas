import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAdminClient, readFlag, readPositiveIntFlag } from './admin-client'

type EvidenceType =
  | 'regulatory'
  | 'first_party'
  | 'business_registry'
  | 'directory'
  | 'provider_claim'
  | 'other'

interface FacilityRow {
  id: string
  rin: string
  phmsa_name: string
  phmsa_address: string
  city: string
  state: string
  postal_code: string | null
  candidate_type_hint: string | null
  enrichment_run_id: string | null
}

interface EnrichmentRow {
  facility_id: string
  run_id: string
  identity_match: string
  business_status: string
  serves_external_customers: string
  identity_confidence: number
  service_confidence: number
  service_keys: string[]
  current_name: string | null
  current_address: string | null
  evidence_summary: string | null
  raw_result: Record<string, unknown> | null
}

const bucket = readFlag('bucket') ?? 'missing_identity_corroboration_only'
const limit = readPositiveIntFlag('limit', 10)
const outputPath =
  readFlag('output') ?? 'tmp/review-' + bucket + '-next.json'

if (bucket !== 'missing_identity_corroboration_only') {
  throw new Error(
    'Only missing_identity_corroboration_only is supported by the first review-resolution slice',
  )
}

const supabase = createAdminClient()

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\bSUITE\b/g, 'STE')
    .replace(/[^A-Z0-9]/g, '')
}

function facilityKey(facility: FacilityRow) {
  return [
    normalize(facility.phmsa_name),
    normalize(facility.phmsa_address),
    normalize(facility.city),
    normalize(facility.state),
  ].join('|')
}

function rawString(
  raw: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = raw?.[key]
  return typeof value === 'string' ? value : null
}

function rawBoolean(
  raw: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  const value = raw?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function rawStringArray(
  raw: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  const value = raw?.[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

function hasTransitionOrStructuralHold(row: EnrichmentRow) {
  const text = row.evidence_summary ?? ''
  return (
    /\b(acquir|formerly|merger|merged|rename|renamed|d\/?b\/?a|doing business as|moved|relocat|rin transfer|transferred? with the business)\b/i.test(
      text,
    ) ||
    /manual audit hold|multiple phmsa rins|multi-rin/i.test(text)
  )
}

async function fetchFacilities(
  statuses: Array<'publish' | 'review'>,
): Promise<FacilityRow[]> {
  const rows: FacilityRow[] = []
  const pageSize = 500

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('facilities')
      .select(
        'id, rin, phmsa_name, phmsa_address, city, state, postal_code, candidate_type_hint, enrichment_run_id',
      )
      .in('publish_status', statuses)
      .order('state')
      .order('city')
      .order('rin')
      .range(from, from + pageSize - 1)

    if (error) throw error
    const page = (data ?? []) as FacilityRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }

  return rows
}

async function fetchCurrentResults(facilities: FacilityRow[]) {
  const byFacility = new Map<string, EnrichmentRow>()

  for (const group of chunks(facilities, 100)) {
    const ids = group.map((facility) => facility.id)
    const { data, error } = await supabase
      .from('facility_enrichment_results')
      .select(
        'facility_id, run_id, identity_match, business_status, serves_external_customers, identity_confidence, service_confidence, service_keys, current_name, current_address, evidence_summary, raw_result',
      )
      .in('facility_id', ids)

    if (error) throw error

    const runByFacility = new Map(
      group.map((facility) => [facility.id, facility.enrichment_run_id]),
    )

    for (const row of (data ?? []) as EnrichmentRow[]) {
      if (runByFacility.get(row.facility_id) === row.run_id) {
        byFacility.set(row.facility_id, row)
      }
    }
  }

  return byFacility
}

const allVisibleFacilities = await fetchFacilities(['publish', 'review'])

const reviewIds = new Set<string>()
{
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('facilities')
      .select('id')
      .eq('pipeline_status', 'manual_review')
      .range(from, from + pageSize - 1)

    if (error) throw error
    const page = data ?? []
    for (const row of page) reviewIds.add(row.id)
    if (page.length < pageSize) break
  }
}

const actualReviewFacilities = allVisibleFacilities.filter((facility) =>
  reviewIds.has(facility.id),
)
const currentResults = await fetchCurrentResults(actualReviewFacilities)

const facilityCounts = allVisibleFacilities.reduce<Map<string, number>>(
  (counts, facility) => {
    const key = facilityKey(facility)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return counts
  },
  new Map(),
)

const candidates = actualReviewFacilities
  .map((facility) => ({
    facility,
    result: currentResults.get(facility.id),
  }))
  .filter(
    (
      row,
    ): row is {
      facility: FacilityRow
      result: EnrichmentRow
    } => Boolean(row.result),
  )
  .filter(({ facility, result }) => {
    const identityCorroborated =
      result.raw_result?.identity_corroborated === true

    return (
      result.identity_match === 'matched' &&
      Number(result.identity_confidence) >= 0.85 &&
      !identityCorroborated &&
      result.business_status === 'active' &&
      result.serves_external_customers === 'yes' &&
      Number(result.service_confidence) >= 0.85 &&
      (result.service_keys ?? []).length > 0 &&
      (facilityCounts.get(facilityKey(facility)) ?? 0) === 1 &&
      !hasTransitionOrStructuralHold(result)
    )
  })
  .sort(
    (a, b) =>
      Math.min(
        Number(b.result.identity_confidence),
        Number(b.result.service_confidence),
      ) -
        Math.min(
          Number(a.result.identity_confidence),
          Number(a.result.service_confidence),
        ) ||
      a.facility.state.localeCompare(b.facility.state) ||
      a.facility.rin.localeCompare(b.facility.rin),
  )
  .slice(0, limit)

if (!candidates.length) {
  throw new Error('No review-resolution candidates found for bucket ' + bucket)
}

const runIds = [
  ...new Set(
    candidates
      .map(({ facility }) => facility.enrichment_run_id)
      .filter((value): value is string => Boolean(value)),
  ),
]

if (runIds.length !== 1) {
  throw new Error(
    'Expected one enrichment run for selected review records, found ' +
      runIds.length,
  )
}

const { data: run, error: runError } = await supabase
  .from('enrichment_runs')
  .select('id, name')
  .eq('id', runIds[0])
  .maybeSingle()

if (runError) throw runError
if (!run) throw new Error('Enrichment run not found: ' + runIds[0])

const records = candidates.map(({ facility, result }) => {
  const raw = result.raw_result

  return {
    rin: facility.rin,
    identityMatch: result.identity_match,
    businessStatus: result.business_status,
    servesExternalCustomers: result.serves_external_customers,
    currentName: result.current_name,
    currentAddress: result.current_address,
    serviceKeys: result.service_keys ?? [],
    serviceConfidence: Number(result.service_confidence),
    identityConfidence: Number(result.identity_confidence),
    evidenceUrl: rawString(raw, 'evidence_url'),
    evidenceType: rawString(raw, 'evidence_type') as EvidenceType | null,
    evidenceSupportsServiceKeys:
      rawStringArray(raw, 'evidence_supports_service_keys') ?? [],
    evidenceSupportsExternalCustomers:
      rawBoolean(raw, 'evidence_supports_external_customers') ?? false,
    corroborationEvidenceUrl: rawString(raw, 'corroboration_evidence_url'),
    corroborationEvidenceType: rawString(
      raw,
      'corroboration_evidence_type',
    ) as EvidenceType | null,
    corroborationSupports:
      rawStringArray(raw, 'corroboration_supports') ?? [],
    corroborationSummary: null,
    summary: result.evidence_summary ?? '',
  }
})

const payload = {
  runName: run.name,
  batch:
    'review-' +
    bucket +
    '-' +
    new Date().toISOString().replace(/[:.]/g, '-'),
  complete: true,
  evidenceSemanticsVersion: 2,
  reviewResolution: true,
  sourceBucket: bucket,
  openAiApiCalls: 0,
  records,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n')

console.log(
  JSON.stringify(
    {
      run: run.name,
      bucket,
      output: outputPath,
      selected: records.length,
      openAiApiCalls: 0,
      rins: records.map((record) => record.rin),
    },
    null,
    2,
  ),
)
