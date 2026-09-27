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

## Bulk evidence harvester

The first acceleration slice keeps the existing `queued_enrichment` facility cursor and does not add a new database work-queue table.

Workflow for the initial fire/suppression batch:

```bash
npm run enrich:next -- --hint fire_suppression --limit 50 --output tmp/fire-50-candidates.json
npm run enrich:harvest -- --input tmp/fire-50-candidates.json --output tmp/fire-50-evidence.json --concurrency 5
npm run enrich:apply -- tmp/fire-50-evidence.json
```

The harvester:

- uses bounded parallel research (default 5, hard cap 10)
- retries transient research failures
- checkpoints atomically after each candidate and resumes already harvested records when rerun with the same input/output
- records usage counts so throughput and API cost can be measured
- validates evidence URLs against sources actually consulted by web search
- downgrades unverifiable source references to unresolved evidence rather than allowing a publish
- treats weak or missing evidence as a valid path to downstream manual review

`OPENAI_API_KEY` is server-only. `OPENAI_ENRICHMENT_MODEL` is optional and defaults to `gpt-5.6-terra`.

The harvester only gathers and extracts evidence. It never writes public provider state and never chooses publish/review/exclude. `apply-batch.ts` remains the deterministic gate and still updates the public facility row last.

An interrupted harvester writes `complete: false`; the applier refuses to consume that checkpoint. Records that fail harvesting are omitted from `records[]`, remain `queued_enrichment`, and can be retried on the next pass.

Before increasing to 100-record batches, manually audit 10 newly published decisions from the first 50 and check identity/location continuity, customer access, service evidence, provenance, and false-publish count.
