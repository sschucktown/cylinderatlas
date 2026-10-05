create type public.service_request_status_enum as enum ('new', 'contacted', 'won', 'not_fit');
create type public.service_request_event_enum as enum ('submitted', 'provider_opened', 'contacted', 'won', 'not_fit');

create table public.facility_intake_settings (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  customer_name text not null check (char_length(trim(customer_name)) between 1 and 100),
  customer_email text not null check (
    char_length(customer_email) <= 254
    and customer_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 40),
  service_key text not null,
  quantity integer check (quantity is null or quantity between 1 and 10000),
  timing text not null check (timing in ('asap', 'this_week', 'this_month', 'flexible')),
  notes text check (notes is null or char_length(notes) <= 2000),
  source_path text check (source_path is null or char_length(source_path) <= 500),
  status public.service_request_status_enum not null default 'new',
  provider_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  event_type public.service_request_event_enum not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index service_requests_facility_created_idx
  on public.service_requests (facility_id, created_at desc);
create index service_requests_facility_status_created_idx
  on public.service_requests (facility_id, status, created_at desc);
create index service_request_events_request_created_idx
  on public.service_request_events (request_id, created_at);

alter table public.facility_intake_settings enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_request_events enable row level security;

revoke all on public.facility_intake_settings from anon, authenticated;
grant select on public.facility_intake_settings to anon, authenticated;
grant update (enabled) on public.facility_intake_settings to authenticated;
grant all on public.facility_intake_settings to service_role;

revoke all on public.service_requests from anon, authenticated;
grant insert (
  facility_id,
  customer_name,
  customer_email,
  customer_phone,
  service_key,
  quantity,
  timing,
  notes,
  source_path
) on public.service_requests to anon, authenticated;
grant select on public.service_requests to authenticated;
grant update (status, provider_viewed_at) on public.service_requests to authenticated;
grant all on public.service_requests to service_role;

revoke all on public.service_request_events from anon, authenticated;
grant select on public.service_request_events to authenticated;
grant all on public.service_request_events to service_role;

create policy "public_read_enabled_intake_settings"
on public.facility_intake_settings
for select
to anon
using (
  enabled
  and exists (
    select 1
    from public.facilities f
    where f.id = facility_intake_settings.facility_id
      and f.publish_status = 'publish'::public.publish_status_enum
  )
);

create policy "authenticated_read_intake_settings"
on public.facility_intake_settings
for select
to authenticated
using (
  (
    enabled
    and exists (
      select 1
      from public.facilities f
      where f.id = facility_intake_settings.facility_id
        and f.publish_status = 'publish'::public.publish_status_enum
    )
  )
  or exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = facility_intake_settings.facility_id
      and m.user_id = (select auth.uid())
  )
);

create policy "providers_update_owned_intake_settings"
on public.facility_intake_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = facility_intake_settings.facility_id
      and m.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = facility_intake_settings.facility_id
      and m.user_id = (select auth.uid())
  )
);

create policy "public_submit_service_requests"
on public.service_requests
for insert
to anon, authenticated
with check (
  status = 'new'::public.service_request_status_enum
  and provider_viewed_at is null
  and exists (
    select 1
    from public.facility_intake_settings s
    join public.facilities f on f.id = s.facility_id
    where s.facility_id = service_requests.facility_id
      and s.enabled
      and f.publish_status = 'publish'::public.publish_status_enum
  )
  and exists (
    select 1
    from public.facility_services fs
    where fs.facility_id = service_requests.facility_id
      and fs.service_key = service_requests.service_key
      and fs.status in (
        'verified'::public.service_status_enum,
        'provider_confirmed'::public.service_status_enum
      )
  )
);

create policy "providers_read_owned_service_requests"
on public.service_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = service_requests.facility_id
      and m.user_id = (select auth.uid())
  )
);

create policy "providers_update_owned_service_requests"
on public.service_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = service_requests.facility_id
      and m.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.facility_memberships m
    where m.facility_id = service_requests.facility_id
      and m.user_id = (select auth.uid())
  )
);

create policy "providers_read_owned_service_request_events"
on public.service_request_events
for select
to authenticated
using (
  exists (
    select 1
    from public.service_requests r
    join public.facility_memberships m on m.facility_id = r.facility_id
    where r.id = service_request_events.request_id
      and m.user_id = (select auth.uid())
  )
);

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.log_service_request_submitted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.service_request_events (request_id, event_type)
  values (new.id, 'submitted'::public.service_request_event_enum);
  return new;
end;
$$;

create or replace function private.log_service_request_changes()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if old.provider_viewed_at is null and new.provider_viewed_at is not null then
    insert into public.service_request_events (request_id, event_type, actor_user_id)
    values (
      new.id,
      'provider_opened'::public.service_request_event_enum,
      (select auth.uid())
    );
  end if;

  if old.status is distinct from new.status
    and new.status <> 'new'::public.service_request_status_enum then
    insert into public.service_request_events (request_id, event_type, actor_user_id)
    values (
      new.id,
      case new.status
        when 'contacted'::public.service_request_status_enum
          then 'contacted'::public.service_request_event_enum
        when 'won'::public.service_request_status_enum
          then 'won'::public.service_request_event_enum
        when 'not_fit'::public.service_request_status_enum
          then 'not_fit'::public.service_request_event_enum
      end,
      (select auth.uid())
    );
  end if;

  return new;
end;
$$;

create trigger facility_intake_settings_touch_updated_at
before update on public.facility_intake_settings
for each row execute function private.touch_updated_at();

create trigger service_requests_touch_updated_at
before update on public.service_requests
for each row execute function private.touch_updated_at();

create trigger service_requests_log_submitted
after insert on public.service_requests
for each row execute function private.log_service_request_submitted();

create trigger service_requests_log_changes
after update on public.service_requests
for each row execute function private.log_service_request_changes();

create or replace function public.admin_review_claim(
  p_claim_id uuid,
  p_status public.claim_status_enum
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  updated_count integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status not in (
    'verified'::public.claim_status_enum,
    'rejected'::public.claim_status_enum
  ) then
    raise exception 'invalid review status' using errcode = '22023';
  end if;

  update public.claims
  set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = (select auth.uid())
  where id = p_claim_id
    and status = 'pending'::public.claim_status_enum;

  get diagnostics updated_count = row_count;

  if updated_count = 1 and p_status = 'verified'::public.claim_status_enum then
    insert into public.facility_memberships (
      facility_id,
      user_id,
      role,
      source_claim_id
    )
    select facility_id, user_id, 'owner', id
    from public.claims
    where id = p_claim_id
    on conflict (facility_id, user_id) do nothing;

    insert into public.facility_intake_settings (facility_id, enabled)
    select facility_id, true
    from public.claims
    where id = p_claim_id
    on conflict (facility_id) do nothing;
  end if;

  return updated_count = 1;
end;
$$;

insert into public.facility_intake_settings (facility_id, enabled)
select distinct facility_id, true
from public.facility_memberships
on conflict (facility_id) do nothing;
