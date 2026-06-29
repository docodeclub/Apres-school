-- Stores an explicit DBS clear date alongside the certificate issue date.
-- This keeps the inspection roster wording clear while preserving the original
-- disclosure issue dates already held in each staff member's SCR DBS record.

update public.scr_checks
set
  dbs = coalesce(dbs, '{}'::jsonb)
    || jsonb_build_object(
      'clearDate',
      coalesce(
        dbs ->> 'clearDate',
        dbs ->> 'clear_date',
        dbs ->> 'issueDate',
        dbs ->> 'issue_date',
        dbs ->> 'date'
      )
    ),
  admin_review = coalesce(admin_review, '{}'::jsonb)
    || jsonb_build_object(
      'checklist',
      coalesce(admin_review -> 'checklist', '{}'::jsonb)
        || jsonb_build_object(
          'evidence',
          coalesce(admin_review #> '{checklist,evidence}', '{}'::jsonb)
            || jsonb_build_object(
              'dbs',
              coalesce(admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                || jsonb_build_object(
                  'clearDate',
                  coalesce(
                    admin_review #>> '{checklist,evidence,dbs,clearDate}',
                    admin_review #>> '{checklist,evidence,dbs,clear_date}',
                    admin_review #>> '{checklist,evidence,dbs,issueDate}',
                    admin_review #>> '{checklist,evidence,dbs,issue_date}',
                    admin_review #>> '{checklist,evidence,dbs,date}',
                    dbs ->> 'clearDate',
                    dbs ->> 'clear_date',
                    dbs ->> 'issueDate',
                    dbs ->> 'issue_date',
                    dbs ->> 'date'
                  )
                )
            )
        )
    ),
  updated_at = now()
where coalesce(
  dbs ->> 'clearDate',
  dbs ->> 'clear_date',
  dbs ->> 'issueDate',
  dbs ->> 'issue_date',
  dbs ->> 'date',
  admin_review #>> '{checklist,evidence,dbs,clearDate}',
  admin_review #>> '{checklist,evidence,dbs,clear_date}',
  admin_review #>> '{checklist,evidence,dbs,issueDate}',
  admin_review #>> '{checklist,evidence,dbs,issue_date}',
  admin_review #>> '{checklist,evidence,dbs,date}'
) is not null;

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
)
update public.scr_checks
set
  dbs = coalesce(dbs, '{}'::jsonb)
    || jsonb_build_object(
      'number', '001933289972',
      'dbsNumber', '001933289972',
      'certificateNo', '001933289972',
      'clearDate', '2025-07-22',
      'issueDate', '2025-07-22',
      'date', '2025-07-22',
      'result', 'Clear',
      'status', 'Approved'
    ),
  admin_review = coalesce(admin_review, '{}'::jsonb)
    || jsonb_build_object(
      'checklist',
      coalesce(admin_review -> 'checklist', '{}'::jsonb)
        || jsonb_build_object(
          'dbs', true,
          'dbsNumber', '001933289972',
          'evidence',
          coalesce(admin_review #> '{checklist,evidence}', '{}'::jsonb)
            || jsonb_build_object(
              'dbs',
              coalesce(admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                || jsonb_build_object(
                  'status', 'Approved',
                  'number', '001933289972',
                  'dbsNumber', '001933289972',
                  'certificateNo', '001933289972',
                  'clearDate', '2025-07-22',
                  'issueDate', '2025-07-22',
                  'result', 'Clear'
                )
            )
        )
    ),
  updated_at = now()
from maisie
where public.scr_checks.staff_record_id = maisie.staff_record_id;
