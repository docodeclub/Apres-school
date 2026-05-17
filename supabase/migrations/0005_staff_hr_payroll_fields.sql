alter table public.staff_records
  add column if not exists pay_rate numeric(8,2),
  add column if not exists annual_salary numeric(10,2),
  add column if not exists contract_type text,
  add column if not exists primary_site text;

create table if not exists public.staff_pay_details (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null unique references public.staff_records(id) on delete cascade,
  contract_type text,
  hourly_rate numeric(8,2),
  annual_salary numeric(10,2),
  payroll_notes text,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_file_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sensitivity text not null default 'standard',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_hr_files (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  category_id uuid references public.hr_file_categories(id),
  title text not null,
  storage_path text,
  file_url text,
  issue_date date,
  expiry_date date,
  status text not null default 'active',
  notes text,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.staff_pay_details enable row level security;
alter table public.hr_file_categories enable row level security;
alter table public.staff_hr_files enable row level security;

drop policy if exists "staff_pay_details_admin_all" on public.staff_pay_details;
create policy "staff_pay_details_admin_all" on public.staff_pay_details for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_pay_details_staff_read_own" on public.staff_pay_details;
create policy "staff_pay_details_staff_read_own" on public.staff_pay_details for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = staff_pay_details.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

drop policy if exists "hr_file_categories_read_authenticated" on public.hr_file_categories;
create policy "hr_file_categories_read_authenticated" on public.hr_file_categories for select using (
  auth.uid() is not null
);

drop policy if exists "hr_file_categories_admin_all" on public.hr_file_categories;
create policy "hr_file_categories_admin_all" on public.hr_file_categories for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_hr_files_admin_all" on public.staff_hr_files;
create policy "staff_hr_files_admin_all" on public.staff_hr_files for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_hr_files_staff_read_own" on public.staff_hr_files;
create policy "staff_hr_files_staff_read_own" on public.staff_hr_files for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = staff_hr_files.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

insert into public.hr_file_categories (name, sensitivity)
values
  ('Contract', 'confidential'),
  ('Payslip', 'confidential_payroll'),
  ('Letter / Communication', 'confidential'),
  ('Disciplinary', 'restricted_hr'),
  ('Right to Work', 'confidential'),
  ('DBS', 'restricted_safeguarding'),
  ('Training Certificate', 'confidential'),
  ('ID / Lanyard', 'confidential')
on conflict (name) do update set
  sensitivity = excluded.sensitivity,
  active = true;
