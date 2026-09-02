-- Add the Ripley Court complimentary-care tier requested by operations and
-- restore the table privileges required by the existing Admin/Superadmin UI.

grant insert, update on public.pricing_groups to authenticated;
grant insert, update on public.pricing_group_rules to authenticated;

do $$
declare
  v_group_id uuid;
  v_school_id uuid;
  v_actor_id uuid;
begin
  select id into v_actor_id
  from public.profiles
  where lower(email) = 'luke@apres-school.co.uk'
  limit 1;

  select id into v_school_id
  from public.locations
  where lower(name) in ('ripley court', 'ripley court school')
    and active = true
  order by case when lower(name) = 'ripley court' then 0 else 1 end
  limit 1;

  if v_school_id is null then
    raise exception 'The active Ripley Court location could not be found.';
  end if;

  insert into public.pricing_groups (
    key,
    name,
    description,
    status,
    is_default,
    created_by
  ) values (
    'ripley-court-free-care',
    'Ripley Court Free Care',
    'Complimentary care at Ripley Court School. Eligibility is at the sole discretion of Après School.',
    'active',
    false,
    v_actor_id
  )
  on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      status = 'active',
      is_default = false,
      archived_at = null,
      deleted_at = null,
      updated_at = now()
  returning id into v_group_id;

  update public.pricing_group_rules
  set school_id = v_school_id,
      service_key = 'all',
      programme_id = null,
      discount_type = 'free_session',
      discount_value = 0,
      priority = 300,
      enabled = true,
      starts_on = null,
      ends_on = null,
      notes = 'Free care at Ripley Court only.',
      archived_at = null,
      deleted_at = null,
      updated_at = now()
  where pricing_group_id = v_group_id
    and name = 'Free care at Ripley Court';

  if not found then
    insert into public.pricing_group_rules (
      pricing_group_id,
      name,
      school_id,
      service_key,
      discount_type,
      discount_value,
      priority,
      enabled,
      notes,
      created_by
    ) values (
      v_group_id,
      'Free care at Ripley Court',
      v_school_id,
      'all',
      'free_session',
      0,
      300,
      true,
      'Free care at Ripley Court only.',
      v_actor_id
    );
  end if;

  if not exists (
    select 1
    from public.pricing_group_events
    where pricing_group_id = v_group_id
      and action = 'group_created'
  ) then
    insert into public.pricing_group_events (
      pricing_group_id,
      actor_id,
      actor_email,
      action,
      notes,
      metadata
    ) values (
      v_group_id,
      v_actor_id,
      'luke@apres-school.co.uk',
      'group_created',
      'Ripley Court complimentary-care tier created.',
      jsonb_build_object('source', '0164_ripley_court_free_care_group')
    );
  end if;
end;
$$;
