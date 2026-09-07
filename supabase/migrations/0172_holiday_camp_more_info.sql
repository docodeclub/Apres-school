create or replace function public.admin_set_holiday_camp_presentation(p_camp jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_site text := nullif(trim(p_camp->>'site'), '');
  v_camp_name text := coalesce(nullif(trim(p_camp->>'campName'), ''), 'Holiday Camp');
  v_date_from date := nullif(trim(p_camp->>'dateFrom'), '')::date;
  v_date_to date := nullif(trim(p_camp->>'dateTo'), '')::date;
  v_image_url text := coalesce(nullif(trim(p_camp->>'imageUrl'), ''), '/assets/apres-highlights/camp-move-football.jpg');
  v_camp_type text := coalesce(nullif(trim(p_camp->>'campType'), ''), 'Multi-Activity');
  v_camp_info jsonb := jsonb_strip_nulls(jsonb_build_object(
    'description', nullif(trim(p_camp->>'infoDescription'), ''),
    'typicalDay', nullif(trim(p_camp->>'infoTypicalDay'), ''),
    'whatToBring', nullif(trim(p_camp->>'infoWhatToBring'), ''),
    'food', nullif(trim(p_camp->>'infoFood'), ''),
    'specialActivities', nullif(trim(p_camp->>'infoSpecialActivities'), ''),
    'additionalInformation', nullif(trim(p_camp->>'infoAdditional'), '')
  ));
  v_count integer := 0;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true limit 1;
  if v_role not in ('admin', 'superadmin') then
    raise exception 'Only admins can manage holiday camp presentation.';
  end if;
  if v_site is null or v_date_from is null or v_date_to is null then
    raise exception 'Venue and date range are required.';
  end if;

  update public.sessions s
  set booking_metadata = coalesce(s.booking_metadata, '{}'::jsonb) || jsonb_build_object(
    'imageUrl', v_image_url,
    'campType', v_camp_type,
    'campInfo', v_camp_info
  )
  from public.programmes p
  join public.locations l on l.id = p.location_id
  where s.programme_id = p.id
    and p.category = 'holiday_camp'
    and l.name = v_site
    and p.name = v_camp_name
    and (s.starts_at at time zone 'Europe/London')::date between v_date_from and v_date_to;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'sessionsUpdated', v_count, 'imageUrl', v_image_url, 'campType', v_camp_type, 'campInfo', v_camp_info);
end;
$$;

revoke all on function public.admin_set_holiday_camp_presentation(jsonb) from public;
grant execute on function public.admin_set_holiday_camp_presentation(jsonb) to authenticated;

drop function if exists public.public_holiday_camp_schedule();
create function public.public_holiday_camp_schedule()
returns table(
  session_id uuid,
  session_block_id uuid,
  programme_id uuid,
  site_name text,
  area text,
  camp_name text,
  age_range text,
  session_date date,
  block_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  price numeric,
  capacity integer,
  eligibility jsonb,
  pricing jsonb,
  presentation jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    b.id,
    p.id,
    l.name,
    l.area,
    coalesce(s.booking_label, p.name),
    p.age_range,
    (s.starts_at at time zone 'Europe/London')::date,
    b.label,
    b.starts_at,
    b.ends_at,
    b.price,
    coalesce(b.capacity, s.capacity),
    s.eligibility,
    jsonb_build_object(
      'dayPrice', s.price,
      'fullWeek4Price', s.booking_metadata->'fullWeek4Price',
      'fullWeek5Price', s.booking_metadata->'fullWeek5Price',
      'earlyDropOffEnabled', coalesce((s.booking_metadata->>'earlyDropOffEnabled')::boolean, false)
    ),
    jsonb_build_object(
      'imageUrl', coalesce(nullif(s.booking_metadata->>'imageUrl', ''), '/assets/apres-highlights/camp-move-football.jpg'),
      'campType', coalesce(nullif(s.booking_metadata->>'campType', ''), 'Multi-Activity'),
      'notes', coalesce(s.booking_metadata->>'notes', ''),
      'campInfo', coalesce(s.booking_metadata->'campInfo', '{}'::jsonb)
    )
  from public.sessions s
  join public.programmes p on p.id = s.programme_id
  join public.locations l on l.id = p.location_id
  join public.session_blocks b on b.session_id = s.id
  where p.category = 'holiday_camp'
    and p.active
    and l.active
    and s.status = 'open'
    and s.parent_bookable
    and b.parent_bookable
    and s.starts_at >= now()
  order by s.starts_at, b.sort_order, l.name;
$$;

grant execute on function public.public_holiday_camp_schedule() to anon, authenticated;
