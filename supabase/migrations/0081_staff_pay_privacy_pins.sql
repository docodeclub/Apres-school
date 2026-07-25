create table if not exists public.staff_pay_privacy_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_salt text not null,
  pin_hash text not null,
  hash_iterations integer not null default 120000,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_pay_privacy_pins enable row level security;

revoke all on table public.staff_pay_privacy_pins from anon, authenticated;
grant all on table public.staff_pay_privacy_pins to service_role;

comment on table public.staff_pay_privacy_pins is
  'Server-only privacy PIN hashes used to conceal the Pay screen on shared or unattended devices.';
