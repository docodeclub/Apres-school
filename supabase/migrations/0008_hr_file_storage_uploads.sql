insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-hr-files',
  'staff-hr-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists "staff_hr_files_storage_admin_select" on storage.objects;
create policy "staff_hr_files_storage_admin_select" on storage.objects for select using (
  bucket_id = 'staff-hr-files'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_hr_files_storage_staff_select_own" on storage.objects;
create policy "staff_hr_files_storage_staff_select_own" on storage.objects for select using (
  bucket_id = 'staff-hr-files'
  and name like public.current_user_staff_record_id()::text || '/%'
);

drop policy if exists "staff_hr_files_storage_admin_insert" on storage.objects;
create policy "staff_hr_files_storage_admin_insert" on storage.objects for insert with check (
  bucket_id = 'staff-hr-files'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_hr_files_storage_admin_update" on storage.objects;
create policy "staff_hr_files_storage_admin_update" on storage.objects for update using (
  bucket_id = 'staff-hr-files'
  and public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  bucket_id = 'staff-hr-files'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_hr_files_storage_admin_delete" on storage.objects;
create policy "staff_hr_files_storage_admin_delete" on storage.objects for delete using (
  bucket_id = 'staff-hr-files'
  and public.current_user_app_role() in ('admin', 'superadmin')
);
