import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-processor-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  "";
const processorToken = Deno.env.get("PONCHOPAY_PROCESSOR_TOKEN") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type WebhookEvent = {
  id: string;
  provider_event_id: string;
  event_type: string;
  payment_id: string | null;
  booking_id: string | null;
  invoice_id: string | null;
  provider_reference: string | null;
  amount: number | null;
  expected_amount: number | null;
  currency: string;
  raw_payload: Record<string, unknown>;
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);
  if (processorToken && request.headers.get("x-processor-token") !== processorToken) {
    return json({ error: "Not authorised to process PonchoPay events" }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(50, Math.max(1, Number(body.limit || 20)));
    const eventId = stringValue(body.eventId);

    const query = supabase
      .from("ponchopay_webhook_events")
      .select("*")
      .eq("signature_status", "verified")
      .in("processing_status", ["received", "retry"])
      .order("received_at", { ascending: true })
      .limit(limit);

    const { data, error } = eventId
      ? await query.eq("provider_event_id", eventId)
      : await query;

    if (error) throw error;

    const events = (data || []) as WebhookEvent[];
    const results = [];
    for (const event of events) {
      results.push(await processEvent(event));
    }

    return json({
      processed: results.filter((result) => result.status === "processed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to process PonchoPay events" }, 500);
  }
});

async function processEvent(event: WebhookEvent) {
  const invoiceId = event.invoice_id || stringValue(event.raw_payload?.invoiceId) || stringValue(event.raw_payload?.invoice_id);
  if (!invoiceId) {
    await markEvent(event.id, "skipped", "No invoice id found; leaving for finance review");
    return { providerEventId: event.provider_event_id, eventType: event.event_type, status: "skipped", reason: "missing_invoice_id" };
  }

  try {
    const currentInvoice = await getInvoice(invoiceId);
    const nextInvoice = buildInvoiceState(event, currentInvoice);
    await upsertInvoice(nextInvoice);

    let receiptId: string | null = null;
    if (shouldIssueReceipt(event.event_type)) {
      receiptId = await ensureReceipt(event, nextInvoice.id);
    }
    const bookingStatus = await updateBookingFromInvoice(event, nextInvoice);
    const emailLog = await sendPaymentLifecycleEmail(event, nextInvoice, receiptId, bookingStatus);

    await markEvent(event.id, "processed", nextInvoice.processingOutcome);
    await supabase.from("audit_log").insert({
      action: "ponchopay_invoice_event_processed",
      table_name: "booking_invoices",
      record_id: null,
      metadata: {
        invoiceId: nextInvoice.id,
        providerEventId: event.provider_event_id,
        eventType: event.event_type,
        paymentStatus: nextInvoice.payment_status,
        parentPortalStatus: nextInvoice.parent_portal_status,
        receiptId,
        emailLogId: stringValue(emailLog?.id),
        emailStatus: stringValue(emailLog?.status),
        bookingStatus,
      },
    });

    return {
      providerEventId: event.provider_event_id,
      eventType: event.event_type,
      invoiceId: nextInvoice.id,
      status: "processed",
      paymentStatus: nextInvoice.payment_status,
      parentPortalStatus: nextInvoice.parent_portal_status,
      receiptId,
      emailLog,
      bookingStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    await markEvent(event.id, "retry", message);
    return { providerEventId: event.provider_event_id, eventType: event.event_type, status: "failed", reason: message };
  }
}

async function getInvoice(invoiceId: string) {
  const { data, error } = await supabase
    .from("booking_invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function buildInvoiceState(event: WebhookEvent, currentInvoice: Record<string, unknown> | null) {
  const totalAmount = moneyValue(currentInvoice?.total_amount) || event.expected_amount || event.amount || 0;
  const currentPaid = moneyValue(currentInvoice?.paid_amount) || 0;
  const currentRefunded = moneyValue(currentInvoice?.refunded_amount) || 0;
  const eventAmount = Math.max(0, Number(event.amount || 0));
  const rawParent = typeof event.raw_payload?.parent === "object" && event.raw_payload.parent ? event.raw_payload.parent as Record<string, unknown> : {};
  const parentEmail =
    stringValue(event.raw_payload?.parentEmail) ||
    stringValue(event.raw_payload?.parent_email) ||
    stringValue(rawParent.email) ||
    stringValue(currentInvoice?.parent_email);

  const base = {
    id: event.invoice_id || stringValue(event.raw_payload?.invoiceId) || stringValue(event.raw_payload?.invoice_id),
    booking_id: event.booking_id || stringValue(event.raw_payload?.bookingId) || stringValue(event.raw_payload?.booking_id) || stringValue(currentInvoice?.booking_id) || null,
    parent_email: parentEmail || null,
    provider_payment_id: event.payment_id || stringValue(currentInvoice?.provider_payment_id) || null,
    provider_reference: event.provider_reference || stringValue(currentInvoice?.provider_reference) || null,
    total_amount: totalAmount,
    paid_amount: currentPaid,
    refunded_amount: currentRefunded,
    balance: Math.max(0, totalAmount - currentPaid + currentRefunded),
    currency: event.currency || stringValue(currentInvoice?.currency) || "GBP",
    payment_status: stringValue(currentInvoice?.payment_status) || "pending",
    parent_portal_status: stringValue(currentInvoice?.parent_portal_status) || "Outstanding",
    receipt_status: stringValue(currentInvoice?.receipt_status) || "not_issued",
    finance_status: stringValue(currentInvoice?.finance_status) || "awaiting_payment",
    last_webhook_event_id: event.id,
    last_provider_event_id: event.provider_event_id,
    metadata: {
      ...(isObject(currentInvoice?.metadata) ? currentInvoice?.metadata as Record<string, unknown> : {}),
      lastEventType: event.event_type,
      lastProviderReference: event.provider_reference,
    },
    updated_at: new Date().toISOString(),
    processingOutcome: "",
  };

  switch (event.event_type) {
    case "guarantee_created":
      return {
        ...base,
        payment_status: "payment_guaranteed",
        parent_portal_status: "Card guarantee saved; awaiting childcare payment match",
        finance_status: "guaranteed_pending_reconciliation",
        processingOutcome: "Card guarantee created; place remains held while PonchoPay reconciles voucher/TFC",
      };
    case "payment_failed":
      return {
        ...base,
        payment_status: "failed",
        parent_portal_status: "Payment failed; action needed",
        finance_status: "payment_failed",
        processingOutcome: "Payment failed; booking must not be enrolled",
      };
    case "payment_captured":
      return {
        ...base,
        payment_status: "reserved",
        parent_portal_status: "Place reserved; awaiting completion",
        finance_status: "captured_pending_completion",
        processingOutcome: "Payment captured; booking remains reserved while completion is awaited",
      };
    case "payment_reported_complete":
      return {
        ...base,
        payment_status: "reported_complete",
        parent_portal_status: "Payment reported; awaiting PonchoPay match",
        finance_status: "awaiting_bank_match",
        processingOutcome: "Parent/provider reported complete; invoice remains visible as outstanding",
      };
    case "recurring_payment_set_up":
      return {
        ...base,
        payment_status: "payment_plan_active",
        parent_portal_status: "Monthly payment plan active",
        finance_status: "recurring_plan_active",
        processingOutcome: "Recurring payment plan set up; scheduled captures will clear instalments",
      };
    case "payment_completed": {
      const paidAmount = Math.max(currentPaid, eventAmount || totalAmount);
      return {
        ...base,
        paid_amount: paidAmount,
        balance: Math.max(0, totalAmount - paidAmount + currentRefunded),
        payment_status: "paid",
        parent_portal_status: "Paid; receipt available",
        receipt_status: "issued",
        finance_status: "cleared",
        processingOutcome: "Payment completed; invoice cleared and receipt issued",
      };
    }
    case "recurring_payment_captured": {
      const paidAmount = Math.max(currentPaid, eventAmount || totalAmount);
      return {
        ...base,
        paid_amount: paidAmount,
        balance: Math.max(0, totalAmount - paidAmount + currentRefunded),
        payment_status: paidAmount >= totalAmount ? "paid" : "part_paid",
        parent_portal_status: paidAmount >= totalAmount ? "Paid; receipt available" : "Monthly payment received",
        receipt_status: "issued",
        finance_status: paidAmount >= totalAmount ? "cleared" : "instalment_received",
        processingOutcome: "Recurring payment captured; invoice instalment applied",
      };
    }
    case "payment_reconciled": {
      const paidAmount = Math.max(currentPaid, eventAmount || totalAmount);
      return {
        ...base,
        paid_amount: paidAmount,
        balance: Math.max(0, totalAmount - paidAmount + currentRefunded),
        payment_status: "reconciled",
        parent_portal_status: "Paid; childcare payment reconciled",
        receipt_status: "issued",
        finance_status: "reconciled",
        processingOutcome: "Childcare payment reconciled by PonchoPay; invoice cleared and receipt issued",
      };
    }
    case "fallback_card_charged": {
      const paidAmount = Math.max(currentPaid, eventAmount || totalAmount);
      return {
        ...base,
        paid_amount: paidAmount,
        balance: Math.max(0, totalAmount - paidAmount + currentRefunded),
        payment_status: "paid_by_fallback_card",
        parent_portal_status: "Paid by fallback card guarantee",
        receipt_status: "issued",
        finance_status: "fallback_card_charged",
        processingOutcome: "PonchoPay charged the guaranteed card after childcare payment did not arrive",
      };
    }
    case "payment_in_bank": {
      const paidAmount = Math.max(currentPaid, eventAmount || totalAmount);
      return {
        ...base,
        paid_amount: paidAmount,
        balance: Math.max(0, totalAmount - paidAmount + currentRefunded),
        payment_status: "bank_confirmed",
        parent_portal_status: "Paid; bank match confirmed",
        receipt_status: currentInvoice?.receipt_status === "issued" ? "issued" : "ready",
        finance_status: "bank_confirmed",
        processingOutcome: "Payment identified in bank; reconciliation risk closed",
      };
    }
    case "payment_refunded": {
      const refundedAmount = Math.max(currentRefunded, eventAmount);
      return {
        ...base,
        refunded_amount: refundedAmount,
        balance: Math.max(0, totalAmount - currentPaid + refundedAmount),
        payment_status: "refunded",
        parent_portal_status: "Refund or credit updated",
        receipt_status: stringValue(currentInvoice?.receipt_status) || "issued",
        finance_status: "credit_review",
        processingOutcome: "Refund recorded; credit balance requires finance review",
      };
    }
    case "payment_cancelled":
      return {
        ...base,
        payment_status: "cancelled",
        parent_portal_status: "Payment cancelled; action needed",
        finance_status: "payment_action_needed",
        processingOutcome: "Payment cancelled; parent/admin action reopened",
      };
    case "recurring_payment_cancelled":
      return {
        ...base,
        payment_status: "payment_plan_cancelled",
        parent_portal_status: "Monthly payment cancelled; action needed",
        finance_status: "payment_plan_action_needed",
        processingOutcome: "Recurring payment cancelled; parent/admin action reopened",
      };
    case "payment_updated":
      return {
        ...base,
        payment_status: "updated_needs_review",
        parent_portal_status: "Payment change under review",
        finance_status: "mismatch_review",
        processingOutcome: "Payment updated; invoice amount and route need review",
      };
    default:
      return {
        ...base,
        processingOutcome: `PonchoPay event '${event.event_type}' recorded without an invoice status change`,
      };
  }
}

async function upsertInvoice(invoice: ReturnType<typeof buildInvoiceState>) {
  const { processingOutcome, ...row } = invoice;
  const { error } = await supabase
    .from("booking_invoices")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

async function ensureReceipt(event: WebhookEvent, invoiceId: string) {
  const cleanProviderEventId = event.provider_event_id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const receiptSuffix = cleanProviderEventId.slice(-14) || crypto.randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase();
  const receiptNumber = `APR-${new Date().getFullYear()}-${receiptSuffix}`;
  const { data, error } = await supabase
    .from("booking_receipts")
    .upsert({
      invoice_id: invoiceId,
      provider_event_id: event.provider_event_id,
      payment_id: event.payment_id,
      provider_reference: event.provider_reference,
      receipt_number: receiptNumber,
      amount: Math.max(0, Number(event.amount || event.expected_amount || 0)),
      currency: event.currency || "GBP",
      delivery_status: "pending_email",
      metadata: { eventType: event.event_type },
    }, { onConflict: "provider_event_id" })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function updateBookingFromInvoice(event: WebhookEvent, invoice: ReturnType<typeof buildInvoiceState>) {
  const bookingId = stringValue(invoice.booking_id);
  if (!bookingId) return null;
  const nextStatus = bookingStatusForInvoice(invoice.payment_status);
  const { error } = await supabase
    .from("bookings")
    .update({
      status: nextStatus,
      outstanding_balance: Math.max(0, moneyValue(invoice.balance)),
      invoice_id: invoice.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  if (error) throw error;

  if (nextStatus === "confirmed") {
    const { error: itemError } = await supabase
      .from("booking_items")
      .update({ status: "confirmed", updated_at: new Date().toISOString() })
      .eq("booking_id", bookingId)
      .eq("status", "reserved");
    if (itemError) throw itemError;
  }

  await supabase.from("audit_log").insert({
    action: "booking_payment_state_updated",
    table_name: "bookings",
    record_id: bookingId,
    metadata: {
      invoiceId: invoice.id,
      providerEventId: event.provider_event_id,
      eventType: event.event_type,
      bookingStatus: nextStatus,
      paymentStatus: invoice.payment_status,
      balance: invoice.balance,
    },
  });
  return nextStatus;
}

async function sendPaymentLifecycleEmail(
  event: WebhookEvent,
  invoice: ReturnType<typeof buildInvoiceState>,
  receiptId: string | null,
  bookingStatus: string | null,
) {
  const recipientEmail = stringValue(invoice.parent_email);
  if (!recipientEmail) return null;

  const shouldSendConfirmation = bookingStatus === "confirmed" && shouldIssueReceipt(event.event_type);
  const shouldSendGuarantee = event.event_type === "guarantee_created";
  if (!shouldSendConfirmation && !shouldSendGuarantee) return null;

  const metadata = isObject(invoice.metadata) ? invoice.metadata as Record<string, unknown> : {};
  const parentName = stringValue(metadata.parentName) || stringValue(metadata.parent_name) || "Parent";
  const firstName = firstNameFrom(parentName);
  const receipt = receiptId ? await getReceipt(receiptId) : null;
  const receiptNumber = stringValue(receipt?.receipt_number) || stringValue(invoice.provider_reference) || stringValue(invoice.id);
  const amountPaid = moneyValue(invoice.paid_amount) || moneyValue(receipt?.amount);
  const subject = shouldSendGuarantee
    ? `Card guarantee saved for booking ${stringValue(invoice.booking_id) || stringValue(invoice.id)}`
    : `Your Après School booking is confirmed`;
  const lines = shouldSendGuarantee
    ? [
      `Hi ${firstName},`,
      "",
      "Your card guarantee has been saved through PonchoPay.",
      "Your place is held while your childcare voucher or Tax-Free Childcare payment is matched automatically.",
      "",
      `Invoice: ${invoice.id}`,
      `Amount protected: ${formatMoney(moneyValue(invoice.total_amount), stringValue(invoice.currency) || "GBP")}`,
      `Reference: ${stringValue(invoice.provider_reference) || "shown in your parent portal"}`,
      "",
      "If the voucher or Tax-Free Childcare payment does not arrive, PonchoPay may charge the guaranteed card.",
      "",
      "Thank you,",
      "Après School",
    ]
    : [
      `Hi ${firstName},`,
      "",
      "Your Après School booking is confirmed.",
      "Your payment has been matched through PonchoPay and your receipt is available in the parent portal.",
      "",
      `Invoice: ${invoice.id}`,
      `Receipt: ${receiptNumber}`,
      `Amount paid: ${formatMoney(amountPaid, stringValue(invoice.currency) || "GBP")}`,
      `Reference: ${stringValue(invoice.provider_reference) || stringValue(event.provider_reference) || "PonchoPay"}`,
      "",
      "Thank you,",
      "Après School",
    ];

  const emailLog = await sendBookingEmail(supabase, {
    recipientEmail,
    recipientName: parentName,
    emailType: shouldSendGuarantee ? "booking_card_guarantee_saved" : "booking_confirmation_receipt",
    subject,
    text: lines.join("\n"),
    html: paragraphsToHtml(lines),
    metadata: {
      invoiceId: invoice.id,
      bookingId: stringValue(invoice.booking_id),
      receiptId,
      receiptNumber,
      providerEventId: event.provider_event_id,
      eventType: event.event_type,
      paymentStatus: invoice.payment_status,
      parentPortalStatus: invoice.parent_portal_status,
      source: "ponchopay-process-events",
    },
  });

  if (receiptId) {
    const { error } = await supabase
      .from("booking_receipts")
      .update({
        delivery_status: stringValue(emailLog?.status) === "sent" ? "email_sent" : "email_failed",
        metadata: {
          ...(isObject(receipt?.metadata) ? receipt?.metadata as Record<string, unknown> : {}),
          emailLogId: stringValue(emailLog?.id),
          emailStatus: stringValue(emailLog?.status),
          emailError: stringValue(emailLog?.error_message),
        },
      })
      .eq("id", receiptId);
    if (error) throw error;
  }

  return emailLog;
}

async function getReceipt(receiptId: string) {
  const { data, error } = await supabase
    .from("booking_receipts")
    .select("id, receipt_number, amount, currency, delivery_status, metadata")
    .eq("id", receiptId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function bookingStatusForInvoice(paymentStatus: string) {
  switch (paymentStatus) {
    case "paid":
    case "bank_confirmed":
    case "reconciled":
    case "paid_by_fallback_card":
      return "confirmed";
    case "payment_guaranteed":
    case "payment_plan_active":
    case "part_paid":
    case "failed":
    case "reserved":
    case "reported_complete":
    case "updated_needs_review":
    case "cancelled":
    case "payment_plan_cancelled":
    case "refunded":
    default:
      return "payment_pending";
  }
}

function shouldIssueReceipt(eventType: string) {
  return ["payment_completed", "payment_reconciled", "fallback_card_charged", "recurring_payment_captured"].includes(eventType);
}

async function markEvent(id: string, processingStatus: string, outcome: string) {
  const { error } = await supabase
    .from("ponchopay_webhook_events")
    .update({
      processing_status: processingStatus,
      processing_outcome: outcome,
      processed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

function isObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function firstNameFrom(value: string) {
  return value.split(/\s+/).filter(Boolean)[0] || "there";
}

function formatMoney(value: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(moneyValue(value));
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
