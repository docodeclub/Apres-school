grant usage on schema public to authenticated;
grant select on public.hr_file_categories to authenticated;
grant select, insert, update, delete on public.staff_hr_files to authenticated;
grant select on public.staff_records to authenticated;
grant select on public.profiles to authenticated;

grant all privileges on public.hr_file_categories to service_role;
grant all privileges on public.staff_hr_files to service_role;

drop policy if exists "hr_file_categories_read_authenticated" on public.hr_file_categories;
create policy "hr_file_categories_read_authenticated" on public.hr_file_categories for select using (
  auth.uid() is not null
);

drop policy if exists "hr_file_categories_admin_all" on public.hr_file_categories;
create policy "hr_file_categories_admin_all" on public.hr_file_categories for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);
