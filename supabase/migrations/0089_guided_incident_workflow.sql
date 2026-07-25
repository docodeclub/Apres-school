-- Guided, auditable incident reporting for the live register.

alter table public.incidents
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.create_register_pupil_report(
  p_booking_item_id uuid,
  p_report_type text,
  p_summary text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_report_id uuid;
  v_type text := lower(trim(coalesce(p_report_type, '')));
  v_summary text := trim(coalesce(p_summary, ''));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_category text := trim(coalesce(v_details ->> 'category', ''));
  v_severity text := trim(coalesce(v_details ->> 'severity', ''));
  v_outcome text := trim(coalesce(v_details ->> 'outcome', ''));
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  if v_type not in ('incident', 'first_aid', 'safeguarding') then
    raise exception 'Choose incident, first aid or safeguarding.' using errcode = '22023';
  end if;
  if length(v_summary) < 5 then
    raise exception 'Add a clear factual account before saving.' using errcode = '22023';
  end if;

  if v_type = 'incident' then
    if v_category not in (
      'Behaviour', 'Collection Issue', 'Parent Concern',
      'Site or Property Issue', 'Near Miss', 'Other Significant Event'
    ) then
      raise exception 'Choose a valid incident category.' using errcode = '22023';
    end if;
    if v_severity not in ('Information', 'Minor', 'Moderate', 'Serious') then
      raise exception 'Choose a valid incident severity.' using errcode = '22023';
    end if;
    if length(trim(coalesce(v_details ->> 'actionTaken', ''))) < 3 then
      raise exception 'Record what action staff took.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_details -> 'peopleInformed') <> 'array'
      or jsonb_array_length(v_details -> 'peopleInformed') = 0 then
      raise exception 'Select who was informed.' using errcode = '22023';
    end if;
    if v_outcome not in (
      'Resolved', 'Child returned to normal activities', 'Monitoring required',
      'Manager follow-up required', 'Parent follow-up required', 'Escalated'
    ) then
      raise exception 'Choose a valid incident outcome.' using errcode = '22023';
    end if;
    if v_outcome in (
      'Monitoring required', 'Manager follow-up required',
      'Parent follow-up required', 'Escalated'
    ) and length(trim(coalesce(v_details ->> 'followUpNotes', ''))) < 3 then
      raise exception 'Add the required follow-up notes.' using errcode = '22023';
    end if;
  end if;

  if v_type = 'first_aid'
    and (
      jsonb_typeof(v_details -> 'bodyAreas') <> 'array'
      or jsonb_array_length(v_details -> 'bodyAreas') = 0
    )
  then
    raise exception 'Select at least one affected area on the body map.' using errcode = '22023';
  end if;

  if v_type = 'safeguarding' and coalesce(v_details ->> 'dslNotified', '') <> 'yes' then
    raise exception 'Confirm that the DSL has been notified.' using errcode = '22023';
  end if;

  select
    item.child_id,
    item.session_id,
    programme.location_id,
    coalesce(child.preferred_name, child.full_name, item.child_name, 'Child') as child_name,
    item.site_name,
    item.programme_name,
    item.session_label
  into v_item
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.child_profiles child on child.id = item.child_id
  left join public.sessions session on session.id = item.session_id
  left join public.programmes programme on programme.id = session.programme_id
  where item.id = p_booking_item_id
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed';

  if not found then
    raise exception 'This pupil is not on an active register booking.' using errcode = '22023';
  end if;

  insert into public.incidents (
    reporter_id, location_id, session_id, child_id, booking_item_id,
    type, sensitivity, summary, restricted_details, status, occurred_at, details
  ) values (
    auth.uid(), v_item.location_id, v_item.session_id, v_item.child_id, p_booking_item_id,
    v_type,
    case when v_type = 'safeguarding'
      then 'safeguarding_restricted'::public.incident_sensitivity
      else 'standard'::public.incident_sensitivity end,
    v_summary,
    case when v_type = 'safeguarding' then v_summary else null end,
    case when v_type = 'safeguarding' then 'referred_to_dsl' else 'new' end,
    coalesce(nullif(v_details ->> 'occurredAt', '')::timestamptz, now()),
    v_details || jsonb_build_object(
      'childName', v_item.child_name,
      'siteName', coalesce(v_item.site_name, ''),
      'programmeName', coalesce(v_item.programme_name, ''),
      'sessionLabel', coalesce(v_item.session_label, '')
    )
  )
  returning id into v_report_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(), 'Register pupil report created', 'incidents', v_report_id,
    jsonb_build_object(
      'reportType', v_type, 'childId', v_item.child_id,
      'bookingItemId', p_booking_item_id,
      'category', v_category, 'severity', v_severity
    )
  );

  return jsonb_build_object(
    'ok', true, 'reportId', v_report_id, 'reportType', v_type,
    'status', case when v_type = 'safeguarding' then 'referred_to_dsl' else 'new' end
  );
end;
$$;

create or replace function public.staff_register_report_markers_for_day(p_register_date date)
returns table (
  report_id uuid,
  child_id uuid,
  report_type text,
  incident_category text,
  incident_severity text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  return query
  select
    incident.id,
    incident.child_id,
    incident.type,
    coalesce(incident.details ->> 'category', ''),
    coalesce(incident.details ->> 'severity', ''),
    coalesce(incident.occurred_at, incident.created_at)
  from public.incidents incident
  where incident.child_id is not null
    and incident.type in ('incident', 'first_aid')
    and (coalesce(incident.occurred_at, incident.created_at) at time zone 'Europe/London')::date = p_register_date
  order by coalesce(incident.occurred_at, incident.created_at) desc;
end;
$$;

create or replace function public.staff_child_activity_timeline(
  p_child_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
  v_items jsonb;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true
    and role in ('staff', 'manager', 'admin', 'superadmin');

  if v_role is null then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(limited.item order by limited.sort_at desc), '[]'::jsonb)
  into v_items
  from (
    select timeline.item, timeline.sort_at
    from (
    select jsonb_build_object(
      'id', reward.id,
      'kind', 'reward',
      'occurredAt', reward.created_at,
      'title', reward.badge_type,
      'staffName', coalesce(profile.full_name, 'Après School team'),
      'siteName', coalesce(reward.site_name, ''),
      'sessionLabel', coalesce(reward.session_label, ''),
      'reason', reward.reason
    ) as item, reward.created_at as sort_at
    from public.child_rewards reward
    left join public.profiles profile on profile.id = reward.awarded_by
    where reward.child_id = p_child_id

    union all

    select jsonb_build_object(
      'id', incident.id,
      'kind', incident.type,
      'occurredAt', coalesce(incident.occurred_at, incident.created_at),
      'title', case
        when incident.type = 'incident' then coalesce(incident.details ->> 'category', 'Incident')
        when incident.type = 'first_aid' then 'First aid'
        else 'Safeguarding concern'
      end,
      'severity', coalesce(incident.details ->> 'severity', ''),
      'staffName', coalesce(profile.full_name, 'Après School team'),
      'siteName', coalesce(incident.details ->> 'siteName', location.name, ''),
      'sessionLabel', coalesce(incident.details ->> 'sessionLabel', ''),
      'outcome', coalesce(incident.details ->> 'outcome', ''),
      'actionTaken', coalesce(incident.details ->> 'actionTaken', ''),
      'followUpNotes', coalesce(incident.details ->> 'followUpNotes', ''),
      'summary', case
        when incident.type = 'safeguarding' and v_role not in ('manager', 'admin', 'superadmin') then ''
        else incident.summary
      end,
      'restricted', incident.type = 'safeguarding'
    ) as item, coalesce(incident.occurred_at, incident.created_at) as sort_at
    from public.incidents incident
    left join public.profiles profile on profile.id = incident.reporter_id
    left join public.locations location on location.id = incident.location_id
    where incident.child_id = p_child_id
      and (incident.type <> 'safeguarding' or v_role in ('manager', 'admin', 'superadmin'))
    ) timeline
    order by timeline.sort_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) limited;

  return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke all on function public.staff_register_report_markers_for_day(date) from public;
revoke all on function public.staff_child_activity_timeline(uuid, integer) from public;
grant execute on function public.staff_register_report_markers_for_day(date) to authenticated;
grant execute on function public.staff_child_activity_timeline(uuid, integer) to authenticated;

comment on function public.staff_register_report_markers_for_day(date) is
  'Returns discreet same-day incident and first-aid markers for staff register rows.';
comment on function public.staff_child_activity_timeline(uuid, integer) is
  'Returns a permission-aware chronological reward and report history for a child.';
