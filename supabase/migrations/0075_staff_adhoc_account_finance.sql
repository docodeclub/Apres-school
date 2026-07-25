-- Ad-hoc register bookings are immediate care commitments. Charge the family
-- account at once, use any positive credit first, and leave the uncovered
-- amount as an outstanding invoice and negative account balance.

create or replace function public.sync_parent_account_credit_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_parent_account_id uuid;
  v_target_credit numeric(10,2) := 0;
  v_recorded_credit numeric(10,2) := 0;
  v_delta numeric(10,2) := 0;
  v_entry_type text := 'adjustment';
  v_is_staff_adhoc boolean := false;
  v_adhoc_credit_applied numeric(10,2) := 0;
begin
  if new.booking_id is not null then
    select * into v_booking
      from public.bookings
      where id::text = new.booking_id::text
      limit 1;
  end if;

  v_parent_account_id := v_booking.parent_account_id;
  if v_parent_account_id is null then
    select account.id into v_parent_account_id
      from public.parent_accounts account
      where account.profile_id = new.parent_id
         or (new.parent_email is not null and lower(account.email) = lower(new.parent_email))
      order by case when account.profile_id = new.parent_id then 0 else 1 end
      limit 1;
  end if;

  if v_parent_account_id is null then
    return new;
  end if;

  v_is_staff_adhoc := coalesce((new.metadata->>'staffAdHoc')::boolean, false);
  v_adhoc_credit_applied := coalesce((new.metadata->>'creditAppliedAtCreation')::numeric, 0);

  if lower(coalesce(v_booking.status::text, '')) = 'cancelled'
     or lower(coalesce(new.payment_status, '')) like 'cancelled%' then
    v_target_credit := greatest(0, new.paid_amount - new.refunded_amount);
    v_entry_type := 'cancellation_credit';
  elsif v_is_staff_adhoc then
    -- The initial negative entry is the account charge. As the outstanding
    -- invoice is paid, the matching positive adjustment brings the balance
    -- back towards zero. Credit already consumed remains consumed.
    v_target_credit := round(
      -new.total_amount
      + greatest(0, new.paid_amount - v_adhoc_credit_applied - new.refunded_amount),
      2
    );
    v_entry_type := 'adjustment';
  elsif lower(coalesce(new.finance_status, '')) like '%credit%'
     or lower(coalesce(new.payment_status, '')) like '%credit%'
     or lower(coalesce(new.parent_portal_status, '')) like '%credit%' then
    v_target_credit := greatest(0, new.paid_amount - new.refunded_amount - new.total_amount);
    v_entry_type := 'amendment_credit';
  end if;

  select coalesce(sum(entry.amount), 0) into v_recorded_credit
    from public.parent_account_credit_entries entry
    where entry.invoice_id = new.id
      and entry.status = 'posted';

  v_delta := round(v_target_credit - v_recorded_credit, 2);
  if v_delta = 0 then
    return new;
  end if;

  insert into public.parent_account_credit_entries (
    parent_account_id,
    parent_id,
    booking_id,
    invoice_id,
    entry_type,
    amount,
    currency,
    description,
    metadata
  ) values (
    v_parent_account_id,
    coalesce(v_booking.parent_id, new.parent_id),
    v_booking.id,
    new.id,
    case when v_delta < 0 and not v_is_staff_adhoc then 'refund_reversal' else v_entry_type end,
    v_delta,
    coalesce(new.currency, 'GBP'),
    case
      when v_is_staff_adhoc and v_delta < 0 then 'Ad-hoc care added by the club'
      when v_is_staff_adhoc and v_delta > 0 then 'Ad-hoc invoice payment received'
      when v_delta < 0 then 'Credit reduced after refund or invoice adjustment'
      when v_entry_type = 'cancellation_credit' then 'Credit from cancelled booking'
      else 'Credit from cheaper booking amendment'
    end,
    jsonb_build_object(
      'paymentStatus', new.payment_status,
      'financeStatus', new.finance_status,
      'paidAmount', new.paid_amount,
      'refundedAmount', new.refunded_amount,
      'invoiceTotal', new.total_amount,
      'targetInvoiceCredit', v_target_credit,
      'staffAdHoc', v_is_staff_adhoc
    )
  );

  return new;
end;
$$;

create or replace function public.finalise_staff_adhoc_account_charge(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_invoice public.booking_invoices%rowtype;
  v_balance_before numeric(10,2) := 0;
  v_balance_after numeric(10,2) := 0;
  v_credit_applied numeric(10,2) := 0;
  v_outstanding numeric(10,2) := 0;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found
     or v_booking.source <> 'staff_adhoc'
     or not coalesce((v_booking.metadata->>'staffAdHoc')::boolean, false) then
    raise exception 'This is not an ad-hoc register booking.';
  end if;

  select * into v_invoice
  from public.booking_invoices
  where id = v_booking.invoice_id
  for update;

  if not found then
    raise exception 'The ad-hoc invoice could not be found.';
  end if;

  if coalesce((v_invoice.metadata->>'accountChargeApplied')::boolean, false) then
    select coalesce(sum(amount), 0)::numeric(10,2)
    into v_balance_after
    from public.parent_account_credit_entries
    where parent_account_id = v_booking.parent_account_id
      and status = 'posted';

    return jsonb_build_object(
      'ok', true,
      'alreadyFinalised', true,
      'creditApplied', coalesce((v_invoice.metadata->>'creditAppliedAtCreation')::numeric, 0),
      'outstanding', v_invoice.balance,
      'creditBalance', v_balance_after
    );
  end if;

  select coalesce(sum(amount), 0)::numeric(10,2)
  into v_balance_before
  from public.parent_account_credit_entries
  where parent_account_id = v_booking.parent_account_id
    and status = 'posted';

  v_credit_applied := least(greatest(v_balance_before, 0), v_invoice.total_amount);
  v_outstanding := greatest(v_invoice.total_amount - v_credit_applied, 0);

  update public.booking_invoices
  set paid_amount = v_credit_applied,
      balance = v_outstanding,
      payment_status = case when v_outstanding = 0 then 'paid_with_credit' else 'pending' end,
      parent_portal_status = case when v_outstanding = 0 then 'Paid with account credit' else 'Payment required' end,
      receipt_status = case when v_outstanding = 0 then 'issued' else receipt_status end,
      finance_status = case when v_outstanding = 0 then 'settled_with_credit' else 'awaiting_payment' end,
      metadata = metadata || jsonb_build_object(
        'accountChargeApplied', true,
        'creditBalanceBefore', v_balance_before,
        'creditAppliedAtCreation', v_credit_applied,
        'outstandingAtCreation', v_outstanding
      ),
      updated_at = now()
  where id = v_invoice.id
  returning * into v_invoice;

  update public.bookings
  set due_today = v_outstanding,
      outstanding_balance = v_outstanding,
      metadata = metadata || jsonb_build_object(
        'creditApplied', v_credit_applied,
        'outstandingBalance', v_outstanding
      ),
      updated_at = now()
  where id = v_booking.id;

  select coalesce(sum(amount), 0)::numeric(10,2)
  into v_balance_after
  from public.parent_account_credit_entries
  where parent_account_id = v_booking.parent_account_id
    and status = 'posted';

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'staff_adhoc_account_charged',
    'booking_invoices',
    v_booking.id,
    jsonb_build_object(
      'bookingId', v_booking.id,
      'total', v_invoice.total_amount,
      'creditBalanceBefore', v_balance_before,
      'creditApplied', v_credit_applied,
      'outstanding', v_outstanding,
      'creditBalanceAfter', v_balance_after
    )
  );

  return jsonb_build_object(
    'ok', true,
    'creditApplied', v_credit_applied,
    'outstanding', v_outstanding,
    'creditBalance', v_balance_after
  );
end;
$$;

create or replace function public.parent_booking_finance_gate(
  p_parent_id uuid,
  p_parent_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_account_id uuid;
  v_credit_balance numeric(10,2) := 0;
  v_outstanding numeric(10,2) := 0;
  v_invoice_count integer := 0;
begin
  select account.id
  into v_parent_account_id
  from public.parent_accounts account
  where account.profile_id = p_parent_id
     or (p_parent_email is not null and lower(account.email) = lower(p_parent_email))
     or exists (
       select 1
       from public.parent_account_holders holder
       where holder.parent_account_id = account.id
         and holder.profile_id = p_parent_id
         and holder.status <> 'removed'
     )
  order by case when account.profile_id = p_parent_id then 0 else 1 end
  limit 1;

  if v_parent_account_id is null then
    return jsonb_build_object('blocked', false, 'creditBalance', 0, 'outstandingBalance', 0, 'invoiceCount', 0);
  end if;

  select coalesce(sum(amount), 0)::numeric(10,2)
  into v_credit_balance
  from public.parent_account_credit_entries
  where parent_account_id = v_parent_account_id
    and status = 'posted';

  select coalesce(sum(invoice.balance), 0)::numeric(10,2), count(*)::integer
  into v_outstanding, v_invoice_count
  from public.booking_invoices invoice
  join public.bookings booking on booking.id::text = invoice.booking_id
  where booking.parent_account_id = v_parent_account_id
    and lower(coalesce(booking.status::text, '')) <> 'cancelled'
    and lower(coalesce(invoice.payment_status, '')) not like 'cancelled%'
    and invoice.balance > 0;

  return jsonb_build_object(
    'blocked', v_outstanding > 0 or v_credit_balance < 0,
    'parentAccountId', v_parent_account_id,
    'creditBalance', v_credit_balance,
    'outstandingBalance', v_outstanding,
    'invoiceCount', v_invoice_count
  );
end;
$$;

revoke all on function public.finalise_staff_adhoc_account_charge(uuid) from public;
grant execute on function public.finalise_staff_adhoc_account_charge(uuid) to authenticated;
grant execute on function public.finalise_staff_adhoc_account_charge(uuid) to service_role;

revoke all on function public.parent_booking_finance_gate(uuid, text) from public;
grant execute on function public.parent_booking_finance_gate(uuid, text) to service_role;
