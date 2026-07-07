-- Renumbered from 0025 to avoid colliding with the applied email_logs migration.
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.platform_settings (key, value, is_public)
values (
  'public_site',
  '{"campAnnouncementEnabled": true}'::jsonb,
  true
)
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;

grant select on public.platform_settings to anon, authenticated;
grant insert, update on public.platform_settings to authenticated;

drop policy if exists "platform_settings_public_read" on public.platform_settings;
create policy "platform_settings_public_read"
  on public.platform_settings
  for select
  using (is_public = true or auth.uid() is not null);

drop policy if exists "platform_settings_admin_insert" on public.platform_settings;
create policy "platform_settings_admin_insert"
  on public.platform_settings
  for insert
  with check (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('admin', 'superadmin')
    )
  );

drop policy if exists "platform_settings_admin_update" on public.platform_settings;
create policy "platform_settings_admin_update"
  on public.platform_settings
  for update
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('admin', 'superadmin')
    )
  );
