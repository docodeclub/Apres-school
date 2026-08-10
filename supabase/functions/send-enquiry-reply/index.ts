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
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Email service is not configured" }, 500);

  try {
    const actor = await requireAdmin(request.headers.get("Authorization") || "");
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    const enquiryId = stringValue(payload?.enquiryId);
    const subject = stringValue(payload?.subject);
    const body = stringValue(payload?.body);
    if (!enquiryId) return json({ error: "Choose an enquiry before replying." }, 400);
    if (!subject || subject.length > 180) return json({ error: "Enter a subject of no more than 180 characters." }, 400);
    if (!body || body.length > 8000) return json({ error: "Enter a reply of no more than 8,000 characters." }, 400);

    const { data: enquiry, error: enquiryError } = await supabase
      .from("enquiries")
      .select("id,name,email,type,subject,message,status")
      .eq("id", enquiryId)
      .maybeSingle();
    if (enquiryError) throw enquiryError;
    if (!enquiry) return json({ error: "Enquiry not found." }, 404);
    const recipientEmail = stringValue(enquiry.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return json({ error: "This enquiry does not have a valid reply address." }, 400);
    }

    const lines = body.split(/\r?\n/);
    const emailLog = await sendBookingEmail(supabase, {
      recipientEmail,
      recipientName: stringValue(enquiry.name),
      emailType: "enquiry_reply",
      subject,
      text: body,
      html: paragraphsToHtml(lines, {
        title: subject.replace(/^re:\s*/i, ""),
        preheader: `A reply from Après School about your ${stringValue(enquiry.type).toLowerCase() || "enquiry"}.`,
        badge: "Customer care",
        eyebrow: "A reply from Après School",
      }),
      sentBy: actor.id,
      enquiryId,
      metadata: {
        enquiryId,
        originalSubject: stringValue(enquiry.subject),
        replyApprovedBy: actor.email,
      },
    });

    const status = stringValue(emailLog?.status) || "failed";
    const sent = status === "sent";
    const { data: reply, error: replyError } = await supabase
      .from("enquiry_replies")
      .insert({
        enquiry_id: enquiryId,
        recipient_email: recipientEmail,
        subject,
        body,
        status,
        provider_message_id: stringValue(emailLog?.provider_message_id) || null,
        email_log_id: stringValue(emailLog?.id) || null,
        sent_by: actor.id,
        sent_at: sent ? new Date().toISOString() : null,
      })
      .select("id,enquiry_id,recipient_email,subject,body,status,provider_message_id,sent_by,sent_at,created_at")
      .single();
    if (replyError) throw replyError;

    if (sent) {
      const { error: statusError } = await supabase.from("enquiries").update({ status: "responded" }).eq("id", enquiryId);
      if (statusError) throw statusError;
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: sent ? "enquiry_reply_sent" : "enquiry_reply_failed",
      table_name: "enquiries",
      record_id: enquiryId,
      metadata: { recipientEmail, subject, replyId: reply.id, emailLogId: emailLog?.id, status },
    });

    if (!sent) return json({ error: "The reply was saved but the email provider did not send it.", reply }, 502);
    return json({ sent: true, reply }, 200);
  } catch (error) {
    console.error(error);
    const status = error instanceof AccessError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Unable to send this reply" }, status);
  }
});

async function requireAdmin(authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new AccessError("Sign in before replying.", 401);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) throw new AccessError("Your session has expired. Sign in again.", 401);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,role,active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.active || !["admin", "superadmin"].includes(stringValue(profile.role).toLowerCase())) {
    throw new AccessError("Only administrators can send enquiry replies.", 403);
  }
  return { id: stringValue(profile.id), email: stringValue(profile.email) || stringValue(userData.user.email) };
}

class AccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
