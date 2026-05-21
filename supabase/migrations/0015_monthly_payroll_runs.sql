create table if not exists payroll_hour_records (
  id uuid primary key default gen_random_uuid(),
  payroll_period text not null,
  school_name text not null,
  status text not null default 'Draft',
  submitted_at timestamptz,
  submitted_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period, school_name)
);

create table if not exists payroll_hour_rows (
  id uuid primary key default gen_random_uuid(),
  payroll_hour_record_id uuid not null references payroll_hour_records(id) on delete cascade,
  staff_record_id uuid not null references staff_records(id),
  staff_name text,
  paid_hours numeric(7,2) not null default 0,
  rate numeric(8,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  payroll_period text not null unique,
  status text not null default 'Draft',
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id),
  approved_at timestamptz,
  approved_by uuid references profiles(id),
  paid_at timestamptz,
  paid_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_run_adjustments (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id) on delete cascade,
  staff_record_id uuid not null references staff_records(id),
  expenses numeric(8,2) not null default 0,
  deductions numeric(8,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_run_id, staff_record_id)
);

alter table payroll_hour_records enable row level security;
alter table payroll_hour_rows enable row level security;
alter table payroll_runs enable row level security;
alter table payroll_run_adjustments enable row level security;

grant select, insert, update, delete on payroll_hour_records to authenticated;
grant select, insert, update, delete on payroll_hour_rows to authenticated;
grant select, insert, update, delete on payroll_runs to authenticated;
grant select, insert, update, delete on payroll_run_adjustments to authenticated;

drop policy if exists "payroll_hour_records_admin_all" on payroll_hour_records;
create policy "payroll_hour_records_admin_all" on payroll_hour_records for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

drop policy if exists "payroll_hour_records_staff_own" on payroll_hour_records;
create policy "payroll_hour_records_staff_own" on payroll_hour_records for select using (
  exists (
    select 1
    from payroll_hour_rows r
    join staff_records s on s.id = r.staff_record_id
    where r.payroll_hour_record_id = payroll_hour_records.id
      and s.profile_id = auth.uid()
  )
);

drop policy if exists "payroll_hour_records_manager_direct_reports" on payroll_hour_records;
create policy "payroll_hour_records_manager_direct_reports" on payroll_hour_records for select using (
  exists (
    select 1
    from payroll_hour_rows r
    join hr_reporting_lines h on h.staff_record_id = r.staff_record_id
    join staff_records manager_record on manager_record.id = h.manager_staff_record_id
    where r.payroll_hour_record_id = payroll_hour_records.id
      and h.archived_at is null
      and manager_record.profile_id = auth.uid()
  )
);

drop policy if exists "payroll_hour_rows_admin_all" on payroll_hour_rows;
create policy "payroll_hour_rows_admin_all" on payroll_hour_rows for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

drop policy if exists "payroll_hour_rows_staff_own" on payroll_hour_rows;
create policy "payroll_hour_rows_staff_own" on payroll_hour_rows for select using (
  exists (select 1 from staff_records s where s.id = payroll_hour_rows.staff_record_id and s.profile_id = auth.uid())
);

drop policy if exists "payroll_hour_rows_manager_direct_reports" on payroll_hour_rows;
create policy "payroll_hour_rows_manager_direct_reports" on payroll_hour_rows for select using (
  exists (
    select 1
    from hr_reporting_lines h
    join staff_records manager_record on manager_record.id = h.manager_staff_record_id
    where h.staff_record_id = payroll_hour_rows.staff_record_id
      and h.archived_at is null
      and manager_record.profile_id = auth.uid()
  )
);

drop policy if exists "payroll_runs_admin_all" on payroll_runs;
create policy "payroll_runs_admin_all" on payroll_runs for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

drop policy if exists "payroll_runs_staff_read_own_periods" on payroll_runs;
create policy "payroll_runs_staff_read_own_periods" on payroll_runs for select using (
  exists (
    select 1
    from payroll_hour_records rec
    join payroll_hour_rows row on row.payroll_hour_record_id = rec.id
    join staff_records s on s.id = row.staff_record_id
    where rec.payroll_period = payroll_runs.payroll_period
      and s.profile_id = auth.uid()
  )
);

drop policy if exists "payroll_adjustments_admin_all" on payroll_run_adjustments;
create policy "payroll_adjustments_admin_all" on payroll_run_adjustments for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

drop policy if exists "payroll_adjustments_staff_own" on payroll_run_adjustments;
create policy "payroll_adjustments_staff_own" on payroll_run_adjustments for select using (
  exists (select 1 from staff_records s where s.id = payroll_run_adjustments.staff_record_id and s.profile_id = auth.uid())
);
