import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const operationsTo = Deno.env.get("OPERATIONS_NOTIFICATION_TO") ?? "hello@apres-school.co.uk";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom = Deno.env.get("RESEND_FROM") ?? "Après School <hello@apres-school.co.uk>";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const actor = await getActor(authHeader);
    if (!actor || !["manager", "admin", "superadmin"].includes(actor.role)) {
      return json({ error: "Not authorised to send cover move notifications" }, 403);
    }

    const payload = normalizePayload(await request.json());
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);

    const { data, error } = await supabase
      .from("cover_moves")
      .insert({
        cover_staff_name: payload.coverStaff,
        covered_staff_name: payload.coveredStaff,
        destination_site: payload.siteName,
        destination_address: payload.address,
        session_type: payload.sessionType,
        session_time: payload.sessionTime,
        move_date: payload.date || null,
        reason: payload.reason,
        notes: payload.notes,
        cover_email: payload.coverEmail,
        covered_email: payload.coveredEmail,
        email_status: resendApiKey ? "sending" : "queued_without_provider",
        created_by: actor.id,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (resendApiKey) {
      await sendCoverEmails(payload);
      await supabase
        .from("cover_moves")
        .update({ email_status: "sent", sent_at: new Date().toISOString() })
        .eq("id", data.id);
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: "cover_move_notification_sent",
      table_name: "cover_moves",
      record_id: data.id,
      metadata: {
        coverStaff: payload.coverStaff,
        coveredStaff: payload.coveredStaff,
        destinationSite: payload.siteName,
        emailProviderConfigured: Boolean(resendApiKey),
      },
    });

    return json({ coverMove: { ...data, email_status: resendApiKey ? "sent" : "queued_without_provider" } });
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to send cover move notifications" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return profile;
}

function normalizePayload(payload: Record<string, unknown>) {
  return {
    coverStaff: stringValue(payload.coverStaff),
    coveredStaff: stringValue(payload.coveredStaff),
    siteName: stringValue(payload.siteName),
    sessionType: stringValue(payload.sessionType),
    sessionTime: stringValue(payload.sessionTime),
    date: stringValue(payload.date),
    reason: stringValue(payload.reason) || "Cover",
    notes: stringValue(payload.notes),
    coverEmail: stringValue(payload.coverEmail),
    coveredEmail: stringValue(payload.coveredEmail),
    address: stringValue(payload.address),
    mapUrl: stringValue(payload.mapUrl),
  };
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.coverStaff) return "Covering staff is required";
  if (!payload.coveredStaff) return "Covered staff is required";
  if (payload.coverStaff === payload.coveredStaff) return "Covering staff and covered staff must be different";
  if (!payload.siteName) return "Destination site is required";
  if (!payload.coverEmail.includes("@")) return "Covering staff email is required";
  if (!payload.coveredEmail.includes("@")) return "Covered staff email is required";
  return null;
}

async function sendCoverEmails(payload: ReturnType<typeof normalizePayload>) {
  const coverText = [
    `Hi ${payload.coverStaff},`,
    "",
    `Thank you for your flexibility whilst covering at ${payload.siteName}.`,
    `You are covering ${payload.coveredStaff} for ${payload.sessionType || "the session"}${payload.sessionTime ? ` (${payload.sessionTime})` : ""}.`,
    payload.address ? `Location: ${payload.address}` : "",
    payload.mapUrl ? `Map: ${payload.mapUrl}` : "",
    payload.notes ? `Notes: ${payload.notes}` : "",
    "",
    "Thank you,",
    "Après School",
  ].filter(Boolean).join("\n");

  const coveredText = [
    `Hi ${payload.coveredStaff},`,
    "",
    `${payload.coverStaff} has been assigned to cover your session at ${payload.siteName}.`,
    payload.sessionTime ? `Session time: ${payload.sessionTime}` : "",
    "The rota has been updated so the team has the latest cover information.",
    "",
    "Thank you,",
    "Après School",
  ].filter(Boolean).join("\n");

  const opsText = [
    "Cover move notification sent.",
    `Covering: ${payload.coverStaff} <${payload.coverEmail}>`,
    `Covered: ${payload.coveredStaff} <${payload.coveredEmail}>`,
    `Site: ${payload.siteName}`,
    `Reason: ${payload.reason}`,
  ].join("\n");

  await Promise.all([
    sendEmail(payload.coverEmail, `Cover update: ${payload.siteName}`, coverText),
    sendEmail(payload.coveredEmail, `Cover arranged: ${payload.siteName}`, coveredText),
    sendEmail(operationsTo, `Cover move logged: ${payload.siteName}`, opsText),
  ]);
}

async function sendEmail(to: string, subject: string, text: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email failed with ${response.status}`);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
