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
  limit 1
$$;

grant execute on function public.current_user_app_role() to authenticated;

drop policy if exists "profiles_admin_read_all" on profiles;
create policy "profiles_admin_read_all" on profiles for select using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_records_admin_all" on staff_records;
create policy "staff_records_admin_all" on staff_records for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "scr_admin_read" on scr_checks;
create policy "scr_admin_read" on scr_checks for select using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "hr_admin_all" on hr_reporting_lines;
create policy "hr_admin_all" on hr_reporting_lines for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "hours_admin_all" on hours_entries;
create policy "hours_admin_all" on hours_entries for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "cover_moves_admin_all" on cover_moves;
create policy "cover_moves_admin_all" on cover_moves for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "enquiries_admin_all" on enquiries;
create policy "enquiries_admin_all" on enquiries for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "incidents_admin_standard" on incidents;
create policy "incidents_admin_standard" on incidents for select using (
  sensitivity = 'standard'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "incidents_superadmin_restricted" on incidents;
create policy "incidents_superadmin_restricted" on incidents for all using (
  public.current_user_app_role() = 'superadmin'
);

drop policy if exists "audit_log_admin_read" on audit_log;
create policy "audit_log_admin_read" on audit_log for select using (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "audit_log_admin_insert" on audit_log;
create policy "audit_log_admin_insert" on audit_log for insert with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);
