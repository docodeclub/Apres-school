-- Keep a staff member's primary workplace while allowing additional schools to
-- include them in site-specific SCR and Letter of Assurance outputs.

alter table public.staff_records
  add column if not exists site_assignments jsonb not null default '[]'::jsonb;

alter table public.staff_records
  drop constraint if exists staff_records_site_assignments_is_array;

alter table public.staff_records
  add constraint staff_records_site_assignments_is_array
  check (jsonb_typeof(site_assignments) = 'array');

update public.staff_records
set site_assignments = jsonb_build_array(jsonb_build_object(
  'school', primary_site,
  'role', coalesce(nullif(job_role, ''), 'Staff'),
  'startDate', coalesce(start_date::text, ''),
  'endDate', '',
  'status', 'Active'
))
where coalesce(primary_site, '') <> ''
  and site_assignments = '[]'::jsonb;

with target_staff as (
  select
    staff.id,
    coalesce(nullif(staff.job_role, ''), 'Staff') as assignment_role
  from public.staff_records staff
  join public.profiles profile on profile.id = staff.profile_id
  where lower(profile.email) in (
    'josielally04@gmail.com',
    'jack@jackwatts.co.uk'
  )
    and staff.archived_at is null
    and staff.left_at is null
)
update public.staff_records staff
set site_assignments = staff.site_assignments || jsonb_build_array(jsonb_build_object(
  'school', 'Shrewsbury House School',
  'role', target.assignment_role,
  'startDate', '2026-09-02',
  'endDate', '',
  'status', 'Active'
))
from target_staff target
where staff.id = target.id
  and not exists (
    select 1
    from jsonb_array_elements(staff.site_assignments) assignment
    where lower(coalesce(assignment->>'school', '')) in (
      'shrewsbury house',
      'shrewsbury house school'
    )
      and coalesce(assignment->>'status', 'Active') in ('', 'Active', 'Scheduled', 'Cover')
      and coalesce(assignment->>'endDate', '') = ''
  );

create index if not exists staff_records_site_assignments_gin
  on public.staff_records using gin (site_assignments);

comment on column public.staff_records.site_assignments is
  'Active and historic school/site assignments used for site-scoped SCR and Letter of Assurance output; primary_site remains the person''s main workplace.';
