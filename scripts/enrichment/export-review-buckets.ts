import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAdminClient, readFlag } from './admin-client'

type ReviewBucket =
  | 'multi_rin_same_facility'
  | 'identity_transition_or_rin_transfer'
  | 'missing_identity_corroboration_only'
  | 'missing_service_evidence_only'
  | 'missing_external_customer_evidence_only'
  | 'identity_conflict'
  | 'identity_unresolved_or_low_confidence'
  | 'business_status_only'
  | 'multiple_or_other_blockers'

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
  manual_review_reason: string | null
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

interface ReviewRecord {
  bucket: ReviewBucket
  rin: string
  phmsaName: string
  phmsaAddress: string
  city: string
  state: string
  postalCode: string | null
  candidateTypeHint: string | null
  identityMatch: string
  businessStatus: string
  servesExternalCustomers: string
  identityConfidence: number
  serviceConfidence: number
  serviceKeys: string[]
  identityCorroborated: boolean
  evidenceUrl: string | null
  evidenceType: string | null
  corroborationEvidenceUrl: string | null
  corroborationEvidenceType: string | null
  currentName: string | null
  currentAddress: string | null
  manualReviewReason: string | null
  evidenceSummary: string | null
}

const outputPath = readFlag('output') ?? 'tmp/review-resolution-buckets.json'
const supabase = createAdminClient()

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function fetchManualReviewFacilities() {
  const rows: FacilityRow[] = []
  const pageSize = 500

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('facilities')
      .select(
        'id, rin, phmsa_name, phmsa_address, city, state, postal_code, candidate_type_hint, enrichment_run_id, manual_review_reason',
      )
      .eq('pipeline_status', 'manual_review')
      .order('state')
      .order('city')
      .order('phmsa_name')
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

    const currentRunByFacility = new Map(
      group.map((facility) => [facility.id, facility.enrichment_run_id]),
    )

    for (const row of (data ?? []) as EnrichmentRow[]) {
      if (currentRunByFacility.get(row.facility_id) === row.run_id) {
        byFacility.set(row.facility_id, row)
      }
    }
  }

  return byFacility
}

function rawString(raw: Record<string, unknown> | null, key: string) {
  const value = raw?.[key]
  return typeof value === 'string' ? value : null
}

function rawBoolean(raw: Record<string, unknown> | null, key: string) {
  return raw?.[key] === true
}

function normalizeFacilityKey(value: string | null | undefined) {
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

function facilityIdentityKey(facility: FacilityRow) {
  return [
    normalizeFacilityKey(facility.phmsa_name),
    normalizeFacilityKey(facility.phmsa_address),
    normalizeFacilityKey(facility.city),
    normalizeFacilityKey(facility.state),
  ].join('|')
}

function hasIdentityTransitionSignal(row: EnrichmentRow) {
  return /\b(acquir|formerly|merger|merged|rename|renamed|d\/?b\/?a|doing business as|moved|relocat|rin transfer|transferred? with the business)\b/i.test(
    row.evidence_summary ?? '',
  )
}

function classify(
  row: EnrichmentRow,
  options: { multiRinSameFacility: boolean },
): ReviewBucket {
  const identityCorroborated = rawBoolean(row.raw_result, 'identity_corroborated')
  const serviceKeys = row.service_keys ?? []

  const okIdentityMatch = row.identity_match === 'matched'
  const okIdentityConfidence = Number(row.identity_confidence) >= 0.85
  const okIdentityCorroboration = identityCorroborated
  const okActive = row.business_status === 'active'
  const okExternal = row.serves_external_customers === 'yes'
  const okServiceConfidence = Number(row.service_confidence) >= 0.85
  const okServices = serviceKeys.length > 0

  if (row.identity_match === 'changed' || row.identity_match === 'conflict') {
    return 'identity_conflict'
  }

  if (!okIdentityMatch || !okIdentityConfidence) {
    return 'identity_unresolved_or_low_confidence'
  }

  if (options.multiRinSameFacility) {
    return 'multi_rin_same_facility'
  }

  if (hasIdentityTransitionSignal(row)) {
    return 'identity_transition_or_rin_transfer'
  }

  if (
    !okIdentityCorroboration &&
    okActive &&
    okExternal &&
    okServiceConfidence &&
    okServices
  ) {
    return 'missing_identity_corroboration_only'
  }

  if (
    !okExternal &&
    okIdentityCorroboration &&
    okActive &&
    okServiceConfidence &&
    okServices
  ) {
    return 'missing_external_customer_evidence_only'
  }

  if (
    (!okServiceConfidence || !okServices) &&
    okIdentityCorroboration &&
    okActive &&
    okExternal
  ) {
    return 'missing_service_evidence_only'
  }

  if (
    !okActive &&
    okIdentityCorroboration &&
    okExternal &&
    okServiceConfidence &&
    okServices
  ) {
    return 'business_status_only'
  }

  return 'multiple_or_other_blockers'
}

const facilities = await fetchManualReviewFacilities()
const currentResults = await fetchCurrentResults(facilities)

const facilityIdentityCounts = facilities.reduce<Map<string, number>>((counts, facility) => {
  const key = facilityIdentityKey(facility)
  counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}, new Map())

const records: ReviewRecord[] = []

for (const facility of facilities) {
  const result = currentResults.get(facility.id)
  if (!result) continue

  records.push({
    bucket: classify(result, {
      multiRinSameFacility: (facilityIdentityCounts.get(facilityIdentityKey(facility)) ?? 0) > 1,
    }),
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
    identityConfidence: Number(result.identity_confidence),
    serviceConfidence: Number(result.service_confidence),
    serviceKeys: result.service_keys ?? [],
    identityCorroborated: rawBoolean(result.raw_result, 'identity_corroborated'),
    evidenceUrl: rawString(result.raw_result, 'evidence_url'),
    evidenceType: rawString(result.raw_result, 'evidence_type'),
    corroborationEvidenceUrl: rawString(
      result.raw_result,
      'corroboration_evidence_url',
    ),
    corroborationEvidenceType: rawString(
      result.raw_result,
      'corroboration_evidence_type',
    ),
    currentName: result.current_name,
    currentAddress: result.current_address,
    manualReviewReason: facility.manual_review_reason,
    evidenceSummary: result.evidence_summary,
  })
}

const bucketOrder: ReviewBucket[] = [
  'missing_identity_corroboration_only',
  'missing_service_evidence_only',
  'missing_external_customer_evidence_only',
  'multi_rin_same_facility',
  'identity_transition_or_rin_transfer',
  'identity_conflict',
  'identity_unresolved_or_low_confidence',
  'business_status_only',
  'multiple_or_other_blockers',
]

const buckets = Object.fromEntries(
  bucketOrder.map((bucket) => [
    bucket,
    records
      .filter((record) => record.bucket === bucket)
      .sort(
        (a, b) =>
          Math.min(b.identityConfidence, b.serviceConfidence) -
            Math.min(a.identityConfidence, a.serviceConfidence) ||
          a.state.localeCompare(b.state) ||
          a.rin.localeCompare(b.rin),
      ),
  ]),
) as Record<ReviewBucket, ReviewRecord[]>

const summary = Object.fromEntries(
  bucketOrder.map((bucket) => [bucket, buckets[bucket].length]),
)

const payload = {
  generatedAt: new Date().toISOString(),
  openAiApiCalls: 0,
  databaseWrites: 0,
  totalManualReview: facilities.length,
  resultsFound: records.length,
  resultsMissing: facilities.length - records.length,
  summary,
  priorityOrder: bucketOrder,
  buckets,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n')

console.log(
  JSON.stringify(
    {
      output: outputPath,
      totalManualReview: facilities.length,
      resultsFound: records.length,
      resultsMissing: facilities.length - records.length,
      summary,
    },
    null,
    2,
  ),
)
