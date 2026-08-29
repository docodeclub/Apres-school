-- Allows the service-role Edge Function to place its own scheduler secret in
-- Vault without ever committing the secret to source control.
create or replace function public.bootstrap_school_register_cron_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if length(coalesce(p_secret, '')) < 32 then
    raise exception 'A strong scheduler secret is required.' using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = 'apres_register_cron_secret' order by created_at desc limit 1;
  if v_id is null then
    perform vault.create_secret(p_secret, 'apres_register_cron_secret', 'Daily register email job authentication');
  else
    perform vault.update_secret(v_id, p_secret, 'apres_register_cron_secret', 'Daily register email job authentication');
  end if;
end
$$;

revoke all on function public.bootstrap_school_register_cron_secret(text) from public, anon, authenticated;
grant execute on function public.bootstrap_school_register_cron_secret(text) to service_role;
