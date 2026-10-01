alter table public.corrections
  add column correction_type text not null
  constraint corrections_correction_type_check
  check (correction_type in (
    'moved',
    'closed',
    'wrong_phone',
    'wrong_service',
    'duplicate',
    'other'
  ));

create index corrections_pending_type_created_idx
  on public.corrections (correction_type, created_at desc)
  where status = 'pending';
