create or replace function public.activate_current_parent_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.parent_accounts%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in before activating a parent account.';
  end if;

  select account.* into v_account
    from public.parent_accounts account
    where account.archived_at is null
      and (
        account.profile_id = auth.uid()
        or (v_email <> '' and lower(account.email) = v_email)
      )
    order by case when account.profile_id = auth.uid() then 0 else 1 end
    limit 1
    for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'No active parent account is attached to this login yet.'
    );
  end if;

  v_changed := v_account.profile_id is distinct from auth.uid()
    or v_account.portal_status is distinct from 'active';

  update public.parent_accounts
    set profile_id = auth.uid(),
        portal_status = 'active',
        updated_at = case when v_changed then now() else updated_at end
    where id = v_account.id;

  if v_changed then
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(),
      'parent_account_activated_after_sign_in',
      'parent_accounts',
      v_account.id,
      jsonb_build_object(
        'previousPortalStatus', v_account.portal_status,
        'profileLinked', v_account.profile_id is distinct from auth.uid(),
        'externalSource', v_account.external_source
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'parentAccountId', v_account.id,
    'portalStatus', 'active'
  );
end;
$$;

revoke all on function public.activate_current_parent_account() from public;
grant execute on function public.activate_current_parent_account() to authenticated, service_role;

with signed_in_accounts as (
  select account.id
  from public.parent_accounts account
  join auth.users auth_user
    on auth_user.id = account.profile_id
    or lower(auth_user.email) = lower(account.email)
  where account.archived_at is null
    and account.portal_status in ('invited', 'migration_review')
    and auth_user.last_sign_in_at is not null
)
update public.parent_accounts account
set portal_status = 'active',
    updated_at = now()
from signed_in_accounts signed_in
where account.id = signed_in.id;

comment on function public.activate_current_parent_account() is
  'Links and activates the signed-in user''s unarchived parent account after successful authentication.';
