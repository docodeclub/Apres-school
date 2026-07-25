insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-brand-assets',
  'email-brand-assets',
  true,
  1048576,
  array['image/gif', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "email_brand_assets_public_read" on storage.objects;
create policy "email_brand_assets_public_read"
on storage.objects
for select
using (bucket_id = 'email-brand-assets');
