revoke all on table public.enrichment_runs from anon, authenticated;
revoke all on table public.evidence from anon, authenticated;
revoke all on table public.facility_enrichment_results from anon, authenticated;
revoke all on table public.source_records from anon, authenticated;

grant all on table public.enrichment_runs to service_role;
grant all on table public.evidence to service_role;
grant all on table public.facility_enrichment_results to service_role;
grant all on table public.source_records to service_role;
