-- Staffing planner: sessions remain the operational source of truth.
-- Assignments, publication state, cover and paid windows are attached to those sessions.

alter table public.session_assignments
  add column if not exists session_role text not null default 'assistant',
  add column if not exists acting_manager boolean not null default false,
  add column if not exists acting_dsl boolean not null default false,
  add column if not exists acting_sendco boolean not null default false,
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists status text not null default 'assigned',
  add column if not exists acknowledgement_status text not null default 'draft',
  add column if not exists acknowledged_at timestamptz,
  add column if not exists publication_version integer,
  add column if not exists changed_since_acknowledgement boolean not null default false,
  add column if not exists operational_notes text,
  add column if not exists override_reason text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.session_assignments
  drop constraint if exists session_assignments_session_role_check;
alter table public.session_assignments
  add constraint session_assignments_session_role_check
  check (session_role in ('manager', 'dsl', 'sendco', 'assistant'));

alter table public.session_assignments
  drop constraint if exists session_assignments_status_check;
alter table public.session_assignments
  add constraint session_assignments_status_check
  check (status in ('assigned', 'sick', 'absent', 'on_leave', 'unable_to_attend', 'cover_required', 'cancelled'));

alter table public.session_assignments
  drop constraint if exists session_assignments_acknowledgement_check;
alter table public.session_assignments
  add constraint session_assignments_acknowledgement_check
  check (acknowledgement_status in ('draft', 'awaiting', 'acknowledged', 'changed', 'unable_to_attend'));

create index if not exists session_assignments_staff_window_idx
  on public.session_assignments (staff_record_id, scheduled_start, scheduled_end)
  where status not in ('cancelled', 'sick', 'absent', 'on_leave', 'unable_to_attend');

create table if not exists public.staffing_site_settings (
  location_id uuid primary key references public.locations(id) on delete cascade,
  default_manager_staff_id uuid references public.staff_records(id) on delete set null,
  default_dsl_staff_id uuid references public.staff_records(id) on delete set null,
  default_sendco_staff_id uuid references public.staff_records(id) on delete set null,
  setup_minutes integer not null default 15 check (setup_minutes between 0 and 180),
  closing_minutes integer not null default 15 check (closing_minutes between 0 and 180),
  minimum_staff integer not null default 2 check (minimum_staff between 1 and 50),
  children_per_staff integer not null default 8 check (children_per_staff between 1 and 50),
  first_aider_required boolean not null default true,
  level3_required boolean not null default true,
  sendco_required boolean not null default false,
  default_assignments jsonb not null default '{}'::jsonb,
  qualification_requirements jsonb not null default '[]'::jsonb,
  operational_notes text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staffing_site_settings (location_id)
select id from public.locations where active = true
on conflict (location_id) do nothing;

create table if not exists public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  weekday integer check (weekday between 1 and 7),
  available_from time,
  available_until time,
  specific_date date,
  availability_status text not null default 'available'
    check (availability_status in ('available', 'preferred', 'unavailable')),
  preferred_location_ids uuid[] not null default '{}',
  maximum_weekly_minutes integer check (maximum_weekly_minutes is null or maximum_weekly_minutes >= 0),
  note text,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (weekday is not null or specific_date is not null),
  check (available_until is null or available_from is null or available_until > available_from)
);

create unique index if not exists staff_availability_recurring_unique_idx
  on public.staff_availability (staff_record_id, weekday)
  where specific_date is null;
create unique index if not exists staff_availability_date_unique_idx
  on public.staff_availability (staff_record_id, specific_date)
  where specific_date is not null;

create table if not exists public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  absence_type text not null check (absence_type in ('annual_leave', 'sickness', 'training', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'approved' check (status in ('requested', 'approved', 'declined', 'cancelled')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists staff_absences_staff_window_idx
  on public.staff_absences (staff_record_id, starts_at, ends_at)
  where status in ('requested', 'approved');

create table if not exists public.rota_publications (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  version integer not null,
  status text not null default 'published' check (status in ('draft', 'published', 'superseded')),
  warning_snapshot jsonb not null default '[]'::jsonb,
  assignment_snapshot jsonb not null default '[]'::jsonb,
  override_reason text,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end, version),
  check (period_end >= period_start)
);

create table if not exists public.staffing_cover_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  assignment_id uuid references public.session_assignments(id) on delete set null,
  vacancies integer not null default 1 check (vacancies > 0),
  required_role text not null default 'assistant',
  required_qualifications jsonb not null default '[]'::jsonb,
  reason text not null default 'Cover required',
  notes text,
  status text not null default 'open' check (status in ('open', 'requested', 'viewed', 'accepted', 'declined', 'filled', 'cancelled')),
  requested_staff_ids uuid[] not null default '{}',
  viewed_staff_ids uuid[] not null default '{}',
  declined_staff_ids uuid[] not null default '{}',
  accepted_by_staff_id uuid references public.staff_records(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  filled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hours_entries
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists actual_start timestamptz,
  add column if not exists actual_end timestamptz,
  add column if not exists actual_minutes integer,
  add column if not exists variance_minutes integer,
  add column if not exists exception_type text,
  add column if not exists exception_note text,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists hours_entries_staff_session_unique_idx
  on public.hours_entries (staff_record_id, session_id)
  where session_id is not null;

alter table public.staffing_site_settings enable row level security;
alter table public.staff_availability enable row level security;
alter table public.staff_absences enable row level security;
alter table public.rota_publications enable row level security;
alter table public.staffing_cover_requests enable row level security;

grant select on public.staffing_site_settings, public.staff_availability, public.staff_absences,
  public.rota_publications, public.staffing_cover_requests to authenticated;
grant insert, update, delete on public.staffing_site_settings, public.staff_availability,
  public.staff_absences, public.rota_publications, public.staffing_cover_requests to authenticated;

drop policy if exists "Staffing settings read" on public.staffing_site_settings;
create policy "Staffing settings read" on public.staffing_site_settings for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('staff','manager','admin','superadmin')));
drop policy if exists "Staffing settings manage" on public.staffing_site_settings;
create policy "Staffing settings manage" on public.staffing_site_settings for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')));

drop policy if exists "Staff availability read" on public.staff_availability;
create policy "Staff availability read" on public.staff_availability for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_availability.staff_record_id and s.profile_id = auth.uid())
);
drop policy if exists "Staff availability manage" on public.staff_availability;
create policy "Staff availability manage" on public.staff_availability for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_availability.staff_record_id and s.profile_id = auth.uid())
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_availability.staff_record_id and s.profile_id = auth.uid())
);

drop policy if exists "Staff absences read" on public.staff_absences;
create policy "Staff absences read" on public.staff_absences for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_absences.staff_record_id and s.profile_id = auth.uid())
);
drop policy if exists "Staff absences manage" on public.staff_absences;
create policy "Staff absences manage" on public.staff_absences for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_absences.staff_record_id and s.profile_id = auth.uid())
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.id = staff_absences.staff_record_id and s.profile_id = auth.uid())
);

drop policy if exists "Rota publications read" on public.rota_publications;
create policy "Rota publications read" on public.rota_publications for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('staff','manager','admin','superadmin')));
drop policy if exists "Rota publications manage" on public.rota_publications;
create policy "Rota publications manage" on public.rota_publications for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')));

drop policy if exists "Cover requests read" on public.staffing_cover_requests;
create policy "Cover requests read" on public.staffing_cover_requests for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
  or exists (select 1 from public.staff_records s where s.profile_id = auth.uid() and (s.id = any(requested_staff_ids) or s.id = accepted_by_staff_id))
);
drop policy if exists "Cover requests manage" on public.staffing_cover_requests;
create policy "Cover requests manage" on public.staffing_cover_requests for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin')));

drop policy if exists "Staffing sessions read" on public.sessions;
create policy "Staffing sessions read" on public.sessions for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('staff','manager','admin','superadmin')));
drop policy if exists "Staffing programmes read" on public.programmes;
create policy "Staffing programmes read" on public.programmes for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('staff','manager','admin','superadmin')));
drop policy if exists "Staffing locations read" on public.locations;
create policy "Staffing locations read" on public.locations for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('staff','manager','admin','superadmin')));

drop policy if exists "Staffing assignments manager all" on public.session_assignments;
create policy "Staffing assignments manager all" on public.session_assignments for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role = 'manager'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role = 'manager'));
drop policy if exists "Staffing assignments staff own" on public.session_assignments;
create policy "Staffing assignments staff own" on public.session_assignments for select using (
  exists (select 1 from public.staff_records s where s.id = session_assignments.staff_record_id and s.profile_id = auth.uid())
);

create or replace function public.staffing_planner_for_range(p_date_from date, p_date_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_staff_id uuid;
  v_result jsonb;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('staff','manager','admin','superadmin') then
    raise exception 'Active staff access is required.' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to - p_date_from > 62 then
    raise exception 'Choose a valid staffing range of no more than 63 days.';
  end if;
  select id into v_staff_id from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;

  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(session_row order by session_row->>'startsAt') from (
        select jsonb_build_object(
          'id', s.id,
          'siteId', l.id,
          'siteName', l.name,
          'siteArea', l.area,
          'programmeId', p.id,
          'programmeName', p.name,
          'serviceType', p.category,
          'startsAt', s.starts_at,
          'endsAt', s.ends_at,
          'capacity', s.capacity,
          'status', s.status,
          'bookingCount', (select coalesce(sum(bi.quantity),0) from public.booking_items bi join public.bookings b on b.id = bi.booking_id where bi.session_id = s.id and bi.status in ('confirmed','attended') and b.status = 'confirmed'),
          'expectedCount', (select count(*) from public.booking_items bi join public.bookings b on b.id = bi.booking_id left join public.booking_register_entries bre on bre.booking_item_id = bi.id where bi.session_id = s.id and bi.status in ('confirmed','attended') and b.status = 'confirmed' and coalesce(bre.attendance_status,'booked') <> 'absent'),
          'presentCount', (select count(*) from public.booking_items bi join public.booking_register_entries bre on bre.booking_item_id = bi.id where bi.session_id = s.id and bre.attendance_status = 'checked_in'),
          'settings', jsonb_build_object(
            'setupMinutes', coalesce(ss.setup_minutes,15),
            'closingMinutes', coalesce(ss.closing_minutes,15),
            'minimumStaff', coalesce(ss.minimum_staff,2),
            'childrenPerStaff', coalesce(ss.children_per_staff,8),
            'firstAiderRequired', coalesce(ss.first_aider_required,true),
            'level3Required', coalesce(ss.level3_required,true),
            'sendcoRequired', coalesce(ss.sendco_required,false),
            'defaultManagerStaffId', ss.default_manager_staff_id,
            'defaultDslStaffId', ss.default_dsl_staff_id,
            'defaultSendcoStaffId', ss.default_sendco_staff_id,
            'operationalNotes', ss.operational_notes
          ),
          'assignments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', sa.id,
              'staffRecordId', sa.staff_record_id,
              'staffName', coalesce(sr.preferred_name, pr.full_name, 'Staff member'),
              'photoUrl', sr.photo_url,
              'jobRole', sr.job_role,
              'sessionRole', sa.session_role,
              'actingManager', sa.acting_manager,
              'actingDsl', sa.acting_dsl,
              'actingSendco', sa.acting_sendco,
              'scheduledStart', sa.scheduled_start,
              'scheduledEnd', sa.scheduled_end,
              'status', sa.status,
              'acknowledgementStatus', sa.acknowledgement_status,
              'acknowledgedAt', sa.acknowledged_at,
              'publicationVersion', sa.publication_version,
              'changedSinceAcknowledgement', sa.changed_since_acknowledgement,
              'operationalNotes', sa.operational_notes,
              'sortOrder', sa.sort_order
            ) order by sa.sort_order, coalesce(sr.preferred_name,pr.full_name))
            from public.session_assignments sa
            join public.staff_records sr on sr.id = sa.staff_record_id
            join public.profiles pr on pr.id = sr.profile_id
            where sa.session_id = s.id and sa.status <> 'cancelled'
          ), '[]'::jsonb)
        ) session_row
        from public.sessions s
        join public.programmes p on p.id = s.programme_id
        join public.locations l on l.id = p.location_id
        left join public.staffing_site_settings ss on ss.location_id = l.id
        where (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to
          and s.status not in ('cancelled','closed')
          and p.active = true and l.active = true
          and (v_role <> 'staff' or exists (select 1 from public.session_assignments own_sa where own_sa.session_id = s.id and own_sa.staff_record_id = v_staff_id and own_sa.status <> 'cancelled'))
      ) rows
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.id,
        'profileId', sr.profile_id,
        'name', coalesce(sr.preferred_name, pr.full_name, 'Staff member'),
        'email', pr.email,
        'accessRole', pr.role,
        'jobRole', sr.job_role,
        'employmentType', coalesce(sr.contract_type,sr.employment_type),
        'primarySite', sr.primary_site,
        'photoUrl', sr.photo_url,
        'payRate', case when v_role in ('admin','superadmin') then sr.pay_rate else null end,
        'qualifications', jsonb_build_object(
          'manager', pr.role in ('manager','admin','superadmin') or lower(coalesce(sr.job_role,'')) like '%manager%',
          'dsl', lower(coalesce(sr.job_role,'')) like '%dsl%' or lower(coalesce(sr.job_role,'')) like '%safeguard%',
          'sendco', lower(coalesce(sr.job_role,'')) like '%sendco%' or lower(coalesce(sr.job_role,'')) like '%senco%',
          'firstAid', coalesce(sc.first_aid,'{}'::jsonb) <> '{}'::jsonb,
          'level3', lower(coalesce(sc.recruitment_checks->>'eyfsLevel',sc.recruitment_checks->>'eyfs_level',sc.admin_review#>>'{qualifications,eyfsLevel}','')) like '%level 3%',
          'eyfs', lower(coalesce(sc.recruitment_checks->>'eyfsLevel',sc.recruitment_checks->>'eyfs_level',sc.admin_review#>>'{qualifications,eyfsLevel}','')) like '%level%'
        )
      ) order by coalesce(sr.preferred_name,pr.full_name))
      from public.staff_records sr
      join public.profiles pr on pr.id = sr.profile_id
      left join public.scr_checks sc on sc.staff_record_id = sr.id
      where sr.archived_at is null and pr.active = true
        and (v_role <> 'staff' or sr.id = v_staff_id)
    ), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(a)) from public.staff_availability a where (v_role <> 'staff' or a.staff_record_id = v_staff_id)), '[]'::jsonb),
    'absences', coalesce((select jsonb_agg(to_jsonb(a)) from public.staff_absences a where a.status in ('requested','approved') and a.ends_at >= p_date_from::timestamptz and a.starts_at < (p_date_to + 1)::timestamptz and (v_role <> 'staff' or a.staff_record_id = v_staff_id)), '[]'::jsonb),
    'publications', coalesce((select jsonb_agg(to_jsonb(rp) order by rp.version desc) from public.rota_publications rp where rp.period_end >= p_date_from and rp.period_start <= p_date_to), '[]'::jsonb),
    'coverRequests', coalesce((select jsonb_agg(to_jsonb(cr) order by cr.created_at desc) from public.staffing_cover_requests cr join public.sessions cs on cs.id = cr.session_id where (cs.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to and (v_role <> 'staff' or v_staff_id = any(cr.requested_staff_ids) or cr.accepted_by_staff_id = v_staff_id)), '[]'::jsonb),
    'role', v_role,
    'currentStaffId', v_staff_id
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.staffing_save_assignment(
  p_session_id uuid,
  p_staff_record_id uuid,
  p_session_role text default 'assistant',
  p_acting_manager boolean default false,
  p_acting_dsl boolean default false,
  p_acting_sendco boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_session public.sessions%rowtype;
  v_location_id uuid;
  v_setup integer := 15;
  v_closing integer := 15;
  v_start timestamptz;
  v_end timestamptz;
  v_assignment public.session_assignments%rowtype;
  v_conflict text;
  v_session_minutes integer;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Staffing edit access is required.' using errcode='42501'; end if;
  select s.* into v_session from public.sessions s where s.id=p_session_id;
  select p.location_id into v_location_id from public.programmes p where p.id=v_session.programme_id;
  if v_session.id is null then raise exception 'Session not found.'; end if;
  if not exists (select 1 from public.staff_records sr join public.profiles pr on pr.id=sr.profile_id where sr.id=p_staff_record_id and sr.archived_at is null and pr.active=true) then raise exception 'This staff member is not active.'; end if;
  select coalesce(setup_minutes,15), coalesce(closing_minutes,15) into v_setup,v_closing from public.staffing_site_settings where location_id=v_location_id;
  v_start := v_session.starts_at - make_interval(mins => v_setup);
  v_end := v_session.ends_at + make_interval(mins => v_closing);
  select coalesce(pr.full_name,'Another shift') into v_conflict
  from public.session_assignments sa
  join public.sessions other_s on other_s.id=sa.session_id
  join public.staff_records other_sr on other_sr.id=sa.staff_record_id
  join public.profiles pr on pr.id=other_sr.profile_id
  where sa.staff_record_id=p_staff_record_id and sa.session_id<>p_session_id
    and sa.status not in ('cancelled','sick','absent','on_leave','unable_to_attend')
    and coalesce(sa.scheduled_start,other_s.starts_at) < v_end
    and coalesce(sa.scheduled_end,other_s.ends_at) > v_start
  limit 1;
  if v_conflict is not null and nullif(trim(coalesce(p_override_reason,'')),'') is null then
    raise exception 'STAFF_CONFLICT|This person already has an overlapping shift. Add an authorised override reason to continue.';
  end if;
  if exists (select 1 from public.staff_absences a where a.staff_record_id=p_staff_record_id and a.status in ('requested','approved') and a.starts_at < v_end and a.ends_at > v_start)
     and nullif(trim(coalesce(p_override_reason,'')),'') is null then
    raise exception 'STAFF_UNAVAILABLE|This person has leave, sickness or training recorded during the shift.';
  end if;
  insert into public.session_assignments (session_id,staff_record_id,assignment_type,session_role,acting_manager,acting_dsl,acting_sendco,scheduled_start,scheduled_end,status,acknowledgement_status,changed_since_acknowledgement,override_reason,created_by,updated_by,updated_at)
  values (p_session_id,p_staff_record_id,'assigned',case when p_session_role in ('manager','dsl','sendco','assistant') then p_session_role else 'assistant' end,p_acting_manager,p_acting_dsl,p_acting_sendco,v_start,v_end,'assigned','draft',false,nullif(trim(coalesce(p_override_reason,'')),''),auth.uid(),auth.uid(),now())
  on conflict (session_id,staff_record_id) do update set
    session_role=excluded.session_role, acting_manager=excluded.acting_manager, acting_dsl=excluded.acting_dsl,
    acting_sendco=excluded.acting_sendco, scheduled_start=excluded.scheduled_start, scheduled_end=excluded.scheduled_end,
    status='assigned', acknowledgement_status=case when session_assignments.acknowledgement_status='acknowledged' then 'changed' else session_assignments.acknowledgement_status end,
    changed_since_acknowledgement=session_assignments.acknowledgement_status='acknowledged', override_reason=excluded.override_reason,
    updated_by=auth.uid(), updated_at=now()
  returning * into v_assignment;
  v_session_minutes := greatest(0, round(extract(epoch from (v_session.ends_at-v_session.starts_at))/60)::integer);
  insert into public.hours_entries (staff_record_id,session_id,setup_minutes,session_minutes,cleanup_minutes,unpaid_break_minutes,approval_status,scheduled_start,scheduled_end,updated_by,updated_at)
  values (p_staff_record_id,p_session_id,v_setup,v_session_minutes,v_closing,0,'draft',v_start,v_end,auth.uid(),now())
  on conflict (staff_record_id,session_id) where session_id is not null do update set
    setup_minutes=excluded.setup_minutes,session_minutes=excluded.session_minutes,cleanup_minutes=excluded.cleanup_minutes,
    scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,updated_by=auth.uid(),updated_at=now();
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata) values(auth.uid(),'staffing_assignment_saved','session_assignments',v_assignment.id,jsonb_build_object('sessionId',p_session_id,'staffRecordId',p_staff_record_id,'role',v_assignment.session_role,'scheduledStart',v_start,'scheduledEnd',v_end,'overrideReason',p_override_reason));
  return to_jsonb(v_assignment);
end;
$$;

create or replace function public.staffing_remove_assignment(p_assignment_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_assignment public.session_assignments%rowtype;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Staffing edit access is required.' using errcode='42501'; end if;
  update public.session_assignments set status='cancelled', operational_notes=coalesce(nullif(trim(p_reason),''),operational_notes),updated_by=auth.uid(),updated_at=now() where id=p_assignment_id returning * into v_assignment;
  if v_assignment.id is null then raise exception 'Assignment not found.'; end if;
  update public.hours_entries set approval_status='cancelled',exception_note=coalesce(nullif(trim(p_reason),''),exception_note),updated_by=auth.uid(),updated_at=now() where session_id=v_assignment.session_id and staff_record_id=v_assignment.staff_record_id;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata) values(auth.uid(),'staffing_assignment_removed','session_assignments',v_assignment.id,jsonb_build_object('reason',p_reason));
  return to_jsonb(v_assignment);
end; $$;

create or replace function public.staffing_publish_rota(p_date_from date,p_date_to date,p_warnings jsonb default '[]'::jsonb,p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_version integer; v_publication public.rota_publications%rowtype; v_snapshot jsonb;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Rota publishing access is required.' using errcode='42501'; end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then raise exception 'Choose a valid publication range.'; end if;
  if jsonb_array_length(coalesce(p_warnings,'[]'::jsonb))>0 and nullif(trim(coalesce(p_override_reason,'')),'') is null then raise exception 'PUBLISH_WARNINGS|Resolve the warnings or provide an authorised override reason.'; end if;
  select coalesce(max(version),0)+1 into v_version from public.rota_publications where period_start=p_date_from and period_end=p_date_to;
  select coalesce(jsonb_agg(to_jsonb(sa) order by sa.session_id,sa.sort_order),'[]'::jsonb) into v_snapshot from public.session_assignments sa join public.sessions s on s.id=sa.session_id where (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to and sa.status<>'cancelled';
  update public.rota_publications set status='superseded' where period_start=p_date_from and period_end=p_date_to and status='published';
  insert into public.rota_publications(period_start,period_end,version,status,warning_snapshot,assignment_snapshot,override_reason,published_by,published_at)
  values(p_date_from,p_date_to,v_version,'published',coalesce(p_warnings,'[]'::jsonb),v_snapshot,nullif(trim(coalesce(p_override_reason,'')),''),auth.uid(),now()) returning * into v_publication;
  update public.session_assignments sa set publication_version=v_version,acknowledgement_status=case when acknowledgement_status='acknowledged' then 'changed' else 'awaiting' end,changed_since_acknowledgement=acknowledgement_status='acknowledged',updated_by=auth.uid(),updated_at=now() from public.sessions s where s.id=sa.session_id and (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to and sa.status<>'cancelled';
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata) values(auth.uid(),'staffing_rota_published','rota_publications',v_publication.id,jsonb_build_object('periodStart',p_date_from,'periodEnd',p_date_to,'version',v_version,'warnings',p_warnings,'overrideReason',p_override_reason));
  return to_jsonb(v_publication);
end; $$;

create or replace function public.staffing_acknowledge_assignment(p_assignment_id uuid,p_status text default 'acknowledged')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_staff_id uuid; v_assignment public.session_assignments%rowtype;
begin
  select id into v_staff_id from public.staff_records where profile_id=auth.uid() and archived_at is null limit 1;
  if v_staff_id is null then raise exception 'A linked staff record is required.' using errcode='42501'; end if;
  if p_status not in ('acknowledged','unable_to_attend') then raise exception 'Choose a valid acknowledgement status.'; end if;
  update public.session_assignments set acknowledgement_status=p_status,acknowledged_at=case when p_status='acknowledged' then now() else null end,changed_since_acknowledgement=false,status=case when p_status='unable_to_attend' then 'unable_to_attend' else status end,updated_by=auth.uid(),updated_at=now() where id=p_assignment_id and staff_record_id=v_staff_id and publication_version is not null returning * into v_assignment;
  if v_assignment.id is null then raise exception 'Published assignment not found.'; end if;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata) values(auth.uid(),'staffing_shift_'||p_status,'session_assignments',v_assignment.id,jsonb_build_object('sessionId',v_assignment.session_id));
  return to_jsonb(v_assignment);
end; $$;

grant execute on function public.staffing_planner_for_range(date,date) to authenticated;
grant execute on function public.staffing_save_assignment(uuid,uuid,text,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.staffing_remove_assignment(uuid,text) to authenticated;
grant execute on function public.staffing_publish_rota(date,date,jsonb,text) to authenticated;
grant execute on function public.staffing_acknowledge_assignment(uuid,text) to authenticated;
