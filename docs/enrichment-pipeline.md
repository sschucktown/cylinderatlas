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
npm run enrich:next -- --hint fire_suppression --limit 10 --output tmp/fire-cost-canary-10-candidates.json
npm run enrich:harvest -- --input tmp/fire-cost-canary-10-candidates.json --output tmp/fire-cost-canary-10-evidence.json --concurrency 5
npm run enrich:apply -- tmp/fire-cost-canary-10-evidence.json --dry-run
# Audit cost, evidence quality, and the preview before any production write.
```

The harvester:

- defaults to `gpt-6-luna`, reasoning `none`, and low web-search context
- enforces at most one built-in web-search tool call per facility
- caps model output at 800 tokens per facility
- uses bounded parallel research (default 5, hard cap 10), but paces GPT-6 Luna request starts to stay under token-per-minute limits
- respects OpenAI Retry-After/token-reset headers with shared backoff across workers
- retries only pre-response transient failures; it never repeats a paid search after a successful API response
- samples the first 10 records and stops automatically if the projected batch cost exceeds $2
- checkpoints atomically after each candidate and resumes already harvested records when rerun with the same input/output
- records usage counts so throughput and API cost can be measured
- validates evidence URLs against sources actually consulted by web search
- records explicit source-support semantics: which service keys the primary source itself supports, whether it proves outside-customer access, and whether corroboration proves identity/address/business status
- future evidence-semantics-v2 batches auto-publish services only from first-party, regulatory, or provider-confirmed primary evidence; directory/social evidence can still inform review but cannot clear publication by itself
- downgrades unverifiable source references to unresolved evidence rather than allowing a publish
- treats weak or missing evidence as a valid path to downstream manual review

`OPENAI_API_KEY` is server-only. `OPENAI_ENRICHMENT_MODEL` is optional and defaults to `gpt-6-luna`. The cost breaker can be tuned with `--cost-sample` and `--max-projected-cost`; keep the defaults until the cheaper path has passed its 10-record canary.

The harvester only gathers and extracts evidence. It never writes public provider state and never chooses publish/review/exclude. `apply-batch.ts` remains the deterministic gate and still updates the public facility row last.

An interrupted or partially failed harvester writes `complete: false`; the applier refuses to consume that checkpoint. Records that fail harvesting are omitted from `records[]`, remain `queued_enrichment`, and can be retried by rerunning the same input/output. Successful records are resumed rather than researched again.

For validated v2 batches, dry-run output includes `auditPublishCandidates`: the five highest-risk proposed publishes ranked by low confidence, multi-service breadth, address differences, and acquisition/rename/move signals. Audit those five plus every proposed exclusion before applying. Full publish/review candidate lists remain in the preview for deeper investigation when needed.

Before resuming larger batches, run a fresh 10-record cost canary and inspect actual API usage, estimated cost, identity/location continuity, customer access, service evidence, provenance, and false-publish count. Do not scale if quality regresses or projected cost exceeds the configured breaker.


## Targeted manual-review resolution

The first automated review-resolution slice handles `missing_identity_corroboration_only`.
It preserves already-qualified service/customer evidence and spends new research only on
independent current identity/location/business-status corroboration.

```bash
npm run enrich:review-next -- --bucket missing_identity_corroboration_only --limit 25 --output tmp/review-identity-next.json
npm run enrich:review-harvest -- --input tmp/review-identity-next.json --output tmp/review-identity-evidence.json --concurrency 5
npm run enrich:apply -- tmp/review-identity-evidence.json --dry-run
# Audit proposed publishes/excludes before any production write.
```

The review exporter is intentionally stricter than the raw review-bucket label:

- the active national enrichment run is selected; completed historical runs are skipped
- primary service evidence must be first-party, regulatory, or provider-confirmed
- the primary source must explicitly support outside-customer access
- only explicitly supported service keys are carried forward
- high-specificity taxonomy keys such as medical oxygen and beverage CO2 are removed unless the evidence summary explicitly supports that use case
- PHMSA name/address/city/state/postal fields are embedded in the packet so review research is facility-specific

The targeted review harvester:

- performs at most one web-search call per record
- preserves the existing primary service/customer evidence
- accepts web-researched corroboration only from a distinct first-party, regulatory, or business-registry source; `provider_claim` is reserved for evidence supplied through the provider-claim workflow
- treats suite/unit differences as material and never assumes a RIN moved with a business
- validates the selected corroboration URL against sources actually consulted
- records exactly which of identity, address, and business status the source supports
- checkpoints atomically, resumes completed records, and uses the same cost breaker pattern as the bulk harvester
- never writes Supabase and never decides publish/review/exclude

Only `apply-batch.ts` runs the deterministic decision gate. Always dry-run the
review-harvested packet before applying it.
