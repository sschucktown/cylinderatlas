export type ServiceKey =
  | 'fire-extinguisher-suppression'
  | 'scuba'
  | 'scba'
  | 'propane'
  | 'industrial-welding-gas'
  | 'medical-oxygen'
  | 'co2-beverage'
  | 'paintball'
  | 'specialty'

export type Decision = 'publish' | 'review' | 'exclude'
export type CommercialStatus = 'yes' | 'no' | 'unknown'
export type IdentityMatch = 'matched' | 'changed' | 'conflict' | 'unknown'
export type BusinessStatus = 'active' | 'inactive' | 'internal' | 'not_public' | 'unknown'

export interface FacilityCandidate {
  id?: string
  rin: string
  phmsa_name: string
  phmsa_address: string
  city: string
  state: string
  postal_code?: string | null
  candidate_type_hint?: string | null
}

export interface EvidenceInput {
  identityMatch: IdentityMatch
  businessStatus: BusinessStatus
  servesExternalCustomers: 'yes' | 'no' | 'unknown'
  currentName?: string | null
  currentAddress?: string | null
  serviceKeys: ServiceKey[]
  serviceConfidence: number
  identityConfidence: number
  identityCorroborated: boolean
  evidenceUrls: string[]
  summary: string
}

export interface EnrichmentResult {
  rin: string
  decision: Decision
  commercialStatus: CommercialStatus
  serviceKeys: ServiceKey[]
  identityConfidence: number
  serviceConfidence: number
  currentName?: string | null
  currentAddress?: string | null
  manualReviewReason?: string | null
  evidenceUrls: string[]
  summary: string
}
