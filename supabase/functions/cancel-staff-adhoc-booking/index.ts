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
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Cancellation service is not configured" }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before cancelling ad-hoc care." }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your staff session has expired." }, 401);

    const { data: caller, error: callerError } = await callerClient
      .from("profiles")
      .select("id, role, active")
      .eq("id", userData.user.id)
      .single();
    if (callerError || !caller?.active || !["staff", "manager", "admin", "superadmin"].includes(caller.role)) {
      return json({ error: "Staff register access is required." }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const bookingId = stringValue(payload.bookingId);
    const reason = stringValue(payload.reason) || "Cancelled by staff from the register";
    if (!bookingId) return json({ error: "Choose an ad-hoc booking to cancel." }, 400);

    const { data: booking, error: bookingError } = await serviceClient
      .from("bookings")
      .select("id, booking_reference, parent_id, parent_account_id, parent_email, parent_name, source, metadata")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return json({ error: "The ad-hoc booking could not be found." }, 404);
    if (booking.source !== "staff_adhoc" || booking.metadata?.staffAdHoc !== true) {
      return json({ error: "Only staff-created ad-hoc care can be cancelled here." }, 400);
    }

    let parentId = stringValue(booking.parent_id);
    if (!parentId && booking.parent_account_id) {
      const { data: account } = await serviceClient
        .from("parent_accounts")
        .select("profile_id")
        .eq("id", booking.parent_account_id)
        .maybeSingle();
      parentId = stringValue(account?.profile_id);
    }
    if (!parentId) return json({ error: "The family account could not be identified." }, 400);

    const { data: result, error: cancellationError } = await serviceClient.rpc("cancel_parent_staff_adhoc_booking", {
      p_parent_id: parentId,
      p_booking_id: bookingId,
      p_reason: reason,
    });
    if (cancellationError) throw new Error(cancellationError.message || "The ad-hoc booking could not be cancelled.");

    const items = Array.isArray(result?.items) ? result.items : [];
    const childName = stringValue(items[0]?.childName) || "Your child";
    const parentName = stringValue(booking.parent_name) || "Parent or carer";
    const parentEmail = stringValue(booking.parent_email).toLowerCase();
    const sessionLines = items.map((item: Record<string, unknown>) => {
      const startsAt = new Date(stringValue(item.startsAt));
      const endsAt = new Date(stringValue(item.endsAt));
      return `${stringValue(item.sessionLabel) || "Session"} — ${startsAt.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/London",
      })}, ${timeValue(startsAt)}–${timeValue(endsAt)}`;
    });

    let emailSent = false;
    let emailError = "";
    if (parentEmail && result?.cancelled) {
      const lines = [
        `Hi ${firstName(parentName)},`,
        `${childName}'s ad-hoc care has been cancelled by the Après School team.`,
        ...sessionLines,
        "No further action is needed.",
        Number(result.creditRestored || 0) > 0
          ? `£${Number(result.creditRestored).toFixed(2)} has been returned to your family account credit.`
          : "The family account charge has been reversed.",
        `You can view your account at ${publicSiteUrl.replace(/\/$/, "")}/launch-booking?account=bookings`,
        "If you have any questions, reply to this email and we will help.",
        "Thank you,",
        "Après School",
      ];
      try {
        const emailLog = await sendBookingEmail(serviceClient, {
          recipientEmail: parentEmail,
          recipientName: parentName,
          emailType: "staff_adhoc_cancelled",
          subject: `${childName}'s ad-hoc care has been cancelled`,
          text: lines.join("\n"),
          html: paragraphsToHtml(lines, {
            title: "Ad-hoc care cancelled",
            preheader: "No further action is needed.",
          }),
          sentBy: userData.user.id,
          metadata: {
            bookingId,
            bookingReference: booking.booking_reference,
            creditRestored: Number(result.creditRestored || 0),
            source: "staff_register",
          },
        });
        emailSent = emailLog?.status === "sent";
        emailError = stringValue(emailLog?.error_message);
      } catch (error) {
        emailError = error instanceof Error ? error.message : "The parent notification could not be sent.";
      }
    }

    return json({
      ok: true,
      ...result,
      childName,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to cancel the ad-hoc booking" }, 400);
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
