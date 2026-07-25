import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";
import {
  bookingInvoiceFilename,
  buildBookingInvoicePdf,
  bytesToBase64,
} from "../_shared/booking-invoice-pdf.js";

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

type ReservationResult = {
  existing?: boolean;
  booking: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);
  const serviceRoleAuthorised =
    request.headers.get("authorization") === `Bearer ${serviceRoleKey}` ||
    request.headers.get("apikey") === serviceRoleKey ||
    bearerRole(request.headers.get("authorization")) === "service_role";
  if (processorToken && request.headers.get("x-processor-token") !== processorToken && !serviceRoleAuthorised) {
    return json({ error: "Not authorised to process PonchoPay events" }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = stringValue(body.action);
    if (action === "normalise_terminal_parent_bookings") {
      return json(await normaliseTerminalParentBookings(stringValue(body.parentEmail)));
    }
    if (action === "normalise_all_terminal_bookings") {
      return json(await normaliseAllTerminalBookings(body.dryRun !== false));
    }
    if (action === "reconcile_paid_checkout_booking") {
      return json(await reconcilePaidCheckoutBooking(stringValue(body.providerReference)));
    }
    if (action === "audit_parent_payments") {
      return json(await auditParentPayments(stringValue(body.parentEmail)));
    }
    if (action === "record_verified_card_payment") {
      return json(await recordVerifiedCardPayment({
        invoiceId: stringValue(body.invoiceId),
        parentEmail: stringValue(body.parentEmail),
        orderReference: stringValue(body.orderReference),
        providerReference: stringValue(body.providerReference),
        amount: moneyValue(body.amount),
      }));
    }
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
    return json({ error: errorMessage(error) || "Unable to process PonchoPay events" }, 500);
  }
});

async function reconcilePaidCheckoutBooking(providerReference: string) {
  if (!providerReference) throw new Error("Provider reference is required");

  const { data: invoice, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select("*")
    .eq("provider_reference", providerReference)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error("Paid invoice was not found");
  if (!["paid", "captured", "bank_confirmed", "reconciled"].includes(stringValue(invoice.payment_status).toLowerCase()) || moneyValue(invoice.balance) > 0) {
    throw new Error("Only a verified, fully paid invoice can be reconciled into a booking");
  }

  const linkedBookingId = stringValue(invoice.booking_id);
  if (isUuid(linkedBookingId)) {
    const { data: linkedBooking, error: linkedBookingError } = await supabase
      .from("bookings")
      .select("id, booking_reference, status, invoice_id")
      .eq("id", linkedBookingId)
      .maybeSingle();
    if (linkedBookingError) throw linkedBookingError;
    if (linkedBooking) return { reconciled: true, existing: true, booking: linkedBooking, invoiceId: invoice.id };
  }

  const metadata = isObject(invoice.metadata) ? invoice.metadata as Record<string, unknown> : {};
  const parentEmail = stringValue(invoice.parent_email).toLowerCase();
  const parentName = stringValue(metadata.parentName) || parentEmail;
  const invoiceItems = Array.isArray(metadata.items) ? metadata.items.filter(isObject) as Array<Record<string, unknown>> : [];
  if (!parentEmail || !invoiceItems.length) throw new Error("Paid checkout does not contain enough booking details to reconcile safely");

  const normalisedTerminalBookings = await normaliseTerminalParentBookings(parentEmail);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, active")
    .ilike("email", parentEmail)
    .eq("active", true)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("The paid checkout parent profile was not found");

  const { data: parentAccount, error: parentAccountError } = await supabase
    .from("parent_accounts")
    .select("id, phone")
    .or(`profile_id.eq.${profile.id},email.ilike.${parentEmail}`)
    .limit(1)
    .maybeSingle();
  if (parentAccountError) throw parentAccountError;
  if (!parentAccount) throw new Error("The paid checkout parent account was not found");

  const childNames = [...new Set(invoiceItems.map((item) => stringValue(item.childName)).filter(Boolean))];
  const { data: children, error: childrenError } = await supabase
    .from("child_profiles")
    .select("id, full_name")
    .eq("parent_account_id", parentAccount.id)
    .eq("active", true);
  if (childrenError) throw childrenError;
  const childIdByName = new Map((children || []).map((child) => [stringValue(child.full_name).toLowerCase(), stringValue(child.id)]));
  for (const childName of childNames) {
    if (!childIdByName.has(childName.toLowerCase())) throw new Error(`Saved child '${childName}' was not found for this parent`);
  }

  const reservationItems = invoiceItems.map((item) => {
    const childName = stringValue(item.childName);
    const sessionLabel = stringValue(item.sessionName);
    const rawSessionId = stringValue(item.sessionId);
    const labSessionId = rawSessionId.endsWith(`-${sessionLabel}`)
      ? rawSessionId.slice(0, -(sessionLabel.length + 1))
      : rawSessionId;
    const sessionDate = isoDateValue(item.date);
    if (!labSessionId || !sessionDate || !sessionLabel) throw new Error("Paid checkout session details could not be mapped safely");
    return {
      childId: childIdByName.get(childName.toLowerCase()),
      childName,
      labSessionId,
      sessionDate,
      sessionLabel,
      quantity: Math.max(1, Number(item.quantity || 1)),
      metadata: {
        labSessionId,
        sessionDate,
        labBlockLabel: sessionLabel,
        recoveredFromProviderReference: providerReference,
      },
    };
  });

  const { data: reservation, error: reservationError } = await supabase.rpc("create_parent_booking_reservation", {
    p_parent_id: profile.id,
    p_parent_email: parentEmail,
    p_parent_name: parentName,
    p_parent_phone: stringValue(parentAccount.phone),
    p_booking: {
      clientRequestId: `ponchopay-recovery:${providerReference}`,
      paymentMethod: stringValue(invoice.payment_method) || "card",
      paymentPlan: "pay_now",
      paymentRoute: "ponchopay_card_voucher",
      source: "verified_payment_reconciliation",
      cancellationHours: 24,
      amendmentHours: 24,
      metadata: { providerReference, recoveredInvoiceId: invoice.id },
    },
    p_items: reservationItems,
  });
  if (reservationError) throw reservationError;

  const reservationResult = reservation as ReservationResult;
  const bookingId = stringValue(reservationResult?.booking?.id);
  if (!isUuid(bookingId)) throw new Error("Reservation did not return a durable booking id");
  if ((reservationResult.items || []).some((item) => stringValue(item.status) === "waitlist")) {
    throw new Error("The paid session no longer has capacity; finance review is required");
  }

  const now = new Date().toISOString();
  const { error: bookingUpdateError } = await supabase
    .from("bookings")
    .update({ status: "confirmed", invoice_id: invoice.id, outstanding_balance: 0, updated_at: now })
    .eq("id", bookingId);
  if (bookingUpdateError) throw bookingUpdateError;
  const { error: itemUpdateError } = await supabase
    .from("booking_items")
    .update({ status: "confirmed", updated_at: now })
    .eq("booking_id", bookingId)
    .eq("status", "reserved");
  if (itemUpdateError) throw itemUpdateError;
  const bookingItemIds = (reservationResult.items || []).map((item) => stringValue(item.id)).filter(isUuid);
  if (bookingItemIds.length) {
    const { error: holdUpdateError } = await supabase
      .from("booking_capacity_holds")
      .update({ status: "confirmed", expires_at: null })
      .in("booking_item_id", bookingItemIds)
      .is("released_at", null);
    if (holdUpdateError) throw holdUpdateError;
  }
  const { error: invoiceUpdateError } = await supabase
    .from("booking_invoices")
    .update({
      booking_id: bookingId,
      metadata: { ...metadata, recoveredBookingId: bookingId, recoveredAt: now },
      updated_at: now,
    })
    .eq("id", invoice.id);
  if (invoiceUpdateError) throw invoiceUpdateError;
  const { error: checkoutUpdateError } = await supabase
    .from("ponchopay_checkout_sessions")
    .update({ booking_id: bookingId, updated_at: now })
    .eq("invoice_id", invoice.id);
  if (checkoutUpdateError) throw checkoutUpdateError;

  const { data: completedEvent } = await supabase
    .from("ponchopay_webhook_events")
    .select("*")
    .eq("invoice_id", invoice.id)
    .eq("event_type", "payment_completed")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: receipt } = await supabase
    .from("booking_receipts")
    .select("id")
    .eq("invoice_id", invoice.id)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const emailLog = completedEvent
    ? await sendPaymentLifecycleEmail(
      completedEvent as WebhookEvent,
      { ...invoice, booking_id: bookingId, metadata: { ...metadata, recoveredBookingId: bookingId } } as ReturnType<typeof buildInvoiceState>,
      stringValue(receipt?.id) || null,
      "confirmed",
    )
    : null;

  await supabase.from("audit_log").insert({
    action: "paid_checkout_booking_reconciled",
    table_name: "bookings",
    record_id: bookingId,
    metadata: { providerReference, invoiceId: invoice.id, emailLogId: stringValue(emailLog?.id) || null },
  });

  return {
    reconciled: true,
    existing: Boolean(reservationResult.existing),
    booking: { ...reservationResult.booking, id: bookingId, status: "confirmed", invoiceId: invoice.id },
    items: reservationResult.items || [],
    invoiceId: invoice.id,
    providerReference,
    confirmationEmail: { id: stringValue(emailLog?.id) || null, status: stringValue(emailLog?.status) || "not_sent" },
    normalisedTerminalBookings,
  };
}

async function normaliseTerminalParentBookings(parentEmail: string) {
  const email = parentEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid parent email is required");
  const terminalInvoiceStatuses = ["cancelled", "canceled", "refunded", "reversed", "void", "voided"];
  const { data: invoices, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select("id, booking_id, payment_status")
    .ilike("parent_email", email)
    .in("payment_status", terminalInvoiceStatuses);
  if (invoiceError) throw invoiceError;

  const bookingIds = [...new Set((invoices || []).map((invoice) => stringValue(invoice.booking_id)).filter(isUuid))];
  if (!bookingIds.length) return { parentEmail: email, bookingsCancelled: 0, itemsCancelled: 0, holdsReleased: 0 };

  const { data: bookingItems, error: itemReadError } = await supabase
    .from("booking_items")
    .select("id, booking_id, status")
    .in("booking_id", bookingIds);
  if (itemReadError) throw itemReadError;
  const activeItemIds = (bookingItems || [])
    .filter((item) => !["cancelled", "no_show", "waitlist"].includes(stringValue(item.status).toLowerCase()))
    .map((item) => stringValue(item.id))
    .filter(isUuid);
  const now = new Date().toISOString();

  const { error: bookingError } = await supabase
    .from("bookings")
    .update({ status: "cancelled", outstanding_balance: 0, updated_at: now })
    .in("id", bookingIds)
    .neq("status", "cancelled");
  if (bookingError) throw bookingError;

  if (activeItemIds.length) {
    const { error: itemError } = await supabase
      .from("booking_items")
      .update({ status: "cancelled", updated_at: now })
      .in("id", activeItemIds);
    if (itemError) throw itemError;
    const { error: holdError } = await supabase
      .from("booking_capacity_holds")
      .update({ status: "released", released_at: now, expires_at: now })
      .in("booking_item_id", activeItemIds)
      .is("released_at", null);
    if (holdError) throw holdError;
  }

  await supabase.from("audit_log").insert({
    action: "terminal_payment_bookings_normalised",
    table_name: "bookings",
    record_id: null,
    metadata: { parentEmail: email, bookingIds, itemIds: activeItemIds },
  });

  return {
    parentEmail: email,
    bookingsCancelled: bookingIds.length,
    itemsCancelled: activeItemIds.length,
    holdsReleased: activeItemIds.length,
  };
}

async function normaliseAllTerminalBookings(dryRun = true) {
  const terminalInvoiceStatuses = ["cancelled", "canceled", "refunded", "reversed", "void", "voided"];
  const invoices: Array<Record<string, unknown>> = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("booking_invoices")
      .select("id, booking_id, parent_email, payment_status")
      .in("payment_status", terminalInvoiceStatuses)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    invoices.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }

  const bookingIds = [...new Set(invoices.map((invoice) => stringValue(invoice.booking_id)).filter(isUuid))];
  const parentEmails = [...new Set(invoices.map((invoice) => stringValue(invoice.parent_email).toLowerCase()).filter(Boolean))];
  if (!bookingIds.length) {
    return {
      dryRun,
      terminalInvoices: invoices.length,
      parentsAffected: 0,
      bookingsToCancel: 0,
      itemsToCancel: 0,
      holdsToRelease: 0,
    };
  }

  const bookingsToCancel: string[] = [];
  const itemsToCancel: string[] = [];
  const holdsToRelease: string[] = [];
  for (const bookingIdChunk of chunks(bookingIds, 100)) {
    const [bookingResult, itemResult] = await Promise.all([
      supabase.from("bookings").select("id, status").in("id", bookingIdChunk),
      supabase.from("booking_items").select("id, booking_id, status").in("booking_id", bookingIdChunk),
    ]);
    if (bookingResult.error) throw bookingResult.error;
    if (itemResult.error) throw itemResult.error;
    bookingsToCancel.push(...(bookingResult.data || [])
      .filter((booking) => stringValue(booking.status).toLowerCase() !== "cancelled")
      .map((booking) => stringValue(booking.id))
      .filter(isUuid));
    itemsToCancel.push(...(itemResult.data || [])
      .filter((item) => !["cancelled", "no_show", "waitlist"].includes(stringValue(item.status).toLowerCase()))
      .map((item) => stringValue(item.id))
      .filter(isUuid));
  }

  for (const itemIdChunk of chunks(itemsToCancel, 100)) {
    const { data, error } = await supabase
      .from("booking_capacity_holds")
      .select("id")
      .in("booking_item_id", itemIdChunk)
      .is("released_at", null);
    if (error) throw error;
    holdsToRelease.push(...(data || []).map((hold) => stringValue(hold.id)).filter(isUuid));
  }

  const result = {
    dryRun,
    terminalInvoices: invoices.length,
    parentsAffected: parentEmails.length,
    bookingsToCancel: bookingsToCancel.length,
    itemsToCancel: itemsToCancel.length,
    holdsToRelease: holdsToRelease.length,
  };
  if (dryRun) return result;

  const now = new Date().toISOString();
  for (const bookingIdChunk of chunks(bookingsToCancel, 100)) {
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", outstanding_balance: 0, updated_at: now })
      .in("id", bookingIdChunk);
    if (error) throw error;
  }
  for (const itemIdChunk of chunks(itemsToCancel, 100)) {
    const { error } = await supabase
      .from("booking_items")
      .update({ status: "cancelled", updated_at: now })
      .in("id", itemIdChunk);
    if (error) throw error;
  }
  for (const holdIdChunk of chunks(holdsToRelease, 100)) {
    const { error } = await supabase
      .from("booking_capacity_holds")
      .update({ status: "released", released_at: now, expires_at: now })
      .in("id", holdIdChunk)
      .is("released_at", null);
    if (error) throw error;
  }

  await supabase.from("audit_log").insert({
    action: "all_terminal_payment_bookings_normalised",
    table_name: "bookings",
    record_id: null,
    metadata: { ...result, dryRun: false, runAt: now },
  });

  return { ...result, dryRun: false, completedAt: now };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function auditParentPayments(parentEmail: string) {
  if (!parentEmail || !parentEmail.includes("@")) throw new Error("A valid parent email is required");
  const { data: invoices, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select("id, booking_id, parent_email, provider_payment_id, provider_reference, total_amount, paid_amount, refunded_amount, balance, payment_status, parent_portal_status, receipt_status, finance_status, metadata, created_at, updated_at")
    .ilike("parent_email", parentEmail)
    .order("created_at", { ascending: false })
    .limit(20);
  if (invoiceError) throw invoiceError;

  const invoiceIds = (invoices || []).map((invoice) => stringValue(invoice.id)).filter(Boolean);
  if (!invoiceIds.length) return { parentEmail, invoices: [], checkoutSessions: [], bookings: [], receipts: [], events: [], creditEntries: [] };

  const [checkoutResult, bookingResult, receiptResult, eventResult, creditResult] = await Promise.all([
    supabase
      .from("ponchopay_checkout_sessions")
      .select("invoice_id, booking_id, provider_payment_id, provider_reference, amount, status, error_message, request_payload, created_at, updated_at")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("id, booking_reference, invoice_id, total_amount, outstanding_balance, status, parent_email, metadata, created_at, updated_at, booking_items(id, child_id, child_name, session_block_id, session_label, starts_at, ends_at, status)")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("booking_receipts")
      .select("invoice_id, provider_event_id, payment_id, provider_reference, receipt_number, amount, delivery_status, issued_at")
      .in("invoice_id", invoiceIds)
      .order("issued_at", { ascending: false }),
    supabase
      .from("ponchopay_webhook_events")
      .select("provider_event_id, event_type, invoice_id, booking_id, payment_id, provider_reference, amount, signature_status, processing_status, processing_outcome, source_path, received_at, processed_at")
      .in("invoice_id", invoiceIds)
      .order("received_at", { ascending: false }),
    supabase
      .from("parent_account_credit_entries")
      .select("id, booking_id, invoice_id, entry_type, amount, currency, status, description, metadata, created_at, updated_at")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [checkoutResult, bookingResult, receiptResult, eventResult, creditResult]) {
    if (result.error) throw result.error;
  }
  return {
    parentEmail,
    invoices: invoices || [],
    checkoutSessions: checkoutResult.data || [],
    bookings: bookingResult.data || [],
    receipts: receiptResult.data || [],
    events: eventResult.data || [],
    creditEntries: creditResult.data || [],
  };
}

async function recordVerifiedCardPayment(input: {
  invoiceId: string;
  parentEmail: string;
  orderReference: string;
  providerReference: string;
  amount: number;
}) {
  if (!input.invoiceId || !input.parentEmail || !input.orderReference || !input.providerReference || input.amount <= 0) {
    throw new Error("Invoice, parent, order reference, PonchoPay reference and amount are required");
  }
  if (!/^PP-/i.test(input.providerReference)) throw new Error("PonchoPay payment reference must start with PP-");

  const { data: invoice, error: invoiceError } = await supabase
    .from("booking_invoices")
    .select("*")
    .eq("id", input.invoiceId)
    .ilike("parent_email", input.parentEmail)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error("Invoice was not found for this parent");

  const { data: checkout, error: checkoutError } = await supabase
    .from("ponchopay_checkout_sessions")
    .select("invoice_id, booking_id, provider_payment_id, provider_reference, amount, currency, status")
    .eq("invoice_id", input.invoiceId)
    .maybeSingle();
  if (checkoutError) throw checkoutError;
  if (!checkout) throw new Error("Checkout session was not found for this invoice");

  const matchesOrder = [stringValue(checkout.provider_reference), stringValue(invoice.provider_reference)]
    .some((reference) => reference.toLowerCase() === input.orderReference.toLowerCase());
  if (!matchesOrder) throw new Error("PonchoPay order note does not match this invoice");
  const expectedAmount = moneyValue(checkout.amount) || moneyValue(invoice.total_amount);
  if (Math.abs(expectedAmount - input.amount) > 0.001 || Math.abs(moneyValue(invoice.total_amount) - input.amount) > 0.001) {
    throw new Error("Completed payment amount does not match the invoice");
  }
  if (["paid", "reconciled", "bank_confirmed", "paid_by_fallback_card"].includes(stringValue(invoice.payment_status))) {
    return { status: "already_paid", invoiceId: input.invoiceId, paymentStatus: invoice.payment_status };
  }

  const providerEventId = `manual-payment-completed:${input.providerReference}:${input.invoiceId}`;
  const now = new Date().toISOString();
  const rawPayload = {
    source: "parent_supplied_ponchopay_confirmation",
    invoiceId: input.invoiceId,
    bookingId: stringValue(invoice.booking_id) || stringValue(checkout.booking_id),
    paymentId: input.providerReference,
    providerReference: input.providerReference,
    orderReference: input.orderReference,
    amount: input.amount,
    currency: stringValue(checkout.currency) || stringValue(invoice.currency) || "GBP",
    parentEmail: input.parentEmail,
  };
  const { data: event, error: eventError } = await supabase
    .from("ponchopay_webhook_events")
    .upsert({
      provider_event_id: providerEventId,
      event_type: "payment_completed",
      payment_id: input.providerReference,
      booking_id: stringValue(invoice.booking_id) || stringValue(checkout.booking_id) || null,
      invoice_id: input.invoiceId,
      provider_reference: input.providerReference,
      amount: input.amount,
      expected_amount: expectedAmount,
      currency: stringValue(checkout.currency) || stringValue(invoice.currency) || "GBP",
      signature_status: "verified",
      processing_status: "received",
      processing_outcome: "Manual reconciliation from parent-supplied PonchoPay completion evidence",
      raw_payload_hash: providerEventId,
      raw_payload: rawPayload,
      source_path: "manual_verified_payment_reconciliation",
      received_at: now,
    }, { onConflict: "provider_event_id" })
    .select("*")
    .maybeSingle();
  if (eventError) throw eventError;

  await supabase.from("booking_payment_events").upsert({
    provider: "ponchopay",
    provider_event_id: providerEventId,
    event_type: "payment_completed",
    booking_id: stringValue(invoice.booking_id) || stringValue(checkout.booking_id) || null,
    invoice_id: input.invoiceId,
    payment_id: input.providerReference,
    provider_reference: input.providerReference,
    amount: input.amount,
    currency: stringValue(checkout.currency) || stringValue(invoice.currency) || "GBP",
    signature_status: "verified",
    processing_status: "received",
    raw_payload_hash: providerEventId,
    raw_payload: rawPayload,
    source_path: "manual_verified_payment_reconciliation",
    received_at: now,
  }, { onConflict: "provider,provider_event_id" });

  const result = await processEvent(event as WebhookEvent);
  await supabase.from("booking_payment_events").update({
    processing_status: result.status,
    processed_at: new Date().toISOString(),
  }).eq("provider", "ponchopay").eq("provider_event_id", providerEventId);
  await supabase.from("audit_log").insert({
    action: "ponchopay_payment_manually_reconciled",
    table_name: "booking_invoices",
    record_id: null,
    metadata: {
      invoiceId: input.invoiceId,
      parentEmail: input.parentEmail,
      orderReference: input.orderReference,
      providerReference: input.providerReference,
      amount: input.amount,
      providerEventId,
      result,
    },
  });
  return result;
}

async function processEvent(event: WebhookEvent) {
  const invoiceId = await resolveInvoiceId(event);
  if (!invoiceId) {
    await markEvent(event.id, "skipped", "No invoice id found; leaving for finance review");
    return { providerEventId: event.provider_event_id, eventType: event.event_type, status: "skipped", reason: "missing_invoice_id" };
  }

  try {
    const currentInvoice = await getInvoice(invoiceId);
    if (!currentInvoice) {
      const outcome = `Invoice ${invoiceId} was not found; event left for finance review`;
      await markEvent(event.id, "skipped", outcome);
      return {
        providerEventId: event.provider_event_id,
        eventType: event.event_type,
        invoiceId,
        status: "skipped",
        reason: "invoice_not_found",
      };
    }
    const nextInvoice = buildInvoiceState(event, currentInvoice);
    await upsertInvoice(nextInvoice);
    await updateCheckoutSessionFromEvent(event, nextInvoice.id);

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
    const message = errorMessage(error) || "Processing failed";
    await markEvent(event.id, "retry", message);
    return { providerEventId: event.provider_event_id, eventType: event.event_type, status: "failed", reason: message };
  }
}

async function updateCheckoutSessionFromEvent(event: WebhookEvent, invoiceId: string) {
  const statusByEvent: Record<string, string> = {
    payment_captured: "captured",
    payment_completed: "paid",
    payment_reconciled: "reconciled",
    payment_in_bank: "bank_confirmed",
    payment_failed: "failed",
    payment_cancelled: "cancelled",
    payment_refunded: "refunded",
  };
  const nextStatus = statusByEvent[event.event_type];
  if (!invoiceId || !nextStatus) return;
  const { error } = await supabase
    .from("ponchopay_checkout_sessions")
    .update({
      status: nextStatus,
      provider_payment_id: event.payment_id || null,
      provider_reference: event.provider_reference || null,
      updated_at: new Date().toISOString(),
    })
    .eq("invoice_id", invoiceId);
  if (error) throw error;
}

async function resolveInvoiceId(event: WebhookEvent) {
  const rawRequest = isObject(event.raw_payload?.request) ? event.raw_payload.request as Record<string, unknown> : {};
  const rawMetadata =
    metadataObject(event.raw_payload?.metadata) ||
    metadataObject(event.raw_payload?.callbackMetadata) ||
    metadataObject(rawRequest.metadata) ||
    {};
  const directInvoiceId =
    event.invoice_id ||
    stringValue(event.raw_payload?.invoiceId) ||
    stringValue(event.raw_payload?.invoice_id) ||
    stringValue(rawMetadata.invoiceId) ||
    stringValue(rawMetadata.invoice_id);
  const metadataBookingId = stringValue(rawMetadata.bookingId) || stringValue(rawMetadata.booking_id);
  if (!event.booking_id && metadataBookingId) event.booking_id = metadataBookingId;
  if (directInvoiceId) {
    event.invoice_id = directInvoiceId;
    await supabase
      .from("ponchopay_webhook_events")
      .update({ invoice_id: directInvoiceId, booking_id: isUuid(stringValue(event.booking_id)) ? event.booking_id : null })
      .eq("id", event.id);
    return directInvoiceId;
  }

  const lookups: Array<[string, string]> = [
    ["provider_payment_id", stringValue(event.payment_id)],
    ["provider_reference", stringValue(event.provider_reference)],
    ["booking_id", isUuid(stringValue(event.booking_id)) ? stringValue(event.booking_id) : ""],
  ];
  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await supabase
      .from("ponchopay_checkout_sessions")
      .select("invoice_id")
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const invoiceId = stringValue(data?.invoice_id);
    if (!invoiceId) continue;

    await supabase
      .from("ponchopay_webhook_events")
      .update({ invoice_id: invoiceId })
      .eq("id", event.id);
    event.invoice_id = invoiceId;
    return invoiceId;
  }
  return "";
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
  const totalAmount = moneyValue(currentInvoice?.total_amount) || normaliseEventAmount(event.expected_amount || event.amount, 0);
  const currentPaid = moneyValue(currentInvoice?.paid_amount) || 0;
  const currentRefunded = moneyValue(currentInvoice?.refunded_amount) || 0;
  const eventAmount = normaliseEventAmount(event.amount, totalAmount);
  const rawParent = typeof event.raw_payload?.parent === "object" && event.raw_payload.parent ? event.raw_payload.parent as Record<string, unknown> : {};
  const rawRequest = isObject(event.raw_payload?.request) ? event.raw_payload.request as Record<string, unknown> : {};
  const rawMetadata =
    metadataObject(event.raw_payload?.metadata) ||
    metadataObject(event.raw_payload?.callbackMetadata) ||
    metadataObject(rawRequest.metadata) ||
    {};
  const parentEmail =
    stringValue(event.raw_payload?.parentEmail) ||
    stringValue(event.raw_payload?.parent_email) ||
    stringValue(rawParent.email) ||
    stringValue(rawMetadata.parentEmail) ||
    stringValue(rawMetadata.parent_email) ||
    stringValue(currentInvoice?.parent_email);

  const base = {
    id: event.invoice_id || stringValue(event.raw_payload?.invoiceId) || stringValue(event.raw_payload?.invoice_id) || stringValue(currentInvoice?.id),
    booking_id: firstUuid([
      event.booking_id,
      event.raw_payload?.bookingId,
      event.raw_payload?.booking_id,
      currentInvoice?.booking_id,
    ]) || null,
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
      ...(isObject(rawMetadata) ? rawMetadata as Record<string, unknown> : {}),
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
        parent_portal_status: "Card guarantee saved; booking confirmed",
        finance_status: "guaranteed_pending_reconciliation",
        processingOutcome: "Card guarantee created; booking confirmed while PonchoPay reconciles voucher/TFC",
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
        paid_amount: Math.max(currentPaid, eventAmount || totalAmount),
        balance: Math.max(0, totalAmount - Math.max(currentPaid, eventAmount || totalAmount) + currentRefunded),
        payment_status: "captured",
        parent_portal_status: "Booking confirmed; payment captured",
        finance_status: "captured_pending_completion",
        processingOutcome: "Payment captured by PonchoPay; booking confirmed while completion finalises",
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
      amount: normaliseEventAmount(event.amount || event.expected_amount, 0),
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

  const metadata = isObject(invoice.metadata) ? invoice.metadata as Record<string, unknown> : {};
  const isCreditTopUp = metadata.creditTopUp === true || stringValue(metadata.creditTopUp).toLowerCase() === "true";
  const shouldSendTopUp = isCreditTopUp && shouldIssueReceipt(event.event_type);
  const shouldSendConfirmation = bookingStatus === "confirmed" && shouldIssueReceipt(event.event_type);
  const shouldSendGuarantee = event.event_type === "guarantee_created";
  if (!shouldSendConfirmation && !shouldSendGuarantee && !shouldSendTopUp) return null;

  const parentName = stringValue(metadata.parentName) || stringValue(metadata.parent_name) || "Parent";
  const firstName = firstNameFrom(parentName);
  const receipt = receiptId ? await getReceipt(receiptId) : null;
  const receiptNumber = stringValue(receipt?.receipt_number) || stringValue(invoice.provider_reference) || stringValue(invoice.id);
  const amountPaid = moneyValue(invoice.paid_amount) || moneyValue(receipt?.amount);
  const invoiceAttachment = !isCreditTopUp
    ? await createBookingInvoiceAttachment(invoice, {
      parentName,
      receiptNumber,
      amountPaid,
      guarantee: shouldSendGuarantee,
    })
    : null;
  const subject = shouldSendTopUp
    ? `Credit added to your Après School account`
    : shouldSendGuarantee
    ? `Your Après School booking is confirmed`
    : `Your Après School booking is confirmed`;
  const lines = shouldSendTopUp
    ? [
      `Hi ${firstName},`,
      "",
      `${formatMoney(amountPaid, stringValue(invoice.currency) || "GBP")} has been added to your Après School account credit.`,
      "The updated balance is available in your parent account and will be applied automatically to future bookings.",
      "",
      `Receipt: ${receiptNumber}`,
      `Reference: ${stringValue(invoice.provider_reference) || stringValue(event.provider_reference) || "PonchoPay"}`,
      "",
      "Thank you,",
      "Après School",
    ]
    : shouldSendGuarantee
    ? [
      `Hi ${firstName},`,
      "",
      "Your Après School booking is confirmed.",
      "Your card guarantee has been saved through PonchoPay while your childcare voucher or Tax-Free Childcare payment is matched automatically.",
      "A branded PDF invoice is attached for your records.",
      "",
      `Invoice: ${invoiceAttachment?.invoiceNumber || stringValue(invoice.provider_reference) || "available in your parent portal"}`,
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
      "A branded PDF invoice is attached for your records.",
      "",
      `Invoice: ${invoiceAttachment?.invoiceNumber || receiptNumber}`,
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
    html: paragraphsToHtml(lines, { title: subject }),
    attachments: invoiceAttachment ? [invoiceAttachment.attachment] : [],
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
      invoiceAttachment: invoiceAttachment?.attachment.filename || null,
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

async function createBookingInvoiceAttachment(
  invoice: ReturnType<typeof buildInvoiceState>,
  options: { parentName: string; receiptNumber: string; amountPaid: number; guarantee: boolean },
) {
  const metadata = isObject(invoice.metadata) ? invoice.metadata as Record<string, unknown> : {};
  let bookingReference = stringValue(metadata.bookingReference) || stringValue(metadata.booking_reference);
  let items = Array.isArray(metadata.items)
    ? metadata.items.filter(isObject) as Array<Record<string, unknown>>
    : [];

  const bookingId = stringValue(invoice.booking_id);
  if (isUuid(bookingId)) {
    const { data, error } = await supabase
      .from("bookings")
      .select("booking_reference, booking_items(child_name, site_name, programme_name, session_label, starts_at, ends_at, quantity, unit_amount, line_total, status)")
      .eq("id", bookingId)
      .maybeSingle();
    if (error) console.error(`Unable to load booking invoice lines: ${error.message}`);
    if (data) {
      bookingReference = stringValue(data.booking_reference) || bookingReference;
      if (Array.isArray(data.booking_items) && data.booking_items.length) {
        items = data.booking_items
          .filter((item: Record<string, unknown>) => stringValue(item.status).toLowerCase() !== "cancelled")
          .map((item: Record<string, unknown>) => ({
            childName: item.child_name,
            siteName: item.site_name,
            careType: item.programme_name,
            sessionName: item.session_label,
            date: item.starts_at,
            startTime: item.starts_at,
            endTime: item.ends_at,
            quantity: item.quantity,
            unitAmount: item.unit_amount,
            total: item.line_total,
          }));
      }
    }
  }

  const invoiceNumber = bookingReference || options.receiptNumber || stringValue(invoice.provider_reference) || "Booking invoice";
  const paymentMethod = stringValue(metadata.paymentMethod) || stringValue(metadata.payment_method) || "PonchoPay";
  const statusLabel = options.guarantee
    ? "Card guarantee in place"
    : moneyValue(invoice.balance) <= 0
      ? "Paid"
      : stringValue(invoice.parent_portal_status) || "Payment arranged";
  const bytes = buildBookingInvoicePdf({
    invoiceNumber,
    bookingReference: bookingReference || invoiceNumber,
    issueDate: new Date().toISOString(),
    parentName: options.parentName,
    parentEmail: stringValue(invoice.parent_email),
    currency: stringValue(invoice.currency) || "GBP",
    total: moneyValue(invoice.total_amount),
    paid: options.guarantee ? moneyValue(invoice.paid_amount) : options.amountPaid,
    balance: moneyValue(invoice.balance),
    statusLabel,
    paymentMethod,
    providerReference: stringValue(invoice.provider_reference),
    lines: items,
  });
  const filename = bookingInvoiceFilename({ invoiceNumber, bookingReference });
  return {
    invoiceNumber,
    attachment: { filename, content: bytesToBase64(bytes) },
  };
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
    case "payment_guaranteed":
    case "payment_plan_active":
    case "captured":
      return "confirmed";
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

function normaliseEventAmount(value: unknown, invoiceTotal: number) {
  const numeric = moneyValue(value);
  if (numeric <= 0) return 0;
  if (invoiceTotal > 0 && numeric > invoiceTotal * 10) return Math.round((numeric / 100 + Number.EPSILON) * 100) / 100;
  if (invoiceTotal === 0 && numeric >= 100 && Number.isInteger(numeric)) return Math.round((numeric / 100 + Number.EPSILON) * 100) / 100;
  return numeric;
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

function bearerRole(authorization: string | null) {
  const token = stringValue(authorization).replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return "";
  try {
    const normalised = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(normalised));
    return stringValue(claims?.role);
  } catch {
    return "";
  }
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoDateValue(value: unknown) {
  const raw = stringValue(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function firstUuid(values: unknown[]) {
  return values.map((value) => stringValue(value)).find((value) => isUuid(value)) || "";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isObject(error)) {
    return stringValue(error.message) || stringValue(error.details) || stringValue(error.hint) || stringValue(error.code);
  }
  return stringValue(error);
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
