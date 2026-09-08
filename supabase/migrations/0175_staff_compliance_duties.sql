-- Let reviewers record N/A against any checklist row while ensuring that
-- training and checks driven by the employee's actual duties are completed.

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
  v_expected jsonb := jsonb_build_object(
    'recruitment', jsonb_build_array('applicationForm','identityChecked','rightToWork','qualifications','employmentHistory','employmentGaps','referencesRequested','referencesReceived','discrepanciesResolved'),
    'dbs', jsonb_build_array('dbsApplication','dbsCertificate','barredList','dbsDetailsRecorded','updateServiceInstruction','updateServiceConfirmed','prohibitionChecks'),
    'employment', jsonb_build_array('offerConfirmed','startDate','contractIssued','contractSigned','payConfirmed','hoursConfirmed','locationsConfirmed','payrollCollected','pensionProcessed','emergencyContact'),
    'coreTraining', jsonb_build_array('safeguardingTraining','foodHygiene','allergyAwareness','companyInduction','safeguardingProcedures','policiesAcknowledged'),
    'systems', jsonb_build_array('accountCreated','permissionsAssigned','schoolsAssigned','rotaAdded','companyEmail','equipmentIssued','systemAccessExplained')
  );
  v_school_expected text[] := array['schoolAssigned','safeguardingRequirements','policiesIssued','policiesAcknowledged','schoolTraining','siteInduction','emergencyProcedures','collectionProcedures','medicalProcedures','assuranceLetter','complianceInformation','additionalRequirements'];
  v_works_with_children boolean := coalesce((p_checklist->'workAreas'->>'worksWithChildren')::boolean, false)
    or coalesce((p_checklist->'workAreas'->>'coachesSport')::boolean, false);
  v_handles_food boolean := coalesce((p_checklist->'workAreas'->>'handlesFood')::boolean, false);
  v_coaches_sport boolean := coalesce((p_checklist->'workAreas'->>'coachesSport')::boolean, false);
begin
  if jsonb_typeof(coalesce(p_checklist->'employee','{}'::jsonb)) <> 'object'
     or nullif(btrim(p_checklist->'employee'->>'role'),'') is null
     or nullif(p_checklist->'employee'->>'startDate','') is null
     or jsonb_typeof(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) = 0 then
    return false;
  end if;

  -- Every general row must be explicitly decided, including rows for which
  -- the reviewer has selected Not applicable.
  for v_group, v_key in
    select group_row.key, item.value
    from jsonb_each(v_expected) group_row
    cross join lateral jsonb_array_elements_text(group_row.value) item
  loop
    if coalesce(p_checklist->'items'->v_group->>v_key,'') not in ('complete','not_applicable') then return false; end if;
  end loop;

  if v_works_with_children then
    foreach v_key in array array['dbsApplication','dbsCertificate','dbsDetailsRecorded'] loop
      if coalesce(p_checklist->'items'->'dbs'->>v_key,'') <> 'complete' then return false; end if;
    end loop;
    foreach v_key in array array['safeguardingTraining','companyInduction','safeguardingProcedures','policiesAcknowledged'] loop
      if coalesce(p_checklist->'items'->'coreTraining'->>v_key,'') <> 'complete' then return false; end if;
    end loop;
    if coalesce(p_checklist->'items'->'ascTraining'->>'paediatricFirstAid','') <> 'complete' then return false; end if;
  end if;

  if v_handles_food then
    foreach v_key in array array['foodHygiene','allergyAwareness'] loop
      if coalesce(p_checklist->'items'->'coreTraining'->>v_key,'') <> 'complete' then return false; end if;
    end loop;
  end if;

  if v_coaches_sport and coalesce(p_checklist->'items'->'recruitment'->>'qualifications','') <> 'complete' then return false; end if;

  if (p_checklist->'employee'->>'role') ~* '(manager|lead)' then
    foreach v_key in array array['safeguardingLead','senTraining','inclusionTraining','paediatricFirstAid','managerProcedures'] loop
      if coalesce(p_checklist->'items'->'managerTraining'->>v_key,'') <> 'complete' then return false; end if;
    end loop;
  end if;

  if jsonb_typeof(coalesce(p_checklist->'schoolChecks','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_checklist->'schoolChecks','[]'::jsonb))
        <> jsonb_array_length(coalesce(p_checklist->'employee'->'schools','[]'::jsonb)) then return false; end if;
  for v_school in select value from jsonb_array_elements(p_checklist->'schoolChecks') loop
    if nullif(btrim(v_school->>'school'),'') is null then return false; end if;
    foreach v_key in array v_school_expected loop
      if coalesce(v_school->'items'->>v_key,'') not in ('complete','not_applicable') then return false; end if;
    end loop;
  end loop;
  return true;
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.admin_staff_compliance_complete(jsonb) from public, anon, authenticated;
grant execute on function public.admin_staff_compliance_complete(jsonb) to service_role;
