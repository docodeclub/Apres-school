-- A structured, auditable admin checklist for taking a new employee from
-- application through to final clearance. Employee-supplied onboarding data
-- remains separate and unverified until an Admin records each compliance step.

alter table public.staff_onboarding_submissions
  add column if not exists compliance_checklist jsonb not null default '{}'::jsonb,
  add column if not exists cleared_to_work_at timestamptz,
  add column if not exists cleared_to_work_by uuid references public.profiles(id) on delete set null;

create or replace function public.admin_staff_compliance_complete(p_checklist jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_group text;
  v_key text;
  v_school jsonb;
  v_required jsonb := jsonb_build_object(
    'recruitment', jsonb_build_array('applicationForm','identityChecked','rightToWork','employmentHistory','employmentGaps','referencesRequested','referencesReceived'),
    'dbs', jsonb_build_array('dbsApplication','dbsCertificate','dbsDetailsRecorded','updateServiceInstruction','updateServiceConfirmed'),
    'employment', jsonb_build_array('offerConfirmed','startDate','contractIssued','contractSigned','payConfirmed','hoursConfirmed','locationsConfirmed','payrollCollected','pensionProcessed','emergencyContact'),
    'coreTraining', jsonb_build_array('safeguardingTraining','foodHygiene','allergyAwareness','companyInduction','safeguardingProcedures','policiesAcknowledged'),
    'systems', jsonb_build_array('accountCreated','permissionsAssigned','schoolsAssigned','rotaAdded','systemAccessExplained')
  );
  v_school_required text[] := array['schoolAssigned','safeguardingRequirements','policiesIssued','policiesAcknowledged','siteInduction','emergencyProcedures','collectionProcedures','medicalProcedures','assuranceLetter','complianceInformation','additionalRequirements'];
begin
  if jsonb_typeof(coalesce(p_checklist->'employee','{}'::jsonb)) <> 'object'
     or nullif(btrim(p_checklist->'employee'->>'role'),'') is null
     or nullif(p_checklist->'employee'->>'startDate','') is null
     or jsonb_typeof(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) = 0 then
    return false;
  end if;

  for v_group, v_key in
    select group_row.key, item.value
    from jsonb_each(v_required) group_row
    cross join lateral jsonb_array_elements_text(group_row.value) item
  loop
    if coalesce(p_checklist->'items'->v_group->>v_key,'') <> 'complete' then return false; end if;
  end loop;

  -- Conditional checks may be explicitly recorded as not applicable, but may
  -- never be left outstanding or omitted at final clearance.
  for v_group, v_key in
    values
      ('recruitment','qualifications'),('recruitment','discrepanciesResolved'),
      ('dbs','barredList'),('dbs','prohibitionChecks'),
      ('systems','companyEmail'),('systems','equipmentIssued')
  loop
    if coalesce(p_checklist->'items'->v_group->>v_key,'') not in ('complete','not_applicable') then return false; end if;
  end loop;

  if coalesce((p_checklist->'workAreas'->>'afterSchool')::boolean,false)
     and coalesce(p_checklist->'items'->'ascTraining'->>'paediatricFirstAid','') <> 'complete' then return false; end if;

  if coalesce((p_checklist->'workAreas'->>'manager')::boolean,false) then
    foreach v_key in array array['safeguardingLead','senTraining','inclusionTraining','paediatricFirstAid','managerProcedures'] loop
      if coalesce(p_checklist->'items'->'managerTraining'->>v_key,'') <> 'complete' then return false; end if;
    end loop;
  end if;

  if jsonb_typeof(coalesce(p_checklist->'schoolChecks','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_checklist->'schoolChecks','[]'::jsonb))
        <> jsonb_array_length(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) then return false; end if;
  for v_school in select value from jsonb_array_elements(p_checklist->'schoolChecks') loop
    if nullif(btrim(v_school->>'school'),'') is null then return false; end if;
    foreach v_key in array v_school_required loop
      if coalesce(v_school->'items'->>v_key,'') not in ('complete','not_applicable') then return false; end if;
    end loop;
    if coalesce(v_school->'items'->>'schoolAssigned','') <> 'complete'
       or coalesce(v_school->'items'->>'safeguardingRequirements','') <> 'complete'
       or coalesce(v_school->'items'->>'policiesIssued','') <> 'complete'
       or coalesce(v_school->'items'->>'policiesAcknowledged','') <> 'complete'
       or coalesce(v_school->'items'->>'emergencyProcedures','') <> 'complete'
       or coalesce(v_school->'items'->>'collectionProcedures','') <> 'complete'
       or coalesce(v_school->'items'->>'medicalProcedures','') <> 'complete'
       or coalesce(v_school->'items'->>'assuranceLetter','') <> 'complete'
       or coalesce(v_school->'items'->>'complianceInformation','') <> 'complete' then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.admin_staff_compliance_complete(jsonb) from public, anon, authenticated;
grant execute on function public.admin_staff_compliance_complete(jsonb) to service_role;

create or replace function public.save_admin_staff_compliance_checklist(
  p_submission_id uuid,
  p_checklist jsonb,
  p_clear_to_work boolean default false
)
returns public.staff_onboarding_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.staff_onboarding_submissions;
  v_now timestamptz := now();
begin
  if public.current_user_app_role() not in ('admin','superadmin') or not public.current_user_profile_active() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_checklist,'{}'::jsonb)) <> 'object' then raise exception 'A valid checklist is required.'; end if;
  select * into v_record from public.staff_onboarding_submissions where id=p_submission_id for update;
  if v_record.id is null then raise exception 'Onboarding record not found.'; end if;
  if p_clear_to_work and not public.admin_staff_compliance_complete(p_checklist) then
    raise exception 'Complete every mandatory compliance item before clearing this employee to work.';
  end if;
  update public.staff_onboarding_submissions set
    compliance_checklist=p_checklist,
    cleared_to_work_at=case when p_clear_to_work then v_now else cleared_to_work_at end,
    cleared_to_work_by=case when p_clear_to_work then auth.uid() else cleared_to_work_by end,
    admin_review=coalesce(admin_review,'{}'::jsonb)||jsonb_build_object(
      'complianceUpdatedAt',v_now,'complianceUpdatedBy',auth.uid(),
      'clearedToWork',case when p_clear_to_work then true else cleared_to_work_at is not null end
    ),
    updated_at=v_now
  where id=p_submission_id returning * into v_record;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),case when p_clear_to_work then 'staff_cleared_to_work' else 'staff_compliance_checklist_saved' end,
    'staff_onboarding_submissions',v_record.id,jsonb_build_object('staffRecordId',v_record.staff_record_id,'complete',public.admin_staff_compliance_complete(p_checklist)));
  return v_record;
end;
$$;

revoke all on function public.save_admin_staff_compliance_checklist(uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_admin_staff_compliance_checklist(uuid,jsonb,boolean) to authenticated;

-- Approval unlocks normal staff access, so it must never precede final clearance.
create or replace function public.require_staff_clearance_before_approval()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='approved' and old.status is distinct from 'approved' and new.cleared_to_work_at is null then
    raise exception 'Complete the compliance checklist and clear this employee to work before approval.';
  end if;
  return new;
end $$;

drop trigger if exists require_staff_clearance_before_approval on public.staff_onboarding_submissions;
create trigger require_staff_clearance_before_approval before update of status on public.staff_onboarding_submissions
for each row execute function public.require_staff_clearance_before_approval();

