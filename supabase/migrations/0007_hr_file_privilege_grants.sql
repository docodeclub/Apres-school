grant select, insert, update, delete on public.staff_pay_details to authenticated;
grant select, insert, update, delete on public.hr_file_categories to authenticated;
grant select, insert, update, delete on public.staff_hr_files to authenticated;

grant all privileges on public.staff_pay_details to service_role;
grant all privileges on public.hr_file_categories to service_role;
grant all privileges on public.staff_hr_files to service_role;

grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
