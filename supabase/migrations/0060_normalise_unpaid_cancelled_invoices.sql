create or replace function public.normalise_unpaid_cancelled_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_status text := '';
begin
  if new.booking_id is not null then
    select lower(coalesce(status::text, ''))
      into v_booking_status
      from public.bookings
      where id::text = new.booking_id::text
      limit 1;
  end if;

  if v_booking_status = 'cancelled'
     and greatest(0, coalesce(new.paid_amount, 0) - coalesce(new.refunded_amount, 0)) = 0
     and (
       lower(coalesce(new.payment_status, '')) <> 'cancelled'
       or lower(coalesce(new.finance_status, '')) <> 'cancelled_no_balance'
       or coalesce(new.parent_portal_status, '') <> 'Cancelled; no payment taken'
       or coalesce(new.balance, 0) <> 0
     ) then
    update public.booking_invoices
       set balance = 0,
           payment_status = 'cancelled',
           parent_portal_status = 'Cancelled; no payment taken',
           finance_status = 'cancelled_no_balance',
           updated_at = now(),
           metadata = jsonb_strip_nulls(
             coalesce(metadata, '{}'::jsonb) ||
             jsonb_build_object(
               'terminalNormalisedAt', now(),
               'terminalNormalisedReason', 'cancelled_without_payment'
             )
           )
     where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists normalise_unpaid_cancelled_invoice_after_change on public.booking_invoices;
create trigger normalise_unpaid_cancelled_invoice_after_change
  after insert or update of total_amount, paid_amount, refunded_amount, balance, payment_status, parent_portal_status, finance_status
  on public.booking_invoices
  for each row
  execute function public.normalise_unpaid_cancelled_invoice();

-- Repair terminal unpaid invoices that pre-date this guard.
update public.booking_invoices invoice
   set balance = 0,
       payment_status = 'cancelled',
       parent_portal_status = 'Cancelled; no payment taken',
       finance_status = 'cancelled_no_balance',
       updated_at = now(),
       metadata = jsonb_strip_nulls(
         coalesce(invoice.metadata, '{}'::jsonb) ||
         jsonb_build_object(
           'terminalNormalisedAt', now(),
           'terminalNormalisedReason', 'cancelled_without_payment'
         )
       )
  from public.bookings booking
 where booking.id::text = invoice.booking_id::text
   and lower(coalesce(booking.status::text, '')) = 'cancelled'
   and greatest(0, coalesce(invoice.paid_amount, 0) - coalesce(invoice.refunded_amount, 0)) = 0
   and (
     lower(coalesce(invoice.payment_status, '')) <> 'cancelled'
     or lower(coalesce(invoice.finance_status, '')) <> 'cancelled_no_balance'
     or coalesce(invoice.parent_portal_status, '') <> 'Cancelled; no payment taken'
     or coalesce(invoice.balance, 0) <> 0
   );
