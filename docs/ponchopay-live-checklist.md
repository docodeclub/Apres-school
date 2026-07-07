# PonchoPay Live Checklist

Use this when PonchoPay sends the real API details. Keep this admin/finance only until the live penny test has passed.

## 1. Details To Receive From PonchoPay

- API endpoint for creating a payment or checkout.
- Integration key or signing secret.
- Signature header name and expected HMAC/body format.
- Test card or approved penny-test payment method.
- Confirmation of which routes auto reconcile: card, childcare vouchers and Tax-Free Childcare.
- Required callback URLs and event names.
- Any payload fields they require that differ from our current neutral checkout payload.

Record the credential pack before changing secrets:

```text
PonchoPay API URL:
Integration key / signing secret:
Signature header name:
Signature algorithm:
Checkout create method and path: `POST https://pay.ponchopay.com/api/integration/generic/initiate`
Test payment method:
Support contact:
```

Do not paste these values into frontend `.env` files or commit them to the repo.

## 2. Supabase Secrets

Set these as Supabase Edge Function secrets, not Vercel frontend variables:

```bash
supabase secrets set PONCHOPAY_API_URL=https://pay.ponchopay.com
supabase secrets set PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate
supabase secrets set PONCHOPAY_INTEGRATION_KEY=...
supabase secrets set PONCHOPAY_PROCESSOR_TOKEN=...
supabase secrets set PUBLIC_SITE_URL=https://www.apres-school.co.uk
supabase secrets set APRES_SERVICE_ROLE_KEY=...
```

Keep `PONCHOPAY_API_URL`, `PONCHOPAY_INTEGRATION_KEY`, `PONCHOPAY_PROCESSOR_TOKEN` and `APRES_SERVICE_ROLE_KEY` out of frontend code.

Then run the readiness check. It should return `"ok": true`.

```bash
SUPABASE_PROJECT_REF=PROJECT_REF \
PONCHOPAY_API_URL=... \
PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate \
PONCHOPAY_INTEGRATION_KEY=... \
PUBLIC_SITE_URL=https://www.apres-school.co.uk \
APRES_SERVICE_ROLE_KEY=... \
node scripts/ponchopay-readiness-check.mjs
```

Current pre-credential state is expected to fail if the local shell does not have the real Supabase project reference, PonchoPay endpoint, integration key or service role key.

## 3. Deploy Functions

```bash
supabase functions deploy ponchopay-create-checkout
supabase functions deploy ponchopay-callback --no-verify-jwt
supabase functions deploy ponchopay-process-events
```

The callback function is deployed without JWT verification because PonchoPay, not a signed-in website user, calls it. It still verifies the PonchoPay signature before storing events.

## 4. Callback URLs

Use the public site callback URLs in PonchoPay admin:

| PonchoPay event | Callback URL |
| --- | --- |
| Payment captured URL | `https://www.apres-school.co.uk/api/ponchopay/captured` |
| Payment reported complete URL | `https://www.apres-school.co.uk/api/ponchopay/reported-complete` |
| Payment completed URL | `https://www.apres-school.co.uk/api/ponchopay/completed` |
| Payment in bank URL | `https://www.apres-school.co.uk/api/ponchopay/in-bank` |
| Payment refunded URL | `https://www.apres-school.co.uk/api/ponchopay/refunded` |
| Payment cancelled URL | `https://www.apres-school.co.uk/api/ponchopay/cancelled` |
| Payment updated URL | `https://www.apres-school.co.uk/api/ponchopay/updated` |

Run the local readiness check to print the same URLs:

```bash
SUPABASE_PROJECT_REF=PROJECT_REF \
PONCHOPAY_API_URL=... \
PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate \
PONCHOPAY_INTEGRATION_KEY=... \
PUBLIC_SITE_URL=https://www.apres-school.co.uk \
APRES_SERVICE_ROLE_KEY=... \
node scripts/ponchopay-readiness-check.mjs
```

Dry-run shape with dummy values:

```bash
SUPABASE_PROJECT_REF=project-ref \
PONCHOPAY_API_URL=https://pay.ponchopay.com \
PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate \
PONCHOPAY_INTEGRATION_KEY=dummy \
PUBLIC_SITE_URL=https://www.apres-school.co.uk \
APRES_SERVICE_ROLE_KEY=dummy \
node scripts/ponchopay-readiness-check.mjs
```

## 5. Live Penny Test

Create one real checkout only after secrets and callback URLs are in place:

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PENNY_AMOUNT=0.01 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
node scripts/ponchopay-penny-test.mjs
```

Pass criteria:

- The response status is `ready_for_payment`.
- A `checkoutUrl` is returned.
- The checkout row is visible in `ponchopay_checkout_sessions`.
- The penny payment sends `payment-captured` and `payment-completed`.
- `ponchopay_webhook_events` stores the signed callback.
- Duplicate callback replay is ignored.
- `booking_invoices` shows paid/balance clear.
- `booking_receipts` has a receipt row.
- The parent-facing invoice state says paid.

Record evidence:

```text
Penny test date/time:
Checkout session id:
PonchoPay payment id:
Booking id:
Invoice id:
Callback event ids:
Receipt id:
Result:
```

After callbacks arrive, run the processor if it is not scheduled:

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PROCESSOR_ONLY=1 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
PONCHOPAY_PROCESSOR_TOKEN=TOKEN \
node scripts/ponchopay-penny-test.mjs
```

## 6. Go/No-Go Rule

Open parent bookings only when all of these are true:

- Card payment creates a checkout URL.
- Voucher and Tax-Free Childcare references can be saved against an invoice.
- PonchoPay callbacks are signed and stored.
- `payment_completed` clears an invoice and creates a receipt.
- Duplicate callbacks do not double-charge or double-receipt.
- Failed/mismatched callbacks remain visible to finance and do not confirm paid.
- Parent portal shows paid/unpaid state and payment method correctly.

No-go states:

- Readiness check returns `"ok": false`.
- Checkout creation returns `provider_not_configured`.
- Checkout creation returns `provider_error`.
- Callback signature validation fails.
- `payment_completed` is received but invoice balance does not clear.
- Duplicate callback creates a second receipt.
- Voucher or Tax-Free Childcare payment cannot be matched automatically.
- Parent portal does not reflect the final paid/unpaid state.

## 7. Rollback

If the penny test fails:

- Do not expose PonchoPay checkout to parents.
- Leave parent booking in local invoice/reserved mode.
- Keep the public payment guidance page live, but do not publish live booking links.
- Send the failed provider response and callback event id to PonchoPay.
- Re-run the penny test after the mapping or credential issue is fixed.
