create or replace function public.find_auth_user_id_by_email(p_email text)
returns table(id uuid, email text)
language sql
security definer
set search_path = auth, public
as $$
  select users.id, users.email::text
  from auth.users
  where lower(users.email) = lower(p_email)
  order by users.created_at desc
  limit 1;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;

create or replace function public.repair_staff_auth_email_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text
)
returns table(id uuid, email text)
language plpgsql
security definer
set search_path = auth, public, extensions
as $$
declare
  target_user auth.users%rowtype;
begin
  select *
  into target_user
  from auth.users
  where lower(users.email) = lower(p_email)
    and users.deleted_at is null
  order by users.created_at desc
  limit 1;

  if target_user.id is null then
    return;
  end if;

  update auth.users
  set
    encrypted_password = crypt(p_password, gen_salt('bf')),
    aud = coalesce(aud, 'authenticated'),
    role = coalesce(role, 'authenticated'),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', p_full_name, 'role', lower(p_role)),
    updated_at = now()
  where users.id = target_user.id;

  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    target_user.id::text,
    target_user.id,
    jsonb_build_object(
      'sub', target_user.id::text,
      'email', lower(p_email),
      'email_verified', false,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider_id, provider) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

  return query
  select target_user.id, lower(p_email);
end;
$$;

revoke all on function public.repair_staff_auth_email_user(text, text, text, text) from public;
grant execute on function public.repair_staff_auth_email_user(text, text, text, text) to service_role;
