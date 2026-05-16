# Après School Website & Operations Platform

Standalone first version for Après School: a polished public website plus a protected internal operations platform foundation for staff, compliance, documents, rota, hours, pay, rewards, Ofsted readiness and enquiries.

## Run Locally

The project is now structured as a Vite React app.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## What Is Included

- Public website pages: Home, Bookings, Holiday Clubs, Wraparound, Schools, Contact, Magicbooking Guide, Book Pebble Guide, Payments, Cancellations and Policies.
- Bookings page with Magicbooking and booking-partner links for the current Après School sites.
- Contact and school enquiry flows that call a Supabase Edge Function when configured, with local fallback for development.
- Staff login screen wired to Supabase Auth, with role loading from `profiles.role` and no public fallback into internal dashboards.
- Mobile-first navigation, sticky mobile CTAs and real Après School imagery.
- SEO basics: `robots.txt`, `sitemap.xml`, social metadata, manifest and structured data.
- Vercel config with clean URL rewrites and baseline security headers.
- Vite migration notes in [docs/vite-migration.md](/Users/lukecurrie/Documents/New%20project%203/docs/vite-migration.md).
- Staff dashboard, admin dashboard, SCR, Ofsted readiness, documents, rota, hours tracking, pay, rewards, sessions and CRM screens.
- Supabase-ready data model and RLS outline in [docs/supabase-blueprint.md](/Users/lukecurrie/Documents/New%20project%203/docs/supabase-blueprint.md).
- Starter Supabase SQL migration in [supabase/migrations/0001_initial_schema.sql](/Users/lukecurrie/Documents/New%20project%203/supabase/migrations/0001_initial_schema.sql).
- Public enquiry Edge Function in [supabase/functions/notify-public-enquiry/index.ts](/Users/lukecurrie/Documents/New%20project%203/supabase/functions/notify-public-enquiry/index.ts).

## Validation

If dependencies are available, run:

```bash
npm run validate:static
npm run build
npm run check:deploy
npm run smoke
npm run qa:launch
```

The build automatically prunes unused public image files from `dist`, so old working assets can remain in `public` without being shipped. `check:deploy` validates launch configuration and can test hosted routes when `PRODUCTION_URL` is set. The smoke and launch QA tests expect the Vite dev server to be running at `http://127.0.0.1:5173` and cover current public routes on desktop and mobile.

For production, run the stricter environment check after Vercel and Supabase secrets are loaded:

```bash
npm run check:deploy:strict
```

## Staff Login

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before production staff access can unlock. Each Supabase Auth user should have a matching `profiles` row with the same `id` and a `role` of `staff`, `manager`, `admin` or `superadmin`. Local demo buttons are available only in development when Supabase is not configured.

## Launch Docs

- [Deployment checklist](/Users/lukecurrie/Documents/New%20project%203/docs/deployment-checklist.md)
- [Production Supabase runbook](/Users/lukecurrie/Documents/New%20project%203/docs/production-supabase-runbook.md)
- [QA checklist](/Users/lukecurrie/Documents/New%20project%203/docs/qa-checklist.md)
- [Content checklist](/Users/lukecurrie/Documents/New%20project%203/docs/content-checklist.md)
- [GDPR retention plan](/Users/lukecurrie/Documents/New%20project%203/docs/gdpr-retention-plan.md)
- [Image privacy guidance](/Users/lukecurrie/Documents/New%20project%203/docs/image-privacy-guidance.md)
- [School assurance letter template](/Users/lukecurrie/Documents/New%20project%203/docs/templates/school-assurance-letter.md)

## Production Next Steps

- Replace remaining mock operational data with Supabase Postgres tables, RLS policies and private Storage buckets.
- Add audit logging for admin actions and GDPR retention workflows.
- Connect Supabase Auth and private Storage buckets.
