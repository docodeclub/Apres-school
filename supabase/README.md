# Supabase Setup

This folder contains a starter schema for the Après School operational platform.

For the full production setup order, use [../docs/production-supabase-runbook.md](../docs/production-supabase-runbook.md).

## Apply Locally

```bash
supabase db reset
```

## Apply Remotely

```bash
supabase db push
```

## Parent Booking Backend

The parent booking implementation needs these migrations before a live-style booking can be submitted:

- `0029_booking_core.sql`
- `0030_create_parent_booking_reservation.sql`
- `0045_seed_2026_wraparound_booking_sessions.sql`
- `0032_cancel_parent_booking.sql`
- `0033_amend_parent_booking_remove_items.sql`
- `0034_amend_parent_booking_add_items.sql`
- `0035_booking_payment_admin_actions.sql`

Deploy the booking and payment functions after the schema is applied:

```bash
supabase functions deploy create-parent-booking
supabase functions deploy update-parent-booking
supabase functions deploy ponchopay-create-checkout
supabase functions deploy ponchopay-callback --no-verify-jwt
supabase functions deploy ponchopay-process-events
```

Local launch checks:

```bash
npm run validate:wraparound
npm run validate:booking-map
npm run check:booking-contract
npm run check:booking-live
```

The launch booking page will show `Booking API / Supabase/auth needed` until `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, an authenticated parent profile and the booking migrations/functions are available. Once those are connected, the same checkout payload resolves to the seeded `session_blocks` using `labSessionId + sessionDate + sessionLabel`.

Use the strict readiness check immediately before a hidden real-booking rehearsal:

```bash
npm run check:booking-live:strict
```

That command fails until the Supabase CLI, browser Supabase env, service-role key and PonchoPay secrets are available. It does not print secret values.

To generate the hidden-staging deployment bundle for bookings:

```bash
npm run booking:staging-preflight
npm run booking:staging-bundle
```

The bundle prints the exact migrations, Edge Functions, Supabase secrets, PonchoPay callback URLs and verification commands needed before running the admin-only real booking rehearsal.

Run the guarded PonchoPay rehearsal only against the hidden staging setup:

```bash
PONCHOPAY_PENNY_TEST=live PONCHOPAY_PENNY_AMOUNT=0.01 npm run ponchopay:penny-test
```

The penny-test script refuses to run unless `PONCHOPAY_PENNY_TEST=live` is set and the amount is no more than £1. To exercise callback intake before using a real provider event, add `PONCHOPAY_SYNTHETIC_CALLBACKS=1`; it signs `payment_captured` and `payment_completed` callbacks with `PONCHOPAY_INTEGRATION_KEY`, runs the processor, then reports whether the invoice cleared, receipt was created and booking moved to confirmed.

## Important Notes

- Keep staff evidence, payslips and incident attachments in private buckets only.
- Use Supabase Auth for staff/admin accounts. The frontend unlocks the internal platform only after a successful password sign-in.
- Every Auth user needs a matching `profiles` row using the Auth user id as `profiles.id`; `profiles.role` drives the Staff, Manager, Admin and Superadmin views.
- Public enquiries are inserted through `functions/notify-public-enquiry`.
- Safeguarding-restricted incidents require tighter policies than normal operational issues.
- This schema is a starter and should be reviewed before production use.

## Staff Auth

Required frontend environment variables:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Create staff users in Supabase Auth, then insert or update their profile:

```sql
insert into profiles (id, role, full_name, email)
values ('auth-user-id', 'admin', 'Example Admin', 'admin@apres-school.co.uk')
on conflict (id) do update
set role = excluded.role,
    full_name = excluded.full_name,
    email = excluded.email;
```

Without the environment variables, the staff login screen remains locked for local safety.

## Public Enquiries

Deploy the enquiry and cover-move functions:

```bash
supabase functions deploy notify-public-enquiry --no-verify-jwt
supabase functions deploy notify-cover-move
```

Set email secrets:

```bash
supabase secrets set ENQUIRY_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set OPERATIONS_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set RESEND_API_KEY=...
supabase secrets set APRES_EMAIL_FROM="Après School <hello@apres-school.co.uk>"
supabase secrets set APRES_STAFF_EMAIL_FROM="Après School Team <staff@apres-school.co.uk>"
supabase secrets set APRES_REPLY_TO=hello@apres-school.co.uk
supabase secrets set STAFF_LOGIN_URL=https://www.apres-school.co.uk/staff-login
```

The frontend calls the function when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured. Without those values, enquiries are saved locally so development remains usable.

Use the Supabase `sb_publishable_...` key for `VITE_SUPABASE_ANON_KEY` on new projects. The public enquiry function is deployed without JWT verification because website visitors are anonymous; writes still happen server-side through `APRES_SERVICE_ROLE_KEY`.

## Email Logging

Apply `0025_email_logs.sql` before turning on Resend. Staff invites, password resets, public enquiry notifications and cover-move notices write to `email_logs` with one of these statuses:

- `sent` when Resend returns successfully,
- `failed` when Resend rejects the message,
- `queued_without_provider` when the app action completed but `RESEND_API_KEY` has not been configured yet.

This keeps manual handover honest during rollout: the staff account can exist even when email delivery is not ready, and admins can still see exactly what happened.

Recommended Resend setup:

1. Add `apres-school.co.uk` inside Resend.
2. Add the DKIM/SPF records Resend provides into Squarespace DNS.
3. Wait until Resend shows the domain as verified.
4. Create a restricted API key for this Supabase project.
5. Add the Supabase secrets above.
6. Redeploy the functions:

```bash
supabase functions deploy manage-staff-account
supabase functions deploy notify-cover-move
supabase functions deploy notify-public-enquiry --no-verify-jwt
```

## CRM Updates

The admin CRM can update Supabase enquiry records when staff are signed in and RLS allows access.

- `status` maps to the `enquiry_status` enum: `new`, `reviewing`, `follow_up`, `closed`.
- Follow-up note, owner label and next action are currently stored as JSON text in `enquiries.internal_notes`.
- A future production pass should replace owner labels with `owner_id` selections from `profiles`.
- Local/demo enquiries still use browser storage so the workflow remains testable without a Supabase project.

## User Management

The frontend now includes a local Superadmin/Admin user-management screen for the target workflow:

- invite a staff/admin user,
- assign `staff`, `manager`, `admin` or `superadmin`,
- deactivate rather than hard-delete accounts.

Production implementation should use a server-side Supabase Edge Function with the service-role key kept out of frontend code. The function should call Supabase Auth admin APIs, write/update the matching `profiles` row, record an `audit_log` entry and rely on RLS for ordinary profile reads.

## HR Hierarchy

The local app now includes an HR hierarchy module for reporting lines, manager scope and escalation planning. Production should store this in an `hr_reporting_lines` table with effective dates, archived rows for history and audit entries whenever a line manager or site scope changes.

Manager dashboards can then filter by direct reports, assigned sites and escalation routes rather than relying only on broad platform roles.

The React demo now applies manager scoping in the UI: managers see direct-report staff records across staff, SCR/compliance, rota staff selectors, hours, pay and sessions. Production RLS should enforce the same rule in SQL using `hr_reporting_lines`, not just frontend filtering.

## Rota, Hours and Audit

The local app now models rota requirements and staff hours:

- after-school and breakfast sessions include setup, supervised session time and cleanup/dismissal,
- rota cards track first-aider and Level 3+ EYFS cover,
- cover moves queue email previews for the staff member moving site and the person being covered,
- hours entries calculate paid time after unpaid break minutes,
- the UI uses a 30-minute default unpaid break for long holiday-camp days, while noting that the UK statutory rest break is 20 minutes for shifts over 6 hours,
- local audit entries record rota, hours, CRM and user-management actions.

Production should move this into `rota_requirements`, `cover_moves`, `hours_entries` and immutable `audit_log` tables with manager/admin approval workflows before payroll export. Cover notification emails should be sent from a Supabase Edge Function so service keys and email provider secrets stay out of the frontend.
