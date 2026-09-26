create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.claims
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null;

create index claims_status_idx on public.claims(status);

create or replace function public.admin_claims_queue()
returns table (
  claim_id uuid,
  facility_id uuid,
  claimant_user_id uuid,
  claimant_email text,
  claim_status public.claim_status_enum,
  verification_method text,
  claim_created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
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
    c.verification_method,
    c.created_at,
    c.reviewed_at,
    c.reviewed_by,
    f.rin,
    f.display_name,
    f.phmsa_name,
    f.city,
    f.state,
    f.display_address,
    f.phmsa_address
  from public.claims c
  join public.facilities f on f.id = c.facility_id
  join auth.users u on u.id = c.user_id
  order by
    case when c.status = 'pending' then 0 else 1 end,
    c.created_at desc;
end;
$$;

revoke all on function public.admin_claims_queue() from public;
grant execute on function public.admin_claims_queue() to authenticated;

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

  if p_status not in ('verified'::public.claim_status_enum, 'rejected'::public.claim_status_enum) then
    raise exception 'invalid review status' using errcode = '22023';
  end if;

  update public.claims
  set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = (select auth.uid())
  where id = p_claim_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.admin_review_claim(uuid, public.claim_status_enum) from public;
grant execute on function public.admin_review_claim(uuid, public.claim_status_enum) to authenticated;

comment on table public.admin_users is
  'Authorized Cylinder Atlas administrators. No client-facing RLS policies; access is mediated by security-definer admin functions.';

comment on function public.admin_claims_queue() is
  'Admin-only claim review queue with claimant email and facility context.';

comment on function public.admin_review_claim(uuid, public.claim_status_enum) is
  'Admin-only claim decision function. Only verified or rejected decisions are accepted.';
