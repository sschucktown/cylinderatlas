create index if not exists facilities_company_id_idx on public.facilities(company_id);
create index if not exists claims_user_id_idx on public.claims(user_id);
create index if not exists corrections_facility_id_idx on public.corrections(facility_id);
create index if not exists corrections_user_id_idx on public.corrections(user_id);

alter function public.set_updated_at() set search_path = public, pg_temp;

drop policy if exists "users_read_own_claims" on public.claims;
drop policy if exists "users_create_own_claims" on public.claims;
drop policy if exists "users_read_own_corrections" on public.corrections;
drop policy if exists "users_create_own_corrections" on public.corrections;

create policy "users_read_own_claims" on public.claims for select to authenticated using (user_id = (select auth.uid()));
create policy "users_create_own_claims" on public.claims for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users_read_own_corrections" on public.corrections for select to authenticated using (user_id = (select auth.uid()));
create policy "users_create_own_corrections" on public.corrections for insert to authenticated with check (user_id = (select auth.uid()));
