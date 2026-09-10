-- When a family adds credit after staff have recorded ad-hoc care, the ledger
-- already nets the top-up against those charges. Keep the linked invoices and
-- booking headers in step so the parent portal does not still ask for payment.

create or replace function public.apply_topup_credit_to_outstanding_adhoc_invoices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice record;
  v_remaining numeric(10,2) := round(greatest(new.amount, 0), 2);
  v_applied numeric(10,2) := 0;
  v_total_credit_applied numeric(10,2) := 0;
  v_balance_after numeric(10,2) := 0;
begin
  if new.status <> 'posted'
     or new.entry_type <> 'top_up'
     or new.amount <= 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.parent_account_id::text || ':account-credit', 0)
  );

  for v_invoice in
    select
      invoice.id as invoice_id,
      invoice.total_amount,
      invoice.paid_amount,
      invoice.balance,
      invoice.metadata as invoice_metadata,
      booking.id as booking_id
    from public.booking_invoices invoice
    join public.bookings booking
      on booking.id::text = invoice.booking_id
      or booking.invoice_id = invoice.id
    where booking.parent_account_id = new.parent_account_id
      and booking.source = 'staff_adhoc'
      and booking.status <> 'cancelled'
      and coalesce((invoice.metadata->>'staffAdHoc')::boolean, false)
      and invoice.balance > 0
      and lower(coalesce(invoice.payment_status, '')) not like 'cancelled%'
    order by invoice.created_at, invoice.id
    for update of invoice, booking
  loop
    exit when v_remaining <= 0;

    v_applied := least(v_remaining, v_invoice.balance);
    v_total_credit_applied := round(
      coalesce((v_invoice.invoice_metadata->>'creditAppliedAtCreation')::numeric, 0)
      + v_applied,
      2
    );
    v_balance_after := round(greatest(v_invoice.balance - v_applied, 0), 2);

    update public.booking_invoices
    set paid_amount = round(least(total_amount, paid_amount + v_applied), 2),
        balance = v_balance_after,
        payment_status = case when v_balance_after = 0 then 'paid_with_credit' else 'pending' end,
        parent_portal_status = case when v_balance_after = 0 then 'Paid with account credit' else 'Payment required' end,
        receipt_status = case when v_balance_after = 0 then 'issued' else receipt_status end,
        finance_status = case when v_balance_after = 0 then 'settled_with_credit' else 'awaiting_payment' end,
        metadata = metadata || jsonb_build_object(
          'creditAppliedAtCreation', v_total_credit_applied,
          'outstandingAtCreation', v_balance_after,
          'creditReconciledAt', now(),
          'creditReconciliationReason', 'Parent credit top-up automatically applied to outstanding ad-hoc care'
        ),
        updated_at = now()
    where id = v_invoice.invoice_id;

    update public.bookings
    set due_today = v_balance_after,
        outstanding_balance = v_balance_after,
        metadata = metadata || jsonb_build_object(
          'creditApplied', v_total_credit_applied,
          'outstandingBalance', v_balance_after,
          'creditReconciledAt', now()
        ),
        updated_at = now()
    where id = v_invoice.booking_id;

    insert into public.audit_log (
      actor_id,
      action,
      table_name,
      record_id,
      metadata
    ) values (
      new.parent_id,
      'parent_topup_applied_to_adhoc_invoice',
      'booking_invoices',
      v_invoice.booking_id,
      jsonb_build_object(
        'bookingId', v_invoice.booking_id,
        'invoiceId', v_invoice.invoice_id,
        'topUpEntryId', new.id,
        'topUpInvoiceId', new.metadata->>'topUpInvoiceId',
        'amountApplied', v_applied,
        'remainingInvoiceBalance', v_balance_after,
        'source', 'automatic-credit-reconciliation'
      )
    );

    v_remaining := round(v_remaining - v_applied, 2);
  end loop;

  return new;
end;
$$;

drop trigger if exists apply_topup_credit_to_outstanding_adhoc_invoices_trigger
  on public.parent_account_credit_entries;
create trigger apply_topup_credit_to_outstanding_adhoc_invoices_trigger
  after insert on public.parent_account_credit_entries
  for each row
  when (new.status = 'posted' and new.entry_type = 'top_up' and new.amount > 0)
  execute function public.apply_topup_credit_to_outstanding_adhoc_invoices();

revoke all on function public.apply_topup_credit_to_outstanding_adhoc_invoices() from public;
grant execute on function public.apply_topup_credit_to_outstanding_adhoc_invoices() to service_role;

comment on function public.apply_topup_credit_to_outstanding_adhoc_invoices() is
  'Applies newly posted parent top-ups to older staff-created ad-hoc invoices while preserving the single account-ledger charge.';
