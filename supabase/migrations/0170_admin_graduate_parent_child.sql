create or replace function public.admin_graduate_parent_child(p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.child_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before changing a child record.';
  end if;

  if public.current_user_app_role() not in ('admin', 'superadmin') then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  select * into v_child
    from public.child_profiles
    where id = p_child_id
    for update;

  if not found then
    raise exception 'Child record not found.';
  end if;

  if v_child.archived_at is not null or v_child.active = false then
    return jsonb_build_object(
      'ok', true,
      'alreadyArchived', true,
      'childId', v_child.id,
      'childName', v_child.full_name
    );
  end if;

  update public.child_profiles
    set active = false,
        archived_at = now(),
        archive_reason = 'graduated_by_admin',
        updated_at = now()
    where id = v_child.id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'admin_child_graduated',
    'child_profiles',
    v_child.id,
    jsonb_build_object(
      'parentAccountId', v_child.parent_account_id,
      'childName', v_child.full_name,
      'preservedBookingHistory', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'alreadyArchived', false,
    'childId', v_child.id,
    'childName', v_child.full_name,
    'archivedAt', now()
  );
end;
$$;

revoke all on function public.admin_graduate_parent_child(uuid) from public;
grant execute on function public.admin_graduate_parent_child(uuid) to authenticated;
grant execute on function public.admin_graduate_parent_child(uuid) to service_role;
