-- Former employees keep a deliberately small document portal. Their Auth user
-- remains usable, but their application profile is inactive so operational RLS
-- policies no longer treat them as a current staff member.

alter table public.profiles
  add column if not exists staff_access_status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_staff_access_status_check;
alter table public.profiles
  add constraint profiles_staff_access_status_check
  check (staff_access_status in ('active','former'));

update public.profiles p
set staff_access_status = 'former', active = false, updated_at = now()
from public.staff_records sr
where sr.profile_id = p.id
  and (sr.archived_at is not null or sr.left_at is not null)
  and p.role in ('staff','manager');

create or replace function public.current_user_profile_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select p.active and p.staff_access_status = 'active'
    from public.profiles p
    where p.id = auth.uid()
    limit 1
  ), false)
$$;
grant execute on function public.current_user_profile_active() to authenticated;

create or replace function public.current_user_is_former_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.staff_records sr on sr.profile_id = p.id
    where p.id = auth.uid()
      and p.active = false
      and p.staff_access_status = 'former'
      and (sr.archived_at is not null or sr.left_at is not null)
  )
$$;
grant execute on function public.current_user_is_former_staff() to authenticated;

create or replace function public.current_user_app_role()
returns app_role
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
    and staff_access_status = 'active'
  limit 1
$$;
grant execute on function public.current_user_app_role() to authenticated;

create or replace function public.current_user_staff_record_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.staff_records
  where profile_id = auth.uid()
  order by (archived_at is null) desc, created_at desc
  limit 1
$$;
grant execute on function public.current_user_staff_record_id() to authenticated;

create or replace function public.current_user_owns_staff_record(target_staff_record_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff_records sr
    where sr.id = target_staff_record_id and sr.profile_id = auth.uid()
  )
$$;
grant execute on function public.current_user_owns_staff_record(uuid) to authenticated;

create or replace function public.former_staff_portal()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_record public.staff_records%rowtype;
  v_profile public.profiles%rowtype;
begin
  if not public.current_user_is_former_staff() then
    raise exception 'Former staff document access is not available.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  select * into v_record
  from public.staff_records
  where profile_id = auth.uid()
    and (archived_at is not null or left_at is not null)
  order by coalesce(left_at, archived_at) desc
  limit 1;

  return jsonb_build_object(
    'staffRecordId', v_record.id,
    'name', coalesce(nullif(v_record.preferred_name,''), v_profile.full_name, 'Former staff member'),
    'email', v_profile.email,
    'leftAt', coalesce(v_record.left_at, v_record.archived_at),
    'leavingReason', coalesce(v_record.leaving_reason, 'Not recorded'),
    'accessStatus', 'former'
  );
end
$$;
grant execute on function public.former_staff_portal() to authenticated;

-- Current staff-only operational records. Former staff use former_staff_portal()
-- and the two document policies below instead.
drop policy if exists "staff_records_read_own" on public.staff_records;
create policy "staff_records_read_own" on public.staff_records for select using (
  profile_id = auth.uid() and public.current_user_profile_active()
);

drop policy if exists "hours_staff_own" on public.hours_entries;
create policy "hours_staff_own" on public.hours_entries for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "staff_pay_details_staff_read_own" on public.staff_pay_details;
create policy "staff_pay_details_staff_read_own" on public.staff_pay_details for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "scr_staff_read_own" on public.scr_checks;
create policy "scr_staff_read_own" on public.scr_checks for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "scr_evidence_staff_read_own" on public.scr_evidence_requests;
create policy "scr_evidence_staff_read_own" on public.scr_evidence_requests for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);
drop policy if exists "scr_evidence_staff_submit_own" on public.scr_evidence_requests;
create policy "scr_evidence_staff_submit_own" on public.scr_evidence_requests for update using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
) with check (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "staff_suitability_declarations_staff_read_own" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_staff_read_own" on public.staff_suitability_declarations for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);
drop policy if exists "staff_suitability_declarations_staff_insert_own" on public.staff_suitability_declarations;
create policy "staff_suitability_declarations_staff_insert_own" on public.staff_suitability_declarations for insert with check (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "payroll_hour_records_staff_own" on public.payroll_hour_records;
create policy "payroll_hour_records_staff_own" on public.payroll_hour_records for select using (
  public.current_user_profile_active()
  and exists (
    select 1 from public.payroll_hour_rows r
    where r.payroll_hour_record_id = payroll_hour_records.id
      and public.current_user_owns_staff_record(r.staff_record_id)
  )
);
drop policy if exists "payroll_hour_rows_staff_own" on public.payroll_hour_rows;
create policy "payroll_hour_rows_staff_own" on public.payroll_hour_rows for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);
drop policy if exists "payroll_runs_staff_read_own_periods" on public.payroll_runs;
create policy "payroll_runs_staff_read_own_periods" on public.payroll_runs for select using (
  public.current_user_profile_active()
  and exists (
    select 1
    from public.payroll_hour_records rec
    join public.payroll_hour_rows row on row.payroll_hour_record_id = rec.id
    where rec.payroll_period = payroll_runs.payroll_period
      and public.current_user_owns_staff_record(row.staff_record_id)
  )
);
drop policy if exists "payroll_adjustments_staff_own" on public.payroll_run_adjustments;
create policy "payroll_adjustments_staff_own" on public.payroll_run_adjustments for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

drop policy if exists "Staffing assignments staff own" on public.session_assignments;
create policy "Staffing assignments staff own" on public.session_assignments for select using (
  public.current_user_profile_active()
  and public.current_user_owns_staff_record(staff_record_id)
);

-- Replace the broad authenticated reads with active-profile checks. This keeps
-- parent booking access intact while excluding inactive former employees.
drop policy if exists "locations_read_authenticated" on public.locations;
create policy "locations_read_authenticated" on public.locations for select using (public.current_user_profile_active());
drop policy if exists "programmes_read_authenticated" on public.programmes;
create policy "programmes_read_authenticated" on public.programmes for select using (public.current_user_profile_active());
drop policy if exists "sessions_read_authenticated" on public.sessions;
create policy "sessions_read_authenticated" on public.sessions for select using (public.current_user_profile_active());
drop policy if exists "session_assignments_read_authenticated" on public.session_assignments;
create policy "session_assignments_read_authenticated" on public.session_assignments for select using (public.current_user_profile_active());
drop policy if exists "document_versions_read_authenticated" on public.document_versions;
create policy "document_versions_read_authenticated" on public.document_versions for select using (public.current_user_profile_active());
drop policy if exists "document_assignments_read_authenticated" on public.document_assignments;
create policy "document_assignments_read_authenticated" on public.document_assignments for select using (public.current_user_profile_active());
drop policy if exists "rota_requirements_read_authenticated" on public.rota_requirements;
create policy "rota_requirements_read_authenticated" on public.rota_requirements for select using (public.current_user_profile_active());
drop policy if exists "school_calendar_read_authenticated" on public.school_calendar_periods;
create policy "school_calendar_read_authenticated" on public.school_calendar_periods for select using (public.current_user_profile_active());
drop policy if exists "Session blocks readable by authenticated users" on public.session_blocks;
create policy "Session blocks readable by authenticated users" on public.session_blocks for select using (
  public.current_user_profile_active() and parent_bookable = true
);
drop policy if exists "staff_profile_photos_read_authenticated" on storage.objects;
create policy "staff_profile_photos_read_authenticated" on storage.objects for select using (
  bucket_id = 'staff-profile-photos' and public.current_user_profile_active()
);

-- The only employee-owned records retained for a former employee are their
-- published employee documents and legacy HR files.
drop policy if exists "hr_file_categories_read_authenticated" on public.hr_file_categories;
create policy "hr_file_categories_read_authenticated" on public.hr_file_categories for select using (
  public.current_user_profile_active() or public.current_user_is_former_staff()
);

drop policy if exists "staff_hr_files_staff_read_own" on public.staff_hr_files;
create policy "staff_hr_files_staff_read_own" on public.staff_hr_files for select using (
  public.current_user_owns_staff_record(staff_record_id)
  and (public.current_user_profile_active() or public.current_user_is_former_staff())
);

insert into public.hr_file_categories(name,sensitivity)
values ('P45','confidential_payroll')
on conflict(name) do update set sensitivity=excluded.sensitivity,active=true;

create or replace function public.employee_document_staff_in_scope(target_staff_record_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select coalesce((
    select case
      when p.staff_access_status='former' and p.active=false then target_staff_record_id=sr.id
      when p.active=false then false
      when p.role in ('admin','superadmin') then true
      when p.role='manager' then target_staff_record_id=sr.id or public.current_user_manages_staff_record(target_staff_record_id)
      when p.role='staff' then target_staff_record_id=sr.id
      else false end
    from public.profiles p
    left join public.staff_records sr on sr.profile_id=p.id
    where p.id=auth.uid() limit 1
  ),false)
$$;
grant execute on function public.employee_document_staff_in_scope(uuid) to authenticated;

create or replace function public.employee_document_can_read(target_staff_record_id uuid,target_sensitivity text)
returns boolean language sql security definer set search_path=public stable as $$
  select coalesce((
    select case
      when p.staff_access_status='former' and p.active=false then target_staff_record_id=sr.id
      when p.active=false then false
      when p.role in ('admin','superadmin') then true
      when p.role='manager' then public.current_user_manages_staff_record(target_staff_record_id)
        and coalesce(target_sensitivity,'confidential') not in ('restricted_hr','confidential_payroll')
      when p.role='staff' then sr.id=target_staff_record_id
      else false end
    from public.profiles p
    left join public.staff_records sr on sr.profile_id=p.id
    where p.id=auth.uid() limit 1
  ),false)
$$;
grant execute on function public.employee_document_can_read(uuid,text) to authenticated;

drop policy if exists "employee document types read" on public.employee_document_types;
create policy "employee document types read" on public.employee_document_types for select using (
  public.current_user_profile_active() or public.current_user_is_former_staff()
);
drop policy if exists "employee templates read" on public.employee_document_templates;
create policy "employee templates read" on public.employee_document_templates for select using (public.current_user_profile_active());

create or replace function public.employee_document_storage_object_visible(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when not (public.current_user_profile_active() or public.current_user_is_former_staff()) then false
    when split_part(object_name,'/',1) <> public.current_user_staff_record_id()::text then false
    when split_part(object_name,'/',2) <> 'employee-documents' then true
    else exists(
      select 1
      from public.employee_documents d
      join public.employee_document_types t on t.id=d.document_type_id
      where d.staff_record_id=public.current_user_staff_record_id()
        and d.lineage_id::text=split_part(object_name,'/',3)
        and d.deleted_at is null
        and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
    )
  end
$$;
grant execute on function public.employee_document_storage_object_visible(text) to authenticated;

drop policy if exists "staff_hr_files_storage_staff_select_own" on storage.objects;
create policy "staff_hr_files_storage_staff_select_own" on storage.objects for select using (
  bucket_id='staff-hr-files'
  and public.employee_document_storage_object_visible(name)
);
