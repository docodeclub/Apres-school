-- Adds the identity evidence and the admin-confirmed checks supplied for
-- Josie Lally on 2 September 2026. Document numbers and home-address data are
-- intentionally kept out of source control; the source images are held only
-- in the private staff-hr-files bucket.

do $$
declare
  v_staff_record_id uuid := '142028ff-167d-4ddd-96e4-03e01902967f';
  v_passport_file_id uuid := 'e7ff6ec5-639a-4b6b-94f0-1ef4ed22bf6d';
  v_licence_file_id uuid := '5806ebaa-5bbc-4b52-a9ca-57fbe71b7401';
  v_passport_path text := '142028ff-167d-4ddd-96e4-03e01902967f/scr-evidence/right-to-work-passport-2026-09-02.png';
  v_licence_path text := '142028ff-167d-4ddd-96e4-03e01902967f/scr-evidence/identity-address-driving-licence-2026-09-02.jpg';
  v_checked_at date := date '2026-09-02';
  v_evidence jsonb;
  v_checklist jsonb;
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
    id, staff_record_id, category_id, title, storage_path, issue_date, expiry_date, status, notes
  )
  select
    v_passport_file_id,
    v_staff_record_id,
    category.id,
    'British passport — right-to-work evidence',
    v_passport_path,
    date '2020-02-12',
    date '2025-02-12',
    'active',
    'Private identity evidence reviewed by Admin on 2 September 2026. The passport establishes British citizenship and permanent right to work through a manual document check. The document itself is expired; no time limit applies to the recorded right to work. SHA-256: 2ddc42e008c27a206125f87fd6cfc6a05bd28064f0eb341bc21f79325528cae9'
  from public.hr_file_categories category
  where category.name = 'Right to Work'
  on conflict (id) do update set
    category_id = excluded.category_id,
    title = excluded.title,
    storage_path = excluded.storage_path,
    issue_date = excluded.issue_date,
    expiry_date = excluded.expiry_date,
    status = excluded.status,
    notes = excluded.notes,
    archived_at = null;

  insert into public.staff_hr_files (
    id, staff_record_id, category_id, title, storage_path, issue_date, expiry_date, status, notes
  )
  select
    v_licence_file_id,
    v_staff_record_id,
    category.id,
    'Driving licence — identity and address evidence',
    v_licence_path,
    date '2022-04-14',
    date '2032-04-13',
    'active',
    'Private photographic identity and address evidence reviewed by Admin on 2 September 2026. SHA-256: bb91f62df4008f3ebfb0ea60c580e5aeb333a494f14dc165846467e2960e1956'
  from public.hr_file_categories category
  where category.name = 'ID / Lanyard'
  on conflict (id) do update set
    category_id = excluded.category_id,
    title = excluded.title,
    storage_path = excluded.storage_path,
    issue_date = excluded.issue_date,
    expiry_date = excluded.expiry_date,
    status = excluded.status,
    notes = excluded.notes,
    archived_at = null;

  update public.scr_checks
  set
    right_to_work = coalesce(right_to_work, '{}'::jsonb) || jsonb_build_object(
      'checked', true,
      'status', 'Approved',
      'result', 'Permanent right to work',
      'citizenship', 'British citizen',
      'documentType', 'British passport',
      'documentExpired', true,
      'documentExpiryDate', '2025-02-12',
      'checkMethod', 'Manual original-document check',
      'dateSeen', v_checked_at,
      'checkedAt', v_checked_at,
      'verifiedAt', now(),
      'verifiedBy', 'Admin',
      'reference', 'British passport — right-to-work evidence',
      'fileId', v_passport_file_id,
      'storagePath', v_passport_path,
      'continuousStatutoryExcuse', true
    ),
    identity_checks = coalesce(identity_checks, '{}'::jsonb) || jsonb_build_object(
      'checked', true,
      'status', 'Approved',
      'identityVerified', true,
      'addressVerified', true,
      'residencyVerified', true,
      'documentType', 'UK driving licence',
      'dateSeen', v_checked_at,
      'checkedAt', v_checked_at,
      'expiryDate', '2032-04-13',
      'verifiedAt', now(),
      'verifiedBy', 'Admin',
      'reference', 'Driving licence — identity and address evidence',
      'fileId', v_licence_file_id,
      'storagePath', v_licence_path
    ),
    dbs = coalesce(dbs, '{}'::jsonb) || jsonb_build_object(
      'checked', true,
      'status', 'Approved',
      'result', 'Clear',
      'originalCertificateSeen', true,
      'originalSeenAt', v_checked_at,
      'dateSeen', v_checked_at,
      'lastCheckedAt', v_checked_at,
      'verifiedAt', now(),
      'verifiedBy', 'Admin'
    ),
    safeguarding = coalesce(safeguarding, '{}'::jsonb) || jsonb_build_object(
      'checked', true,
      'status', 'Approved',
      'kcsiePartOneRead', true,
      'kcsieAcknowledgedAt', v_checked_at,
      'companyPoliciesRead', true,
      'companyPoliciesAcknowledgedAt', v_checked_at,
      'dateSeen', v_checked_at,
      'lastConfirmedAt', v_checked_at,
      'verifiedAt', now(),
      'verifiedBy', 'Admin'
    ),
    first_aid = coalesce(first_aid, '{}'::jsonb) || jsonb_build_object(
      'checked', false,
      'status', 'Not held',
      'qualificationHeld', false,
      'confirmedAt', v_checked_at,
      'verifiedAt', now(),
      'verifiedBy', 'Admin'
    ),
    annual_declarations = coalesce(annual_declarations, '{}'::jsonb) || jsonb_build_object(
      'checked', true,
      'status', 'Approved',
      'annualDeclarationDate', v_checked_at,
      'declaredAt', v_checked_at,
      'declarationType', 'Annual suitability declaration',
      'verifiedAt', now(),
      'verifiedBy', 'Admin'
    ),
    admin_review = (
      coalesce(admin_review, '{}'::jsonb)
      || jsonb_build_object(
        'status', 'Review needed',
        'allergy', coalesce(admin_review -> 'allergy', '{}'::jsonb) || jsonb_build_object(
          'checked', true,
          'status', 'Passed',
          'completedAt', v_checked_at,
          'dateSeen', v_checked_at,
          'verifiedAt', now(),
          'verifiedBy', 'Admin',
          'reference', 'Allergy awareness declaration — passed 2 September 2026'
        ),
        'updatedAt', now()
      )
    ),
    updated_at = now()
  where staff_record_id = v_staff_record_id;

  select
    coalesce(admin_review -> 'evidence', '{}'::jsonb)
    || jsonb_build_object(
      'rightToWork', right_to_work,
      'identity', identity_checks,
      'dbs', dbs,
      'safeguarding', safeguarding,
      'allergy', admin_review -> 'allergy',
      'firstAid', first_aid,
      'declarations', annual_declarations
    ),
    coalesce(admin_review -> 'checklist', '{}'::jsonb)
  into v_evidence, v_checklist
  from public.scr_checks
  where staff_record_id = v_staff_record_id;

  v_checklist := v_checklist || jsonb_build_object(
    'rightToWork', true,
    'identity', true,
    'dbs', true,
    'barredList', true,
    'safeguarding', true,
    'allergy', true,
    'firstAid', false,
    'declarations', true,
    'evidence', v_evidence,
    'note', 'Identity, address, residency and right-to-work evidence checked 2 September 2026. Original DBS seen and confirmed clear. KCSIE and company policies acknowledged. Allergy awareness passed. Annual suitability declared. First aid is not held.',
    'updatedAt', now()
  );

  update public.scr_checks
  set
    admin_review = coalesce(admin_review, '{}'::jsonb) || jsonb_build_object(
      'status', 'Review needed',
      'checklist', v_checklist,
      'evidence', v_evidence,
      'note', v_checklist ->> 'note',
      'updatedAt', now()
    ),
    updated_at = now()
  where staff_record_id = v_staff_record_id;

  if not exists (
    select 1
    from public.audit_log
    where action = 'scr_admin_checks_recorded'
      and record_id = v_staff_record_id
      and metadata ->> 'checkedAt' = v_checked_at::text
  ) then
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (
      null,
      'scr_admin_checks_recorded',
      'scr_checks',
      v_staff_record_id,
      jsonb_build_object(
        'checkedAt', v_checked_at,
        'checksRecorded', jsonb_build_array(
          'right_to_work', 'identity', 'address', 'residency', 'dbs_original_seen_clear',
          'kcsie', 'company_policies', 'allergy_awareness', 'annual_suitability', 'first_aid_not_held'
        ),
        'privateEvidenceFileIds', jsonb_build_array(v_passport_file_id, v_licence_file_id)
      )
    );
  end if;
end;
$$;
