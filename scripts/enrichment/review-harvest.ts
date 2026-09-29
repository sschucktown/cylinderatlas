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

type StrongCorroborationType =
  | 'regulatory'
  | 'first_party'
  | 'business_registry'

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

interface IdentityResearch {
  identityMatch: IdentityMatch
  businessStatus: BusinessStatus
  currentName: string | null
  currentAddress: string | null
  identityConfidence: number
  corroborationEvidenceUrl: string | null
  corroborationEvidenceType: StrongCorroborationType | null
  corroborationSupports: CorroborationSupport[]
  corroborationSummary: string | null
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

interface ReviewHarvestPayload {
  runName: string
  batch: string
  model: string
  generatedAt: string
  complete: boolean
  evidenceSemanticsVersion: 2
  reviewResolution: true
  sourceBucket: string | null
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
  error?: {
    message?: string
  }
}

const STRONG_CORROBORATION_TYPES = new Set<StrongCorroborationType>([
  'regulatory',
  'first_party',
  'business_registry',
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

function isBlockedDirectoryUrl(raw: string | null) {
  if (!raw) return false
  try {
    const hostname = new URL(raw).hostname.toLowerCase()
    return BLOCKED_DIRECTORY_HOSTS.some((domain) =>
      hostnameMatches(hostname, domain),
    )
  } catch {
    return true
  }
}

const TRUSTED_NON_GOV_REGISTRY_HOSTS = ['sunbiz.org']

function urlHostname(raw: string | null | undefined) {
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isGovernmentUrl(raw: string | null | undefined) {
  const hostname = urlHostname(raw)
  return Boolean(
    hostname &&
      (hostname === 'gov' ||
        hostname.endsWith('.gov')),
  )
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

function sourceTypeMatchesUrl(
  type: StrongCorroborationType,
  url: string,
  primaryUrl: string | null,
) {
  if (type === 'first_party') {
    return isPlausibleFirstParty(url, primaryUrl)
  }
  if (type === 'regulatory') {
    return isGovernmentUrl(url)
  }
  if (type === 'business_registry') {
    return isPlausibleBusinessRegistry(url)
  }
  return false
}

const identitySchema = {
  type: 'object',
  properties: {
    identityMatch: {
      type: 'string',
      enum: ['matched', 'changed', 'conflict', 'unknown'],
    },
    businessStatus: {
      type: 'string',
      enum: ['active', 'inactive', 'internal', 'not_public', 'unknown'],
    },
    currentName: { type: ['string', 'null'] },
    currentAddress: { type: ['string', 'null'] },
    identityConfidence: { type: 'number', minimum: 0, maximum: 1 },
    corroborationEvidenceUrl: { type: ['string', 'null'] },
    corroborationEvidenceType: {
      type: ['string', 'null'],
      enum: [
        'regulatory',
        'first_party',
        'business_registry',
        null,
      ],
    },
    corroborationSupports: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['identity', 'address', 'business_status'],
      },
    },
    corroborationSummary: { type: ['string', 'null'] },
  },
  required: [
    'identityMatch',
    'businessStatus',
    'currentName',
    'currentAddress',
    'identityConfidence',
    'corroborationEvidenceUrl',
    'corroborationEvidenceType',
    'corroborationSupports',
    'corroborationSummary',
  ],
  additionalProperties: false,
} as const

const inputPath = readFlag('input') ?? process.argv[2]
if (!inputPath) {
  throw new Error(
    'Usage: npm run enrich:review-harvest -- --input <review-batch.json> [--output <review-evidence.json>]',
  )
}

const outputPath = readFlag('output') ?? 'tmp/review-harvested-batch.json'
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
    'Missing OPENAI_API_KEY. It is required for targeted review corroboration research.',
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
if (input.sourceBucket !== 'missing_identity_corroboration_only') {
  throw new Error(
    'Targeted review harvester only supports missing_identity_corroboration_only',
  )
}

for (const record of input.records) {
  if (!record.phmsaName || !record.phmsaAddress || !record.city || !record.state) {
    throw new Error(
      'Review batch is missing PHMSA facility fields. Re-export it with enrich:review-next before harvesting.',
    )
  }
}

const batch =
  readFlag('batch') ??
  'review-harvest-' + input.batch.replace(/^review-/, '')

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
    url.searchParams.delete('utm_source')
    url.searchParams.delete('utm_medium')
    url.searchParams.delete('utm_campaign')
    url.searchParams.delete('utm_term')
    url.searchParams.delete('utm_content')
    return url.toString()
  } catch {
    return raw.trim()
  }
}

function sameUrl(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  return Boolean(a && b && normalizeUrl(a) === normalizeUrl(b))
}

function siteDomain(raw: string | null | undefined) {
  if (!raw) return null
  try {
    const parts = new URL(raw).hostname.toLowerCase().split('.').filter(Boolean)
    if (parts.length < 2) return parts[0] ?? null
    return parts.slice(-2).join('.')
  } catch {
    return null
  }
}

function isPlausibleFirstParty(
  corroborationUrl: string | null,
  primaryUrl: string | null,
) {
  const corroborationDomain = siteDomain(corroborationUrl)
  const primaryDomain = siteDomain(primaryUrl)
  return Boolean(
    corroborationDomain &&
      primaryDomain &&
      corroborationDomain === primaryDomain,
  )
}

function buildPrompt(record: ReviewRecord) {
  return [
    'Research ONLY independent current-business identity corroboration for this U.S. DOT cylinder requalification facility.',
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
    'Current extracted name: ' + (record.currentName ?? 'unknown'),
    'Current extracted address: ' + (record.currentAddress ?? 'unknown'),
    'Existing primary evidence URL: ' + (record.evidenceUrl ?? 'none'),
    'Existing evidence summary: ' + (record.summary || 'none'),
    '',
    'The existing primary evidence already covers service/customer-access research. Do NOT redo service classification and do NOT infer new service categories.',
    '',
    'Research requirements:',
    '- Perform exactly ONE web search call. Use only sources returned by that search.',
    '- Find a source DISTINCT from the existing primary evidence URL.',
    '- Accept only a strong corroboration source found on the public web: a separate first-party provider/company page on the provider domain, an official business registry, or a current government/regulatory record.',
    '- regulatory must be a direct government (.gov) source. A private site hosting or summarizing government-derived data is not regulatory evidence.',
    '- business_registry must be an official government registry (or an explicitly recognized official registry host such as Sunbiz), not a chamber or business directory.',
    '- provider_claim is reserved for evidence supplied or confirmed directly through the Cylinder Atlas provider-claim workflow. A web-search result can NEVER be provider_claim.',
    '- Do NOT use BBB, Yelp, Yellow Pages, trade/member directories, chambers of commerce, social media, SEO directories, or other generic directories as the corroboration source.',
    '- Do NOT use the original PHMSA RIN listing itself as independent current-business corroboration.',
    '- corroborationSupports must list only what the selected source itself proves: identity, address, and/or business_status.',
    '- business_status means the source supports that the business/location is currently active or supports a terminal status such as inactive/closed. Do not mark it merely because a name appears in an old document.',
    '- For automatic publication downstream, the source must establish identity, exact facility address, and active business status. Partial support is still useful; list only the supported fields.',
    '- Treat suite/unit numbers as material. If PHMSA has a suite/unit that the current source omits, changes, or contradicts without reconciliation, do not claim exact address support.',
    '- The RIN is facility-specific. Never assume a move, acquisition, or rename carries the RIN to a new location.',
    '- identityMatch=matched only when current evidence cleanly reconciles the current business to this exact PHMSA facility.',
    '- If the current business is at a materially different address, use changed or conflict. If acquisition/rename lineage is unclear, use conflict or unknown.',
    '- If no qualifying strong source is found in the one search, return null corroboration fields, an empty supports array, and conservative values.',
    '- URLs must be exact URLs actually consulted in web search. Do not invent or rewrite URLs.',
    '',
    'This is precision-first research. A downstream review outcome is preferable to a false match.',
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

function sourceWasConsulted(url: string | null, consulted: Set<string>) {
  if (!url) return false
  const normalized = normalizeUrl(url)
  return [...consulted].some((source) => normalizeUrl(source) === normalized)
}

function clampConfidence(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(Math.max(parsed, 0), 1)
}

function isIdentityMatch(value: unknown): value is IdentityMatch {
  return ['matched', 'changed', 'conflict', 'unknown'].includes(String(value))
}

function isBusinessStatus(value: unknown): value is BusinessStatus {
  return ['active', 'inactive', 'internal', 'not_public', 'unknown'].includes(
    String(value),
  )
}

function isStrongCorroborationType(
  value: unknown,
): value is StrongCorroborationType {
  return (
    typeof value === 'string' &&
    STRONG_CORROBORATION_TYPES.has(value as StrongCorroborationType)
  )
}

function sanitizeResearch(
  record: ReviewRecord,
  raw: Record<string, unknown>,
  consulted: Set<string>,
): IdentityResearch {
  const url =
    typeof raw.corroborationEvidenceUrl === 'string'
      ? raw.corroborationEvidenceUrl
      : null
  const type = isStrongCorroborationType(raw.corroborationEvidenceType)
    ? raw.corroborationEvidenceType
    : null
  const supports = Array.isArray(raw.corroborationSupports)
    ? raw.corroborationSupports.filter(
        (value): value is CorroborationSupport =>
          value === 'identity' ||
          value === 'address' ||
          value === 'business_status',
      )
    : []

  const validSource = Boolean(
    url &&
      type &&
      sourceWasConsulted(url, consulted) &&
      !sameUrl(url, record.evidenceUrl) &&
      !isBlockedDirectoryUrl(url) &&
      sourceTypeMatchesUrl(type, url, record.evidenceUrl),
  )

  if (!validSource) {
    return {
      identityMatch: record.identityMatch,
      businessStatus: record.businessStatus,
      currentName: record.currentName,
      currentAddress: record.currentAddress,
      identityConfidence: record.identityConfidence,
      corroborationEvidenceUrl: null,
      corroborationEvidenceType: null,
      corroborationSupports: [],
      corroborationSummary: null,
    }
  }

  return {
    identityMatch: isIdentityMatch(raw.identityMatch)
      ? raw.identityMatch
      : record.identityMatch,
    businessStatus: isBusinessStatus(raw.businessStatus)
      ? raw.businessStatus
      : record.businessStatus,
    currentName:
      typeof raw.currentName === 'string' ? raw.currentName : record.currentName,
    currentAddress:
      typeof raw.currentAddress === 'string'
        ? raw.currentAddress
        : record.currentAddress,
    identityConfidence: clampConfidence(raw.identityConfidence),
    corroborationEvidenceUrl: url,
    corroborationEvidenceType: type,
    corroborationSupports: supports,
    corroborationSummary:
      typeof raw.corroborationSummary === 'string'
        ? raw.corroborationSummary
        : null,
  }
}

function mergeRecord(record: ReviewRecord, research: IdentityResearch) {
  const summaryParts = [record.summary]
  if (research.corroborationSummary) {
    summaryParts.push(
      'Review-resolution corroboration: ' + research.corroborationSummary,
    )
  }

  const useResearchIdentityFields =
    research.identityMatch === 'changed' ||
    research.identityMatch === 'conflict'

  return {
    ...record,
    identityMatch: research.identityMatch,
    businessStatus: research.businessStatus,
    // For a clean match, preserve the existing reviewed display identity/address.
    // The targeted pass exists to corroborate those fields, not rewrite them with
    // search-result formatting or marketing labels. Only a changed/conflict result
    // may replace them so the discrepancy is visible in review.
    currentName: useResearchIdentityFields
      ? research.currentName
      : record.currentName,
    currentAddress: useResearchIdentityFields
      ? research.currentAddress
      : record.currentAddress,
    identityConfidence: research.identityConfidence,
    corroborationEvidenceUrl: research.corroborationEvidenceUrl,
    corroborationEvidenceType: research.corroborationEvidenceType,
    corroborationSupports: research.corroborationSupports,
    corroborationSummary: research.corroborationSummary,
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
          max_output_tokens: 500,
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
          text: {
            format: {
              type: 'json_schema',
              name: 'cylinder_atlas_identity_corroboration',
              strict: true,
              schema: identitySchema,
            },
          },
          input: [
            {
              role: 'system',
              content:
                'You are a precision-first evidence researcher. Research only current business identity/location/status corroboration and return conservative structured facts.',
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
          sharedBackoffUntil = Math.max(
            sharedBackoffUntil,
            Date.now() + delay,
          )
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

function createPayload(complete: boolean): ReviewHarvestPayload {
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
    sourceBucket: input.sourceBucket ?? null,
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
    ) as ReviewHarvestPayload
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

const fullyCorroborated = [...recordByRin.values()].filter((record) => {
  const supports = new Set(record.corroborationSupports)
  return (
    Boolean(record.corroborationEvidenceUrl) &&
    Boolean(
      record.corroborationEvidenceType &&
        STRONG_CORROBORATION_TYPES.has(
          record.corroborationEvidenceType as StrongCorroborationType,
        ),
    ) &&
    supports.has('identity') &&
    supports.has('address') &&
    supports.has('business_status')
  )
}).length

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
      fullyCorroborated,
      unresolved: recordByRin.size - fullyCorroborated,
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
