-- Adds Rama Singh's enhanced DBS certificate number to the SCR.
-- Source: user-confirmed DBS certificate number supplied 29 June 2026.
-- Certificate number: 001891733439

with rama as (
  select staff_records.id as staff_record_id
  from public.staff_records
  left join public.profiles on profiles.id = staff_records.profile_id
  where staff_records.archived_at is null
    and (
      lower(coalesce(profiles.full_name, '')) like '%rama%'
      or lower(coalesce(staff_records.preferred_name, '')) like '%rama%'
      or lower(coalesce(profiles.email, '')) like '%ramasingh%'
    )
    and (
      lower(coalesce(profiles.full_name, '') || ' ' || coalesce(staff_records.preferred_name, '') || ' ' || coalesce(profiles.email, '')) like '%singh%'
      or lower(coalesce(profiles.email, '')) like '%ramasingh%'
    )
  order by staff_records.created_at desc
  limit 1
),
updated_checks as (
  update public.scr_checks
  set
    dbs = coalesce(public.scr_checks.dbs, '{}'::jsonb)
      || jsonb_build_object(
        'number', '001891733439',
        'dbsNumber', '001891733439',
        'certificateNo', '001891733439',
        'applicationType', 'Enhanced',
        'result', 'Clear',
        'status', 'Approved',
        'workingWithAdults', false,
        'workingWithChildren', true,
        'source', 'Manual DBS entry 29 June 2026',
        'sourceName', 'Rama Singh'
      ),
    admin_review = coalesce(public.scr_checks.admin_review, '{}'::jsonb)
      || jsonb_build_object(
        'checklist',
        coalesce(public.scr_checks.admin_review -> 'checklist', '{}'::jsonb)
          || jsonb_build_object(
            'dbs', true,
            'dbsNumber', '001891733439',
            'evidence',
            coalesce(public.scr_checks.admin_review #> '{checklist,evidence}', '{}'::jsonb)
              || jsonb_build_object(
                'dbs',
                coalesce(public.scr_checks.admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                  || jsonb_build_object(
                    'status', 'Approved',
                    'number', '001891733439',
                    'dbsNumber', '001891733439',
                    'certificateNo', '001891733439',
                    'reference', 'Manual DBS entry 29 June 2026',
                    'verifiedAt', now(),
                    'verifiedBy', 'Admin',
                    'sourceName', 'Rama Singh'
                  )
              )
          )
      ),
    updated_at = now()
  from rama
  where public.scr_checks.staff_record_id = rama.staff_record_id
  returning public.scr_checks.staff_record_id
)
insert into public.scr_checks (
  staff_record_id,
  dbs,
  admin_review,
  updated_at
)
select
  rama.staff_record_id,
  jsonb_build_object(
    'number', '001891733439',
    'dbsNumber', '001891733439',
    'certificateNo', '001891733439',
    'applicationType', 'Enhanced',
    'result', 'Clear',
    'status', 'Approved',
    'workingWithAdults', false,
    'workingWithChildren', true,
    'source', 'Manual DBS entry 29 June 2026',
    'sourceName', 'Rama Singh'
  ),
  jsonb_build_object(
    'checklist',
    jsonb_build_object(
      'dbs', true,
      'dbsNumber', '001891733439',
      'evidence',
      jsonb_build_object(
        'dbs',
        jsonb_build_object(
          'status', 'Approved',
          'number', '001891733439',
          'dbsNumber', '001891733439',
          'certificateNo', '001891733439',
          'reference', 'Manual DBS entry 29 June 2026',
          'verifiedAt', now(),
          'verifiedBy', 'Admin',
          'sourceName', 'Rama Singh'
        )
      )
    )
  ),
  now()
from rama
where not exists (
  select 1
  from updated_checks
  where updated_checks.staff_record_id = rama.staff_record_id
);
