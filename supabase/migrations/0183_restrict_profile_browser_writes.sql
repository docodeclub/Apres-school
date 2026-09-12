-- Profile identity and access are managed by verified server routes, not browsers.
-- Preserve the existing password-change acknowledgement and read RLS policies.
begin;
revoke all privileges on table public.profiles from public, anon, authenticated;
do $$
declare columns_sql text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum)
  into columns_sql from pg_attribute
  where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on table public.profiles from public, anon, authenticated', columns_sql);
end $$;
grant select on table public.profiles to authenticated;
grant update (must_change_password, password_changed_at) on public.profiles to authenticated;
-- Restrict this acknowledgement explicitly to the caller's own row.
drop policy if exists "profiles_update_own_password_state" on public.profiles;
create policy "profiles_update_own_password_state" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
commit;
