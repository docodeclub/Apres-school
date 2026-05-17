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
    and archived_at is null
  limit 1
$$;

create or replace function public.current_user_manages_staff_record(target_staff_record_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.hr_reporting_lines h
    where h.staff_record_id = target_staff_record_id
      and h.archived_at is null
      and h.manager_staff_record_id = public.current_user_staff_record_id()
  )
$$;

grant execute on function public.current_user_staff_record_id() to authenticated;
grant execute on function public.current_user_manages_staff_record(uuid) to authenticated;

drop policy if exists "staff_records_manager_direct_reports" on public.staff_records;
create policy "staff_records_manager_direct_reports" on public.staff_records for select using (
  public.current_user_manages_staff_record(id)
);

drop policy if exists "scr_manager_direct_reports" on public.scr_checks;
create policy "scr_manager_direct_reports" on public.scr_checks for select using (
  public.current_user_manages_staff_record(staff_record_id)
);

drop policy if exists "hr_manager_read_scope" on public.hr_reporting_lines;
create policy "hr_manager_read_scope" on public.hr_reporting_lines for select using (
  manager_staff_record_id = public.current_user_staff_record_id()
);

drop policy if exists "hours_manager_direct_reports" on public.hours_entries;
create policy "hours_manager_direct_reports" on public.hours_entries for select using (
  public.current_user_manages_staff_record(staff_record_id)
);
