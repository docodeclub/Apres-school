-- Complete the 2026/27 nine-block camp pattern at King's House and
-- Shrewsbury House. The existing Rowans and Willington schedules are not
-- changed by this migration.

do $$
declare
  v_site record;
  v_week record;
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_day date;
begin
  for v_site in
    select *
    from (values
      ('King''s House School'::text, 'Richmond'::text),
      ('Shrewsbury House School'::text, 'Surbiton'::text)
    ) as sites(site_name, area)
  loop
    insert into public.locations (
      id, name, area, booking_platform, booking_url,
      public_notes, operational_notes, active
    ) values (
      public.apres_stable_uuid('location:' || v_site.site_name),
      v_site.site_name,
      v_site.area,
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
        ('Summer – Week 1'::text, '2027-07-12'::date, '2027-07-16'::date),
        ('Summer – Week 2'::text, '2027-07-19'::date, '2027-07-23'::date),
        ('Summer – Week 3'::text, '2027-07-26'::date, '2027-07-30'::date),
        ('Summer – Week 4'::text, '2027-08-02'::date, '2027-08-06'::date)
      ) as weeks(camp_name, date_from, date_to)
    loop
      insert into public.programmes (
        id, location_id, name, category, age_range, booking_notes, active
      ) values (
        public.apres_stable_uuid('programme:holiday-camp:' || v_site.site_name || ':' || v_week.camp_name),
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
          public.apres_stable_uuid('session:holiday-camp:' || v_site.site_name || ':' || v_week.camp_name || ':' || v_day::text),
          v_programme_id,
          (v_day + '08:00'::time) at time zone 'Europe/London',
          (v_day + '15:00'::time) at time zone 'Europe/London',
          16,
          'open',
          v_site.site_name || ' Holiday Camp 2026/27.',
          v_week.camp_name,
          true,
          40,
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
            'area', v_site.area,
            'notes', v_site.site_name || ' Holiday Camp 2026/27.',
            'operatingDays', 5,
            'fullWeek4Price', 144,
            'fullWeek5Price', 180,
            'fullWeekPrice', 180,
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
          public.apres_stable_uuid('block:holiday-camp-early:' || v_site.site_name || ':' || v_week.camp_name || ':' || v_day::text),
          v_session_id,
          'Early Drop-Off',
          (v_day + '08:00'::time) at time zone 'Europe/London',
          (v_day + '09:00'::time) at time zone 'Europe/London',
          5,
          16,
          true,
          1,
          jsonb_build_object('source', 'holiday_camp_planner', 'sessionDate', v_day, 'kind', 'early_drop_off')
        ),
        (
          public.apres_stable_uuid('block:holiday-camp:' || v_site.site_name || ':' || v_week.camp_name || ':' || v_day::text),
          v_session_id,
          'Holiday Camp',
          (v_day + '09:00'::time) at time zone 'Europe/London',
          (v_day + '15:00'::time) at time zone 'Europe/London',
          40,
          16,
          true,
          2,
          jsonb_build_object('source', 'holiday_camp_planner', 'sessionDate', v_day, 'kind', 'holiday_camp_day')
        );
      end loop;
    end loop;
  end loop;
end;
$$;

-- Fail the deployment if the final active configuration differs from the
-- requested 2026/27 operating pattern or if a venue/date was duplicated.
do $$
declare
  v_site record;
  v_block_count integer;
  v_summer_count integer;
begin
  for v_site in
    select *
    from (values
      ('King''s House School'::text, 9),
      ('Willington Prep'::text, 14),
      ('The Rowans School'::text, 9),
      ('Shrewsbury House School'::text, 9)
    ) as sites(site_name, expected_blocks)
  loop
    select count(distinct sessions.booking_label)
      into v_block_count
      from public.sessions
      join public.programmes on programmes.id = sessions.programme_id
      join public.locations on locations.id = programmes.location_id
     where locations.name = v_site.site_name
       and programmes.category = 'holiday_camp'
       and programmes.active
       and sessions.status = 'open'
       and sessions.parent_bookable
       and sessions.starts_at >= '2026-09-01'::timestamptz
       and sessions.starts_at < '2027-09-01'::timestamptz;

    if v_block_count <> v_site.expected_blocks then
      raise exception '% has % active camp blocks; expected %', v_site.site_name, v_block_count, v_site.expected_blocks;
    end if;
  end loop;

  for v_site in
    select unnest(array['King''s House School', 'The Rowans School', 'Shrewsbury House School']) as site_name
  loop
    select count(distinct sessions.booking_label)
      into v_summer_count
      from public.sessions
      join public.programmes on programmes.id = sessions.programme_id
      join public.locations on locations.id = programmes.location_id
     where locations.name = v_site.site_name
       and programmes.category = 'holiday_camp'
       and programmes.active
       and sessions.status = 'open'
       and sessions.parent_bookable
       and sessions.booking_label like 'Summer – Week %'
       and sessions.starts_at >= '2027-07-01'::timestamptz
       and sessions.starts_at < '2027-09-01'::timestamptz;

    if v_summer_count <> 4 then
      raise exception '% has % active Summer camp blocks; expected 4', v_site.site_name, v_summer_count;
    end if;
  end loop;

  if exists (
    select 1
      from public.sessions
      join public.programmes on programmes.id = sessions.programme_id
      join public.locations on locations.id = programmes.location_id
     where programmes.category = 'holiday_camp'
       and programmes.active
       and sessions.status = 'open'
       and sessions.parent_bookable
       and sessions.starts_at >= '2026-09-01'::timestamptz
       and sessions.starts_at < '2027-09-01'::timestamptz
       and locations.name in ('King''s House School', 'Willington Prep', 'The Rowans School', 'Shrewsbury House School')
     group by locations.id, (sessions.starts_at at time zone 'Europe/London')::date
    having count(*) > 1
  ) then
    raise exception 'Duplicate active holiday-camp dates detected';
  end if;
end;
$$;
