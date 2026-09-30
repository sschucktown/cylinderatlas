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

const supportedBuckets = new Set([
  'missing_identity_corroboration_only',
  'missing_service_evidence_only',
])

if (!supportedBuckets.has(bucket)) {
  throw new Error(
    'Supported review-resolution buckets: missing_identity_corroboration_only, missing_service_evidence_only',
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

const AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES = new Set<EvidenceType>([
  'first_party',
  'regulatory',
  'provider_claim',
])

function evidenceSupportedServiceKeys(row: EnrichmentRow) {
  const raw = row.raw_result
  const evidenceType = (
    rawString(raw, 'service_evidence_type') ??
    rawString(raw, 'evidence_type')
  ) as EvidenceType | null
  if (
    !evidenceType ||
    !AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES.has(evidenceType)
  ) {
    return []
  }

  const supported =
    rawStringArray(raw, 'service_evidence_supports_keys') ??
    rawStringArray(raw, 'evidence_supports_service_keys') ??
    []
  const summary = row.evidence_summary ?? ''

  return (row.service_keys ?? [])
    .filter((key) => supported.includes(key))
    .filter((key) => {
      if (key === 'medical-oxygen') {
        const explicitlyUnsupported =
          /medical[-\\s]?oxygen.{0,100}(?:not sufficiently supported|not explicitly established|not established|does not establish|insufficient)/i.test(
            summary,
          ) ||
          /(?:not sufficiently supported|not explicitly established|not established|does not establish|insufficient).{0,100}medical[-\\s]?oxygen/i.test(
            summary,
          )
        if (explicitlyUnsupported) return false

        return /\\bmedical(?:[-\\s]+grade)?[-\\s]+(?:oxygen|gas(?:es)?)\\b|\\bhealthcare\\b|\\bhospital\\b|\\bpatient\\b/i.test(
          summary,
        )
      }

      if (key === 'co2-beverage') {
        return /\\bbeverage\\b|\\bsoda\\b|\\bdraft\\b|\\bkeg\\b|\\brestaurant\\b|\\bfood[-\\s]?service\\b/i.test(
          summary,
        )
      }

      return true
    })
}

function hasTransitionOrStructuralHold(row: EnrichmentRow) {
  const text = row.evidence_summary ?? ''
  return (
    /\b(?:acquir\w*|formerly|merger|merged|renam\w*|d\/?b\/?a|doing business as|moved|relocat\w*|rin transfer|transferred? with the business|lineage|successor)\b/i.test(
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

const eligibleCandidates = actualReviewFacilities
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
    const supportedServiceKeys = evidenceSupportedServiceKeys(result)
    const externalCustomerEvidence =
      rawBoolean(
        result.raw_result,
        'evidence_supports_external_customers',
      ) === true
    const previousBatch = rawString(result.raw_result, 'batch') ?? ''
    const previousServiceReviewBatch =
      rawString(result.raw_result, 'service_review_batch') ?? ''
    const commonEligible =
      result.identity_match === 'matched' &&
      Number(result.identity_confidence) >= 0.85 &&
      result.business_status === 'active' &&
      result.serves_external_customers === 'yes' &&
      externalCustomerEvidence &&
      (facilityCounts.get(facilityKey(facility)) ?? 0) === 1 &&
      !hasTransitionOrStructuralHold(result)

    if (!commonEligible) return false

    if (bucket === 'missing_identity_corroboration_only') {
      return (
        !identityCorroborated &&
        !previousBatch.startsWith('review-harvest-') &&
        Number(result.service_confidence) >= 0.85 &&
        supportedServiceKeys.length > 0
      )
    }

    if (bucket === 'missing_service_evidence_only') {
      return (
        identityCorroborated &&
        !previousServiceReviewBatch.startsWith('review-service-harvest-') &&
        (Number(result.service_confidence) < 0.85 ||
          supportedServiceKeys.length === 0)
      )
    }

    return false
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

if (!eligibleCandidates.length) {
  throw new Error('No review-resolution candidates found for bucket ' + bucket)
}

const { data: activeRuns, error: activeRunsError } = await supabase
  .from('enrichment_runs')
  .select('id, name, status, created_at')
  .in('status', ['running', 'queued'])
  .order('created_at', { ascending: false })

if (activeRunsError) throw activeRunsError

const candidateCountsByRun = eligibleCandidates.reduce<Map<string, number>>(
  (counts, { facility }) => {
    if (!facility.enrichment_run_id) return counts
    counts.set(
      facility.enrichment_run_id,
      (counts.get(facility.enrichment_run_id) ?? 0) + 1,
    )
    return counts
  },
  new Map(),
)

const run = (activeRuns ?? [])
  .filter((candidateRun) => (candidateCountsByRun.get(candidateRun.id) ?? 0) > 0)
  .sort(
    (a, b) =>
      (candidateCountsByRun.get(b.id) ?? 0) -
        (candidateCountsByRun.get(a.id) ?? 0) ||
      String(b.created_at).localeCompare(String(a.created_at)),
  )[0]

if (!run) {
  throw new Error(
    'No review-resolution candidates belong to a running or queued enrichment run',
  )
}

const candidates = eligibleCandidates
  .filter(({ facility }) => facility.enrichment_run_id === run.id)
  .slice(0, limit)

const records = candidates.map(({ facility, result }) => {
  const raw = result.raw_result
  const supportedServiceKeys = evidenceSupportedServiceKeys(result)
  const exportedServiceKeys =
    bucket === 'missing_service_evidence_only'
      ? result.service_keys ?? []
      : supportedServiceKeys

  return {
    rin: facility.rin,
    phmsaName: facility.phmsa_name,
    phmsaAddress: facility.phmsa_address,
    city: facility.city,
    state: facility.state,
    postalCode: facility.postal_code,
    candidateTypeHint: facility.candidate_type_hint,
    identityMatch: result.identity_match,
    businessStatus: result.business_status,
    servesExternalCustomers: result.serves_external_customers,
    currentName: result.current_name,
    currentAddress: result.current_address,
    serviceKeys: exportedServiceKeys,
    serviceConfidence: Number(result.service_confidence),
    identityConfidence: Number(result.identity_confidence),
    evidenceUrl: rawString(raw, 'evidence_url'),
    evidenceType: rawString(raw, 'evidence_type') as EvidenceType | null,
    evidenceSupportsServiceKeys: supportedServiceKeys,
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
      activeRun: run.name,
      skippedInactiveRunCandidates:
        eligibleCandidates.length -
        eligibleCandidates.filter(
          ({ facility }) => facility.enrichment_run_id === run.id,
        ).length,
      rins: records.map((record) => record.rin),
    },
    null,
    2,
  ),
)
