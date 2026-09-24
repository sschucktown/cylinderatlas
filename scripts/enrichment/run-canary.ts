import { readFile, writeFile } from 'node:fs/promises'
import { decide } from './rules'
import type { EvidenceInput, FacilityCandidate } from './types'

type EvidenceByRin = Record<string, EvidenceInput>

const [candidatePath, evidencePath, outputPath = 'tmp/enrichment-results.json'] =
  process.argv.slice(2)

if (!candidatePath || !evidencePath) {
  throw new Error(
    'Usage: tsx scripts/enrichment/run-canary.ts <candidates.json> <evidence.json> [output.json]',
  )
}

const candidates = JSON.parse(
  await readFile(candidatePath, 'utf8'),
) as FacilityCandidate[]

const evidence = JSON.parse(
  await readFile(evidencePath, 'utf8'),
) as EvidenceByRin

const results = candidates.map((candidate) => {
  const record = evidence[candidate.rin]

  if (!record) {
    return {
      rin: candidate.rin,
      decision: 'review',
      commercialStatus: 'unknown',
      serviceKeys: [],
      identityConfidence: 0,
      serviceConfidence: 0,
      manualReviewReason: 'no enrichment evidence supplied',
      evidenceUrls: [],
      summary: 'No enrichment evidence supplied.',
    }
  }

  return decide(candidate, record)
})

await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n')

const counts = results.reduce<Record<string, number>>((acc, result) => {
  acc[result.decision] = (acc[result.decision] ?? 0) + 1
  return acc
}, {})

console.log(JSON.stringify({ count: results.length, decisions: counts }, null, 2))
