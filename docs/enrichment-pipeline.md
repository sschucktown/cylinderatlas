# Enrichment pipeline

The Phase-0 work showed that PHMSA is a strong regulatory starting point, but it is not a safe public directory feed by itself.

## Production rule

A facility is published only when all of the following are true:

1. PHMSA shows hydrostatic authorization for the RIN.
2. A current business identity can be matched to the PHMSA facility.
3. The business is active.
4. The facility serves outside customers rather than being an internal/captive operation.
5. At least one customer-facing cylinder-service category is supported by current evidence.
6. Identity and service confidence both clear the publish threshold.

Name heuristics are allowed to suggest likely categories, but they never publish a record by themselves.

## Why the identity gate is mandatory

The first 100-record production canary found exactly the failure mode we were worried about: an older PHMSA name can still point at a location now operated under a different company identity. That is useful source data, but publishing the old identity without reconciliation would create a stale directory listing.

Any move, acquisition, rename, or conflicting current address therefore becomes `review`.

## Decision outcomes

- **publish** — current identity + public/commercial status + service evidence are all strong.
- **review** — useful candidate, but identity/address/service evidence is incomplete or conflicting.
- **exclude** — inactive, internal/government, explicitly non-public, or otherwise not a customer-facing requalifier.

## Canary

The deterministic canary selector intentionally over-samples difficult cases:

- 30 fire/suppression
- 28 unknown
- 15 industrial gas
- 10 SCUBA
- 8 possible internal/government
- 8 aviation/specialty
- 1 paintball

This is a stress test, not a population-proportional sample.
