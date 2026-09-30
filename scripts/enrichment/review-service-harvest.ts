import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readFlag, readPositiveIntFlag } from './admin-client'
import type { BusinessStatus, IdentityMatch, ServiceKey } from './types'

type EvidenceType =
  | 'regulatory'
  | 'first_party'
  | 'business_registry'
  | 'directory'
  | 'provider_claim'
  | 'other'

type ServiceEvidenceType = 'regulatory' | 'first_party'
type CorroborationSupport = 'identity' | 'address' | 'business_status'
type ExternalCustomerStatus = 'yes' | 'no' | 'unknown'

interface ReviewRecord {
  rin: string
  phmsaName: string
  phmsaAddress: string
  city: string
  state: string
  postalCode: string | null
  candidateTypeHint: string | null
  identityMatch: IdentityMatch
  businessStatus: BusinessStatus
  servesExternalCustomers: ExternalCustomerStatus
  currentName: string | null
  currentAddress: string | null
  serviceKeys: ServiceKey[]
  serviceConfidence: number
  identityConfidence: number
  evidenceUrl: string | null
  evidenceType: EvidenceType | null
  evidenceSupportsServiceKeys: ServiceKey[]
  evidenceSupportsExternalCustomers: boolean
  serviceEvidenceUrl?: string | null
  serviceEvidenceType?: EvidenceType | null
  serviceEvidenceSupportsKeys?: ServiceKey[]
  serviceEvidenceDeterministicKeys?: ServiceKey[]
  serviceEvidenceSummary?: string | null
  serviceSourceName?: string | null
  serviceSourceAddress?: string | null
  serviceEvidenceValidationReason?: string | null
  serviceEvidenceRejectedUrl?: string | null
  serviceEvidenceRejectedType?: EvidenceType | null
  corroborationEvidenceUrl: string | null
  corroborationEvidenceType: EvidenceType | null
  corroborationSupports: CorroborationSupport[]
  corroborationSummary: string | null
  summary: string
}

interface ReviewPayload {
  runName: string
  batch: string
  complete?: boolean
  evidenceSemanticsVersion?: number
  reviewResolution?: boolean
  sourceBucket?: string
  records: ReviewRecord[]
}

interface ServiceResearch {
  serviceKeys: ServiceKey[]
  serviceConfidence: number
  serviceEvidenceUrl: string | null
  serviceEvidenceType: ServiceEvidenceType | null
  serviceEvidenceSupportsKeys: ServiceKey[]
  serviceEvidenceDeterministicKeys: ServiceKey[]
  serviceEvidenceSummary: string | null
  serviceSourceName: string | null
  serviceSourceAddress: string | null
  serviceEvidenceValidationReason: string | null
  serviceEvidenceRejectedUrl: string | null
  serviceEvidenceRejectedType: EvidenceType | null
}

interface HarvestFailure {
  rin: string
  error: string
}

interface UsageTotals {
  responseCalls: number
  webSearchCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface ServiceHarvestPayload {
  runName: string
  batch: string
  model: string
  generatedAt: string
  complete: boolean
  evidenceSemanticsVersion: 2
  reviewResolution: true
  sourceBucket: 'missing_service_evidence_only'
  estimatedCostUsd: number
  sourceBatch: string
  records: ReviewRecord[]
  failures: HarvestFailure[]
  usage: UsageTotals
}

interface OpenAIResponse {
  status?: string
  output?: Array<Record<string, unknown>>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: { message?: string }
}

const SERVICE_KEYS: ServiceKey[] = [
  'fire-extinguisher-suppression',
  'scuba',
  'scba',
  'propane',
  'industrial-welding-gas',
  'medical-oxygen',
  'co2-beverage',
  'paintball',
  'specialty',
]

const SERVICE_EVIDENCE_TYPES = new Set<ServiceEvidenceType>([
  'first_party',
  'regulatory',
])

const BLOCKED_DIRECTORY_HOSTS = [
  'bbb.org',
  'nafed.org',
  'yelp.com',
  'yellowpages.com',
  'chamberofcommerce.com',
  'sprinklerfitters669.org',
  'iwdc.coop',
  'facebook.com',
  'linkedin.com',
]

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

function isBlockedDirectoryUrl(raw: string | null) {
  const hostname = urlHostname(raw)
  if (!hostname) return true
  return BLOCKED_DIRECTORY_HOSTS.some((domain) =>
    hostnameMatches(hostname, domain),
  )
}

function providerDomains(record: ReviewRecord) {
  const domains = new Set<string>()
  if (record.evidenceType === 'first_party') {
    const domain = siteDomain(record.evidenceUrl)
    if (domain) domains.add(domain)
  }
  if (record.corroborationEvidenceType === 'first_party') {
    const domain = siteDomain(record.corroborationEvidenceUrl)
    if (domain) domains.add(domain)
  }
  return domains
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

function isIdentityOnlyServicePage(raw: string | null | undefined) {
  if (!raw) return false
  try {
    const pathname = new URL(raw).pathname.toLowerCase()
    return /\/(?:contact(?:-us)?|location|locations)\/?$/.test(pathname)
  } catch {
    return false
  }
}

function sourceMatchesExactFacility(
  record: ReviewRecord,
  sourceAddress: string | null,
) {
  const source = normalizeFacilityText(sourceAddress)
  const phmsaStreet = normalizeFacilityText(record.phmsaAddress)
  const city = normalizeFacilityText(record.city)

  return Boolean(
    source &&
      phmsaStreet &&
      source.includes(phmsaStreet) &&
      (!city || source.includes(city)),
  )
}

function sourceTypeMatchesUrl(
  record: ReviewRecord,
  type: ServiceEvidenceType,
  url: string,
  sourceAddress: string | null,
) {
  if (type === 'regulatory') return isGovernmentUrl(url)
  if (isIdentityOnlyServicePage(url)) return false

  const domain = siteDomain(url)
  const knownProviderDomain = Boolean(
    domain && providerDomains(record).has(domain),
  )

  // A first-party domain may be newly discovered during service research only
  // when that same source explicitly identifies the exact already-verified RIN
  // facility. This prevents same-name businesses in other cities from clearing.
  const normalizedDomain = domain?.replace(/[^a-z0-9]/g, '') ?? ''
  const businessTokens = [record.currentName, record.phmsaName]
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
  const domainLooksLikeBusiness = businessTokens.some((token) =>
    normalizedDomain.includes(token),
  )

  return Boolean(
    domain &&
      (knownProviderDomain ||
        (domainLooksLikeBusiness &&
          sourceMatchesExactFacility(record, sourceAddress))),
  )
}

const serviceSchema = {
  type: 'object',
  properties: {
    serviceKeys: {
      type: 'array',
      items: { type: 'string', enum: SERVICE_KEYS },
    },
    serviceConfidence: { type: 'number', minimum: 0, maximum: 1 },
    serviceEvidenceUrl: { type: ['string', 'null'] },
    serviceEvidenceType: {
      type: ['string', 'null'],
      enum: ['first_party', 'regulatory', null],
    },
    serviceEvidenceSupportsKeys: {
      type: 'array',
      items: { type: 'string', enum: SERVICE_KEYS },
    },
    serviceEvidenceSummary: { type: ['string', 'null'] },
    serviceSourceName: { type: ['string', 'null'] },
    serviceSourceAddress: { type: ['string', 'null'] },
  },
  required: [
    'serviceKeys',
    'serviceConfidence',
    'serviceEvidenceUrl',
    'serviceEvidenceType',
    'serviceEvidenceSupportsKeys',
    'serviceEvidenceSummary',
    'serviceSourceName',
    'serviceSourceAddress',
  ],
  additionalProperties: false,
} as const

const inputPath = readFlag('input') ?? process.argv[2]
if (!inputPath) {
  throw new Error(
    'Usage: npm run enrich:review-service-harvest -- --input <review-batch.json> [--output <review-evidence.json>]',
  )
}

const outputPath = readFlag('output') ?? 'tmp/review-service-harvested-batch.json'
const concurrency = Math.min(readPositiveIntFlag('concurrency', 5), 10)
const maxAttempts = Math.min(readPositiveIntFlag('attempts', 3), 5)
const costSampleSize = Math.min(readPositiveIntFlag('cost-sample', 10), 50)
const model = process.env.OPENAI_ENRICHMENT_MODEL ?? 'gpt-6-luna'
const apiKey = process.env.OPENAI_API_KEY
const minRequestIntervalMs = Math.min(
  readPositiveIntFlag(
    'min-request-interval-ms',
    model === 'gpt-6-luna' ? 4500 : 1000,
  ),
  60_000,
)

function readPositiveFloatFlag(name: string, fallback: number) {
  const raw = readFlag(name)
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('--' + name + ' must be a positive number')
  }
  return parsed
}

const maxProjectedCostUsd = readPositiveFloatFlag('max-projected-cost', 2)
const retryUnresolved = process.argv.includes('--retry-unresolved')
const refreshDeterministicOnly = process.argv.includes(
  '--refresh-deterministic-only',
)

const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2, output: 12 },
}
const WEB_SEARCH_USD_PER_CALL = 0.01

if (!apiKey && !refreshDeterministicOnly) {
  throw new Error(
    'Missing OPENAI_API_KEY. It is required for targeted service-evidence research.',
  )
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as ReviewPayload
if (
  !input.runName ||
  !input.batch ||
  !Array.isArray(input.records) ||
  !input.records.length
) {
  throw new Error('Review batch must include runName, batch, and non-empty records[]')
}
if (input.complete === false) {
  throw new Error('Refusing to research an incomplete review batch')
}
if (input.sourceBucket !== 'missing_service_evidence_only') {
  throw new Error(
    'Targeted service harvester only supports missing_service_evidence_only',
  )
}

for (const record of input.records) {
  if (!record.phmsaName || !record.phmsaAddress || !record.city || !record.state) {
    throw new Error(
      'Review batch is missing PHMSA facility fields. Re-export it with enrich:review-next.',
    )
  }
}

const batch =
  readFlag('batch') ??
  'review-service-harvest-' + input.batch.replace(/^review-/, '')

const recordByRin = new Map<string, ReviewRecord>()
const failureByRin = new Map<string, HarvestFailure>()
const usage: UsageTotals = {
  responseCalls: 0,
  webSearchCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

function estimateCostUsd(totals: UsageTotals) {
  const rates = MODEL_PRICING_USD_PER_MTOK[model]
  if (!rates) return Number.NaN
  return (
    (totals.inputTokens / 1_000_000) * rates.input +
    (totals.outputTokens / 1_000_000) * rates.output +
    totals.webSearchCalls * WEB_SEARCH_USD_PER_CALL
  )
}

function roundUsd(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : value
}

function normalizeUrl(raw: string) {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
    ]) {
      url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return raw.trim()
  }
}

function buildPrompt(record: ReviewRecord) {
  return [
    'Research ONLY current service-category evidence for this already identity-verified U.S. DOT cylinder requalification facility.',
    '',
    'RIN: ' + record.rin,
    'PHMSA name: ' + record.phmsaName,
    'PHMSA address: ' + record.phmsaAddress,
    'PHMSA city/state/postal: ' +
      record.city +
      ', ' +
      record.state +
      ' ' +
      (record.postalCode ?? ''),
    'Verified current name: ' + (record.currentName ?? 'unknown'),
    'Verified current address: ' + (record.currentAddress ?? 'unknown'),
    'Previously extracted service hints: ' +
      (record.serviceKeys.length ? record.serviceKeys.join(', ') : 'none'),
    'Existing primary evidence URL: ' + (record.evidenceUrl ?? 'none'),
    'Existing primary evidence type: ' + (record.evidenceType ?? 'none'),
    'Existing explicitly supported service keys: ' +
      (record.evidenceSupportsServiceKeys.length
        ? record.evidenceSupportsServiceKeys.join(', ')
        : 'none'),
    'Existing service confidence: ' + record.serviceConfidence.toFixed(2),
    'Existing evidence summary: ' + (record.summary || 'none'),
    '',
    'Identity, active-business status, and outside-customer access are already established. Do NOT reinterpret or change them. Research only which Cylinder Atlas service categories are explicitly supported for this exact facility/business.',
    '',
    'MVP service keys:',
    '- fire-extinguisher-suppression: fire extinguisher or suppression-system inspection, recharge, service, testing, repair, or related customer service.',
    '- scuba: explicitly SCUBA/dive cylinders or dive-gas cylinder service.',
    '- scba: explicitly SCBA/self-contained breathing-apparatus cylinders or service.',
    '- propane: explicitly propane/LPG cylinder filling, service, testing, or requalification.',
    '- industrial-welding-gas: explicitly industrial/welding gas cylinders or gases such as argon, acetylene, nitrogen, or welding oxygen.',
    '- medical-oxygen: explicitly medical/healthcare/patient oxygen or medical gas cylinders. Generic oxygen or aircraft oxygen is NOT medical oxygen.',
    '- co2-beverage: explicitly beverage/restaurant/draft/keg/soda CO2. Generic CO2 alone is NOT enough.',
    '- paintball: explicitly paintball cylinders/tanks.',
    '- specialty: explicitly aviation, aircraft, marine, or other specialty cylinder service tied to that use case.',
    '',
    'Research requirements:',
    '- Perform exactly ONE web search call. Use only sources returned by that search.',
    '- Anchor the search on the exact business name, PHMSA street address, city/state, and likely service term (for example hydrostatic testing, extinguisher, SCUBA, SCBA, propane, welding gas, medical oxygen, beverage CO2, paintball, aviation, or marine). Do not search by business name alone.',
    '- Prefer the provider/company website. A direct current government/regulatory source is also acceptable.',
    '- If the existing primary evidence URL is first-party or regulatory and already appears to support one or more service hints, prioritize verifying that exact page/domain before looking elsewhere.',
    '- Return ALL MVP service keys clearly supported by the selected source, not just the first matching category.',
    '- If you select a first-party website that is not already present in the existing evidence packet, the selected page must itself identify this exact facility address. Return that page’s business name and address in serviceSourceName/serviceSourceAddress.',
    '- Do NOT use BBB, Yelp, Yellow Pages, trade/member directories, chambers, social media, SEO directories, or generic directories to clear a service category.',
    '- A web result can NEVER be provider_claim.',
    '- Do NOT infer any use case from PHMSA cylinder specifications, the company name, or generic mentions of cylinders.',
    '- Each returned service key must be explicitly supported by the selected source for this exact current business/facility.',
    '- serviceEvidenceSupportsKeys must contain only keys directly supported by the selected source and must be a subset of serviceKeys.',
    '- If a source discusses several services, include only the Cylinder Atlas taxonomy keys it clearly establishes.',
    '- serviceConfidence must reflect confidence in those exact taxonomy mappings, not confidence that the company exists.',
    '- If no qualifying service evidence is found in the one search, return empty key arrays, confidence 0, and null evidence fields.',
    '- serviceSourceName and serviceSourceAddress must be copied/extracted from the selected source when present; do not infer them from the prompt.',
    '- For same-name businesses in another city/state, return no service evidence.',
    '- URLs must be exact URLs actually consulted in web search. Do not invent or rewrite URLs.',
    '',
    'Precision is more important than recall. Review is preferable to a false service category.',
  ].join('\n')
}

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const content of item.content as Array<Record<string, unknown>>) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text
      }
    }
  }
  throw new Error('OpenAI response did not contain output_text')
}

function extractSearchSources(response: OpenAIResponse) {
  const urls = new Set<string>()
  for (const item of response.output ?? []) {
    if (item.type !== 'web_search_call') continue
    const action = item.action as Record<string, unknown> | undefined
    const sources = action?.sources
    if (!Array.isArray(sources)) continue
    for (const source of sources as Array<Record<string, unknown>>) {
      if (typeof source.url === 'string') urls.add(source.url)
    }
  }
  return urls
}

function canonicalConsultedKey(raw: string) {
  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname =
      (url.pathname.replace(/\/+$/, '') || '/').toLowerCase()
    return hostname + pathname
  } catch {
    return normalizeUrl(raw)
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  }
}

function sourceWasConsulted(url: string | null, consulted: Set<string>) {
  if (!url) return false
  const key = canonicalConsultedKey(url)
  return [...consulted].some(
    (source) => canonicalConsultedKey(source) === key,
  )
}

function clampConfidence(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(Math.max(parsed, 0), 1)
}

function isServiceKey(value: unknown): value is ServiceKey {
  return SERVICE_KEYS.includes(value as ServiceKey)
}

function isServiceEvidenceType(value: unknown): value is ServiceEvidenceType {
  return (
    typeof value === 'string' &&
    SERVICE_EVIDENCE_TYPES.has(value as ServiceEvidenceType)
  )
}

function highSpecificitySupported(key: ServiceKey, summary: string) {
  switch (key) {
    case 'fire-extinguisher-suppression':
      return /\bfire\b.{0,50}\b(?:extinguisher|suppression)\b|\b(?:extinguisher|suppression)\b.{0,50}\bfire\b/i.test(
        summary,
      )
    case 'scuba':
      return /\bscuba\b|\bdive\b|\bdiving\b/i.test(summary)
    case 'scba':
      return /\bscba\b|self[-\s]?contained breathing apparatus/i.test(summary)
    case 'propane':
      return /\bpropane\b|\blpg\b/i.test(summary)
    case 'industrial-welding-gas':
      return /\bindustrial gas(?:es)?\b|\bwelding gas(?:es)?\b|\bargon\b|\bacetylene\b|\bwelding oxygen\b/i.test(
        summary,
      )
    case 'medical-oxygen':
      return /\bmedical(?:[-\s]+grade)?[-\s]+(?:oxygen|o2)\b|\b(?:oxygen|o2)\b.{0,50}\b(?:medical|healthcare|hospital|patient)\b|\b(?:medical|healthcare|hospital|patient)\b.{0,50}\b(?:oxygen|o2)\b/i.test(
        summary,
      )
    case 'co2-beverage':
      return /\bco2\b.{0,60}\b(?:beverage|soda|draft|keg|restaurant|food[-\s]?service)\b|\b(?:beverage|soda|draft|keg|restaurant|food[-\s]?service)\b.{0,60}\bco2\b/i.test(
        summary,
      )
    case 'paintball':
      return /\bpaintball\b/i.test(summary)
    case 'specialty':
      return /\baviation\b|\baircraft\b|\bmarine\b/i.test(
        summary,
      )
  }
}

function sanitizeResearch(
  record: ReviewRecord,
  raw: Record<string, unknown>,
  consulted: Set<string>,
): ServiceResearch {
  const url =
    typeof raw.serviceEvidenceUrl === 'string' ? raw.serviceEvidenceUrl : null
  const type = isServiceEvidenceType(raw.serviceEvidenceType)
    ? raw.serviceEvidenceType
    : null
  const summary =
    typeof raw.serviceEvidenceSummary === 'string'
      ? raw.serviceEvidenceSummary
      : ''
  const sourceName =
    typeof raw.serviceSourceName === 'string' ? raw.serviceSourceName : null
  const sourceAddress =
    typeof raw.serviceSourceAddress === 'string'
      ? raw.serviceSourceAddress
      : null

  const sourceConsulted = Boolean(url && sourceWasConsulted(url, consulted))
  const sourceBlocked = Boolean(url && isBlockedDirectoryUrl(url))
  const sourceTypeValid = Boolean(
    url && type && sourceTypeMatchesUrl(record, type, url, sourceAddress),
  )
  const validSource = Boolean(
    url && type && sourceConsulted && !sourceBlocked && sourceTypeValid,
  )

  if (!validSource) {
    const reason = !url
      ? 'model_returned_no_url'
      : !type
        ? 'model_returned_invalid_type'
        : !sourceConsulted
          ? 'selected_url_not_in_consulted_sources'
          : sourceBlocked
            ? 'blocked_directory_source'
            : !sourceTypeValid
              ? 'source_type_or_provider_domain_mismatch'
              : 'unknown_source_validation_failure'

    return {
      serviceKeys: [],
      serviceConfidence: 0,
      serviceEvidenceUrl: null,
      serviceEvidenceType: null,
      serviceEvidenceSupportsKeys: [],
      serviceEvidenceDeterministicKeys: [],
      serviceEvidenceSummary: summary || null,
      serviceSourceName: sourceName,
      serviceSourceAddress: sourceAddress,
      serviceEvidenceValidationReason: reason,
      serviceEvidenceRejectedUrl: url,
      serviceEvidenceRejectedType: type,
    }
  }

  const keys = Array.isArray(raw.serviceKeys)
    ? raw.serviceKeys.filter(isServiceKey)
    : []
  const supports = Array.isArray(raw.serviceEvidenceSupportsKeys)
    ? raw.serviceEvidenceSupportsKeys.filter(isServiceKey)
    : []
  const supported = [...new Set(keys)]
    .filter((key) => supports.includes(key))
    .filter((key) => highSpecificitySupported(key, summary))

  if (!supported.length) {
    return {
      serviceKeys: [],
      serviceConfidence: 0,
      serviceEvidenceUrl: url,
      serviceEvidenceType: type,
      serviceEvidenceSupportsKeys: [],
      serviceEvidenceDeterministicKeys: [],
      serviceEvidenceSummary: summary || null,
      serviceSourceName: sourceName,
      serviceSourceAddress: sourceAddress,
      serviceEvidenceValidationReason: 'no_supported_taxonomy_keys',
      serviceEvidenceRejectedUrl: null,
      serviceEvidenceRejectedType: null,
    }
  }

  return {
    serviceKeys: supported,
    serviceConfidence: clampConfidence(raw.serviceConfidence),
    serviceEvidenceUrl: url,
    serviceEvidenceType: type,
    serviceEvidenceSupportsKeys: supported,
    serviceEvidenceDeterministicKeys: [],
    serviceEvidenceSummary: summary || null,
    serviceSourceName: sourceName,
    serviceSourceAddress: sourceAddress,
    serviceEvidenceValidationReason: null,
    serviceEvidenceRejectedUrl: null,
    serviceEvidenceRejectedType: null,
  }
}

function mergeRecord(record: ReviewRecord, research: ServiceResearch) {
  const summaryParts = [record.summary]
  if (research.serviceEvidenceSummary) {
    summaryParts.push(
      'Service-resolution evidence: ' + research.serviceEvidenceSummary,
    )
  }

  const researchResolved =
    Boolean(research.serviceEvidenceUrl) &&
    research.serviceEvidenceSupportsKeys.length > 0

  return {
    ...record,
    serviceKeys: researchResolved ? research.serviceKeys : record.serviceKeys,
    serviceConfidence: researchResolved
      ? research.serviceConfidence
      : record.serviceConfidence,
    serviceEvidenceUrl: research.serviceEvidenceUrl,
    serviceEvidenceType: research.serviceEvidenceType,
    serviceEvidenceSupportsKeys: research.serviceEvidenceSupportsKeys,
    serviceEvidenceDeterministicKeys:
      research.serviceEvidenceDeterministicKeys,
    serviceEvidenceSummary: research.serviceEvidenceSummary,
    serviceSourceName: research.serviceSourceName,
    serviceSourceAddress: research.serviceSourceAddress,
    serviceEvidenceValidationReason: research.serviceEvidenceValidationReason,
    serviceEvidenceRejectedUrl: research.serviceEvidenceRejectedUrl,
    serviceEvidenceRejectedType: research.serviceEvidenceRejectedType,
    summary: summaryParts.filter(Boolean).join(' '),
  } satisfies ReviewRecord
}

function addUsage(response: OpenAIResponse) {
  usage.responseCalls += 1
  usage.webSearchCalls += (response.output ?? []).filter(
    (item) => item.type === 'web_search_call',
  ).length
  usage.inputTokens += response.usage?.input_tokens ?? 0
  usage.outputTokens += response.usage?.output_tokens ?? 0
  usage.totalTokens += response.usage?.total_tokens ?? 0
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseResetDurationMs(raw: string | null) {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  const milliseconds = trimmed.match(/^(\d+(?:\.\d+)?)ms$/)
  if (milliseconds) return Math.ceil(Number(milliseconds[1]) + 250)
  const seconds = trimmed.match(/^(\d+(?:\.\d+)?)s$/)
  if (seconds) return Math.ceil(Number(seconds[1]) * 1000 + 250)
  return null
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000 + 250)
    const retryDate = Date.parse(retryAfter)
    if (Number.isFinite(retryDate)) {
      return Math.max(retryDate - Date.now() + 250, 250)
    }
  }

  const tokenReset = parseResetDurationMs(
    response.headers.get('x-ratelimit-reset-tokens'),
  )
  if (tokenReset !== null) return tokenReset
  return 1000 * 2 ** (attempt - 1) + 250
}

let requestGate = Promise.resolve()
let nextRequestAt = 0
let sharedBackoffUntil = 0

async function waitForRequestSlot() {
  requestGate = requestGate.then(async () => {
    const waitUntil = Math.max(nextRequestAt, sharedBackoffUntil)
    const delay = waitUntil - Date.now()
    if (delay > 0) await sleep(delay)
    nextRequestAt = Date.now() + minRequestIntervalMs
  })
  await requestGate
}

function htmlToVisibleText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function attachDeterministicServiceKeys(research: ServiceResearch) {
  if (
    research.serviceEvidenceType !== 'first_party' ||
    !research.serviceEvidenceUrl ||
    !research.serviceEvidenceSupportsKeys.length
  ) {
    return research
  }

  try {
    const response = await fetch(research.serviceEvidenceUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CylinderAtlasEvidenceBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10_000),
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.toLowerCase().includes('text/html')) {
      return research
    }

    const text = htmlToVisibleText(await response.text())
    return {
      ...research,
      serviceEvidenceDeterministicKeys:
        research.serviceEvidenceSupportsKeys.filter((key) =>
          highSpecificitySupported(key, text),
        ),
    }
  } catch {
    return research
  }
}

async function researchRecord(record: ReviewRecord) {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let successfulResponseReceived = false
    try {
      await waitForRequestSlot()

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: 'none' },
          max_tool_calls: 1,
          max_output_tokens: 600,
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
          text: {
            format: {
              type: 'json_schema',
              name: 'cylinder_atlas_service_evidence',
              strict: true,
              schema: serviceSchema,
            },
          },
          input: [
            {
              role: 'system',
              content:
                'You are a precision-first service evidence researcher. Return only service categories explicitly supported for the exact current facility.',
            },
            { role: 'user', content: buildPrompt(record) },
          ],
        }),
      })

      const body = (await response.json()) as OpenAIResponse

      if (!response.ok) {
        const message = body.error?.message ?? 'OpenAI HTTP ' + response.status
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < maxAttempts
        ) {
          const delay = retryDelayMs(response, attempt)
          sharedBackoffUntil = Math.max(sharedBackoffUntil, Date.now() + delay)
          continue
        }
        throw new Error(message)
      }

      addUsage(body)
      successfulResponseReceived = true

      if (body.status && body.status !== 'completed') {
        throw new Error('OpenAI response status was ' + body.status)
      }

      const raw = JSON.parse(extractOutputText(body)) as Record<string, unknown>
      const consulted = extractSearchSources(body)
      const sanitized = sanitizeResearch(record, raw, consulted)
      return await attachDeterministicServiceKeys(sanitized)
    } catch (error) {
      lastError = error
      if (successfulResponseReceived) break
      if (attempt < maxAttempts) {
        await sleep(500 * 2 ** (attempt - 1))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const current = nextIndex
        nextIndex += 1
        if (current >= items.length) return
        await worker(items[current]!)
      }
    },
  )
  await Promise.all(workers)
}

function createPayload(complete: boolean): ServiceHarvestPayload {
  const records = input.records
    .map((record) => recordByRin.get(record.rin))
    .filter((record): record is ReviewRecord => Boolean(record))
  const failures = input.records
    .map((record) => failureByRin.get(record.rin))
    .filter((failure): failure is HarvestFailure => Boolean(failure))

  return {
    runName: input.runName,
    batch,
    model,
    generatedAt: new Date().toISOString(),
    complete,
    evidenceSemanticsVersion: 2,
    reviewResolution: true,
    sourceBucket: 'missing_service_evidence_only',
    estimatedCostUsd: roundUsd(estimateCostUsd(usage)),
    sourceBatch: input.batch,
    records,
    failures,
    usage: { ...usage },
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = path + '.tmp'
  await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n')
  await rename(tempPath, path)
}

async function loadCheckpoint() {
  try {
    const existing = JSON.parse(
      await readFile(outputPath, 'utf8'),
    ) as ServiceHarvestPayload
    const sameBatch =
      existing.runName === input.runName &&
      existing.sourceBatch === input.batch &&
      existing.batch === batch

    if (!sameBatch) return

    for (const record of existing.records ?? []) {
      if (!input.records.some((candidate) => candidate.rin === record.rin)) {
        continue
      }

      const resolved =
        Boolean(record.serviceEvidenceUrl) &&
        Boolean(
          record.serviceEvidenceType &&
            SERVICE_EVIDENCE_TYPES.has(
              record.serviceEvidenceType as ServiceEvidenceType,
            ),
        ) &&
        (record.serviceEvidenceSupportsKeys?.length ?? 0) > 0 &&
        record.serviceConfidence >= 0.85

      if (!retryUnresolved || resolved) {
        recordByRin.set(record.rin, record)
      }
    }

    usage.responseCalls = existing.usage?.responseCalls ?? 0
    usage.webSearchCalls = existing.usage?.webSearchCalls ?? 0
    usage.inputTokens = existing.usage?.inputTokens ?? 0
    usage.outputTokens = existing.usage?.outputTokens ?? 0
    usage.totalTokens = existing.usage?.totalTokens ?? 0
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
}

let checkpointChain = Promise.resolve()

function scheduleCheckpoint() {
  checkpointChain = checkpointChain.then(() =>
    writeJsonAtomic(outputPath, createPayload(false)),
  )
  return checkpointChain
}

mainFlow: {
await loadCheckpoint()

if (refreshDeterministicOnly) {
  const refreshed: ReviewRecord[] = []

  for (const inputRecord of input.records) {
    const record = recordByRin.get(inputRecord.rin) ?? inputRecord
    const type = isServiceEvidenceType(record.serviceEvidenceType)
      ? record.serviceEvidenceType
      : null

    const research: ServiceResearch = {
      serviceKeys: record.serviceKeys,
      serviceConfidence: record.serviceConfidence,
      serviceEvidenceUrl: record.serviceEvidenceUrl ?? null,
      serviceEvidenceType: type,
      serviceEvidenceSupportsKeys: record.serviceEvidenceSupportsKeys ?? [],
      serviceEvidenceDeterministicKeys: [],
      serviceEvidenceSummary: record.serviceEvidenceSummary ?? null,
      serviceSourceName: record.serviceSourceName ?? null,
      serviceSourceAddress: record.serviceSourceAddress ?? null,
      serviceEvidenceValidationReason:
        record.serviceEvidenceValidationReason ?? null,
      serviceEvidenceRejectedUrl: record.serviceEvidenceRejectedUrl ?? null,
      serviceEvidenceRejectedType:
        record.serviceEvidenceRejectedType ?? null,
    }

    const verified = await attachDeterministicServiceKeys(research)
    const updated: ReviewRecord = {
      ...record,
      serviceEvidenceDeterministicKeys:
        verified.serviceEvidenceDeterministicKeys,
    }
    recordByRin.set(updated.rin, updated)
    refreshed.push(updated)
  }

  failureByRin.clear()
  await writeJsonAtomic(outputPath, createPayload(true))

  console.log(
    JSON.stringify(
      {
        run: input.runName,
        batch,
        output: outputPath,
        records: refreshed.length,
        refreshDeterministicOnly: true,
        firstPartyVerified: refreshed.filter(
          (record) =>
            record.serviceEvidenceType === 'first_party' &&
            (record.serviceEvidenceDeterministicKeys?.length ?? 0) > 0,
        ).length,
        openAiCalls: 0,
        webSearchCalls: 0,
      },
      null,
      2,
    ),
  )
  break mainFlow
}

const pendingRecords = input.records.filter(
  (record) => !recordByRin.has(record.rin),
)
const resumedCount = input.records.length - pendingRecords.length

await writeJsonAtomic(outputPath, createPayload(false))

async function harvestRecords(records: ReviewRecord[]) {
  await runWithConcurrency(records, concurrency, async (record) => {
    try {
      const research = await researchRecord(record)
      recordByRin.set(record.rin, mergeRecord(record, research))
      failureByRin.delete(record.rin)
    } catch (error) {
      failureByRin.set(record.rin, {
        rin: record.rin,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    await scheduleCheckpoint()

    console.log(
      JSON.stringify({
        rin: record.rin,
        completed: recordByRin.size,
        failed: failureByRin.size,
        total: input.records.length,
        estimatedCostUsd: roundUsd(estimateCostUsd(usage)),
      }),
    )
  })
}

const sampleRecords = pendingRecords.slice(0, costSampleSize)
const remainingRecords = pendingRecords.slice(sampleRecords.length)
const recordsBeforeSample = recordByRin.size
const failuresBeforeSample = failureByRin.size
const costBeforeSample = estimateCostUsd(usage)

await harvestRecords(sampleRecords)
await checkpointChain

const sampleSuccesses = recordByRin.size - recordsBeforeSample
const sampleFailures = failureByRin.size - failuresBeforeSample
const sampleCostUsd = estimateCostUsd(usage) - costBeforeSample
const projectedCostUsd =
  sampleRecords.length > 0 && Number.isFinite(sampleCostUsd)
    ? costBeforeSample +
      (sampleCostUsd / sampleRecords.length) * pendingRecords.length
    : Number.NaN

if (
  remainingRecords.length > 0 &&
  (sampleSuccesses === 0 ||
    (Number.isFinite(projectedCostUsd) &&
      projectedCostUsd > maxProjectedCostUsd))
) {
  await writeJsonAtomic(outputPath, createPayload(false))
  const firstFailure = [...failureByRin.values()][0]?.error ?? null
  console.error(
    JSON.stringify(
      {
        stopped:
          sampleSuccesses === 0
            ? 'sample_health_check_failed'
            : 'projected_cost_limit',
        model,
        sampled: sampleRecords.length,
        sampleSuccesses,
        sampleFailures,
        sampleCostUsd: roundUsd(sampleCostUsd),
        projectedCostUsd: roundUsd(projectedCostUsd),
        maxProjectedCostUsd,
        firstFailure,
        output: outputPath,
      },
      null,
      2,
    ),
  )
  process.exitCode = 2
  break mainFlow
}

await harvestRecords(remainingRecords)
await checkpointChain

const complete =
  recordByRin.size === input.records.length && failureByRin.size === 0
await writeJsonAtomic(outputPath, createPayload(complete))

const serviceResolved = [...recordByRin.values()].filter(
  (record) =>
    Boolean(record.serviceEvidenceUrl) &&
    Boolean(
      record.serviceEvidenceType &&
        SERVICE_EVIDENCE_TYPES.has(
          record.serviceEvidenceType as ServiceEvidenceType,
        ),
    ) &&
    (record.serviceEvidenceSupportsKeys?.length ?? 0) > 0 &&
    record.serviceConfidence >= 0.85,
).length

console.log(
  JSON.stringify(
    {
      run: input.runName,
      batch,
      model,
      output: outputPath,
      records: input.records.length,
      resumed: resumedCount,
      retryUnresolved,
      harvested: recordByRin.size,
      serviceResolved,
      unresolved: recordByRin.size - serviceResolved,
      failures: failureByRin.size,
      complete,
      estimatedCostUsd: roundUsd(estimateCostUsd(usage)),
      sample: {
        size: sampleRecords.length,
        successes: sampleSuccesses,
        failures: sampleFailures,
        costUsd: roundUsd(sampleCostUsd),
        projectedCostUsd: roundUsd(projectedCostUsd),
        maxProjectedCostUsd,
      },
      usage,
    },
    null,
    2,
  ),
)
}
