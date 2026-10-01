drop policy if exists "users_create_own_claims" on public.claims;

create policy "users_create_own_claims"
on public.claims
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'::public.claim_status_enum
  and reviewed_at is null
  and reviewed_by is null
  and exists (
    select 1
    from public.facilities f
    where f.id = claims.facility_id
      and f.publish_status = 'publish'::public.publish_status_enum
  )
);

drop policy if exists "users_create_own_corrections" on public.corrections;

create policy "users_create_own_corrections"
on public.corrections
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'::public.correction_status_enum
  and exists (
    select 1
    from public.facilities f
    where f.id = corrections.facility_id
      and f.publish_status = 'publish'::public.publish_status_enum
  )
);
