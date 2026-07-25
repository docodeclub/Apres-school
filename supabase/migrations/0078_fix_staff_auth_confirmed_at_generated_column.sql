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
    confirmation_token = coalesce(confirmation_token, ''),
    recovery_token = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change = coalesce(email_change, ''),
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
    updated_at,
    email
  )
  values (
    gen_random_uuid(),
    target_user.id::text,
    target_user.id,
    jsonb_build_object(
      'sub', target_user.id::text,
      'email', lower(p_email),
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now(),
    lower(p_email)
  )
  on conflict (provider_id, provider) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      email = excluded.email,
      updated_at = now();

  return query
  select target_user.id, lower(p_email);
end;
$$;

revoke all on function public.repair_staff_auth_email_user(text, text, text, text) from public;
grant execute on function public.repair_staff_auth_email_user(text, text, text, text) to service_role;
