import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  "";
const ponchoPayApiUrl = Deno.env.get("PONCHOPAY_API_URL") ?? "";
const ponchoPayCheckoutPath = Deno.env.get("PONCHOPAY_CHECKOUT_PATH") ?? "/api/integration/generic/initiate";
const ponchoPayIntegrationKey =
  Deno.env.get("PONCHOPAY_INTEGRATION_KEY") ??
  Deno.env.get("PONCHOPAY_DEMO_INTEGRATION_KEY") ??
  "";
const ponchoPayProviderId = Deno.env.get("PONCHOPAY_PROVIDER_ID") ?? "";
const ponchoPayLocationUrnDefault = Deno.env.get("PONCHOPAY_LOCATION_URN_DEFAULT") ?? "";
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.apres-school.co.uk";

const ponchoPayLocationUrns: Record<string, string> = {
  "King's House School": "2801558",
  "Rosemead Preparatory School": "2824761",
  "Ripley Court": "IUcCfoT4",
  "Ripley Court School": "IUcCfoT4",
  "Shrewsbury House School": "IUYmDzCq",
  "Willington": "2764313",
  "Willington Prep": "2764313",
};

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type CheckoutItem = {
  id?: string;
  childId?: string;
  childName?: string;
  siteId?: string;
  siteName?: string;
  careType?: string;
  sessionId?: string;
  sessionName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  quantity?: number;
  unitAmount?: number;
};

type CheckoutRequest = {
  bookingId?: string;
  invoiceId?: string;
  parentId?: string;
  parentEmail?: string;
  parentName?: string;
  paymentMethod?: string;
  paymentPlan?: string;
  currency?: string;
  amount?: number;
  successUrl?: string;
  cancelUrl?: string;
  items?: CheckoutItem[];
  metadata?: Record<string, unknown>;
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);

  try {
    const submitted = await request.json().catch(() => null) as CheckoutRequest | null;
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const body = await trustedCheckoutRequest(submitted, token);
    const validationError = validateCheckoutRequest(body);
    if (validationError || !body) return json({ error: validationError || "Checkout payload is required" }, 400);

    const invoiceId = stableInvoiceId(body);
    const amount = moneyValue(body.amount) > 0 ? moneyValue(body.amount) : checkoutTotal(body.items || []);
    const currency = stringValue(body.currency) || "GBP";
    const paymentMethod = normalisePaymentMethod(body.paymentMethod);
    const paymentPlan = normalisePaymentPlan(body.paymentPlan);
    const providerReference = `APRES-${invoiceId.replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase()}`;
    const checkoutPayload = buildPonchoPayPayload(body, {
      invoiceId,
      amount,
      currency,
      paymentMethod,
      paymentPlan,
      providerReference,
    });

    await upsertInvoice({
      invoiceId,
      bookingId: stringValue(body.bookingId),
      parentId: stringValue(body.parentId),
      parentEmail: stringValue(body.parentEmail),
      amount,
      currency,
      providerReference,
      metadata: {
        source: "ponchopay-create-checkout",
        paymentMethod,
        paymentPlan,
        parentName: stringValue(body.parentName),
        items: body.items,
        ...(isObject(body.metadata) ? body.metadata : {}),
      },
    });

    const provider = await createPonchoPayPayment(checkoutPayload);
    await upsertCheckoutSession({
      invoiceId,
      bookingId: stringValue(body.bookingId),
      parentId: stringValue(body.parentId),
      parentEmail: stringValue(body.parentEmail),
      amount,
      currency,
      paymentMethod,
      paymentPlan,
      providerReference,
      requestPayload: checkoutPayload,
      providerResponse: provider.response,
      providerPaymentId: provider.paymentId,
      providerCheckoutUrl: provider.checkoutUrl,
      status: provider.status,
      errorMessage: provider.errorMessage,
      expiresAt: provider.expiresAt,
    });

    await supabase.from("audit_log").insert({
      action: "ponchopay_checkout_created",
      table_name: "ponchopay_checkout_sessions",
      metadata: {
        invoiceId,
        bookingId: stringValue(body.bookingId),
        amount,
        currency,
        paymentMethod,
        paymentPlan,
        providerPaymentId: provider.paymentId,
        status: provider.status,
      },
    });

    return json({
      checkoutCreated: true,
      invoiceId,
      bookingId: stringValue(body.bookingId) || null,
      amount,
      currency,
      paymentMethod,
      paymentPlan,
      providerReference,
      status: provider.status,
      providerPaymentId: provider.paymentId,
      checkoutUrl: provider.checkoutUrl,
      requiresProviderConfig: provider.status === "provider_not_configured",
      message: provider.message,
    });
  } catch (error) {
    console.error(error);
    return json({ error: errorMessage(error) || "Unable to create PonchoPay checkout" }, error instanceof HttpError ? error.status : 500);
  }
});

function validateCheckoutRequest(body: CheckoutRequest | null) {
  if (!body || typeof body !== "object") return "Checkout payload is required";
  if (!stringValue(body.parentEmail) && !stringValue(body.parentId)) return "Parent id or email is required";
  if (!Array.isArray(body.items) || !body.items.length) return "At least one booking item is required";
  const total = moneyValue(body.amount) > 0 ? moneyValue(body.amount) : checkoutTotal(body.items);
  if (total <= 0) return "Checkout total must be greater than zero";
  const invalidItem = body.items.find((item) => !stringValue(item.date) || !stringValue(item.sessionName) || moneyValue(item.unitAmount) <= 0);
  if (invalidItem) return "Each item needs a date, session name and positive unit amount";
  return null;
}

function stableInvoiceId(body: CheckoutRequest) {
  return stringValue(body.invoiceId) || `inv_${stringValue(body.bookingId) || crypto.randomUUID()}`;
}

function checkoutTotal(items: CheckoutItem[]) {
  return roundMoney(items.reduce((sum, item) => sum + moneyValue(item.unitAmount) * Math.max(1, Number(item.quantity || 1)), 0));
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => stringValue(value)).filter(Boolean)));
}

function buildPonchoAdditionalInfo(childNames: string[], providerReference: string) {
  const childName = childNames.join(", ");
  const fields = [
    {
      label: "Child's name",
      name: "child_name",
      value: childName,
      required: true,
    },
    {
      label: "Booking reference",
      name: "booking_reference",
      value: providerReference,
      required: false,
    },
  ].filter((field) => field.value);

  return {
    fields,
    values: {
      child_name: childName,
      childName,
      "Child's name": childName,
      booking_reference: providerReference,
    },
  };
}

function buildPonchoPayPayload(body: CheckoutRequest, payment: {
  invoiceId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentPlan: string;
  providerReference: string;
}) {
  const successUrl = `${publicSiteUrl.replace(/\/$/, "")}/api/ponchopay_redirect?payment=pending&reference=${encodeURIComponent(payment.providerReference)}`;
  const cancelUrl = `${publicSiteUrl.replace(/\/$/, "")}/api/ponchopay_redirect?payment=cancelled&reference=${encodeURIComponent(payment.providerReference)}`;
  const webhookUrl = `${publicSiteUrl}/api/ponchopay/webhook`;
  const capturedUrl = `${publicSiteUrl}/api/ponchopay/captured`;
  const completedUrl = `${publicSiteUrl}/api/ponchopay/completed`;
  const reportedCompleteUrl = `${publicSiteUrl}/api/ponchopay/reported-complete`;
  const inBankUrl = `${publicSiteUrl}/api/ponchopay/in-bank`;
  const refundedUrl = `${publicSiteUrl}/api/ponchopay/refunded`;
  const cancelledUrl = `${publicSiteUrl}/api/ponchopay/cancelled`;
  const updatedUrl = `${publicSiteUrl}/api/ponchopay/updated`;
  const recurringCapturedUrl = `${publicSiteUrl}/api/ponchopay/recurring-captured`;
  const recurringSetupUrl = `${publicSiteUrl}/api/ponchopay/recurring-set-up`;
  const recurringCancelledUrl = `${publicSiteUrl}/api/ponchopay/recurring-cancelled`;
  const usesDeferredChildcareRoute = payment.paymentMethod === "tax_free_childcare" || payment.paymentMethod === "childcare_voucher";
  const metadataLocationUrn = stringValue(body.metadata?.locationUrn);
  const itemLocationUrn = firstKnownLocationUrn(body.items || []);
  const locationStatus = stringValue(body.metadata?.ponchoLocationStatus);
  const locationUrn = metadataLocationUrn || itemLocationUrn || (locationStatus === "pending" ? "" : ponchoPayLocationUrnDefault);
  const parentEmail = stringValue(body.parentEmail);
  const childNames = uniqueStrings((body.items || []).map((item) => item.childName));
  const childName = childNames[0] || "";
  const additionalInfo = buildPonchoAdditionalInfo(childNames, payment.providerReference);
  const amountInPence = Math.round(payment.amount * 100);
  const accountCreditApplied = moneyValue(body.metadata?.accountCreditApplied);
  const pricedItemTotal = checkoutTotal(body.items || []);
  const usesAdjustedTotal = accountCreditApplied > 0 || Math.abs(pricedItemTotal - payment.amount) >= 0.01;
  const providerLineItems = usesAdjustedTotal
    ? [{
        description: accountCreditApplied > 0 ? "Après School booking after account credit" : "Après School booking total",
        amount: amountInPence,
        quantity: 1,
      }]
    : (body.items || []).map((item) => ({
        description: `${stringValue(item.sessionName)} - ${stringValue(item.childName) || "Child"}`,
        amount: Math.round(moneyValue(item.unitAmount) * Math.max(1, Number(item.quantity || 1)) * 100),
        quantity: Math.max(1, Number(item.quantity || 1)),
      }));
  const metadata = JSON.stringify({
    source: "apres_school_booking",
    invoiceId: payment.invoiceId,
    bookingId: stringValue(body.bookingId) || null,
    bookingReference: payment.providerReference,
    parentEmail: parentEmail || null,
    parentName: stringValue(body.parentName) || null,
    childName: childName || null,
    childNames,
    providerId: ponchoPayProviderId || null,
    locationUrn: locationUrn || null,
    paymentMethod: payment.paymentMethod,
    paymentPlan: payment.paymentPlan,
    cardGuaranteeRequired: usesDeferredChildcareRoute,
    automaticReconciliation: usesDeferredChildcareRoute,
    chargeCardOnFailure: usesDeferredChildcareRoute,
    callbacks: {
      webhook: webhookUrl,
      captured: capturedUrl,
      completed: completedUrl,
      updated: updatedUrl,
      refunded: refundedUrl,
      cancelled: cancelledUrl,
      payment_reported_complete: reportedCompleteUrl,
      payment_in_bank: inBankUrl,
      recurring_payment_captured: recurringCapturedUrl,
      recurring_payment_set_up: recurringSetupUrl,
      recurring_payment_cancelled: recurringCancelledUrl,
    },
    ...(isObject(body.metadata) ? body.metadata : {}),
  });
  return {
    urn: locationUrn || "",
    email: parentEmail,
    amount: amountInPence,
    note: `Après School booking ${payment.providerReference}`,
    childName,
    childNames,
    child_name: childName,
    additionalInfo: additionalInfo.values,
    additional_info: additionalInfo.values,
    additionalInformation: additionalInfo.values,
    additional_information: additionalInfo.values,
    additionalFields: additionalInfo.fields,
    additional_fields: additionalInfo.fields,
    metadata,
    line_items: providerLineItems,
    merchantContext: "apres_school",
    providerId: ponchoPayProviderId || null,
    locationUrn: locationUrn || null,
    externalInvoiceId: payment.invoiceId,
    externalBookingId: stringValue(body.bookingId) || payment.invoiceId,
    providerReference: payment.providerReference,
    amountDecimal: payment.amount,
    currency: payment.currency,
    paymentMethod: payment.paymentMethod,
    paymentPlan: payment.paymentPlan,
    paymentFlow: usesDeferredChildcareRoute ? "card_guarantee_with_childcare_reconciliation" : "card_payment",
    cardGuaranteeRequired: usesDeferredChildcareRoute,
    chargeCardOnFailure: usesDeferredChildcareRoute,
    automaticReconciliation: usesDeferredChildcareRoute,
    allowedPaymentMethods: usesDeferredChildcareRoute
      ? ["card_guarantee", payment.paymentMethod]
      : ["card"],
    parent: {
      id: stringValue(body.parentId) || null,
      email: parentEmail || null,
      name: stringValue(body.parentName) || null,
    },
    order_note: childName ? `Child's name: ${childName}` : `Booking reference: ${payment.providerReference}`,
    orderNote: childName ? `Child's name: ${childName}` : `Booking reference: ${payment.providerReference}`,
    child: childName ? { name: childName } : null,
    children: childNames.map((name) => ({ name })),
    lineItems: (body.items || []).map((item) => ({
      id: stringValue(item.id) || crypto.randomUUID(),
      childId: stringValue(item.childId) || null,
      childName: stringValue(item.childName) || null,
      siteId: stringValue(item.siteId) || null,
      siteName: stringValue(item.siteName) || null,
      careType: stringValue(item.careType) || null,
      sessionId: stringValue(item.sessionId) || null,
      sessionName: stringValue(item.sessionName),
      date: stringValue(item.date),
      startTime: stringValue(item.startTime) || null,
      endTime: stringValue(item.endTime) || null,
      quantity: Math.max(1, Number(item.quantity || 1)),
      unitAmount: moneyValue(item.unitAmount),
    })),
    successUrl,
    cancelUrl,
    completedRedirectUrl: successUrl,
    subscriptionSetupRedirectUrl: successUrl,
    webhookUrl,
    callbackUrl: webhookUrl,
    paymentCapturedCallbackUrl: capturedUrl,
    paymentUpdatedCallbackUrl: updatedUrl,
    paymentReportedCompleteCallbackUrl: reportedCompleteUrl,
    paymentCompletedCallbackUrl: completedUrl,
    paymentInBankCallbackUrl: inBankUrl,
    paymentRefundedCallbackUrl: refundedUrl,
    paymentCancelledCallbackUrl: cancelledUrl,
    recurringPaymentCapturedCallbackUrl: recurringCapturedUrl,
    recurringPaymentSetupCallbackUrl: recurringSetupUrl,
    recurringPaymentCancelledCallbackUrl: recurringCancelledUrl,
    callbacks: {
      webhook: webhookUrl,
      captured: capturedUrl,
      completed: completedUrl,
      updated: updatedUrl,
      refunded: refundedUrl,
      cancelled: cancelledUrl,
      payment_captured: capturedUrl,
      payment_completed: completedUrl,
      payment_updated: updatedUrl,
      payment_refunded: refundedUrl,
      payment_cancelled: cancelledUrl,
      payment_reported_complete: reportedCompleteUrl,
      payment_in_bank: inBankUrl,
      recurring_payment_captured: recurringCapturedUrl,
      recurring_payment_set_up: recurringSetupUrl,
      recurring_payment_cancelled: recurringCancelledUrl,
    },
    callbackMetadata: {
      merchantContext: "apres_school",
      invoiceId: payment.invoiceId,
      bookingId: stringValue(body.bookingId) || null,
      bookingReference: payment.providerReference,
      providerId: ponchoPayProviderId || null,
      locationUrn: locationUrn || null,
      ponchoLocationStatus: locationStatus || (locationUrn ? "configured" : "missing"),
      paymentMethod: payment.paymentMethod,
      paymentPlan: payment.paymentPlan,
      cardGuaranteeRequired: usesDeferredChildcareRoute,
      automaticReconciliation: usesDeferredChildcareRoute,
      chargeCardOnFailure: usesDeferredChildcareRoute,
      ...(isObject(body.metadata) ? body.metadata : {}),
    },
  };
}

async function trustedCheckoutRequest(submitted: CheckoutRequest | null, token: string): Promise<CheckoutRequest | null> {
  if (!submitted) return null;
  if (token && token === serviceRoleKey) return submitted;

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError("Sign in before starting checkout.", 401);
  const bookingId = stringValue(submitted.bookingId);
  if (!bookingId) throw new HttpError("A saved booking is required before checkout.", 400);

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id,parent_id,parent_account_id,parent_email,parent_name,invoice_id,payment_method,payment_plan,total_amount,due_today,metadata,booking_items(id,child_id,child_name,site_name,session_label,starts_at,ends_at,quantity,unit_amount,metadata)")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking) throw new HttpError("Saved booking not found.", 404);

  const email = String(authData.user.email || "").toLowerCase();
  const ownsBooking = booking.parent_id === authData.user.id || String(booking.parent_email || "").toLowerCase() === email;
  if (!ownsBooking) throw new HttpError("You cannot pay for this booking.", 403);

  const invoiceId = stringValue(booking.invoice_id);
  const { data: invoice, error: invoiceError } = invoiceId
    ? await supabase.from("booking_invoices").select("id,total_amount,balance,currency,parent_id,parent_email,metadata").eq("id", invoiceId).maybeSingle()
    : { data: null, error: null };
  if (invoiceError) throw invoiceError;
  const amount = moneyValue(invoice?.balance) || moneyValue(booking.due_today) || moneyValue(booking.total_amount);
  if (amount <= 0) throw new HttpError("This booking has no payment due.", 400);

  const items = Array.isArray(booking.booking_items) ? booking.booking_items : [];
  return {
    bookingId: booking.id,
    invoiceId: invoice?.id || invoiceId,
    parentId: authData.user.id,
    parentEmail: authData.user.email || booking.parent_email,
    parentName: booking.parent_name,
    paymentMethod: booking.payment_method,
    paymentPlan: booking.payment_plan,
    currency: stringValue(invoice?.currency) || "GBP",
    amount,
    items: items.map((item: Record<string, unknown>) => ({
      id: stringValue(item.id),
      childId: stringValue(item.child_id),
      childName: stringValue(item.child_name),
      siteName: stringValue(item.site_name),
      sessionName: stringValue(item.session_label),
      date: stringValue(item.starts_at).slice(0, 10),
      startTime: stringValue(item.starts_at),
      endTime: stringValue(item.ends_at),
      quantity: Math.max(1, Number(item.quantity || 1)),
      unitAmount: moneyValue(item.unit_amount),
    })),
    metadata: { ...(isObject(booking.metadata) ? booking.metadata : {}), source: "server_verified_parent_checkout" },
  };
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function createPonchoPayPayment(payload: Record<string, unknown>) {
  if (!ponchoPayApiUrl || !ponchoPayIntegrationKey) {
    return {
      status: "provider_not_configured",
      paymentId: null,
      checkoutUrl: null,
      expiresAt: null,
      errorMessage: "PONCHOPAY_API_URL and PONCHOPAY_INTEGRATION_KEY are required before live checkout",
      message: "Invoice has been prepared locally; configure PonchoPay credentials to create the payment link.",
      response: {},
    };
  }

  const endpointUrl = ponchoPayCheckoutEndpoint();
  const metadata = stringValue(payload.metadata) || JSON.stringify({
    source: "apres_school_booking",
    providerReference: stringValue(payload.providerReference),
  });
  const childName = stringValue(payload.childName);
  const childNames = Array.isArray(payload.childNames)
    ? uniqueStrings(payload.childNames)
    : childName
      ? [childName]
      : [];
  const additionalInfo = buildPonchoAdditionalInfo(childNames, stringValue(payload.providerReference));
  const note = stringValue(payload.note) || `Après School booking ${stringValue(payload.providerReference)}`;
  const requestBody = {
    metadata,
    urn: stringValue(payload.urn),
    amount: Math.round(Number(payload.amount || 0)),
    email: stringValue(payload.email),
    childName,
    child_name: childName,
    children: childNames,
    note,
    orderNote: childName ? `${note} - ${childName}` : note,
    order_note: childName ? `${note} - ${childName}` : note,
    additionalInfo: additionalInfo.values,
    additional_info: additionalInfo.values,
    additionalInformation: additionalInfo.values,
    additional_information: additionalInfo.values,
    additionalFields: additionalInfo.fields,
    additional_fields: additionalInfo.fields,
    line_items: Array.isArray(payload.line_items) ? payload.line_items : [],
    token: await sha256Base64(`${metadata}.${ponchoPayIntegrationKey}`),
  };
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    return {
      status: "ready_for_payment",
      paymentId: stringValue(payload.providerReference) || null,
      checkoutUrl: location,
      expiresAt: null,
      errorMessage: null,
      message: "PonchoPay checkout link created.",
      response: { providerStatus: response.status, request: { ...requestBody, token: "[redacted]" } },
    };
  }
  const responseText = await response.text();
  const responseBody = parseProviderResponse(responseText);
  if (!response.ok) {
    return {
      status: "provider_error",
      paymentId: firstString(responseBody, ["paymentId", "payment_id", "id", "data.paymentId", "data.payment_id", "data.id", "payment.id"]),
      checkoutUrl: null,
      expiresAt: null,
      errorMessage: firstString(responseBody, ["error", "message", "detail", "data.error", "data.message"]) || `PonchoPay returned ${response.status}`,
      message: "PonchoPay did not create the checkout link. Parent should not be sent to payment yet.",
      response: responseBody,
    };
  }

  const checkoutUrl = firstString(responseBody, [
    "checkoutUrl",
    "checkout_url",
    "paymentUrl",
    "payment_url",
    "url",
    "data.checkoutUrl",
    "data.checkout_url",
    "data.paymentUrl",
    "data.payment_url",
    "data.url",
    "payment.checkoutUrl",
    "payment.checkout_url",
    "payment.url",
  ]);
  const paymentId = firstString(responseBody, [
    "paymentId",
    "payment_id",
    "id",
    "data.paymentId",
    "data.payment_id",
    "data.id",
    "payment.id",
  ]);
  return {
    status: checkoutUrl ? "ready_for_payment" : "provider_response_missing_checkout_url",
    paymentId,
    checkoutUrl,
    expiresAt: firstString(responseBody, ["expiresAt", "expires_at", "data.expiresAt", "data.expires_at", "payment.expiresAt", "payment.expires_at"]),
    errorMessage: null,
    message: checkoutUrl ? "PonchoPay checkout link created." : "PonchoPay responded but did not include a checkout URL.",
    response: responseBody,
  };
}

function ponchoPayCheckoutEndpoint() {
  const base = ponchoPayApiUrl.replace(/\/$/, "");
  if (/\/api\/integration\/generic\/initiate$/i.test(base)) return base;
  const path = (ponchoPayCheckoutPath || "/api/integration/generic/initiate").replace(/^\/?/, "/");
  return `${base}${path}`;
}

async function upsertInvoice(invoice: {
  invoiceId: string;
  bookingId: string;
  parentId: string;
  parentEmail: string;
  amount: number;
  currency: string;
  providerReference: string;
  metadata: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("booking_invoices")
    .upsert({
      id: invoice.invoiceId,
      booking_id: invoice.bookingId || null,
      parent_id: invoice.parentId || null,
      parent_email: invoice.parentEmail || null,
      provider_reference: invoice.providerReference,
      total_amount: invoice.amount,
      paid_amount: 0,
      refunded_amount: 0,
      balance: invoice.amount,
      currency: invoice.currency,
      payment_status: "checkout_created",
      parent_portal_status: "Ready for payment",
      receipt_status: "not_issued",
      finance_status: "awaiting_payment",
      metadata: invoice.metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
  if (error) throw error;
}

async function upsertCheckoutSession(session: {
  invoiceId: string;
  bookingId: string;
  parentId: string;
  parentEmail: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentPlan: string;
  providerReference: string;
  requestPayload: Record<string, unknown>;
  providerResponse: Record<string, unknown>;
  providerPaymentId: string | null;
  providerCheckoutUrl: string | null;
  status: string;
  errorMessage: string | null;
  expiresAt: string | null;
}) {
  const { error } = await supabase
    .from("ponchopay_checkout_sessions")
    .upsert({
      invoice_id: session.invoiceId,
      booking_id: session.bookingId || null,
      parent_id: session.parentId || null,
      parent_email: session.parentEmail || null,
      provider_payment_id: session.providerPaymentId,
      provider_checkout_url: session.providerCheckoutUrl,
      provider_reference: session.providerReference,
      amount: session.amount,
      currency: session.currency,
      payment_method: session.paymentMethod,
      payment_plan: session.paymentPlan,
      status: session.status,
      request_payload: session.requestPayload,
      provider_response: session.providerResponse,
      error_message: session.errorMessage,
      expires_at: session.expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "invoice_id" });
  if (error) throw error;
}

function normalisePaymentMethod(value: unknown) {
  const method = stringValue(value).toLowerCase();
  if (["tfc", "tax-free", "tax_free_childcare"].includes(method)) return "tax_free_childcare";
  if (["voucher", "childcare_voucher"].includes(method)) return "childcare_voucher";
  if (method === "invoice") return "invoice";
  return "card";
}

function normalisePaymentPlan(value: unknown) {
  const plan = stringValue(value).toLowerCase();
  if (["monthly", "month"].includes(plan)) return "monthly";
  return "pay_now";
}

function firstKnownLocationUrn(items: CheckoutItem[]) {
  for (const item of items) {
    const urn = ponchoPayLocationUrns[stringValue(item.siteName)];
    if (urn) return urn;
  }
  return "";
}

async function sha256Base64(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  let binary = "";
  for (const byte of new Uint8Array(hash)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function parseProviderResponse(text: string) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: text };
  }
}

function firstString(source: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = valueAtPath(source, path);
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

function valueAtPath(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isObject(current)) return undefined;
    return current[key];
  }, source);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
