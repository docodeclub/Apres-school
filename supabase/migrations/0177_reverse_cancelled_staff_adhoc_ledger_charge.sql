-- Cancelling staff-created ad-hoc care must remove its account-ledger debit.
-- The invoice is cleared by the cancellation RPC; reconcile its family ledger
-- target to zero while retaining the normal debit rule for active ad-hoc care.

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
  v_issued_credit numeric(10,2) := 0;
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

  if v_is_staff_adhoc then
    if lower(coalesce(v_booking.status::text, '')) = 'cancelled'
       or lower(coalesce(new.payment_status, '')) like 'cancelled%' then
      v_target_credit := 0;
    else
      v_target_credit := round(
        -new.total_amount
        + greatest(0, new.paid_amount - v_adhoc_credit_applied - new.refunded_amount),
        2
      );
    end if;
    v_entry_type := 'adjustment';
  else
    v_target_credit := greatest(0, new.paid_amount - new.refunded_amount - new.total_amount);
    v_entry_type := case
      when lower(coalesce(v_booking.status::text, '')) = 'cancelled'
        or lower(coalesce(new.payment_status, '')) like 'cancelled%'
        or new.total_amount = 0
      then 'cancellation_credit'
      else 'amendment_credit'
    end;

    -- Once cancellation/amendment credit has been issued, a delayed provider
    -- confirmation must not silently withdraw it. A genuine cash refund is
    -- represented by refunded_amount and may reduce the account credit.
    if new.refunded_amount = 0 then
      select coalesce(sum(greatest(entry.amount, 0)), 0)
      into v_issued_credit
      from public.parent_account_credit_entries entry
      where entry.invoice_id = new.id
        and entry.status = 'posted'
        and entry.entry_type in ('cancellation_credit', 'amendment_credit');

      v_target_credit := greatest(v_target_credit, v_issued_credit);
    end if;
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
      when v_is_staff_adhoc and v_delta > 0 and lower(coalesce(v_booking.status::text, '')) = 'cancelled' then 'Ad-hoc care charge reversed'
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
      'staffAdHoc', v_is_staff_adhoc,
      'amountBasedReconciliation', true
    )
  );

  return new;
end;
$$;

-- Reconcile existing invoices idempotently, including cancelled ad-hoc care.
update public.booking_invoices
set finance_status = finance_status;
