alter table public.scr_checks
  add constraint scr_checks_staff_record_id_key unique (staff_record_id);

grant select, insert, update on public.scr_checks to authenticated;
grant all privileges on public.scr_checks to service_role;

drop policy if exists "scr_admin_insert" on public.scr_checks;
create policy "scr_admin_insert" on public.scr_checks for insert with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "scr_admin_update" on public.scr_checks;
create policy "scr_admin_update" on public.scr_checks for update using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "scr_staff_read_own" on public.scr_checks;
create policy "scr_staff_read_own" on public.scr_checks for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = scr_checks.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

create table if not exists public.scr_evidence_requests (
  id text primary key,
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  evidence_key text not null,
  status text not null default 'Requested',
  note text,
  evidence_reference text,
  evidence_expiry_date date,
  submission_note text,
  rejection_reason text,
  requested_at timestamptz,
  requested_by uuid references public.profiles(id),
  requested_by_name text,
  submitted_at timestamptz,
  submitted_by_name text,
  resubmitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_by_name text,
  cleared_at timestamptz,
  cleared_by uuid references public.profiles(id),
  cleared_by_name text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scr_evidence_requests enable row level security;

grant select, insert, update on public.scr_evidence_requests to authenticated;
grant all privileges on public.scr_evidence_requests to service_role;

drop policy if exists "scr_evidence_admin_all" on public.scr_evidence_requests;
create policy "scr_evidence_admin_all" on public.scr_evidence_requests for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "scr_evidence_staff_read_own" on public.scr_evidence_requests;
create policy "scr_evidence_staff_read_own" on public.scr_evidence_requests for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = scr_evidence_requests.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

drop policy if exists "scr_evidence_staff_submit_own" on public.scr_evidence_requests;
create policy "scr_evidence_staff_submit_own" on public.scr_evidence_requests for update using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = scr_evidence_requests.staff_record_id
      and sr.profile_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = scr_evidence_requests.staff_record_id
      and sr.profile_id = auth.uid()
  )
);

drop policy if exists "scr_evidence_manager_direct_reports" on public.scr_evidence_requests;
create policy "scr_evidence_manager_direct_reports" on public.scr_evidence_requests for select using (
  public.current_user_manages_staff_record(staff_record_id)
);
