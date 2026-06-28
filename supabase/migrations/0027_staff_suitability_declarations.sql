create table if not exists public.staff_suitability_declarations (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  declaration_year integer not null,
  date_completed date not null default current_date,
  staff_member_name text not null,
  signed_by text not null,
  status text not null default 'Completed' check (status in ('Not Started', 'Completed', 'Expired')),
  next_due_date date not null,
  confirmations jsonb not null default '{}'::jsonb,
  final_confirmation boolean not null default false,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_suitability_declarations_staff_idx
  on public.staff_suitability_declarations(staff_record_id);

create index if not exists staff_suitability_declarations_due_idx
  on public.staff_suitability_declarations(next_due_date);

alter table public.staff_suitability_declarations enable row level security;

grant select, insert, update on public.staff_suitability_declarations to authenticated;
grant all privileges on public.staff_suitability_declarations to service_role;

drop policy if exists "staff_suitability_declarations_admin_all" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_admin_all" on public.staff_suitability_declarations for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_suitability_declarations_manager_read_reports" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_manager_read_reports" on public.staff_suitability_declarations for select using (
  public.current_user_manages_staff_record(staff_record_id)
);

drop policy if exists "staff_suitability_declarations_staff_read_own" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_staff_read_own" on public.staff_suitability_declarations for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = staff_suitability_declarations.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

drop policy if exists "staff_suitability_declarations_staff_insert_own" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_staff_insert_own" on public.staff_suitability_declarations for insert with check (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = staff_suitability_declarations.staff_record_id
      and sr.profile_id = auth.uid()
  )
);
