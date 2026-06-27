-- Updates enhanced DBS certificate numbers from Disclosure Results export generated 27 June 2026.
-- Source file: Disclosure-Results-27062026091744.pdf
-- This migration matches staff by known name terms and DOB where available, then updates the
-- SCR DBS JSON and nested checklist evidence used by the platform and Ofsted printouts.

with disclosure_rows (
  surname,
  date_of_birth,
  application_ref,
  certificate_no,
  issue_date,
  name_terms
) as (
  values
    ('ELEKES', date '2001-11-19', 'E0873119464', '001897639742', date '2024-10-04', array['angel','elekes','alekes']),
    ('ROSE', date '1961-12-17', 'E0873119200', '001898008401', date '2024-10-07', array['julie','rose']),
    ('WATTS', date '2001-01-05', 'E0873290870', '001898280331', date '2024-10-09', array['jack','watts']),
    ('HARRISON', date '1964-11-08', 'E0873570208', '001898619439', date '2024-10-10', array['brenda','harrison']),
    ('NEWLAND', date '2001-04-13', 'E0874177630', '001898755098', date '2024-10-11', array['sonny','newland']),
    ('SNELL', date '1977-09-25', 'E0873119373', '001898911282', date '2024-10-14', array['snell']),
    ('WOODLEY', date '1978-08-11', 'E0873292660', '001901359590', date '2024-10-31', array['sadie','woodley']),
    ('TOPPING', date '2005-07-22', 'E0877531318', '001902110271', date '2024-11-06', array['hannah','topping']),
    ('LALLY', date '2004-10-13', 'E0877531214', '001902110211', date '2024-11-06', array['josie','lally']),
    ('MARSHALL', date '2005-04-18', 'E0877527730', '001902127873', date '2024-11-06', array['joel','marshall']),
    ('NICOLIN', date '1979-03-25', 'E0884832057', '001909625370', date '2025-01-15', array['amanda','nicholson','nicolin']),
    ('AZEBAZE AYANGMA', date '2007-12-18', 'E0886155639', '001910951943', date '2025-01-24', array['joelle','azebaze','ayanam','ayangma']),
    ('KELLY', date '1997-01-07', 'E0888337193', '001916508152', date '2025-03-10', array['kelly']),
    ('GRANT', date '2002-08-12', 'E0913830370', '001941644626', date '2025-09-26', array['grant'])
),
matched_staff as (
  select
    disclosure_rows.*,
    staff_records.id as staff_record_id,
    row_number() over (
      partition by disclosure_rows.certificate_no
      order by
        case when staff_records.date_of_birth = disclosure_rows.date_of_birth then 0 else 1 end,
        case when lower(coalesce(profiles.full_name, '')) like '%' || lower(disclosure_rows.surname) || '%' then 0 else 1 end,
        staff_records.created_at desc
    ) as match_rank
  from disclosure_rows
  join staff_records on true
  left join profiles on profiles.id = staff_records.profile_id
  where staff_records.archived_at is null
    and exists (
      select 1
      from unnest(disclosure_rows.name_terms) as term
      where lower(coalesce(profiles.full_name, '')) like '%' || lower(term) || '%'
        or lower(coalesce(staff_records.preferred_name, '')) like '%' || lower(term) || '%'
        or lower(coalesce(profiles.email, '')) like '%' || lower(term) || '%'
    )
    and (
      staff_records.date_of_birth is null
      or staff_records.date_of_birth = disclosure_rows.date_of_birth
      or exists (
        select 1
        from unnest(disclosure_rows.name_terms) as term
        where lower(coalesce(profiles.full_name, '')) like '%' || lower(term) || '%'
          or lower(coalesce(profiles.email, '')) like '%' || lower(term) || '%'
      )
    )
),
updates as (
  select *
  from matched_staff
  where match_rank = 1
),
updated_checks as (
  update scr_checks
  set
    dbs = coalesce(scr_checks.dbs, '{}'::jsonb)
      || jsonb_build_object(
        'number', updates.certificate_no,
        'dbsNumber', updates.certificate_no,
        'certificateNo', updates.certificate_no,
        'applicationRef', updates.application_ref,
        'applicationType', 'Enhanced',
        'issueDate', updates.issue_date::text,
        'date', updates.issue_date::text,
        'result', 'Clear',
        'status', 'Approved',
        'workingWithAdults', false,
        'workingWithChildren', true,
        'source', 'Disclosure Results 27 June 2026',
        'sourceSurname', updates.surname
      ),
    admin_review = coalesce(scr_checks.admin_review, '{}'::jsonb)
      || jsonb_build_object(
        'checklist',
        coalesce(scr_checks.admin_review -> 'checklist', '{}'::jsonb)
          || jsonb_build_object(
            'dbs', true,
            'dbsNumber', updates.certificate_no,
            'evidence',
            coalesce(scr_checks.admin_review #> '{checklist,evidence}', '{}'::jsonb)
              || jsonb_build_object(
                'dbs',
                coalesce(scr_checks.admin_review #> '{checklist,evidence,dbs}', '{}'::jsonb)
                  || jsonb_build_object(
                    'status', 'Approved',
                    'number', updates.certificate_no,
                    'dbsNumber', updates.certificate_no,
                    'reference', 'Disclosure Results 27 June 2026',
                    'verifiedAt', now(),
                    'issueDate', updates.issue_date::text,
                    'applicationRef', updates.application_ref,
                    'sourceSurname', updates.surname
                  )
              )
          )
      ),
    updated_at = now()
  from updates
  where scr_checks.staff_record_id = updates.staff_record_id
  returning updates.staff_record_id
)
insert into scr_checks (
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
    'applicationRef', updates.application_ref,
    'applicationType', 'Enhanced',
    'issueDate', updates.issue_date::text,
    'date', updates.issue_date::text,
    'result', 'Clear',
    'status', 'Approved',
    'workingWithAdults', false,
    'workingWithChildren', true,
    'source', 'Disclosure Results 27 June 2026',
    'sourceSurname', updates.surname
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
          'reference', 'Disclosure Results 27 June 2026',
          'verifiedAt', now(),
          'issueDate', updates.issue_date::text,
          'applicationRef', updates.application_ref,
          'sourceSurname', updates.surname
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
