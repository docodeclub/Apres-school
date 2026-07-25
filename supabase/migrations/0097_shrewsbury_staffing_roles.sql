-- Shrewsbury House permanent role holder: Abi is Manager, DSL and SENDCO.
-- These site roles are recognised automatically on every assigned session.

update public.staffing_site_settings settings
set default_manager_staff_id = abi.id,
    default_dsl_staff_id = abi.id,
    default_sendco_staff_id = abi.id,
    updated_at = now()
from public.locations location,
     public.staff_records abi
     join public.profiles profile on profile.id = abi.profile_id
where settings.location_id = location.id
  and lower(regexp_replace(location.name, '\s+school$', '')) = 'shrewsbury house'
  and lower(profile.email) = 'abi@apres-school.co.uk'
  and abi.archived_at is null;

