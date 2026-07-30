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

const requiredChildConsentRows = [
  "I give consent for my child being photographed",
  "Does your child have religious or cultural needs?",
  "I consent to my child receiving emergency treatments",
  "I consent for plasters to be used on my child if required",
  "I consent to my child taking part in face-painting activities",
  "I consent to my child having medication. I have completed a medical form in advance",
  "I consent to my child to be supported by staff to apply sun cream",
  "I consent for pictures or videos of my child to be used on social media",
  "I consent to my child receiving basic first-aid treatments",
  "I consent to my child receiving help in the bathroom if needed (6 years old and under)",
  "I consent for my child to be collected by someone in my list of collectors",
  "I consent to my child going home alone (Year 6 only)",
];

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
  applyAccountCredit?: boolean;
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
    const bookingActor = await resolveBookingActor(actor);

    const body = await request.json().catch(() => null) as BookingRequest | null;
    const validationError = validateRequest(body);
    if (validationError || !body) return json({ error: validationError || "Booking payload is required" }, 400);

    const parentName = stringValue(body.parent?.fullName) || stringValue(body.parent?.full_name) || actor.full_name || actor.email;
    const bookingPayload = normaliseBookingPayload(body, {
      bookedByProfileId: actor.id,
      bookedByEmail: actor.email,
      accountHolderRole: bookingActor.accountHolderRole,
    });

    if (stringValue(body.source) === "launch_parent_flow") {
      const childProfileBlock = await findChildProfileBookingBlock(bookingActor, body.items || []);
      if (childProfileBlock) {
        return json({
          error: childProfileBlock.message,
          code: "CHILD_PROFILE_INCOMPLETE",
          childId: childProfileBlock.childId,
          childName: childProfileBlock.childName,
          missingFields: childProfileBlock.missingFields,
          unansweredConsents: childProfileBlock.unansweredConsents,
        }, 409);
      }
    }

    const { data: financeGate, error: financeGateError } = await supabase.rpc("parent_booking_finance_gate", {
      p_parent_id: bookingActor.id,
      p_parent_email: bookingActor.email,
    });
    if (financeGateError) throw financeGateError;
    if (financeGate?.blocked === true) {
      const outstanding = moneyValue(financeGate.outstandingBalance);
      return json({
        error: outstanding > 0
          ? `Please clear the £${outstanding.toFixed(2)} outstanding balance on your family account before making another booking.`
          : "Please clear the negative balance on your family account before making another booking.",
        code: "OUTSTANDING_ACCOUNT_BALANCE",
        outstandingBalance: outstanding,
        creditBalance: moneyValue(financeGate.creditBalance),
      }, 409);
    }

    const { data: reservation, error: reservationError } = await supabase.rpc("create_parent_booking_reservation", {
      p_parent_id: bookingActor.id,
      p_parent_email: bookingActor.email,
      p_parent_name: parentName,
      p_parent_phone: stringValue(body.parent?.phone),
      p_booking: bookingPayload,
      p_items: body.items,
    });

    if (reservationError) throw reservationError;
    const reservationResult = reservation as ReservationResult;
    let booking = reservationResult.booking;
    let savedItems = reservationResult.items || [];

    if (!reservationResult.existing) {
      const { data: pricingData, error: pricingError } = await supabase.rpc("apply_booking_pricing", {
        p_booking_id: stringValue(booking.id),
      });
      if (pricingError) throw pricingError;
      if (isObject(pricingData)) {
        const pricedBooking = isObject(pricingData.booking) ? pricingData.booking : {};
        booking = {
          ...booking,
          status: stringValue(pricedBooking.status) || stringValue(booking.status),
          totalAmount: moneyValue(pricingData.totalAmount ?? pricedBooking.total_amount),
          grossTotal: moneyValue(pricingData.grossTotal ?? pricedBooking.gross_total),
          discountAmount: moneyValue(pricingData.discountTotal ?? pricedBooking.discount_amount),
          dueToday: moneyValue(pricedBooking.due_today),
          outstandingBalance: moneyValue(pricedBooking.outstanding_balance),
          pricingGroupId: stringValue(pricingData.pricingGroupId || pricedBooking.pricing_group_id),
          pricingGroupName: stringValue(pricingData.pricingGroupName || pricedBooking.pricing_group_name) || "Standard",
        };
        if (Array.isArray(pricingData.items)) savedItems = pricingData.items as Array<Record<string, unknown>>;
      }
    }

    const zeroBalanceBooking = moneyValue(booking.totalAmount) <= 0
      && stringValue(booking.status).toLowerCase() !== "waitlist"
      && savedItems.some((item) => stringValue(item.status).toLowerCase() !== "waitlist");
    if (zeroBalanceBooking && stringValue(booking.status).toLowerCase() !== "confirmed") {
      const confirmedAt = new Date().toISOString();
      const { error: bookingConfirmationError } = await supabase
        .from("bookings")
        .update({
          status: "confirmed",
          due_today: 0,
          outstanding_balance: 0,
          updated_at: confirmedAt,
        })
        .eq("id", stringValue(booking.id));
      if (bookingConfirmationError) throw bookingConfirmationError;

      const { error: itemConfirmationError } = await supabase
        .from("booking_items")
        .update({ status: "confirmed", updated_at: confirmedAt })
        .eq("booking_id", stringValue(booking.id))
        .eq("status", "reserved");
      if (itemConfirmationError) throw itemConfirmationError;

      const confirmedItemIds = savedItems
        .filter((item) => stringValue(item.status).toLowerCase() !== "waitlist")
        .map((item) => stringValue(item.id))
        .filter(Boolean);
      if (confirmedItemIds.length) {
        const { error: holdConfirmationError } = await supabase
          .from("booking_capacity_holds")
          .update({ status: "confirmed", expires_at: null })
          .in("booking_item_id", confirmedItemIds)
          .is("released_at", null);
        if (holdConfirmationError) throw holdConfirmationError;
      }

      booking = {
        ...booking,
        status: "confirmed",
        dueToday: 0,
        outstandingBalance: 0,
      };
      savedItems = savedItems.map((item) => stringValue(item.status).toLowerCase() === "reserved"
        ? { ...item, status: "confirmed", updated_at: confirmedAt }
        : item);
    }

    let credit: Record<string, unknown> = {
      applied: 0,
      dueToday: moneyValue(booking.dueToday),
      fullyCovered: false,
    };
    if (body.applyAccountCredit === true) {
      const { data: creditData, error: creditError } = await supabase.rpc("apply_parent_account_credit_to_booking", {
        p_parent_id: bookingActor.id,
        p_booking_id: stringValue(booking.id),
      });
      if (creditError) throw creditError;
      credit = isObject(creditData) ? creditData : credit;
      booking.dueToday = moneyValue(credit.dueToday ?? booking.dueToday);
      if (stringValue(credit.invoiceId)) booking.invoiceId = stringValue(credit.invoiceId);
      if (credit.fullyCovered === true) booking.status = "confirmed";
    }

    let checkout: Record<string, unknown> | null = null;
    if (moneyValue(booking?.dueToday) > 0 && savedItems.some((item) => item.status !== "waitlist")) {
      try {
        checkout = await createCheckout({
        bookingId: stringValue(booking.id),
        invoiceId: stringValue(booking.invoiceId),
        parentId: actor.id,
        parentEmail: actor.email,
        parentName,
        paymentMethod: stringValue(booking.paymentMethod) || stringValue(bookingPayload.paymentMethod) || "card",
        paymentPlan: stringValue(booking.paymentPlan) || stringValue(bookingPayload.paymentPlan) || "pay_now",
        amount: moneyValue(booking.dueToday),
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
          grossBookingTotal: moneyValue(booking.totalAmount),
          originalBookingTotal: moneyValue(booking.grossTotal),
          discountTotal: moneyValue(booking.discountAmount),
          pricingGroupId: stringValue(booking.pricingGroupId) || null,
          pricingGroupName: stringValue(booking.pricingGroupName) || "Standard",
          accountCreditApplied: moneyValue(credit.applied),
          accountCreditEntryId: stringValue(credit.entryId) || null,
          ...(isObject(body.metadata) ? body.metadata : {}),
        },
        });
      } catch (checkoutError) {
        if (moneyValue(credit.applied) > 0) {
          await supabase.rpc("release_parent_account_credit_from_booking", {
            p_parent_id: bookingActor.id,
            p_booking_id: stringValue(booking.id),
            p_reason: checkoutError instanceof Error ? checkoutError.message : "Checkout creation failed",
          });
        }
        throw checkoutError;
      }

      if (!stringValue(checkout?.checkoutUrl) && moneyValue(credit.applied) > 0) {
        const { data: releasedCredit, error: releaseError } = await supabase.rpc("release_parent_account_credit_from_booking", {
          p_parent_id: bookingActor.id,
          p_booking_id: stringValue(booking.id),
          p_reason: stringValue(checkout?.errorMessage) || stringValue(checkout?.message) || "PonchoPay did not return a payment link",
        });
        if (releaseError) throw releaseError;
        if (isObject(releasedCredit)) {
          booking.dueToday = moneyValue(releasedCredit.dueToday ?? booking.dueToday);
          credit = { ...credit, applied: 0, fullyCovered: false, released: releasedCredit.released };
        }
      }

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
        grossTotal: moneyValue(booking.grossTotal),
        discountAmount: moneyValue(booking.discountAmount),
        pricingGroupName: stringValue(booking.pricingGroupName) || "Standard",
        dueToday: moneyValue(booking.dueToday),
        checkoutStatus: checkout?.status || "not_required",
        itemCount: savedItems.length,
        existing: Boolean(reservationResult.existing),
        bookedByProfileId: actor.id,
        bookedByEmail: actor.email,
        accountHolderRole: bookingActor.accountHolderRole,
      },
    });

    let bookingEmail: unknown = null;
    try {
      bookingEmail = await sendBookingRequestEmail({
        actor,
        parentName,
        booking,
        items: savedItems,
        checkout,
        existing: Boolean(reservationResult.existing),
      });
    } catch (emailError) {
      console.error("Booking saved but confirmation email failed", emailError);
      bookingEmail = {
        status: "failed",
        error: emailError instanceof Error ? emailError.message : "Confirmation email could not be sent.",
      };
      await supabase.from("audit_log").insert({
        actor_id: actor.id,
        action: "parent_booking_email_failed",
        table_name: "bookings",
        record_id: stringValue(booking.id) || null,
        metadata: {
          bookingReference: stringValue(booking.bookingReference),
          parentEmail: actor.email,
          error: emailError instanceof Error ? emailError.message : "Confirmation email could not be sent.",
        },
      });
    }

    return json({
      created: !reservationResult.existing,
      existing: Boolean(reservationResult.existing),
      booking,
      parent: reservationResult.parent,
      items: savedItems,
      checkout,
      credit,
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

type BookingActor = Actor & {
  accountHolderRole: string;
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

async function resolveBookingActor(actor: Actor): Promise<BookingActor> {
  try {
    const { data: holder, error } = await supabase
      .from("parent_account_holders")
      .select(`
        role,
        status,
        parent_accounts(
          profile_id,
          email,
          full_name,
          phone
        )
      `)
      .or(`profile_id.eq.${actor.id},email.eq.${actor.email}`)
      .neq("status", "removed")
      .limit(1)
      .maybeSingle();

    if (error) {
      if (["42P01", "42703", "PGRST200", "PGRST205"].includes(error.code || "")) {
        return { ...actor, accountHolderRole: "primary" };
      }
      throw error;
    }

    const parentAccount = Array.isArray(holder?.parent_accounts)
      ? holder?.parent_accounts[0]
      : holder?.parent_accounts;
    const parentProfileId = stringValue(parentAccount?.profile_id);
    const parentEmail = stringValue(parentAccount?.email);

    if (parentProfileId && parentEmail) {
      return {
        id: parentProfileId,
        email: parentEmail,
        full_name: stringValue(parentAccount?.full_name) || actor.full_name,
        role: actor.role,
        accountHolderRole: stringValue(holder?.role) || "secondary",
      };
    }
  } catch (error) {
    console.error("Unable to resolve linked parent account holder", error);
  }

  return { ...actor, accountHolderRole: "primary" };
}

async function findChildProfileBookingBlock(bookingActor: BookingActor, items: BookingItemRequest[]) {
  const { data: parentAccount, error: parentError } = await supabase
    .from("parent_accounts")
    .select("id")
    .or(`profile_id.eq.${bookingActor.id},email.eq.${bookingActor.email}`)
    .limit(1)
    .maybeSingle();
  if (parentError) throw parentError;
  if (!parentAccount?.id) {
    return {
      childId: "",
      childName: "Child",
      missingFields: ["parent account"],
      unansweredConsents: [],
      message: "Your family account could not be verified. Sign out, sign in again and retry checkout.",
    };
  }

  const { data: children, error: childError } = await supabase
    .from("child_profiles")
    .select("id, full_name, date_of_birth, school_name, year_group, consents, active")
    .eq("parent_account_id", parentAccount.id)
    .eq("active", true);
  if (childError) throw childError;

  const requestedChildren = [...new Map(items.map((item) => {
    const childId = stringValue(item.childId || item.child_id);
    const childName = stringValue(item.childName || item.child_name);
    return [`${childId}:${childName.toLowerCase()}`, { childId, childName }];
  })).values()];

  for (const requested of requestedChildren) {
    const child = (children || []).find((candidate) => (
      (requested.childId && stringValue(candidate.id) === requested.childId)
      || (requested.childName && stringValue(candidate.full_name).toLowerCase() === requested.childName.toLowerCase())
    ));
    if (!child) {
      return {
        childId: requested.childId,
        childName: requested.childName || "Child",
        missingFields: ["saved child profile"],
        unansweredConsents: [],
        message: `${requested.childName || "This child"}'s saved profile could not be verified. Remove the basket line and add it again.`,
      };
    }
    const consents = isObject(child.consents) ? child.consents : {};
    const registration = isObject(consents.registration) ? consents.registration : {};
    const responses = isObject(consents.responses) ? consents.responses : {};
    const missingFields = [
      ["date of birth", child.date_of_birth],
      ["gender", registration.gender],
      ["relationship to child", registration.relationship],
      ["who the child lives with", registration.livesWith],
      ["parental responsibility", registration.parentalResponsibility],
      ["school", child.school_name],
      ["year group", child.year_group],
      ["collection password", registration.collectionPassword],
    ].filter((entry) => !stringValue(entry[1])).map((entry) => String(entry[0]));
    const unansweredConsents = requiredChildConsentRows.filter((row) => !["Yes", "No"].includes(stringValue(responses[row])));
    if (missingFields.length || unansweredConsents.length) {
      const childName = stringValue(child.full_name) || requested.childName || "This child";
      const issue = missingFields.length
        ? `complete ${missingFields.slice(0, 3).join(", ")}${missingFields.length > 3 ? " and the remaining required details" : ""}`
        : `answer every permission with Yes or No (${unansweredConsents.length} still require an answer)`;
      return {
        childId: stringValue(child.id),
        childName,
        missingFields,
        unansweredConsents,
        message: `${childName}'s profile needs attention before checkout: ${issue}.`,
      };
    }
  }
  return null;
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
  const confirmedWithoutBalance = dueToday <= 0 && stringValue(booking.status).toLowerCase() === "confirmed";
  const subject = dueToday > 0
    ? `Complete secure checkout for ${bookingReference}`
    : confirmedWithoutBalance
      ? `Your Après School booking is confirmed`
      : `Booking received ${bookingReference}`;
  const itemSummary = summariseItems(items);
  const firstName = firstNameFrom(parentName || actor.full_name || actor.email);
  const statusLine = dueToday > 0
    ? "Your selected place is available. Complete secure checkout through PonchoPay and we will confirm the booking automatically."
    : confirmedWithoutBalance
      ? "Your booking is confirmed and there is no balance to pay."
      : "Your booking has been received and no payment is due today.";
  const paymentLine = checkoutUrl
    ? `Secure payment link: ${checkoutUrl}`
    : dueToday > 0
      ? "Open the parent portal to complete payment."
      : "No payment link is needed for this booking.";
  const lines = [
    `Hi ${firstName},`,
    "",
    confirmedWithoutBalance
      ? "Your Après School booking is confirmed."
      : existing
        ? "We found your existing booking request."
        : "We have received your booking.",
    statusLine,
    "",
    `Reference: ${bookingReference}`,
    `Pricing group: ${stringValue(booking.pricingGroupName) || "Standard"}`,
    moneyValue(booking.discountAmount) > 0 ? `Discount applied: -${formatMoney(moneyValue(booking.discountAmount))}` : "",
    `Total: ${formatMoney(totalAmount)}`,
    `Due today: ${formatMoney(dueToday)}`,
    itemSummary ? `Sessions: ${itemSummary}` : "",
    paymentLine,
    confirmedWithoutBalance ? "A branded PDF invoice is attached for your records." : "",
    "",
    dueToday > 0
      ? "Once secure checkout is complete, your confirmation and receipt will be sent automatically."
      : "Your booking confirmation is being prepared.",
    "",
    "Thank you,",
    "Après School",
  ].filter((line) => line !== "");

  const invoiceAttachment = confirmedWithoutBalance
    ? (() => {
      const bytes = buildBookingInvoicePdf({
        invoiceNumber: bookingReference,
        bookingReference,
        issueDate: new Date().toISOString(),
        parentName,
        parentEmail: recipientEmail,
        currency: "GBP",
        total: totalAmount,
        paid: totalAmount,
        balance: 0,
        statusLabel: "Paid with account credit",
        paymentMethod: "Account credit",
        lines: items.map((item) => ({
          childName: item.child_name,
          siteName: item.site_name,
          careType: item.programme_name,
          sessionName: item.session_label,
          date: item.starts_at,
          startTime: item.starts_at,
          endTime: item.ends_at,
          quantity: item.quantity,
          unitAmount: item.unit_amount,
          originalUnitAmount: item.original_unit_amount,
          discountAmount: item.unit_discount_amount,
          pricingLabel: item.pricing_label,
          total: item.line_total,
        })),
      });
      return {
        filename: bookingInvoiceFilename({ invoiceNumber: bookingReference, bookingReference }),
        content: bytesToBase64(bytes),
      };
    })()
    : null;

  return sendBookingEmail(supabase, {
    recipientEmail,
    recipientName: parentName,
    emailType: dueToday > 0 ? "booking_payment_pending" : confirmedWithoutBalance ? "booking_confirmation_receipt" : "booking_request_received",
    subject,
    text: lines.join("\n"),
    html: paragraphsToHtml(lines, {
      title: dueToday > 0 ? "Complete secure checkout" : confirmedWithoutBalance ? "Booking confirmed" : "Booking received",
      preheader: dueToday > 0
        ? "Your selected place is available. Complete checkout through PonchoPay and we will confirm automatically."
        : "Your Après School booking has been received.",
    }),
    attachments: invoiceAttachment ? [invoiceAttachment] : [],
    sentBy: actor.id,
    metadata: {
      bookingId: stringValue(booking.id),
      bookingReference,
      invoiceId: stringValue(booking.invoiceId),
      checkoutId: stringValue(checkout?.id),
      checkoutStatus: stringValue(checkout?.status),
      totalAmount,
      grossTotal: moneyValue(booking.grossTotal),
      discountAmount: moneyValue(booking.discountAmount),
      pricingGroupName: stringValue(booking.pricingGroupName) || "Standard",
      dueToday,
      itemCount: items.length,
      source: "create-parent-booking",
      invoiceAttachment: invoiceAttachment?.filename || null,
    },
  });
}

function validateRequest(body: BookingRequest | null) {
  if (!body || typeof body !== "object") return "Booking payload is required";
  const parentEmail = stringValue(body.parent?.email);
  const parentPhone = stringValue(body.parent?.phone);
  if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) return "Enter a valid parent email.";
  if (parentPhone && !isValidPhoneNumber(parentPhone)) return "Enter a valid parent phone number.";
  if (!Array.isArray(body.items) || body.items.length === 0) return "Choose at least one session before booking.";
  const invalidQuantity = body.items.find((item) => {
    if (item.quantity == null) return false;
    const quantity = Number(item.quantity);
    return !Number.isFinite(quantity) || quantity < 1;
  });
  if (invalidQuantity) return "Each booking item quantity must be at least 1.";
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

function compactPhoneNumber(value: string) {
  return String(value || "").replace(/[\s().-]/g, "");
}

function isValidPhoneNumber(value: string, options: { required?: boolean } = {}) {
  const compact = compactPhoneNumber(value);
  if (!compact) return !options.required;
  return /^(\+44|0)\d{9,10}$/.test(compact) || /^\+[1-9]\d{7,14}$/.test(compact);
}

function normaliseBookingPayload(body: BookingRequest, actorMetadata: Record<string, unknown> = {}) {
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
      ...actorMetadata,
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
