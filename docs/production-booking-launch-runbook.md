# Production Booking Launch Runbook

Use this as the single execution checklist when turning on the new parent booking journey. It combines production deploy, Supabase, PonchoPay and parent QA in the order they should happen.

## 0. Decision Rule

Do not open bookings to parents until all critical items in this runbook are green. The public website can stay live while booking remains gated or test-only.

## 1. Inputs Needed

- Production Supabase project ref.
- Production Supabase URL and publishable anon key.
- Supabase service-role key, stored only as a Supabase secret.
- PonchoPay API URL.
- PonchoPay integration/signing key.
- PonchoPay signature header name and algorithm.
- PonchoPay test payment method for the penny test.
- Final September booking data: dates, blocked days, timings, prices, capacities and eligibility.
- Production domain or preview URL to test.

## 2. Local Preflight

Run from the project root:

```bash
npm run validate:static
npm run validate:launch-data
npm run validate:wraparound
npm run build
QA_URL=http://127.0.0.1:5174 npm run qa:launch
```

Pass criteria:

- Static checks pass.
- Launch data check returns `launchReady: true`.
- Wraparound 2026 data has no failures.
- Build completes.
- Launch QA completes on desktop and mobile.
- `/launch-booking` has no horizontal overflow.

## 3. Supabase Schema

Link the production project:

```bash
supabase login
supabase link --project-ref PROJECT_REF
supabase status
```

Push migrations:

```bash
supabase db push
```

Confirm these booking/payment tables exist:

- `ponchopay_webhook_events`
- `booking_invoices`
- `booking_receipts`
- `ponchopay_checkout_sessions`

Also confirm the public/staff platform tables from `docs/production-supabase-runbook.md` exist.

## 4. Supabase Secrets

Set server-side secrets:

```bash
supabase secrets set APRES_SERVICE_ROLE_KEY=...
supabase secrets set PUBLIC_SITE_URL=https://www.apres-school.co.uk
supabase secrets set PONCHOPAY_API_URL=https://pay.ponchopay.com
supabase secrets set PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate
supabase secrets set PONCHOPAY_INTEGRATION_KEY=...
supabase secrets set PONCHOPAY_PROCESSOR_TOKEN=...
supabase secrets set ENQUIRY_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set OPERATIONS_NOTIFICATION_TO=hello@apres-school.co.uk
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM="Après School <hello@apres-school.co.uk>"
```

Do not add service-role, Resend or PonchoPay secrets to Vercel frontend variables.

## 5. Deploy Edge Functions

Deploy public/operations functions:

```bash
supabase functions deploy notify-public-enquiry --no-verify-jwt
supabase functions deploy notify-cover-move
supabase functions deploy manage-staff-account
```

Deploy PonchoPay functions:

```bash
supabase functions deploy ponchopay-create-checkout
supabase functions deploy ponchopay-callback --no-verify-jwt
supabase functions deploy ponchopay-process-events
```

## 6. PonchoPay Readiness

Run:

```bash
SUPABASE_PROJECT_REF=PROJECT_REF \
PONCHOPAY_API_URL=... \
PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate \
PONCHOPAY_INTEGRATION_KEY=... \
PUBLIC_SITE_URL=https://www.apres-school.co.uk \
APRES_SERVICE_ROLE_KEY=... \
node scripts/ponchopay-readiness-check.mjs
```

Pass criteria:

- `"ok": true`.
- Callback URLs print with the correct production project ref.
- All required secrets are present.
- Deploy commands match the functions deployed in step 5.

Paste these callback URLs into PonchoPay settings:

- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-captured`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-reported-complete`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-completed`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-in-bank`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-refunded`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-cancelled`
- `https://PROJECT_REF.functions.supabase.co/ponchopay-callback/payment-updated`

## 7. Vercel Production Variables

Set only frontend-safe variables:

```bash
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_ENQUIRY_FUNCTION_NAME=notify-public-enquiry
VITE_COVER_MOVE_FUNCTION_NAME=notify-cover-move
```

Then deploy with:

```bash
npm run build
```

Vercel build command: `npm run build`

Vercel output directory: `dist`

## 8. Hosted Public QA

Run against the hosted URL:

```bash
PRODUCTION_URL=https://www.apres-school.co.uk npm run check:deploy
QA_URL=https://www.apres-school.co.uk npm run qa:launch
```

Manual checks:

1. Homepage loads.
2. Booking pages and guides load.
3. Contact form creates an enquiry.
4. Staff login rejects bad credentials.
5. Staff/admin login works for seeded production users.
6. `/launch-booking` follows `docs/launch-parent-test-script.md`.

## 9. PonchoPay Penny Test

Create one real penny checkout:

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PENNY_AMOUNT=0.01 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
node scripts/ponchopay-penny-test.mjs
```

After callbacks arrive, run:

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PROCESSOR_ONLY=1 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
PONCHOPAY_PROCESSOR_TOKEN=TOKEN \
node scripts/ponchopay-penny-test.mjs
```

Pass criteria:

- Checkout status is `ready_for_payment`.
- A checkout URL is returned.
- `ponchopay_checkout_sessions` contains the checkout.
- `ponchopay_webhook_events` contains signed callback rows.
- `payment_completed` clears the invoice.
- `booking_receipts` contains a receipt.
- Duplicate callback replay does not create duplicate receipts.
- Parent portal shows the correct paid/unpaid state.

## 10. Booking Data Freeze

Before opening bookings:

- Work through [september-booking-data-freeze.md](/Users/lukecurrie/Documents/New%20project%203/docs/september-booking-data-freeze.md).
- Confirm real September dates.
- Confirm no past dates are bookable.
- Confirm school closures, INSET days and blocked dates.
- Confirm session timings.
- Confirm prices.
- Confirm capacities.
- Confirm eligibility rules.
- Confirm cancellation/amendment window is 24 hours.
- Confirm manager-added attendance bookings invoice parents correctly.

## 11. Go / No-Go

Go only when:

- Local and hosted QA pass.
- Supabase migrations are applied.
- Edge Functions are deployed.
- PonchoPay readiness returns `"ok": true`.
- Penny test passes.
- Parent portal shows invoice/payment state correctly.
- Real September data is frozen and checked.
- Rollback path is agreed.

No-go if:

- Any required secret is missing.
- Checkout returns `provider_not_configured` or `provider_error`.
- Callback signature verification fails.
- Invoice balance does not clear after `payment_completed`.
- Voucher or Tax-Free Childcare matching is not automatic.
- Parent portal does not show the final payment state.
- Dates, price or capacity are uncertain.

## 12. Rollback

If payment launch fails:

- Keep the public website live.
- Hide or gate `/launch-booking`.
- Leave bookings in reserved/local invoice state only.
- Keep parent guidance pages available.
- Send PonchoPay the failed response, callback event id and booking/invoice ids.
- Re-run readiness and penny test before reopening live checkout.
