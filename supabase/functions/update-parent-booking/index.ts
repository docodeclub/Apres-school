import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

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

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

type UpdateBookingRequest = {
  action?: string;
  bookingId?: string;
  booking_id?: string;
  invoiceId?: string;
  invoice_id?: string;
  bookingItemIds?: string[];
  booking_item_ids?: string[];
  items?: Array<Record<string, unknown>>;
  amount?: number | string;
  reason?: string;
  note?: string;
  metadata?: Record<string, unknown>;
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor) return json({ error: "Sign in before changing a booking." }, 401);

    const body = await request.json().catch(() => null) as UpdateBookingRequest | null;
    if (!body || typeof body !== "object") return json({ error: "Booking update payload is required" }, 400);

    const action = stringValue(body.action).toLowerCase();
    const bookingId = stringValue(body.bookingId) || stringValue(body.booking_id);
    const invoiceId = stringValue(body.invoiceId) || stringValue(body.invoice_id);

    if ([
      "resend_payment_link",
      "resend_receipt",
      "mark_finance_review",
      "record_credit_note",
      "request_refund",
      "mark_voucher_reconciled",
      "mark_fallback_card_charge",
      "payment_admin_action",
    ].includes(action)) {
      if (!invoiceId) return json({ error: "Invoice id is required." }, 400);
      if (!["admin", "superadmin", "finance"].includes(String(actor.role || "").toLowerCase())) {
        return json({ error: "Only admin or finance users can update live payment actions." }, 403);
      }
      const result = await handlePaymentAdminAction({
        actor,
        invoiceId,
        action,
        note: stringValue(body.note) || stringValue(body.reason),
        amount: body.amount,
        reason: stringValue(body.reason),
        metadata: isObject(body.metadata) ? body.metadata : {},
      });
      return json(result);
    }

    if (!bookingId) return json({ error: "Booking id is required." }, 400);

    if (action === "cancel" || action === "cancel_booking") {
      const { data, error } = await supabase.rpc("cancel_parent_booking", {
        p_parent_id: actor.id,
        p_booking_id: bookingId,
        p_reason: stringValue(body.reason),
        p_actor_role: actor.role || "parent",
      });
      if (error) throw error;
      const email = await sendBookingChangeEmail({
        actor,
        action: "cancel",
        result: data as Record<string, unknown>,
        reason: stringValue(body.reason),
      });
      return json({
        action: "cancel",
        email,
        ...(data as Record<string, unknown>),
      });
    }

    if (action === "remove_items" || action === "remove_sessions" || action === "amend_remove_items") {
      const bookingItemIds = normaliseStringArray(body.bookingItemIds || body.booking_item_ids);
      if (!bookingItemIds.length) return json({ error: "Choose at least one session to remove." }, 400);
      const { data, error } = await supabase.rpc("amend_parent_booking_remove_items", {
        p_parent_id: actor.id,
        p_booking_id: bookingId,
        p_booking_item_ids: bookingItemIds,
        p_reason: stringValue(body.reason),
        p_actor_role: actor.role || "parent",
      });
      if (error) throw error;
      const email = await sendBookingChangeEmail({
        actor,
        action: "remove_items",
        result: data as Record<string, unknown>,
        reason: stringValue(body.reason),
      });
      return json({
        action: "remove_items",
        email,
        ...(data as Record<string, unknown>),
      });
    }

    if (action === "add_items" || action === "add_sessions" || action === "amend_add_items") {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return json({ error: "Choose at least one session to add." }, 400);
      const { data, error } = await supabase.rpc("amend_parent_booking_add_items", {
        p_parent_id: actor.id,
        p_booking_id: bookingId,
        p_items: items,
        p_reason: stringValue(body.reason),
        p_actor_role: actor.role || "parent",
      });
      if (error) throw error;
      const email = await sendBookingChangeEmail({
        actor,
        action: "add_items",
        result: data as Record<string, unknown>,
        reason: stringValue(body.reason),
      });
      return json({
        action: "add_items",
        email,
        ...(data as Record<string, unknown>),
      });
    }

    return json({ error: "Unsupported booking update action." }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unable to update booking";
    const status = /window has closed|not found for this parent|not authorised|not authorized/i.test(message) ? 403 : 500;
    return json({ error: message }, status);
  }
});

type Actor = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

type PaymentAdminActionInput = {
  actor: Actor;
  invoiceId: string;
  action: string;
  note: string;
  amount?: number | string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

async function handlePaymentAdminAction(input: PaymentAdminActionInput) {
  const { data: invoice, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select(`
      id,
      booking_id,
      parent_email,
      provider_reference,
      total_amount,
      paid_amount,
      refunded_amount,
      balance,
      currency,
      payment_status,
      parent_portal_status,
      receipt_status,
      finance_status,
      metadata,
      ponchopay_checkout_sessions(
        provider_checkout_url,
        provider_reference,
        payment_method,
        payment_plan,
        status
      ),
      booking_receipts(
        receipt_number,
        amount,
        issued_at,
        delivery_status
      )
    `)
    .eq("id", input.invoiceId)
    .maybeSingle();

  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error("Invoice not found.");

  const checkout = firstRow(invoice.ponchopay_checkout_sessions);
  const receipt = firstRow(invoice.booking_receipts);
  const action = input.action === "payment_admin_action"
    ? "mark_finance_review"
    : input.action;
  const actionAmount = moneyValue(input.amount);
  const actionReason = stringValue(input.reason);
  const actionMetadata = isObject(input.metadata) ? input.metadata : {};
  const emailLog = action === "resend_payment_link"
    ? await queuePaymentEmail({
      actor: input.actor,
      invoice,
      emailType: "booking_payment_link",
      subject: `Payment link for invoice ${invoice.id}`,
      body: paymentLinkBody(invoice, checkout),
    })
    : action === "resend_receipt"
      ? await queuePaymentEmail({
        actor: input.actor,
        invoice,
        emailType: "booking_payment_receipt",
        subject: `Receipt for invoice ${invoice.id}`,
        body: receiptBody(invoice, receipt),
      })
      : null;

  const nextFinanceStatus = financeStatusForPaymentAdminAction(action, invoice);
  const nextPortalStatus = parentPortalStatusForPaymentAdminAction(action, invoice);
  const updatePayload: Record<string, unknown> = {
    finance_status: nextFinanceStatus,
    parent_portal_status: nextPortalStatus,
    metadata: {
      ...(isObject(invoice.metadata) ? invoice.metadata : {}),
      lastAdminAction: {
        action,
        amount: actionAmount || null,
        reason: actionReason || null,
        at: new Date().toISOString(),
        by: input.actor.id,
        note: input.note,
        emailLogId: emailLog?.id || null,
        metadata: actionMetadata,
      },
    },
    updated_at: new Date().toISOString(),
  };

  if (action === "mark_voucher_reconciled") {
    const totalAmount = moneyValue(invoice.total_amount);
    updatePayload.paid_amount = totalAmount;
    updatePayload.balance = 0;
    updatePayload.payment_status = "payment_reconciled";
    updatePayload.receipt_status = "voucher_reconciled";
  }

  const { error: updateError } = await supabase
    .from("booking_invoices")
    .update(updatePayload)
    .eq("id", invoice.id);

  if (updateError) throw updateError;

  const { data: adminAction, error: actionError } = await supabase
    .from("booking_payment_admin_actions")
    .insert({
      invoice_id: invoice.id,
      booking_id: stringValue(invoice.booking_id) || null,
      action,
      status: paymentAdminActionStatus(action, emailLog?.status),
      actor_id: input.actor.id,
      actor_email: input.actor.email,
      actor_role: input.actor.role,
      parent_email: stringValue(invoice.parent_email),
      provider_reference: stringValue(invoice.provider_reference) || stringValue(checkout?.provider_reference),
      message_log_id: emailLog?.id || null,
      note: input.note || null,
      metadata: {
        amount: actionAmount || null,
        reason: actionReason || null,
        ...actionMetadata,
        balance: moneyValue(invoice.balance),
        totalAmount: moneyValue(invoice.total_amount),
        paidAmount: moneyValue(invoice.paid_amount),
        refundedAmount: moneyValue(invoice.refunded_amount),
        paymentStatus: stringValue(invoice.payment_status),
        receiptStatus: stringValue(invoice.receipt_status),
        checkoutStatus: stringValue(checkout?.status),
      },
    })
    .select("id, invoice_id, action, status, message_log_id, created_at")
    .single();

  if (actionError) throw actionError;

  await supabase.from("audit_log").insert({
    actor_id: input.actor.id,
    action: `booking_payment_${action}`,
    table_name: "booking_invoices",
    record_id: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      bookingId: stringValue(invoice.booking_id),
      parentEmail: stringValue(invoice.parent_email),
      financeStatus: nextFinanceStatus,
      emailLogId: emailLog?.id || null,
      amount: actionAmount || null,
      reason: actionReason || null,
      note: input.note,
    },
  });

  return {
    action,
    invoiceId: invoice.id,
    financeStatus: nextFinanceStatus,
    parentPortalStatus: nextPortalStatus,
    emailLog,
    adminAction,
  };
}

function financeStatusForPaymentAdminAction(action: string, invoice: Record<string, unknown>) {
  switch (action) {
    case "mark_finance_review":
      return "finance_review";
    case "resend_payment_link":
      return "payment_link_resent";
    case "resend_receipt":
      return "receipt_resent";
    case "record_credit_note":
      return "credit_note_recorded";
    case "request_refund":
      return "refund_requested";
    case "mark_voucher_reconciled":
      return "voucher_reconciled";
    case "mark_fallback_card_charge":
      return "fallback_card_charge_logged";
    default:
      return stringValue(invoice.finance_status) || "awaiting_payment";
  }
}

function parentPortalStatusForPaymentAdminAction(action: string, invoice: Record<string, unknown>) {
  switch (action) {
    case "resend_payment_link":
      return "Payment link resent";
    case "resend_receipt":
      return "Receipt resent";
    case "mark_finance_review":
      return "Finance review";
    case "record_credit_note":
      return "Credit note recorded";
    case "request_refund":
      return "Refund requested";
    case "mark_voucher_reconciled":
      return "Paid by childcare voucher";
    case "mark_fallback_card_charge":
      return "Fallback card charge logged";
    default:
      return stringValue(invoice.parent_portal_status) || "Outstanding";
  }
}

function paymentAdminActionStatus(action: string, emailStatus = "") {
  const allowed = new Set(["queued", "sent", "recorded", "review_required", "completed", "failed"]);
  if (allowed.has(emailStatus)) return emailStatus;
  if (emailStatus) return "sent";
  if (["mark_finance_review", "request_refund", "mark_fallback_card_charge"].includes(action)) return "review_required";
  if (["record_credit_note", "mark_voucher_reconciled"].includes(action)) return "completed";
  return "recorded";
}

async function getActor(authHeader: string): Promise<Actor | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile?.active) return null;
  return profile as Actor;
}

async function queuePaymentEmail({ actor, invoice, emailType, subject, body }: {
  actor: Actor;
  invoice: Record<string, unknown>;
  emailType: string;
  subject: string;
  body: string;
}) {
  const recipientEmail = stringValue(invoice.parent_email);
  if (!recipientEmail) throw new Error("Invoice has no parent email.");
  return sendBookingEmail(supabase, {
    recipientEmail,
    recipientName: stringValue((isObject(invoice.metadata) ? invoice.metadata : {})?.parentName),
    emailType,
    subject,
    text: body,
    html: paragraphsToHtml(body.split("\n"), { title: subject }),
    sentBy: actor.id,
    metadata: {
      invoiceId: invoice.id,
      bookingId: stringValue(invoice.booking_id),
      source: "booking_payment_admin_action",
    },
  }) as Promise<{ id: string; status: string; created_at: string }>;
}

async function sendBookingChangeEmail({
  actor,
  action,
  result,
  reason,
}: {
  actor: Actor;
  action: "cancel" | "remove_items" | "add_items";
  result: Record<string, unknown>;
  reason: string;
}) {
  if (!actor.email) return null;
  const booking = isObject(result.booking) ? result.booking : {};
  const bookingReference = stringValue(booking.bookingReference) || stringValue(booking.id) || "booking";
  const firstName = firstNameFrom(actor.full_name || actor.email);
  const emailType = action === "cancel"
    ? "booking_cancellation_confirmation"
    : "booking_amendment_confirmation";
  const subject = action === "cancel"
    ? `Booking cancelled ${bookingReference}`
    : `Booking updated ${bookingReference}`;
  const amountLine = action === "add_items"
    ? `Additional amount: ${formatMoney(moneyValue(result.addedTotal))}`
    : action === "remove_items"
      ? `Removed value: ${formatMoney(moneyValue(result.removedTotal))}`
      : `Outstanding balance: ${formatMoney(moneyValue(booking.outstandingBalance))}`;
  const countLine = action === "cancel"
    ? `${Number(result.cancelledItems || 0)} session${Number(result.cancelledItems || 0) === 1 ? "" : "s"} cancelled.`
    : action === "add_items"
      ? `${Number(result.addedItems || 0)} session${Number(result.addedItems || 0) === 1 ? "" : "s"} added.`
      : `${Number(result.removedItems || 0)} session${Number(result.removedItems || 0) === 1 ? "" : "s"} removed.`;
  const lines = [
    `Hi ${firstName},`,
    "",
    action === "cancel" ? "Your booking cancellation has been recorded." : "Your booking has been updated.",
    countLine,
    amountLine,
    `Reference: ${bookingReference}`,
    reason ? `Reason: ${reason}` : "",
    "",
    action === "add_items"
      ? "If there is an extra balance, it will show in your parent portal."
      : "Any credit or finance review will show in your parent portal.",
    "",
    "Thank you,",
    "Après School",
  ].filter((line) => line !== "");

  return sendBookingEmail(supabase, {
    recipientEmail: actor.email,
    recipientName: actor.full_name,
    emailType,
    subject,
    text: lines.join("\n"),
    html: paragraphsToHtml(lines, { title: subject }),
    sentBy: actor.id,
    metadata: {
      bookingId: stringValue(booking.id),
      bookingReference,
      invoiceId: stringValue(booking.invoiceId),
      action,
      result,
      source: "update-parent-booking",
    },
  });
}

function paymentLinkBody(invoice: Record<string, unknown>, checkout: Record<string, unknown>) {
  const link = stringValue(checkout?.provider_checkout_url);
  const reference = stringValue(invoice.provider_reference) || stringValue(checkout?.provider_reference) || "pending";
  return [
    `Your invoice ${invoice.id} has ${moneyValue(invoice.balance).toFixed(2)} ${stringValue(invoice.currency) || "GBP"} outstanding.`,
    link ? `PonchoPay link: ${link}` : "Open your parent portal to complete payment.",
    `Reference: ${reference}`,
  ].join("\n");
}

function receiptBody(invoice: Record<string, unknown>, receipt: Record<string, unknown>) {
  const receiptNumber = stringValue(receipt?.receipt_number) || stringValue(invoice.provider_reference) || String(invoice.id);
  return [
    `Your receipt for invoice ${invoice.id} is ready.`,
    `Receipt: ${receiptNumber}`,
    `Amount paid: ${moneyValue(invoice.paid_amount).toFixed(2)} ${stringValue(invoice.currency) || "GBP"}`,
  ].join("\n");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function moneyValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstRow(value: unknown) {
  if (Array.isArray(value)) return isObject(value[0]) ? value[0] : {};
  return isObject(value) ? value : {};
}

function firstNameFrom(value: string) {
  return value.split(/\s+/).filter(Boolean)[0] || "there";
}

function formatMoney(value: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(moneyValue(value));
}

function normaliseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
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
