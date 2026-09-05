-- The original Ripley Staff rule was seeded against the legacy
-- "Ripley Court School" location. Live wraparound sessions use the active
-- "Ripley Court" location, so the school-specific rule did not match them.

do $$
declare
  v_live_ripley_id uuid;
begin
  select distinct p.location_id
  into v_live_ripley_id
  from public.programmes p
  join public.locations l on l.id = p.location_id
  where lower(l.name) = 'ripley court'
    and l.active = true
    and lower(coalesce(p.category, '')) = 'wraparound'
  order by p.location_id
  limit 1;

  if v_live_ripley_id is null then
    raise exception 'The active Ripley Court wraparound location could not be found.';
  end if;

  update public.pricing_group_rules r
  set school_id = v_live_ripley_id,
      updated_at = now()
  from public.pricing_groups g
  where g.id = r.pricing_group_id
    and g.key = 'ripley-staff'
    and r.name = 'Ripley Staff · 50% off all services'
    and r.deleted_at is null
    and r.school_id is distinct from v_live_ripley_id;
end;
$$;
