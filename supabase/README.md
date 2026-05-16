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
supabase secrets set RESEND_FROM="Après School <hello@apres-school.co.uk>"
```

The frontend calls the function when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured. Without those values, enquiries are saved locally so development remains usable.

Use the Supabase `sb_publishable_...` key for `VITE_SUPABASE_ANON_KEY` on new projects. The public enquiry function is deployed without JWT verification because website visitors are anonymous; writes still happen server-side through `APRES_SERVICE_ROLE_KEY`.

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
