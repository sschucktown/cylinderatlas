export const SERVICE_TAXONOMY = {
  'fire-extinguisher-suppression': {
    label: 'Fire extinguisher / suppression',
    shortLabel: 'Fire suppression',
    description:
      'Cylinder requalification providers with current evidence supporting fire extinguisher or fire-suppression cylinder service.',
  },
  scuba: {
    label: 'SCUBA',
    shortLabel: 'SCUBA',
    description:
      'Cylinder requalification providers with current evidence supporting SCUBA cylinder service.',
  },
  scba: {
    label: 'SCBA',
    shortLabel: 'SCBA',
    description:
      'Cylinder requalification providers with current evidence supporting self-contained breathing apparatus cylinder service.',
  },
  propane: {
    label: 'Propane',
    shortLabel: 'Propane',
    description:
      'Cylinder requalification providers with current evidence supporting propane cylinder service.',
  },
  'industrial-welding-gas': {
    label: 'Industrial / welding gas',
    shortLabel: 'Industrial gas',
    description:
      'Cylinder requalification providers with current evidence supporting industrial or welding-gas cylinder service.',
  },
  'medical-oxygen': {
    label: 'Medical oxygen',
    shortLabel: 'Medical oxygen',
    description:
      'Cylinder requalification providers with current evidence supporting medical oxygen cylinder service.',
  },
  'co2-beverage': {
    label: 'CO2 / beverage',
    shortLabel: 'CO2 / beverage',
    description:
      'Cylinder requalification providers with current evidence supporting CO2 or beverage cylinder service.',
  },
  paintball: {
    label: 'Paintball',
    shortLabel: 'Paintball',
    description:
      'Cylinder requalification providers with current evidence supporting paintball cylinder service.',
  },
  specialty: {
    label: 'Specialty / aviation / marine',
    shortLabel: 'Specialty',
    description:
      'Cylinder requalification providers with current evidence supporting specialty, aviation, or marine cylinder service.',
  },
} as const

export type ServiceKey = keyof typeof SERVICE_TAXONOMY

export const SERVICE_KEYS = Object.keys(SERVICE_TAXONOMY) as ServiceKey[]
export const PUBLIC_SERVICE_STATUSES = ['verified', 'provider_confirmed'] as const

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
}

export function serviceInfo(value: string) {
  return SERVICE_TAXONOMY[value as ServiceKey] ?? null
}

export function serviceLabel(value: string) {
  return serviceInfo(value)?.label ?? value
}

export function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function displayName(facility: { display_name?: string | null; phmsa_name: string }) {
  return facility.display_name || facility.phmsa_name
}

export function providerPath(facility: {
  display_name?: string | null
  phmsa_name: string
  rin: string
}) {
  return '/providers/' + slugify(displayName(facility)) + '--' + facility.rin.toLowerCase()
}

export function rinFromProviderSlug(value: string) {
  const match = value.match(/--([a-z0-9-]+)$/i)
  return match?.[1]?.toUpperCase() ?? null
}

export function stateName(code: string) {
  return STATE_NAMES[code.toUpperCase()] ?? code.toUpperCase()
}

export function statePath(code: string) {
  return '/states/' + slugify(stateName(code))
}

export function codeFromStateSlug(slug: string) {
  const normalized = slugify(slug)
  const match = Object.entries(STATE_NAMES).find(([, name]) => slugify(name) === normalized)
  return match?.[0] ?? null
}

export function titleCaseCity(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatVerifiedDate(value?: string | null) {
  if (!value) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}
