create or replace function public.create_parent_booking_reservation(
  p_parent_id uuid,
  p_parent_email text,
  p_parent_name text,
  p_parent_phone text default null,
  p_booking jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_parent_account parent_accounts%rowtype;
  v_booking bookings%rowtype;
  v_item jsonb;
  v_child child_profiles%rowtype;
  v_block record;
  v_quantity integer;
  v_capacity integer;
  v_held integer;
  v_requested_before integer;
  v_available integer;
  v_status booking_item_status;
  v_unit_amount numeric(10,2);
  v_line_total numeric(10,2);
  v_total numeric(10,2) := 0;
  v_due_today numeric(10,2) := 0;
  v_deposit numeric(10,2) := 0;
  v_earliest_start timestamptz;
  v_payment_plan text := coalesce(nullif(p_booking->>'paymentPlan', ''), nullif(p_booking->>'payment_plan', ''), 'pay_now');
  v_payment_method text := coalesce(nullif(p_booking->>'paymentMethod', ''), nullif(p_booking->>'payment_method', ''), 'card');
  v_payment_route text := coalesce(nullif(p_booking->>'paymentRoute', ''), nullif(p_booking->>'payment_route', ''), 'ponchopay_card_voucher');
  v_booking_status booking_status := 'reserved';
  v_cancellation_hours integer := coalesce(nullif(p_booking->>'cancellationHours', '')::integer, nullif(p_booking->>'cancellation_hours', '')::integer, 24);
  v_amendment_hours integer := coalesce(nullif(p_booking->>'amendmentHours', '')::integer, nullif(p_booking->>'amendment_hours', '')::integer, 24);
  v_items jsonb := '[]'::jsonb;
  v_invoice_id text;
  v_client_request_id text := coalesce(
    nullif(p_booking->>'clientRequestId', ''),
    nullif(p_booking->>'client_request_id', ''),
    nullif(p_booking->'metadata'->>'clientRequestId', ''),
    nullif(p_booking->'metadata'->>'client_request_id', ''),
    nullif(p_booking->'metadata'->>'localDraftId', '')
  );
begin
  if p_parent_id is null then
    raise exception 'Parent id is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one booking item is required' using errcode = '22023';
  end if;

  select *
    into v_profile
    from profiles
    where id = p_parent_id
      and active = true;

  if not found then
    raise exception 'Parent profile is not active' using errcode = '28000';
  end if;

  if nullif(p_parent_email, '') is not null and lower(p_parent_email) <> lower(v_profile.email) then
    raise exception 'Parent email does not match signed-in profile' using errcode = '28000';
  end if;

  select *
    into v_parent_account
    from parent_accounts
    where profile_id = p_parent_id
       or lower(email) = lower(v_profile.email)
    order by case when profile_id = p_parent_id then 0 else 1 end
    limit 1;

  if found then
    update parent_accounts
       set profile_id = coalesce(parent_accounts.profile_id, p_parent_id),
           full_name = coalesce(nullif(p_parent_name, ''), parent_accounts.full_name, v_profile.full_name, v_profile.email),
           phone = coalesce(nullif(p_parent_phone, ''), parent_accounts.phone),
           updated_at = now()
     where id = v_parent_account.id
     returning * into v_parent_account;
  else
    insert into parent_accounts (profile_id, full_name, email, phone)
    values (
      p_parent_id,
      coalesce(nullif(p_parent_name, ''), v_profile.full_name, v_profile.email),
      lower(v_profile.email),
      nullif(p_parent_phone, '')
    )
    returning * into v_parent_account;
  end if;

  if nullif(v_client_request_id, '') is not null then
    select *
      into v_booking
      from bookings
      where parent_id = p_parent_id
        and metadata->>'clientRequestId' = v_client_request_id
      order by created_at desc
      limit 1;

    if found then
      v_invoice_id := coalesce(v_booking.invoice_id, 'inv_' || v_booking.id::text);
      return jsonb_build_object(
        'existing', true,
        'booking', jsonb_build_object(
          'id', v_booking.id,
          'bookingReference', v_booking.booking_reference,
          'status', v_booking.status,
          'invoiceId', v_invoice_id,
          'totalAmount', v_booking.total_amount,
          'dueToday', v_booking.due_today,
          'outstandingBalance', v_booking.outstanding_balance,
          'paymentMethod', v_booking.payment_method,
          'paymentPlan', v_booking.payment_plan,
          'paymentRoute', v_booking.payment_route,
          'cancellationDeadline', v_booking.cancellation_deadline,
          'amendmentDeadline', v_booking.amendment_deadline
        ),
        'parent', jsonb_build_object(
          'id', v_parent_account.id,
          'profileId', v_parent_account.profile_id,
          'fullName', v_parent_account.full_name,
          'email', v_parent_account.email
        ),
        'items', (
          select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
          from booking_items
          where booking_id = v_booking.id
        )
      );
    end if;
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
      programmes.category as programme_category,
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

    if v_block.starts_at <= now() + make_interval(hours => greatest(0, coalesce(v_block.booking_cutoff_hours, 0))) then
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

    v_capacity := coalesce(v_block.block_capacity, v_block.session_capacity);
    select coalesce(sum(quantity), 0)::integer
      into v_held
      from booking_capacity_holds
      where session_block_id = v_block.session_block_id
        and released_at is null
        and status in ('held', 'confirmed')
        and (expires_at is null or expires_at > now());

    select coalesce(sum((item->>'quantity')::integer), 0)::integer
      into v_requested_before
      from jsonb_array_elements(v_items) item
      where item->>'sessionBlockId' = v_block.session_block_id::text
        and item->>'status' = 'reserved';

    v_available := case when v_capacity is null then null else greatest(0, v_capacity - v_held - v_requested_before) end;
    v_status := case when v_capacity is null or v_available >= v_quantity then 'reserved'::booking_item_status else 'waitlist'::booking_item_status end;
    v_unit_amount := coalesce(nullif(v_block.block_price, 0), nullif(v_block.session_price, 0), 0);
    v_line_total := case when v_status = 'waitlist' then 0 else round(v_unit_amount * v_quantity, 2) end;
    v_total := v_total + v_line_total;
    v_payment_route := coalesce(nullif(v_block.payment_route, ''), v_payment_route);
    v_earliest_start := least(coalesce(v_earliest_start, v_block.starts_at), v_block.starts_at);

    v_items := v_items || jsonb_build_object(
      'childId', case when v_child.id is null then null else v_child.id end,
      'childName', coalesce(nullif(v_item->>'childName', ''), nullif(v_item->>'child_name', ''), v_child.full_name),
      'sessionId', v_block.session_id,
      'sessionBlockId', v_block.session_block_id,
      'siteName', coalesce(nullif(v_item->>'siteName', ''), nullif(v_item->>'site_name', ''), v_block.site_name),
      'programmeName', coalesce(v_block.programme_name, nullif(v_item->>'programmeName', ''), nullif(v_item->>'programme_name', '')),
      'sessionLabel', v_block.label,
      'startsAt', v_block.starts_at,
      'endsAt', v_block.ends_at,
      'quantity', v_quantity,
      'unitAmount', v_unit_amount,
      'lineTotal', v_line_total,
      'status', v_status,
      'capacitySnapshot', jsonb_build_object(
        'capacity', v_capacity,
        'heldBeforeBooking', v_held,
        'requestedEarlierInBasket', v_requested_before,
        'availableBeforeBooking', v_available
      ),
      'metadata', coalesce(v_item->'metadata', '{}'::jsonb)
    );
  end loop;

  v_deposit := greatest(0, coalesce(nullif(p_booking->>'depositAmount', '')::numeric, nullif(p_booking->>'deposit_amount', '')::numeric, 0));
  v_due_today := case when lower(v_payment_plan) = 'monthly' then least(v_total, v_deposit) else v_total end;
  v_invoice_id := 'inv_' || gen_random_uuid()::text;

  insert into bookings (
    parent_account_id,
    parent_id,
    parent_email,
    parent_name,
    status,
    source,
    invoice_id,
    payment_method,
    payment_plan,
    payment_route,
    total_amount,
    due_today,
    outstanding_balance,
    cancellation_deadline,
    amendment_deadline,
    metadata
  )
  values (
    v_parent_account.id,
    p_parent_id,
    lower(v_profile.email),
    coalesce(nullif(p_parent_name, ''), v_profile.full_name, v_profile.email),
    case when exists (select 1 from jsonb_array_elements(v_items) item where item->>'status' = 'waitlist') then 'waitlist'::booking_status else v_booking_status end,
    coalesce(nullif(p_booking->>'source', ''), 'parent_portal'),
    null,
    v_payment_method,
    v_payment_plan,
    v_payment_route,
    v_total,
    v_due_today,
    greatest(0, v_total - v_due_today),
    case when v_earliest_start is null then null else v_earliest_start - make_interval(hours => greatest(0, v_cancellation_hours)) end,
    case when v_earliest_start is null then null else v_earliest_start - make_interval(hours => greatest(0, v_amendment_hours)) end,
    jsonb_strip_nulls(jsonb_build_object(
      'clientRequestId', nullif(v_client_request_id, ''),
      'bookingRequest', coalesce(p_booking, '{}'::jsonb),
      'reservationSource', 'create_parent_booking_reservation'
    ))
  )
  returning * into v_booking;

  v_invoice_id := 'inv_' || v_booking.id::text;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
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
      nullif(v_item->>'childId', '')::uuid,
      (v_item->>'sessionId')::uuid,
      (v_item->>'sessionBlockId')::uuid,
      nullif(v_item->>'childName', ''),
      nullif(v_item->>'siteName', ''),
      nullif(v_item->>'programmeName', ''),
      v_item->>'sessionLabel',
      (v_item->>'startsAt')::timestamptz,
      (v_item->>'endsAt')::timestamptz,
      (v_item->>'quantity')::integer,
      (v_item->>'unitAmount')::numeric,
      (v_item->>'status')::booking_item_status,
      coalesce(v_item->'capacitySnapshot', '{}'::jsonb),
      coalesce(v_item->'metadata', '{}'::jsonb)
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
    ) into v_item;

    if v_item->>'status' = 'reserved' then
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
        (v_item->>'id')::uuid,
        (v_item->>'session_id')::uuid,
        (v_item->>'session_block_id')::uuid,
        nullif(v_item->>'child_id', '')::uuid,
        (v_item->>'quantity')::integer,
        'held',
        now() + interval '30 minutes'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'existing', false,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'status', v_booking.status,
      'invoiceId', v_invoice_id,
      'totalAmount', v_booking.total_amount,
      'dueToday', v_booking.due_today,
      'outstandingBalance', v_booking.outstanding_balance,
      'paymentMethod', v_booking.payment_method,
      'paymentPlan', v_booking.payment_plan,
      'paymentRoute', v_booking.payment_route,
      'cancellationDeadline', v_booking.cancellation_deadline,
      'amendmentDeadline', v_booking.amendment_deadline
    ),
    'parent', jsonb_build_object(
      'id', v_parent_account.id,
      'profileId', v_parent_account.profile_id,
      'fullName', v_parent_account.full_name,
      'email', v_parent_account.email
    ),
    'items', (
      select coalesce(jsonb_agg(to_jsonb(booking_items.*) order by booking_items.starts_at), '[]'::jsonb)
      from booking_items
      where booking_id = v_booking.id
    )
  );
end;
$$;

grant execute on function public.create_parent_booking_reservation(uuid, text, text, text, jsonb, jsonb) to service_role;
