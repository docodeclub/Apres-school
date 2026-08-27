-- The onboarding Edge Function uses the service role to create the employee's
-- initial private draft before the new user signs in. Keep browser access
-- read-only/RPC-based while allowing that trusted server bootstrap.
grant select, insert, update on public.staff_onboarding_submissions to service_role;

