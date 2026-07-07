create or replace function public.amend_parent_booking_add_items(
  p_parent_id uuid,
  p_booking_id uuid,
  p_items jsonb default '[]'::jsonb,
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
  v_parent_account parent_accounts%rowtype;
  v_item jsonb;
  v_child child_profiles%rowtype;
  v_block record;
  v_quantity integer;
  v_capacity integer;
  v_held integer;
  v_available integer;
  v_status booking_item_status;
  v_unit_amount numeric(10,2);
  v_line_total numeric(10,2);
  v_added_total numeric(10,2) := 0;
  v_active_total numeric(10,2) := 0;
  v_added_items integer := 0;
  v_held_items integer := 0;
  v_waitlist_items integer := 0;
  v_now timestamptz := now();
  v_parent_can_override boolean := lower(coalesce(p_actor_role, 'parent')) in ('admin', 'superadmin', 'manager');
  v_saved_item jsonb;
begin
  if p_parent_id is null then
    raise exception 'Parent id is required' using errcode = '22023';
  end if;

  if p_booking_id is null then
    raise exception 'Booking id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one session to add' using errcode = '22023';
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

  select *
    into v_parent_account
    from parent_accounts
    where id = v_booking.parent_account_id
       or profile_id = p_parent_id
    order by case when id = v_booking.parent_account_id then 0 else 1 end
    limit 1;

  if not found then
    raise exception 'Parent account was not found for this booking' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := greatest(1, coalesce(nullif(v_item->>'quantity', '')::integer, 1));

    select
      session_blocks.id as session_block_id,
      session_blocks.session_id,
      session_blocks.label,
      session_blocks.starts_at,
      session_blocks.ends_at,
      session_blocks.price as block_price,
      session_blocks.capacity as block_capacity,
      session_blocks.parent_bookable as block_parent_bookable,
      sessions.price as session_price,
      sessions.capacity as session_capacity,
      sessions.parent_bookable as session_parent_bookable,
      sessions.booking_cutoff_hours,
      sessions.payment_route,
      programmes.name as programme_name,
      locations.name as site_name
    into v_block
    from session_blocks
    join sessions on sessions.id = session_blocks.session_id
    left join programmes on programmes.id = sessions.programme_id
    left join locations on locations.id = programmes.location_id
    where session_blocks.id = nullif(v_item->>'sessionBlockId', '')::uuid
       or session_blocks.id = nullif(v_item->>'session_block_id', '')::uuid
       or (
        session_blocks.metadata->>'labSessionId' = coalesce(v_item->>'labSessionId', v_item->'metadata'->>'labSessionId')
        and session_blocks.metadata->>'sessionDate' = coalesce(v_item->>'sessionDate', v_item->'metadata'->>'sessionDate')
        and session_blocks.label = coalesce(v_item->>'sessionLabel', v_item->'metadata'->>'labBlockLabel')
       )
    limit 1;

    if not found then
      raise exception 'Selected session block was not found' using errcode = '22023';
    end if;

    if v_block.block_parent_bookable is not true or v_block.session_parent_bookable is not true then
      raise exception 'Selected session is not parent bookable' using errcode = '42501';
    end if;

    if v_block.starts_at <= v_now + make_interval(hours => greatest(0, coalesce(v_block.booking_cutoff_hours, 0))) then
      raise exception 'Selected session is past the booking cut-off' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_block.session_block_id::text, 0));

    v_child := null;
    if nullif(v_item->>'childId', '') is not null or nullif(v_item->>'child_id', '') is not null then
      select *
        into v_child
        from child_profiles
        where id = coalesce(nullif(v_item->>'childId', '')::uuid, nullif(v_item->>'child_id', '')::uuid)
          and parent_account_id = v_parent_account.id
          and active = true;

      if not found then
        raise exception 'Selected child does not belong to this parent account' using errcode = '42501';
      end if;
    end if;

    if exists (
      select 1
      from booking_items
      where booking_id = v_booking.id
        and session_block_id = v_block.session_block_id
        and (
          (v_child.id is not null and child_id = v_child.id)
          or (
            v_child.id is null
            and child_id is null
            and lower(coalesce(child_name, '')) = lower(coalesce(nullif(v_item->>'childName', ''), nullif(v_item->>'child_name', ''), ''))
          )
        )
        and status in ('reserved', 'confirmed', 'waitlist', 'attended')
    ) then
      continue;
    end if;

    v_capacity := coalesce(v_block.block_capacity, v_block.session_capacity);
    select coalesce(sum(quantity), 0)::integer
      into v_held
      from booking_capacity_holds
      where session_block_id = v_block.session_block_id
        and released_at is null
        and status in ('held', 'confirmed')
        and (expires_at is null or expires_at > v_now);

    v_available := case when v_capacity is null then null else greatest(0, v_capacity - v_held) end;
    v_status := case when v_capacity is null or v_available >= v_quantity then 'reserved'::booking_item_status else 'waitlist'::booking_item_status end;
    v_unit_amount := coalesce(nullif(v_block.block_price, 0), nullif(v_block.session_price, 0), 0);
    v_line_total := case when v_status = 'waitlist' then 0 else round(v_unit_amount * v_quantity, 2) end;
    v_added_total := v_added_total + v_line_total;

    insert into booking_items (
      booking_id,
      child_id,
      session_id,
      session_block_id,
      child_name,
      site_name,
      programme_name,
      session_label,
      starts_at,
      ends_at,
      quantity,
      unit_amount,
      status,
      capacity_snapshot,
      metadata
    )
    values (
      v_booking.id,
      case when v_child.id is null then null else v_child.id end,
      v_block.session_id,
      v_block.session_block_id,
      coalesce(nullif(v_item->>'childName', ''), nullif(v_item->>'child_name', ''), v_child.full_name),
      coalesce(nullif(v_item->>'siteName', ''), nullif(v_item->>'site_name', ''), v_block.site_name),
      coalesce(v_block.programme_name, nullif(v_item->>'programmeName', ''), nullif(v_item->>'programme_name', '')),
      v_block.label,
      v_block.starts_at,
      v_block.ends_at,
      v_quantity,
      v_unit_amount,
      v_status,
      jsonb_build_object(
        'capacity', v_capacity,
        'heldBeforeAmendment', v_held,
        'availableBeforeAmendment', v_available
      ),
      jsonb_strip_nulls(
        coalesce(v_item->'metadata', '{}'::jsonb) ||
        jsonb_build_object(
          'amendedAt', v_now,
          'amendedBy', p_parent_id,
          'amendmentAction', 'add_session',
          'amendmentReason', nullif(p_reason, '')
        )
      )
    )
    returning jsonb_build_object(
      'id', booking_items.id,
      'booking_id', booking_items.booking_id,
      'child_id', booking_items.child_id,
      'session_id', booking_items.session_id,
      'session_block_id', booking_items.session_block_id,
      'child_name', booking_items.child_name,
      'site_name', booking_items.site_name,
      'programme_name', booking_items.programme_name,
      'session_label', booking_items.session_label,
      'starts_at', booking_items.starts_at,
      'ends_at', booking_items.ends_at,
      'quantity', booking_items.quantity,
      'unit_amount', booking_items.unit_amount,
      'line_total', booking_items.line_total,
      'status', booking_items.status,
      'capacity_snapshot', booking_items.capacity_snapshot,
      'metadata', booking_items.metadata
    ) into v_saved_item;

    v_added_items := v_added_items + 1;
    if v_status = 'waitlist' then
      v_waitlist_items := v_waitlist_items + 1;
    else
      insert into booking_capacity_holds (
        booking_item_id,
        session_id,
        session_block_id,
        child_id,
        quantity,
        status,
        expires_at
      )
      values (
        (v_saved_item->>'id')::uuid,
        (v_saved_item->>'session_id')::uuid,
        (v_saved_item->>'session_block_id')::uuid,
        nullif(v_saved_item->>'child_id', '')::uuid,
        (v_saved_item->>'quantity')::integer,
        'held',
        v_now + interval '30 minutes'
      );
      v_held_items := v_held_items + 1;
    end if;
  end loop;

  select coalesce(sum(case when status = 'waitlist' then 0 else line_total end), 0)
    into v_active_total
    from booking_items
    where booking_id = v_booking.id
      and status in ('reserved', 'confirmed', 'waitlist', 'attended');

  update bookings
     set status = case
           when exists (select 1 from booking_items where booking_id = v_booking.id and status = 'waitlist') then 'waitlist'::booking_status
           else v_booking.status
         end,
         total_amount = v_active_total,
         due_today = case when payment_plan = 'monthly' then due_today else v_active_total end,
         outstanding_balance = greatest(0, outstanding_balance + v_added_total),
         updated_at = v_now,
         metadata = jsonb_strip_nulls(
           coalesce(metadata, '{}'::jsonb) ||
           jsonb_build_object(
             'lastAmendedAt', v_now,
             'lastAmendedBy', p_parent_id,
             'lastAmendmentAction', 'add_session',
             'lastAmendmentReason', nullif(p_reason, ''),
             'lastAddedTotal', v_added_total,
             'lastAddedItems', v_added_items,
             'lastWaitlistItems', v_waitlist_items
           )
         )
   where id = v_booking.id
  returning * into v_booking;

  if v_booking.invoice_id is not null then
    update booking_invoices
       set total_amount = total_amount + v_added_total,
           balance = balance + v_added_total,
           payment_status = case when v_added_total > 0 then 'amended_balance_due' else payment_status end,
           parent_portal_status = case when v_added_total > 0 then 'Amended; balance due' else parent_portal_status end,
           finance_status = case when v_added_total > 0 then 'awaiting_payment' else finance_status end,
           metadata = jsonb_strip_nulls(
             coalesce(metadata, '{}'::jsonb) ||
             jsonb_build_object(
               'lastAmendedAt', v_now,
               'lastAmendedBy', p_parent_id,
               'lastAmendmentAction', 'add_session',
               'lastAddedTotal', v_added_total,
               'lastAddedItems', v_added_items
             )
           ),
           updated_at = v_now
     where id = v_booking.invoice_id;
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
    'parent_booking_amended_add_items',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'addedItems', v_added_items,
      'heldItems', v_held_items,
      'waitlistItems', v_waitlist_items,
      'addedTotal', v_added_total,
      'reason', nullif(p_reason, ''),
      'insideWindow', coalesce(v_booking.amendment_deadline is null or v_now <= v_booking.amendment_deadline, true)
    )
  );

  return jsonb_build_object(
    'amended', true,
    'addedItems', v_added_items,
    'heldItems', v_held_items,
    'waitlistItems', v_waitlist_items,
    'addedTotal', v_added_total,
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

grant execute on function public.amend_parent_booking_add_items(uuid, uuid, jsonb, text, text) to service_role;
