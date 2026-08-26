-- Backend maintenance and automated test cleanup only. The service role is
-- never exposed to the browser; staff-facing access remains governed by RLS
-- and the security-definer workflow functions in migration 0115.
grant all on public.employee_expense_claims to service_role;
grant all on public.employee_expense_events to service_role;
