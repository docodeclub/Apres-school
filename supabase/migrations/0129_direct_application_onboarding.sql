alter table public.staff_offers
  add column if not exists contract_signed_confirmed_at timestamptz,
  add column if not exists contract_signed_confirmed_by uuid references public.profiles(id) on delete set null;

comment on column public.staff_offers.contract_signed_confirmed_at is
  'Admin confirmation that the candidate accepted the role and signed their contract before application-led onboarding began.';
