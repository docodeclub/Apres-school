import { readFileSync } from "node:fs";

const files = {
  checkout: "supabase/functions/ponchopay-create-checkout/index.ts",
  createParentBooking: "supabase/functions/create-parent-booking/index.ts",
  callback: "supabase/functions/ponchopay-callback/index.ts",
  processor: "supabase/functions/ponchopay-process-events/index.ts",
  webhookProxy: "api/ponchopay/webhook.js",
  eventProxy: "api/ponchopay/[event].js",
  envExample: ".env.example",
  stagingEnvExample: ".env.staging.example",
  paymentEventsMigration: "supabase/migrations/0036_booking_payment_events.sql",
  updateBooking: "supabase/functions/update-parent-booking/index.ts",
  paymentActionsMigration: "supabase/migrations/0035_booking_payment_admin_actions.sql",
  unpaidCancellationMigration: "supabase/migrations/0060_normalise_unpaid_cancelled_invoices.sql",
  cancelledFinanceMigration: "supabase/migrations/0061_normalise_cancelled_invoice_finance_states.sql",
  bookingSystem: "src/bookingSystem.js",
  bookingLab: "src/BookingLab.jsx",
  readiness: "scripts/ponchopay-readiness-check.mjs",
  adminSettings: "scripts/ponchopay-admin-settings.mjs",
  locationCheck: "scripts/ponchopay-location-urn-check.mjs",
  ponchoLocations: "src/bookingLab/ponchoLocations.js",
  stagingBundle: "scripts/booking-staging-bundle.mjs",
  stagingHandoff: "scripts/booking-staging-handoff.mjs",
  pennyTest: "scripts/ponchopay-penny-test.mjs",
};

const callbackSlugs = [
  "captured",
  "reported-complete",
  "completed",
  "in-bank",
  "refunded",
  "cancelled",
  "updated",
  "recurring-captured",
  "recurring-set-up",
  "recurring-cancelled",
];

const callbackEvents = [
  "payment_captured",
  "payment_reported_complete",
  "payment_completed",
  "payment_in_bank",
  "payment_refunded",
  "payment_cancelled",
  "payment_updated",
  "recurring_payment_captured",
  "recurring_payment_set_up",
  "recurring_payment_cancelled",
];

const checks = [
  [files.checkout, "checkout token signature", /sha256Base64[\s\S]*metadata[\s\S]*ponchoPayIntegrationKey/],
  [files.checkout, "checkout prefers the current Supabase service key", /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)[\s\S]{0,80}Deno\.env\.get\("APRES_SERVICE_ROLE_KEY"\)/],
  [files.checkout, "parent payment refresh loads booking item status", /booking_items\(id,child_id,child_name,site_name,session_label,starts_at,ends_at,quantity,unit_amount,status,metadata\)/],
  [files.checkout, "parent payment refresh excludes cancelled sessions", /status === "reserved" \|\| status === "confirmed"/],
  [files.checkout, "generic initiate checkout endpoint", /PONCHOPAY_CHECKOUT_PATH[\s\S]*\/api\/integration\/generic\/initiate[\s\S]*ponchoPayCheckoutEndpoint/],
  [files.checkout, "nested checkout url parsing", /data\.checkoutUrl[\s\S]*payment\.checkoutUrl/],
  [files.checkout, "missing checkout url state", /provider_response_missing_checkout_url/],
  [files.checkout, "voucher and TFC require card guarantee", /cardGuaranteeRequired[\s\S]*chargeCardOnFailure[\s\S]*automaticReconciliation/],
  [files.checkout, "card guarantee payment flow", /card_guarantee_with_childcare_reconciliation/],
  [files.checkout, "apres merchant context", /merchantContext: "apres_school"[\s\S]*PONCHOPAY_PROVIDER_ID|providerId: ponchoPayProviderId/],
  [files.checkout, "child name is sent to Poncho additional info", /buildPonchoAdditionalInfo[\s\S]*Child's name[\s\S]*additional_info[\s\S]*child_name/],
  [files.checkout, "pending location urn does not use default", /ponchoLocationStatus[\s\S]*locationStatus === "pending" \? "" : ponchoPayLocationUrnDefault/],
  [files.checkout, "single PonchoPay webhook callback URL", /\/api\/ponchopay\/webhook[\s\S]*callbacks/],
  [files.checkout, "separate PonchoPay callback fields", /paymentCapturedCallbackUrl[\s\S]*paymentCompletedCallbackUrl[\s\S]*recurringPaymentCancelledCallbackUrl/],
  [files.checkout, "redirects use the POST-safe return handler", /\/api\/ponchopay_redirect\?payment=pending[\s\S]*\/api\/ponchopay_redirect\?payment=cancelled/],
  [files.callback, "alternate signature headers", /x-ponchopay-signature[\s\S]*x-webhook-signature/],
  [files.callback, "callback prefers the current Supabase service key", /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)[\s\S]{0,80}Deno\.env\.get\("APRES_SERVICE_ROLE_KEY"\)/],
  [files.callback, "webhook secret supported", /PONCHOPAY_WEBHOOK_SECRET[\s\S]*ponchoPayWebhookSecret/],
  [files.callback, "signature is compared to generated candidates only", /unprefixedSignature[\s\S]*sha256=/],
  [files.callback, "nested callback payload support", /objectValue\(payload\.data\)[\s\S]*objectValue\(payload\.payment\)/],
  [files.callback, "normalised guarantee and fallback events", /guarantee_created[\s\S]*fallback_card_charged/],
  [files.callback, "recurring payment callbacks accepted", /recurring_payment_captured[\s\S]*recurring_payment_set_up[\s\S]*recurring_payment_cancelled/],
  [files.callback, "generic booking payment events mirror", /booking_payment_events[\s\S]*provider: "ponchopay"/],
  [files.webhookProxy, "public webhook proxy keeps raw body", /bodyParser: false[\s\S]*readRawBody/],
  [files.webhookProxy, "public webhook proxy forwards signature", /x-ponchopay-signature[\s\S]*x-webhook-signature/],
  [files.eventProxy, "public event callback proxy maps Poncho fields", /captured: "payment-captured"[\s\S]*"recurring-cancelled": "recurring-payment-cancelled"/],
  [files.eventProxy, "public event callback proxy keeps raw body", /bodyParser: false[\s\S]*readRawBody/],
  [files.adminSettings, "admin settings emits Poncho callback fields", /Payment captured URL[\s\S]*Recurring payment cancelled URL[\s\S]*Payment completed redirect/],
  [files.adminSettings, "admin settings emits shared webhook alternative", /sharedWebhookAlternative[\s\S]*\/api\/ponchopay\/webhook/],
  [files.pennyTest, "penny test dry run preview", /--dry-run[\s\S]*mode: "dry_run"[\s\S]*ponchoCheckoutEndpoint/],
  [files.ponchoLocations, "known PonchoPay location URNs", /King's House School": "2801558"[\s\S]*Rosemead Preparatory School": "2824761"[\s\S]*Ripley Court": "IUcCfoT4"[\s\S]*Shrewsbury House School": "IUYmDzCq"[\s\S]*Willington Prep": "2764313"/],
  [files.ponchoLocations, "no pending PonchoPay locations", /PONCHOPAY_LOCATION_PENDING = \[\]/],
  [files.locationCheck, "location check reports configured and pending", /configured[\s\S]*pending[\s\S]*unexpectedMissing/],
  [files.processor, "booking state update", /updateBookingFromInvoice/],
  [files.processor, "reported-complete callbacks cannot downgrade secured payments", /case "payment_reported_complete":[\s\S]*isSecuredPaymentStatus\(base\.payment_status\)[\s\S]*existing secured state retained/],
  [files.processor, "credited cancellations are terminal booking states", /normaliseTerminalParentBookings[\s\S]*"cancelled_credit"[\s\S]*normaliseAllTerminalBookings[\s\S]*"cancelled_credit"/],
  [files.processor, "confirmed booking items after payment", /from\("booking_items"\)[\s\S]*status: "confirmed"/],
  [files.processor, "guarantee does not confirm booking", /payment_guaranteed[\s\S]*return "payment_pending"/],
  [files.processor, "childcare reconciliation confirms booking", /payment_reconciled[\s\S]*paid_by_fallback_card[\s\S]*return "confirmed"/],
  [files.processor, "recurring payments processed", /recurring_payment_set_up[\s\S]*recurring_payment_captured[\s\S]*recurring_payment_cancelled/],
  [files.processor, "processor returns booking confirmation evidence", /bookingStatus[\s\S]*receiptId/],
  [files.processor, "receipt idempotency", /onConflict: "provider_event_id"/],
  [files.processor, "verified paid checkout recovery", /reconcile_paid_checkout_booking[\s\S]*reconcilePaidCheckoutBooking/],
  [files.processor, "terminal bookings release stale capacity holds", /normaliseTerminalParentBookings[\s\S]*booking_capacity_holds[\s\S]*released_at/],
  [files.processor, "global terminal booking cleanup defaults to dry run", /normalise_all_terminal_bookings[\s\S]*body\.dryRun !== false/],
  [files.processor, "global terminal booking cleanup is audited", /all_terminal_payment_bookings_normalised/],
  [files.processor, "payment audit includes cancellation credit ledger", /auditParentPayments[\s\S]*parent_account_credit_entries[\s\S]*creditEntries/],
  [files.paymentEventsMigration, "generic booking payment events table", /create table if not exists booking_payment_events[\s\S]*unique \(provider, provider_event_id\)/],
  [files.envExample, "separate Apres PonchoPay merchant env", /PONCHOPAY_PROVIDER_ID[\s\S]*PONCHOPAY_LOCATION_URN_DEFAULT/],
  [files.stagingEnvExample, "staging webhook secret env", /PONCHOPAY_WEBHOOK_SECRET[\s\S]*PONCHOPAY_PROVIDER_ID/],
  [files.paymentActionsMigration, "payment admin action ledger", /booking_payment_admin_actions[\s\S]*invoice_id text not null/],
  [files.updateBooking, "payment admin endpoint actions", /resend_payment_link[\s\S]*resend_receipt[\s\S]*mark_finance_review/],
  [files.updateBooking, "payment admin queues email logs", /booking_payment_link[\s\S]*booking_payment_receipt[\s\S]*email_logs/],
  [files.updateBooking, "payment admin updates invoice finance status", /finance_status[\s\S]*parent_portal_status/],
  [files.bookingSystem, "frontend invokes payment admin action", /updateLivePaymentAdminAction[\s\S]*update-parent-booking/],
  [files.bookingSystem, "parent booking surfaces the function response message", /error\.context\?\.json[\s\S]*responseBody\?\.error/],
  [files.createParentBooking, "outstanding balance message tells parents where to pay", /Open Payments & credit in your family account and select Pay now/],
  [files.createParentBooking, "booking checkout separates active sessions from removed sessions", /const bookableItems = savedItems\.filter/],
  [files.bookingLab, "launch opens hosted PonchoPay checkout", /openPonchoCheckoutWindow[\s\S]*window\.open\(checkoutUrl/],
  [files.bookingLab, "launch blocks payment without a durable booking", /if \(!realBookingResult\?\.booking\)[\s\S]*no payment has been opened[\s\S]*return;/],
  [files.bookingLab, "parent voucher copy includes card guarantee", /Card guarantee[\s\S]*guaranteed card can be charged/],
  [files.bookingLab, "launch copy avoids premature confirmation", /booking confirms only after payment is authorised/],
  [files.bookingLab, "cancellation wording follows net posted credit", /netPostedCreditAmount[\s\S]*Credit applied to account[\s\S]*Payment refunded[\s\S]*No payment taken/],
  [files.unpaidCancellationMigration, "unpaid cancelled invoices use terminal cancellation state", /cancelled_without_payment[\s\S]*Cancelled; no payment taken[\s\S]*cancelled_no_balance/],
  [files.cancelledFinanceMigration, "cancelled invoices distinguish credit refund and unpaid states", /Cancelled; no payment taken[\s\S]*Cancelled; payment refunded[\s\S]*Cancelled; credit applied to account/],
];

const failures = [];
for (const [file, label, pattern] of checks) {
  const content = readFileSync(file, "utf8");
  if (!pattern.test(content)) failures.push({ file, label });
}

for (const file of [files.readiness, files.stagingBundle, files.stagingHandoff]) {
  const content = readFileSync(file, "utf8");
  for (const slug of callbackSlugs) {
    if (!content.includes(slug)) failures.push({ file, label: `callback slug ${slug}` });
  }
}

const callbackFunction = readFileSync(files.callback, "utf8");
for (const eventName of callbackEvents) {
  if (!callbackFunction.includes(eventName)) failures.push({ file: files.callback, label: `callback event ${eventName}` });
}

const report = {
  ponchoPayContractReady: failures.length === 0,
  checkedAt: new Date().toISOString(),
  checks: checks.length + callbackSlugs.length * 4,
  failures,
};

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
