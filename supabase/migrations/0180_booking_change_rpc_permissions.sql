-- These SECURITY DEFINER functions trust server-supplied parent/staff identity.
-- Browser callers must use update-parent-booking, which verifies the login and
-- loads the active profile role. A service-role grant alone does not remove
-- PostgreSQL's default PUBLIC execution permission (or existing explicit grants).
begin;
revoke all on function public.amend_parent_booking_remove_items(uuid, uuid, uuid[], text, text) from public, anon, authenticated;
revoke all on function public.cancel_parent_booking(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.amend_parent_booking_add_items(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.cancel_parent_staff_adhoc_booking(uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.amend_parent_booking_remove_items(uuid, uuid, uuid[], text, text) to service_role;
grant execute on function public.cancel_parent_booking(uuid, uuid, text, text) to service_role;
grant execute on function public.amend_parent_booking_add_items(uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.cancel_parent_staff_adhoc_booking(uuid, uuid, text, uuid) to service_role;
commit;
