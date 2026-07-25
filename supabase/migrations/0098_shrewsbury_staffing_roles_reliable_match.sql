-- Use a deliberately simple name match so clean installs and cloned environments
-- receive the same Shrewsbury role defaults as production.

update public.staffing_site_settings settings
set default_manager_staff_id = abi.id,
    default_dsl_staff_id = abi.id,
    default_sendco_staff_id = abi.id,
    updated_at = now()
from public.locations location,
     public.staff_records abi
     join public.profiles profile on profile.id = abi.profile_id
where settings.location_id = location.id
  and location.name ilike 'Shrewsbury House%'
  and lower(profile.email) = 'abi@apres-school.co.uk'
  and abi.archived_at is null;

