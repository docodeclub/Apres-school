export const PONCHOPAY_API_REQUIREMENTS = [
  ["Integration key", "Needed", "Store server-side only before creating live payment sessions."],
  ["Callback URLs", "Needed", "Configure lifecycle callback URLs in PonchoPay API Integration settings."],
  ["Webhook signing", "Required", "Verify the raw request body with HMAC-SHA256 and the PonchoPay signature header before parsing JSON."],
  ["Idempotency", "Required", "Each booking, invoice and webhook event needs a stable external reference."],
  ["Demo account", "Needed", "PonchoPay requires callback URLs to be set in demo admin before callback testing."],
];

export const PONCHOPAY_LIVE_WEBHOOKS = [
  ["payment_captured", "Reserve/checkpoint", "Card pre-authorisation captured or card/express TFC completed."],
  ["payment_reported_complete", "Parent reported", "Voucher/TFC payer has marked the external payment as complete."],
  ["payment_completed", "Funds matched", "Payment is processed or identified in-bank; issue receipt and clear balance."],
  ["payment_in_bank", "Bank matched", "PonchoPay has identified the payment in the provider bank account where supported."],
  ["payment_refunded", "Refund recorded", "Refund has been created in PonchoPay; raise credit and audit the balance change."],
  ["payment_cancelled", "Payment cancelled", "Payment cancelled inside PonchoPay; keep booking visible and route parent/admin action."],
  ["payment_updated", "Payment changed", "Amount or payment method changed inside PonchoPay; re-check invoice and reconciliation state."],
];

export const PONCHOPAY_CALLBACK_ENDPOINTS = [
  {
    event: "payment_captured",
    path: "/api/payments/ponchopay/callbacks/payment-captured",
    parentState: "Reserved",
    invoiceAction: "Keep receipt pending unless the payment route is card/express TFC and completion also arrives.",
  },
  {
    event: "payment_reported_complete",
    path: "/api/payments/ponchopay/callbacks/payment-reported-complete",
    parentState: "Matching",
    invoiceAction: "Show invoice as outstanding but reassure the parent that the place remains reserved.",
  },
  {
    event: "payment_completed",
    path: "/api/payments/ponchopay/callbacks/payment-completed",
    parentState: "Paid",
    invoiceAction: "Clear the invoice, issue receipt, email parent and unlock finance export.",
  },
  {
    event: "payment_in_bank",
    path: "/api/payments/ponchopay/callbacks/payment-in-bank",
    parentState: "Bank confirmed",
    invoiceAction: "Mark the provider bank match and close voucher/TFC reconciliation risk where supported.",
  },
  {
    event: "payment_refunded",
    path: "/api/payments/ponchopay/callbacks/payment-refunded",
    parentState: "Credit updated",
    invoiceAction: "Create or update credit, keep original receipt audit and notify finance.",
  },
  {
    event: "payment_cancelled",
    path: "/api/payments/ponchopay/callbacks/payment-cancelled",
    parentState: "Action needed",
    invoiceAction: "Reopen balance, preserve the booking state and ask parent/admin to choose the next route.",
  },
  {
    event: "payment_updated",
    path: "/api/payments/ponchopay/callbacks/payment-updated",
    parentState: "Checking",
    invoiceAction: "Recalculate invoice/payment attempt and flag mismatch if amount or method no longer agrees.",
  },
];

export const PONCHOPAY_SIGNATURE_CHECKS = [
  ["Raw body", "Read request body as text before JSON parsing."],
  ["Header", "Require the PonchoPay signature header on every callback request."],
  ["HMAC", "Calculate HMAC-SHA256 using the integration key and raw payload."],
  ["Encoding", "Compare the computed hash as URL-safe base64."],
  ["Dedupe", "Only mutate invoice state after signature passes and provider event id has not been processed."],
];

export const PONCHOPAY_EXCEPTION_PLAYBOOK = [
  ["No callback", "Keep invoice pending", "Parent reminder uses the configured payment window; finance sees missing reference."],
  ["Captured, not complete", "Reserve place", "Do not receipt yet; show pending copy and watch for completion."],
  ["Completed mismatch", "Hold receipt", "Route to finance review and preserve parent-facing reassurance."],
  ["Duplicate webhook", "Ignore safely", "Use idempotency key and payment reference before mutating invoice state."],
];

export const PONCHOPAY_PARENT_STATES = [
  ["Paid", "Receipt available", "Card payment or matched voucher/TFC clears the parent balance immediately."],
  ["Pending", "Place reserved", "Voucher/TFC reference is saved and the invoice remains visible until PonchoPay matches it."],
  ["Delayed", "We are checking it", "Parent gets reassuring copy; finance sees the row in mismatch or awaiting-match queues."],
  ["Failed", "Retry payment", "Parent can retry card or choose another permitted route without losing the booking."],
];

export const PONCHOPAY_ADAPTER_CONTRACT = [
  ["createCheckoutSession", "Backend only", "Create provider session from booking, invoice, amount, parent and allowed routes."],
  ["handleWebhook", "Signed callback", "Verify raw-body HMAC signature, dedupe by event id and map provider status to invoice state."],
  ["reconcileReference", "Finance job", "Match TFC/voucher references to outstanding invoices without manual spreadsheet work."],
  ["issueReceipt", "After completion", "Send receipt and mark invoice paid only after completed or matched payment."],
];

export const PONCHOPAY_WEBHOOK_EVENT_MAP = [
  ["payment_captured", "Card receipt", "Clear invoice only when capture confirms funds or provider says the payment is safe to reserve."],
  ["payment_failed", "Retry needed", "Keep the place reserved, show retry copy and alert finance if repeated."],
  ["payment_reference_saved", "Awaiting match", "Parent sees invoice outstanding while PonchoPay watches TFC/voucher feeds."],
  ["payment_reference_missing", "Reminder due", "Send parent reminder before the configured reference window closes."],
  ["payment_mismatch", "Finance review", "Hold receipt, show pending copy and route to admin/finance exception queue."],
  ["refund_created", "Credit raised", "Parent portal shows account credit and finance keeps liability visible."],
];

export const PONCHOPAY_BACKEND_ROUTES = [
  {
    method: "POST",
    path: "/api/payments/ponchopay/checkout",
    owner: "Parent checkout",
    purpose: "Create a PonchoPay payment session from an approved booking quote.",
    request: "bookingId, invoiceId, amount, parent, children, allowedRoutes, idempotencyKey",
    response: "checkoutUrl, providerPaymentId, invoiceStatus, expiresAt",
    guardrail: "Runs server-side only; confirms capacity and quote hash before creating the provider session.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-captured",
    owner: "PonchoPay webhook",
    purpose: "Record captured card or express childcare payment state.",
    request: "raw body, signature header, eventId, paymentId, amount, reference, status",
    response: "eventAccepted, invoiceStatus, parentStatus",
    guardrail: "Verify signature, dedupe eventId and avoid issuing receipt until completion rules pass.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-reported-complete",
    owner: "PonchoPay webhook",
    purpose: "Mark voucher or TFC payment as parent-reported while funds are matched.",
    request: "raw body, signature header, eventId, paymentId, providerReference, reportedAt, amount",
    response: "eventAccepted, invoiceStatus, financeLane",
    guardrail: "Keeps invoice pending but reassures the parent that the place is reserved.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-completed",
    owner: "PonchoPay webhook",
    purpose: "Clear matched card, voucher or TFC money and issue the receipt.",
    request: "raw body, signature header, eventId, paymentId, settledAmount, settledAt, providerReference",
    response: "eventAccepted, invoiceStatus, receiptId",
    guardrail: "Only clears the balance when amount, invoice and booking references all match.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-in-bank",
    owner: "PonchoPay webhook",
    purpose: "Record PonchoPay bank-account identification for supported payment routes.",
    request: "raw body, signature header, eventId, paymentId, bankMatchedAt, providerReference",
    response: "eventAccepted, bankMatchStatus, financeLane",
    guardrail: "Do not treat manually reported voucher/TFC money as fully safe until completion/in-bank rules are satisfied.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-updated",
    owner: "PonchoPay webhook",
    purpose: "Re-check invoice/payment attempt after PonchoPay changes amount or payment method.",
    request: "raw body, signature header, eventId, paymentId, previousState, nextState",
    response: "eventAccepted, invoiceStatus, mismatchLane",
    guardrail: "Flag finance review if the updated amount, invoice or route no longer matches our booking quote.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-refunded",
    owner: "PonchoPay webhook",
    purpose: "Record PonchoPay refund state and update parent credit or invoice balance.",
    request: "raw body, signature header, eventId, paymentId, refundAmount, refundedAt",
    response: "eventAccepted, creditStatus, invoiceStatus",
    guardrail: "Never erase the original receipt; append credit/refund audit events and notify finance.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/callbacks/payment-cancelled",
    owner: "PonchoPay webhook",
    purpose: "Record a cancellation inside PonchoPay and reopen payment action in the parent portal.",
    request: "raw body, signature header, eventId, paymentId, cancelledAt, reason",
    response: "eventAccepted, invoiceStatus, parentAction",
    guardrail: "Keep the booking record visible and route payment action instead of silently deleting a place.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/reconcile",
    owner: "Finance job",
    purpose: "Run automatic matching for voucher/TFC references and exception rows.",
    request: "dateRange, siteIds, dryRun",
    response: "matched, pending, mismatches, exportRows",
    guardrail: "Supports dry-run before mutating invoice state or generating finance exports.",
  },
  {
    method: "POST",
    path: "/api/payments/ponchopay/receipts/:invoiceId",
    owner: "Finance/admin",
    purpose: "Resend or regenerate a receipt after a payment is completed.",
    request: "invoiceId, deliveryChannel, actorId, reason",
    response: "receiptId, sentAt, auditEventId",
    guardrail: "Requires finance/admin permission and appends an immutable audit event.",
  },
];

export const PONCHOPAY_DATA_MODEL = [
  {
    entity: "invoices",
    owner: "Parent / finance",
    stores: "invoice number, booking id, parent id, total, balance, due dates, status, payment route and receipt state",
    links: "bookings, families, payment_attempts, receipts",
    launchRule: "Every confirmed booking creates one invoice before any payment session starts.",
  },
  {
    entity: "payment_attempts",
    owner: "Provider adapter",
    stores: "provider payment id, invoice id, method, amount, idempotency key, checkout URL, status and expiry",
    links: "invoices, webhook_events, reconciliation_rows",
    launchRule: "Attempts are append-only; retries create new attempts instead of overwriting the failed one.",
  },
  {
    entity: "webhook_events",
    owner: "PonchoPay callback",
    stores: "event id, event type, raw payload hash, received time, signature result, processed time and processing outcome",
    links: "payment_attempts, invoices, audit_events",
    launchRule: "Dedupe by provider event id before mutating invoices or balances.",
  },
  {
    entity: "reconciliation_rows",
    owner: "Finance job",
    stores: "provider reference, expected amount, received amount, match confidence, mismatch reason and finance lane",
    links: "invoices, payment_attempts, receipts",
    launchRule: "Voucher and TFC rows remain pending until matched amount and invoice reference agree.",
  },
  {
    entity: "receipts",
    owner: "Finance/admin",
    stores: "receipt number, invoice id, payment attempt id, sent channel, sent time, PDF/export path and resend count",
    links: "invoices, families, messages, audit_events",
    launchRule: "Receipts are issued only after completed payment or approved reconciliation.",
  },
  {
    entity: "payment_audit_events",
    owner: "System",
    stores: "actor, action, previous state, next state, reason, source IP/session and created time",
    links: "invoices, payment_attempts, webhook_events, admin users",
    launchRule: "Admin overrides, receipt resends, mismatch resolutions and refunds require an audit event.",
  },
];

export const PONCHOPAY_SANDBOX_WEBHOOKS = [
  {
    eventType: "payment_captured",
    label: "Captured",
    parentState: "Place reserved",
    resultStatus: "Payment reference pending",
    detail: "Card authorisation or express payment captured; wait for completed callback before receipt.",
  },
  {
    eventType: "payment_reported_complete",
    label: "Reported complete",
    parentState: "We are matching it",
    resultStatus: "Payment reference pending",
    detail: "Parent/provider reports a voucher or TFC payment; invoice remains pending until matched.",
  },
  {
    eventType: "payment_completed",
    label: "Completed",
    parentState: "Receipt available",
    resultStatus: "Prototype paid",
    detail: "Funds are matched; clear the invoice, receipt the parent and write finance audit.",
  },
  {
    eventType: "payment_failed",
    label: "Failed",
    parentState: "Retry payment",
    resultStatus: "Payment failed",
    detail: "Provider reports failure; keep booking visible and prompt parent to retry or change route.",
  },
  {
    eventType: "payment_mismatch",
    label: "Mismatch",
    parentState: "Finance review",
    resultStatus: "Payment mismatch",
    detail: "Provider amount/reference does not match invoice; hold receipt and route to finance.",
  },
];

export function normalisePonchoPayMethod(method = "") {
  if (method === "tax-free") return "tfc";
  if (method === "childcare-voucher") return "voucher";
  return method || "card";
}

export function buildPonchoPayCheckoutPayload(draft = {}, options = {}) {
  const amount = Math.max(0, Number(options.amount ?? draft.total ?? 0));
  const method = normalisePonchoPayMethod(draft.paymentMethod);
  const bookingId = draft.id || `draft-${Date.now()}`;
  const invoiceId = draft.invoiceNumber || draft.invoiceId || `invoice-${bookingId}`;
  const children = Array.isArray(draft.children) && draft.children.length
    ? draft.children
    : [draft.childName].filter(Boolean);

  return {
    provider: "PonchoPay",
    mode: options.mode || "sandbox",
    idempotencyKey: options.idempotencyKey || `apres:${bookingId}:${invoiceId}:${amount.toFixed(2)}:${options.reason || "checkout"}`,
    bookingId,
    invoiceId,
    amount,
    currency: "GBP",
    parent: {
      name: draft.parentName || "Parent",
      email: draft.parentEmail || "",
    },
    booking: {
      site: draft.site || "",
      activity: draft.activity || "",
      days: draft.days || [],
      children,
    },
    allowedRoutes: method === "card" ? ["card"] : ["card", "tax_free_childcare", "childcare_voucher"],
    preferredRoute: method === "tfc" ? "tax_free_childcare" : method === "voucher" ? "childcare_voucher" : "card",
    callbackUrls: {
      payment_captured: options.capturedUrl || "/api/ponchopay/captured",
      payment_reported_complete: options.reportedCompleteUrl || "/api/ponchopay/reported-complete",
      payment_completed: options.completedUrl || "/api/ponchopay/completed",
      payment_in_bank: options.inBankUrl || "/api/ponchopay/in-bank",
      payment_refunded: options.refundedUrl || "/api/ponchopay/refunded",
      payment_cancelled: options.cancelledUrl || "/api/ponchopay/cancelled",
      payment_updated: options.updatedUrl || "/api/ponchopay/updated",
    },
    callbackSecurity: {
      signatureHeader: "signature",
      algorithm: "HMAC-SHA256",
      bodyMode: "raw text before JSON parse",
      encoding: "base64url",
    },
    metadata: {
      source: "booking-lab",
      reason: options.reason || "booking_checkout",
      schoolSite: draft.site || "",
      childCount: Number(draft.childCount || children.length || 0),
      originalTotal: Number(draft.total || 0),
    },
  };
}

export function buildPonchoPayWebhookPayload(draft = {}, eventType = "payment_completed", options = {}) {
  const checkout = buildPonchoPayCheckoutPayload(draft, options);
  const amount = Math.max(0, Number(draft.total || checkout.amount || 0));
  const eventId = `${eventType}_${draft.id || "draft"}_${Date.now()}`;
  const receivedAmount = eventType === "payment_mismatch" ? Math.max(0, amount - 5) : amount;

  return {
    eventId,
    eventType,
    provider: "PonchoPay",
    mode: options.mode || "sandbox",
    paymentId: draft.paymentReference || `ppay_${String(Date.now()).slice(-8)}`,
    invoiceId: checkout.invoiceId,
    bookingId: checkout.bookingId,
    amount: receivedAmount,
    expectedAmount: amount,
    currency: "GBP",
    providerReference: draft.paymentReference || `PP-${String(Date.now()).slice(-6)}`,
    status: eventType.replace("payment_", ""),
    signatureStatus: options.signatureStatus || "simulated_valid",
    receivedAt: new Date().toISOString(),
  };
}

export function normalisePonchoPayRow(row = {}) {
  const method = normalisePonchoPayMethod(row.method);
  const expected = Math.max(0, Number(row.total || 0) - Number(row.credit || 0));
  const received = Number.isFinite(Number(row.receivedAmount))
    ? Number(row.receivedAmount)
    : row.status === "Prototype paid"
      ? expected
      : row.status === "Partially refunded"
        ? Math.max(0, expected - Number(row.credit || 0))
        : 0;
  const hasReference = method === "card" || Boolean(row.reference);
  const confidence = row.status === "Prototype paid" && hasReference ? "High" : hasReference ? "Medium" : "Low";
  const reconcileState = row.status === "Prototype paid"
    ? "Auto reconciled"
    : row.status === "Payment failed"
      ? "Failed"
      : row.mismatchReason
        ? "Mismatch"
        : hasReference
          ? "Ready to match"
          : "Reference needed";

  return {
    ...row,
    method,
    expected,
    received,
    balance: Math.max(0, expected - received),
    confidence,
    reconcileState,
    actionNeeded: ["Failed", "Mismatch", "Reference needed"].includes(reconcileState),
    ponchoCheckoutPayload: buildPonchoPayCheckoutPayload(row.draft || row),
  };
}
