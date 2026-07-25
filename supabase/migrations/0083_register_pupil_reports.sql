-- Secure, auditable reports created from a pupil's live register drawer.
-- Safeguarding reports are deliberately stored as restricted incidents.

alter table public.incidents
  add column if not exists child_id uuid references public.child_profiles(id) on delete set null,
  add column if not exists booking_item_id uuid references public.booking_items(id) on delete set null,
  add column if not exists occurred_at timestamptz,
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists incidents_child_created_idx
  on public.incidents (child_id, created_at desc);

create index if not exists incidents_booking_item_idx
  on public.incidents (booking_item_id);

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
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
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

  if v_type = 'first_aid'
    and (
      coalesce(v_details ->> 'bodySide', '') not in ('front', 'back')
      or trim(coalesce(v_details ->> 'bodyPart', '')) = ''
    )
  then
    raise exception 'Select the body side and affected body part.' using errcode = '22023';
  end if;

  if v_type = 'safeguarding'
    and coalesce(v_details ->> 'dslNotified', '') <> 'yes'
  then
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
    reporter_id,
    location_id,
    session_id,
    child_id,
    booking_item_id,
    type,
    sensitivity,
    summary,
    restricted_details,
    status,
    occurred_at,
    details
  ) values (
    auth.uid(),
    v_item.location_id,
    v_item.session_id,
    v_item.child_id,
    p_booking_item_id,
    v_type,
    case
      when v_type = 'safeguarding' then 'safeguarding_restricted'::public.incident_sensitivity
      else 'standard'::public.incident_sensitivity
    end,
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
    auth.uid(),
    'Register pupil report created',
    'incidents',
    v_report_id,
    jsonb_build_object(
      'reportType', v_type,
      'childId', v_item.child_id,
      'bookingItemId', p_booking_item_id,
      'sensitivity', case when v_type = 'safeguarding' then 'restricted' else 'standard' end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reportId', v_report_id,
    'reportType', v_type,
    'status', case when v_type = 'safeguarding' then 'referred_to_dsl' else 'new' end
  );
end;
$$;

revoke all on function public.create_register_pupil_report(uuid, text, text, jsonb) from public;
grant execute on function public.create_register_pupil_report(uuid, text, text, jsonb) to authenticated;

comment on function public.create_register_pupil_report(uuid, text, text, jsonb) is
  'Creates an auditable pupil incident, first-aid record or restricted safeguarding report from an active staff register.';
