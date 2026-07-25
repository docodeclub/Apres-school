-- Administrator review queue for reports created from the live register.
-- Restricted safeguarding reports remain visible only to superadmins.

alter table public.incidents
  add column if not exists follow_up_note text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists closed_at timestamptz;

create index if not exists incidents_review_queue_idx
  on public.incidents (status, created_at desc)
  where archived_at is null;

create or replace function public.list_register_pupil_reports(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role::text
  into v_role
  from public.profiles
  where id = auth.uid()
    and active = true;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Administrator report access is required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', incident.id,
        'type', incident.type,
        'sensitivity', incident.sensitivity::text,
        'summary', incident.summary,
        'status', incident.status,
        'occurredAt', coalesce(incident.occurred_at, incident.created_at),
        'createdAt', incident.created_at,
        'details', incident.details,
        'followUpNote', coalesce(incident.follow_up_note, ''),
        'reviewedAt', incident.reviewed_at,
        'closedAt', incident.closed_at,
        'childId', incident.child_id,
        'childName', coalesce(
          child.preferred_name,
          child.full_name,
          incident.details ->> 'childName',
          'Child'
        ),
        'siteName', coalesce(
          location.name,
          incident.details ->> 'siteName',
          ''
        ),
        'programmeName', coalesce(incident.details ->> 'programmeName', ''),
        'sessionLabel', coalesce(
          incident.details ->> 'sessionLabel',
          session.booking_label,
          ''
        ),
        'reporterName', coalesce(reporter.full_name, reporter.email, 'Staff member'),
        'reviewerName', coalesce(reviewer.full_name, reviewer.email, '')
      )
      order by coalesce(incident.occurred_at, incident.created_at) desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select *
    from public.incidents
    where archived_at is null
      and child_id is not null
      and (
        sensitivity = 'standard'
        or v_role = 'superadmin'
      )
    order by coalesce(occurred_at, created_at) desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) incident
  left join public.child_profiles child on child.id = incident.child_id
  left join public.locations location on location.id = incident.location_id
  left join public.sessions session on session.id = incident.session_id
  left join public.profiles reporter on reporter.id = incident.reporter_id
  left join public.profiles reviewer on reviewer.id = incident.reviewed_by;

  return v_result;
end;
$$;

create or replace function public.update_register_pupil_report(
  p_report_id uuid,
  p_status text,
  p_follow_up_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_report public.incidents%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_note text := trim(coalesce(p_follow_up_note, ''));
begin
  select role::text
  into v_role
  from public.profiles
  where id = auth.uid()
    and active = true;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Administrator report access is required.' using errcode = '42501';
  end if;

  if v_status not in (
    'new',
    'under_review',
    'parent_follow_up',
    'closed',
    'referred_to_dsl',
    'dsl_reviewing',
    'dsl_closed'
  ) then
    raise exception 'Choose a valid report status.' using errcode = '22023';
  end if;

  select *
  into v_report
  from public.incidents
  where id = p_report_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;

  if v_report.sensitivity = 'safeguarding_restricted'
    and v_role <> 'superadmin'
  then
    raise exception 'Restricted safeguarding access is required.' using errcode = '42501';
  end if;

  if v_report.sensitivity = 'standard'
    and v_status in ('referred_to_dsl', 'dsl_reviewing', 'dsl_closed')
  then
    raise exception 'DSL statuses are only available for safeguarding reports.' using errcode = '22023';
  end if;

  if v_report.sensitivity = 'safeguarding_restricted'
    and v_status not in ('referred_to_dsl', 'dsl_reviewing', 'dsl_closed')
  then
    raise exception 'Choose a safeguarding review status.' using errcode = '22023';
  end if;

  update public.incidents
  set
    status = v_status,
    follow_up_note = nullif(v_note, ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    closed_at = case
      when v_status in ('closed', 'dsl_closed') then now()
      else null
    end
  where id = p_report_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'Register pupil report reviewed',
    'incidents',
    p_report_id,
    jsonb_build_object(
      'status', v_status,
      'sensitivity', v_report.sensitivity::text,
      'noteRecorded', v_note <> ''
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reportId', p_report_id,
    'status', v_status
  );
end;
$$;

revoke all on function public.list_register_pupil_reports(integer) from public;
grant execute on function public.list_register_pupil_reports(integer) to authenticated;

revoke all on function public.update_register_pupil_report(uuid, text, text) from public;
grant execute on function public.update_register_pupil_report(uuid, text, text) to authenticated;

comment on function public.list_register_pupil_reports(integer) is
  'Lists standard pupil reports for admins and includes restricted safeguarding reports only for superadmins.';

comment on function public.update_register_pupil_report(uuid, text, text) is
  'Updates an authorised pupil report review status and records an auditable follow-up note.';
