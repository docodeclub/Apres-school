alter table public.staff_records
  add column if not exists photo_storage_path text,
  add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-profile-photos',
  'staff-profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff_profile_photos_read_authenticated" on storage.objects;
create policy "staff_profile_photos_read_authenticated" on storage.objects for select using (
  bucket_id = 'staff-profile-photos'
  and auth.role() = 'authenticated'
);

drop policy if exists "staff_profile_photos_admin_insert" on storage.objects;
create policy "staff_profile_photos_admin_insert" on storage.objects for insert with check (
  bucket_id = 'staff-profile-photos'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_profile_photos_admin_update" on storage.objects;
create policy "staff_profile_photos_admin_update" on storage.objects for update using (
  bucket_id = 'staff-profile-photos'
  and public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  bucket_id = 'staff-profile-photos'
  and public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_profile_photos_admin_delete" on storage.objects;
create policy "staff_profile_photos_admin_delete" on storage.objects for delete using (
  bucket_id = 'staff-profile-photos'
  and public.current_user_app_role() in ('admin', 'superadmin')
);
