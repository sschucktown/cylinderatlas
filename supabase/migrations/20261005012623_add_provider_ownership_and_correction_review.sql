create table public.facility_memberships (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'manager')),
  source_claim_id uuid references public.claims(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (facility_id, user_id)
);

create index facility_memberships_user_id_idx
  on public.facility_memberships(user_id);

create index facility_memberships_facility_id_idx
  on public.facility_memberships(facility_id);

alter table public.facility_memberships enable row level security;

revoke all on public.facility_memberships from anon, authenticated;
grant select on public.facility_memberships to authenticated;
grant all on public.facility_memberships to service_role;

create policy "users_read_own_facility_memberships"
on public.facility_memberships
for select
to authenticated
using (user_id = (select auth.uid()));

alter table public.corrections
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column admin_note text;

create index corrections_reviewed_by_idx
  on public.corrections(reviewed_by);

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
  end if;

  return updated_count = 1;
end;
$$;

revoke all on function public.admin_review_claim(uuid, public.claim_status_enum) from public;
grant execute on function public.admin_review_claim(uuid, public.claim_status_enum) to authenticated;

create or replace function public.admin_corrections_queue()
returns table (
  correction_id uuid,
  facility_id uuid,
  claimant_user_id uuid,
  claimant_email text,
  correction_status public.correction_status_enum,
  correction_type text,
  field_name text,
  proposed_value jsonb,
  correction_created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  admin_note text,
  rin text,
  display_name text,
  phmsa_name text,
  city text,
  state text,
  display_address text,
  phmsa_address text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.facility_id,
    c.user_id,
    u.email::text,
    c.status,
    c.correction_type,
    c.field_name,
    c.proposed_value,
    c.created_at,
    c.reviewed_at,
    c.reviewed_by,
    c.admin_note,
    f.rin,
    f.display_name,
    f.phmsa_name,
    f.city,
    f.state,
    f.display_address,
    f.phmsa_address
  from public.corrections c
  join public.facilities f on f.id = c.facility_id
  left join auth.users u on u.id = c.user_id
  order by
    case when c.status = 'pending' then 0 else 1 end,
    c.created_at desc;
end;
$$;

revoke all on function public.admin_corrections_queue() from public;
grant execute on function public.admin_corrections_queue() to authenticated;

create or replace function public.admin_review_correction(
  p_correction_id uuid,
  p_status public.correction_status_enum,
  p_admin_note text default null
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
    'accepted'::public.correction_status_enum,
    'rejected'::public.correction_status_enum
  ) then
    raise exception 'invalid review status' using errcode = '22023';
  end if;

  update public.corrections
  set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = (select auth.uid()),
    admin_note = nullif(trim(p_admin_note), '')
  where id = p_correction_id
    and status = 'pending'::public.correction_status_enum;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.admin_review_correction(uuid, public.correction_status_enum, text) from public;
grant execute on function public.admin_review_correction(uuid, public.correction_status_enum, text) to authenticated;

comment on table public.facility_memberships is
  'Verified provider-account ownership for published Cylinder Atlas facilities. Created by approved claims; users may read only their own memberships.';

comment on function public.admin_corrections_queue() is
  'Admin-only correction review queue with claimant and facility context.';

comment on function public.admin_review_correction(uuid, public.correction_status_enum, text) is
  'Admin-only correction decision. Does not automatically mutate regulated or public facility facts.';
