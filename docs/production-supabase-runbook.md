# Production Supabase Runbook

This runbook is the first safe path from local build to a production-backed Après School V1.

## 1. Create The Supabase Project

1. Create a new Supabase project for Après School production.
2. Copy the project URL and anon key from Project Settings > API.
3. Copy the service-role key, but keep it server-side only.

Do not put `APRES_SERVICE_ROLE_KEY`, `RESEND_API_KEY` or email notification secrets into frontend code or public Vercel variables.

## 2. Link The Local Project

From the project root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Then confirm the linked project before applying schema changes:

```bash
supabase status
```

## 3. Apply The Database Migration

Apply the starter schema:

```bash
supabase db push
```

This creates the core tables, enums and initial RLS policies for:

- `profiles`
- `staff_records`
- `scr_checks`
- `locations`
- `programmes`
- `sessions`
- `session_assignments`
- `hr_reporting_lines`
- `rota_requirements`
- `hours_entries`
- `cover_moves`
- `document_versions`
- `document_assignments`
- `enquiries`
- `incidents`
- `audit_log`

After pushing, open Supabase Table Editor and confirm the tables exist. Do not add production staff evidence, DBS, right-to-work documents or payslips to public storage buckets.

## 4. Deploy Edge Functions

Deploy the two current server-side functions:

```bash
supabase functions deploy notify-public-enquiry --no-verify-jwt
supabase functions deploy notify-cover-move
```

`notify-public-enquiry` saves website enquiries into `enquiries` and optionally emails the inbox. It is deployed without JWT verification because public website visitors are anonymous; the database write still happens server-side with `APRES_SERVICE_ROLE_KEY`.

`notify-cover-move` records cover moves, sends staff cover emails when Resend is configured, and writes audit entries.

## 5. Set Supabase Function Secrets

Set these as Supabase Edge Function secrets:

```bash
supabase secrets set APRES_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase secrets set ENQUIRY_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set OPERATIONS_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set RESEND_API_KEY=YOUR_RESEND_API_KEY
supabase secrets set RESEND_FROM="Après School <hello@apres-school.co.uk>"
```

If `RESEND_API_KEY` is not set, enquiries will still save but notification emails will not send.

## 6. Create The First Superadmin

Create the first staff/admin Auth user in Supabase Authentication.

Then insert the matching `profiles` row using the Auth user id:

```sql
insert into profiles (id, role, full_name, email, active)
values (
  'AUTH_USER_ID_HERE',
  'superadmin',
  'YOUR NAME',
  'YOUR_EMAIL@apres-school.co.uk',
  true
)
on conflict (id) do update
set role = excluded.role,
    full_name = excluded.full_name,
    email = excluded.email,
    active = true,
    updated_at = now();
```

Then create a matching `staff_records` row:

```sql
insert into staff_records (
  profile_id,
  preferred_name,
  job_role,
  employment_type,
  start_date
)
values (
  'AUTH_USER_ID_HERE',
  'YOUR PREFERRED NAME',
  'Superadmin',
  'Admin',
  current_date
)
on conflict (profile_id) do nothing;
```

The current app expects a user to have both a Supabase Auth account and a `profiles` row. Staff-only data screens are stronger when a matching `staff_records` row also exists.

## 7. Configure Vercel

In Vercel, use:

- Build command: `npm run build`
- Output directory: `dist`

Set only these frontend-safe environment variables:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_ENQUIRY_FUNCTION_NAME=notify-public-enquiry
VITE_COVER_MOVE_FUNCTION_NAME=notify-cover-move
```

Do not set service-role or Resend secrets as Vercel frontend variables. They belong in Supabase function secrets.

## 8. Pre-Deploy Checks

Run locally:

```bash
npm run validate:static
npm run build
npm run check:deploy
```

When production env vars are loaded into your shell, run:

```bash
npm run check:deploy:strict
```

`check:deploy:strict` should fail until `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `APRES_SERVICE_ROLE_KEY` are present in the current environment.

For new Supabase projects, prefer the `sb_publishable_...` key for `VITE_SUPABASE_ANON_KEY`. Legacy anon JWTs can be rejected by newer Edge Function gateways.

## 9. First Hosted Smoke Test

After the first Vercel deploy:

```bash
PRODUCTION_URL=https://www.apres-school.co.uk npm run check:deploy
```

Then manually test:

1. Homepage loads.
2. Bookings page shows all current school cards.
3. Holiday Clubs, Wraparound and Schools pages load without broken images.
4. Magicbooking and Pebble links open the correct external sites.
5. Contact form submits a test enquiry.
6. The test enquiry appears in Supabase `enquiries`.
7. The notification email arrives in the operations inbox if Resend is configured.
8. Staff Login rejects a bad password.
9. Staff Login accepts the superadmin account and shows the internal platform.
10. Demo login buttons are not available in production.

## 10. First Internal Checks

With the superadmin account:

1. Open CRM and confirm the test enquiry is visible.
2. Change the enquiry status to `Reviewing` and confirm it syncs.
3. Open SCR and confirm no sensitive documents are public.
4. Open Ofsted readiness and confirm site records display.
5. Open Rota and create a local cover move only after real staff email addresses are ready.

## 11. Known V1 Constraints

- The public website is launch-ready, but the operational platform still starts from a starter schema plus local/demo operational data.
- Staff onboarding approval is modelled in the app, but production account creation should move into a server-side `invite-user` Edge Function before real hiring workflows depend on it.
- Staff evidence, payslips and incident attachments need private Supabase Storage buckets before sensitive file upload goes live.
- Manager hierarchy exists in the UI and schema, but production RLS should be expanded before using it as the only permission boundary for all manager views.
