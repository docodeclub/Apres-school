-- Staff can add an unexpected child to today's register without bypassing
-- duplicate-booking, capacity or finance controls.

create or replace function public.staff_adhoc_booking_options(
  p_register_date date,
  p_site_name text default null,
  p_programme_name text default null,
  p_child_query text default '',
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_children jsonb := '[]'::jsonb;
  v_sessions jsonb := '[]'::jsonb;
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

  select coalesce(jsonb_agg(to_jsonb(child_result) order by child_result.child_name), '[]'::jsonb)
  into v_children
  from (
    select
      child.id as child_id,
      coalesce(child.preferred_name, child.full_name, 'Child') as child_name,
      child.school_name,
      child.year_group,
      account.id as parent_account_id,
      account.full_name as parent_name,
      account.email as parent_email
    from public.child_profiles child
    join public.parent_accounts account on account.id = child.parent_account_id
    where child.active = true
      and child.archived_at is null
      and account.archived_at is null
      and account.portal_status <> 'archived'
      and (
        trim(coalesce(p_child_query, '')) = ''
        or concat_ws(' ', child.preferred_name, child.full_name, account.full_name, account.email)
          ilike '%' || trim(p_child_query) || '%'
      )
    order by coalesce(child.preferred_name, child.full_name)
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) child_result;

  select coalesce(jsonb_agg(to_jsonb(session_result) order by session_result.starts_at, session_result.session_label), '[]'::jsonb)
  into v_sessions
  from (
    select
      block.id as session_block_id,
      session.id as session_id,
      location.name as site_name,
      programme.name as programme_name,
      block.label as session_label,
      block.starts_at,
      block.ends_at,
      coalesce(nullif(block.price, 0), session.price, 0)::numeric(10,2) as price,
      coalesce(block.capacity, session.capacity) as capacity,
      greatest(
        coalesce(block.capacity, session.capacity, 0) - (
          select coalesce(sum(item.quantity), 0)::integer
          from public.booking_items item
          left join public.booking_capacity_holds hold on hold.booking_item_id = item.id
          where item.session_block_id = block.id
            and (
              item.status in ('confirmed', 'attended')
              or (
                item.status = 'reserved'
                and hold.released_at is null
                and hold.status in ('held', 'confirmed')
                and (hold.expires_at is null or hold.expires_at > now())
              )
            )
        ),
        0
      ) as places_left
    from public.session_blocks block
    join public.sessions session on session.id = block.session_id
    join public.programmes programme on programme.id = session.programme_id
    join public.locations location on location.id = programme.location_id
    where (block.starts_at at time zone 'Europe/London')::date = p_register_date
      and block.parent_bookable = true
      and session.parent_bookable = true
      and session.status not in ('cancelled', 'closed')
      and programme.active = true
      and location.active = true
      and (p_site_name is null or location.name = p_site_name)
      and (p_programme_name is null or programme.name = p_programme_name)
  ) session_result;

  return jsonb_build_object(
    'children', v_children,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.create_staff_adhoc_booking(
  p_child_id uuid,
  p_register_date date,
  p_session_block_ids uuid[],
  p_apply_non_booking_fee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child record;
  v_block record;
  v_booking public.bookings%rowtype;
  v_booking_item_id uuid;
  v_invoice_id text;
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_fee numeric(10,2) := case when p_apply_non_booking_fee then 2.50 else 0 end;
  v_total numeric(10,2);
  v_occupied integer;
  v_capacity integer;
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

  if p_child_id is null then
    raise exception 'Choose a pupil.';
  end if;

  if p_session_block_ids is null or cardinality(p_session_block_ids) = 0 then
    raise exception 'Choose at least one session.';
  end if;

  select
    child.*,
    account.profile_id as parent_profile_id,
    account.full_name as parent_name,
    account.email as parent_email,
    account.archived_at as parent_archived_at,
    account.portal_status as parent_portal_status
  into v_child
  from public.child_profiles child
  join public.parent_accounts account on account.id = child.parent_account_id
  where child.id = p_child_id;

  if not found
     or v_child.active = false
     or v_child.archived_at is not null
     or v_child.parent_archived_at is not null
     or v_child.parent_portal_status = 'archived' then
    raise exception 'This pupil is not available for an ad-hoc booking.';
  end if;

  for v_block in
    select
      block.id as session_block_id,
      block.session_id,
      block.label as session_label,
      block.starts_at,
      block.ends_at,
      coalesce(nullif(block.price, 0), session.price, 0)::numeric(10,2) as price,
      coalesce(block.capacity, session.capacity) as capacity,
      location.name as site_name,
      programme.name as programme_name
    from public.session_blocks block
    join public.sessions session on session.id = block.session_id
    join public.programmes programme on programme.id = session.programme_id
    join public.locations location on location.id = programme.location_id
    where block.id = any(p_session_block_ids)
      and (block.starts_at at time zone 'Europe/London')::date = p_register_date
      and block.parent_bookable = true
      and session.parent_bookable = true
      and session.status not in ('cancelled', 'closed')
      and programme.active = true
      and location.active = true
    order by block.starts_at
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(p_child_id::text || ':' || v_block.session_block_id::text, 0)
    );

    if exists (
      select 1
      from public.booking_items item
      left join public.booking_capacity_holds hold on hold.booking_item_id = item.id
      where item.child_id = p_child_id
        and item.session_block_id = v_block.session_block_id
        and (
          item.status in ('confirmed', 'attended')
          or (
            item.status = 'reserved'
            and hold.released_at is null
            and hold.status in ('held', 'confirmed')
            and (hold.expires_at is null or hold.expires_at > now())
          )
        )
    ) then
      raise exception '% is already booked into %.', coalesce(v_child.preferred_name, v_child.full_name), v_block.session_label;
    end if;

    select coalesce(sum(item.quantity), 0)::integer
    into v_occupied
    from public.booking_items item
    left join public.booking_capacity_holds hold on hold.booking_item_id = item.id
    where item.session_block_id = v_block.session_block_id
      and (
        item.status in ('confirmed', 'attended')
        or (
          item.status = 'reserved'
          and hold.released_at is null
          and hold.status in ('held', 'confirmed')
          and (hold.expires_at is null or hold.expires_at > now())
        )
      );

    v_capacity := coalesce(v_block.capacity, 0);
    if v_capacity <= v_occupied then
      raise exception '% is full.', v_block.session_label;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'sessionBlockId', v_block.session_block_id,
      'sessionId', v_block.session_id,
      'sessionLabel', v_block.session_label,
      'startsAt', v_block.starts_at,
      'endsAt', v_block.ends_at,
      'price', v_block.price,
      'capacity', v_capacity,
      'placesLeft', greatest(v_capacity - v_occupied, 0),
      'siteName', v_block.site_name,
      'programmeName', v_block.programme_name
    ));
    v_subtotal := v_subtotal + v_block.price;
  end loop;

  if jsonb_array_length(v_items) <> (
    select count(distinct block_id)
    from unnest(p_session_block_ids) as block_id
  ) then
    raise exception 'One or more selected sessions are not available on this register date.';
  end if;

  v_total := v_subtotal + v_fee;

  insert into public.bookings (
    parent_account_id,
    parent_id,
    parent_email,
    parent_name,
    status,
    source,
    payment_method,
    payment_plan,
    payment_route,
    total_amount,
    due_today,
    outstanding_balance,
    metadata
  )
  values (
    v_child.parent_account_id,
    v_child.parent_profile_id,
    v_child.parent_email,
    v_child.parent_name,
    'confirmed',
    'staff_adhoc',
    'invoice',
    'pay_now',
    'parent_account',
    v_total,
    v_total,
    v_total,
    jsonb_build_object(
      'staffAdHoc', true,
      'addedBy', auth.uid(),
      'registerDate', p_register_date,
      'nonBookingFee', v_fee
    )
  )
  returning * into v_booking;

  for v_block in
    select value
    from jsonb_array_elements(v_items)
  loop
    insert into public.booking_items (
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
      p_child_id,
      (v_block.value->>'sessionId')::uuid,
      (v_block.value->>'sessionBlockId')::uuid,
      coalesce(v_child.preferred_name, v_child.full_name),
      v_block.value->>'siteName',
      v_block.value->>'programmeName',
      v_block.value->>'sessionLabel',
      (v_block.value->>'startsAt')::timestamptz,
      (v_block.value->>'endsAt')::timestamptz,
      1,
      (v_block.value->>'price')::numeric,
      'confirmed',
      jsonb_build_object(
        'capacity', (v_block.value->>'capacity')::integer,
        'availableBeforeBooking', (v_block.value->>'placesLeft')::integer
      ),
      jsonb_build_object('staffAdHoc', true, 'addedBy', auth.uid())
    )
    returning id into v_booking_item_id;

    insert into public.booking_capacity_holds (
      booking_item_id,
      session_id,
      session_block_id,
      child_id,
      quantity,
      status,
      expires_at
    )
    values (
      v_booking_item_id,
      (v_block.value->>'sessionId')::uuid,
      (v_block.value->>'sessionBlockId')::uuid,
      p_child_id,
      1,
      'confirmed',
      null
    );
  end loop;

  v_invoice_id := 'inv_' || v_booking.id::text;
  insert into public.booking_invoices (
    id,
    booking_id,
    parent_id,
    parent_email,
    total_amount,
    paid_amount,
    refunded_amount,
    balance,
    payment_status,
    parent_portal_status,
    receipt_status,
    finance_status,
    metadata
  )
  values (
    v_invoice_id,
    v_booking.id::text,
    v_child.parent_profile_id,
    v_child.parent_email,
    v_total,
    0,
    0,
    v_total,
    'pending',
    'Outstanding',
    'not_issued',
    'awaiting_payment',
    jsonb_build_object(
      'staffAdHoc', true,
      'bookingReference', v_booking.booking_reference,
      'sessionSubtotal', v_subtotal,
      'nonBookingFee', v_fee,
      'addedBy', auth.uid()
    )
  );

  update public.bookings
  set invoice_id = v_invoice_id,
      updated_at = now()
  where id = v_booking.id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'staff_adhoc_booking_created',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'childId', p_child_id,
      'registerDate', p_register_date,
      'sessionCount', jsonb_array_length(v_items),
      'nonBookingFee', v_fee,
      'total', v_total
    )
  );

  return jsonb_build_object(
    'ok', true,
    'bookingId', v_booking.id,
    'bookingReference', v_booking.booking_reference,
    'invoiceId', v_invoice_id,
    'childName', coalesce(v_child.preferred_name, v_child.full_name),
    'sessionCount', jsonb_array_length(v_items),
    'sessionSubtotal', v_subtotal,
    'nonBookingFee', v_fee,
    'total', v_total
  );
end;
$$;

revoke all on function public.staff_adhoc_booking_options(date, text, text, text, integer) from public;
revoke all on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) from public;
grant execute on function public.staff_adhoc_booking_options(date, text, text, text, integer) to authenticated;
grant execute on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) to authenticated;
grant execute on function public.staff_adhoc_booking_options(date, text, text, text, integer) to service_role;
grant execute on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) to service_role;
