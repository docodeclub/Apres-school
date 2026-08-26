-- Holiday booking rules: Admin staff may request any working date; site staff are restricted to published school holidays.

create or replace function public.holiday_workspace()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_staff_id uuid;
  v_primary_site text;
  v_location_id uuid;
  v_result jsonb;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('staff','manager','admin','superadmin') then
    raise exception 'Active staff access is required.' using errcode = '42501';
  end if;
  select id, primary_site into v_staff_id, v_primary_site
  from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;
  select id into v_location_id from public.locations
  where lower(btrim(name)) = lower(btrim(coalesce(v_primary_site,''))) limit 1;

  select jsonb_build_object(
    'role', v_role,
    'currentStaffId', v_staff_id,
    'requestPolicy', case when v_role in ('admin','superadmin') then 'any_time' else 'school_holidays_only' end,
    'policySite', v_primary_site,
    'allowedWindows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', scp.id,
        'label', scp.label,
        'startsOn', scp.starts_on,
        'endsOn', scp.ends_on,
        'periodKind', scp.period_kind
      ) order by scp.starts_on)
      from public.school_calendar_periods scp
      where scp.location_id = v_location_id
        and scp.period_kind in ('half_term_holiday','seasonal_holiday')
        and scp.ends_on is not null
        and scp.ends_on >= current_date
    ), '[]'::jsonb),
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
  v_role app_role;
  v_staff_id uuid;
  v_primary_site text;
  v_location_id uuid;
  v_entitlement public.staff_holiday_entitlements%rowtype;
  v_reserved numeric := 0;
  v_request public.staff_absences%rowtype;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  select id, primary_site into v_staff_id, v_primary_site
  from public.staff_records where profile_id = auth.uid() and archived_at is null limit 1;
  if v_staff_id is null then raise exception 'A linked current staff record is required.' using errcode = '42501'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Choose a valid holiday date range.'; end if;
  if p_requested_hours is null or p_requested_hours <= 0 then raise exception 'Holiday hours must be greater than zero.'; end if;
  if p_day_portion not in ('full_day','morning','afternoon','custom') then raise exception 'Choose a valid day or part-day option.'; end if;

  if v_role not in ('admin','superadmin') then
    select id into v_location_id from public.locations
    where lower(btrim(name)) = lower(btrim(coalesce(v_primary_site,''))) limit 1;
    if v_location_id is null then
      raise exception 'Your usual school is not linked to a published calendar. Ask Admin to correct your staff record before requesting holiday.';
    end if;
    if exists (
      select 1
      from generate_series(p_start_date, p_end_date, interval '1 day') requested_day
      where extract(isodow from requested_day) between 1 and 5
        and not exists (
          select 1 from public.school_calendar_periods scp
          where scp.location_id = v_location_id
            and scp.period_kind in ('half_term_holiday','seasonal_holiday')
            and scp.ends_on is not null
            and requested_day::date between scp.starts_on and scp.ends_on
        )
    ) then
      raise exception 'Site staff can only request annual leave during published school holidays for %. Choose dates shown in the Holiday area or contact Admin.', coalesce(v_primary_site,'your school');
    end if;
  end if;

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
    'startDate',p_start_date,'endDate',p_end_date,'hours',p_requested_hours,'portion',p_day_portion,
    'requestPolicy',case when v_role in ('admin','superadmin') then 'any_time' else 'school_holidays_only' end,
    'policySite',v_primary_site
  ));
  return to_jsonb(v_request);
end;
$$;

grant execute on function public.holiday_workspace() to authenticated;
grant execute on function public.holiday_submit_request(date,date,numeric,text,text) to authenticated;
