-- Unplanned staff absence reporting, manager visibility, return-to-work closure and rota cover.

alter table public.staff_absences
  add column if not exists absence_category text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists actual_return_date date,
  add column if not exists return_to_work_note text;

alter table public.staff_absences
  drop constraint if exists staff_absences_category_check;
alter table public.staff_absences
  add constraint staff_absences_category_check check (
    absence_category is null or absence_category in (
      'sickness','medical','dependent_emergency','bereavement','unpaid_leave','other'
    )
  );

alter table public.session_assignments
  add column if not exists staff_absence_id uuid references public.staff_absences(id) on delete set null;

create index if not exists staff_absences_category_dates_idx
  on public.staff_absences(absence_category,start_date,end_date)
  where absence_type <> 'annual_leave' and status <> 'cancelled';

create or replace function public.absence_workspace()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_staff_id uuid;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('staff','manager','admin','superadmin') then raise exception 'Active staff access is required.' using errcode='42501'; end if;
  select id into v_staff_id from public.staff_records where profile_id=auth.uid() and archived_at is null limit 1;
  return jsonb_build_object(
    'currentStaffId',v_staff_id,
    'role',v_role,
    'absences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'staffRecordId',a.staff_record_id,
        'staffName',coalesce(sr.preferred_name,p.full_name,'Staff member'),
        'site',sr.primary_site,'category',coalesce(a.absence_category,a.absence_type),
        'startDate',a.start_date,'endDate',a.end_date,'status',a.status,
        'note',a.note,'createdAt',a.created_at,'createdBy',a.created_by,
        'closedAt',a.closed_at,'actualReturnDate',a.actual_return_date,
        'returnToWorkNote',a.return_to_work_note,
        'affectedShifts',(select count(*) from public.session_assignments sa where sa.staff_absence_id=a.id)
      ) order by a.start_date desc,a.created_at desc)
      from public.staff_absences a
      join public.staff_records sr on sr.id=a.staff_record_id
      join public.profiles p on p.id=sr.profile_id
      where a.absence_type <> 'annual_leave' and (
        v_role in ('admin','superadmin') or a.staff_record_id=v_staff_id or
        (v_role='manager' and exists(
          select 1 from public.hr_reporting_lines hrl where hrl.staff_record_id=a.staff_record_id
          and hrl.manager_staff_record_id=v_staff_id and hrl.effective_to is null
        ))
      )
    ),'[]'::jsonb)
  );
end $$;

create or replace function public.absence_save_report(
  p_staff_record_id uuid,
  p_start_date date,
  p_end_date date,
  p_category text,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_own_staff_id uuid; v_target_id uuid; v_row public.staff_absences%rowtype;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  select id into v_own_staff_id from public.staff_records where profile_id=auth.uid() and archived_at is null limit 1;
  v_target_id := coalesce(p_staff_record_id,v_own_staff_id);
  if v_target_id is null then raise exception 'A current staff record is required.' using errcode='42501'; end if;
  if v_target_id <> v_own_staff_id and v_role not in ('admin','superadmin') and not (
    v_role='manager' and exists(select 1 from public.hr_reporting_lines hrl
      where hrl.staff_record_id=v_target_id and hrl.manager_staff_record_id=v_own_staff_id and hrl.effective_to is null)
  ) then raise exception 'Managers can record absence for direct reports only.' using errcode='42501'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Choose a valid absence date range.'; end if;
  if p_category not in ('sickness','medical','dependent_emergency','bereavement','unpaid_leave','other') then raise exception 'Choose a valid absence reason.'; end if;
  if exists(select 1 from public.staff_absences a where a.staff_record_id=v_target_id and a.status <> 'cancelled'
    and a.start_date <= p_end_date and a.end_date >= p_start_date) then raise exception 'An absence or holiday record already covers these dates.'; end if;

  insert into public.staff_absences(staff_record_id,absence_type,absence_category,starts_at,ends_at,start_date,end_date,paid,status,note,created_by)
  values(v_target_id,case when p_category in ('sickness','medical') then 'sickness' else 'other' end,p_category,
    p_start_date::timestamp at time zone 'Europe/London',(p_end_date+1)::timestamp at time zone 'Europe/London',
    p_start_date,p_end_date,false,'approved',nullif(btrim(coalesce(p_note,'')),''),auth.uid()) returning * into v_row;

  update public.session_assignments sa set status='cover_required',staff_absence_id=v_row.id,
    operational_notes=concat_ws(' · ',nullif(sa.operational_notes,''),'Staff absence'),
    changed_since_acknowledgement=sa.publication_version is not null,
    acknowledgement_status=case when sa.publication_version is not null then 'changed' else sa.acknowledgement_status end,
    updated_by=auth.uid(),updated_at=now()
  from public.sessions s where s.id=sa.session_id and sa.staff_record_id=v_target_id
    and sa.status not in ('cancelled','sick','absent','on_leave','unable_to_attend')
    and s.starts_at < v_row.ends_at and s.ends_at > v_row.starts_at;

  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staff_absence_recorded','staff_absences',v_row.id,jsonb_build_object(
    'staffRecordId',v_target_id,'category',p_category,'startDate',p_start_date,'endDate',p_end_date
  ));
  return to_jsonb(v_row);
end $$;

create or replace function public.absence_close_report(
  p_absence_id uuid,
  p_actual_return_date date,
  p_return_to_work_note text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_own_staff_id uuid; v_row public.staff_absences%rowtype; v_return_at timestamptz;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Manager access is required to close an absence.' using errcode='42501'; end if;
  select id into v_own_staff_id from public.staff_records where profile_id=auth.uid() and archived_at is null limit 1;
  select * into v_row from public.staff_absences where id=p_absence_id and absence_type <> 'annual_leave' for update;
  if v_row.id is null then raise exception 'Absence record not found.'; end if;
  if v_role='manager' and not exists(select 1 from public.hr_reporting_lines hrl where hrl.staff_record_id=v_row.staff_record_id and hrl.manager_staff_record_id=v_own_staff_id and hrl.effective_to is null)
    then raise exception 'Managers can close absence for direct reports only.' using errcode='42501'; end if;
  if p_actual_return_date is null or p_actual_return_date <= v_row.start_date then raise exception 'The first day back must be after the absence started.'; end if;
  v_return_at := p_actual_return_date::timestamp at time zone 'Europe/London';

  update public.session_assignments sa set status='assigned',staff_absence_id=null,
    operational_notes=replace(coalesce(sa.operational_notes,''),' · Staff absence',''),
    changed_since_acknowledgement=sa.publication_version is not null,
    acknowledgement_status=case when sa.publication_version is not null then 'changed' else sa.acknowledgement_status end,
    updated_by=auth.uid(),updated_at=now()
  from public.sessions s where s.id=sa.session_id and sa.staff_absence_id=v_row.id
    and sa.status='cover_required' and s.starts_at >= v_return_at;

  update public.session_assignments sa set status='cover_required',staff_absence_id=v_row.id,
    operational_notes=case when position('Staff absence' in coalesce(sa.operational_notes,''))>0 then sa.operational_notes else concat_ws(' · ',nullif(sa.operational_notes,''),'Staff absence') end,
    changed_since_acknowledgement=sa.publication_version is not null,
    acknowledgement_status=case when sa.publication_version is not null then 'changed' else sa.acknowledgement_status end,
    updated_by=auth.uid(),updated_at=now()
  from public.sessions s where s.id=sa.session_id and sa.staff_record_id=v_row.staff_record_id
    and sa.status not in ('cancelled','sick','absent','on_leave','unable_to_attend')
    and s.starts_at < v_return_at and s.ends_at > v_row.starts_at;

  update public.staff_absences set closed_at=now(),closed_by=auth.uid(),actual_return_date=p_actual_return_date,
    end_date=p_actual_return_date-1,ends_at=v_return_at,
    return_to_work_note=nullif(btrim(coalesce(p_return_to_work_note,'')),''),updated_at=now()
  where id=v_row.id returning * into v_row;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staff_absence_closed','staff_absences',v_row.id,jsonb_build_object('staffRecordId',v_row.staff_record_id,'actualReturnDate',p_actual_return_date));
  return to_jsonb(v_row);
end $$;

create or replace function public.absence_cancel_report(p_absence_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_own_staff_id uuid; v_row public.staff_absences%rowtype;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  select id into v_own_staff_id from public.staff_records where profile_id=auth.uid() and archived_at is null limit 1;
  select * into v_row from public.staff_absences where id=p_absence_id and absence_type <> 'annual_leave' for update;
  if v_row.id is null then raise exception 'Absence record not found.'; end if;
  if v_row.staff_record_id <> v_own_staff_id and v_role not in ('admin','superadmin') and not (
    v_role='manager' and exists(select 1 from public.hr_reporting_lines hrl where hrl.staff_record_id=v_row.staff_record_id and hrl.manager_staff_record_id=v_own_staff_id and hrl.effective_to is null)
  ) then raise exception 'You cannot cancel this absence record.' using errcode='42501'; end if;
  if v_row.start_date < current_date and v_role not in ('admin','superadmin') then raise exception 'Ask Admin to correct an absence that has already started.'; end if;
  update public.staff_absences set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_row.id returning * into v_row;
  update public.session_assignments set status='assigned',staff_absence_id=null,
    operational_notes=replace(coalesce(operational_notes,''),' · Staff absence',''),
    changed_since_acknowledgement=publication_version is not null,
    acknowledgement_status=case when publication_version is not null then 'changed' else acknowledgement_status end,
    updated_by=auth.uid(),updated_at=now()
  where staff_absence_id=v_row.id and status='cover_required';
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staff_absence_cancelled','staff_absences',v_row.id,jsonb_build_object('staffRecordId',v_row.staff_record_id));
  return to_jsonb(v_row);
end $$;

grant execute on function public.absence_workspace() to authenticated;
grant execute on function public.absence_save_report(uuid,date,date,text,text) to authenticated;
grant execute on function public.absence_close_report(uuid,date,text) to authenticated;
grant execute on function public.absence_cancel_report(uuid) to authenticated;
