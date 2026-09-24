# Production enrichment canary — 100 records

Date: 2026-09-24

## Sample

The canary is a deterministic stress sample, not a population-proportional sample:

| Stratum | Records |
|---|---:|
| Fire / suppression | 30 |
| Unknown / ambiguous | 28 |
| Industrial gas | 15 |
| SCUBA | 10 |
| Possible internal / government | 8 |
| Aviation / specialty | 8 |
| Paintball | 1 |
| **Total** | **100** |

## Provisional classification

After deterministic inference plus current-web enrichment of the difficult tail:

| Decision | Records |
|---|---:|
| Publish candidate | 85 |
| Exclude | 10 |
| Manual review | 5 |

The five unresolved records were held rather than guessed:

- H121 — Dealer's Medical Equipment Solutions, Colorado Springs
- I770 — Brakwater International, Houston
- G842 — SafeTech USA, Atlanta
- N719 — H2 Manufacturing, Tulsa
- I484 — Shanghai Hongxin Aero-Mechanics, PHMSA location conflict

## 30-record audit

A separate 30-record audit mixed deterministic and web-enriched classifications.

Results:

- Service-category support: 30/30 had no identified category contradiction.
- Commercial/internal decision: 30/30 had no identified commercial-status contradiction.
- Current-identity check: 29/30 had no clear contradiction.
- One stale-identity failure was found: PHMSA RIN B416 is under the older A-1 National Fire name at 218 N Preston in Pasadena, TX, while current public evidence identifies the location as Summit Fire & Security.

That failure matters. The old record is still useful regulatory source data, but it is not safe to publish the historical business identity automatically.

## Decision

The canary supports continuing with Cylinder Atlas, but it changes the production rule:

**Name/service heuristics may suggest a category, but they may not publish a provider. Every publishable facility needs a fresh current-identity check.**

The final publish gate is therefore:

1. PHMSA hydrostatic authorization
2. Current identity matched to the RIN facility
3. Active business
4. Serves external customers
5. At least one evidence-backed service category
6. No address/name/acquisition conflict
7. Identity confidence >= 0.85
8. Service confidence >= 0.85

Moves, acquisitions, renames, and current-address conflicts go to review.

## Next production step

Run the same identity + commercial + service evidence pipeline across the remaining 1,632 facilities, then audit a fresh holdout before opening all approved records to public search.
