-- Records Josie Lally's employer-issued pre-employment vetting assurance.
-- Source document: Josie 2.pdf, signed 3 March 2025.
-- The private source file is stored in staff-hr-files and its content hash is
-- retained here so the evidence can be matched without storing personal data.

do $$
declare
  v_staff_record_id uuid := '142028ff-167d-4ddd-96e4-03e01902967f';
  v_file_id uuid := '8aa5a0e6-57d3-4dca-9e16-416ee34d7a93';
  v_storage_path text := '142028ff-167d-4ddd-96e4-03e01902967f/scr-evidence/pre-employment-vetting-assurance-2025-03-03.pdf';
  v_source text := 'Employer pre-employment vetting assurance signed 3 March 2025';
  v_source_hash text := 'f6a267593f26b4640ba53f4bd6f884a8d6ba769c68333ec92d7c7a19c388f25f';
  v_dbs jsonb;
  v_identity jsonb;
  v_right_to_work jsonb;
  v_safeguarding jsonb;
  v_recruitment jsonb;
  v_checklist jsonb;
  v_evidence jsonb;
begin
  if not exists (
    select 1
    from public.staff_records sr
    join public.profiles p on p.id = sr.profile_id
    where sr.id = v_staff_record_id
      and lower(p.email) = 'josielally04@gmail.com'
      and sr.archived_at is null
      and sr.left_at is null
  ) then
    raise exception 'Active Josie Lally staff record could not be matched safely';
  end if;

  insert into public.staff_hr_files (
    id,
    staff_record_id,
    category_id,
    title,
    storage_path,
    issue_date,
    status,
    notes
  )
  select
    v_file_id,
    v_staff_record_id,
    category.id,
    'Pre-employment vetting assurance',
    v_storage_path,
    date '2025-03-03',
    'active',
    'Restricted employer assurance covering identity, right to work, qualifications, references, DBS and barred-list checks, safeguarding and Prevent training, medical fitness, overseas-check applicability and the prohibition check. SHA-256: ' || v_source_hash
  from public.hr_file_categories category
  where category.name = 'DBS'
  on conflict (id) do update set
    category_id = excluded.category_id,
    title = excluded.title,
    storage_path = excluded.storage_path,
    issue_date = excluded.issue_date,
    status = excluded.status,
    notes = excluded.notes,
    archived_at = null;

  v_right_to_work := jsonb_build_object(
    'checked', true,
    'status', 'Approved',
    'checkedAt', '2024-03-28',
    'nationality', 'British',
    'reference', v_source,
    'fileId', v_file_id,
    'storagePath', v_storage_path,
    'verifiedAt', now(),
    'verifiedBy', 'Admin'
  );

  v_identity := jsonb_build_object(
    'checked', true,
    'status', 'Approved',
    'checkedAt', '2024-03-28',
    'addressVerified', true,
    'reference', v_source,
    'fileId', v_file_id,
    'storagePath', v_storage_path,
    'verifiedAt', now(),
    'verifiedBy', 'Admin'
  );

  v_dbs := jsonb_build_object(
    'checked', true,
    'status', 'Approved',
    'result', 'Clear',
    'applicationType', 'Enhanced',
    'number', '001902110211',
    'dbsNumber', '001902110211',
    'certificateNo', '001902110211',
    'registeredBody', 'Care Check',
    'issueDate', '2024-11-06',
    'clearedDate', '2024-11-06',
    'barredList', true,
    'barredListStatus', 'Clear',
    'workingWithChildren', true,
    'workingWithAdults', false,
    'reference', v_source,
    'fileId', v_file_id,
    'storagePath', v_storage_path,
    'verifiedAt', now(),
    'verifiedBy', 'Admin'
  );

  v_safeguarding := jsonb_build_object(
    'checked', true,
    'status', 'Approved',
    'completedAt', '2024-03-28',
    'includesPrevent', true,
    'reference', v_source,
    'fileId', v_file_id,
    'storagePath', v_storage_path,
    'verifiedAt', now(),
    'verifiedBy', 'Admin'
  );

  v_recruitment := jsonb_build_object(
    'references', true,
    'referencesStatus', 'Approved',
    'referencesCount', 2,
    'referencesCoverageYears', 5,
    'faceToFaceInterview', true,
    'qualificationsChecked', true,
    'qualificationsCheckedAt', '2024-03-28',
    'medicalFitnessDeclared', true,
    'medicalFitnessCheckedAt', '2024-03-28',
    'overseasChecksRequired', false,
    'overseasChecksStatus', 'Not required',
    'overseasChecksReviewedAt', '2024-03-28',
    'prohibitionCheckStatus', 'Clear',
    'prohibitionCheckReviewedAt', '2024-03-28',
    'reference', v_source,
    'fileId', v_file_id,
    'storagePath', v_storage_path,
    'verifiedAt', now(),
    'verifiedBy', 'Admin'
  );

  v_evidence := jsonb_build_object(
    'rightToWork', v_right_to_work,
    'identity', v_identity,
    'dbs', v_dbs,
    'barredList', jsonb_build_object(
      'status', 'Clear', 'checkedAt', '2024-11-06', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'safeguarding', v_safeguarding,
    'references', jsonb_build_object(
      'status', 'Approved', 'minimumReferences', 2, 'coverageYears', 5, 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'qualifications', jsonb_build_object(
      'status', 'Approved', 'checkedAt', '2024-03-28', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'medicalFitness', jsonb_build_object(
      'status', 'Approved', 'checkedAt', '2024-03-28', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'overseasChecks', jsonb_build_object(
      'status', 'Not required', 'reviewedAt', '2024-03-28', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'prohibitionCheck', jsonb_build_object(
      'status', 'Clear', 'reviewedAt', '2024-03-28', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    ),
    'interview', jsonb_build_object(
      'status', 'Completed', 'method', 'Face to face', 'reference', v_source,
      'fileId', v_file_id, 'storagePath', v_storage_path, 'verifiedAt', now(), 'verifiedBy', 'Admin'
    )
  );

  v_checklist := jsonb_build_object(
    'rightToWork', true,
    'identity', true,
    'dbs', true,
    'dbsNumber', '001902110211',
    'barredList', true,
    'safeguarding', true,
    'references', true,
    'qualifications', true,
    'medicalFitness', true,
    'overseasChecks', true,
    'prohibitionCheck', true,
    'interview', true,
    'evidence', v_evidence,
    'note', 'Pre-employment vetting assurance recorded. First aid, allergy awareness, annual declarations and training expiry dates were not evidenced by this document and have not been inferred.',
    'updatedAt', now()
  );

  insert into public.scr_checks (
    staff_record_id,
    right_to_work,
    identity_checks,
    dbs,
    safeguarding,
    recruitment_checks,
    admin_review,
    updated_at
  ) values (
    v_staff_record_id,
    v_right_to_work,
    v_identity,
    v_dbs,
    v_safeguarding,
    v_recruitment,
    jsonb_build_object(
      'status', 'Review needed',
      'checklist', v_checklist,
      'evidence', v_evidence,
      'note', v_checklist ->> 'note',
      'updatedAt', now()
    ),
    now()
  )
  on conflict (staff_record_id) do update set
    right_to_work = coalesce(public.scr_checks.right_to_work, '{}'::jsonb) || excluded.right_to_work,
    identity_checks = coalesce(public.scr_checks.identity_checks, '{}'::jsonb) || excluded.identity_checks,
    dbs = coalesce(public.scr_checks.dbs, '{}'::jsonb) || excluded.dbs,
    safeguarding = coalesce(public.scr_checks.safeguarding, '{}'::jsonb) || excluded.safeguarding,
    recruitment_checks = coalesce(public.scr_checks.recruitment_checks, '{}'::jsonb) || excluded.recruitment_checks,
    admin_review = coalesce(public.scr_checks.admin_review, '{}'::jsonb) || excluded.admin_review,
    updated_at = now();

  if not exists (
    select 1
    from public.audit_log
    where action = 'scr_vetting_evidence_recorded'
      and record_id = v_staff_record_id
      and metadata ->> 'sourceHash' = v_source_hash
  ) then
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (
      null,
      'scr_vetting_evidence_recorded',
      'scr_checks',
      v_staff_record_id,
      jsonb_build_object(
        'sourceTitle', 'Pre-employment vetting assurance',
        'sourceDate', '2025-03-03',
        'sourceHash', v_source_hash,
        'privateFileId', v_file_id,
        'checksRecorded', jsonb_build_array(
          'identity', 'right_to_work', 'qualifications', 'references', 'dbs',
          'barred_list', 'safeguarding_prevent', 'medical_fitness',
          'overseas_checks_not_required', 'prohibition_check_clear', 'interview'
        )
      )
    );
  end if;
end;
$$;
