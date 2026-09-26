create index if not exists claims_reviewed_by_idx
  on public.claims(reviewed_by);

create policy "admins_read_own_membership"
on public.admin_users
for select
to authenticated
using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.admin_claims_queue() from anon;
revoke execute on function public.admin_review_claim(uuid, public.claim_status_enum) from anon;
