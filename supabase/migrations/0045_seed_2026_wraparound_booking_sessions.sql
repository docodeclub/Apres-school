-- Renumbered from 0031 to avoid colliding with the applied backfill_dbs_clear_dates migration.
create or replace function public.apres_stable_uuid(p_value text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-4' ||
    substr(md5(p_value), 14, 3) || '-a' ||
    substr(md5(p_value), 18, 3) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

create temp table if not exists tmp_2026_wraparound_programmes (
  lab_session_id text primary key,
  site_name text not null,
  area text not null,
  programme_name text not null,
  category text not null,
  title text not null,
  session_start time not null,
  session_end time not null,
  capacity integer not null,
  price numeric(10,2) not null,
  age_range text not null,
  payment_route text not null,
  windows jsonb not null,
  exclusions jsonb not null,
  blocks jsonb not null
) on commit drop;

truncate table tmp_2026_wraparound_programmes;

insert into tmp_2026_wraparound_programmes (
  lab_session_id,
  site_name,
  area,
  programme_name,
  category,
  title,
  session_start,
  session_end,
  capacity,
  price,
  age_range,
  payment_route,
  windows,
  exclusions,
  blocks
) values
  (
    'lab-ripley-after',
    'Ripley Court',
    'Surrey',
    'After-school Club',
    'wraparound',
    'After-school care',
    '15:30',
    '18:00',
    20,
    25.35,
    'Ripley Court pupils',
    'ponchopay_card_voucher',
    '[{"start":"2026-09-04","end":"2026-12-11"},{"start":"2027-01-06","end":"2027-03-19"},{"start":"2027-04-13","end":"2027-07-07"}]'::jsonb,
    '["2026-09-02","2026-09-03",{"start":"2026-10-19","end":"2026-10-30"},{"start":"2026-12-14","end":"2027-01-05"},"2027-01-05",{"start":"2027-02-15","end":"2027-02-19"},{"start":"2027-03-21","end":"2027-04-12"},"2027-04-12",{"start":"2027-05-31","end":"2027-06-04"}]'::jsonb,
    '[{"label":"Session 1","start":"15:30","end":"16:00","price":5.40},{"label":"Session 2","start":"16:00","end":"16:30","price":5.40},{"label":"Session 3","start":"16:30","end":"17:00","price":5.40},{"label":"Session 4","start":"17:00","end":"18:00","price":9.15}]'::jsonb
  ),
  (
    'lab-willington-after',
    'Willington Prep',
    'Wimbledon',
    'After-school Club',
    'wraparound',
    'After-school care',
    '15:30',
    '18:00',
    50,
    27.80,
    'Willington Prep pupils',
    'ponchopay_card_voucher',
    '[{"start":"2026-09-03","end":"2026-12-11"},{"start":"2027-01-04","end":"2027-03-25"},{"start":"2027-04-12","end":"2027-07-07"}]'::jsonb,
    '["2026-08-28","2026-08-31","2026-09-01","2026-09-02",{"start":"2026-10-19","end":"2026-10-30"},"2026-12-14",{"start":"2027-02-15","end":"2027-02-19"},"2027-05-03","2027-05-31",{"start":"2027-06-01","end":"2027-06-04"},"2027-07-08"]'::jsonb,
    '[{"label":"Session 1","start":"15:30","end":"16:00","price":6.80},{"label":"Session 2","start":"16:00","end":"17:00","price":11.30},{"label":"Session 3","start":"17:00","end":"18:00","price":9.70}]'::jsonb
  ),
  (
    'lab-kings-after',
    'King''s House School',
    'Richmond',
    'After-school Club',
    'wraparound',
    'After-school care',
    '15:15',
    '18:00',
    20,
    27.00,
    'King''s House pupils',
    'ponchopay_card_voucher',
    '[{"start":"2026-09-03","end":"2026-12-10"},{"start":"2027-01-06","end":"2027-03-23"},{"start":"2027-04-14","end":"2027-07-06"}]'::jsonb,
    '["2026-08-28","2026-08-31","2026-09-01","2026-09-02",{"start":"2026-10-19","end":"2026-10-30"},"2026-12-11","2027-01-05","2027-02-12",{"start":"2027-02-15","end":"2027-02-19"},"2027-03-24","2027-04-12","2027-04-13","2027-05-03",{"start":"2027-05-31","end":"2027-06-04"},"2027-07-07"]'::jsonb,
    '[{"label":"Session 1","start":"15:15","end":"16:00","price":7.00},{"label":"Session 2","start":"16:00","end":"17:00","price":11.00},{"label":"Session 3","start":"17:00","end":"18:00","price":9.00}]'::jsonb
  ),
  (
    'lab-shrewsbury-breakfast',
    'Shrewsbury House School',
    'Surbiton',
    'Breakfast Club',
    'wraparound',
    'Breakfast club',
    '07:30',
    '08:00',
    20,
    7.40,
    'Shrewsbury House pupils',
    'ponchopay_card_voucher',
    '[{"start":"2026-09-03","end":"2026-12-09"},{"start":"2027-01-06","end":"2027-03-24"},{"start":"2027-04-20","end":"2027-07-09"}]'::jsonb,
    '[{"start":"2026-10-19","end":"2026-10-30"},{"start":"2027-02-15","end":"2027-02-19"},{"start":"2027-05-31","end":"2027-06-04"}]'::jsonb,
    '[{"label":"Breakfast Club","start":"07:30","end":"08:00","price":7.40}]'::jsonb
  ),
  (
    'lab-shrewsbury-after',
    'Shrewsbury House School',
    'Surbiton',
    'After-school Club',
    'wraparound',
    'After-school care',
    '15:15',
    '18:00',
    20,
    27.45,
    'Shrewsbury House pupils',
    'ponchopay_card_voucher',
    '[{"start":"2026-09-03","end":"2026-12-09"},{"start":"2027-01-06","end":"2027-03-24"},{"start":"2027-04-20","end":"2027-07-09"}]'::jsonb,
    '[{"start":"2026-10-19","end":"2026-10-30"},{"start":"2027-02-15","end":"2027-02-19"},{"start":"2027-05-31","end":"2027-06-04"}]'::jsonb,
    '[{"label":"Session 1","start":"15:15","end":"16:00","price":9.15},{"label":"Session 2","start":"16:00","end":"17:10","price":9.15},{"label":"Session 3","start":"17:10","end":"18:00","price":9.15}]'::jsonb
  );

with source_locations as (
  select distinct
    public.apres_stable_uuid('location:' || site_name) as id,
    site_name,
    area
  from tmp_2026_wraparound_programmes
)
insert into locations (id, name, area, booking_platform, booking_url, public_notes, operational_notes, active)
select
  id,
  site_name,
  area,
  'Après booking system',
  '/launch-booking',
  '2026/27 wraparound booking imported for parent checkout.',
  'Generated from approved 2026/27 term windows and exclusions.',
  true
from source_locations
on conflict (name) do update
set area = excluded.area,
    booking_platform = excluded.booking_platform,
    booking_url = excluded.booking_url,
    public_notes = excluded.public_notes,
    operational_notes = excluded.operational_notes,
    active = excluded.active;

insert into programmes (id, location_id, name, category, age_range, booking_notes, active)
select
  public.apres_stable_uuid('programme:' || lab_session_id),
  locations.id,
  programme_name,
  category,
  age_range,
  'Parent-bookable 2026/27 wraparound provision. Generated from launch booking data.',
  true
from tmp_2026_wraparound_programmes
join locations on locations.name = tmp_2026_wraparound_programmes.site_name
on conflict (location_id, name, category) do update
set age_range = excluded.age_range,
    booking_notes = excluded.booking_notes,
    active = excluded.active;

with programme_days as (
  select
    programme.*,
    day::date as session_date
  from tmp_2026_wraparound_programmes programme
  cross join lateral (
    select generated_day::date as day
    from jsonb_to_recordset(programme.windows) as term_window(start date, "end" date)
    cross join lateral generate_series(term_window.start, term_window."end", interval '1 day') generated_day
    where extract(isodow from generated_day) between 1 and 5
  ) generated
  where not exists (
    select 1
    from jsonb_array_elements(programme.exclusions) exclusion(value)
    where (
      jsonb_typeof(exclusion.value) = 'string'
      and trim(both '"' from exclusion.value::text)::date = generated.day
    )
    or (
      jsonb_typeof(exclusion.value) = 'object'
      and generated.day between (exclusion.value->>'start')::date and (exclusion.value->>'end')::date
    )
  )
),
seed_sessions as (
  select
    public.apres_stable_uuid('session:' || lab_session_id || ':' || session_date::text) as id,
    programmes.id as programme_id,
    lab_session_id,
    session_date,
    title,
    capacity,
    price,
    payment_route,
    (session_date + session_start) at time zone 'Europe/London' as starts_at,
    (session_date + session_end) at time zone 'Europe/London' as ends_at
  from programme_days
  join locations on locations.name = programme_days.site_name
  join programmes
    on programmes.location_id = locations.id
   and programmes.name = programme_days.programme_name
   and programmes.category = programme_days.category
)
insert into sessions (
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
select
  id,
  programme_id,
  starts_at,
  ends_at,
  capacity,
  'open',
  'Generated 2026/27 parent-bookable wraparound session.',
  title,
  true,
  price,
  payment_route,
  24,
  24,
  0,
  jsonb_build_object('schoolOnly', true),
  jsonb_build_object('source', 'launch_booking_import', 'labSessionId', lab_session_id, 'sessionDate', session_date)
from seed_sessions
on conflict (id) do update
set programme_id = excluded.programme_id,
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
    booking_metadata = excluded.booking_metadata;

with programme_days as (
  select
    programme.*,
    day::date as session_date
  from tmp_2026_wraparound_programmes programme
  cross join lateral (
    select generated_day::date as day
    from jsonb_to_recordset(programme.windows) as term_window(start date, "end" date)
    cross join lateral generate_series(term_window.start, term_window."end", interval '1 day') generated_day
    where extract(isodow from generated_day) between 1 and 5
  ) generated
  where not exists (
    select 1
    from jsonb_array_elements(programme.exclusions) exclusion(value)
    where (
      jsonb_typeof(exclusion.value) = 'string'
      and trim(both '"' from exclusion.value::text)::date = generated.day
    )
    or (
      jsonb_typeof(exclusion.value) = 'object'
      and generated.day between (exclusion.value->>'start')::date and (exclusion.value->>'end')::date
    )
  )
),
seed_blocks as (
  select
    public.apres_stable_uuid('block:' || programme_days.lab_session_id || ':' || programme_days.session_date::text || ':' || (block.value->>'label')) as id,
    public.apres_stable_uuid('session:' || programme_days.lab_session_id || ':' || programme_days.session_date::text) as session_id,
    programme_days.lab_session_id,
    programme_days.session_date,
    block.value->>'label' as label,
    (programme_days.session_date + (block.value->>'start')::time) at time zone 'Europe/London' as starts_at,
    (programme_days.session_date + (block.value->>'end')::time) at time zone 'Europe/London' as ends_at,
    (block.value->>'price')::numeric as price,
    programme_days.capacity,
    block.ordinality as sort_order
  from programme_days
  cross join lateral jsonb_array_elements(programme_days.blocks) with ordinality as block(value, ordinality)
)
insert into session_blocks (
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
select
  id,
  session_id,
  label,
  starts_at,
  ends_at,
  price,
  capacity,
  true,
  coalesce(sort_order::integer, 0),
  jsonb_build_object('source', 'launch_booking_import', 'labSessionId', lab_session_id, 'sessionDate', session_date)
from seed_blocks
on conflict (id) do update
set session_id = excluded.session_id,
    label = excluded.label,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    price = excluded.price,
    capacity = excluded.capacity,
    parent_bookable = excluded.parent_bookable,
    sort_order = excluded.sort_order,
    metadata = excluded.metadata;

grant execute on function public.apres_stable_uuid(text) to authenticated, service_role;
