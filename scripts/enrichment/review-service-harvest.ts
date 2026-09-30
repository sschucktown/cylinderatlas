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
  serviceEvidenceSummary?: string | null
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
  serviceEvidenceSummary: string | null
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

function sourceTypeMatchesUrl(
  record: ReviewRecord,
  type: ServiceEvidenceType,
  url: string,
) {
  if (type === 'regulatory') return isGovernmentUrl(url)
  const domain = siteDomain(url)
  return Boolean(domain && providerDomains(record).has(domain))
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
  },
  required: [
    'serviceKeys',
    'serviceConfidence',
    'serviceEvidenceUrl',
    'serviceEvidenceType',
    'serviceEvidenceSupportsKeys',
    'serviceEvidenceSummary',
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

const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2, output: 12 },
}
const WEB_SEARCH_USD_PER_CALL = 0.01

if (!apiKey) {
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
    '- Prefer the provider/company website. A direct current government/regulatory source is also acceptable.',
    '- Do NOT use BBB, Yelp, Yellow Pages, trade/member directories, chambers, social media, SEO directories, or generic directories to clear a service category.',
    '- A web result can NEVER be provider_claim.',
    '- Do NOT infer any use case from PHMSA cylinder specifications, the company name, or generic mentions of cylinders.',
    '- Each returned service key must be explicitly supported by the selected source for this exact current business/facility.',
    '- serviceEvidenceSupportsKeys must contain only keys directly supported by the selected source and must be a subset of serviceKeys.',
    '- If a source discusses several services, include only the Cylinder Atlas taxonomy keys it clearly establishes.',
    '- serviceConfidence must reflect confidence in those exact taxonomy mappings, not confidence that the company exists.',
    '- If no qualifying service evidence is found in the one search, return empty key arrays, confidence 0, and null evidence fields.',
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
      return /\bmedical(?:[-\s]+grade)?[-\s]+(?:oxygen|gas(?:es)?)\b|\bhealthcare\b|\bhospital\b|\bpatient\b/i.test(
        summary,
      )
    case 'co2-beverage':
      return /\bbeverage\b|\bsoda\b|\bdraft\b|\bkeg\b|\brestaurant\b|\bfood[-\s]?service\b/i.test(
        summary,
      )
    case 'paintball':
      return /\bpaintball\b/i.test(summary)
    case 'specialty':
      return /\baviation\b|\baircraft\b|\bmarine\b|\bspecialty cylinder/i.test(
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

  const sourceConsulted = Boolean(url && sourceWasConsulted(url, consulted))
  const sourceBlocked = Boolean(url && isBlockedDirectoryUrl(url))
  const sourceTypeValid = Boolean(
    url && type && sourceTypeMatchesUrl(record, type, url),
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
      serviceEvidenceSummary: null,
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
      serviceEvidenceSummary: summary || null,
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
    serviceEvidenceSummary: summary || null,
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

  return {
    ...record,
    serviceKeys: research.serviceKeys,
    serviceConfidence: research.serviceConfidence,
    serviceEvidenceUrl: research.serviceEvidenceUrl,
    serviceEvidenceType: research.serviceEvidenceType,
    serviceEvidenceSupportsKeys: research.serviceEvidenceSupportsKeys,
    serviceEvidenceSummary: research.serviceEvidenceSummary,
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
      return sanitizeResearch(record, raw, consulted)
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
      if (input.records.some((candidate) => candidate.rin === record.rin)) {
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

await loadCheckpoint()

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
  process.exit(2)
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
