drop policy if exists "Admins can read family credit" on public.parent_account_credit_entries;
create policy "Admins can read family credit"
  on public.parent_account_credit_entries for select
  using (public.current_profile_is_admin());

create or replace function public.admin_adjust_parent_account_credit(
  p_parent_account_id uuid,
  p_amount numeric,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.parent_accounts%rowtype;
  v_amount numeric(10,2) := round(coalesce(p_amount, 0), 2);
  v_reason text := lower(trim(coalesce(p_reason, '')));
  v_reason_label text;
  v_note text := trim(coalesce(p_note, ''));
  v_balance_before numeric(10,2) := 0;
  v_balance_after numeric(10,2) := 0;
  v_entry_id uuid;
begin
  if auth.uid() is null or not public.current_profile_is_admin() then
    raise exception 'Only active admins can adjust parent account credit.';
  end if;

  if p_parent_account_id is null then
    raise exception 'Choose a customer account.';
  end if;
  if v_amount = 0 then
    raise exception 'Enter an amount other than £0.00.';
  end if;
  if abs(v_amount) > 10000 then
    raise exception 'Credit adjustments are limited to £10,000 per action.';
  end if;
  if v_reason not in ('refund', 'goodwill', 'credit_adjustment') then
    raise exception 'Choose a valid reason for this credit adjustment.';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'Add a short note explaining this credit adjustment.';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'Keep the credit note to 300 characters or fewer.';
  end if;

  v_reason_label := case v_reason
    when 'refund' then 'Refund'
    when 'goodwill' then 'Goodwill'
    else 'Credit adjustment'
  end;

  select * into v_account
  from public.parent_accounts
  where id = p_parent_account_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'This customer account is not available.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_account.id::text || ':account-credit', 0));

  select coalesce(sum(amount), 0)
    into v_balance_before
  from public.parent_account_credit_entries
  where parent_account_id = v_account.id
    and status = 'posted';

  v_balance_after := round(v_balance_before + v_amount, 2);
  if v_balance_after < 0 then
    raise exception 'This account only has £% credit available. The balance cannot be reduced below £0.00.', to_char(v_balance_before, 'FM999999990.00');
  end if;

  insert into public.parent_account_credit_entries (
    parent_account_id,
    parent_id,
    entry_type,
    amount,
    currency,
    status,
    description,
    metadata
  ) values (
    v_account.id,
    v_account.profile_id,
    'adjustment',
    v_amount,
    'GBP',
    'posted',
    case when v_amount > 0 then v_reason_label || ' credit added by administrator' else v_reason_label || ' credit removed by administrator' end,
    jsonb_build_object(
      'source', 'admin_customer_profile',
      'reasonCode', v_reason,
      'reasonLabel', v_reason_label,
      'adminNote', v_note,
      'adjustedBy', auth.uid(),
      'balanceBefore', v_balance_before,
      'balanceAfter', v_balance_after
    )
  ) returning id into v_entry_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'admin_parent_credit_adjusted',
    'parent_account_credit_entries',
    v_entry_id,
    jsonb_build_object(
      'parentAccountId', v_account.id,
      'customerEmail', lower(v_account.email),
      'amount', v_amount,
      'reasonCode', v_reason,
      'reasonLabel', v_reason_label,
      'note', v_note,
      'balanceBefore', v_balance_before,
      'balanceAfter', v_balance_after
    )
  );

  return jsonb_build_object(
    'entryId', v_entry_id,
    'parentAccountId', v_account.id,
    'parentProfileId', v_account.profile_id,
    'customerName', v_account.full_name,
    'customerEmail', lower(v_account.email),
    'amount', v_amount,
    'reasonCode', v_reason,
    'reasonLabel', v_reason_label,
    'note', v_note,
    'balanceBefore', v_balance_before,
    'balanceAfter', v_balance_after
  );
end;
$$;

revoke all on function public.admin_adjust_parent_account_credit(uuid, numeric, text, text) from public;
grant execute on function public.admin_adjust_parent_account_credit(uuid, numeric, text, text) to authenticated;
grant execute on function public.admin_adjust_parent_account_credit(uuid, numeric, text, text) to service_role;

comment on function public.admin_adjust_parent_account_credit(uuid, numeric, text, text) is
  'Atomically applies an audited signed credit adjustment to an active parent account without allowing a negative credit balance.';
