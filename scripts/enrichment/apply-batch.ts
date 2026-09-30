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
  serviceEvidenceUrl?: string | null
  serviceEvidenceType?: EvidenceType | null
  serviceEvidenceSupportsKeys?: EvidenceInput['serviceKeys']
  serviceEvidenceSummary?: string | null
  serviceSourceName?: string | null
  serviceSourceAddress?: string | null
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


const TRUSTED_NON_GOV_REGISTRY_HOSTS = ['sunbiz.org']

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith('.' + domain)
}

function urlHostname(raw: string | null | undefined) {
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

function siteDomain(raw: string | null | undefined) {
  const hostname = urlHostname(raw)
  if (!hostname) return null
  const parts = hostname.split('.').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? null
  return parts.slice(-2).join('.')
}

function isGovernmentUrl(raw: string | null | undefined) {
  const hostname = urlHostname(raw)
  return Boolean(hostname && (hostname === 'gov' || hostname.endsWith('.gov')))
}

function isPlausibleBusinessRegistry(raw: string | null | undefined) {
  const hostname = urlHostname(raw)
  if (!hostname) return false
  return (
    isGovernmentUrl(raw) ||
    TRUSTED_NON_GOV_REGISTRY_HOSTS.some((domain) =>
      hostnameMatches(hostname, domain),
    )
  )
}


function normalizeFacilityText(value: string | null | undefined) {
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

function domainLooksLikeBusiness(
  rawUrl: string,
  names: Array<string | null | undefined>,
) {
  const domain = siteDomain(rawUrl)
  if (!domain) return false

  const normalizedDomain = domain.replace(/[^a-z0-9]/g, '')
  const tokens = names
    .filter(Boolean)
    .flatMap((value) =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 5 &&
            !['company', 'corporation', 'limited', 'incorporated', 'services'].includes(
              token,
            ),
        ),
    )

  return tokens.some((token) => normalizedDomain.includes(token))
}

function serviceSourceMatchesFacility(
  candidate: FacilityCandidate,
  record: BatchRecord,
) {
  const source = normalizeFacilityText(record.serviceSourceAddress)
  const phmsaStreet = normalizeFacilityText(candidate.phmsa_address)
  const city = normalizeFacilityText(candidate.city)

  return Boolean(
    source &&
      phmsaStreet &&
      source.includes(phmsaStreet) &&
      (!city || source.includes(city)),
  )
}

function reviewServiceEvidenceSourceIsValid(
  candidate: FacilityCandidate,
  record: BatchRecord,
) {
  const url = record.serviceEvidenceUrl
  const type = record.serviceEvidenceType
  if (!url || !type) return false

  if (type === 'regulatory') return isGovernmentUrl(url)
  if (type !== 'first_party') return false

  const primaryDomain =
    record.evidenceType === 'first_party' ? siteDomain(record.evidenceUrl) : null
  const serviceDomain = siteDomain(url)
  const matchesKnownProviderDomain = Boolean(
    primaryDomain && serviceDomain && primaryDomain === serviceDomain,
  )

  return Boolean(
    matchesKnownProviderDomain ||
      (domainLooksLikeBusiness(url, [record.currentName, candidate.phmsa_name]) &&
        serviceSourceMatchesFacility(candidate, record)),
  )
}

function reviewCorroborationSourceIsValid(record: BatchRecord) {
  const url = record.corroborationEvidenceUrl
  const type = record.corroborationEvidenceType
  if (!url || !type) return false

  if (type === 'first_party') {
    const primaryDomain = siteDomain(record.evidenceUrl)
    const corroborationDomain = siteDomain(url)
    return Boolean(
      primaryDomain &&
        corroborationDomain &&
        primaryDomain === corroborationDomain,
    )
  }

  if (type === 'regulatory') {
    return isGovernmentUrl(url)
  }

  if (type === 'business_registry') {
    return isPlausibleBusinessRegistry(url)
  }

  // Web-researched review resolution must never manufacture provider_claim.
  return false
}

interface BatchPayload {
  runName: string
  batch: string
  complete?: boolean
  evidenceSemanticsVersion?: number
  reviewResolution?: boolean
  sourceBucket?: string
  records: BatchRecord[]
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const inputPath = args.find((arg) => !arg.startsWith('--'))
if (!inputPath) {
  throw new Error('Usage: npm run enrich:apply -- <evidence-batch.json> [--dry-run]')
}

const payload = JSON.parse(await readFile(inputPath, 'utf8')) as BatchPayload
if (!payload.runName || !payload.batch || !Array.isArray(payload.records)) {
  throw new Error('Batch file must include runName, batch, and records[]')
}

if (payload.complete === false) {
  throw new Error('Refusing to apply an incomplete harvester checkpoint')
}

if (!payload.records.length) {
  throw new Error('Refusing to apply a batch with empty records[]')
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

const existingResultsByFacility = new Map<
  string,
  {
    current_name: string | null
    current_address: string | null
    raw_result: Record<string, unknown> | null
  }
>()

if (payload.reviewResolution) {
  const facilityIds = (facilities ?? []).map((facility) => facility.id)
  const { data: existingResults, error: existingResultsError } = await supabase
    .from('facility_enrichment_results')
    .select('facility_id, current_name, current_address, raw_result')
    .eq('run_id', run.id)
    .in('facility_id', facilityIds)

  if (existingResultsError) throw existingResultsError

  for (const row of existingResults ?? []) {
    existingResultsByFacility.set(row.facility_id, {
      current_name: row.current_name,
      current_address: row.current_address,
      raw_result: row.raw_result as Record<string, unknown> | null,
    })
  }
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
  serviceEvidenceUrl: string | null
  serviceEvidenceType: EvidenceType | null
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

function hasUnresolvedIdentityLocationConflict(record: BatchRecord) {
  const text = [record.summary, record.corroborationSummary]
    .filter(Boolean)
    .join(' ')

  return (
    /\b(?:different|conflicting|inconsistent|mismatched|alternate)\b.{0,100}\b(?:address|location)\b/i.test(
      text,
    ) ||
    /\b(?:address|location)\b.{0,100}\b(?:different|conflicting|inconsistent|mismatch)\b/i.test(
      text,
    )
  )
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

  const auditServiceEvidenceType =
    record.serviceEvidenceType ?? record.evidenceType
  if (
    auditServiceEvidenceType &&
    !AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES.has(auditServiceEvidenceType)
  ) {
    score += 10
    reasons.push(`weak service evidence type: ${auditServiceEvidenceType}`)
  }

  const currentAddress = normalizeComparison(result.currentAddress)
  const phmsaAddress = normalizeComparison(candidate.phmsa_address)
  if (
    currentAddress &&
    phmsaAddress &&
    !currentAddress.includes(phmsaAddress)
  ) {
    score += 6
    reasons.push('current address may differ from PHMSA address')
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
  const isServiceResolution =
    payload.sourceBucket === 'missing_service_evidence_only'
  const strongPrimaryEvidence = Boolean(
    record.evidenceUrl &&
      record.evidenceType &&
      IDENTITY_CORROBORATION_TYPES.has(record.evidenceType),
  )
  const reviewCorroborationAccepted =
    isServiceResolution ||
    !payload.reviewResolution ||
    reviewCorroborationSourceIsValid(record)
  const effectiveCorroborationEvidenceUrl = reviewCorroborationAccepted
    ? record.corroborationEvidenceUrl ?? null
    : null
  const effectiveCorroborationEvidenceType = reviewCorroborationAccepted
    ? record.corroborationEvidenceType ?? null
    : null
  const effectiveCorroborationSupports = reviewCorroborationAccepted
    ? record.corroborationSupports ?? []
    : []
  const effectiveCorroborationSummary = reviewCorroborationAccepted
    ? record.corroborationSummary ?? null
    : null

  const strongCorroborationEvidence = Boolean(
    effectiveCorroborationEvidenceUrl &&
      effectiveCorroborationEvidenceType &&
      IDENTITY_CORROBORATION_TYPES.has(effectiveCorroborationEvidenceType),
  )

  // Harvester packets reserve the primary source for service/customer evidence and
  // the corroboration source for current identity/location/business status. Require
  // the distinct corroboration source plus extracted current identity/location before
  // allowing the deterministic publish gate to clear.
  const corroborationSupportsRequiredIdentityFields =
    effectiveCorroborationSupports.includes('identity') &&
    effectiveCorroborationSupports.includes('address') &&
    effectiveCorroborationSupports.includes('business_status')

  const unresolvedIdentityLocationConflict =
    payload.reviewResolution === true &&
    hasUnresolvedIdentityLocationConflict(record)

  const existingResult = existingResultsByFacility.get(facility.id)
  const existingIdentityCorroborated =
    existingResult?.raw_result?.identity_corroborated === true

  const identityCorroborated = isServiceResolution
    ? Boolean(
        existingIdentityCorroborated &&
          record.identityMatch === 'matched' &&
          record.identityConfidence >= 0.85 &&
          !unresolvedIdentityLocationConflict,
      )
    : isHarvesterPayload
      ? Boolean(
          strongCorroborationEvidence &&
            record.currentName &&
            record.currentAddress &&
            !unresolvedIdentityLocationConflict &&
            (!usesEvidenceSemanticsV2 ||
              corroborationSupportsRequiredIdentityFields),
        )
      : strongPrimaryEvidence || strongCorroborationEvidence

  const serviceResolutionEvidenceAccepted =
    !isServiceResolution || reviewServiceEvidenceSourceIsValid(candidate, record)

  const effectiveServiceEvidenceUrl = isServiceResolution
    ? serviceResolutionEvidenceAccepted
      ? record.serviceEvidenceUrl ?? null
      : null
    : record.evidenceUrl ?? null
  const effectiveServiceEvidenceType = isServiceResolution
    ? serviceResolutionEvidenceAccepted
      ? record.serviceEvidenceType ?? null
      : null
    : record.evidenceType ?? null
  const effectiveServiceEvidenceSupportsKeys = isServiceResolution
    ? serviceResolutionEvidenceAccepted
      ? record.serviceEvidenceSupportsKeys ?? []
      : []
    : record.evidenceSupportsServiceKeys ?? []

  const evidenceBackedServiceKeys = usesEvidenceSemanticsV2
    ? record.serviceKeys.filter((key) =>
        effectiveServiceEvidenceSupportsKeys.includes(key),
      )
    : record.serviceKeys

  const hasStrongAutoPublishServiceEvidence = Boolean(
    effectiveServiceEvidenceUrl &&
      effectiveServiceEvidenceType &&
      (!usesEvidenceSemanticsV2 ||
        AUTO_PUBLISH_SERVICE_EVIDENCE_TYPES.has(
          effectiveServiceEvidenceType,
        )),
  )

  // v2 can positively prove external-customer access, but the schema does not
  // separately prove the negative. Treat an unsupported yes OR any no as unknown
  // so absence of customer-access evidence cannot automatically exclude a facility.
  const effectiveExternalCustomerStatus = usesEvidenceSemanticsV2
    ? record.servesExternalCustomers === 'yes' &&
      record.evidenceSupportsExternalCustomers === true
      ? 'yes'
      : 'unknown'
    : record.servesExternalCustomers

  // Likewise, model-extracted terminal business statuses are not enough by themselves
  // to exclude a facility. For v2, require the exact current identity/location/status
  // to clear the strong corroboration gate before accepting inactive/internal/not_public.
  // Deterministic obvious-internal rules in rules.ts remain independent of this safeguard.
  const isTerminalBusinessStatus =
    record.businessStatus === 'inactive' ||
    record.businessStatus === 'internal' ||
    record.businessStatus === 'not_public'

  const effectiveBusinessStatus =
    usesEvidenceSemanticsV2 && isTerminalBusinessStatus
      ? identityCorroborated && record.identityConfidence >= 0.85
        ? record.businessStatus
        : 'unknown'
      : record.businessStatus

  const preserveReviewedIdentity =
    payload.reviewResolution === true &&
    record.identityMatch === 'matched' &&
    Boolean(existingResult)

  const effectiveCurrentName = preserveReviewedIdentity
    ? existingResult?.current_name ?? record.currentName
    : record.currentName
  const effectiveCurrentAddress = preserveReviewedIdentity
    ? existingResult?.current_address ?? record.currentAddress
    : record.currentAddress

  const result = decide(candidate, {
    ...record,
    currentName: effectiveCurrentName,
    currentAddress: effectiveCurrentAddress,
    businessStatus: effectiveBusinessStatus,
    servesExternalCustomers: effectiveExternalCustomerStatus,
    serviceKeys: hasStrongAutoPublishServiceEvidence ? evidenceBackedServiceKeys : [],
    identityCorroborated,
    evidenceUrls: [
      record.evidenceUrl,
      effectiveServiceEvidenceUrl,
      effectiveCorroborationEvidenceUrl,
    ].filter((url): url is string => Boolean(url)),
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
      corroborationEvidenceUrl: effectiveCorroborationEvidenceUrl,
      corroborationEvidenceType: effectiveCorroborationEvidenceType,
      serviceEvidenceUrl: effectiveServiceEvidenceUrl,
      serviceEvidenceType: effectiveServiceEvidenceType,
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
          service_evidence_url: isServiceResolution
            ? effectiveServiceEvidenceUrl
            : existingResult?.raw_result?.service_evidence_url ?? null,
          service_evidence_type: isServiceResolution
            ? effectiveServiceEvidenceType
            : existingResult?.raw_result?.service_evidence_type ?? null,
          service_evidence_supports_keys: isServiceResolution
            ? effectiveServiceEvidenceSupportsKeys
            : existingResult?.raw_result?.service_evidence_supports_keys ?? null,
          service_evidence_summary: isServiceResolution
            ? record.serviceEvidenceSummary ?? null
            : existingResult?.raw_result?.service_evidence_summary ?? null,
          corroboration_supports: effectiveCorroborationSupports,
          corroboration_evidence_url: effectiveCorroborationEvidenceUrl,
          corroboration_evidence_type: effectiveCorroborationEvidenceType,
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
    effectiveServiceEvidenceUrl &&
    effectiveServiceEvidenceType
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

  if (
    isServiceResolution &&
    effectiveServiceEvidenceUrl &&
    effectiveServiceEvidenceType
  ) {
    const { data: existingServiceEvidence, error: serviceEvidenceLookupError } =
      await supabase
        .from('evidence')
        .select('id')
        .eq('facility_id', facility.id)
        .eq('supports_field', 'national-enrichment-v1-service')
        .eq('url', effectiveServiceEvidenceUrl)
        .limit(1)

    if (serviceEvidenceLookupError) throw serviceEvidenceLookupError

    if (!existingServiceEvidence?.length) {
      const { error: serviceEvidenceError } = await supabase
        .from('evidence')
        .insert({
          facility_id: facility.id,
          evidence_type: effectiveServiceEvidenceType,
          url: effectiveServiceEvidenceUrl,
          supports_field: 'national-enrichment-v1-service',
          summary:
            record.serviceEvidenceSummary ??
            'Current service-category evidence.',
        })

      if (serviceEvidenceError) throw serviceEvidenceError
    }
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

  if (
    effectiveCorroborationEvidenceUrl &&
    effectiveCorroborationEvidenceType
  ) {
    const { data: existingCorroboration, error: corroborationLookupError } = await supabase
      .from('evidence')
      .select('id')
      .eq('facility_id', facility.id)
      .eq('supports_field', 'national-enrichment-v1-corroboration')
      .eq('url', effectiveCorroborationEvidenceUrl)
      .limit(1)

    if (corroborationLookupError) throw corroborationLookupError

    if (!existingCorroboration?.length) {
      const { error: corroborationError } = await supabase.from('evidence').insert({
        facility_id: facility.id,
        evidence_type: effectiveCorroborationEvidenceType,
        url: effectiveCorroborationEvidenceUrl,
        supports_field: 'national-enrichment-v1-corroboration',
        summary:
          effectiveCorroborationSummary ??
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
