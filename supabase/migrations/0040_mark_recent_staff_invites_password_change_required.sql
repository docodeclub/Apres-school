update public.profiles
set must_change_password = true,
    password_changed_at = null,
    updated_at = now()
where lower(email) in (
  'luke@apres-school.co.uk',
  'kelly@apres-school.co.uk',
  'lindsay@apres-school.co.uk'
);
