-- Keep each staff member's preferred operational register site with their account.
-- The value is validated against active booking locations and can only be changed
-- by the signed-in current employee.

alter table public.staff_records
  add column if not exists default_register_site text;

create or replace function public.set_my_default_register_site(p_site_name text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_name text;
begin
  if not public.current_user_profile_active() then
    raise exception 'An active staff account is required.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_site_name, '')), '') is not null then
    select name
      into v_site_name
    from public.locations
    where active = true
      and lower(trim(name)) = lower(trim(p_site_name))
    limit 1;

    if v_site_name is null then
      raise exception 'Choose an active Après School site.' using errcode = '22023';
    end if;
  end if;

  update public.staff_records
  set default_register_site = v_site_name
  where profile_id = auth.uid()
    and archived_at is null;

  if not found then
    raise exception 'No active staff record is linked to this account.' using errcode = '42501';
  end if;

  return coalesce(v_site_name, '');
end;
$$;

revoke all on function public.set_my_default_register_site(text) from public;
grant execute on function public.set_my_default_register_site(text) to authenticated;

comment on function public.set_my_default_register_site(text) is
  'Saves or clears the signed-in active employee default register site after validating it against active locations.';
