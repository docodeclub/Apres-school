alter table public.parent_accounts
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.child_profiles
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create index if not exists parent_accounts_active_idx
  on public.parent_accounts (profile_id, lower(email))
  where archived_at is null;

create index if not exists child_profiles_active_family_idx
  on public.child_profiles (parent_account_id, full_name)
  where active = true and archived_at is null;

create or replace function public.parent_account_is_primary_holder(p_parent_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.parent_accounts
    where id = p_parent_account_id
      and archived_at is null
      and (
        profile_id = auth.uid()
        or lower(email) = public.current_profile_email()
      )
  )
$$;

create or replace function public.graduate_parent_child(p_child_id uuid)
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

  select * into v_child
    from public.child_profiles
    where id = p_child_id
    for update;

  if not found then
    raise exception 'Child record not found.';
  end if;

  if not public.parent_account_is_primary_holder(v_child.parent_account_id) then
    raise exception 'Only the main account holder can graduate a child.';
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
        archive_reason = 'graduated_by_parent',
        updated_at = now()
    where id = v_child.id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'parent_child_graduated',
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

create or replace function public.archive_own_parent_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.parent_accounts%rowtype;
  v_outstanding numeric(10,2) := 0;
  v_credit numeric(10,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in before archiving an account.';
  end if;

  select account.* into v_account
    from public.parent_accounts account
    left join public.profiles profile on profile.id = auth.uid()
    where account.archived_at is null
      and (
        account.profile_id = auth.uid()
        or lower(account.email) = lower(coalesce(profile.email, ''))
      )
    order by case when account.profile_id = auth.uid() then 0 else 1 end
    limit 1
    for update of account;

  if not found then
    raise exception 'Active parent account not found.';
  end if;

  select coalesce(sum(greatest(invoice.balance, 0)), 0)
    into v_outstanding
    from public.booking_invoices invoice
    where invoice.balance > 0
      and lower(coalesce(invoice.payment_status, '')) not like 'cancelled%'
      and lower(coalesce(invoice.parent_portal_status, '')) <> 'cancelled'
      and lower(coalesce(invoice.metadata->>'creditTopUp', 'false')) <> 'true'
      and (
        invoice.parent_id = v_account.profile_id
        or lower(coalesce(invoice.parent_email, '')) = lower(v_account.email)
        or exists (
          select 1
          from public.bookings booking
          where booking.invoice_id = invoice.id
            and booking.parent_account_id = v_account.id
        )
      );

  select coalesce(sum(entry.amount), 0)
    into v_credit
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_account.id
      and entry.status = 'posted';

  if v_outstanding > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'outstanding_balance',
      'outstandingBalance', round(v_outstanding, 2),
      'creditBalance', round(v_credit, 2),
      'message', format('Pay the outstanding balance of £%s before archiving this account.', to_char(v_outstanding, 'FM999999990.00'))
    );
  end if;

  update public.child_profiles
    set active = false,
        archived_at = coalesce(archived_at, now()),
        archive_reason = coalesce(archive_reason, 'parent_account_archived'),
        updated_at = now()
    where parent_account_id = v_account.id
      and archived_at is null;

  update public.parent_account_holders
    set status = 'removed',
        removed_at = coalesce(removed_at, now()),
        updated_at = now()
    where parent_account_id = v_account.id
      and status <> 'removed';

  update public.parent_accounts
    set portal_status = 'archived',
        archived_at = now(),
        archive_reason = 'archived_by_parent',
        updated_at = now()
    where id = v_account.id;

  update public.profiles
    set active = false,
        updated_at = now()
    where id = auth.uid()
      and role::text = 'parent';

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'parent_account_archived',
    'parent_accounts',
    v_account.id,
    jsonb_build_object(
      'email', v_account.email,
      'creditBalanceRetained', round(v_credit, 2),
      'outstandingBalance', round(v_outstanding, 2),
      'preservedFinanceHistory', true,
      'preservedBookingHistory', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'parentAccountId', v_account.id,
    'archivedAt', now(),
    'creditBalanceRetained', round(v_credit, 2)
  );
end;
$$;

revoke all on function public.graduate_parent_child(uuid) from public;
revoke all on function public.archive_own_parent_account() from public;
grant execute on function public.graduate_parent_child(uuid) to authenticated;
grant execute on function public.archive_own_parent_account() to authenticated;
grant execute on function public.graduate_parent_child(uuid) to service_role;
grant execute on function public.archive_own_parent_account() to service_role;
