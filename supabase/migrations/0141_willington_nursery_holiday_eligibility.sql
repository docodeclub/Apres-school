-- Holiday Camp accepts Nursery children at Willington only.
-- All other venues retain the platform-wide Reception to Year 6 rule.

create or replace function public.enforce_holiday_camp_programme_age_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_site text;
begin
  if new.category <> 'holiday_camp' then
    return new;
  end if;

  select name into v_site from public.locations where id = new.location_id;
  new.age_range := case
    when lower(trim(coalesce(v_site, ''))) ~ '^willington([[:space:]]+(prep|school))?$' then 'Nursery to Year 6'
    else 'Reception to Year 6'
  end;
  return new;
end;
$$;

drop trigger if exists enforce_holiday_camp_programme_age_range_trigger on public.programmes;
create trigger enforce_holiday_camp_programme_age_range_trigger
before insert or update of category, location_id, age_range on public.programmes
for each row execute function public.enforce_holiday_camp_programme_age_range();

create or replace function public.enforce_holiday_camp_session_year_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category text;
  v_site text;
  v_min_year text;
begin
  select p.category, l.name
  into v_category, v_site
  from public.programmes p
  join public.locations l on l.id = p.location_id
  where p.id = new.programme_id;

  if v_category <> 'holiday_camp' then
    return new;
  end if;

  v_min_year := case
    when lower(trim(coalesce(v_site, ''))) ~ '^willington([[:space:]]+(prep|school))?$' then 'Nursery'
    else 'Reception'
  end;
  new.eligibility := coalesce(new.eligibility, '{}'::jsonb) || jsonb_build_object(
    'minYear', v_min_year,
    'maxYear', 'Year 6',
    'yearRangeLabel', v_min_year || ' to Year 6'
  );
  return new;
end;
$$;

drop trigger if exists enforce_holiday_camp_session_year_range_trigger on public.sessions;
create trigger enforce_holiday_camp_session_year_range_trigger
before insert or update of programme_id, eligibility on public.sessions
for each row execute function public.enforce_holiday_camp_session_year_range();

update public.programmes p
set age_range = case
  when lower(trim(l.name)) ~ '^willington([[:space:]]+(prep|school))?$' then 'Nursery to Year 6'
  else 'Reception to Year 6'
end
from public.locations l
where p.location_id = l.id
  and p.category = 'holiday_camp';

update public.sessions s
set eligibility = coalesce(s.eligibility, '{}'::jsonb)
from public.programmes p
where s.programme_id = p.id
  and p.category = 'holiday_camp';

