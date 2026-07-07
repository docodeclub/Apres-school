alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz;

grant update (must_change_password, password_changed_at) on public.profiles to authenticated;

drop policy if exists "profiles_update_own_password_state" on public.profiles;
create policy "profiles_update_own_password_state"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());
