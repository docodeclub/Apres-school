create or replace function public.cancel_parent_booking(
  p_parent_id uuid,
  p_booking_id uuid,
  p_reason text default null,
  p_actor_role text default 'parent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_invoice booking_invoices%rowtype;
  v_cancelled_items integer := 0;
  v_released_holds integer := 0;
  v_now timestamptz := now();
  v_parent_can_override boolean := lower(coalesce(p_actor_role, 'parent')) in ('admin', 'superadmin', 'manager');
begin
  if p_parent_id is null then
    raise exception 'Parent id is required' using errcode = '22023';
  end if;

  if p_booking_id is null then
    raise exception 'Booking id is required' using errcode = '22023';
  end if;

  select *
    into v_booking
    from bookings
    where id = p_booking_id
      and parent_id = p_parent_id
    for update;

  if not found then
    raise exception 'Booking was not found for this parent' using errcode = '42501';
  end if;

  if v_booking.status = 'cancelled' then
    return jsonb_build_object(
      'cancelled', false,
      'alreadyCancelled', true,
      'booking', jsonb_build_object(
        'id', v_booking.id,
        'bookingReference', v_booking.booking_reference,
        'status', v_booking.status,
        'invoiceId', v_booking.invoice_id,
        'outstandingBalance', v_booking.outstanding_balance,
        'cancellationDeadline', v_booking.cancellation_deadline
      ),
      'items', (
        select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
        from booking_items
        where booking_id = v_booking.id
      )
    );
  end if;

  if v_booking.cancellation_deadline is not null
     and v_now > v_booking.cancellation_deadline
     and not v_parent_can_override then
    raise exception 'Cancellation window has closed' using errcode = '42501';
  end if;

  update booking_items
     set status = 'cancelled',
         updated_at = v_now,
         metadata = jsonb_strip_nulls(
           coalesce(metadata, '{}'::jsonb) ||
           jsonb_build_object(
             'cancelledAt', v_now,
             'cancelledBy', p_parent_id,
             'cancelReason', nullif(p_reason, '')
           )
         )
   where booking_id = v_booking.id
     and status in ('reserved', 'confirmed', 'waitlist');

  get diagnostics v_cancelled_items = row_count;

  update booking_capacity_holds
     set status = 'released',
         released_at = v_now,
         expires_at = least(coalesce(expires_at, v_now), v_now)
   where booking_item_id in (
     select id
     from booking_items
     where booking_id = v_booking.id
   )
     and released_at is null;

  get diagnostics v_released_holds = row_count;

  update bookings
     set status = 'cancelled',
         outstanding_balance = 0,
         updated_at = v_now,
         metadata = jsonb_strip_nulls(
           coalesce(metadata, '{}'::jsonb) ||
           jsonb_build_object(
             'cancelledAt', v_now,
             'cancelledBy', p_parent_id,
             'cancelReason', nullif(p_reason, ''),
             'cancelledInsideWindow', coalesce(v_booking.cancellation_deadline is null or v_now <= v_booking.cancellation_deadline, true)
           )
         )
   where id = v_booking.id
  returning * into v_booking;

  if nullif(v_booking.invoice_id, '') is not null then
    select *
      into v_invoice
      from booking_invoices
      where id = v_booking.invoice_id
      for update;

    if found then
      update booking_invoices
         set balance = 0,
             payment_status = case when paid_amount > 0 then 'cancelled_refund_review' else 'cancelled' end,
             parent_portal_status = case when paid_amount > 0 then 'Cancelled; refund review' else 'Cancelled' end,
             finance_status = case when paid_amount > 0 then 'refund_review' else 'cancelled_no_balance' end,
             metadata = jsonb_strip_nulls(
               coalesce(metadata, '{}'::jsonb) ||
               jsonb_build_object(
                 'cancelledAt', v_now,
                 'cancelledBy', p_parent_id,
                 'cancelReason', nullif(p_reason, ''),
                 'bookingReference', v_booking.booking_reference
               )
             ),
             updated_at = v_now
       where id = v_booking.invoice_id;
    end if;
  end if;

  insert into audit_log (
    actor_id,
    action,
    table_name,
    record_id,
    metadata
  )
  values (
    p_parent_id,
    'parent_booking_cancelled',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'cancelledItems', v_cancelled_items,
      'releasedHolds', v_released_holds,
      'reason', nullif(p_reason, ''),
      'insideWindow', coalesce(v_booking.cancellation_deadline is null or v_now <= v_booking.cancellation_deadline, true)
    )
  );

  return jsonb_build_object(
    'cancelled', true,
    'alreadyCancelled', false,
    'cancelledItems', v_cancelled_items,
    'releasedHolds', v_released_holds,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'status', v_booking.status,
      'invoiceId', v_booking.invoice_id,
      'outstandingBalance', v_booking.outstanding_balance,
      'cancellationDeadline', v_booking.cancellation_deadline
    ),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
      from booking_items
      where booking_id = v_booking.id
    )
  );
end;
$$;

grant execute on function public.cancel_parent_booking(uuid, uuid, text, text) to service_role;
