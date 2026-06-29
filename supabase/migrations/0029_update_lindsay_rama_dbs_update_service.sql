-- Adds Lindsay's enhanced DBS certificate number and records DBS Update Service
-- status for Lindsay and Rama.
-- Source: user-confirmed DBS details supplied 29 June 2026.

with dbs_updates (
  name_label,
  name_terms,
  email_terms,
  certificate_no,
  source_label
) as (
  values
    ('Lindsay', array['lindsay'], array['lindsay@apres-school.co.uk'], '001584217388', 'Manual DBS entry 29 June 2026'),
    ('Rama Singh', array['rama','singh'], array['ramasingh_uk@yahoo.com'], '001891733439', 'Manual DBS entry 29 June 2026')
),
matched_staff as (
  select
    dbs_updates.*,
    staff_records.id as staff_record_id,
    row_number() over (
      partition by dbs_updates.certificate_no
      order by staff_records.created_at desc
    ) as match_rank
  from dbs_updates
  join public.staff_records on true
  left join public.profiles on profiles.id = staff_records.profile_id
  where staff_records.archived_at is null
    and (
      exists (
        select 1
        from unnest(dbs_updates.name_terms) as term
        where lower(coalesce(profiles.full_name, '')) like '%' || lower(term) || '%'
          or lower(coalesce(staff_records.preferred_name, '')) like '%' || lower(term) || '%'
          or lower(coalesce(profiles.email, '')) like '%' || lower(term) || '%'
      )
      or exists (
        select 1
        from unnest(dbs_updates.email_terms) as term
        where lower(coalesce(profiles.email, '')) = lower(term)
      )
    )
),
updates as (
  select *
  from matched_staff
  where match_rank = 1
),
updated_checks as (
  update public.scr_checks
  set
    dbs = coalesce(public.scr_checks.dbs, '{}'::jsonb)
      || jsonb_build_object(
        'number', updates.certificate_no,
        'dbsNumber', updates.certificate_no,
        'certificateNo', updates.certificate_no,
        'applicationType', 'Enhanced',
        'result', 'Clear',
        'status', 'Approved',
        'updateService', true,
        'updateServiceStatus', 'Active',
        'updateServiceActive', true,
        'workingWithAdults', false,
        'workingWithChildren', true,
        'source', updates.source_label,
        'sourceName', updates.name_label
      ),
    admin_review = coalesce(public.scr_checks.admin_review, '{}'::jsonb)
      || jsonb_build_object(
        'checklist',
        coalesce(public.scr_checks.admin_review -> 'checklist', '{}'::jsonb)
          || jsonb_build_object(
            'dbs', true,
            'dbsNumber', updates.certificate_no,
            'evidence',
            coalesce(public.scr_checks.admin_review #> '{checklist,evidence}', '{}'::jsonb)
              || jsonb_build_object(
                'dbs',
                coalesce(public.scr_checks.admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                  || jsonb_build_object(
                    'status', 'Approved',
                    'number', updates.certificate_no,
                    'dbsNumber', updates.certificate_no,
                    'certificateNo', updates.certificate_no,
                    'reference', updates.source_label,
                    'verifiedAt', now(),
                    'verifiedBy', 'Admin',
                    'updateService', true,
                    'updateServiceStatus', 'Active',
                    'updateServiceActive', true,
                    'sourceName', updates.name_label
                  )
              )
          )
      ),
    updated_at = now()
  from updates
  where public.scr_checks.staff_record_id = updates.staff_record_id
  returning updates.staff_record_id
)
insert into public.scr_checks (
  staff_record_id,
  dbs,
  admin_review,
  updated_at
)
select
  updates.staff_record_id,
  jsonb_build_object(
    'number', updates.certificate_no,
    'dbsNumber', updates.certificate_no,
    'certificateNo', updates.certificate_no,
    'applicationType', 'Enhanced',
    'result', 'Clear',
    'status', 'Approved',
    'updateService', true,
    'updateServiceStatus', 'Active',
    'updateServiceActive', true,
    'workingWithAdults', false,
    'workingWithChildren', true,
    'source', updates.source_label,
    'sourceName', updates.name_label
  ),
  jsonb_build_object(
    'checklist',
    jsonb_build_object(
      'dbs', true,
      'dbsNumber', updates.certificate_no,
      'evidence',
      jsonb_build_object(
        'dbs',
        jsonb_build_object(
          'status', 'Approved',
          'number', updates.certificate_no,
          'dbsNumber', updates.certificate_no,
          'certificateNo', updates.certificate_no,
          'reference', updates.source_label,
          'verifiedAt', now(),
          'verifiedBy', 'Admin',
          'updateService', true,
          'updateServiceStatus', 'Active',
          'updateServiceActive', true,
          'sourceName', updates.name_label
        )
      )
    )
  ),
  now()
from updates
where not exists (
  select 1
  from updated_checks
  where updated_checks.staff_record_id = updates.staff_record_id
);
