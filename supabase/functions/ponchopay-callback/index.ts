import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const lifecycleEvents = new Set([
  "guarantee_created",
  "payment_failed",
  "payment_captured",
  "payment_reported_complete",
  "payment_completed",
  "payment_in_bank",
  "payment_refunded",
  "payment_cancelled",
  "payment_updated",
  "payment_reconciled",
  "fallback_card_charged",
  "recurring_payment_captured",
  "recurring_payment_set_up",
  "recurring_payment_cancelled",
]);

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const ponchoPayIntegrationKey =
  Deno.env.get("PONCHOPAY_INTEGRATION_KEY") ??
  Deno.env.get("PONCHOPAY_DEMO_INTEGRATION_KEY") ??
  "";
const ponchoPayWebhookSecret =
  Deno.env.get("PONCHOPAY_WEBHOOK_SECRET") ??
  ponchoPayIntegrationKey;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);
  if (!ponchoPayWebhookSecret) return json({ error: "PonchoPay webhook secret is not configured" }, 500);

  const sourcePath = new URL(request.url).pathname;
  const signature =
    request.headers.get("signature") ??
    request.headers.get("x-ponchopay-signature") ??
    request.headers.get("x-signature") ??
    request.headers.get("x-webhook-signature") ??
    "";
  const rawPayload = await request.text();

  try {
    if (!signature) return json({ error: "Missing PonchoPay signature" }, 401);

    const verified = await verifyPonchoPaySignature(rawPayload, signature, ponchoPayWebhookSecret);
    if (!verified) {
      await recordRejectedEvent(rawPayload, sourcePath, "invalid_signature");
      return json({ error: "Invalid PonchoPay signature" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = parsePayload(rawPayload);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Callback payload is not valid JSON" }, 400);
    }
    const event = normalisePonchoPayEvent(payload, sourcePath);
    const validationError = validateEvent(event);
    if (validationError) return json({ error: validationError }, 400);

    const rawPayloadHash = await sha256Base64Url(rawPayload);
    const insertPayload = {
      provider_event_id: event.providerEventId,
      event_type: event.eventType,
      payment_id: event.paymentId || null,
      booking_id: event.bookingId || null,
      invoice_id: event.invoiceId || null,
      provider_reference: event.providerReference || null,
      amount: event.amount,
      expected_amount: event.expectedAmount,
      currency: event.currency || "GBP",
      signature_status: "verified",
      processing_status: "received",
      processing_outcome: event.outcome,
      raw_payload_hash: rawPayloadHash,
      raw_payload: payload,
      source_path: sourcePath,
      processed_at: null,
    };

    const { error } = await supabase
      .from("ponchopay_webhook_events")
      .insert(insertPayload);

    if (isDuplicateError(error)) {
      const processorResult = await triggerEventProcessor(event.providerEventId);
      return json({
        eventAccepted: true,
        duplicate: true,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        processingStatus: "duplicate_reprocessed",
        processor: processorResult,
      });
    }

    if (error) throw error;
    await mirrorBookingPaymentEvent(insertPayload);
    const processorResult = await triggerEventProcessor(event.providerEventId);

    await supabase.from("audit_log").insert({
      action: "ponchopay_webhook_received",
      table_name: "ponchopay_webhook_events",
      metadata: {
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        paymentId: event.paymentId,
        invoiceId: event.invoiceId,
        bookingId: event.bookingId,
        sourcePath,
      },
    });

    return json({
      eventAccepted: true,
      duplicate: false,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      processingStatus: "received",
      nextAction: event.nextAction,
      processor: processorResult,
    });
  } catch (error) {
    console.error(error);
    return json({ error: errorMessage(error) || "Unable to process PonchoPay callback" }, 500);
  }
});

async function verifyPonchoPaySignature(payload: string, signature: string, integrationKey: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(integrationKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const bytes = new Uint8Array(signed);
  const candidates = new Set([
    base64UrlEncode(bytes),
    base64Encode(bytes),
    hexEncode(bytes),
  ]);
  const cleanSignature = signature.trim();
  const unprefixedSignature = cleanSignature.replace(/^sha256=/i, "");
  return [...candidates].some((candidate) => timingSafeEqual(candidate, unprefixedSignature) || timingSafeEqual(`sha256=${candidate}`, cleanSignature));
}

function parsePayload(rawPayload: string) {
  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Callback payload must be an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Callback payload is not valid JSON");
  }
}

function normalisePonchoPayEvent(payload: Record<string, unknown>, sourcePath: string) {
  const data = objectValue(payload.data);
  const payment = objectValue(payload.payment) || objectValue(data.payment);
  const invoice = objectValue(payload.invoice) || objectValue(data.invoice);
  const providerRequest = objectValue(payload.request) || objectValue(data.request);
  const metadata =
    metadataObject(payload.metadata) ||
    metadataObject(data.metadata) ||
    metadataObject(providerRequest.metadata) ||
    metadataObject(payment.metadata) ||
    {};
  const eventType =
    stringValue(payload.eventType) ||
    stringValue(payload.event_type) ||
    stringValue(payload.type) ||
    stringValue(payload.event) ||
    stringValue(data.eventType) ||
    stringValue(data.event_type) ||
    stringValue(data.type) ||
    stringValue(data.event) ||
    eventTypeFromPath(sourcePath);
  const normalisedEventType = normaliseEventType(eventType);
  const providerEventId =
    stringValue(payload.eventId) ||
    stringValue(payload.event_id) ||
    stringValue(payload.id) ||
    stringValue(data.eventId) ||
    stringValue(data.event_id) ||
    stringValue(data.id) ||
    `${normalisedEventType}:${stringValue(payload.paymentId) || stringValue(payload.payment_id) || stringValue(payment.id)}:${stringValue(payload.providerReference) || stringValue(payload.provider_reference) || stringValue(payment.providerReference) || stringValue(payment.provider_reference)}`;
  const paymentId = stringValue(payload.paymentId) || stringValue(payload.payment_id) || stringValue(data.paymentId) || stringValue(data.payment_id) || stringValue(payment.id) || stringValue(payment.paymentId);
  const invoiceId =
    stringValue(payload.invoiceId) ||
    stringValue(payload.invoice_id) ||
    stringValue(payload.external_invoice_id) ||
    stringValue(data.invoiceId) ||
    stringValue(data.invoice_id) ||
    stringValue(data.external_invoice_id) ||
    stringValue(invoice.id) ||
    stringValue(invoice.externalInvoiceId) ||
    stringValue(invoice.external_invoice_id) ||
    stringValue(metadata.invoiceId);
  const bookingId =
    stringValue(payload.bookingId) ||
    stringValue(payload.booking_id) ||
    stringValue(payload.external_booking_id) ||
    stringValue(data.bookingId) ||
    stringValue(data.booking_id) ||
    stringValue(data.external_booking_id) ||
    stringValue(metadata.bookingId);
  const providerReference =
    stringValue(payload.providerReference) ||
    stringValue(payload.provider_reference) ||
    stringValue(payload.reference) ||
    stringValue(data.providerReference) ||
    stringValue(data.provider_reference) ||
    stringValue(data.reference) ||
    stringValue(payment.providerReference) ||
    stringValue(payment.provider_reference) ||
    stringValue(payment.reference);
  const amount = moneyValue(payload.amount ?? payload.settledAmount ?? payload.refundAmount ?? data.amount ?? data.settledAmount ?? data.refundAmount ?? payment.amount);
  const expectedAmount = moneyValue(payload.expectedAmount ?? payload.expected_amount ?? data.expectedAmount ?? data.expected_amount ?? payment.expectedAmount ?? payment.expected_amount);
  return {
    providerEventId,
    eventType: normalisedEventType,
    paymentId,
    invoiceId,
    bookingId,
    providerReference,
    amount,
    expectedAmount,
    currency: stringValue(payload.currency) || stringValue(data.currency) || stringValue(payment.currency) || "GBP",
    outcome: outcomeForEvent(eventType),
    nextAction: nextActionForEvent(eventType),
  };
}

async function triggerEventProcessor(providerEventId: string) {
  if (!providerEventId) return { attempted: false, reason: "missing_provider_event_id" };

  const processorToken = Deno.env.get("PONCHOPAY_PROCESSOR_TOKEN") ?? "";
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/ponchopay-process-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(processorToken ? { "x-processor-token": processorToken } : {}),
      },
      body: JSON.stringify({ eventId: providerEventId, limit: 1 }),
    });
    const body = await response.json().catch(() => ({}));
    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      processed: Number(body?.processed || 0),
      failed: Number(body?.failed || 0),
      skipped: Number(body?.skipped || 0),
      error: stringValue(body?.error) || null,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: errorMessage(error) || "Unable to trigger PonchoPay event processor",
    };
  }
}

function metadataObject(value: unknown) {
  if (isObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEvent(event: ReturnType<typeof normalisePonchoPayEvent>) {
  if (!event.eventType) return "Callback event type is required";
  if (!lifecycleEvents.has(event.eventType)) return `Unsupported PonchoPay event type: ${event.eventType}`;
  if (!event.providerEventId || event.providerEventId.includes("undefined")) return "Stable provider event id is required";
  if (!event.paymentId && !event.providerReference && !event.invoiceId && !event.bookingId) {
    return "At least one payment, reference, invoice or booking identifier is required";
  }
  return null;
}

function eventTypeFromPath(pathname: string) {
  const slug = pathname.split("/").filter(Boolean).pop() || "";
  return slug.replace(/^payment-/, "payment_").replace(/-/g, "_");
}

function normaliseEventType(value: string) {
  const eventType = value.trim().toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, string> = {
    captured: "payment_captured",
    completed: "payment_completed",
    updated: "payment_updated",
    refunded: "payment_refunded",
    cancelled: "payment_cancelled",
    failed: "payment_failed",
    reconciled: "payment_reconciled",
    guarantee: "guarantee_created",
    card_guarantee_created: "guarantee_created",
    childcare_guarantee_created: "guarantee_created",
    tax_free_childcare_reconciled: "payment_reconciled",
    childcare_voucher_reconciled: "payment_reconciled",
    guarantee_fallback_card_charged: "fallback_card_charged",
    card_guarantee_charged: "fallback_card_charged",
    recurring_captured: "recurring_payment_captured",
    recurring_payment_setup: "recurring_payment_set_up",
    recurring_payment_set_up: "recurring_payment_set_up",
    subscription_set_up: "recurring_payment_set_up",
    subscription_setup: "recurring_payment_set_up",
    recurring_cancelled: "recurring_payment_cancelled",
  };
  return aliases[eventType] || eventType;
}

function outcomeForEvent(eventType: string) {
  switch (eventType) {
    case "payment_captured":
      return "Payment captured; booking confirmation can continue automatically";
    case "guarantee_created":
      return "Card guarantee stored; booking can confirm while reconciliation runs";
    case "payment_reported_complete":
      return "Parent reported complete; invoice remains pending while PonchoPay matches funds";
    case "payment_completed":
      return "Payment complete; invoice can be cleared and receipt issued";
    case "payment_reconciled":
      return "Childcare payment reconciled; invoice can be cleared and receipt issued";
    case "fallback_card_charged":
      return "Guarantee card charged because voucher/TFC payment did not arrive";
    case "payment_failed":
      return "Payment failed; do not enrol child";
    case "payment_in_bank":
      return "Bank match recorded; finance risk can close where supported";
    case "recurring_payment_captured":
      return "Recurring payment captured; invoice can be updated through the payment processor";
    case "recurring_payment_set_up":
      return "Recurring payment set up; monthly payment plan can become active";
    case "recurring_payment_cancelled":
      return "Recurring payment cancelled; parent/admin payment action required";
    case "payment_refunded":
      return "Refund recorded; credit or balance update required";
    case "payment_cancelled":
      return "Payment cancelled; parent/admin action required";
    case "payment_updated":
      return "Payment changed; re-check invoice amount and route";
    default:
      return "Received";
  }
}

function nextActionForEvent(eventType: string) {
  switch (eventType) {
    case "payment_completed":
      return "Clear invoice, issue receipt and email parent";
    case "payment_reconciled":
      return "Clear invoice as reconciled and issue receipt";
    case "fallback_card_charged":
      return "Clear invoice as paid by fallback card and keep audit trail";
    case "guarantee_created":
      return "Mark booking guaranteed and hold place pending reconciliation";
    case "payment_failed":
      return "Keep booking unpaid and release or review held place";
    case "payment_refunded":
      return "Raise credit and notify finance";
    case "payment_cancelled":
      return "Reopen payment action in parent portal";
    case "payment_updated":
      return "Run invoice mismatch check";
    case "recurring_payment_captured":
      return "Apply recurring payment capture to invoice and receipt flow";
    case "recurring_payment_set_up":
      return "Mark payment plan active and keep booking pending scheduled captures";
    case "recurring_payment_cancelled":
      return "Mark payment plan action needed";
    default:
      return "Store event and wait for lifecycle completion";
  }
}

async function mirrorBookingPaymentEvent(event: Record<string, unknown>) {
  const { error } = await supabase.from("booking_payment_events").insert({
    provider: "ponchopay",
    provider_event_id: event.provider_event_id,
    event_type: event.event_type,
    booking_id: event.booking_id,
    invoice_id: event.invoice_id,
    payment_id: event.payment_id,
    provider_reference: event.provider_reference,
    amount: event.amount,
    currency: event.currency,
    signature_status: event.signature_status,
    processing_status: event.processing_status,
    raw_payload_hash: event.raw_payload_hash,
    raw_payload: event.raw_payload,
    source_path: event.source_path,
  });
  if (error && !isDuplicateError(error)) console.error(`Booking payment event mirror failed: ${error.message}`);
}

async function recordRejectedEvent(rawPayload: string, sourcePath: string, reason: string) {
  if (!supabaseUrl || !serviceRoleKey) return;
  const rawPayloadHash = await sha256Base64Url(rawPayload);
  const providerEventId = `rejected:${reason}:${rawPayloadHash.slice(0, 24)}`;
  const { error } = await supabase.from("ponchopay_webhook_events").insert({
    provider_event_id: providerEventId,
    event_type: "rejected",
    signature_status: reason,
    processing_status: "rejected",
    processing_outcome: "Callback rejected before JSON parse",
    raw_payload_hash: rawPayloadHash,
    raw_payload: {},
    source_path: sourcePath,
    processed_at: new Date().toISOString(),
  });
  if (error && !isDuplicateError(error)) console.error(`Rejected PonchoPay callback log failed: ${error.message}`);
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hexEncode(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

function isDuplicateError(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "23505" || /duplicate key/i.test(error.message || "")));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
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
