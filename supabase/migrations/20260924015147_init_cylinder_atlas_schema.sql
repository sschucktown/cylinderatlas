create type public.commercial_status_enum as enum ('yes','no','unknown');
create type public.publish_status_enum as enum ('publish','review','exclude');
create type public.service_status_enum as enum ('verified','inferred','provider_confirmed','rejected');
create type public.claim_status_enum as enum ('pending','verified','rejected');
create type public.correction_status_enum as enum ('pending','accepted','rejected');
create type public.evidence_type_enum as enum ('regulatory','first_party','business_registry','directory','provider_claim','other');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  legal_name text,
  website_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  rin text not null unique,
  phmsa_name text not null,
  phmsa_address text not null,
  display_name text,
  display_address text,
  city text not null,
  state text not null,
  postal_code text,
  phone text,
  website_url text,
  commercial_status public.commercial_status_enum not null default 'unknown',
  publish_status public.publish_status_enum not null default 'review',
  identity_confidence numeric(5,4) not null default 0 check (identity_confidence between 0 and 1),
  pipeline_status text not null default 'needs_enrichment',
  candidate_type_hint text,
  manual_review_reason text,
  verified_at timestamptz,
  source_effective_date date,
  source_row_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index facilities_state_idx on public.facilities(state);
create index facilities_city_state_idx on public.facilities(city,state);
create index facilities_publish_status_idx on public.facilities(publish_status);
create index facilities_commercial_status_idx on public.facilities(commercial_status);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  source text not null,
  raw_payload jsonb not null,
  hydrostatic_authorized boolean not null default false,
  effective_date date,
  captured_at timestamptz not null default now()
);

create index source_records_facility_id_idx on public.source_records(facility_id);

create table public.facility_services (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  service_key text not null check (service_key in (
    'fire-extinguisher-suppression',
    'scuba',
    'scba',
    'propane',
    'industrial-welding-gas',
    'medical-oxygen',
    'co2-beverage',
    'paintball',
    'specialty'
  )),
  status public.service_status_enum not null default 'inferred',
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(facility_id,service_key)
);

create index facility_services_service_key_idx on public.facility_services(service_key);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  evidence_type public.evidence_type_enum not null,
  url text,
  supports_field text not null,
  summary text not null,
  captured_at timestamptz not null default now()
);

create index evidence_facility_id_idx on public.evidence(facility_id);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.claim_status_enum not null default 'pending',
  verification_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(facility_id,user_id)
);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  field_name text not null,
  proposed_value jsonb not null,
  status public.correction_status_enum not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.facilities enable row level security;
alter table public.source_records enable row level security;
alter table public.facility_services enable row level security;
alter table public.evidence enable row level security;
alter table public.claims enable row level security;
alter table public.corrections enable row level security;

create policy "public_read_published_facilities" on public.facilities for select to anon, authenticated using (publish_status = 'publish');

create policy "public_read_companies_with_published_facility" on public.companies for select to anon, authenticated using (
  exists (
    select 1 from public.facilities f
    where f.company_id = companies.id and f.publish_status = 'publish'
  )
);

create policy "public_read_services_for_published_facilities" on public.facility_services for select to anon, authenticated using (
  exists (
    select 1 from public.facilities f
    where f.id = facility_services.facility_id and f.publish_status = 'publish'
  )
);

create policy "users_read_own_claims" on public.claims for select to authenticated using (user_id = auth.uid());
create policy "users_create_own_claims" on public.claims for insert to authenticated with check (user_id = auth.uid());
create policy "users_read_own_corrections" on public.corrections for select to authenticated using (user_id = auth.uid());
create policy "users_create_own_corrections" on public.corrections for insert to authenticated with check (user_id = auth.uid());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger facilities_set_updated_at before update on public.facilities for each row execute function public.set_updated_at();
create trigger facility_services_set_updated_at before update on public.facility_services for each row execute function public.set_updated_at();
create trigger claims_set_updated_at before update on public.claims for each row execute function public.set_updated_at();
create trigger corrections_set_updated_at before update on public.corrections for each row execute function public.set_updated_at();
