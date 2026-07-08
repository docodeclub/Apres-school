create or replace function public.admin_upsert_booking_session_override(p_override jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_school text := nullif(trim(p_override->>'school'), '');
  v_session_date date := nullif(trim(p_override->>'sessionDate'), '')::date;
  v_session_label text := coalesce(nullif(trim(p_override->>'sessionLabel'), ''), 'Session 1');
  v_time_window text := coalesce(nullif(trim(p_override->>'timeWindow'), ''), '15:30-16:00');
  v_start_time time;
  v_end_time time;
  v_price numeric(10,2) := coalesce(nullif(trim(p_override->>'price'), '')::numeric, 0);
  v_capacity integer := coalesce(nullif(trim(p_override->>'capacity'), '')::integer, 0);
  v_cancellation_hours integer := coalesce(nullif(trim(p_override->>'cancellationHours'), '')::integer, 24);
  v_status text := coalesce(nullif(trim(p_override->>'status'), ''), 'open');
  v_parent_bookable boolean;
  v_payment_route text := coalesce(nullif(trim(p_override->>'paymentRoute'), ''), 'ponchopay_card_voucher');
  v_eligibility_text text := nullif(trim(p_override->>'eligibility'), '');
  v_notes text := nullif(trim(p_override->>'notes'), '');
  v_programme_name text;
  v_booking_label text;
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_block_id uuid;
begin
  select role
    into v_role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Only admins can update booking overrides.';
  end if;

  if v_school is null then
    raise exception 'School is required.';
  end if;

  if v_session_date is null then
    raise exception 'Session date is required.';
  end if;

  if position('-' in v_time_window) = 0 then
    raise exception 'Time must be in HH:MM-HH:MM format.';
  end if;

  v_start_time := trim(split_part(v_time_window, '-', 1))::time;
  v_end_time := trim(split_part(v_time_window, '-', 2))::time;

  if v_end_time <= v_start_time then
    raise exception 'Session end time must be after the start time.';
  end if;

  v_payment_route := case
    when lower(v_payment_route) like '%voucher%' then 'ponchopay_card_voucher'
    when lower(v_payment_route) like '%poncho%' then 'ponchopay_card'
    else lower(replace(v_payment_route, ' ', '_'))
  end;

  v_parent_bookable := coalesce((p_override->>'parentBookable')::boolean, true)
    and v_status not in ('closed', 'cancelled', 'full');

  v_programme_name := case
    when lower(v_session_label) like '%breakfast%' or v_start_time < '12:00'::time then 'Breakfast Club'
    else 'After-school Club'
  end;

  v_booking_label := case
    when v_programme_name = 'Breakfast Club' then 'Breakfast club'
    else 'After-school care'
  end;

  insert into public.locations (id, name, area, booking_platform, booking_url, public_notes, operational_notes, active)
  values (
    public.apres_stable_uuid('location:' || v_school),
    v_school,
    coalesce(nullif(trim(p_override->>'area'), ''), 'School'),
    'Après booking system',
    '/launch-booking',
    'Parent-bookable booking system location.',
    'Managed from staff admin bookings.',
    true
  )
  on conflict (name) do update
  set booking_platform = excluded.booking_platform,
      booking_url = excluded.booking_url,
      public_notes = excluded.public_notes,
      operational_notes = excluded.operational_notes,
      active = true
  returning id into v_location_id;

  insert into public.programmes (id, location_id, name, category, age_range, booking_notes, active)
  values (
    public.apres_stable_uuid('programme:admin:' || v_school || ':' || v_programme_name || ':wraparound'),
    v_location_id,
    v_programme_name,
    'wraparound',
    coalesce(v_eligibility_text, 'School pupils'),
    'Parent-bookable provision managed from staff admin bookings.',
    true
  )
  on conflict (location_id, name, category) do update
  set age_range = excluded.age_range,
      booking_notes = excluded.booking_notes,
      active = true
  returning id into v_programme_id;

  select block.session_id, block.id
    into v_session_id, v_block_id
  from public.session_blocks block
  join public.sessions session on session.id = block.session_id
  where session.programme_id = v_programme_id
    and block.label = v_session_label
    and block.starts_at::date = v_session_date
  order by block.starts_at desc
  limit 1;

  if v_session_id is null then
    insert into public.sessions (
      id,
      programme_id,
      starts_at,
      ends_at,
      capacity,
      status,
      notes,
      booking_label,
      parent_bookable,
      price,
      payment_route,
      cancellation_hours,
      amendment_hours,
      booking_cutoff_hours,
      eligibility,
      booking_metadata
    )
    values (
      public.apres_stable_uuid('session:override:' || v_school || ':' || v_programme_name || ':' || v_session_date::text || ':' || v_session_label),
      v_programme_id,
      (v_session_date + v_start_time) at time zone 'Europe/London',
      (v_session_date + v_end_time) at time zone 'Europe/London',
      v_capacity,
      v_status,
      coalesce(v_notes, 'Created from staff admin day override.'),
      v_booking_label,
      v_parent_bookable,
      v_price,
      v_payment_route,
      v_cancellation_hours,
      v_cancellation_hours,
      0,
      jsonb_build_object('schoolOnly', true, 'label', coalesce(v_eligibility_text, 'School pupils')),
      jsonb_build_object('source', 'staff_admin_override', 'override', p_override, 'sessionDate', v_session_date)
    )
    on conflict (programme_id, starts_at, ends_at) do update
    set capacity = excluded.capacity,
        status = excluded.status,
        notes = excluded.notes,
        booking_label = excluded.booking_label,
        parent_bookable = excluded.parent_bookable,
        price = excluded.price,
        payment_route = excluded.payment_route,
        cancellation_hours = excluded.cancellation_hours,
        amendment_hours = excluded.amendment_hours,
        booking_cutoff_hours = excluded.booking_cutoff_hours,
        eligibility = excluded.eligibility,
        booking_metadata = excluded.booking_metadata
    returning id into v_session_id;
  else
    update public.sessions
    set starts_at = (v_session_date + v_start_time) at time zone 'Europe/London',
        ends_at = (v_session_date + v_end_time) at time zone 'Europe/London',
        capacity = v_capacity,
        status = v_status,
        notes = coalesce(v_notes, 'Updated from staff admin day override.'),
        booking_label = v_booking_label,
        parent_bookable = v_parent_bookable,
        price = v_price,
        payment_route = v_payment_route,
        cancellation_hours = v_cancellation_hours,
        amendment_hours = v_cancellation_hours,
        booking_cutoff_hours = 0,
        eligibility = jsonb_build_object('schoolOnly', true, 'label', coalesce(v_eligibility_text, 'School pupils')),
        booking_metadata = coalesce(booking_metadata, '{}'::jsonb) || jsonb_build_object('source', 'staff_admin_override', 'override', p_override, 'sessionDate', v_session_date)
    where id = v_session_id;
  end if;

  if v_block_id is null then
    insert into public.session_blocks (
      id,
      session_id,
      label,
      starts_at,
      ends_at,
      price,
      capacity,
      parent_bookable,
      sort_order,
      metadata
    )
    values (
      public.apres_stable_uuid('block:override:' || v_school || ':' || v_programme_name || ':' || v_session_date::text || ':' || v_session_label),
      v_session_id,
      v_session_label,
      (v_session_date + v_start_time) at time zone 'Europe/London',
      (v_session_date + v_end_time) at time zone 'Europe/London',
      v_price,
      v_capacity,
      v_parent_bookable,
      1,
      jsonb_build_object('source', 'staff_admin_override', 'override', p_override, 'sessionDate', v_session_date)
    )
    on conflict (session_id, label, starts_at, ends_at) do update
    set price = excluded.price,
        capacity = excluded.capacity,
        parent_bookable = excluded.parent_bookable,
        sort_order = excluded.sort_order,
        metadata = excluded.metadata
    returning id into v_block_id;
  else
    update public.session_blocks
    set starts_at = (v_session_date + v_start_time) at time zone 'Europe/London',
        ends_at = (v_session_date + v_end_time) at time zone 'Europe/London',
        price = v_price,
        capacity = v_capacity,
        parent_bookable = v_parent_bookable,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'staff_admin_override', 'override', p_override, 'sessionDate', v_session_date)
    where id = v_block_id;
  end if;

  insert into public.audit_log (actor_id, action, table_name, metadata)
  values (
    auth.uid(),
    'booking_session_override_saved',
    'session_blocks',
    jsonb_build_object(
      'school', v_school,
      'programme', v_programme_name,
      'sessionLabel', v_session_label,
      'sessionDate', v_session_date,
      'status', v_status,
      'parentBookable', v_parent_bookable
    )
  );

  return jsonb_build_object(
    'ok', true,
    'school', v_school,
    'programme', v_programme_name,
    'sessionLabel', v_session_label,
    'sessionDate', v_session_date,
    'status', v_status,
    'parentBookable', v_parent_bookable,
    'capacity', v_capacity,
    'price', v_price
  );
end;
$$;

grant execute on function public.admin_upsert_booking_session_override(jsonb) to authenticated;
