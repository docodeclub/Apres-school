# Deployment Checklist

## Before First Deploy

- Confirm all public booking links are correct for each site.
- Confirm which sites use Magicbooking and which use Book Pebble.
- Replace any placeholder school/site copy with approved wording.
- Confirm public images are approved for website use.
- Confirm the contact inbox and enquiry notification recipient.
- Work through [production-supabase-runbook.md](/Users/lukecurrie/Documents/New%20project%203/docs/production-supabase-runbook.md) before the first production-backed deploy.
- Add Supabase project URL and anon key to Vercel environment variables.
- Create Supabase Auth users for staff/admins and matching `profiles` rows with the correct role.
- Confirm the hosted staff login rejects invalid credentials and unlocks only for active staff accounts.
- Keep service-role keys out of frontend code.
- Deploy `notify-public-enquiry` and set `ENQUIRY_NOTIFICATION_TO`.
- Set `RESEND_API_KEY` and `RESEND_FROM` if email notifications should be live.
- Review `vercel.json` security headers and route rewrites.
- Run `npm run check:deploy` locally before deploy.

## Vercel

- Build command: `npm run build`.
- Output directory: `dist`.
- Environment variables should come from `.env.example`.
- Vercel frontend environment variables should include only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENQUIRY_FUNCTION_NAME` and `VITE_COVER_MOVE_FUNCTION_NAME`.
- Do not add `APRES_SERVICE_ROLE_KEY` or `RESEND_API_KEY` to frontend-accessible Vercel variables.
- Enable production branch protection once the repo is connected.

## Supabase

- Apply the migration in `supabase/migrations/0001_initial_schema.sql`.
- Deploy `notify-public-enquiry` and `notify-cover-move`.
- Set Supabase function secrets: `APRES_SERVICE_ROLE_KEY`, `ENQUIRY_NOTIFICATION_TO`, `OPERATIONS_NOTIFICATION_TO`, `RESEND_API_KEY` and `RESEND_FROM`.
- Create the first `superadmin` Auth user and matching `profiles` row before testing staff login.
- Run `npm run check:deploy:strict` from an environment where production variables are loaded.

## After Deploy

- Test homepage, bookings, holiday clubs, wraparound, schools, booking guides, payment/cancellation guidance, policies, staff application and contact.
- Test mobile navigation at 390px width.
- Test external links to Magicbooking and Book Pebble.
- Submit a test enquiry and confirm the hosted function sends notification email.
- Sign in with one staff account and one admin account, then confirm each sees the correct internal tabs.
- Confirm demo login buttons are disabled or unavailable in production.
- Confirm `npm run build` prunes unused image assets from `dist` and does not ship old working images.
- Check social previews with the production URL.
- Run `PRODUCTION_URL=https://www.apres-school.co.uk npm run check:deploy` against the hosted site.
- Submit `sitemap.xml` in Google Search Console.
