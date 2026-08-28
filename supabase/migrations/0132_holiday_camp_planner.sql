create or replace function public.admin_upsert_holiday_camp(p_camp jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_site text := nullif(trim(p_camp->>'site'), '');
  v_area text := coalesce(nullif(trim(p_camp->>'area'), ''), 'London and Surrey');
  v_camp_name text := coalesce(nullif(trim(p_camp->>'campName'), ''), 'Holiday Camp');
  v_age_range text := coalesce(nullif(trim(p_camp->>'ageRange'), ''), 'Primary-age children');
  v_eligibility text := coalesce(nullif(trim(p_camp->>'eligibility'), ''), 'Open to children from all schools');
  v_school_only boolean := coalesce((p_camp->>'schoolOnly')::boolean, false);
  v_date_from date := nullif(trim(p_camp->>'dateFrom'), '')::date;
  v_date_to date := nullif(trim(p_camp->>'dateTo'), '')::date;
  v_start_time time := coalesce(nullif(trim(p_camp->>'startTime'), '')::time, '08:30'::time);
  v_end_time time := coalesce(nullif(trim(p_camp->>'endTime'), '')::time, '17:30'::time);
  v_price numeric(10,2) := coalesce(nullif(trim(p_camp->>'price'), '')::numeric, 0);
  v_capacity integer := coalesce(nullif(trim(p_camp->>'capacity'), '')::integer, 0);
  v_cancellation_hours integer := coalesce(nullif(trim(p_camp->>'cancellationHours'), '')::integer, 24);
  v_published boolean := coalesce((p_camp->>'published')::boolean, false);
  v_notes text := nullif(trim(p_camp->>'notes'), '');
  v_weekdays jsonb := coalesce(p_camp->'weekdays', '[1,2,3,4,5]'::jsonb);
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_day date;
  v_count integer := 0;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true
  limit 1;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Only admins can manage holiday camps.';
  end if;
  if v_site is null then raise exception 'Venue is required.'; end if;
  if v_date_from is null or v_date_to is null or v_date_to < v_date_from then
    raise exception 'Choose a valid camp date range.';
  end if;
  if v_date_to - v_date_from > 93 then raise exception 'A camp date range cannot exceed 93 days.'; end if;
  if v_end_time <= v_start_time then raise exception 'Camp end time must be after the start time.'; end if;
  if v_price < 0 then raise exception 'Price cannot be negative.'; end if;
  if v_capacity < 1 then raise exception 'Capacity must be at least 1.'; end if;
  if jsonb_typeof(v_weekdays) <> 'array' or jsonb_array_length(v_weekdays) = 0 then
    raise exception 'Choose at least one day of the week.';
  end if;

  insert into public.locations (id, name, area, booking_platform, booking_url, public_notes, operational_notes, active)
  values (
    public.apres_stable_uuid('location:' || v_site), v_site, v_area,
    'Après booking system', '/launch-booking',
    'Holiday camp venue managed by Après School.', 'Managed from the Holiday Camps planner.', true
  )
  on conflict (name) do update
  set area = excluded.area, booking_platform = excluded.booking_platform,
      booking_url = excluded.booking_url, active = true
  returning id into v_location_id;

  insert into public.programmes (id, location_id, name, category, age_range, booking_notes, active)
  values (
    public.apres_stable_uuid('programme:holiday-camp:' || v_site || ':' || v_camp_name),
    v_location_id, v_camp_name, 'holiday_camp', v_age_range,
    'Managed from the Holiday Camps planner.', true
  )
  on conflict (location_id, name, category) do update
  set age_range = excluded.age_range, booking_notes = excluded.booking_notes, active = true
  returning id into v_programme_id;

  for v_day in
    select generated_day::date
    from generate_series(v_date_from, v_date_to, interval '1 day') generated_day
    where exists (
      select 1 from jsonb_array_elements_text(v_weekdays) weekday
      where weekday::integer = extract(isodow from generated_day)::integer
    )
  loop
    insert into public.sessions (
      id, programme_id, starts_at, ends_at, capacity, status, notes,
      booking_label, parent_bookable, price, payment_route,
      cancellation_hours, amendment_hours, booking_cutoff_hours,
      eligibility, booking_metadata
    ) values (
      public.apres_stable_uuid('session:holiday-camp:' || v_site || ':' || v_camp_name || ':' || v_day::text),
      v_programme_id,
      (v_day + v_start_time) at time zone 'Europe/London',
      (v_day + v_end_time) at time zone 'Europe/London',
      v_capacity, case when v_published then 'open' else 'planning' end,
      coalesce(v_notes, 'Holiday camp session managed from the staff planner.'),
      v_camp_name, v_published, v_price, 'ponchopay_card_voucher',
      v_cancellation_hours, v_cancellation_hours, 0,
      jsonb_build_object('schoolOnly', v_school_only, 'label', v_eligibility),
      jsonb_build_object(
        'source', 'holiday_camp_planner', 'campName', v_camp_name,
        'published', v_published, 'sessionDate', v_day,
        'area', v_area, 'notes', coalesce(v_notes, '')
      )
    )
    on conflict (id) do update set
      starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      capacity = excluded.capacity, status = excluded.status, notes = excluded.notes,
      booking_label = excluded.booking_label, parent_bookable = excluded.parent_bookable,
      price = excluded.price, payment_route = excluded.payment_route,
      cancellation_hours = excluded.cancellation_hours,
      amendment_hours = excluded.amendment_hours,
      eligibility = excluded.eligibility, booking_metadata = excluded.booking_metadata
    returning id into v_session_id;

    delete from public.session_blocks
    where session_id = v_session_id
      and coalesce(metadata->>'source', '') = 'holiday_camp_planner';

    insert into public.session_blocks (
      id, session_id, label, starts_at, ends_at, price, capacity,
      parent_bookable, sort_order, metadata
    ) values (
      public.apres_stable_uuid('block:holiday-camp:' || v_site || ':' || v_camp_name || ':' || v_day::text),
      v_session_id, 'Full day',
      (v_day + v_start_time) at time zone 'Europe/London',
      (v_day + v_end_time) at time zone 'Europe/London',
      v_price, v_capacity, v_published, 1,
      jsonb_build_object('source', 'holiday_camp_planner', 'sessionDate', v_day)
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'No dates match the selected days.'; end if;

  insert into public.audit_log (actor_id, action, table_name, metadata)
  values (auth.uid(), 'holiday_camp_saved', 'sessions', jsonb_build_object(
    'site', v_site, 'campName', v_camp_name, 'dateFrom', v_date_from,
    'dateTo', v_date_to, 'sessionsUpserted', v_count, 'published', v_published
  ));

  return jsonb_build_object('ok', true, 'site', v_site, 'campName', v_camp_name,
    'sessionsUpserted', v_count, 'published', v_published);
end;
$$;

create or replace function public.public_holiday_camp_schedule()
returns table (
  session_id uuid, session_block_id uuid, site_name text, area text,
  camp_name text, age_range text, session_date date,
  starts_at timestamptz, ends_at timestamptz, price numeric,
  capacity integer, eligibility jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, b.id, l.name, l.area,
         coalesce(s.booking_label, p.name), p.age_range,
         (s.starts_at at time zone 'Europe/London')::date,
         b.starts_at, b.ends_at, b.price,
         coalesce(b.capacity, s.capacity), s.eligibility
  from public.sessions s
  join public.programmes p on p.id = s.programme_id
  join public.locations l on l.id = p.location_id
  join public.session_blocks b on b.session_id = s.id
  where p.category = 'holiday_camp'
    and p.active = true and l.active = true
    and s.status = 'open' and s.parent_bookable = true
    and b.parent_bookable = true
    and s.starts_at >= now()
  order by s.starts_at, b.sort_order, l.name;
$$;

revoke all on function public.admin_upsert_holiday_camp(jsonb) from public;
grant execute on function public.admin_upsert_holiday_camp(jsonb) to authenticated;
grant execute on function public.public_holiday_camp_schedule() to anon, authenticated;

