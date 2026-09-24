import { createHash } from 'node:crypto'
import type { FacilityCandidate } from './types'

export const CANARY_QUOTAS: Record<string, number> = {
  fire_suppression: 30,
  unknown: 28,
  industrial_gas: 15,
  scuba: 10,
  possible_internal_government: 8,
  aviation_specialty: 8,
  paintball: 1,
}

function rank(rin: string, seed: string): string {
  return createHash('sha256').update(`${rin}|${seed}`).digest('hex')
}

export function selectCanary(
  candidates: FacilityCandidate[],
  seed = '20260924-canary-v1',
): FacilityCandidate[] {
  const selected: FacilityCandidate[] = []

  for (const [hint, count] of Object.entries(CANARY_QUOTAS)) {
    const bucket = candidates
      .filter((candidate) => (candidate.candidate_type_hint ?? 'unknown') === hint)
      .sort((a, b) => rank(a.rin, seed).localeCompare(rank(b.rin, seed)))
      .slice(0, count)

    selected.push(...bucket)
  }

  if (selected.length !== 100) {
    throw new Error(`Expected 100 canary rows, got ${selected.length}`)
  }

  return selected
}
