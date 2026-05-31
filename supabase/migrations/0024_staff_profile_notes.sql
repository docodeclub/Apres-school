create table if not exists public.staff_profile_notes (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null unique references public.staff_records(id) on delete cascade,
  manager_notes text,
  contract_notes text,
  compliance_notes text,
  payroll_notes text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_profile_notes enable row level security;

grant select, insert, update on public.staff_profile_notes to authenticated;
grant all privileges on public.staff_profile_notes to service_role;

drop policy if exists "staff_profile_notes_admin_all" on public.staff_profile_notes;
create policy "staff_profile_notes_admin_all" on public.staff_profile_notes for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);
