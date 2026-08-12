alter table public.enquiries
  add column if not exists submission_fingerprint text,
  add column if not exists classification text,
  add column if not exists duplicate_of uuid references public.enquiries(id) on delete set null,
  add column if not exists classified_at timestamptz,
  add column if not exists classified_by uuid references public.profiles(id) on delete set null;

alter table public.enquiries
  drop constraint if exists enquiries_classification_check;

alter table public.enquiries
  add constraint enquiries_classification_check
  check (classification is null or classification in ('duplicate', 'test', 'spam'));

create index if not exists enquiries_submission_fingerprint_created_idx
  on public.enquiries (submission_fingerprint, created_at desc)
  where submission_fingerprint is not null;

create or replace function public.accept_public_enquiry(
  p_name text,
  p_email text,
  p_organisation text,
  p_type text,
  p_subject text,
  p_role text,
  p_message text,
  p_submission_fingerprint text,
  p_window_seconds integer default 600
)
returns table (enquiry_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
  accepted_id uuid;
  bounded_window_seconds integer := least(greatest(coalesce(p_window_seconds, 600), 60), 1800);
begin
  if nullif(btrim(p_submission_fingerprint), '') is null then
    raise exception 'Submission fingerprint is required';
  end if;

  -- Serialize matching submissions so concurrent double-clicks cannot both insert.
  perform pg_advisory_xact_lock(hashtextextended(p_submission_fingerprint, 0));

  select enquiries.id
    into existing_id
    from public.enquiries
   where enquiries.submission_fingerprint = p_submission_fingerprint
     and enquiries.created_at >= now() - make_interval(secs => bounded_window_seconds)
   order by enquiries.created_at desc
   limit 1;

  if existing_id is not null then
    return query select existing_id, true;
    return;
  end if;

  insert into public.enquiries (
    name,
    email,
    organisation,
    type,
    subject,
    role,
    message,
    status,
    submission_fingerprint
  ) values (
    p_name,
    p_email,
    nullif(p_organisation, ''),
    p_type,
    nullif(p_subject, ''),
    nullif(p_role, ''),
    p_message,
    'new',
    p_submission_fingerprint
  )
  returning id into accepted_id;

  return query select accepted_id, false;
end;
$$;

revoke all on function public.accept_public_enquiry(text, text, text, text, text, text, text, text, integer) from public;
revoke all on function public.accept_public_enquiry(text, text, text, text, text, text, text, text, integer) from anon;
revoke all on function public.accept_public_enquiry(text, text, text, text, text, text, text, text, integer) from authenticated;
grant execute on function public.accept_public_enquiry(text, text, text, text, text, text, text, text, integer) to service_role;

comment on function public.accept_public_enquiry(text, text, text, text, text, text, text, text, integer)
  is 'Atomically accepts a public enquiry or returns the matching recent submission. Service role only.';

create or replace function public.classify_enquiry_record(
  p_enquiry_id uuid,
  p_expected_name text,
  p_expected_email text,
  p_expected_created_at timestamptz,
  p_classification text,
  p_duplicate_of uuid,
  p_note text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enquiry public.enquiries%rowtype;
  v_actor public.profiles%rowtype;
  v_now timestamptz := now();
  v_note text;
begin
  if p_classification not in ('duplicate', 'test', 'spam') then
    raise exception 'Unsupported enquiry classification';
  end if;

  select * into v_actor
    from public.profiles
   where id = p_actor_id
     and active = true
     and role in ('admin', 'superadmin');

  if not found then
    raise exception 'An active administrator is required for classification';
  end if;

  select * into v_enquiry
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'Enquiry not found';
  end if;

  if v_enquiry.name is distinct from p_expected_name
    or lower(v_enquiry.email) is distinct from lower(p_expected_email)
    or v_enquiry.created_at is distinct from p_expected_created_at
  then
    raise exception 'Enquiry identity did not match the verified record';
  end if;

  if v_enquiry.status <> 'new' or v_enquiry.classification is not null then
    raise exception 'Enquiry is no longer an unclassified New record';
  end if;

  if p_classification = 'duplicate' then
    if p_duplicate_of is null or p_duplicate_of = p_enquiry_id
      or not exists (select 1 from public.enquiries where id = p_duplicate_of)
    then
      raise exception 'A valid canonical enquiry is required for a duplicate';
    end if;
  elsif p_duplicate_of is not null then
    raise exception 'Only duplicates can reference a canonical enquiry';
  end if;

  v_note := concat_ws(
    E'\n\n',
    nullif(btrim(v_enquiry.internal_notes), ''),
    format(
      '[%s] Classified as %s by %s. %s',
      to_char(v_now at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI TZ'),
      p_classification,
      v_actor.full_name,
      btrim(p_note)
    )
  );

  update public.enquiries
     set status = 'closed',
         classification = p_classification,
         duplicate_of = p_duplicate_of,
         classified_at = v_now,
         classified_by = p_actor_id,
         internal_notes = v_note
   where id = p_enquiry_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    p_actor_id,
    'enquiry_classified_' || p_classification,
    'enquiries',
    p_enquiry_id,
    jsonb_build_object(
      'classification', p_classification,
      'duplicateOf', p_duplicate_of,
      'previousStatus', v_enquiry.status,
      'verifiedName', v_enquiry.name,
      'verifiedEmail', v_enquiry.email,
      'verifiedCreatedAt', v_enquiry.created_at,
      'reason', btrim(p_note),
      'source', 'crm-audit-2026-08-12'
    )
  );

  return jsonb_build_object(
    'id', p_enquiry_id,
    'status', 'closed',
    'classification', p_classification,
    'duplicateOf', p_duplicate_of,
    'classifiedAt', v_now
  );
end;
$$;

revoke all on function public.classify_enquiry_record(uuid, text, text, timestamptz, text, uuid, text, uuid) from public;
revoke all on function public.classify_enquiry_record(uuid, text, text, timestamptz, text, uuid, text, uuid) from anon;
revoke all on function public.classify_enquiry_record(uuid, text, text, timestamptz, text, uuid, text, uuid) from authenticated;
grant execute on function public.classify_enquiry_record(uuid, text, text, timestamptz, text, uuid, text, uuid) to service_role;

comment on function public.classify_enquiry_record(uuid, text, text, timestamptz, text, uuid, text, uuid)
  is 'Verifies, classifies and audits one exact New enquiry atomically. Service role only.';
