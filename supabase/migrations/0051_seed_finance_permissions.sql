insert into public.finance_permissions (profile_id, permission, granted_by)
select
  profile.id,
  'finance_admin',
  grantor.id
from public.profiles profile
left join public.profiles grantor
  on lower(grantor.email) = 'luke@apres-school.co.uk'
where lower(profile.email) in (
  'luke@apres-school.co.uk',
  'kelly@apres-school.co.uk',
  'lindsay@apres-school.co.uk'
)
on conflict (profile_id, permission) do nothing;
