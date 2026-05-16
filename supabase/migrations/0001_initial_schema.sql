create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('staff', 'manager', 'admin', 'superadmin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type enquiry_status as enum ('new', 'reviewing', 'follow_up', 'closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type incident_sensitivity as enum ('standard', 'safeguarding_restricted');
exception when duplicate_object then null;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'staff',
  full_name text not null,
  email text not null unique,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  preferred_name text,
  date_of_birth date,
  address text,
  emergency_contact jsonb,
  job_role text,
  employment_type text,
  start_date date,
  national_insurance_number text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists scr_checks (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references staff_records(id) on delete cascade,
  right_to_work jsonb not null default '{}'::jsonb,
  identity_checks jsonb not null default '{}'::jsonb,
  dbs jsonb not null default '{}'::jsonb,
  safeguarding jsonb not null default '{}'::jsonb,
  first_aid jsonb not null default '{}'::jsonb,
  annual_declarations jsonb not null default '{}'::jsonb,
  recruitment_checks jsonb not null default '{}'::jsonb,
  admin_review jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text,
  booking_platform text,
  booking_url text,
  public_notes text,
  operational_notes text,
  active boolean not null default true
);

create table if not exists programmes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  name text not null,
  category text not null,
  age_range text,
  booking_notes text,
  active boolean not null default true
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer,
  status text not null default 'planning',
  notes text
);

create table if not exists session_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  staff_record_id uuid not null references staff_records(id),
  assignment_type text not null default 'assigned',
  approved_hours numeric(6,2),
  unique (session_id, staff_record_id)
);

create table if not exists hr_reporting_lines (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references staff_records(id) on delete cascade,
  manager_staff_record_id uuid references staff_records(id),
  scope text,
  effective_from date not null default current_date,
  effective_to date,
  archived_at timestamptz,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists rota_requirements (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  programme_id uuid references programmes(id),
  session_type text not null,
  session_start time not null,
  session_end time not null,
  setup_minutes integer not null default 15,
  cleanup_minutes integer not null default 5,
  first_aider_required boolean not null default true,
  eyfs_level3_required boolean not null default true,
  active boolean not null default true
);

create table if not exists hours_entries (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references staff_records(id),
  session_id uuid references sessions(id),
  rota_requirement_id uuid references rota_requirements(id),
  setup_minutes integer not null default 0,
  session_minutes integer not null default 0,
  cleanup_minutes integer not null default 0,
  unpaid_break_minutes integer not null default 0,
  approval_status text not null default 'draft',
  payroll_period text,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists cover_moves (
  id uuid primary key default gen_random_uuid(),
  cover_staff_record_id uuid references staff_records(id),
  covered_staff_record_id uuid references staff_records(id),
  cover_staff_name text not null,
  covered_staff_name text not null,
  destination_site text not null,
  destination_address text,
  session_type text,
  session_time text,
  move_date date,
  reason text,
  notes text,
  cover_email text not null,
  covered_email text not null,
  email_status text not null default 'queued',
  sent_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  version text not null,
  storage_path text,
  published_at timestamptz,
  archived_at timestamptz
);

create table if not exists document_assignments (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id),
  staff_record_id uuid not null references staff_records(id),
  acknowledged_at timestamptz,
  due_at timestamptz,
  unique (document_version_id, staff_record_id)
);

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  organisation text,
  type text not null,
  subject text,
  role text,
  message text not null,
  status enquiry_status not null default 'new',
  owner_id uuid references profiles(id),
  internal_notes text,
  created_at timestamptz not null default now()
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id),
  location_id uuid references locations(id),
  session_id uuid references sessions(id),
  type text not null,
  sensitivity incident_sensitivity not null default 'standard',
  summary text not null,
  restricted_details text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table staff_records enable row level security;
alter table scr_checks enable row level security;
alter table hr_reporting_lines enable row level security;
alter table rota_requirements enable row level security;
alter table hours_entries enable row level security;
alter table cover_moves enable row level security;
alter table enquiries enable row level security;
alter table incidents enable row level security;

create policy "profiles_read_own" on profiles for select using (id = auth.uid());
create policy "profiles_admin_read_all" on profiles for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

create policy "staff_records_read_own" on staff_records for select using (profile_id = auth.uid());
create policy "staff_records_admin_all" on staff_records for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "staff_records_manager_direct_reports" on staff_records for select using (
  exists (
    select 1
    from hr_reporting_lines h
    join staff_records manager_record on manager_record.id = h.manager_staff_record_id
    where h.staff_record_id = staff_records.id
      and h.archived_at is null
      and manager_record.profile_id = auth.uid()
  )
);

create policy "scr_admin_read" on scr_checks for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "scr_manager_direct_reports" on scr_checks for select using (
  exists (
    select 1
    from hr_reporting_lines h
    join staff_records manager_record on manager_record.id = h.manager_staff_record_id
    where h.staff_record_id = scr_checks.staff_record_id
      and h.archived_at is null
      and manager_record.profile_id = auth.uid()
  )
);

create policy "hr_admin_all" on hr_reporting_lines for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "hr_manager_read_scope" on hr_reporting_lines for select using (
  exists (
    select 1
    from staff_records manager_record
    where manager_record.id = hr_reporting_lines.manager_staff_record_id
      and manager_record.profile_id = auth.uid()
  )
);

create policy "rota_requirements_read_authenticated" on rota_requirements for select using (auth.uid() is not null);
create policy "hours_admin_all" on hours_entries for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "hours_staff_own" on hours_entries for select using (
  exists (select 1 from staff_records s where s.id = hours_entries.staff_record_id and s.profile_id = auth.uid())
);
create policy "hours_manager_direct_reports" on hours_entries for select using (
  exists (
    select 1
    from hr_reporting_lines h
    join staff_records manager_record on manager_record.id = h.manager_staff_record_id
    where h.staff_record_id = hours_entries.staff_record_id
      and h.archived_at is null
      and manager_record.profile_id = auth.uid()
  )
);

create policy "cover_moves_admin_all" on cover_moves for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "cover_moves_manager_read_created" on cover_moves for select using (
  created_by = auth.uid()
);

create policy "enquiries_admin_all" on enquiries for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

create policy "incidents_reporter_read" on incidents for select using (reporter_id = auth.uid());
create policy "incidents_admin_standard" on incidents for select using (
  sensitivity = 'standard'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
create policy "incidents_superadmin_restricted" on incidents for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'superadmin')
);
