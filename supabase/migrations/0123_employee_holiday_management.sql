-- Employee holiday: entitlement, requests, approval, rota impact and payroll separation.

alter table public.staff_absences
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists requested_hours numeric(8,2),
  add column if not exists day_portion text not null default 'full_day',
  add column if not exists paid boolean not null default true,
  add column if not exists decision_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.staff_absences
set start_date = coalesce(start_date, (starts_at at time zone 'Europe/London')::date),
    end_date = coalesce(end_date, ((ends_at - interval '1 second') at time zone 'Europe/London')::date)
where start_date is null or end_date is null;

alter table public.staff_absences
  drop constraint if exists staff_absences_day_portion_check;
alter table public.staff_absences
  add constraint staff_absences_day_portion_check
  check (day_portion in ('full_day','morning','afternoon','custom'));

create table if not exists public.holiday_settings (
  id boolean primary key default true check (id),
  leave_year_start_month integer not null default 1 check (leave_year_start_month between 1 and 12),
  leave_year_start_day integer not null default 1 check (leave_year_start_day between 1 and 28),
  standard_day_hours numeric(5,2) not null default 6 check (standard_day_hours > 0 and standard_day_hours <= 24),
  default_allowance_hours numeric(8,2) not null default 0 check (default_allowance_hours >= 0),
  carry_forward_limit_hours numeric(8,2) not null default 0 check (carry_forward_limit_hours >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.holiday_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.staff_holiday_entitlements (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  leave_year_start date not null,
  leave_year_end date not null,
  allowance_hours numeric(8,2) not null default 0 check (allowance_hours >= 0),
  carried_forward_hours numeric(8,2) not null default 0 check (carried_forward_hours >= 0),
  adjustment_hours numeric(8,2) not null default 0,
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_record_id, leave_year_start),
  check (leave_year_end >= leave_year_start)
);

create table if not exists public.holiday_payroll_entries (
  id uuid primary key default gen_random_uuid(),
  absence_id uuid not null references public.staff_absences(id) on delete cascade,
  staff_record_id uuid not null references public.staff_records(id) on delete cascade,
  payroll_period text not null check (payroll_period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  paid_hours numeric(8,2) not null check (paid_hours > 0),
  status text not null default 'approved' check (status in ('approved','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(absence_id, payroll_period)
);

alter table public.session_assignments
  add column if not exists holiday_absence_id uuid references public.staff_absences(id) on delete set null;

create index if not exists staff_holiday_entitlements_staff_year_idx
  on public.staff_holiday_entitlements(staff_record_id, leave_year_start desc);
create index if not exists holiday_payroll_entries_period_idx
  on public.holiday_payroll_entries(payroll_period, staff_record_id);

alter table public.holiday_settings enable row level security;
alter table public.staff_holiday_entitlements enable row level security;
alter table public.holiday_payroll_entries enable row level security;

grant select on public.holiday_settings, public.staff_holiday_entitlements, public.holiday_payroll_entries to authenticated;
grant insert, update on public.holiday_settings, public.staff_holiday_entitlements to authenticated;

drop policy if exists "Holiday settings read" on public.holiday_settings;
create policy "Holiday settings read" on public.holiday_settings for select
using (public.current_user_app_role() in ('staff','manager','admin','superadmin'));

drop policy if exists "Holiday settings admin manage" on public.holiday_settings;
create policy "Holiday settings admin manage" on public.holiday_settings for all
using (public.current_user_app_role() in ('admin','superadmin'))
with check (public.current_user_app_role() in ('admin','superadmin'));

drop policy if exists "Holiday entitlement own or admin read" on public.staff_holiday_entitlements;
create policy "Holiday entitlement own or admin read" on public.staff_holiday_entitlements for select using (
  public.current_user_app_role() in ('admin','superadmin')
  or exists (select 1 from public.staff_records sr where sr.id = staff_record_id and sr.profile_id = auth.uid())
  or (
    public.current_user_app_role() = 'manager'
    and exists (
      select 1 from public.hr_reporting_lines hrl
      join public.staff_records manager_record on manager_record.id = hrl.manager_staff_record_id
      where hrl.staff_record_id = staff_holiday_entitlements.staff_record_id
        and manager_record.profile_id = auth.uid()
        and hrl.effective_to is null
    )
  )
);

drop policy if exists "Holiday payroll own or admin read" on public.holiday_payroll_entries;
create policy "Holiday payroll own or admin read" on public.holiday_payroll_entries for select using (
  public.current_user_app_role() in ('admin','superadmin')
  or exists (select 1 from public.staff_records sr where sr.id = staff_record_id and sr.profile_id = auth.uid())
);

-- Replace the original broad absence policies. Staff see their own; managers see direct reports; Admin sees all.
drop policy if exists "Staff absences read" on public.staff_absences;
create policy "Staff absences read" on public.staff_absences for select using (
  public.current_user_app_role() in ('admin','superadmin')
  or exists (select 1 from public.staff_records sr where sr.id = staff_record_id and sr.profile_id = auth.uid())
  or (
    public.current_user_app_role() = 'manager'
    and exists (
      select 1 from public.hr_reporting_lines hrl
      join public.staff_records manager_record on manager_record.id = hrl.manager_staff_record_id
      where hrl.staff_record_id = staff_absences.staff_record_id
        and manager_record.profile_id = auth.uid()
        and hrl.effective_to is null
    )
  )
);

drop policy if exists "Staff absences manage" on public.staff_absences;
revoke insert, update, delete on public.staff_absences from authenticated;

create or replace function public.holiday_workspace()
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
  select id into v_staff_id from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;

  select jsonb_build_object(
    'role', v_role,
    'currentStaffId', v_staff_id,
    'settings', coalesce((select to_jsonb(hs) from public.holiday_settings hs where id = true), '{}'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.id,
        'profileId', sr.profile_id,
        'name', coalesce(sr.preferred_name, p.full_name, 'Staff member'),
        'email', p.email,
        'role', sr.job_role,
        'site', sr.primary_site,
        'contractHours', sr.contract_hours
      ) order by coalesce(sr.preferred_name,p.full_name))
      from public.staff_records sr
      join public.profiles p on p.id = sr.profile_id
      where sr.archived_at is null and p.active = true and (
        v_role in ('admin','superadmin')
        or sr.id = v_staff_id
        or (v_role = 'manager' and exists (
          select 1 from public.hr_reporting_lines hrl
          where hrl.staff_record_id = sr.id and hrl.manager_staff_record_id = v_staff_id and hrl.effective_to is null
        ))
      )
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'staffRecordId', a.staff_record_id,
        'staffName', coalesce(sr.preferred_name,p.full_name,'Staff member'),
        'startDate', a.start_date,
        'endDate', a.end_date,
        'requestedHours', a.requested_hours,
        'dayPortion', a.day_portion,
        'paid', a.paid,
        'status', a.status,
        'note', a.note,
        'decisionNote', a.decision_note,
        'createdAt', a.created_at,
        'reviewedAt', a.reviewed_at,
        'approvedBy', a.approved_by,
        'cancelledAt', a.cancelled_at,
        'affectedShifts', (select count(*) from public.session_assignments sa where sa.holiday_absence_id = a.id)
      ) order by a.start_date desc, a.created_at desc)
      from public.staff_absences a
      join public.staff_records sr on sr.id = a.staff_record_id
      join public.profiles p on p.id = sr.profile_id
      where a.absence_type = 'annual_leave' and (
        v_role in ('admin','superadmin')
        or a.staff_record_id = v_staff_id
        or (v_role = 'manager' and exists (
          select 1 from public.hr_reporting_lines hrl
          where hrl.staff_record_id = a.staff_record_id and hrl.manager_staff_record_id = v_staff_id and hrl.effective_to is null
        ))
      )
    ), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'staffRecordId', e.staff_record_id,
        'leaveYearStart', e.leave_year_start,
        'leaveYearEnd', e.leave_year_end,
        'allowanceHours', e.allowance_hours,
        'carriedForwardHours', e.carried_forward_hours,
        'adjustmentHours', e.adjustment_hours,
        'note', e.note,
        'updatedAt', e.updated_at
      ))
      from public.staff_holiday_entitlements e
      where v_role in ('admin','superadmin')
        or e.staff_record_id = v_staff_id
        or (v_role = 'manager' and exists (
          select 1 from public.hr_reporting_lines hrl
          where hrl.staff_record_id = e.staff_record_id and hrl.manager_staff_record_id = v_staff_id and hrl.effective_to is null
        ))
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.holiday_submit_request(
  p_start_date date,
  p_end_date date,
  p_requested_hours numeric,
  p_day_portion text default 'full_day',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_entitlement public.staff_holiday_entitlements%rowtype;
  v_reserved numeric := 0;
  v_request public.staff_absences%rowtype;
begin
  select id into v_staff_id from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;
  if v_staff_id is null then raise exception 'A linked current staff record is required.' using errcode = '42501'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Choose a valid holiday date range.'; end if;
  if p_requested_hours is null or p_requested_hours <= 0 then raise exception 'Holiday hours must be greater than zero.'; end if;
  if p_day_portion not in ('full_day','morning','afternoon','custom') then raise exception 'Choose a valid day or part-day option.'; end if;
  if exists (
    select 1 from public.staff_absences a
    where a.staff_record_id = v_staff_id and a.absence_type = 'annual_leave'
      and a.status in ('requested','approved') and a.start_date <= p_end_date and a.end_date >= p_start_date
  ) then raise exception 'You already have a pending or approved holiday request covering these dates.'; end if;

  select * into v_entitlement from public.staff_holiday_entitlements e
  where e.staff_record_id = v_staff_id and p_start_date between e.leave_year_start and e.leave_year_end
  order by e.leave_year_start desc limit 1;
  if v_entitlement.id is null then raise exception 'Your holiday allowance has not been configured for this leave year. Contact Admin.'; end if;
  if p_end_date > v_entitlement.leave_year_end then raise exception 'Submit separate requests for different leave years.'; end if;

  select coalesce(sum(a.requested_hours),0) into v_reserved from public.staff_absences a
  where a.staff_record_id = v_staff_id and a.absence_type = 'annual_leave'
    and a.status in ('requested','approved') and a.start_date between v_entitlement.leave_year_start and v_entitlement.leave_year_end;
  if v_reserved + p_requested_hours > v_entitlement.allowance_hours + v_entitlement.carried_forward_hours + v_entitlement.adjustment_hours then
    raise exception 'This request exceeds your remaining holiday allowance.';
  end if;

  insert into public.staff_absences(
    staff_record_id, absence_type, starts_at, ends_at, start_date, end_date,
    requested_hours, day_portion, paid, status, note, created_by
  ) values (
    v_staff_id, 'annual_leave', p_start_date::timestamp at time zone 'Europe/London',
    (p_end_date + 1)::timestamp at time zone 'Europe/London', p_start_date, p_end_date,
    round(p_requested_hours,2), p_day_portion, true, 'requested', nullif(btrim(coalesce(p_note,'')),''), auth.uid()
  ) returning * into v_request;

  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'holiday_request_submitted','staff_absences',v_request.id,jsonb_build_object(
    'startDate',p_start_date,'endDate',p_end_date,'hours',p_requested_hours,'portion',p_day_portion
  ));
  return to_jsonb(v_request);
end;
$$;

create or replace function public.holiday_review_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_manager_staff_id uuid;
  v_request public.staff_absences%rowtype;
  v_working_days integer;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Holiday approval access is required.' using errcode = '42501'; end if;
  if p_decision not in ('approved','declined') then raise exception 'Choose approve or decline.'; end if;
  select * into v_request from public.staff_absences where id = p_request_id and absence_type = 'annual_leave' for update;
  if v_request.id is null then raise exception 'Holiday request not found.'; end if;
  if v_request.status <> 'requested' then raise exception 'Only pending holiday requests can be reviewed.'; end if;
  if v_role = 'manager' then
    select id into v_manager_staff_id from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;
    if not exists (
      select 1 from public.hr_reporting_lines hrl
      where hrl.staff_record_id = v_request.staff_record_id and hrl.manager_staff_record_id = v_manager_staff_id and hrl.effective_to is null
    ) then raise exception 'Managers can review direct reports only.' using errcode = '42501'; end if;
  end if;

  update public.staff_absences set
    status = p_decision,
    decision_note = nullif(btrim(coalesce(p_decision_note,'')),''),
    approved_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_request_id returning * into v_request;

  if p_decision = 'approved' then
    update public.session_assignments sa set
      status = 'cover_required', holiday_absence_id = v_request.id,
      operational_notes = concat_ws(' · ', nullif(sa.operational_notes,''), 'Approved annual leave'),
      changed_since_acknowledgement = sa.publication_version is not null,
      acknowledgement_status = case when sa.publication_version is not null then 'changed' else sa.acknowledgement_status end,
      updated_by = auth.uid(), updated_at = now()
    from public.sessions s
    where s.id = sa.session_id and sa.staff_record_id = v_request.staff_record_id
      and sa.status not in ('cancelled','sick','absent','on_leave','unable_to_attend')
      and s.starts_at < v_request.ends_at and s.ends_at > v_request.starts_at;

    select count(*) into v_working_days from generate_series(v_request.start_date,v_request.end_date,'1 day'::interval) d
    where extract(isodow from d) between 1 and 5;
    if v_working_days > 0 and v_request.paid then
      insert into public.holiday_payroll_entries(absence_id,staff_record_id,payroll_period,paid_hours,status)
      select v_request.id, v_request.staff_record_id, to_char(d,'YYYY-MM'),
        round(v_request.requested_hours * count(*) / v_working_days,2), 'approved'
      from generate_series(v_request.start_date,v_request.end_date,'1 day'::interval) d
      where extract(isodow from d) between 1 and 5
      group by to_char(d,'YYYY-MM')
      on conflict(absence_id,payroll_period) do update set paid_hours=excluded.paid_hours,status='approved',updated_at=now();
    end if;
  end if;

  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'holiday_request_'||p_decision,'staff_absences',v_request.id,jsonb_build_object(
    'staffRecordId',v_request.staff_record_id,'hours',v_request.requested_hours,'decisionNote',p_decision_note
  ));
  return to_jsonb(v_request);
end;
$$;

create or replace function public.holiday_cancel_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.staff_absences%rowtype;
  v_role app_role;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  select a.* into v_request from public.staff_absences a
  join public.staff_records sr on sr.id = a.staff_record_id
  where a.id = p_request_id and a.absence_type = 'annual_leave'
    and (sr.profile_id = auth.uid() or v_role in ('admin','superadmin')) for update;
  if v_request.id is null then raise exception 'Holiday request not found.'; end if;
  if v_request.status not in ('requested','approved') then raise exception 'This request can no longer be cancelled.'; end if;
  if v_request.start_date < current_date and v_role not in ('admin','superadmin') then raise exception 'Ask Admin to correct holiday that has already started.'; end if;

  update public.staff_absences set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_request.id returning * into v_request;
  update public.holiday_payroll_entries set status='cancelled',updated_at=now() where absence_id=v_request.id;
  update public.session_assignments set status='assigned',holiday_absence_id=null,
    operational_notes=replace(coalesce(operational_notes,''),' · Approved annual leave',''),
    changed_since_acknowledgement=publication_version is not null,
    acknowledgement_status=case when publication_version is not null then 'changed' else acknowledgement_status end,
    updated_by=auth.uid(),updated_at=now()
  where holiday_absence_id=v_request.id and status='cover_required';
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'holiday_request_cancelled','staff_absences',v_request.id,jsonb_build_object('staffRecordId',v_request.staff_record_id));
  return to_jsonb(v_request);
end;
$$;

create or replace function public.holiday_save_entitlement(
  p_staff_record_id uuid,
  p_leave_year_start date,
  p_leave_year_end date,
  p_allowance_hours numeric,
  p_carried_forward_hours numeric default 0,
  p_adjustment_hours numeric default 0,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.staff_holiday_entitlements%rowtype;
begin
  if public.current_user_app_role() not in ('admin','superadmin') then raise exception 'Admin access is required.' using errcode='42501'; end if;
  if p_leave_year_start is null or p_leave_year_end < p_leave_year_start then raise exception 'Choose a valid leave year.'; end if;
  if p_allowance_hours < 0 or p_carried_forward_hours < 0 then raise exception 'Holiday allowance cannot be negative.'; end if;
  insert into public.staff_holiday_entitlements(staff_record_id,leave_year_start,leave_year_end,allowance_hours,carried_forward_hours,adjustment_hours,note,updated_by,updated_at)
  values(p_staff_record_id,p_leave_year_start,p_leave_year_end,p_allowance_hours,p_carried_forward_hours,p_adjustment_hours,nullif(btrim(coalesce(p_note,'')),''),auth.uid(),now())
  on conflict(staff_record_id,leave_year_start) do update set leave_year_end=excluded.leave_year_end,allowance_hours=excluded.allowance_hours,
    carried_forward_hours=excluded.carried_forward_hours,adjustment_hours=excluded.adjustment_hours,note=excluded.note,updated_by=auth.uid(),updated_at=now()
  returning * into v_row;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'holiday_entitlement_saved','staff_holiday_entitlements',v_row.id,jsonb_build_object('staffRecordId',p_staff_record_id,'allowanceHours',p_allowance_hours,'leaveYearStart',p_leave_year_start));
  return to_jsonb(v_row);
end $$;

create or replace function public.holiday_save_settings(
  p_leave_year_start_month integer,
  p_leave_year_start_day integer,
  p_standard_day_hours numeric,
  p_default_allowance_hours numeric,
  p_carry_forward_limit_hours numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.holiday_settings%rowtype;
begin
  if public.current_user_app_role() not in ('admin','superadmin') then raise exception 'Admin access is required.' using errcode='42501'; end if;
  insert into public.holiday_settings(id,leave_year_start_month,leave_year_start_day,standard_day_hours,default_allowance_hours,carry_forward_limit_hours,updated_by,updated_at)
  values(true,p_leave_year_start_month,p_leave_year_start_day,p_standard_day_hours,p_default_allowance_hours,p_carry_forward_limit_hours,auth.uid(),now())
  on conflict(id) do update set leave_year_start_month=excluded.leave_year_start_month,leave_year_start_day=excluded.leave_year_start_day,
    standard_day_hours=excluded.standard_day_hours,default_allowance_hours=excluded.default_allowance_hours,
    carry_forward_limit_hours=excluded.carry_forward_limit_hours,updated_by=auth.uid(),updated_at=now()
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

grant execute on function public.holiday_workspace() to authenticated;
grant execute on function public.holiday_submit_request(date,date,numeric,text,text) to authenticated;
grant execute on function public.holiday_review_request(uuid,text,text) to authenticated;
grant execute on function public.holiday_cancel_request(uuid) to authenticated;
grant execute on function public.holiday_save_entitlement(uuid,date,date,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.holiday_save_settings(integer,integer,numeric,numeric,numeric) to authenticated;
