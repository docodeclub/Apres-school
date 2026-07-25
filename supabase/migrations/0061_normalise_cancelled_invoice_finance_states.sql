create or replace function public.normalise_cancelled_invoice_finance_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_status text := '';
  v_paid numeric(10,2) := greatest(0, coalesce(new.paid_amount, 0));
  v_refunded numeric(10,2) := greatest(0, coalesce(new.refunded_amount, 0));
  v_payment_status text;
  v_parent_portal_status text;
  v_finance_status text;
  v_reason text;
begin
  if new.booking_id is not null then
    select lower(coalesce(status::text, ''))
      into v_booking_status
      from public.bookings
      where id::text = new.booking_id::text
      limit 1;
  end if;

  if v_booking_status <> 'cancelled' then
    return new;
  end if;

  if v_paid <= 0 then
    v_payment_status := 'cancelled';
    v_parent_portal_status := 'Cancelled; no payment taken';
    v_finance_status := 'cancelled_no_balance';
    v_reason := 'cancelled_without_payment';
  elsif v_refunded >= v_paid then
    v_payment_status := 'refunded';
    v_parent_portal_status := 'Cancelled; payment refunded';
    v_finance_status := 'refunded';
    v_reason := 'cancelled_payment_refunded';
  else
    v_payment_status := 'cancelled_credit';
    v_parent_portal_status := 'Cancelled; credit applied to account';
    v_finance_status := 'credited';
    v_reason := 'cancelled_account_credit';
  end if;

  if lower(coalesce(new.payment_status, '')) <> v_payment_status
     or lower(coalesce(new.finance_status, '')) <> v_finance_status
     or coalesce(new.parent_portal_status, '') <> v_parent_portal_status
     or coalesce(new.balance, 0) <> 0 then
    update public.booking_invoices
       set balance = 0,
           payment_status = v_payment_status,
           parent_portal_status = v_parent_portal_status,
           finance_status = v_finance_status,
           updated_at = now(),
           metadata = jsonb_strip_nulls(
             coalesce(metadata, '{}'::jsonb) ||
             jsonb_build_object(
               'terminalNormalisedAt', now(),
               'terminalNormalisedReason', v_reason
             )
           )
     where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists normalise_unpaid_cancelled_invoice_after_change on public.booking_invoices;
drop function if exists public.normalise_unpaid_cancelled_invoice();

drop trigger if exists normalise_cancelled_invoice_finance_state_after_change on public.booking_invoices;
create trigger normalise_cancelled_invoice_finance_state_after_change
  after insert or update of total_amount, paid_amount, refunded_amount, balance, payment_status, parent_portal_status, finance_status
  on public.booking_invoices
  for each row
  execute function public.normalise_cancelled_invoice_finance_state();

-- Re-evaluate existing cancelled invoices once so legacy parent-facing labels
-- distinguish unpaid cancellations, account credit and completed refunds.
update public.booking_invoices invoice
   set finance_status = invoice.finance_status
  from public.bookings booking
 where booking.id::text = invoice.booking_id::text
   and lower(coalesce(booking.status::text, '')) = 'cancelled';
