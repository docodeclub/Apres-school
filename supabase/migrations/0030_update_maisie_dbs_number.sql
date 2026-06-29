-- Adds Maisie Marsden's enhanced DBS certificate number to the SCR.
-- Source: user-confirmed DBS details supplied 29 June 2026.
-- Certificate number: 001933289972
-- Issue date: 22 July 2025

with maisie as (
  select staff_records.id as staff_record_id
  from public.staff_records
  left join public.profiles on profiles.id = staff_records.profile_id
  where staff_records.archived_at is null
    and (
      lower(coalesce(profiles.full_name, '')) like '%maisie%'
      or lower(coalesce(staff_records.preferred_name, '')) like '%maisie%'
      or lower(coalesce(profiles.email, '')) like '%maisiejmarsden%'
    )
    and (
      lower(coalesce(profiles.full_name, '') || ' ' || coalesce(staff_records.preferred_name, '') || ' ' || coalesce(profiles.email, '')) like '%marsden%'
      or lower(coalesce(profiles.email, '')) like '%maisiejmarsden%'
    )
  order by staff_records.created_at desc
  limit 1
),
updated_checks as (
  update public.scr_checks
  set
    dbs = coalesce(public.scr_checks.dbs, '{}'::jsonb)
      || jsonb_build_object(
        'number', '001933289972',
        'dbsNumber', '001933289972',
        'certificateNo', '001933289972',
        'applicationType', 'Enhanced',
        'issueDate', '2025-07-22',
        'date', '2025-07-22',
        'result', 'Clear',
        'status', 'Approved',
        'workingWithAdults', false,
        'workingWithChildren', true,
        'source', 'Manual DBS entry 29 June 2026',
        'sourceName', 'Maisie Marsden'
      ),
    admin_review = coalesce(public.scr_checks.admin_review, '{}'::jsonb)
      || jsonb_build_object(
        'checklist',
        coalesce(public.scr_checks.admin_review -> 'checklist', '{}'::jsonb)
          || jsonb_build_object(
            'dbs', true,
            'dbsNumber', '001933289972',
            'evidence',
            coalesce(public.scr_checks.admin_review #> '{checklist,evidence}', '{}'::jsonb)
              || jsonb_build_object(
                'dbs',
                coalesce(public.scr_checks.admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                  || jsonb_build_object(
                    'status', 'Approved',
                    'number', '001933289972',
                    'dbsNumber', '001933289972',
                    'certificateNo', '001933289972',
                    'reference', 'Manual DBS entry 29 June 2026',
                    'verifiedAt', now(),
                    'verifiedBy', 'Admin',
                    'issueDate', '2025-07-22',
                    'sourceName', 'Maisie Marsden'
                  )
              )
          )
      ),
    updated_at = now()
  from maisie
  where public.scr_checks.staff_record_id = maisie.staff_record_id
  returning public.scr_checks.staff_record_id
)
insert into public.scr_checks (
  staff_record_id,
  dbs,
  admin_review,
  updated_at
)
select
  maisie.staff_record_id,
  jsonb_build_object(
    'number', '001933289972',
    'dbsNumber', '001933289972',
    'certificateNo', '001933289972',
    'applicationType', 'Enhanced',
    'issueDate', '2025-07-22',
    'date', '2025-07-22',
    'result', 'Clear',
    'status', 'Approved',
    'workingWithAdults', false,
    'workingWithChildren', true,
    'source', 'Manual DBS entry 29 June 2026',
    'sourceName', 'Maisie Marsden'
  ),
  jsonb_build_object(
    'checklist',
    jsonb_build_object(
      'dbs', true,
      'dbsNumber', '001933289972',
      'evidence',
      jsonb_build_object(
        'dbs',
        jsonb_build_object(
          'status', 'Approved',
          'number', '001933289972',
          'dbsNumber', '001933289972',
          'certificateNo', '001933289972',
          'reference', 'Manual DBS entry 29 June 2026',
          'verifiedAt', now(),
          'verifiedBy', 'Admin',
          'issueDate', '2025-07-22',
          'sourceName', 'Maisie Marsden'
        )
      )
    )
  ),
  now()
from maisie
where not exists (
  select 1
  from updated_checks
  where updated_checks.staff_record_id = maisie.staff_record_id
);
