import { createAdminClient } from '../enrichment/admin-client'

type EvidenceType =
  | 'regulatory'
  | 'first_party'
  | 'business_registry'
  | 'directory'
  | 'provider_claim'
  | 'other'

type Purpose = 'identity' | 'service' | 'provider_website'

type Facility = {
  id: string
  rin: string
  website_url: string | null
  enrichment_run_id: string | null
  verified_at: string | null
}

type EvidenceRow = {
  facility_id: string
  evidence_type: EvidenceType
  url: string | null
  supports_field: string
  captured_at: string
}

type EnrichmentResult = {
  facility_id: string
  run_id: string
  checked_at: string
  raw_result: unknown
}

type PublicSource = {
  facility_id: string
  purpose: Purpose
  source_type: EvidenceType
  url: string
  label: string
  verified_at: string
}

const SERVICE_SOURCE_TYPES = new Set<EvidenceType>([
  'first_party',
  'regulatory',
  'provider_claim',
])

const IDENTITY_SOURCE_TYPES = new Set<EvidenceType>([
  'first_party',
  'regulatory',
  'business_registry',
  'provider_claim',
])

const supabase = createAdminClient()
const dryRun = process.argv.includes('--dry-run')

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function evidenceType(value: unknown): EvidenceType | null {
  const normalized = stringValue(value)
  if (
    normalized === 'regulatory' ||
    normalized === 'first_party' ||
    normalized === 'business_registry' ||
    normalized === 'directory' ||
    normalized === 'provider_claim' ||
    normalized === 'other'
  ) {
    return normalized
  }
  return null
}

function normalizedUrl(value: string | null) {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function websiteIdentity(value: string) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return {
    host,
    origin: url.protocol + '//' + url.host,
  }
}

function sourceLabel(purpose: Purpose, type: EvidenceType) {
  if (purpose === 'provider_website') return 'Provider website'

  const prefix = purpose === 'identity' ? 'Identity source' : 'Service source'
  if (type === 'first_party') return prefix + ' — provider website'
  if (type === 'regulatory') return prefix + ' — regulatory record'
  if (type === 'business_registry') return prefix + ' — business registry'
  if (type === 'provider_claim') return prefix + ' — provider confirmed'
  return prefix
}

function addSource(
  target: Map<string, PublicSource>,
  source: Omit<PublicSource, 'label'>,
) {
  const url = normalizedUrl(source.url)
  if (!url) return

  const row: PublicSource = {
    ...source,
    url,
    label: sourceLabel(source.purpose, source.source_type),
  }
  target.set(row.purpose + '|' + row.url, row)
}

const facilitiesResult = await supabase
  .from('facilities')
  .select('id, rin, website_url, enrichment_run_id, verified_at')
  .eq('publish_status', 'publish')
  .order('rin')
  .limit(5000)

if (facilitiesResult.error) throw facilitiesResult.error

const facilities = (facilitiesResult.data ?? []) as Facility[]
const facilityIds = facilities.map((facility) => facility.id)

const [resultsResult, evidenceResult] = await Promise.all([
  supabase
    .from('facility_enrichment_results')
    .select('facility_id, run_id, checked_at, raw_result')
    .in('facility_id', facilityIds)
    .limit(5000),
  supabase
    .from('evidence')
    .select('facility_id, evidence_type, url, supports_field, captured_at')
    .in('facility_id', facilityIds)
    .not('url', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(10000),
])

if (resultsResult.error) throw resultsResult.error
if (evidenceResult.error) throw evidenceResult.error

const results = (resultsResult.data ?? []) as EnrichmentResult[]
const evidence = (evidenceResult.data ?? []) as EvidenceRow[]

const resultByFacility = new Map<string, EnrichmentResult>()
for (const facility of facilities) {
  const result = results.find(
    (candidate) =>
      candidate.facility_id === facility.id &&
      candidate.run_id === facility.enrichment_run_id,
  )
  if (result) resultByFacility.set(facility.id, result)
}

const evidenceByFacility = new Map<string, EvidenceRow[]>()
for (const row of evidence) {
  evidenceByFacility.set(row.facility_id, [
    ...(evidenceByFacility.get(row.facility_id) ?? []),
    row,
  ])
}

const publicSources: PublicSource[] = []
const websiteUpdates: Array<{ id: string; rin: string; website_url: string }> = []
const websiteConflicts: Array<{ rin: string; hosts: string[] }> = []

for (const facility of facilities) {
  const sources = new Map<string, PublicSource>()
  const result = resultByFacility.get(facility.id)
  const raw = asRecord(result?.raw_result)
  const verifiedAt = result?.checked_at ?? facility.verified_at ?? new Date().toISOString()

  const serviceUrl =
    stringValue(raw.service_evidence_url) ?? stringValue(raw.evidence_url)
  const serviceType =
    evidenceType(raw.service_evidence_type) ?? evidenceType(raw.evidence_type)

  if (serviceUrl && serviceType && SERVICE_SOURCE_TYPES.has(serviceType)) {
    addSource(sources, {
      facility_id: facility.id,
      purpose: 'service',
      source_type: serviceType,
      url: serviceUrl,
      verified_at: verifiedAt,
    })
  }

  const identityUrl = stringValue(raw.corroboration_evidence_url)
  const identityType = evidenceType(raw.corroboration_evidence_type)

  if (identityUrl && identityType && IDENTITY_SOURCE_TYPES.has(identityType)) {
    addSource(sources, {
      facility_id: facility.id,
      purpose: 'identity',
      source_type: identityType,
      url: identityUrl,
      verified_at: verifiedAt,
    })
  }

  const fallbackRows = evidenceByFacility.get(facility.id) ?? []

  if (![...sources.values()].some((source) => source.purpose === 'identity')) {
    const identityFallback =
      fallbackRows.find(
        (row) =>
          row.supports_field.includes('corroboration') &&
          IDENTITY_SOURCE_TYPES.has(row.evidence_type) &&
          normalizedUrl(row.url),
      ) ??
      fallbackRows.find(
        (row) =>
          (row.evidence_type === 'business_registry' ||
            row.evidence_type === 'regulatory' ||
            row.evidence_type === 'first_party') &&
          normalizedUrl(row.url),
      )

    if (identityFallback?.url) {
      addSource(sources, {
        facility_id: facility.id,
        purpose: 'identity',
        source_type: identityFallback.evidence_type,
        url: identityFallback.url,
        verified_at: identityFallback.captured_at,
      })
    }
  }

  if (![...sources.values()].some((source) => source.purpose === 'service')) {
    const serviceFallback = fallbackRows.find(
      (row) =>
        !row.supports_field.includes('corroboration') &&
        SERVICE_SOURCE_TYPES.has(row.evidence_type) &&
        normalizedUrl(row.url),
    )

    if (serviceFallback?.url) {
      addSource(sources, {
        facility_id: facility.id,
        purpose: 'service',
        source_type: serviceFallback.evidence_type,
        url: serviceFallback.url,
        verified_at: serviceFallback.captured_at,
      })
    }
  }

  const firstPartySources = [...sources.values()].filter(
    (source) => source.source_type === 'first_party',
  )
  const websiteCandidates = new Map<string, string>()

  for (const source of firstPartySources) {
    const identity = websiteIdentity(source.url)
    websiteCandidates.set(identity.host, identity.origin)
  }

  if (websiteCandidates.size === 1) {
    const websiteUrl = [...websiteCandidates.values()][0]!
    addSource(sources, {
      facility_id: facility.id,
      purpose: 'provider_website',
      source_type: 'first_party',
      url: websiteUrl,
      verified_at: verifiedAt,
    })

    if (!facility.website_url) {
      websiteUpdates.push({
        id: facility.id,
        rin: facility.rin,
        website_url: websiteUrl,
      })
    }
  } else if (websiteCandidates.size > 1) {
    websiteConflicts.push({
      rin: facility.rin,
      hosts: [...websiteCandidates.keys()].sort(),
    })
  }

  publicSources.push(...sources.values())
}

const summary = {
  publishedFacilities: facilities.length,
  publicSourceRows: publicSources.length,
  facilitiesWithPublicSources: new Set(
    publicSources.map((source) => source.facility_id),
  ).size,
  websiteUpdates: websiteUpdates.length,
  websiteConflicts: websiteConflicts.length,
  dryRun,
}

if (dryRun) {
  console.log(JSON.stringify({ ...summary, conflicts: websiteConflicts }, null, 2))
  process.exitCode = 0
} else {
  for (let index = 0; index < facilityIds.length; index += 200) {
    const ids = facilityIds.slice(index, index + 200)
    const deleteResult = await supabase
      .from('facility_public_sources')
      .delete()
      .in('facility_id', ids)

    if (deleteResult.error) throw deleteResult.error
  }

  for (let index = 0; index < publicSources.length; index += 500) {
    const rows = publicSources.slice(index, index + 500)
    const insertResult = await supabase.from('facility_public_sources').insert(rows)
    if (insertResult.error) throw insertResult.error
  }

  const workers = Array.from({ length: 10 }, async (_, workerIndex) => {
    for (
      let index = workerIndex;
      index < websiteUpdates.length;
      index += 10
    ) {
      const update = websiteUpdates[index]!
      const updateResult = await supabase
        .from('facilities')
        .update({ website_url: update.website_url })
        .eq('id', update.id)
        .is('website_url', null)

      if (updateResult.error) throw updateResult.error
    }
  })

  await Promise.all(workers)

  console.log(JSON.stringify({ ...summary, conflicts: websiteConflicts }, null, 2))
}
