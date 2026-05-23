alter table public.staff_records
  add column if not exists leaving_reason text,
  add column if not exists left_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

