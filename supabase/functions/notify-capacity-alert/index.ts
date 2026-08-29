import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const alertTo = Deno.env.get("APRES_CAPACITY_ALERT_TO") ?? "luke@apres-school.co.uk";
const alertCc = Deno.env.get("APRES_CAPACITY_ALERT_CC") ?? "lindsay@willingtonschool.co.uk";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Capacity alerts are not configured" }, 500);

  try {
    if (!(await isAuthorised(request.headers.get("Authorization") || ""))) {
      return json({ error: "Not authorised" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const alertId = stringValue(body?.alertId);
    if (!alertId) return json({ error: "Capacity alert id is required" }, 400);

    const { data: claimedRows, error: claimError } = await supabase
      .from("capacity_alerts")
      .update({
        status: "sending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", alertId)
      .in("status", ["pending", "failed"])
      .select("id, school_name, programme_name, session_label, session_date, capacity, occupied, notification_attempts")
      .limit(1);
    if (claimError) throw claimError;

    const alert = claimedRows?.[0];
    if (!alert) {
      const { data: existing, error: existingError } = await supabase
        .from("capacity_alerts")
        .select("status")
        .eq("id", alertId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return json({ error: "Capacity alert not found" }, 404);
      return json({ emailed: existing.status === "sent", alreadyProcessed: true, status: existing.status });
    }

    const formattedDate = formatDate(alert.session_date);
    const subject = `At capacity: ${alert.school_name} — ${alert.session_label} — ${formattedDate}`;
    const lines = [
      "Hi Luke and Lindsay,",
      "A session has reached its booking capacity.",
      `School: ${alert.school_name}`,
      `Care type: ${alert.programme_name}`,
      `Session: ${alert.session_label}`,
      `Date: ${formattedDate}`,
      `Capacity: ${alert.capacity} children`,
      "No action is required unless you would like to review staffing, capacity or the waiting list.",
      "Après School",
    ];

    const emailLog = await sendBookingEmail(supabase, {
      recipientEmail: alertTo,
      recipientName: "Luke Currie",
      cc: [alertCc],
      emailType: "session_capacity_reached",
      subject,
      text: lines.join("\n"),
      html: paragraphsToHtml(lines, {
        eyebrow: "Après School Operations",
        badge: "At capacity",
        title: "A session is now full",
        preheader: `${alert.school_name}, ${alert.session_label}, ${formattedDate} has reached ${alert.capacity} children.`,
      }),
      metadata: {
        capacityAlertId: alert.id,
        schoolName: alert.school_name,
        programmeName: alert.programme_name,
        sessionLabel: alert.session_label,
        sessionDate: alert.session_date,
        capacity: alert.capacity,
        occupied: alert.occupied,
        recipients: [alertTo, alertCc],
      },
    });

    const sent = emailLog?.status === "sent";
    const { error: updateError } = await supabase
      .from("capacity_alerts")
      .update({
        status: sent ? "sent" : "failed",
        notification_attempts: Number(alert.notification_attempts || 0) + 1,
        provider_message_id: emailLog?.provider_message_id || null,
        email_log_id: emailLog?.id || null,
        last_error: emailLog?.error_message || null,
        sent_at: sent ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", alert.id);
    if (updateError) throw updateError;

    return json({ emailed: sent, emailLogId: emailLog?.id, emailError: emailLog?.error_message || "" });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to send the capacity alert" }, 500);
  }
});

async function isAuthorised(authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === serviceRoleKey) return true;
  const { data, error } = await supabase.auth.getUser(token);
  return !error && Boolean(data.user);
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

