create table if not exists payroll_audit_events (
  id uuid primary key default gen_random_uuid(),
  payroll_period text not null,
  school_name text,
  action text not null,
  detail text,
  actor_id uuid references profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_audit_events_period_idx on payroll_audit_events (payroll_period, created_at desc);
create index if not exists payroll_audit_events_school_idx on payroll_audit_events (school_name, created_at desc);

alter table payroll_audit_events enable row level security;

grant select, insert on payroll_audit_events to authenticated;

drop policy if exists "payroll_audit_admin_read" on payroll_audit_events;
create policy "payroll_audit_admin_read" on payroll_audit_events for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

drop policy if exists "payroll_audit_admin_insert" on payroll_audit_events;
create policy "payroll_audit_admin_insert" on payroll_audit_events for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);
