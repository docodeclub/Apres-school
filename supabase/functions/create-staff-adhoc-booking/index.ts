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
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.apres-school.co.uk";

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Ad-hoc booking service is not configured" }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before adding an ad-hoc booking." }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your staff session has expired." }, 401);

    const payload = await request.json().catch(() => ({}));
    const childId = stringValue(payload.childId);
    const registerDate = stringValue(payload.registerDate);
    const sessionBlockIds = Array.isArray(payload.sessionBlockIds)
      ? [...new Set(payload.sessionBlockIds.map(stringValue).filter(Boolean))]
      : [];
    const applyNonBookingFee = payload.applyNonBookingFee === true;

    if (!childId) return json({ error: "Choose a pupil." }, 400);
    if (!registerDate) return json({ error: "Choose a register date." }, 400);
    if (!sessionBlockIds.length) return json({ error: "Choose at least one session." }, 400);

    const { data: booking, error: bookingError } = await callerClient.rpc("create_staff_adhoc_booking", {
      p_child_id: childId,
      p_register_date: registerDate,
      p_session_block_ids: sessionBlockIds,
      p_apply_non_booking_fee: applyNonBookingFee,
    });
    if (bookingError) throw new Error(bookingError.message || "The ad-hoc booking could not be created.");

    const { error: pricingError } = await serviceClient.rpc("apply_booking_pricing", {
      p_booking_id: booking.bookingId,
    });
    if (pricingError) throw new Error(pricingError.message || "The family pricing could not be applied.");

    const { data: finance, error: financeError } = await callerClient.rpc("finalise_staff_adhoc_account_charge", {
      p_booking_id: booking.bookingId,
    });
    if (financeError) throw new Error(financeError.message || "The family account charge could not be completed.");

    const [{ data: bookingRow, error: bookingRowError }, { data: items, error: itemsError }] = await Promise.all([
      serviceClient
        .from("bookings")
        .select("id, booking_reference, parent_account_id, parent_email, parent_name, gross_total, discount_amount, pricing_group_name, total_amount, due_today, invoice_id")
        .eq("id", booking.bookingId)
        .single(),
      serviceClient
        .from("booking_items")
        .select("child_name, site_name, programme_name, session_label, starts_at, ends_at, original_unit_amount, unit_discount_amount, pricing_label, unit_amount")
        .eq("booking_id", booking.bookingId)
        .order("starts_at"),
    ]);
    if (bookingRowError) throw bookingRowError;
    if (itemsError) throw itemsError;

    const total = moneyValue(bookingRow.total_amount);
    const outstanding = moneyValue(finance?.outstanding);
    const creditApplied = moneyValue(finance?.creditApplied);
    const creditBalance = moneyValue(finance?.creditBalance);
    const parentName = stringValue(bookingRow.parent_name) || "Parent or carer";
    const parentEmail = stringValue(bookingRow.parent_email).toLowerCase();
    const bookingReference = stringValue(bookingRow.booking_reference);
    const parentPortalUrl = `${publicSiteUrl.replace(/\/$/, "")}/launch-booking?account=payments`;
    const childName = stringValue(items?.[0]?.child_name) || stringValue(booking.childName) || "your child";
    const sessionLines = (items || []).map((item) => {
      const startsAt = new Date(item.starts_at);
      const endsAt = new Date(item.ends_at);
      return `${stringValue(item.session_label) || "Session"} — ${startsAt.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/London",
      })}, ${timeValue(startsAt)}–${timeValue(endsAt)}`;
    });

    let emailSent = false;
    let emailError = "";
    if (parentEmail) {
      const lines = [
        `Hi ${firstName(parentName)},`,
        `${childName} has been added to the register for ad-hoc care by the Après School team.`,
        ...sessionLines,
        `Pricing group: ${stringValue(bookingRow.pricing_group_name) || "Standard"}.`,
        moneyValue(bookingRow.discount_amount) > 0 ? `Pricing benefit: -£${moneyValue(bookingRow.discount_amount).toFixed(2)}.` : "",
        `Ad-hoc care total: £${total.toFixed(2)}.`,
        creditApplied > 0 ? `£${creditApplied.toFixed(2)} of account credit has been used.` : "",
        outstanding > 0
          ? `Your family account is now £${Math.abs(creditBalance).toFixed(2)} in debit. Please pay the outstanding £${outstanding.toFixed(2)} from Payments & credit.`
          : `The charge has been covered by your account credit. Your available credit is £${Math.max(creditBalance, 0).toFixed(2)}.`,
        bookingReference ? `Booking reference: ${bookingReference}.` : "",
        outstanding > 0 ? "Please clear the outstanding invoice before making another booking." : "",
        `Parent portal: ${parentPortalUrl}`,
        "If you have any questions, reply to this email and we will help.",
        "Thank you,",
        "Après School",
      ].filter(Boolean);

      try {
        const emailLog = await sendBookingEmail(serviceClient, {
          recipientEmail: parentEmail,
          recipientName: parentName,
          emailType: outstanding > 0 ? "staff_adhoc_account_debit" : "staff_adhoc_booking",
          subject: outstanding > 0
            ? `Action needed: £${outstanding.toFixed(2)} due for ${childName}'s ad-hoc care`
            : `${childName}'s ad-hoc care has been added`,
          text: lines.join("\n"),
          html: paragraphsToHtml(lines, {
            title: outstanding > 0 ? "Ad-hoc care added — payment required" : "Ad-hoc care added",
            preheader: outstanding > 0
              ? `Your family account has £${outstanding.toFixed(2)} outstanding.`
              : `${childName} has been added to the register.`,
          }),
          sentBy: userData.user.id,
          metadata: {
            bookingId: bookingRow.id,
            bookingReference: bookingRow.booking_reference,
            invoiceId: bookingRow.invoice_id,
            total,
            creditApplied,
            outstanding,
            creditBalance,
            source: "staff_adhoc",
          },
        });
        emailSent = emailLog?.status === "sent";
        emailError = stringValue(emailLog?.error_message);
      } catch (error) {
        emailError = error instanceof Error ? error.message : "The parent notification could not be sent.";
      }
    } else {
      emailError = "This family account does not have an email address.";
    }

    return json({
      ...booking,
      ...finance,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to create the ad-hoc booking" }, 400);
  }
});

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function timeValue(value: Date) {
  return value.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
