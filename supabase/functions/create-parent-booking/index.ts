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

type BookingItemRequest = {
  childId?: string;
  child_id?: string;
  childName?: string;
  child_name?: string;
  sessionBlockId?: string;
  session_block_id?: string;
  labSessionId?: string;
  sessionDate?: string;
  sessionLabel?: string;
  quantity?: number;
  metadata?: Record<string, unknown>;
};

type BookingRequest = {
  parent?: {
    fullName?: string;
    full_name?: string;
    email?: string;
    phone?: string;
  };
  booking?: Record<string, unknown>;
  clientRequestId?: string;
  client_request_id?: string;
  paymentMethod?: string;
  paymentPlan?: string;
  paymentRoute?: string;
  depositAmount?: number;
  cancellationHours?: number;
  amendmentHours?: number;
  source?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
  items?: BookingItemRequest[];
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor) return json({ error: "Sign in before booking." }, 401);

    const body = await request.json().catch(() => null) as BookingRequest | null;
    const validationError = validateRequest(body);
    if (validationError || !body) return json({ error: validationError || "Booking payload is required" }, 400);

    const parentName = stringValue(body.parent?.fullName) || stringValue(body.parent?.full_name) || actor.full_name || actor.email;
    const bookingPayload = normaliseBookingPayload(body);

    const { data: reservation, error: reservationError } = await supabase.rpc("create_parent_booking_reservation", {
      p_parent_id: actor.id,
      p_parent_email: actor.email,
      p_parent_name: parentName,
      p_parent_phone: stringValue(body.parent?.phone),
      p_booking: bookingPayload,
      p_items: body.items,
    });

    if (reservationError) throw reservationError;
    const reservationResult = reservation as ReservationResult;
    const booking = reservationResult.booking;
    const savedItems = reservationResult.items || [];

    let checkout: Record<string, unknown> | null = null;
    if (moneyValue(booking?.dueToday) > 0 && savedItems.some((item) => item.status !== "waitlist")) {
      checkout = await createCheckout({
        bookingId: stringValue(booking.id),
        invoiceId: stringValue(booking.invoiceId),
        parentId: actor.id,
        parentEmail: actor.email,
        parentName,
        paymentMethod: stringValue(booking.paymentMethod) || stringValue(bookingPayload.paymentMethod) || "card",
        paymentPlan: stringValue(booking.paymentPlan) || stringValue(bookingPayload.paymentPlan) || "pay_now",
        successUrl: withReturnParams(stringValue(body.successUrl), {
          payment: "pending",
          invoice: stringValue(booking.invoiceId),
          reference: stringValue(booking.bookingReference) || stringValue(booking.id),
        }),
        cancelUrl: withReturnParams(stringValue(body.cancelUrl), {
          payment: "cancelled",
          invoice: stringValue(booking.invoiceId),
          reference: stringValue(booking.bookingReference) || stringValue(booking.id),
        }),
        items: savedItems
          .filter((item) => item.status !== "waitlist")
          .map((item) => ({
            id: item.id,
            childId: item.child_id,
            childName: item.child_name,
            siteName: item.site_name,
            careType: item.programme_name,
            sessionId: item.session_id,
            sessionName: item.session_label,
            date: item.starts_at,
            startTime: item.starts_at,
            endTime: item.ends_at,
            quantity: item.quantity,
            unitAmount: moneyValue(item.unit_amount),
          })),
        metadata: {
          ...(isObject(bookingPayload.metadata) ? bookingPayload.metadata : {}),
          bookingReference: stringValue(booking.bookingReference),
          source: stringValue(bookingPayload.source) || "parent_portal",
          ...(isObject(body.metadata) ? body.metadata : {}),
        },
      });

      const nextStatus = await updateBookingAfterCheckout(stringValue(booking.id), checkout, booking);
      if (nextStatus) booking.status = nextStatus;
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: reservationResult.existing ? "parent_booking_reused" : "parent_booking_created",
      table_name: "bookings",
      record_id: stringValue(booking.id) || null,
      metadata: {
        bookingReference: stringValue(booking.bookingReference),
        totalAmount: moneyValue(booking.totalAmount),
        dueToday: moneyValue(booking.dueToday),
        checkoutStatus: checkout?.status || "not_required",
        itemCount: savedItems.length,
        existing: Boolean(reservationResult.existing),
      },
    });

    const bookingEmail = await sendBookingRequestEmail({
      actor,
      parentName,
      booking,
      items: savedItems,
      checkout,
      existing: Boolean(reservationResult.existing),
    });

    return json({
      created: !reservationResult.existing,
      existing: Boolean(reservationResult.existing),
      booking,
      parent: reservationResult.parent,
      items: savedItems,
      checkout,
      email: bookingEmail,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to create booking" }, 500);
  }
});

type Actor = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

type ReservationResult = {
  existing?: boolean;
  booking: Record<string, unknown>;
  parent: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
};

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

async function sendBookingRequestEmail({
  actor,
  parentName,
  booking,
  items,
  checkout,
  existing,
}: {
  actor: Actor;
  parentName: string;
  booking: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  checkout: Record<string, unknown> | null;
  existing: boolean;
}) {
  const recipientEmail = actor.email;
  if (!recipientEmail) return null;

  const dueToday = moneyValue(booking.dueToday);
  const totalAmount = moneyValue(booking.totalAmount);
  const checkoutUrl = stringValue(checkout?.checkoutUrl) || stringValue(checkout?.providerCheckoutUrl);
  const bookingReference = stringValue(booking.bookingReference) || stringValue(booking.id);
  const subject = dueToday > 0
    ? `Complete payment for booking ${bookingReference}`
    : `Booking request received ${bookingReference}`;
  const itemSummary = summariseItems(items);
  const firstName = firstNameFrom(parentName || actor.full_name || actor.email);
  const statusLine = dueToday > 0
    ? "Your place is reserved while payment is completed through PonchoPay."
    : "We have received your booking request and no payment is due today.";
  const paymentLine = checkoutUrl
    ? `Secure payment link: ${checkoutUrl}`
    : dueToday > 0
      ? "Open the parent portal to complete payment."
      : "No payment link is needed for this booking.";
  const lines = [
    `Hi ${firstName},`,
    "",
    existing ? "We found your existing booking request." : "We have received your booking request.",
    statusLine,
    "",
    `Reference: ${bookingReference}`,
    `Total: ${formatMoney(totalAmount)}`,
    `Due today: ${formatMoney(dueToday)}`,
    itemSummary ? `Sessions: ${itemSummary}` : "",
    paymentLine,
    "",
    "Important: your booking is confirmed only after payment or the card guarantee is completed through PonchoPay.",
    "",
    "Thank you,",
    "Après School",
  ].filter((line) => line !== "");

  return sendBookingEmail(supabase, {
    recipientEmail,
    recipientName: parentName,
    emailType: dueToday > 0 ? "booking_payment_pending" : "booking_request_received",
    subject,
    text: lines.join("\n"),
    html: paragraphsToHtml(lines),
    sentBy: actor.id,
    metadata: {
      bookingId: stringValue(booking.id),
      bookingReference,
      invoiceId: stringValue(booking.invoiceId),
      checkoutId: stringValue(checkout?.id),
      checkoutStatus: stringValue(checkout?.status),
      totalAmount,
      dueToday,
      itemCount: items.length,
      source: "create-parent-booking",
    },
  });
}

function validateRequest(body: BookingRequest | null) {
  if (!body || typeof body !== "object") return "Booking payload is required";
  if (!Array.isArray(body.items) || body.items.length === 0) return "Choose at least one session before booking.";
  const missingSession = body.items.find((item) => {
    const metadata = isObject(item.metadata) ? item.metadata : {};
    const hasBlockId = Boolean(stringValue(item.sessionBlockId) || stringValue(item.session_block_id));
    const hasResolvableMetadata = Boolean(
      (stringValue(item.labSessionId) || stringValue(metadata.labSessionId)) &&
      (stringValue(item.sessionDate) || stringValue(metadata.sessionDate)) &&
      (stringValue(item.sessionLabel) || stringValue(metadata.labBlockLabel))
    );
    return !hasBlockId && !hasResolvableMetadata;
  });
  if (missingSession) return "Each booking item needs a session block id or resolvable session metadata.";
  return null;
}

function normaliseBookingPayload(body: BookingRequest) {
  const clientRequestId =
    stringValue(body.clientRequestId) ||
    stringValue(body.client_request_id) ||
    stringValue(body.booking?.clientRequestId) ||
    stringValue(body.booking?.client_request_id) ||
    stringValue(body.metadata?.clientRequestId) ||
    stringValue(body.metadata?.client_request_id) ||
    stringValue(body.metadata?.localDraftId);

  return {
    ...(isObject(body.booking) ? body.booking : {}),
    clientRequestId,
    paymentMethod: stringValue(body.paymentMethod) || stringValue(body.booking?.paymentMethod) || stringValue(body.booking?.payment_method) || "card",
    paymentPlan: stringValue(body.paymentPlan) || stringValue(body.booking?.paymentPlan) || stringValue(body.booking?.payment_plan) || "pay_now",
    paymentRoute: stringValue(body.paymentRoute) || stringValue(body.booking?.paymentRoute) || stringValue(body.booking?.payment_route) || "ponchopay_card_voucher",
    depositAmount: moneyValue(body.depositAmount ?? body.booking?.depositAmount ?? body.booking?.deposit_amount),
    cancellationHours: integerValue(body.cancellationHours ?? body.booking?.cancellationHours ?? body.booking?.cancellation_hours, 24),
    amendmentHours: integerValue(body.amendmentHours ?? body.booking?.amendmentHours ?? body.booking?.amendment_hours, 24),
    source: stringValue(body.source) || stringValue(body.booking?.source) || "parent_portal",
    metadata: {
      ...(isObject(body.booking?.metadata) ? body.booking?.metadata : {}),
      ...(isObject(body.metadata) ? body.metadata : {}),
      clientRequestId,
    },
  };
}

async function createCheckout(payload: Record<string, unknown>) {
  const response = await fetch(`${supabaseUrl}/functions/v1/ponchopay-create-checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(stringValue(result.error) || `PonchoPay checkout failed with ${response.status}`);
  }
  if (result?.error) throw new Error(stringValue(result.error));
  return result;
}

async function updateBookingAfterCheckout(
  bookingId: string,
  checkout: Record<string, unknown>,
  booking: Record<string, unknown>,
) {
  const checkoutStatus = stringValue(checkout.status);
  const currentStatus = stringValue(booking.status);
  const nextStatus = currentStatus === "waitlist"
    ? "waitlist"
    : checkoutStatus === "provider_error"
      ? "payment_pending"
      : "payment_pending";

  const { error } = await supabase
    .from("bookings")
    .update({
      invoice_id: stringValue(checkout.invoiceId) || stringValue(booking.invoiceId) || null,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  if (error) throw error;
  return nextStatus;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function withReturnParams(url: string, params: Record<string, string>) {
  if (!url) return "";
  try {
    const nextUrl = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      if (value) nextUrl.searchParams.set(key, value);
    });
    return nextUrl.toString();
  } catch {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => Boolean(value)),
    ).toString();
    if (!query) return url;
    return `${url}${url.includes("?") ? "&" : "?"}${query}`;
  }
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
}

function integerValue(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function firstNameFrom(value: string) {
  return value.split(/\s+/).filter(Boolean)[0] || "there";
}

function formatMoney(value: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(moneyValue(value));
}

function summariseItems(items: Array<Record<string, unknown>>) {
  const labels = items.slice(0, 4).map((item) => {
    const date = stringValue(item.starts_at)
      ? new Date(stringValue(item.starts_at)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      : "";
    const child = stringValue(item.child_name);
    const session = stringValue(item.session_label) || stringValue(item.programme_name);
    return [date, child, session].filter(Boolean).join(" · ");
  }).filter(Boolean);
  const extra = items.length > labels.length ? ` + ${items.length - labels.length} more` : "";
  return `${labels.join("; ")}${extra}`;
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
