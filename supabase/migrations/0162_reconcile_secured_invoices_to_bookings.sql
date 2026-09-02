-- Provider events update invoice state before the booking header. If a later
-- step is interrupted, a paid/guaranteed invoice can otherwise leave its
-- booking in payment_pending and hide valid child sessions from operations.

create or replace function public.sync_secured_invoice_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.payment_status, '')) in (
    'paid',
    'bank_confirmed',
    'reconciled',
    'paid_by_fallback_card',
    'payment_guaranteed',
    'payment_plan_active',
    'captured'
  ) then
    update public.bookings booking
    set status = 'confirmed',
        outstanding_balance = greatest(0, coalesce(new.balance, 0)),
        updated_at = now()
    where (
        (new.booking_id is not null and booking.id::text = new.booking_id)
        or booking.invoice_id = new.id
      )
      and booking.status in ('reserved', 'payment_pending', 'payment_plan_active');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_secured_invoice_booking_trigger on public.booking_invoices;
create trigger sync_secured_invoice_booking_trigger
  after insert or update of payment_status, booking_id, balance on public.booking_invoices
  for each row
  execute function public.sync_secured_invoice_booking();

-- Repair existing paid or guaranteed invoices without reviving cancelled or
-- waitlisted bookings. The booking trigger added in migration 0161 then
-- confirms their session rows and capacity holds in the same transaction.
update public.bookings booking
set status = 'confirmed',
    outstanding_balance = greatest(0, coalesce(invoice.balance, 0)),
    updated_at = now()
from public.booking_invoices invoice
where (
    (invoice.booking_id is not null and booking.id::text = invoice.booking_id)
    or booking.invoice_id = invoice.id
  )
  and lower(coalesce(invoice.payment_status, '')) in (
    'paid',
    'bank_confirmed',
    'reconciled',
    'paid_by_fallback_card',
    'payment_guaranteed',
    'payment_plan_active',
    'captured'
  )
  and booking.status in ('reserved', 'payment_pending', 'payment_plan_active');

revoke all on function public.sync_secured_invoice_booking() from public;
grant execute on function public.sync_secured_invoice_booking() to service_role;

comment on function public.sync_secured_invoice_booking() is
  'Reconciles secured invoice states to confirmed bookings so operational registers cannot miss paid sessions.';
