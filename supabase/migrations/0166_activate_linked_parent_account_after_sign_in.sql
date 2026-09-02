create or replace function public.activate_current_parent_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.parent_accounts%rowtype;
  v_holder public.parent_account_holders%rowtype;
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

  if found then
    v_changed := v_account.profile_id is distinct from auth.uid()
      or v_account.portal_status is distinct from 'active';

    update public.parent_accounts
      set profile_id = auth.uid(),
          portal_status = 'active',
          updated_at = case when v_changed then now() else updated_at end
      where id = v_account.id;

    update public.profiles
      set active = true,
          updated_at = case when active is distinct from true then now() else updated_at end
      where id = auth.uid();

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
      'portalStatus', 'active',
      'accountHolderRole', 'primary'
    );
  end if;

  select holder.* into v_holder
    from public.parent_account_holders holder
    join public.parent_accounts account on account.id = holder.parent_account_id
    where account.archived_at is null
      and holder.status <> 'removed'
      and (
        holder.profile_id = auth.uid()
        or (v_email <> '' and lower(holder.email) = v_email)
      )
    order by
      case when holder.profile_id = auth.uid() then 0 else 1 end,
      case when holder.status = 'active' then 0 else 1 end,
      holder.invited_at desc nulls last
    limit 1
    for update of holder;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'No active parent account is attached to this login yet.'
    );
  end if;

  v_changed := v_holder.profile_id is distinct from auth.uid()
    or v_holder.status is distinct from 'active';

  update public.parent_account_holders
    set profile_id = auth.uid(),
        status = 'active',
        accepted_at = coalesce(accepted_at, now()),
        invitation_used_at = coalesce(invitation_used_at, now()),
        updated_at = case when v_changed then now() else updated_at end
    where id = v_holder.id;

  update public.profiles
    set active = true,
        updated_at = case when active is distinct from true then now() else updated_at end
    where id = auth.uid();

  if v_changed then
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(),
      'parent_account_holder_activated_after_sign_in',
      'parent_account_holders',
      v_holder.id,
      jsonb_build_object(
        'parentAccountId', v_holder.parent_account_id,
        'previousStatus', v_holder.status,
        'profileLinked', v_holder.profile_id is distinct from auth.uid()
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'parentAccountId', v_holder.parent_account_id,
    'portalStatus', 'active',
    'accountHolderRole', coalesce(v_holder.role, 'secondary')
  );
end;
$$;

revoke all on function public.activate_current_parent_account() from public;
grant execute on function public.activate_current_parent_account() to authenticated, service_role;

comment on function public.activate_current_parent_account() is
  'Activates either the signed-in user''s primary family account or a valid linked account-holder invitation.';
