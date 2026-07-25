-- Protected safeguarding case management.
-- Existing restricted incidents remain in place and are linked into immutable cases.

create table if not exists public.safeguarding_cases (
  id uuid primary key default gen_random_uuid(),
  concern_number bigint generated always as identity unique,
  source_incident_id uuid unique references public.incidents(id) on delete restrict,
  primary_child_id uuid references public.child_profiles(id) on delete restrict,
  booking_item_id uuid references public.booking_items(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  session_id uuid references public.sessions(id) on delete restrict,
  reported_by uuid not null references public.profiles(id) on delete restrict,
  assigned_dsl_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'New'
    check (status in ('New', 'DSL Reviewing', 'Monitoring', 'External Referral', 'Closed', 'Archived')),
  priority text not null default 'Standard'
    check (priority in ('Low', 'Standard', 'High', 'Urgent')),
  concern_source text not null,
  categories text[] not null default '{}',
  child_safe_now boolean not null,
  factual_account text not null,
  immediate_action text not null,
  witnesses jsonb not null default '{"staff":[],"children":[],"otherAdults":[]}'::jsonb,
  dsl_informed boolean not null default false,
  dsl_informed_who text,
  dsl_informed_at timestamptz,
  site_name text,
  club_name text,
  session_label text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  archived_at timestamptz,
  check (length(trim(factual_account)) >= 5),
  check (cardinality(categories) > 0),
  check (not dsl_informed or (nullif(trim(dsl_informed_who), '') is not null and dsl_informed_at is not null))
);

create table if not exists public.safeguarding_case_children (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.safeguarding_cases(id) on delete restrict,
  child_id uuid not null references public.child_profiles(id) on delete restrict,
  relationship text not null default 'Subject',
  linked_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete restrict,
  unique (case_id, child_id)
);

create table if not exists public.safeguarding_case_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.safeguarding_cases(id) on delete restrict,
  entry_type text not null,
  content text not null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  site_name text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(trim(content)) > 0)
);

create table if not exists public.safeguarding_case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.safeguarding_cases(id) on delete restrict,
  title text not null,
  details text,
  assigned_to uuid references public.profiles(id) on delete restrict,
  due_at timestamptz,
  status text not null default 'Open' check (status in ('Open', 'Completed', 'Cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.safeguarding_case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.safeguarding_cases(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  media_type text,
  byte_size bigint,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete restrict
);

create table if not exists public.safeguarding_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  booking_item_id uuid not null references public.booking_items(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, booking_item_id)
);

create index if not exists safeguarding_cases_updated_idx on public.safeguarding_cases (updated_at desc);
create index if not exists safeguarding_cases_child_idx on public.safeguarding_cases (primary_child_id, created_at desc);
create index if not exists safeguarding_cases_reporter_idx on public.safeguarding_cases (reported_by, created_at desc);
create index if not exists safeguarding_entries_case_idx on public.safeguarding_case_entries (case_id, occurred_at, created_at);
create index if not exists safeguarding_tasks_case_idx on public.safeguarding_case_tasks (case_id, status, due_at);

alter table public.safeguarding_cases enable row level security;
alter table public.safeguarding_case_children enable row level security;
alter table public.safeguarding_case_entries enable row level security;
alter table public.safeguarding_case_tasks enable row level security;
alter table public.safeguarding_case_attachments enable row level security;
alter table public.safeguarding_drafts enable row level security;

-- No direct client policies are created. All access is mediated by audited,
-- security-definer functions with explicit role/ownership checks.

create or replace function public.is_safeguarding_dsl()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and role = 'superadmin'
  );
$$;

create or replace function public.can_access_safeguarding_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.safeguarding_cases
    where id = p_case_id
      and (reported_by = auth.uid() or public.is_safeguarding_dsl())
  );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'safeguarding-private',
  'safeguarding-private',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'message/rfc822']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "safeguarding_attachment_upload" on storage.objects;
create policy "safeguarding_attachment_upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'safeguarding-private'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_safeguarding_case(split_part(name, '/', 1)::uuid)
);

drop policy if exists "safeguarding_attachment_read" on storage.objects;
create policy "safeguarding_attachment_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'safeguarding-private'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_safeguarding_case(split_part(name, '/', 1)::uuid)
);

create or replace function public.save_safeguarding_draft(
  p_booking_item_id uuid,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff access is required.' using errcode = '42501';
  end if;

  insert into public.safeguarding_drafts (author_id, booking_item_id, content)
  values (auth.uid(), p_booking_item_id, coalesce(p_content, '{}'::jsonb))
  on conflict (author_id, booking_item_id) do update
    set content = excluded.content, updated_at = now();

  return jsonb_build_object('ok', true, 'savedAt', now());
end;
$$;

create or replace function public.read_safeguarding_draft(p_booking_item_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object('content', content, 'updatedAt', updated_at)
    from public.safeguarding_drafts
    where author_id = auth.uid() and booking_item_id = p_booking_item_id
  ), '{}'::jsonb);
$$;

create or replace function public.delete_safeguarding_draft(p_booking_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.safeguarding_drafts
  where author_id = auth.uid() and booking_item_id = p_booking_item_id;
  return true;
end;
$$;

create or replace function public.create_safeguarding_concern(
  p_booking_item_id uuid,
  p_child_safe_now boolean,
  p_concern_source text,
  p_categories text[],
  p_factual_account text,
  p_immediate_action text,
  p_witnesses jsonb default '{}'::jsonb,
  p_dsl_informed boolean default false,
  p_dsl_informed_who text default null,
  p_dsl_informed_at timestamptz default null,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_case_id uuid;
  v_incident_id uuid;
  v_number bigint;
  v_source text := trim(coalesce(p_concern_source, ''));
  v_account text := trim(coalesce(p_factual_account, ''));
  v_action text := trim(coalesce(p_immediate_action, ''));
  v_allowed_sources constant text[] := array[
    'Observed', 'Child Disclosure', 'Parent Disclosure', 'Staff Concern',
    'Third Party', 'External Agency'
  ];
  v_allowed_categories constant text[] := array[
    'Physical Abuse', 'Emotional Abuse', 'Neglect', 'Sexual Abuse',
    'Online Safety', 'Child-on-child', 'Domestic Abuse', 'Mental Health',
    'Self Harm', 'Radicalisation', 'Attendance', 'Substance Misuse', 'Other'
  ];
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;
  if p_child_safe_now is null then
    raise exception 'Confirm whether the child is currently safe.' using errcode = '22023';
  end if;
  if not (v_source = any(v_allowed_sources)) then
    raise exception 'Choose how the concern arose.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_categories), 0) = 0
    or exists (select 1 from unnest(p_categories) category where not (category = any(v_allowed_categories)))
  then
    raise exception 'Choose at least one valid concern category.' using errcode = '22023';
  end if;
  if length(v_account) < 5 then
    raise exception 'Add a clear factual account.' using errcode = '22023';
  end if;
  if v_action = '' then
    raise exception 'Record the immediate action taken.' using errcode = '22023';
  end if;
  if p_dsl_informed and (nullif(trim(coalesce(p_dsl_informed_who, '')), '') is null or p_dsl_informed_at is null) then
    raise exception 'Record who was informed and when.' using errcode = '22023';
  end if;

  select
    item.child_id, item.session_id, programme.location_id,
    coalesce(child.preferred_name, child.full_name, item.child_name, 'Child') child_name,
    item.site_name, item.programme_name, item.session_label
  into v_item
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.child_profiles child on child.id = item.child_id
  left join public.sessions session on session.id = item.session_id
  left join public.programmes programme on programme.id = session.programme_id
  where item.id = p_booking_item_id
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed';

  if not found or v_item.child_id is null then
    raise exception 'This pupil is not on an active register booking.' using errcode = '22023';
  end if;

  insert into public.incidents (
    reporter_id, location_id, session_id, child_id, booking_item_id, type,
    sensitivity, summary, restricted_details, status, occurred_at, details
  ) values (
    auth.uid(), v_item.location_id, v_item.session_id, v_item.child_id, p_booking_item_id,
    'safeguarding', 'safeguarding_restricted', v_account, v_account, 'referred_to_dsl',
    coalesce(p_occurred_at, now()),
    jsonb_build_object(
      'childSafeNow', p_child_safe_now, 'concernRoute', v_source,
      'categories', p_categories, 'actionTaken', v_action,
      'witnesses', coalesce(p_witnesses, '{}'::jsonb),
      'dslNotified', case when p_dsl_informed then 'yes' else 'no' end,
      'dslInformedWho', nullif(trim(coalesce(p_dsl_informed_who, '')), ''),
      'dslInformedAt', p_dsl_informed_at, 'childName', v_item.child_name,
      'siteName', coalesce(v_item.site_name, ''),
      'programmeName', coalesce(v_item.programme_name, ''),
      'sessionLabel', coalesce(v_item.session_label, '')
    )
  ) returning id into v_incident_id;

  insert into public.safeguarding_cases (
    source_incident_id, primary_child_id, booking_item_id, location_id, session_id,
    reported_by, priority, concern_source, categories, child_safe_now,
    factual_account, immediate_action, witnesses, dsl_informed,
    dsl_informed_who, dsl_informed_at, site_name, club_name, session_label, occurred_at
  ) values (
    v_incident_id, v_item.child_id, p_booking_item_id, v_item.location_id, v_item.session_id,
    auth.uid(), case when p_child_safe_now then 'Standard' else 'Urgent' end,
    v_source, p_categories, p_child_safe_now, v_account, v_action,
    coalesce(p_witnesses, '{}'::jsonb), p_dsl_informed,
    nullif(trim(coalesce(p_dsl_informed_who, '')), ''), p_dsl_informed_at,
    v_item.site_name, v_item.programme_name, v_item.session_label, coalesce(p_occurred_at, now())
  ) returning id, concern_number into v_case_id, v_number;

  insert into public.safeguarding_case_children (case_id, child_id, linked_by)
  values (v_case_id, v_item.child_id, auth.uid());

  insert into public.safeguarding_case_entries (
    case_id, entry_type, content, author_id, location_id, site_name, occurred_at, metadata
  ) values (
    v_case_id, 'Initial concern', v_account, auth.uid(), v_item.location_id,
    v_item.site_name, coalesce(p_occurred_at, now()),
    jsonb_build_object('immutableOriginal', true, 'immediateAction', v_action)
  );

  delete from public.safeguarding_drafts
  where author_id = auth.uid() and booking_item_id = p_booking_item_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'Safeguarding concern submitted', 'safeguarding_cases', v_case_id,
    jsonb_build_object('concernNumber', v_number, 'sourceIncidentId', v_incident_id));

  return jsonb_build_object('ok', true, 'caseId', v_case_id, 'concernNumber', v_number, 'reportId', v_incident_id);
end;
$$;

-- Backfill existing restricted safeguarding records without altering their source data.
insert into public.safeguarding_cases (
  source_incident_id, primary_child_id, booking_item_id, location_id, session_id,
  reported_by, status, priority, concern_source, categories, child_safe_now,
  factual_account, immediate_action, witnesses, dsl_informed, dsl_informed_who,
  dsl_informed_at, site_name, club_name, session_label, occurred_at, created_at, updated_at
)
select
  incident.id, incident.child_id, incident.booking_item_id, incident.location_id, incident.session_id,
  incident.reporter_id,
  case when incident.status = 'dsl_closed' then 'Closed'
       when incident.status = 'dsl_reviewing' then 'DSL Reviewing' else 'New' end,
  'Standard', coalesce(nullif(incident.details ->> 'concernRoute', ''), 'Observed'),
  array['Other']::text[], true, incident.summary,
  coalesce(nullif(incident.details ->> 'actionTaken', ''), 'Recorded in the legacy safeguarding workflow.'),
  coalesce(incident.details -> 'witnesses', '{}'::jsonb),
  coalesce(incident.details ->> 'dslNotified', '') = 'yes',
  case when coalesce(incident.details ->> 'dslNotified', '') = 'yes'
    then coalesce(nullif(incident.details ->> 'dslInformedWho', ''), 'DSL recorded in legacy workflow')
    else null end,
  case when coalesce(incident.details ->> 'dslNotified', '') = 'yes'
    then coalesce(nullif(incident.details ->> 'dslInformedAt', '')::timestamptz, incident.created_at)
    else null end,
  coalesce(incident.details ->> 'siteName', location.name, ''),
  coalesce(incident.details ->> 'programmeName', ''),
  coalesce(incident.details ->> 'sessionLabel', ''),
  coalesce(incident.occurred_at, incident.created_at), incident.created_at,
  coalesce(incident.reviewed_at, incident.created_at)
from public.incidents incident
left join public.locations location on location.id = incident.location_id
where incident.type = 'safeguarding'
  and incident.sensitivity = 'safeguarding_restricted'
  and incident.reporter_id is not null
  and incident.child_id is not null
  and not exists (
    select 1 from public.safeguarding_cases existing where existing.source_incident_id = incident.id
  );

insert into public.safeguarding_case_children (case_id, child_id, linked_by)
select safeguarding.id, safeguarding.primary_child_id, safeguarding.reported_by
from public.safeguarding_cases safeguarding
where not exists (
  select 1 from public.safeguarding_case_children linked
  where linked.case_id = safeguarding.id and linked.child_id = safeguarding.primary_child_id
);

insert into public.safeguarding_case_entries (
  case_id, entry_type, content, author_id, location_id, site_name, occurred_at, metadata
)
select safeguarding.id, 'Initial concern', safeguarding.factual_account, safeguarding.reported_by,
  safeguarding.location_id, safeguarding.site_name, safeguarding.occurred_at,
  jsonb_build_object('immutableOriginal', true, 'legacyBackfill', true)
from public.safeguarding_cases safeguarding
where not exists (
  select 1 from public.safeguarding_case_entries entry
  where entry.case_id = safeguarding.id and entry.entry_type = 'Initial concern'
);

create or replace function public.list_safeguarding_cases(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.is_safeguarding_dsl() then
    raise exception 'Restricted safeguarding access is required.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_data order by row_data ->> 'updatedAt' desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', safeguarding.id, 'concernNumber', safeguarding.concern_number,
      'childId', safeguarding.primary_child_id,
      'childName', coalesce(child.preferred_name, child.full_name, 'Child'),
      'status', safeguarding.status, 'priority', safeguarding.priority,
      'categories', safeguarding.categories, 'siteName', safeguarding.site_name,
      'assignedDslId', safeguarding.assigned_dsl_id,
      'assignedDslName', coalesce(dsl.full_name, dsl.email, ''),
      'reporterName', coalesce(reporter.full_name, reporter.email, 'Staff member'),
      'createdAt', safeguarding.created_at, 'updatedAt', safeguarding.updated_at
    ) row_data
    from public.safeguarding_cases safeguarding
    left join public.child_profiles child on child.id = safeguarding.primary_child_id
    left join public.profiles dsl on dsl.id = safeguarding.assigned_dsl_id
    left join public.profiles reporter on reporter.id = safeguarding.reported_by
    order by safeguarding.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) cases;
  return v_result;
end;
$$;

create or replace function public.list_my_safeguarding_submissions(p_limit integer default 50)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', safeguarding.id,
    'concernNumber', safeguarding.concern_number,
    'childName', coalesce(child.preferred_name, child.full_name, 'Child'),
    'status', safeguarding.status,
    'submittedAt', safeguarding.created_at
  ) order by safeguarding.created_at desc), '[]'::jsonb)
  from (
    select * from public.safeguarding_cases
    where reported_by = auth.uid()
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) safeguarding
  left join public.child_profiles child on child.id = safeguarding.primary_child_id;
$$;

create or replace function public.get_safeguarding_case(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_case public.safeguarding_cases%rowtype; v_result jsonb;
begin
  select * into v_case from public.safeguarding_cases where id = p_case_id;
  if not found then raise exception 'Safeguarding case not found.' using errcode = 'P0002'; end if;
  if not public.is_safeguarding_dsl() and v_case.reported_by <> auth.uid() then
    raise exception 'You can only view safeguarding concerns you submitted.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', v_case.id, 'concernNumber', v_case.concern_number,
    'childId', v_case.primary_child_id,
    'childName', coalesce(child.preferred_name, child.full_name, 'Child'),
    'status', v_case.status, 'priority', v_case.priority,
    'concernSource', v_case.concern_source, 'categories', v_case.categories,
    'childSafeNow', v_case.child_safe_now, 'factualAccount', v_case.factual_account,
    'immediateAction', v_case.immediate_action, 'witnesses', v_case.witnesses,
    'dslInformed', v_case.dsl_informed, 'dslInformedWho', v_case.dsl_informed_who,
    'dslInformedAt', v_case.dsl_informed_at, 'siteName', v_case.site_name,
    'clubName', v_case.club_name, 'sessionLabel', v_case.session_label,
    'reporterName', coalesce(reporter.full_name, reporter.email, 'Staff member'),
    'assignedDslId', v_case.assigned_dsl_id,
    'assignedDslName', coalesce(dsl.full_name, dsl.email, ''),
    'occurredAt', v_case.occurred_at, 'createdAt', v_case.created_at, 'updatedAt', v_case.updated_at,
    'chronology', coalesce((select jsonb_agg(jsonb_build_object(
      'id', entry.id, 'entryType', entry.entry_type, 'content', entry.content,
      'authorName', coalesce(author.full_name, author.email, 'Staff member'),
      'siteName', entry.site_name, 'occurredAt', entry.occurred_at, 'createdAt', entry.created_at,
      'metadata', entry.metadata
    ) order by entry.occurred_at, entry.created_at)
      from public.safeguarding_case_entries entry
      left join public.profiles author on author.id = entry.author_id
      where entry.case_id = v_case.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
      'id', task.id, 'title', task.title, 'details', task.details, 'status', task.status,
      'dueAt', task.due_at, 'assignedToName', coalesce(assignee.full_name, assignee.email, ''),
      'createdAt', task.created_at, 'completedAt', task.completed_at
    ) order by task.created_at desc)
      from public.safeguarding_case_tasks task
      left join public.profiles assignee on assignee.id = task.assigned_to
      where task.case_id = v_case.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', attachment.id, 'fileName', attachment.file_name,
      'mediaType', attachment.media_type, 'byteSize', attachment.byte_size,
      'createdAt', attachment.created_at
    ) order by attachment.created_at desc)
      from public.safeguarding_case_attachments attachment
      where attachment.case_id = v_case.id and attachment.removed_at is null), '[]'::jsonb)
  ) into v_result
  from public.child_profiles child
  left join public.profiles reporter on reporter.id = v_case.reported_by
  left join public.profiles dsl on dsl.id = v_case.assigned_dsl_id
  where child.id = v_case.primary_child_id;
  return v_result;
end;
$$;

create or replace function public.append_safeguarding_case_entry(
  p_case_id uuid, p_entry_type text, p_content text, p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_entry_id uuid;
begin
  if not public.is_safeguarding_dsl() then
    raise exception 'Restricted safeguarding access is required.' using errcode = '42501';
  end if;
  if trim(coalesce(p_content, '')) = '' then
    raise exception 'Add a chronology note.' using errcode = '22023';
  end if;
  insert into public.safeguarding_case_entries (case_id, entry_type, content, author_id, occurred_at)
  values (p_case_id, coalesce(nullif(trim(p_entry_type), ''), 'Case note'), trim(p_content), auth.uid(), coalesce(p_occurred_at, now()))
  returning id into v_entry_id;
  update public.safeguarding_cases set updated_at = now() where id = p_case_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'Safeguarding chronology entry added', 'safeguarding_cases', p_case_id,
    jsonb_build_object('entryId', v_entry_id, 'entryType', p_entry_type));
  return jsonb_build_object('ok', true, 'entryId', v_entry_id);
end;
$$;

create or replace function public.update_safeguarding_case(
  p_case_id uuid, p_status text, p_priority text, p_assigned_dsl_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_old public.safeguarding_cases%rowtype;
begin
  if not public.is_safeguarding_dsl() then
    raise exception 'Restricted safeguarding access is required.' using errcode = '42501';
  end if;
  select * into v_old from public.safeguarding_cases where id = p_case_id for update;
  if not found then raise exception 'Safeguarding case not found.' using errcode = 'P0002'; end if;
  if p_status not in ('New', 'DSL Reviewing', 'Monitoring', 'External Referral', 'Closed', 'Archived')
    or p_priority not in ('Low', 'Standard', 'High', 'Urgent')
  then raise exception 'Choose a valid status and priority.' using errcode = '22023'; end if;
  update public.safeguarding_cases set
    status = p_status, priority = p_priority, assigned_dsl_id = p_assigned_dsl_id,
    updated_at = now(), closed_at = case when p_status = 'Closed' then coalesce(closed_at, now()) else null end,
    archived_at = case when p_status = 'Archived' then coalesce(archived_at, now()) else null end
  where id = p_case_id;
  if (v_old.status, v_old.priority, v_old.assigned_dsl_id)
    is distinct from (p_status, p_priority, p_assigned_dsl_id)
  then
    insert into public.safeguarding_case_entries (case_id, entry_type, content, author_id, metadata)
    values (p_case_id, 'Case updated',
      format('Status: %s. Priority: %s.', p_status, p_priority), auth.uid(),
      jsonb_build_object(
        'old', jsonb_build_object('status', v_old.status, 'priority', v_old.priority, 'assignedDslId', v_old.assigned_dsl_id),
        'new', jsonb_build_object('status', p_status, 'priority', p_priority, 'assignedDslId', p_assigned_dsl_id)
      ));
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (auth.uid(), 'Safeguarding case updated', 'safeguarding_cases', p_case_id,
      jsonb_build_object(
        'old', jsonb_build_object('status', v_old.status, 'priority', v_old.priority, 'assignedDslId', v_old.assigned_dsl_id),
        'new', jsonb_build_object('status', p_status, 'priority', p_priority, 'assignedDslId', p_assigned_dsl_id)
      ));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_safeguarding_case_task(
  p_case_id uuid, p_title text, p_details text default '', p_assigned_to uuid default null, p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_task_id uuid;
begin
  if not public.is_safeguarding_dsl() then raise exception 'Restricted safeguarding access is required.' using errcode = '42501'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Add a task title.' using errcode = '22023'; end if;
  insert into public.safeguarding_case_tasks (case_id, title, details, assigned_to, due_at, created_by)
  values (p_case_id, trim(p_title), nullif(trim(coalesce(p_details, '')), ''), p_assigned_to, p_due_at, auth.uid())
  returning id into v_task_id;
  insert into public.safeguarding_case_entries (case_id, entry_type, content, author_id, metadata)
  values (p_case_id, 'Task created', trim(p_title), auth.uid(), jsonb_build_object('taskId', v_task_id, 'dueAt', p_due_at));
  update public.safeguarding_cases set updated_at = now() where id = p_case_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'Safeguarding task created', 'safeguarding_cases', p_case_id,
    jsonb_build_object('taskId', v_task_id, 'new', jsonb_build_object('status', 'Open', 'title', trim(p_title), 'dueAt', p_due_at)));
  return jsonb_build_object('ok', true, 'taskId', v_task_id);
end;
$$;

create or replace function public.complete_safeguarding_case_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_task public.safeguarding_case_tasks%rowtype;
begin
  if not public.is_safeguarding_dsl() then raise exception 'Restricted safeguarding access is required.' using errcode = '42501'; end if;
  select * into v_task from public.safeguarding_case_tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  if v_task.status = 'Open' then
    update public.safeguarding_case_tasks
    set status = 'Completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
    where id = p_task_id;
    insert into public.safeguarding_case_entries (case_id, entry_type, content, author_id, metadata)
    values (v_task.case_id, 'Task completed', v_task.title, auth.uid(), jsonb_build_object('taskId', p_task_id));
    update public.safeguarding_cases set updated_at = now() where id = v_task.case_id;
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (auth.uid(), 'Safeguarding task completed', 'safeguarding_cases', v_task.case_id,
      jsonb_build_object('taskId', p_task_id, 'old', jsonb_build_object('status', 'Open'), 'new', jsonb_build_object('status', 'Completed')));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.record_safeguarding_attachment(
  p_case_id uuid, p_storage_path text, p_file_name text,
  p_media_type text default null, p_byte_size bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_attachment_id uuid; v_reporter uuid;
begin
  select reported_by into v_reporter from public.safeguarding_cases where id = p_case_id;
  if not found then raise exception 'Safeguarding case not found.' using errcode = 'P0002'; end if;
  if v_reporter <> auth.uid() and not public.is_safeguarding_dsl() then
    raise exception 'Safeguarding attachment access is required.' using errcode = '42501';
  end if;
  if p_storage_path not like (p_case_id::text || '/%') or trim(coalesce(p_file_name, '')) = '' then
    raise exception 'Invalid safeguarding attachment.' using errcode = '22023';
  end if;
  insert into public.safeguarding_case_attachments (
    case_id, storage_path, file_name, media_type, byte_size, uploaded_by
  ) values (
    p_case_id, p_storage_path, trim(p_file_name), nullif(trim(coalesce(p_media_type, '')), ''),
    p_byte_size, auth.uid()
  ) returning id into v_attachment_id;
  insert into public.safeguarding_case_entries (case_id, entry_type, content, author_id, metadata)
  values (p_case_id, 'Attachment added', trim(p_file_name), auth.uid(),
    jsonb_build_object('attachmentId', v_attachment_id, 'mediaType', p_media_type, 'byteSize', p_byte_size));
  update public.safeguarding_cases set updated_at = now() where id = p_case_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'Safeguarding attachment added', 'safeguarding_cases', p_case_id,
    jsonb_build_object('attachmentId', v_attachment_id, 'fileName', p_file_name));
  return jsonb_build_object('ok', true, 'attachmentId', v_attachment_id);
end;
$$;

revoke all on function public.is_safeguarding_dsl() from public;
revoke all on function public.can_access_safeguarding_case(uuid) from public;
revoke all on function public.save_safeguarding_draft(uuid, jsonb) from public;
revoke all on function public.read_safeguarding_draft(uuid) from public;
revoke all on function public.delete_safeguarding_draft(uuid) from public;
revoke all on function public.create_safeguarding_concern(uuid, boolean, text, text[], text, text, jsonb, boolean, text, timestamptz, timestamptz) from public;
revoke all on function public.list_safeguarding_cases(integer) from public;
revoke all on function public.list_my_safeguarding_submissions(integer) from public;
revoke all on function public.get_safeguarding_case(uuid) from public;
revoke all on function public.append_safeguarding_case_entry(uuid, text, text, timestamptz) from public;
revoke all on function public.update_safeguarding_case(uuid, text, text, uuid) from public;
revoke all on function public.create_safeguarding_case_task(uuid, text, text, uuid, timestamptz) from public;
revoke all on function public.complete_safeguarding_case_task(uuid) from public;
revoke all on function public.record_safeguarding_attachment(uuid, text, text, text, bigint) from public;

grant execute on function public.is_safeguarding_dsl() to authenticated;
grant execute on function public.can_access_safeguarding_case(uuid) to authenticated;
grant execute on function public.save_safeguarding_draft(uuid, jsonb) to authenticated;
grant execute on function public.read_safeguarding_draft(uuid) to authenticated;
grant execute on function public.delete_safeguarding_draft(uuid) to authenticated;
grant execute on function public.create_safeguarding_concern(uuid, boolean, text, text[], text, text, jsonb, boolean, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.list_safeguarding_cases(integer) to authenticated;
grant execute on function public.list_my_safeguarding_submissions(integer) to authenticated;
grant execute on function public.get_safeguarding_case(uuid) to authenticated;
grant execute on function public.append_safeguarding_case_entry(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.update_safeguarding_case(uuid, text, text, uuid) to authenticated;
grant execute on function public.create_safeguarding_case_task(uuid, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.complete_safeguarding_case_task(uuid) to authenticated;
grant execute on function public.record_safeguarding_attachment(uuid, text, text, text, bigint) to authenticated;

-- Prevent accidental mutation or deletion of the immutable original concern.
create or replace function public.protect_safeguarding_original()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Safeguarding records must never be deleted.';
  end if;
  if (new.factual_account, new.concern_source, new.categories, new.child_safe_now,
      new.immediate_action, new.witnesses, new.reported_by, new.occurred_at)
    is distinct from
     (old.factual_account, old.concern_source, old.categories, old.child_safe_now,
      old.immediate_action, old.witnesses, old.reported_by, old.occurred_at)
  then
    raise exception 'The original safeguarding concern is immutable. Add a chronology entry instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists safeguard_original_immutable on public.safeguarding_cases;
create trigger safeguard_original_immutable
before update or delete on public.safeguarding_cases
for each row execute function public.protect_safeguarding_original();

create or replace function public.prevent_safeguarding_record_delete()
returns trigger language plpgsql as $$
begin raise exception 'Safeguarding records must never be deleted.'; end;
$$;

drop trigger if exists safeguard_entries_no_delete on public.safeguarding_case_entries;
create trigger safeguard_entries_no_delete before delete on public.safeguarding_case_entries
for each row execute function public.prevent_safeguarding_record_delete();
drop trigger if exists safeguard_tasks_no_delete on public.safeguarding_case_tasks;
create trigger safeguard_tasks_no_delete before delete on public.safeguarding_case_tasks
for each row execute function public.prevent_safeguarding_record_delete();
drop trigger if exists safeguard_attachments_no_delete on public.safeguarding_case_attachments;
create trigger safeguard_attachments_no_delete before delete on public.safeguarding_case_attachments
for each row execute function public.prevent_safeguarding_record_delete();

-- Safeguarding must not leak through the ordinary child activity timeline.
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
        'title', case when incident.type = 'first_aid' then 'First aid'
          else coalesce(incident.details ->> 'category', 'Incident') end,
        'severity', coalesce(incident.details ->> 'severity', ''),
        'staffName', coalesce(profile.full_name, 'Après School team'),
        'siteName', coalesce(incident.details ->> 'siteName', location.name, ''),
        'sessionLabel', coalesce(incident.details ->> 'sessionLabel', ''),
        'outcome', coalesce(incident.details ->> 'outcome', ''),
        'actionTaken', coalesce(incident.details ->> 'actionTaken', ''),
        'followUpNotes', coalesce(incident.details ->> 'followUpNotes', ''),
        'summary', incident.summary,
        'restricted', false
      ) as item, coalesce(incident.occurred_at, incident.created_at) as sort_at
      from public.incidents incident
      left join public.profiles profile on profile.id = incident.reporter_id
      left join public.locations location on location.id = incident.location_id
      where incident.child_id = p_child_id
        and incident.sensitivity = 'standard'
        and incident.archived_at is null
    ) timeline
    order by timeline.sort_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) limited;

  return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke all on function public.staff_child_activity_timeline(uuid, integer) from public;
grant execute on function public.staff_child_activity_timeline(uuid, integer) to authenticated;
