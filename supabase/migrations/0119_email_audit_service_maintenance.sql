-- Backend-only maintenance for notification logs and isolated workflow tests.
-- These grants do not alter authenticated browser access or RLS policies.
grant delete on public.email_logs to service_role;
grant delete on public.audit_log to service_role;
