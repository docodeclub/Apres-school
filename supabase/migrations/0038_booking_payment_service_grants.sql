grant all privileges on booking_invoices to service_role;
grant all privileges on booking_receipts to service_role;
grant all privileges on ponchopay_checkout_sessions to service_role;

grant select on booking_invoices to authenticated;
grant select on booking_receipts to authenticated;
grant select on ponchopay_checkout_sessions to authenticated;

