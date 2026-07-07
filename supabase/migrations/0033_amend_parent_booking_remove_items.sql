create or replace function public.amend_parent_booking_remove_items(
  p_parent_id uuid,
  p_booking_id uuid,
  p_booking_item_ids uuid[],
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
  v_now timestamptz := now();
  v_parent_can_override boolean := lower(coalesce(p_actor_role, 'parent')) in ('admin', 'superadmin', 'manager');
  v_removed_items integer := 0;
  v_released_holds integer := 0;
  v_removed_total numeric(10,2) := 0;
  v_active_total numeric(10,2) := 0;
  v_active_items integer := 0;
  v_next_status booking_status;
begin
  if p_parent_id is null then
    raise exception 'Parent id is required' using errcode = '22023';
  end if;

  if p_booking_id is null then
    raise exception 'Booking id is required' using errcode = '22023';
  end if;

  if p_booking_item_ids is null or array_length(p_booking_item_ids, 1) is null then
    raise exception 'Choose at least one session to remove' using errcode = '22023';
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
    raise exception 'Cancelled bookings cannot be amended' using errcode = '22023';
  end if;

  if v_booking.amendment_deadline is not null
     and v_now > v_booking.amendment_deadline
     and not v_parent_can_override then
    raise exception 'Amendment window has closed' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(p_booking_item_ids) selected_item(id)
    left join booking_items on booking_items.id = selected_item.id
      and booking_items.booking_id = v_booking.id
    where booking_items.id is null
  ) then
    raise exception 'One or more selected sessions do not belong to this booking' using errcode = '42501';
  end if;

  select coalesce(sum(case when status = 'waitlist' then 0 else line_total end), 0), count(*)
    into v_removed_total, v_removed_items
    from booking_items
    where booking_id = v_booking.id
      and id = any(p_booking_item_ids)
      and status in ('reserved', 'confirmed', 'waitlist');

  if v_removed_items = 0 then
    return jsonb_build_object(
      'amended', false,
      'reason', 'no_active_items_selected',
      'booking', jsonb_build_object(
        'id', v_booking.id,
        'bookingReference', v_booking.booking_reference,
        'status', v_booking.status,
        'invoiceId', v_booking.invoice_id,
        'totalAmount', v_booking.total_amount,
        'outstandingBalance', v_booking.outstanding_balance,
        'amendmentDeadline', v_booking.amendment_deadline
      ),
      'items', (
        select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
        from booking_items
        where booking_id = v_booking.id
      )
    );
  end if;

  update booking_items
     set status = 'cancelled',
         updated_at = v_now,
         metadata = jsonb_strip_nulls(
           coalesce(metadata, '{}'::jsonb) ||
           jsonb_build_object(
             'amendedAt', v_now,
             'amendedBy', p_parent_id,
             'amendmentAction', 'remove_session',
             'amendmentReason', nullif(p_reason, '')
           )
         )
   where booking_id = v_booking.id
     and id = any(p_booking_item_ids)
     and status in ('reserved', 'confirmed', 'waitlist');

  get diagnostics v_removed_items = row_count;

  update booking_capacity_holds
     set status = 'released',
         released_at = v_now,
         expires_at = least(coalesce(expires_at, v_now), v_now)
   where booking_item_id = any(p_booking_item_ids)
     and released_at is null;

  get diagnostics v_released_holds = row_count;

  select coalesce(sum(case when status = 'waitlist' then 0 else line_total end), 0), count(*)
    into v_active_total, v_active_items
    from booking_items
    where booking_id = v_booking.id
      and status in ('reserved', 'confirmed', 'waitlist', 'attended');

  v_next_status := case
    when v_active_items = 0 then 'cancelled'::booking_status
    when v_booking.status = 'confirmed' then 'confirmed'::booking_status
    when exists (
      select 1
      from booking_items
      where booking_id = v_booking.id
        and status = 'waitlist'
    ) then 'waitlist'::booking_status
    else v_booking.status
  end;

  update bookings
     set status = v_next_status,
         total_amount = v_active_total,
         due_today = least(due_today, v_active_total),
         outstanding_balance = greatest(0, outstanding_balance - v_removed_total),
         updated_at = v_now,
         metadata = jsonb_strip_nulls(
           coalesce(metadata, '{}'::jsonb) ||
           jsonb_build_object(
             'lastAmendedAt', v_now,
             'lastAmendedBy', p_parent_id,
             'lastAmendmentAction', 'remove_session',
             'lastAmendmentReason', nullif(p_reason, ''),
             'lastRemovedTotal', v_removed_total,
             'lastRemovedItems', v_removed_items
           )
         )
   where id = v_booking.id
  returning * into v_booking;

  if v_booking.invoice_id is not null then
    select *
      into v_invoice
      from booking_invoices
      where id = v_booking.invoice_id
      for update;

    if found then
      update booking_invoices
         set total_amount = greatest(0, total_amount - v_removed_total),
             balance = greatest(0, balance - v_removed_total),
             payment_status = case
               when paid_amount > greatest(0, total_amount - v_removed_total) then 'amended_credit_review'
               when greatest(0, balance - v_removed_total) = 0 and paid_amount > 0 then 'paid'
               else payment_status
             end,
             parent_portal_status = case
               when paid_amount > greatest(0, total_amount - v_removed_total) then 'Amended; credit review'
               when greatest(0, balance - v_removed_total) = 0 then 'Paid; receipt available'
               else 'Amended; balance updated'
             end,
             finance_status = case
               when paid_amount > greatest(0, total_amount - v_removed_total) then 'credit_review'
               else finance_status
             end,
             metadata = jsonb_strip_nulls(
               coalesce(metadata, '{}'::jsonb) ||
               jsonb_build_object(
                 'lastAmendedAt', v_now,
                 'lastAmendedBy', p_parent_id,
                 'lastAmendmentAction', 'remove_session',
                 'lastRemovedTotal', v_removed_total,
                 'lastRemovedItems', v_removed_items
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
    'parent_booking_amended_remove_items',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'removedItems', v_removed_items,
      'releasedHolds', v_released_holds,
      'removedTotal', v_removed_total,
      'reason', nullif(p_reason, ''),
      'insideWindow', coalesce(v_booking.amendment_deadline is null or v_now <= v_booking.amendment_deadline, true)
    )
  );

  return jsonb_build_object(
    'amended', true,
    'removedItems', v_removed_items,
    'releasedHolds', v_released_holds,
    'removedTotal', v_removed_total,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'status', v_booking.status,
      'invoiceId', v_booking.invoice_id,
      'totalAmount', v_booking.total_amount,
      'dueToday', v_booking.due_today,
      'outstandingBalance', v_booking.outstanding_balance,
      'amendmentDeadline', v_booking.amendment_deadline
    ),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
      from booking_items
      where booking_id = v_booking.id
    )
  );
end;
$$;

grant execute on function public.amend_parent_booking_remove_items(uuid, uuid, uuid[], text, text) to service_role;
