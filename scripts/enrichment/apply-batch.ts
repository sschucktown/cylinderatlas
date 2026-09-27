import { readFile } from 'node:fs/promises'
import { decide } from './rules'
import type { EvidenceInput, FacilityCandidate } from './types'
import { createAdminClient } from './admin-client'

type EvidenceType = 'regulatory' | 'first_party' | 'business_registry' | 'directory' | 'provider_claim' | 'other'

interface BatchRecord extends Omit<EvidenceInput, 'identityCorroborated' | 'evidenceUrls'> {
  rin: string
  evidenceUrl?: string | null
  evidenceType?: EvidenceType | null
  evidenceSupportsServiceKeys?: EvidenceInput['serviceKeys']
  evidenceSupportsExternalCustomers?: boolean
  corroborationEvidenceUrl?: string | null
  corroborationEvidenceType?: EvidenceType | null
  corroborationSupports?: Array<'identity' | 'address' | 'business_status'>
  corroborationSummary?: string
}

const IDENTITY_CORROBORATION_TYPES = new Set<EvidenceType>([
  'first_party',
  'business_registry',
  'regulatory',
  'provider_claim',
])

const AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES = new Set<EvidenceType>([
  'first_party',
  'regulatory',
  'provider_claim',
])

interface BatchPayload {
  runName: string
  batch: string
  complete?: boolean
  evidenceSemanticsVersion?: number
  records: BatchRecord[]
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const inputPath = args.find((arg) => !arg.startsWith('--'))
if (!inputPath) {
  throw new Error('Usage: npm run enrich:apply -- <evidence-batch.json> [--dry-run]')
}

const payload = JSON.parse(await readFile(inputPath, 'utf8')) as BatchPayload
if (!payload.runName || !payload.batch || !Array.isArray(payload.records) || !payload.records.length) {
  throw new Error('Batch file must include runName, batch, and non-empty records[]')
}

if (payload.complete === false) {
  throw new Error('Refusing to apply an incomplete harvester checkpoint')
}

const duplicateRins = payload.records
  .map((record) => record.rin)
  .filter((rin, index, all) => all.indexOf(rin) !== index)

if (duplicateRins.length) {
  throw new Error('Duplicate RINs in batch: ' + [...new Set(duplicateRins)].join(', '))
}

const supabase = createAdminClient()

const { data: run, error: runError } = await supabase
  .from('enrichment_runs')
  .select('id, name, algorithm_version, status')
  .eq('name', payload.runName)
  .maybeSingle()

if (runError) throw runError
if (!run) throw new Error('Enrichment run not found: ' + payload.runName)
if (run.status !== 'running' && run.status !== 'queued') {
  throw new Error('Run ' + payload.runName + ' is not writable from status ' + run.status)
}

const rins = payload.records.map((record) => record.rin)
const { data: facilities, error: facilitiesError } = await supabase
  .from('facilities')
  .select('id, rin, phmsa_name, phmsa_address, city, state, postal_code, candidate_type_hint, pipeline_status')
  .in('rin', rins)

if (facilitiesError) throw facilitiesError

const facilitiesByRin = new Map((facilities ?? []).map((facility) => [facility.rin, facility]))
const missingRins = rins.filter((rin) => !facilitiesByRin.has(rin))
if (missingRins.length) {
  throw new Error('Unknown RINs: ' + missingRins.join(', '))
}

const applied: Array<{ rin: string; decision: string }> = []

interface PreviewRow {
  rin: string
  decision: string
  identityCorroborated: boolean
  identityConfidence: number
  serviceConfidence: number
  serviceKeys: string[]
  evidenceUrl: string | null
  evidenceType: EvidenceType | null
  corroborationEvidenceUrl: string | null
  corroborationEvidenceType: EvidenceType | null
  phmsaName: string
  phmsaAddress: string
  currentName: string | null
  currentAddress: string | null
  auditRisk: number
  auditReasons: string[]
  manualReviewReason: string | null
}

const preview: PreviewRow[] = []

function normalizeComparison(value: string | null | undefined) {
  return (value ?? '')
    .toUpperCase()
    .replace(/\b(SUITE|STE)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

function auditRisk(
  candidate: FacilityCandidate,
  record: BatchRecord,
  result: ReturnType<typeof decide>,
) {
  let score = 0
  const reasons: string[] = []

  if (result.identityConfidence < 0.9) {
    score += Math.round((0.9 - result.identityConfidence) * 100)
    reasons.push(`identity confidence ${result.identityConfidence.toFixed(2)}`)
  }

  if (result.serviceConfidence < 0.9) {
    score += Math.round((0.9 - result.serviceConfidence) * 100)
    reasons.push(`service confidence ${result.serviceConfidence.toFixed(2)}`)
  }

  if (result.serviceKeys.length > 1) {
    score += 5 + (result.serviceKeys.length - 1) * 2
    reasons.push(`multi-service publish (${result.serviceKeys.length})`)
  }

  if (
    record.evidenceType &&
    !AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES.has(record.evidenceType)
  ) {
    score += 10
    reasons.push(`weak primary evidence type: ${record.evidenceType}`)
  }

  const currentAddress = normalizeComparison(result.currentAddress)
  const phmsaAddress = normalizeComparison(candidate.phmsa_address)
  if (currentAddress && phmsaAddress && currentAddress !== phmsaAddress) {
    score += 6
    reasons.push('current address differs from PHMSA address')
  }

  const identityText = [
    result.summary,
    record.corroborationSummary,
    result.currentName,
  ]
    .filter(Boolean)
    .join(' ')

  if (/\b(acquir|formerly|merger|merged|rename|renamed|d\/?b\/?a|doing business as|moved|relocat)/i.test(identityText)) {
    score += 8
    reasons.push('acquisition/rename/move signal')
  }

  return { score, reasons }
}

for (const record of payload.records) {
  const facility = facilitiesByRin.get(record.rin)!
  const candidate: FacilityCandidate = {
    id: facility.id,
    rin: facility.rin,
    phmsa_name: facility.phmsa_name,
    phmsa_address: facility.phmsa_address,
    city: facility.city,
    state: facility.state,
    postal_code: facility.postal_code,
    candidate_type_hint: facility.candidate_type_hint,
  }

  const isHarvesterPayload = payload.complete === true
  const usesEvidenceSemanticsV2 = payload.evidenceSemanticsVersion === 2
  const strongPrimaryEvidence = Boolean(
    record.evidenceUrl &&
      record.evidenceType &&
      IDENTITY_CORROBORATION_TYPES.has(record.evidenceType),
  )
  const strongCorroborationEvidence = Boolean(
    record.corroborationEvidenceUrl &&
      record.corroborationEvidenceType &&
      IDENTITY_CORROBORATION_TYPES.has(record.corroborationEvidenceType),
  )

  // Harvester packets reserve the primary source for service/customer evidence and
  // the corroboration source for current identity/location/business status. Require
  // the distinct corroboration source plus extracted current identity/location before
  // allowing the deterministic publish gate to clear.
  const corroborationSupportsRequiredIdentityFields =
    record.corroborationSupports?.includes('identity') === true &&
    record.corroborationSupports?.includes('address') === true &&
    record.corroborationSupports?.includes('business_status') === true

  const identityCorroborated = isHarvesterPayload
    ? Boolean(
        strongCorroborationEvidence &&
          record.currentName &&
          record.currentAddress &&
          (!usesEvidenceSemanticsV2 || corroborationSupportsRequiredIdentityFields),
      )
    : strongPrimaryEvidence || strongCorroborationEvidence

  const evidenceBackedServiceKeys = usesEvidenceSemanticsV2
    ? record.serviceKeys.filter((key) => record.evidenceSupportsServiceKeys?.includes(key))
    : record.serviceKeys

  const hasStrongAutoPublishServiceEvidence = Boolean(
    record.evidenceUrl &&
      record.evidenceType &&
      (!usesEvidenceSemanticsV2 || AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES.has(record.evidenceType)),
  )

  const effectiveExternalCustomerStatus =
    usesEvidenceSemanticsV2 &&
    record.servesExternalCustomers === 'yes' &&
    record.evidenceSupportsExternalCustomers !== true
      ? 'unknown'
      : record.servesExternalCustomers

  const result = decide(candidate, {
    ...record,
    servesExternalCustomers: effectiveExternalCustomerStatus,
    serviceKeys: hasStrongAutoPublishServiceEvidence ? evidenceBackedServiceKeys : [],
    identityCorroborated,
    evidenceUrls: [record.evidenceUrl, record.corroborationEvidenceUrl].filter(
      (url): url is string => Boolean(url),
    ),
  })

  applied.push({ rin: facility.rin, decision: result.decision })

  if (dryRun) {
    preview.push({
      rin: facility.rin,
      decision: result.decision,
      identityCorroborated,
      identityConfidence: result.identityConfidence,
      serviceConfidence: result.serviceConfidence,
      serviceKeys: result.serviceKeys,
      evidenceUrl: record.evidenceUrl ?? null,
      evidenceType: record.evidenceType ?? null,
      corroborationEvidenceUrl: record.corroborationEvidenceUrl ?? null,
      corroborationEvidenceType: record.corroborationEvidenceType ?? null,
      phmsaName: candidate.phmsa_name,
      phmsaAddress: candidate.phmsa_address,
      currentName: result.currentName ?? null,
      currentAddress: result.currentAddress ?? null,
      ...(() => {
        const risk = auditRisk(candidate, record, result)
        return { auditRisk: risk.score, auditReasons: risk.reasons }
      })(),
      manualReviewReason: result.manualReviewReason ?? null,
    })
    continue
  }

  const { error: resultError } = await supabase
    .from('facility_enrichment_results')
    .upsert(
      {
        run_id: run.id,
        facility_id: facility.id,
        identity_match: record.identityMatch,
        business_status: record.businessStatus,
        serves_external_customers: effectiveExternalCustomerStatus,
        identity_confidence: result.identityConfidence,
        service_confidence: result.serviceConfidence,
        decision: result.decision,
        service_keys: result.serviceKeys,
        current_name: result.currentName ?? null,
        current_address: result.currentAddress ?? null,
        manual_review_reason: result.manualReviewReason ?? null,
        evidence_summary: result.summary,
        raw_result: {
          batch: payload.batch,
          evidence_url: record.evidenceUrl ?? null,
          evidence_type: record.evidenceType ?? null,
          identity_corroborated: identityCorroborated,
          evidence_semantics_version: payload.evidenceSemanticsVersion ?? null,
          evidence_supports_service_keys: record.evidenceSupportsServiceKeys ?? null,
          evidence_supports_external_customers: record.evidenceSupportsExternalCustomers ?? null,
          corroboration_supports: record.corroborationSupports ?? null,
          corroboration_evidence_url: record.corroborationEvidenceUrl ?? null,
          corroboration_evidence_type: record.corroborationEvidenceType ?? null,
        },
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'run_id,facility_id' },
    )

  if (resultError) throw resultError

  // A service can be verified only after the evidence packet cleanly maps the
  // current business back to this exact RIN facility. This prevents service evidence
  // for a moved/renamed/conflicting business from being attached to the wrong facility.
  const verifiedServiceKeys =
    result.decision === 'publish' &&
    record.identityMatch === 'matched' &&
    result.identityConfidence >= 0.85 &&
    identityCorroborated &&
    result.serviceConfidence >= 0.85 &&
    record.evidenceUrl &&
    record.evidenceType
      ? result.serviceKeys
      : []

  for (const serviceKey of verifiedServiceKeys) {
    const { error: serviceError } = await supabase
      .from('facility_services')
      .upsert(
        {
          facility_id: facility.id,
          service_key: serviceKey,
          status: 'verified',
          confidence: result.serviceConfidence,
        },
        { onConflict: 'facility_id,service_key' },
      )

    if (serviceError) throw serviceError
  }

  if (record.evidenceUrl && record.evidenceType) {
    const { data: existingEvidence, error: evidenceLookupError } = await supabase
      .from('evidence')
      .select('id')
      .eq('facility_id', facility.id)
      .eq('supports_field', 'national-enrichment-v1')
      .eq('url', record.evidenceUrl)
      .limit(1)

    if (evidenceLookupError) throw evidenceLookupError

    if (!existingEvidence?.length) {
      const { error: evidenceError } = await supabase.from('evidence').insert({
        facility_id: facility.id,
        evidence_type: record.evidenceType,
        url: record.evidenceUrl,
        supports_field: 'national-enrichment-v1',
        summary: result.summary,
      })

      if (evidenceError) throw evidenceError
    }
  }

  if (record.corroborationEvidenceUrl && record.corroborationEvidenceType) {
    const { data: existingCorroboration, error: corroborationLookupError } = await supabase
      .from('evidence')
      .select('id')
      .eq('facility_id', facility.id)
      .eq('supports_field', 'national-enrichment-v1-corroboration')
      .eq('url', record.corroborationEvidenceUrl)
      .limit(1)

    if (corroborationLookupError) throw corroborationLookupError

    if (!existingCorroboration?.length) {
      const { error: corroborationError } = await supabase.from('evidence').insert({
        facility_id: facility.id,
        evidence_type: record.corroborationEvidenceType,
        url: record.corroborationEvidenceUrl,
        supports_field: 'national-enrichment-v1-corroboration',
        summary:
          record.corroborationSummary ??
          'Independent current identity/location/business-status corroboration.',
      })

      if (corroborationError) throw corroborationError
    }
  }

  const facilityUpdate: Record<string, unknown> = {
    publish_status: result.decision,
    commercial_status: result.commercialStatus,
    identity_confidence: result.identityConfidence,
    pipeline_status:
      result.decision === 'publish'
        ? 'enriched'
        : result.decision === 'review'
          ? 'manual_review'
          : 'excluded',
    manual_review_reason: result.manualReviewReason ?? null,
    enrichment_run_id: run.id,
    enrichment_version: run.algorithm_version,
    last_enriched_at: new Date().toISOString(),
    verified_at: result.decision === 'publish' ? new Date().toISOString() : null,
  }

  if (result.decision === 'publish') {
    facilityUpdate.display_name = result.currentName ?? facility.phmsa_name
    facilityUpdate.display_address = result.currentAddress ?? facility.phmsa_address
  }

  const { error: facilityError } = await supabase
    .from('facilities')
    .update(facilityUpdate)
    .eq('id', facility.id)

  if (facilityError) throw facilityError

}

const counts = applied.reduce<Record<string, number>>((acc, row) => {
  acc[row.decision] = (acc[row.decision] ?? 0) + 1
  return acc
}, {})

const publishAuditSample = preview
  .filter((row) => row.decision === 'publish')
  .sort(
    (a, b) =>
      b.auditRisk - a.auditRisk ||
      Math.min(a.identityConfidence, a.serviceConfidence) -
        Math.min(b.identityConfidence, b.serviceConfidence) ||
      a.rin.localeCompare(b.rin),
  )
  .slice(0, 5)

console.log(
  JSON.stringify(
    {
      run: run.name,
      batch: payload.batch,
      dryRun,
      applied: dryRun ? 0 : applied.length,
      evaluated: applied.length,
      decisions: counts,
      ...(dryRun
        ? {
            auditPublishCandidates: publishAuditSample,
            excludeCandidates: preview.filter((row) => row.decision === 'exclude'),
            publishCandidates: preview.filter((row) => row.decision === 'publish'),
            reviewCandidates: preview.filter((row) => row.decision === 'review'),
          }
        : {}),
    },
    null,
    2,
  ),
)
