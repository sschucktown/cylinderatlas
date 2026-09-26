import type {
  BusinessStatus,
  EnrichmentResult,
  EvidenceInput,
  FacilityCandidate,
  ServiceKey,
} from './types'

const FIRE = /(FIRE|EXTINGUISH|SPRINKLER|SUPPRESSION)/i
const SCUBA = /(SCUBA|DIVE|DIVERS|DIVING)/i
const PAINTBALL = /PAINTBALL/i
const INDUSTRIAL = /(WELD|OXYGEN|GAS|CYLINDER)/i
const GOVERNMENT = /(UNITED STATES DEPARTMENT OF THE NAVY|NAVAL SEA SYSTEMS COMMAND|AIR FORCE BASE|UNIVERSITY OF FLORIDA|FLORIDA STATE UNIVERSITY)/i

export function inferCandidateServices(candidate: FacilityCandidate): ServiceKey[] {
  const name = candidate.phmsa_name

  if (SCUBA.test(name)) return ['scuba']
  if (PAINTBALL.test(name)) return ['paintball']
  if (FIRE.test(name)) return ['fire-extinguisher-suppression']
  if (INDUSTRIAL.test(name)) return ['industrial-welding-gas']

  return []
}

export function obviousInternalStatus(candidate: FacilityCandidate): BusinessStatus | null {
  return GOVERNMENT.test(candidate.phmsa_name) ? 'internal' : null
}

/**
 * Production gate:
 * - PHMSA/name heuristics may infer a likely service, but they NEVER publish by themselves.
 * - Publish requires current identity/location/business-status corroboration from a
 *   first-party, regulatory, business-registry, or provider-confirmed source. A generic
 *   directory/service listing may support service evidence but cannot clear identity alone.
 * - Publish also requires current evidence that the facility serves outside customers and
 *   supports at least one service category.
 * - Acquisitions/moves/name changes remain in review until the RIN-to-facility relationship
 *   is reconciled.
 */
export function decide(
  candidate: FacilityCandidate,
  evidence: EvidenceInput,
): EnrichmentResult {
  const internal = obviousInternalStatus(candidate)
  const businessStatus = internal ?? evidence.businessStatus

  if (
    businessStatus === 'inactive' ||
    businessStatus === 'internal' ||
    businessStatus === 'not_public' ||
    evidence.servesExternalCustomers === 'no'
  ) {
    return {
      rin: candidate.rin,
      decision: 'exclude',
      commercialStatus: 'no',
      serviceKeys: [],
      identityConfidence: evidence.identityConfidence,
      serviceConfidence: evidence.serviceConfidence,
      currentName: evidence.currentName,
      currentAddress: evidence.currentAddress,
      evidenceUrls: evidence.evidenceUrls,
      summary: evidence.summary,
    }
  }

  if (evidence.identityMatch === 'changed' || evidence.identityMatch === 'conflict') {
    return {
      rin: candidate.rin,
      decision: 'review',
      commercialStatus: 'unknown',
      serviceKeys: [],
      identityConfidence: evidence.identityConfidence,
      serviceConfidence: evidence.serviceConfidence,
      currentName: evidence.currentName,
      currentAddress: evidence.currentAddress,
      manualReviewReason: 'current identity/address does not cleanly reconcile to the PHMSA RIN facility',
      evidenceUrls: evidence.evidenceUrls,
      summary: evidence.summary,
    }
  }

  const evidenceBackedServices = evidence.serviceKeys
  const suggestedServices = evidenceBackedServices.length
    ? evidenceBackedServices
    : inferCandidateServices(candidate)

  const publishable =
    evidence.identityMatch === 'matched' &&
    businessStatus === 'active' &&
    evidence.servesExternalCustomers === 'yes' &&
    evidence.identityConfidence >= 0.85 &&
    evidence.identityCorroborated === true &&
    evidence.serviceConfidence >= 0.85 &&
    evidenceBackedServices.length > 0

  if (publishable) {
    return {
      rin: candidate.rin,
      decision: 'publish',
      commercialStatus: 'yes',
      serviceKeys: evidenceBackedServices,
      identityConfidence: evidence.identityConfidence,
      serviceConfidence: evidence.serviceConfidence,
      currentName: evidence.currentName,
      currentAddress: evidence.currentAddress,
      evidenceUrls: evidence.evidenceUrls,
      summary: evidence.summary,
    }
  }

  return {
    rin: candidate.rin,
    decision: 'review',
    commercialStatus:
      businessStatus === 'active' && evidence.servesExternalCustomers === 'yes'
        ? 'yes'
        : 'unknown',
    serviceKeys: suggestedServices,
    identityConfidence: evidence.identityConfidence,
    serviceConfidence: evidence.serviceConfidence,
    currentName: evidence.currentName,
    currentAddress: evidence.currentAddress,
    manualReviewReason: evidence.identityCorroborated === true
      ? 'insufficient current evidence to clear publish threshold'
      : 'current identity/location/business status lacks independent corroboration',
    evidenceUrls: evidence.evidenceUrls,
    summary: evidence.summary,
  }
}
