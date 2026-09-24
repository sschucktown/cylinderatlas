create type public.enrichment_run_status_enum as enum ('queued','running','completed','failed','cancelled');
create type public.identity_match_enum as enum ('matched','changed','conflict','unknown');
create type public.business_status_enum as enum ('active','inactive','internal','not_public','unknown');
create type public.external_customer_status_enum as enum ('yes','no','unknown');

create table public.enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  algorithm_version text not null,
  status public.enrichment_run_status_enum not null default 'queued',
  scope jsonb not null default '{}'::jsonb,
  sample_size integer,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table public.facility_enrichment_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.enrichment_runs(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  identity_match public.identity_match_enum not null default 'unknown',
  business_status public.business_status_enum not null default 'unknown',
  serves_external_customers public.external_customer_status_enum not null default 'unknown',
  identity_confidence numeric(5,4) not null default 0 check (identity_confidence between 0 and 1),
  service_confidence numeric(5,4) not null default 0 check (service_confidence between 0 and 1),
  decision public.publish_status_enum not null default 'review',
  service_keys text[] not null default '{}',
  current_name text,
  current_address text,
  manual_review_reason text,
  evidence_summary text,
  raw_result jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  unique(run_id, facility_id)
);

create index facility_enrichment_results_run_idx on public.facility_enrichment_results(run_id);
create index facility_enrichment_results_facility_idx on public.facility_enrichment_results(facility_id);
create index facility_enrichment_results_decision_idx on public.facility_enrichment_results(decision);

alter table public.facilities
  add column enrichment_run_id uuid references public.enrichment_runs(id) on delete set null,
  add column enrichment_version text,
  add column last_enriched_at timestamptz;

create index facilities_enrichment_run_idx on public.facilities(enrichment_run_id);
create index facilities_pipeline_status_idx on public.facilities(pipeline_status);

alter table public.enrichment_runs enable row level security;
alter table public.facility_enrichment_results enable row level security;

comment on table public.enrichment_runs is 'Backend-only audit log for enrichment batches; no public RLS policy by design.';
comment on table public.facility_enrichment_results is 'Backend-only evidence/decision snapshot for each facility enrichment attempt; no public RLS policy by design.';
