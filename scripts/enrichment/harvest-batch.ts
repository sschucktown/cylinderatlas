import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readFlag, readPositiveIntFlag } from './admin-client'
import type {
  BusinessStatus,
  FacilityCandidate,
  IdentityMatch,
  ServiceKey,
} from './types'

type EvidenceType =
  | 'regulatory'
  | 'first_party'
  | 'business_registry'
  | 'directory'
  | 'provider_claim'
  | 'other'

type ExternalCustomerStatus = 'yes' | 'no' | 'unknown'

interface ExportPayload {
  runName: string
  algorithmVersion: string
  hint: string | null
  generatedAt: string
  count: number
  candidates: FacilityCandidate[]
}

interface HarvestedRecord {
  rin: string
  identityMatch: IdentityMatch
  businessStatus: BusinessStatus
  servesExternalCustomers: ExternalCustomerStatus
  currentName: string | null
  currentAddress: string | null
  serviceKeys: ServiceKey[]
  serviceConfidence: number
  identityConfidence: number
  summary: string
  evidenceUrl: string | null
  evidenceType: EvidenceType | null
  corroborationEvidenceUrl: string | null
  corroborationEvidenceType: EvidenceType | null
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

interface HarvestPayload {
  runName: string
  batch: string
  model: string
  generatedAt: string
  complete: boolean
  sourceBatch: {
    hint: string | null
    generatedAt: string
    candidateCount: number
  }
  records: HarvestedRecord[]
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

const EVIDENCE_TYPES: EvidenceType[] = [
  'regulatory',
  'first_party',
  'business_registry',
  'directory',
  'provider_claim',
  'other',
]

const evidenceSchema = {
  type: 'object',
  properties: {
    identityMatch: { type: 'string', enum: ['matched', 'changed', 'conflict', 'unknown'] },
    businessStatus: {
      type: 'string',
      enum: ['active', 'inactive', 'internal', 'not_public', 'unknown'],
    },
    servesExternalCustomers: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    currentName: { type: ['string', 'null'] },
    currentAddress: { type: ['string', 'null'] },
    serviceKeys: {
      type: 'array',
      items: { type: 'string', enum: SERVICE_KEYS },
    },
    serviceConfidence: { type: 'number', minimum: 0, maximum: 1 },
    identityConfidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    evidenceUrl: { type: ['string', 'null'] },
    evidenceType: { type: ['string', 'null'], enum: [...EVIDENCE_TYPES, null] },
    corroborationEvidenceUrl: { type: ['string', 'null'] },
    corroborationEvidenceType: {
      type: ['string', 'null'],
      enum: [...EVIDENCE_TYPES, null],
    },
    corroborationSummary: { type: ['string', 'null'] },
  },
  required: [
    'identityMatch',
    'businessStatus',
    'servesExternalCustomers',
    'currentName',
    'currentAddress',
    'serviceKeys',
    'serviceConfidence',
    'identityConfidence',
    'summary',
    'evidenceUrl',
    'evidenceType',
    'corroborationEvidenceUrl',
    'corroborationEvidenceType',
    'corroborationSummary',
  ],
  additionalProperties: false,
} as const

const inputPath = readFlag('input') ?? process.argv[2]
if (!inputPath) {
  throw new Error(
    'Usage: npm run enrich:harvest -- --input <candidate-batch.json> [--output <evidence-batch.json>] [--concurrency 5]',
  )
}

const outputPath = readFlag('output') ?? 'tmp/enrichment-harvested-batch.json'
const concurrency = Math.min(readPositiveIntFlag('concurrency', 5), 10)
const maxAttempts = Math.min(readPositiveIntFlag('attempts', 3), 5)
const model = process.env.OPENAI_ENRICHMENT_MODEL ?? 'gpt-5.6-terra'
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error(
    'Missing OPENAI_API_KEY. It is required only for the server-side enrichment harvester.',
  )
}

const input = JSON.parse(await readFile(inputPath, 'utf8')) as ExportPayload
if (!input.runName || !Array.isArray(input.candidates) || !input.candidates.length) {
  throw new Error('Candidate batch must include runName and non-empty candidates[]')
}

const batch =
  readFlag('batch') ??
  `harvest-${input.hint ?? 'mixed'}-${input.generatedAt.replace(/[:.]/g, '-')}`

const recordByRin = new Map<string, HarvestedRecord>()
const failureByRin = new Map<string, HarvestFailure>()
const usage: UsageTotals = {
  responseCalls: 0,
  webSearchCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

async function loadCheckpoint() {
  try {
    const existing = JSON.parse(await readFile(outputPath, 'utf8')) as HarvestPayload
    const sameBatch =
      existing.runName === input.runName &&
      existing.batch === batch &&
      existing.sourceBatch?.generatedAt === input.generatedAt

    if (!sameBatch) return

    for (const record of existing.records ?? []) {
      if (input.candidates.some((candidate) => candidate.rin === record.rin)) {
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

function createPayload(complete: boolean): HarvestPayload {
  const records = input.candidates
    .map((candidate) => recordByRin.get(candidate.rin))
    .filter((record): record is HarvestedRecord => Boolean(record))
  const failures = input.candidates
    .map((candidate) => failureByRin.get(candidate.rin))
    .filter((failure): failure is HarvestFailure => Boolean(failure))

  return {
    runName: input.runName,
    batch,
    model,
    generatedAt: new Date().toISOString(),
    complete,
    sourceBatch: {
      hint: input.hint ?? null,
      generatedAt: input.generatedAt,
      candidateCount: input.candidates.length,
    },
    records,
    failures,
    usage: { ...usage },
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n')
  await rename(tempPath, path)
}

function scheduleCheckpoint() {
  checkpointChain = checkpointChain.then(() => writeJsonAtomic(outputPath, createPayload(false)))
  return checkpointChain
}

function buildPrompt(candidate: FacilityCandidate) {
  return [
    'Research this U.S. DOT cylinder requalification facility for Cylinder Atlas.',
    '',
    `RIN: ${candidate.rin}`,
    `PHMSA name: ${candidate.phmsa_name}`,
    `PHMSA address: ${candidate.phmsa_address}`,
    `City/state/postal: ${candidate.city}, ${candidate.state} ${candidate.postal_code ?? ''}`.trim(),
    `Candidate hint: ${candidate.candidate_type_hint ?? 'none'}`,
    '',
    'Governing rule:',
    'PHMSA authorization is already known. Your job is current-business evidence collection and fact extraction only. You do NOT decide publish/review/exclude.',
    '',
    'Research requirements:',
    '- Search current sources. Prefer first-party location/service pages, state or regulatory records, and business registries. Use general directories only as supporting evidence.',
    '- Treat the RIN as facility-specific. Never assume a RIN moved with a business.',
    '- identityMatch=matched only when current evidence cleanly reconciles the current business to the exact PHMSA facility/location.',
    '- If a current business address materially differs, a suite differs without reconciliation, or an acquisition/rename lineage is unclear, use changed or conflict rather than matched.',
    '- servesExternalCustomers=yes only when current evidence shows the facility serves outside customers. Do not infer it merely from being an active company.',
    '- serviceKeys must be backed by current service evidence. Do not infer a service category from the company name, the candidate hint, or PHMSA cylinder specifications.',
    '- For fire/suppression, evidence should show customer-facing fire extinguisher/suppression/cylinder service; hydrostatic or cylinder testing/requalification language is especially strong.',
    '- Use evidenceUrl for the best source supporting service/customer access when possible.',
    '- Use corroborationEvidenceUrl for a distinct strong source supporting current identity/location/business status when available.',
    '- URLs must be exact URLs you actually consulted in web search. Do not invent or rewrite URLs.',
    '- If evidence is weak or missing, return unknown values and conservative confidence. A review outcome is acceptable downstream.',
    '- Do not use social media, user-review sites, or SEO lead directories as strong identity corroboration.',
    '',
    'Confidence guidance:',
    '- identityConfidence >= 0.85 only with strong current identity/location corroboration.',
    '- serviceConfidence >= 0.85 only with explicit current service evidence for the returned serviceKeys.',
    '- When either threshold is not met, return the lower honest confidence rather than forcing a match.',
    '',
    'Evidence type definitions:',
    '- first_party: the provider/company website.',
    '- business_registry: official secretary of state/corporate registry.',
    '- regulatory: government licensing, fire marshal, permit, or similar official source.',
    '- directory: third-party industry/general directory.',
    '- provider_claim: provider-supplied/confirmed evidence (unlikely in web research).',
    '- other: evidence that does not fit the above.',
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

function sourceWasConsulted(url: string | null, consulted: Set<string>) {
  if (!url) return true
  const normalized = normalizeUrl(url)
  return [...consulted].some((source) => normalizeUrl(source) === normalized)
}

function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === 'string' && EVIDENCE_TYPES.includes(value as EvidenceType)
}

function isServiceKey(value: unknown): value is ServiceKey {
  return typeof value === 'string' && SERVICE_KEYS.includes(value as ServiceKey)
}

function clampConfidence(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(Math.max(parsed, 0), 1)
}

function sanitizeRecord(
  rin: string,
  raw: Record<string, unknown>,
  consulted: Set<string>,
): HarvestedRecord {
  const primaryUrl = typeof raw.evidenceUrl === 'string' ? raw.evidenceUrl : null
  const corroborationUrl =
    typeof raw.corroborationEvidenceUrl === 'string' ? raw.corroborationEvidenceUrl : null

  const primaryValid = sourceWasConsulted(primaryUrl, consulted)
  const corroborationValid = sourceWasConsulted(corroborationUrl, consulted)
  const distinct =
    !primaryUrl ||
    !corroborationUrl ||
    normalizeUrl(primaryUrl) !== normalizeUrl(corroborationUrl)

  const safePrimaryUrl = primaryValid ? primaryUrl : null
  const safeCorroborationUrl = corroborationValid && distinct ? corroborationUrl : null
  const sourceValidationFailed = !primaryValid || !corroborationValid || !distinct

  const identityMatch = ['matched', 'changed', 'conflict', 'unknown'].includes(
    String(raw.identityMatch),
  )
    ? (raw.identityMatch as IdentityMatch)
    : 'unknown'
  const businessStatus = ['active', 'inactive', 'internal', 'not_public', 'unknown'].includes(
    String(raw.businessStatus),
  )
    ? (raw.businessStatus as BusinessStatus)
    : 'unknown'
  const servesExternalCustomers = ['yes', 'no', 'unknown'].includes(
    String(raw.servesExternalCustomers),
  )
    ? (raw.servesExternalCustomers as ExternalCustomerStatus)
    : 'unknown'

  const serviceKeys = Array.isArray(raw.serviceKeys)
    ? raw.serviceKeys.filter(isServiceKey)
    : []
  const identityConfidence = clampConfidence(raw.identityConfidence)
  const serviceConfidence = clampConfidence(raw.serviceConfidence)

  if (sourceValidationFailed) {
    return {
      rin,
      identityMatch: 'unknown',
      businessStatus: 'unknown',
      servesExternalCustomers: 'unknown',
      currentName: typeof raw.currentName === 'string' ? raw.currentName : null,
      currentAddress: typeof raw.currentAddress === 'string' ? raw.currentAddress : null,
      serviceKeys: [],
      serviceConfidence: 0,
      identityConfidence: 0,
      summary: `${String(raw.summary ?? 'Evidence extraction completed.')} Source URL validation failed; downgraded to unresolved for safety.`,
      evidenceUrl: safePrimaryUrl,
      evidenceType:
        safePrimaryUrl && isEvidenceType(raw.evidenceType) ? raw.evidenceType : null,
      corroborationEvidenceUrl: safeCorroborationUrl,
      corroborationEvidenceType:
        safeCorroborationUrl && isEvidenceType(raw.corroborationEvidenceType)
          ? raw.corroborationEvidenceType
          : null,
      corroborationSummary:
        safeCorroborationUrl && typeof raw.corroborationSummary === 'string'
          ? raw.corroborationSummary
          : null,
    }
  }

  return {
    rin,
    identityMatch,
    businessStatus,
    servesExternalCustomers,
    currentName: typeof raw.currentName === 'string' ? raw.currentName : null,
    currentAddress: typeof raw.currentAddress === 'string' ? raw.currentAddress : null,
    serviceKeys,
    serviceConfidence,
    identityConfidence,
    summary: String(raw.summary ?? ''),
    evidenceUrl: safePrimaryUrl,
    evidenceType:
      safePrimaryUrl && isEvidenceType(raw.evidenceType) ? raw.evidenceType : null,
    corroborationEvidenceUrl: safeCorroborationUrl,
    corroborationEvidenceType:
      safeCorroborationUrl && isEvidenceType(raw.corroborationEvidenceType)
        ? raw.corroborationEvidenceType
        : null,
    corroborationSummary:
      safeCorroborationUrl && typeof raw.corroborationSummary === 'string'
        ? raw.corroborationSummary
        : null,
  }
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

async function researchCandidate(candidate: FacilityCandidate) {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: 'low' },
          tools: [{ type: 'web_search', search_context_size: 'medium' }],
          tool_choice: 'required',
          include: ['web_search_call.action.sources'],
          text: {
            format: {
              type: 'json_schema',
              name: 'cylinder_atlas_evidence',
              strict: true,
              schema: evidenceSchema,
            },
          },
          input: [
            {
              role: 'system',
              content:
                'You are a precision-first evidence researcher. Extract only facts supported by current web evidence. When uncertain, return unknown and lower confidence.',
            },
            { role: 'user', content: buildPrompt(candidate) },
          ],
        }),
      })

      const body = (await response.json()) as OpenAIResponse

      if (!response.ok) {
        const message = body.error?.message ?? `OpenAI HTTP ${response.status}`
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1))
          continue
        }
        throw new Error(message)
      }

      addUsage(body)

      if (body.status && body.status !== 'completed') {
        throw new Error(`OpenAI response status was ${body.status}`)
      }

      const text = extractOutputText(body)
      const raw = JSON.parse(text) as Record<string, unknown>
      const consulted = extractSearchSources(body)

      return sanitizeRecord(candidate.rin, raw, consulted)
    } catch (error) {
      lastError = error
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
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      await worker(items[current]!)
    }
  })

  await Promise.all(workers)
}

await loadCheckpoint()

const pendingCandidates = input.candidates.filter(
  (candidate) => !recordByRin.has(candidate.rin),
)

await writeJsonAtomic(outputPath, createPayload(false))

await runWithConcurrency(pendingCandidates, concurrency, async (candidate) => {
  try {
    const record = await researchCandidate(candidate)
    recordByRin.set(candidate.rin, record)
    failureByRin.delete(candidate.rin)
  } catch (error) {
    failureByRin.set(candidate.rin, {
      rin: candidate.rin,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  await scheduleCheckpoint()

  console.log(
    JSON.stringify({
      rin: candidate.rin,
      completed: recordByRin.size,
      failed: failureByRin.size,
      total: input.candidates.length,
    }),
  )
})

await checkpointChain
await writeJsonAtomic(outputPath, createPayload(true))

console.log(
  JSON.stringify(
    {
      run: input.runName,
      batch,
      model,
      output: outputPath,
      candidates: input.candidates.length,
      resumed: input.candidates.length - pendingCandidates.length,
      harvested: recordByRin.size,
      failures: failureByRin.size,
      usage,
    },
    null,
    2,
  ),
)
