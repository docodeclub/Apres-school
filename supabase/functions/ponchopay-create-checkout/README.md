# PonchoPay checkout creator

Creates the local invoice first, then creates the PonchoPay checkout/payment request when provider credentials are configured.

This function is the server-side entry point for the parent basket:

1. validate parent and basket details,
2. upsert `booking_invoices`,
3. create or update `ponchopay_checkout_sessions`,
4. return the PonchoPay checkout URL when available,
5. leave callback reconciliation to `ponchopay-callback` and `ponchopay-process-events`.

## Deploy

```bash
supabase functions deploy ponchopay-create-checkout
```

## Required secrets before live checkout

```bash
supabase secrets set PONCHOPAY_API_URL=https://pay.ponchopay.com
supabase secrets set PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate
supabase secrets set PONCHOPAY_INTEGRATION_KEY=...
supabase secrets set PUBLIC_SITE_URL=https://www.apres-school.co.uk
```

If `PONCHOPAY_API_URL` or `PONCHOPAY_INTEGRATION_KEY` is missing, the function still prepares the local invoice and checkout session, but returns `requiresProviderConfig: true` and no parent checkout URL. `PONCHOPAY_API_URL` may be the base URL (`https://pay.ponchopay.com`) or the full initiate endpoint.

## Example request

```json
{
  "bookingId": "booking_2026_09_ava",
  "parentEmail": "parent@example.com",
  "parentName": "Ava Parent",
  "paymentMethod": "card",
  "paymentPlan": "pay_now",
  "items": [
    {
      "childName": "Ava",
      "siteName": "Willington Prep",
      "careType": "Wraparound",
      "sessionName": "Session 1",
      "date": "2026-09-03",
      "startTime": "15:30",
      "endTime": "16:00",
      "unitAmount": 6.8
    }
  ]
}
```

## Response states

- `ready_for_payment`: PonchoPay returned a checkout URL.
- `provider_not_configured`: local invoice is prepared but live credentials are missing.
- `provider_error`: PonchoPay returned an error; do not send the parent to checkout.

The function posts to `https://pay.ponchopay.com/api/integration/generic/initiate` by default, using `PONCHOPAY_API_URL` plus `PONCHOPAY_CHECKOUT_PATH`.

## Live penny-test rehearsal

Use the guarded runner before opening bookings to parents. It will only create a checkout when `PONCHOPAY_PENNY_TEST=live` is set, and it refuses amounts over £1.

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PENNY_AMOUNT=0.01 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
node scripts/ponchopay-penny-test.mjs
```

Expected result:

- `status` is `ready_for_payment`,
- `checkoutUrl` is present,
- the checkout session appears in `ponchopay_checkout_sessions`,
- after payment, PonchoPay sends `payment-captured` and `payment-completed`,
- `ponchopay-process-events` marks the invoice paid and creates the receipt.

After the payment callbacks arrive, run the processor manually if it is not scheduled yet:

```bash
PONCHOPAY_PENNY_TEST=live \
PONCHOPAY_PROCESSOR_ONLY=1 \
SUPABASE_PROJECT_REF=PROJECT_REF \
SUPABASE_ANON_KEY=PUBLIC_ANON_KEY \
PONCHOPAY_PROCESSOR_TOKEN=TOKEN \
node scripts/ponchopay-penny-test.mjs
```

If the script returns `provider_not_configured`, set `PONCHOPAY_API_URL`, `PONCHOPAY_CHECKOUT_PATH` and `PONCHOPAY_INTEGRATION_KEY` in Supabase secrets and redeploy this function before repeating the test.
