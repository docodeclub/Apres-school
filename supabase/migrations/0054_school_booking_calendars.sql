create table if not exists school_calendar_periods (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  academic_year text not null,
  period_kind text not null check (period_kind in (
    'teaching',
    'half_term_holiday',
    'seasonal_holiday',
    'bank_holiday',
    'inset_day',
    'induction_day',
    'operational_closure'
  )),
  term_name text check (term_name is null or term_name in ('autumn', 'spring', 'summer')),
  half_term_number smallint check (half_term_number is null or half_term_number in (1, 2)),
  label text not null,
  starts_on date not null,
  ends_on date,
  pupils_in_school boolean not null default false,
  after_school_eligible boolean not null default false,
  camp_candidate boolean not null default false,
  pupil_scope text not null default 'all',
  source_url text not null,
  source_checked_on date not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, academic_year, period_kind, label, starts_on),
  check (ends_on is null or ends_on >= starts_on),
  check (not after_school_eligible or (period_kind = 'teaching' and pupils_in_school)),
  check (not camp_candidate or (period_kind in ('half_term_holiday', 'seasonal_holiday') and ends_on is not null)),
  check ((period_kind = 'teaching') = (term_name is not null and half_term_number is not null))
);

create index if not exists school_calendar_periods_location_dates_idx
  on school_calendar_periods (location_id, starts_on, ends_on);
create index if not exists school_calendar_periods_booking_idx
  on school_calendar_periods (location_id, academic_year, period_kind, after_school_eligible, camp_candidate);

alter table school_calendar_periods enable row level security;
grant select on school_calendar_periods to authenticated;
grant all privileges on school_calendar_periods to service_role;

drop policy if exists "school_calendar_read_authenticated" on school_calendar_periods;
create policy "school_calendar_read_authenticated"
  on school_calendar_periods for select
  using (auth.uid() is not null);

drop policy if exists "school_calendar_admin_manage" on school_calendar_periods;
create policy "school_calendar_admin_manage"
  on school_calendar_periods for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
    )
  );

create temp table tmp_school_calendar_2026_27 (
  site_name text not null,
  period_kind text not null,
  term_name text,
  half_term_number smallint,
  label text not null,
  starts_on date not null,
  ends_on date,
  pupils_in_school boolean not null,
  after_school_eligible boolean not null,
  camp_candidate boolean not null,
  pupil_scope text not null default 'all',
  notes text
) on commit drop;

insert into tmp_school_calendar_2026_27 values
  ('Ripley Court','seasonal_holiday',null,null,'Summer holiday','2026-07-09','2026-09-03',false,false,true,'all','Includes INSET days on 2–3 September.'),
  ('Ripley Court','inset_day',null,null,'Staff INSET','2026-09-02','2026-09-03',false,false,false,'all',null),
  ('Ripley Court','teaching','autumn',1,'Autumn term – half 1','2026-09-04','2026-10-16',true,true,false,'all',null),
  ('Ripley Court','half_term_holiday','autumn',null,'Autumn half-term','2026-10-19','2026-10-30',false,false,true,'all',null),
  ('Ripley Court','teaching','autumn',2,'Autumn term – half 2','2026-11-02','2026-12-11',true,true,false,'all',null),
  ('Ripley Court','seasonal_holiday',null,null,'Christmas holiday','2026-12-12','2027-01-05',false,false,true,'all','Published winter holiday is 14 December–5 January; this range includes the preceding weekend.'),
  ('Ripley Court','inset_day',null,null,'Staff INSET','2027-01-05','2027-01-05',false,false,false,'all',null),
  ('Ripley Court','teaching','spring',1,'Spring term – half 1','2027-01-06','2027-02-12',true,true,false,'all',null),
  ('Ripley Court','half_term_holiday','spring',null,'Spring half-term','2027-02-15','2027-02-19',false,false,true,'all',null),
  ('Ripley Court','teaching','spring',2,'Spring term – half 2','2027-02-22','2027-03-19',true,true,false,'all',null),
  ('Ripley Court','seasonal_holiday',null,null,'Easter holiday','2027-03-20','2027-04-12',false,false,true,'all','Published spring holiday is 21 March–12 April; this range includes the preceding weekend.'),
  ('Ripley Court','inset_day',null,null,'Staff INSET','2027-04-12','2027-04-12',false,false,false,'all',null),
  ('Ripley Court','teaching','summer',1,'Summer term – half 1','2027-04-13','2027-05-28',true,true,false,'all',null),
  ('Ripley Court','half_term_holiday','summer',null,'Summer half-term','2027-05-31','2027-06-04',false,false,true,'all',null),
  ('Ripley Court','teaching','summer',2,'Summer term – half 2','2027-06-07','2027-07-07',true,true,false,'all',null),
  ('Ripley Court','seasonal_holiday',null,null,'Summer holiday – end not yet published','2027-07-08',null,false,false,false,'all','Not camp-bookable until the next pupil return date is published.'),

  ('Shrewsbury House School','seasonal_holiday',null,null,'Summer holiday','2026-07-04','2026-09-02',false,false,true,'all','New Boys and Year 8 attend on 2 September; whole school returns 3 September.'),
  ('Shrewsbury House School','induction_day',null,null,'New Boys and Year 8 return','2026-09-02','2026-09-02',false,false,false,'new_boys_and_year_8',null),
  ('Shrewsbury House School','teaching','autumn',1,'Autumn term – half 1','2026-09-03','2026-10-16',true,true,false,'all',null),
  ('Shrewsbury House School','half_term_holiday','autumn',null,'Autumn half-term','2026-10-19','2026-10-30',false,false,true,'all',null),
  ('Shrewsbury House School','teaching','autumn',2,'Autumn term – half 2','2026-11-02','2026-12-09',true,true,false,'all','2pm finish on final day.'),
  ('Shrewsbury House School','seasonal_holiday',null,null,'Christmas holiday','2026-12-10','2027-01-05',false,false,true,'all',null),
  ('Shrewsbury House School','teaching','spring',1,'Spring term – half 1','2027-01-06','2027-02-12',true,true,false,'all',null),
  ('Shrewsbury House School','half_term_holiday','spring',null,'Spring half-term','2027-02-15','2027-02-19',false,false,true,'all',null),
  ('Shrewsbury House School','teaching','spring',2,'Spring term – half 2','2027-02-22','2027-03-24',true,true,false,'all','2pm finish on final day.'),
  ('Shrewsbury House School','seasonal_holiday',null,null,'Easter holiday','2027-03-25','2027-04-19',false,false,true,'all',null),
  ('Shrewsbury House School','teaching','summer',1,'Summer term – half 1','2027-04-20','2027-05-28',true,true,false,'all',null),
  ('Shrewsbury House School','half_term_holiday','summer',null,'Summer half-term','2027-05-31','2027-06-04',false,false,true,'all',null),
  ('Shrewsbury House School','teaching','summer',2,'Summer term – half 2','2027-06-07','2027-07-09',true,true,false,'all','Prizegiving on final day.'),
  ('Shrewsbury House School','seasonal_holiday',null,null,'Summer holiday – end not yet published','2027-07-10',null,false,false,false,'all','Not camp-bookable until the next pupil return date is published.'),

  ('King''s House School','seasonal_holiday',null,null,'Summer holiday','2026-07-03','2026-09-02',false,false,true,'all','Includes staff training on 1–2 September.'),
  ('King''s House School','induction_day',null,null,'New staff induction','2026-08-28','2026-08-28',false,false,false,'all',null),
  ('King''s House School','bank_holiday',null,null,'Summer Bank Holiday','2026-08-31','2026-08-31',false,false,false,'all',null),
  ('King''s House School','inset_day',null,null,'Staff training','2026-09-01','2026-09-02',false,false,false,'all',null),
  ('King''s House School','teaching','autumn',1,'Autumn term – half 1','2026-09-03','2026-10-16',true,true,false,'all',null),
  ('King''s House School','half_term_holiday','autumn',null,'Autumn half-term','2026-10-19','2026-10-30',false,false,true,'all',null),
  ('King''s House School','teaching','autumn',2,'Autumn term – half 2','2026-11-02','2026-12-11',true,true,false,'all',null),
  ('King''s House School','operational_closure',null,null,'No wraparound on final day of autumn term','2026-12-11','2026-12-11',false,false,false,'all','Existing approved booking rule retained separately from the published calendar.'),
  ('King''s House School','seasonal_holiday',null,null,'Christmas holiday','2026-12-12','2027-01-05',false,false,true,'all',null),
  ('King''s House School','inset_day',null,null,'Staff training','2027-01-05','2027-01-05',false,false,false,'all',null),
  ('King''s House School','teaching','spring',1,'Spring term – half 1','2027-01-06','2027-02-11',true,true,false,'all',null),
  ('King''s House School','inset_day',null,null,'Staff training','2027-02-12','2027-02-12',false,false,false,'all',null),
  ('King''s House School','half_term_holiday','spring',null,'Spring half-term','2027-02-15','2027-02-19',false,false,true,'all',null),
  ('King''s House School','teaching','spring',2,'Spring term – half 2','2027-02-22','2027-03-24',true,true,false,'all',null),
  ('King''s House School','operational_closure',null,null,'No wraparound on final day of spring term','2027-03-24','2027-03-24',false,false,false,'all','Existing approved booking rule retained separately from the published calendar.'),
  ('King''s House School','seasonal_holiday',null,null,'Easter holiday','2027-03-25','2027-04-13',false,false,true,'all','Includes staff training on 12–13 April.'),
  ('King''s House School','inset_day',null,null,'Staff training','2027-04-12','2027-04-13',false,false,false,'all',null),
  ('King''s House School','teaching','summer',1,'Summer term – half 1','2027-04-14','2027-05-28',true,true,false,'all',null),
  ('King''s House School','bank_holiday',null,null,'Early May Bank Holiday','2027-05-03','2027-05-03',false,false,false,'all',null),
  ('King''s House School','half_term_holiday','summer',null,'Summer half-term','2027-05-31','2027-06-04',false,false,true,'all',null),
  ('King''s House School','teaching','summer',2,'Summer term – half 2','2027-06-07','2027-07-07',true,true,false,'all',null),
  ('King''s House School','operational_closure',null,null,'No wraparound on final day of summer term','2027-07-07','2027-07-07',false,false,false,'all','Existing approved booking rule retained separately from the published calendar.'),
  ('King''s House School','seasonal_holiday',null,null,'Summer holiday – end not yet published','2027-07-08',null,false,false,false,'all','Not camp-bookable until the next pupil return date is published.'),

  ('Willington Prep','seasonal_holiday',null,null,'Summer holiday','2026-07-04','2026-09-02',false,false,true,'all','Includes staff INSET on 1–2 September.'),
  ('Willington Prep','induction_day',null,null,'SLT INSET','2026-08-28','2026-08-28',false,false,false,'all',null),
  ('Willington Prep','bank_holiday',null,null,'Summer Bank Holiday','2026-08-31','2026-08-31',false,false,false,'all',null),
  ('Willington Prep','inset_day',null,null,'Staff INSET','2026-09-01','2026-09-02',false,false,false,'all',null),
  ('Willington Prep','teaching','autumn',1,'Autumn term – half 1','2026-09-03','2026-10-16',true,true,false,'all',null),
  ('Willington Prep','half_term_holiday','autumn',null,'Autumn half-term','2026-10-19','2026-10-30',false,false,true,'all',null),
  ('Willington Prep','teaching','autumn',2,'Autumn term – half 2','2026-11-02','2026-12-11',true,true,false,'all',null),
  ('Willington Prep','seasonal_holiday',null,null,'Christmas holiday','2026-12-12','2027-01-03',false,false,true,'all',null),
  ('Willington Prep','inset_day',null,null,'Staff INSET','2026-12-14','2026-12-14',false,false,false,'all','Falls inside the Christmas holiday.'),
  ('Willington Prep','teaching','spring',1,'Spring term – half 1','2027-01-04','2027-02-12',true,true,false,'all',null),
  ('Willington Prep','half_term_holiday','spring',null,'Spring half-term','2027-02-15','2027-02-19',false,false,true,'all',null),
  ('Willington Prep','teaching','spring',2,'Spring term – half 2','2027-02-22','2027-03-25',true,true,false,'all',null),
  ('Willington Prep','seasonal_holiday',null,null,'Easter holiday','2027-03-26','2027-04-11',false,false,true,'all',null),
  ('Willington Prep','teaching','summer',1,'Summer term – half 1','2027-04-12','2027-05-28',true,true,false,'all',null),
  ('Willington Prep','bank_holiday',null,null,'Early May Bank Holiday','2027-05-03','2027-05-03',false,false,false,'all',null),
  ('Willington Prep','bank_holiday',null,null,'Spring Bank Holiday','2027-05-31','2027-05-31',false,false,false,'all',null),
  ('Willington Prep','half_term_holiday','summer',null,'Summer half-term','2027-06-01','2027-06-04',false,false,true,'all',null),
  ('Willington Prep','teaching','summer',2,'Summer term – half 2','2027-06-07','2027-07-07',true,true,false,'all',null),
  ('Willington Prep','seasonal_holiday',null,null,'Summer holiday – end not yet published','2027-07-08',null,false,false,false,'all','Not camp-bookable until the next pupil return date is published.');

insert into school_calendar_periods (
  id, location_id, academic_year, period_kind, term_name, half_term_number,
  label, starts_on, ends_on, pupils_in_school, after_school_eligible,
  camp_candidate, pupil_scope, source_url, source_checked_on, notes, metadata
)
select
  public.apres_stable_uuid('school-calendar:2026/27:' || source.site_name || ':' || source.period_kind || ':' || source.label || ':' || source.starts_on::text),
  locations.id,
  '2026/27',
  source.period_kind,
  source.term_name,
  source.half_term_number,
  source.label,
  source.starts_on,
  source.ends_on,
  source.pupils_in_school,
  source.after_school_eligible,
  source.camp_candidate,
  source.pupil_scope,
  case source.site_name
    when 'Ripley Court' then 'https://www.ripleycourt.co.uk/63/term-dates'
    when 'Shrewsbury House School' then 'https://www.shrewsburyhouse.net/term-dates'
    when 'King''s House School' then 'https://kingshouseschool.org/news-dates/term-dates/'
    when 'Willington Prep' then 'https://www.willingtonschool.co.uk/co-educational-prep-wimbledon/term-dates'
  end,
  '2026-07-19',
  source.notes,
  jsonb_build_object('source', 'official_school_website', 'calendarVersion', '2026-07-19')
from tmp_school_calendar_2026_27 source
join locations on locations.name = source.site_name
on conflict (id) do update
set period_kind = excluded.period_kind,
    term_name = excluded.term_name,
    half_term_number = excluded.half_term_number,
    label = excluded.label,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    pupils_in_school = excluded.pupils_in_school,
    after_school_eligible = excluded.after_school_eligible,
    camp_candidate = excluded.camp_candidate,
    pupil_scope = excluded.pupil_scope,
    source_url = excluded.source_url,
    source_checked_on = excluded.source_checked_on,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now();

create or replace view school_booking_windows
with (security_invoker = true)
as
select
  id,
  location_id,
  academic_year,
  term_name,
  half_term_number,
  label,
  starts_on,
  ends_on,
  source_url,
  source_checked_on
from school_calendar_periods
where period_kind = 'teaching'
  and after_school_eligible
order by location_id, starts_on;

create or replace view school_booking_date_status
with (security_invoker = true)
as
with expanded as (
  select
    period.*,
    generated.calendar_date::date
  from school_calendar_periods period
  cross join lateral generate_series(
    period.starts_on,
    coalesce(period.ends_on, period.starts_on),
    interval '1 day'
  ) generated(calendar_date)
)
select
  location_id,
  academic_year,
  calendar_date,
  bool_or(period_kind = 'teaching' and pupils_in_school) as pupils_in_school,
  bool_or(period_kind = 'teaching' and after_school_eligible)
    and not bool_or(period_kind in ('half_term_holiday', 'seasonal_holiday', 'bank_holiday', 'inset_day', 'induction_day', 'operational_closure'))
    as after_school_eligible,
  bool_or(camp_candidate) as camp_candidate,
  array_agg(distinct period_kind order by period_kind) as period_kinds,
  array_agg(distinct label order by label) as labels
from expanded
group by location_id, academic_year, calendar_date;

grant select on school_booking_windows to authenticated, service_role;
grant select on school_booking_date_status to authenticated, service_role;

create or replace function public.enforce_school_booking_calendar()
returns trigger
language plpgsql
as $$
declare
  v_category text;
  v_location_id uuid;
  v_date date;
  v_has_calendar boolean;
  v_after_school_eligible boolean;
  v_camp_candidate boolean;
begin
  if not coalesce(new.parent_bookable, false) then
    return new;
  end if;

  select lower(programmes.category), programmes.location_id
  into v_category, v_location_id
  from programmes
  where programmes.id = new.programme_id;

  if v_location_id is null then
    return new;
  end if;

  v_date := (new.starts_at at time zone 'Europe/London')::date;

  select coalesce(
    v_date between min(starts_on) and max(coalesce(ends_on, starts_on)),
    false
  )
  into v_has_calendar
  from school_calendar_periods
  where location_id = v_location_id;

  if not v_has_calendar then
    return new;
  end if;

  select after_school_eligible, camp_candidate
  into v_after_school_eligible, v_camp_candidate
  from school_booking_date_status
  where location_id = v_location_id
    and calendar_date = v_date;

  if v_category = 'wraparound' and not coalesce(v_after_school_eligible, false) then
    raise exception 'Parent-bookable wraparound session on % is blocked by the school calendar', v_date;
  end if;

  if v_category in ('holiday_camp', 'holiday camp', 'camp') and not coalesce(v_camp_candidate, false) then
    raise exception 'Parent-bookable holiday camp session on % is outside an approved finite holiday window', v_date;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_school_booking_calendar_trigger on sessions;
create trigger enforce_school_booking_calendar_trigger
before insert or update of programme_id, starts_at, parent_bookable
on sessions
for each row execute function public.enforce_school_booking_calendar();

do $$
begin
  if exists (
    select 1
    from sessions
    join programmes on programmes.id = sessions.programme_id
    join school_booking_date_status status
      on status.location_id = programmes.location_id
     and status.calendar_date = (sessions.starts_at at time zone 'Europe/London')::date
    where sessions.parent_bookable
      and lower(programmes.category) = 'wraparound'
      and not status.after_school_eligible
  ) then
    raise exception 'Existing parent-bookable wraparound sessions conflict with the school calendar';
  end if;
end;
$$;

comment on table school_calendar_periods is
  'Canonical, source-attributed school terms, half-terms, holidays, bank holidays, INSET days and operational closures used by booking validation.';
comment on view school_booking_windows is
  'Six teaching half-term windows per school, suitable for half-term and full-term booking products.';
comment on view school_booking_date_status is
  'Daily fail-closed flags for pupil attendance, after-school eligibility and candidate holiday-camp dates.';
