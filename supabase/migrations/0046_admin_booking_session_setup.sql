create or replace function public.admin_upsert_booking_session_setup(p_setup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_school text := nullif(trim(p_setup->>'school'), '');
  v_date_from date := nullif(trim(p_setup->>'dateFrom'), '')::date;
  v_date_to date := nullif(trim(p_setup->>'dateTo'), '')::date;
  v_session_label text := coalesce(nullif(trim(p_setup->>'sessionLabel'), ''), 'Session 1');
  v_time_window text := coalesce(nullif(trim(p_setup->>'timeWindow'), ''), '15:30-16:00');
  v_start_time time;
  v_end_time time;
  v_price numeric(10,2) := coalesce(nullif(trim(p_setup->>'price'), '')::numeric, 0);
  v_capacity integer := coalesce(nullif(trim(p_setup->>'capacity'), '')::integer, 0);
  v_cancellation_hours integer := coalesce(nullif(trim(p_setup->>'cancellationHours'), '')::integer, 24);
  v_payment_route text := coalesce(nullif(trim(p_setup->>'paymentRoute'), ''), 'ponchopay_card_voucher');
  v_eligibility_text text := nullif(trim(p_setup->>'eligibility'), '');
  v_programme_name text;
  v_booking_label text;
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_block_id uuid;
  v_day date;
  v_count integer := 0;
begin
  select role
    into v_role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Only admins can update booking setup.';
  end if;

  if v_school is null then
    raise exception 'School is required.';
  end if;

  if v_date_from is null or v_date_to is null or v_date_to < v_date_from then
    raise exception 'Choose a valid setup date range.';
  end if;

  if v_date_to - v_date_from > 370 then
    raise exception 'Setup range cannot be longer than one year.';
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
    coalesce(nullif(trim(p_setup->>'area'), ''), 'School'),
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

  for v_day in
    select generated_day::date
    from generate_series(v_date_from, v_date_to, interval '1 day') generated_day
    where extract(isodow from generated_day) between 1 and 5
  loop
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
      public.apres_stable_uuid('session:admin:' || v_school || ':' || v_programme_name || ':' || v_day::text || ':' || v_start_time::text || ':' || v_end_time::text),
      v_programme_id,
      (v_day + v_start_time) at time zone 'Europe/London',
      (v_day + v_end_time) at time zone 'Europe/London',
      v_capacity,
      'open',
      'Created from staff admin booking setup.',
      v_booking_label,
      true,
      v_price,
      v_payment_route,
      v_cancellation_hours,
      v_cancellation_hours,
      0,
      jsonb_build_object('schoolOnly', true, 'label', coalesce(v_eligibility_text, 'School pupils')),
      jsonb_build_object('source', 'staff_admin_setup', 'setup', p_setup, 'sessionDate', v_day)
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
      public.apres_stable_uuid('block:admin:' || v_school || ':' || v_programme_name || ':' || v_day::text || ':' || v_session_label || ':' || v_start_time::text || ':' || v_end_time::text),
      v_session_id,
      v_session_label,
      (v_day + v_start_time) at time zone 'Europe/London',
      (v_day + v_end_time) at time zone 'Europe/London',
      v_price,
      v_capacity,
      true,
      1,
      jsonb_build_object('source', 'staff_admin_setup', 'setup', p_setup, 'sessionDate', v_day)
    )
    on conflict (session_id, label, starts_at, ends_at) do update
    set price = excluded.price,
        capacity = excluded.capacity,
        parent_bookable = excluded.parent_bookable,
        sort_order = excluded.sort_order,
        metadata = excluded.metadata
    returning id into v_block_id;

    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor_id, action, table_name, metadata)
  values (
    auth.uid(),
    'booking_session_setup_saved',
    'sessions',
    jsonb_build_object(
      'school', v_school,
      'programme', v_programme_name,
      'sessionLabel', v_session_label,
      'dateFrom', v_date_from,
      'dateTo', v_date_to,
      'sessionsUpserted', v_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'school', v_school,
    'programme', v_programme_name,
    'sessionLabel', v_session_label,
    'sessionsUpserted', v_count,
    'paymentRoute', v_payment_route,
    'cancellationHours', v_cancellation_hours
  );
end;
$$;

grant execute on function public.admin_upsert_booking_session_setup(jsonb) to authenticated;
