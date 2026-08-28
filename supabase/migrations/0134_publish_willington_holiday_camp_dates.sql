do $$
declare
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_week record;
  v_day date;
begin
  insert into public.locations (
    id, name, area, booking_platform, booking_url,
    public_notes, operational_notes, active
  ) values (
    public.apres_stable_uuid('location:Willington Prep'),
    'Willington Prep',
    'Wimbledon',
    'Après booking system',
    '/launch-booking',
    'Holiday camp venue managed by Après School.',
    'Managed from the Holiday Camps planner.',
    true
  )
  on conflict (name) do update set
    area = excluded.area,
    booking_platform = excluded.booking_platform,
    booking_url = excluded.booking_url,
    active = true
  returning id into v_location_id;

  for v_week in
    select *
    from (values
      ('October Half-Term – Week 1', '2026-10-19'::date, '2026-10-23'::date, 5, 225::numeric),
      ('October Half-Term – Week 2', '2026-10-26'::date, '2026-10-30'::date, 5, 225::numeric),
      ('Christmas – Week 1',         '2026-12-14'::date, '2026-12-18'::date, 5, 225::numeric),
      ('February Half-Term – Week 1','2027-02-15'::date, '2027-02-19'::date, 5, 225::numeric),
      ('Easter – Week 1',            '2027-03-30'::date, '2027-04-02'::date, 4, 180::numeric),
      ('Easter – Week 2',            '2027-04-05'::date, '2027-04-09'::date, 5, 225::numeric),
      ('May Half-Term – Week 1',     '2027-06-01'::date, '2027-06-04'::date, 4, 180::numeric),
      ('Summer – Week 1',            '2027-07-12'::date, '2027-07-16'::date, 5, 225::numeric),
      ('Summer – Week 2',            '2027-07-19'::date, '2027-07-23'::date, 5, 225::numeric),
      ('Summer – Week 3',            '2027-07-26'::date, '2027-07-30'::date, 5, 225::numeric),
      ('Summer – Week 4',            '2027-08-02'::date, '2027-08-06'::date, 5, 225::numeric),
      ('Summer – Week 5',            '2027-08-09'::date, '2027-08-13'::date, 5, 225::numeric),
      ('Summer – Week 6',            '2027-08-16'::date, '2027-08-20'::date, 5, 225::numeric),
      ('Summer – Week 7',            '2027-08-23'::date, '2027-08-27'::date, 5, 225::numeric)
    ) as weeks(camp_name, date_from, date_to, operating_days, full_week_price)
  loop
    insert into public.programmes (
      id, location_id, name, category, age_range, booking_notes, active
    ) values (
      public.apres_stable_uuid('programme:holiday-camp:Willington Prep:' || v_week.camp_name),
      v_location_id,
      v_week.camp_name,
      'holiday_camp',
      'Primary-age children',
      'Open to children from all schools. Book individual days or the full operating week.',
      true
    )
    on conflict (location_id, name, category) do update set
      age_range = excluded.age_range,
      booking_notes = excluded.booking_notes,
      active = true
    returning id into v_programme_id;

    for v_day in
      select generated_day::date
      from generate_series(v_week.date_from, v_week.date_to, interval '1 day') generated_day
    loop
      insert into public.sessions (
        id, programme_id, starts_at, ends_at, capacity, status, notes,
        booking_label, parent_bookable, price, payment_route,
        cancellation_hours, amendment_hours, booking_cutoff_hours,
        eligibility, booking_metadata
      ) values (
        public.apres_stable_uuid('session:holiday-camp:Willington Prep:' || v_week.camp_name || ':' || v_day::text),
        v_programme_id,
        (v_day + '08:00'::time) at time zone 'Europe/London',
        (v_day + '17:00'::time) at time zone 'Europe/London',
        40,
        'open',
        'Willington Holiday Camp 2026/27.',
        v_week.camp_name,
        true,
        50,
        'ponchopay_card_voucher',
        24,
        24,
        0,
        jsonb_build_object(
          'schoolOnly', false,
          'label', 'Open to children from all schools'
        ),
        jsonb_build_object(
          'source', 'holiday_camp_planner',
          'campName', v_week.camp_name,
          'published', true,
          'sessionDate', v_day,
          'area', 'Wimbledon',
          'notes', 'Willington Holiday Camp 2026/27.',
          'operatingDays', v_week.operating_days,
          'fullWeek4Price', 180,
          'fullWeek5Price', 225,
          'fullWeekPrice', v_week.full_week_price,
          'earlyDropOffEnabled', true
        )
      )
      on conflict (id) do update set
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        capacity = excluded.capacity,
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

      delete from public.session_blocks
      where session_id = v_session_id
        and coalesce(metadata->>'source', '') = 'holiday_camp_planner';

      insert into public.session_blocks (
        id, session_id, label, starts_at, ends_at, price, capacity,
        parent_bookable, sort_order, metadata
      ) values
      (
        public.apres_stable_uuid('block:holiday-camp-early:Willington Prep:' || v_week.camp_name || ':' || v_day::text),
        v_session_id,
        'Early Drop-Off',
        (v_day + '08:00'::time) at time zone 'Europe/London',
        (v_day + '09:00'::time) at time zone 'Europe/London',
        5,
        40,
        true,
        1,
        jsonb_build_object('source', 'holiday_camp_planner', 'sessionDate', v_day, 'kind', 'early_drop_off')
      ),
      (
        public.apres_stable_uuid('block:holiday-camp:Willington Prep:' || v_week.camp_name || ':' || v_day::text),
        v_session_id,
        'Holiday Camp',
        (v_day + '09:00'::time) at time zone 'Europe/London',
        (v_day + '17:00'::time) at time zone 'Europe/London',
        50,
        40,
        true,
        2,
        jsonb_build_object('source', 'holiday_camp_planner', 'sessionDate', v_day, 'kind', 'holiday_camp_day')
      );
    end loop;
  end loop;
end;
$$;
