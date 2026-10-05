revoke execute on function public.admin_corrections_queue() from anon;
revoke execute on function public.admin_review_correction(uuid, public.correction_status_enum, text) from anon;
