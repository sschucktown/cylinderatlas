# Cylinder Atlas

Cylinder Atlas is a national directory of DOT cylinder requalification facilities. The product starts with PHMSA RIN data, resolves current business identity, enriches customer-facing service capabilities, and publishes only facilities that clear an evidence threshold.

## Architecture

- **Nuxt 4 + TypeScript** — application and SEO pages
- **Tailwind CSS 4** — UI
- **Supabase** — production source of truth, authentication, provider claims, and corrections
- **PHMSA** — regulatory source layer for RIN/hydrostatic authorization
- **Airtable** — research/QA only; not a production dependency

## Data rule

A PHMSA row is not automatically a public provider listing. The pipeline is:

`PHMSA -> identity resolution -> commercial/public check -> service evidence -> confidence gate -> publish/review/exclude`

Address conflicts are held for review. A provider claim may improve commercial/service information, but it cannot override PHMSA regulatory authorization without authoritative confirmation.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env`
3. Add the Supabase project URL and publishable key
4. `npm run dev`

## MVP scope

The first release includes search/discovery, provider profiles, service/state/location pages, and a self-serve claim/correction flow. Paid workflow features come after directory validation.
