create type public.public_source_purpose_enum as enum (
  'identity',
  'service',
  'provider_website'
);

create table public.facility_public_sources (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  purpose public.public_source_purpose_enum not null,
  source_type public.evidence_type_enum not null,
  url text not null check (url ~* '^https?://'),
  label text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (facility_id, purpose, url)
);

create index facility_public_sources_facility_id_idx
  on public.facility_public_sources(facility_id);

create index facility_public_sources_purpose_idx
  on public.facility_public_sources(purpose);

alter table public.facility_public_sources enable row level security;

revoke all on public.facility_public_sources from anon, authenticated;
grant select on public.facility_public_sources to anon, authenticated;
grant all on public.facility_public_sources to service_role;

create policy "public_read_sources_for_published_facilities"
on public.facility_public_sources
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.facilities f
    where f.id = facility_public_sources.facility_id
      and f.publish_status = 'publish'
  )
);
