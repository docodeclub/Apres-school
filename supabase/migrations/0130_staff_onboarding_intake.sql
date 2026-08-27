-- Secure, employee-completed onboarding intake. Evidence remains unverified
-- until an Admin or Superadmin reviews and approves the submission.

alter table public.profiles
  add column if not exists onboarding_only boolean not null default false;

create table if not exists public.staff_onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null unique references public.staff_records(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','submitted','changes_requested','approved')),
  personal_details jsonb not null default '{}'::jsonb,
  identity_documents jsonb not null default '{"documents":[]}'::jsonb,
  dbs_details jsonb not null default '{}'::jsonb,
  safeguarding_training jsonb not null default '{}'::jsonb,
  professional_details jsonb not null default '{}'::jsonb,
  references_details jsonb not null default '[]'::jsonb,
  annual_declarations jsonb not null default '{}'::jsonb,
  overseas_check jsonb not null default '{}'::jsonb,
  section_status jsonb not null default '{}'::jsonb,
  admin_review jsonb not null default '{}'::jsonb,
  signed_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_onboarding_status_idx
  on public.staff_onboarding_submissions(status, updated_at desc);

alter table public.staff_onboarding_submissions enable row level security;
grant select on public.staff_onboarding_submissions to authenticated;

drop policy if exists "staff onboarding owner read" on public.staff_onboarding_submissions;
create policy "staff onboarding owner read" on public.staff_onboarding_submissions for select to authenticated
using (
  public.current_user_owns_staff_record(staff_record_id)
  or public.current_user_app_role() in ('admin','superadmin')
);

-- Safely read a JSON boolean without allowing malformed draft values to abort saves.
create or replace function public.safe_jsonb_text_boolean(p_object jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_object->>p_key in ('true','false') then return (p_object->>p_key)::boolean; end if;
  return null;
end
$$;

create or replace function public.staff_onboarding_section_status(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  p jsonb := coalesce(p_payload->'personalDetails','{}'::jsonb);
  i jsonb := coalesce(p_payload->'identityDocuments','{}'::jsonb);
  d jsonb := coalesce(p_payload->'dbsDetails','{}'::jsonb);
  s jsonb := coalesce(p_payload->'safeguardingTraining','{}'::jsonb);
  pro jsonb := coalesce(p_payload->'professionalDetails','{}'::jsonb);
  r jsonb := coalesce(p_payload->'referencesDetails','[]'::jsonb);
  a jsonb := coalesce(p_payload->'annualDeclarations','{}'::jsonb);
  o jsonb := coalesce(p_payload->'overseasCheck','{}'::jsonb);
  docs jsonb := coalesce(i->'documents','[]'::jsonb);
  distinct_types integer;
begin
  select count(distinct value->>'type') into distinct_types from jsonb_array_elements(docs);
  return jsonb_build_object(
    'personal', nullif(btrim(p->>'legalName'),'') is not null
      and nullif(p->>'dateOfBirth','') is not null
      and nullif(btrim(p->>'email'),'') is not null
      and nullif(btrim(p->>'phone'),'') is not null
      and nullif(btrim(p->>'address'),'') is not null
      and nullif(btrim(p->>'nationality'),'') is not null
      and nullif(btrim(p->>'emergencyContactName'),'') is not null
      and nullif(btrim(p->>'emergencyContactPhone'),'') is not null,
    'identity', jsonb_array_length(docs) = 3
      and distinct_types = 3
      and coalesce((i->>'confirmed')::boolean,false)
      and not exists (select 1 from jsonb_array_elements(docs) x where nullif(x->>'type','') is null or nullif(x->>'path','') is null),
    'dbs', nullif(btrim(d->>'certificateNumber'),'') is not null
      and nullif(d->>'certificateDate','') is not null
      and (d->>'updateService') in ('yes','no'),
    'safeguarding', nullif(s->>'trainingLevel','') is not null
      and nullif(btrim(s->>'provider'),'') is not null
      and nullif(s->>'passDate','') is not null
      and nullif(s->>'certificatePath','') is not null
      and coalesce((s->>'kcsieConfirmed')::boolean,false)
      and coalesce((s->>'inductionConfirmed')::boolean,false),
    'professional', (pro->>'hasQts') in ('yes','no'),
    'references', jsonb_array_length(r) = 2
      and not exists (select 1 from jsonb_array_elements(r) x where nullif(btrim(x->>'name'),'') is null or nullif(btrim(x->>'email'),'') is null or nullif(x->>'type','') is null or nullif(btrim(x->>'relationship'),'') is null or nullif(btrim(x->>'knownFor'),'') is null),
    'declarations', coalesce((a->>'medicalFitness')::boolean,false)
      and coalesce((a->>'criminal')::boolean,false)
      and coalesce((a->>'childcareDisqualification')::boolean,false)
      and nullif(btrim(a->>'signature'),'') is not null,
    'overseas', (o->>'hasLivedOverseas') in ('yes','no')
      and ((o->>'hasLivedOverseas') = 'no' or nullif(btrim(o->>'details'),'') is not null)
  );
end
$$;

create or replace function public.save_my_staff_onboarding(p_payload jsonb, p_submit boolean default false)
returns public.staff_onboarding_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid := public.current_user_staff_record_id();
  v_record public.staff_onboarding_submissions;
  v_sections jsonb;
  v_complete boolean;
  v_now timestamptz := now();
begin
  if v_staff_id is null or not public.current_user_profile_active() then
    raise exception 'No active staff record is linked to this account.' using errcode = '42501';
  end if;
  select * into v_record from public.staff_onboarding_submissions where staff_record_id = v_staff_id for update;
  if v_record.id is null then
    insert into public.staff_onboarding_submissions(staff_record_id)
    values (v_staff_id) returning * into v_record;
  end if;
  if v_record.status in ('submitted','approved') then
    raise exception 'This onboarding record is awaiting or has completed review.';
  end if;
  v_sections := public.staff_onboarding_section_status(p_payload);
  select bool_and(value::boolean) into v_complete from jsonb_each(v_sections);
  if p_submit and not coalesce(v_complete,false) then
    raise exception 'Complete every required onboarding section before submitting.';
  end if;

  update public.staff_onboarding_submissions set
    personal_details = coalesce(p_payload->'personalDetails','{}'::jsonb),
    identity_documents = coalesce(p_payload->'identityDocuments','{"documents":[]}'::jsonb),
    dbs_details = coalesce(p_payload->'dbsDetails','{}'::jsonb),
    safeguarding_training = coalesce(p_payload->'safeguardingTraining','{}'::jsonb),
    professional_details = coalesce(p_payload->'professionalDetails','{}'::jsonb),
    references_details = coalesce(p_payload->'referencesDetails','[]'::jsonb),
    annual_declarations = coalesce(p_payload->'annualDeclarations','{}'::jsonb),
    overseas_check = coalesce(p_payload->'overseasCheck','{}'::jsonb),
    section_status = v_sections,
    status = case when p_submit then 'submitted' else 'draft' end,
    signed_at = case when p_submit then v_now else signed_at end,
    submitted_at = case when p_submit then v_now else submitted_at end,
    updated_at = v_now
  where id = v_record.id returning * into v_record;

  if p_submit then
    update public.scr_checks set
      identity_checks = jsonb_build_object('status','submitted_unverified','documents',v_record.identity_documents->'documents','confirmedAt',v_now),
      right_to_work = jsonb_build_object('status','submitted_unverified','primaryDocument',(v_record.identity_documents->'documents')->0,'confirmedAt',v_now),
      dbs = v_record.dbs_details || jsonb_build_object('status','submitted_unverified'),
      safeguarding = v_record.safeguarding_training || jsonb_build_object('status','submitted_unverified'),
      first_aid = coalesce(v_record.professional_details->'firstAid','{}'::jsonb) || jsonb_build_object('status','submitted_unverified'),
      annual_declarations = v_record.annual_declarations || jsonb_build_object('status','submitted_unverified','signedAt',v_now),
      recruitment_checks = coalesce(recruitment_checks,'{}'::jsonb) || jsonb_build_object('status','submitted_unverified','references',v_record.references_details,'overseas',v_record.overseas_check),
      admin_review = coalesce(admin_review,'{}'::jsonb) || jsonb_build_object('onboardingStatus','submitted','submittedAt',v_now),
      updated_at = v_now
    where staff_record_id = v_staff_id;
  end if;
  return v_record;
end
$$;
grant execute on function public.save_my_staff_onboarding(jsonb,boolean) to authenticated;

create or replace function public.review_staff_onboarding(p_submission_id uuid, p_decision text, p_note text default null)
returns public.staff_onboarding_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.staff_onboarding_submissions;
  v_profile_id uuid;
  v_now timestamptz := now();
begin
  if public.current_user_app_role() not in ('admin','superadmin') or not public.current_user_profile_active() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_decision not in ('approved','changes_requested') then raise exception 'Choose approve or request changes.'; end if;
  if p_decision = 'changes_requested' and char_length(btrim(coalesce(p_note,''))) < 3 then
    raise exception 'Explain what needs to be changed.';
  end if;
  select * into v_record from public.staff_onboarding_submissions where id = p_submission_id for update;
  if v_record.id is null or v_record.status <> 'submitted' then raise exception 'A submitted onboarding record was not found.'; end if;
  select profile_id into v_profile_id from public.staff_records where id = v_record.staff_record_id;
  update public.staff_onboarding_submissions set
    status = p_decision,
    admin_review = jsonb_build_object('decision',p_decision,'note',nullif(btrim(coalesce(p_note,'')),''),'reviewedAt',v_now),
    reviewed_at = v_now, reviewed_by = auth.uid(), updated_at = v_now
  where id = v_record.id returning * into v_record;
  update public.profiles set onboarding_only = (p_decision <> 'approved'), updated_at = v_now where id = v_profile_id;
  update public.scr_checks set admin_review = coalesce(admin_review,'{}'::jsonb) || jsonb_build_object('onboardingStatus',p_decision,'reviewedAt',v_now,'reviewedBy',auth.uid(),'note',nullif(btrim(coalesce(p_note,'')),'')), updated_at = v_now where staff_record_id = v_record.staff_record_id;
  return v_record;
end
$$;
grant execute on function public.review_staff_onboarding(uuid,text,text) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('staff-onboarding-evidence','staff-onboarding-evidence',false,10485760,
  array['application/pdf','image/png','image/jpeg','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "onboarding evidence owner upload" on storage.objects;
create policy "onboarding evidence owner upload" on storage.objects for insert to authenticated
with check (bucket_id='staff-onboarding-evidence' and (storage.foldername(name))[1]=public.current_user_staff_record_id()::text);

drop policy if exists "onboarding evidence scoped read" on storage.objects;
create policy "onboarding evidence scoped read" on storage.objects for select to authenticated
using (bucket_id='staff-onboarding-evidence' and ((storage.foldername(name))[1]=public.current_user_staff_record_id()::text or public.current_user_app_role() in ('admin','superadmin')));

drop policy if exists "onboarding evidence owner replace" on storage.objects;
create policy "onboarding evidence owner replace" on storage.objects for update to authenticated
using (bucket_id='staff-onboarding-evidence' and (storage.foldername(name))[1]=public.current_user_staff_record_id()::text)
with check (bucket_id='staff-onboarding-evidence' and (storage.foldername(name))[1]=public.current_user_staff_record_id()::text);

drop policy if exists "onboarding evidence owner cleanup" on storage.objects;
create policy "onboarding evidence owner cleanup" on storage.objects for delete to authenticated
using (bucket_id='staff-onboarding-evidence' and (storage.foldername(name))[1]=public.current_user_staff_record_id()::text);
