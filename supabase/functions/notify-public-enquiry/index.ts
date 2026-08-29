import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { enforcePublicRateLimit } from "../_shared/public-rate-limit.ts";

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
const notificationTo = Deno.env.get("ENQUIRY_NOTIFICATION_TO") ?? "helpdesk@apres-school.co.uk";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom =
  Deno.env.get("APRES_EMAIL_FROM") ??
  Deno.env.get("RESEND_FROM") ??
  "Après School <hello@apres-school.co.uk>";
const resendReplyTo =
  Deno.env.get("APRES_REPLY_TO") ??
  Deno.env.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await request.json();
    const enquiry = normalizeEnquiry(payload);
    const validationError = validateEnquiry(enquiry);

    if (validationError) return json({ error: validationError }, 400);
    const allowed = await enforcePublicRateLimit(supabase, request, "public-enquiry", {
      limit: 5,
      windowSeconds: 3600,
      identity: enquiry.email,
    });
    if (!allowed) return json({ error: "Too many enquiries. Please wait before trying again." }, 429, { "Retry-After": "3600" });

    const submissionFingerprint = await enquiryFingerprint(enquiry);
    const { data: acceptanceRows, error: acceptanceError } = await supabase.rpc("accept_public_enquiry", {
      p_name: enquiry.name,
      p_email: enquiry.email,
      p_organisation: enquiry.organisation,
      p_type: enquiry.type,
      p_subject: enquiry.subject,
      p_role: enquiry.role,
      p_message: enquiry.message,
      p_submission_fingerprint: submissionFingerprint,
      p_window_seconds: 600,
    });
    if (acceptanceError) throw acceptanceError;

    const acceptance = Array.isArray(acceptanceRows) ? acceptanceRows[0] : acceptanceRows;
    const enquiryId = stringValue(acceptance?.enquiry_id);
    if (!enquiryId) throw new Error("The enquiry was not accepted");

    const { data, error } = await supabase
      .from("enquiries")
      .select("*")
      .eq("id", enquiryId)
      .single();
    if (error) throw error;

    const duplicate = acceptance?.duplicate === true;
    if (!duplicate) await notifyByEmail(enquiry, enquiryId);

    return json({ enquiry: data, duplicate }, 200);
  } catch (error) {
    console.error(error);
    return json({ error: "We could not save your enquiry. Please try again." }, 500);
  }
});

function normalizeEnquiry(payload: Record<string, unknown>) {
  return {
    name: stringValue(payload.name),
    email: stringValue(payload.email),
    organisation: stringValue(payload.organisation),
    type: stringValue(payload.type) || "Other",
    subject: stringValue(payload.subject),
    role: stringValue(payload.role),
    message: stringValue(payload.message),
  };
}

function validateEnquiry(enquiry: ReturnType<typeof normalizeEnquiry>) {
  if (!enquiry.name) return "Name is required";
  if (!enquiry.email || !enquiry.email.includes("@")) return "Valid email is required";
  if (!enquiry.message) return "Message is required";
  if (enquiry.name.length > 120 || enquiry.email.length > 254 || enquiry.organisation.length > 160) return "One or more fields are too long";
  if (enquiry.message.length > 5000) return "Message is too long";
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function enquiryFingerprint(enquiry: ReturnType<typeof normalizeEnquiry>) {
  const normalized = [
    enquiry.name,
    enquiry.email.toLowerCase(),
    enquiry.organisation,
    enquiry.type,
    enquiry.subject,
    enquiry.role,
    enquiry.message,
  ].map((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function notifyByEmail(enquiry: ReturnType<typeof normalizeEnquiry>, enquiryId: string) {
  const subject = `New support ticket: ${enquiry.name}`;
  const supportTicketsUrl = "https://www.apres-school.co.uk/staff-login?section=support-tickets";
  const text = [
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Organisation: ${enquiry.organisation || "N/A"}`,
    `Type: ${enquiry.type}`,
    `Subject: ${enquiry.subject || "N/A"}`,
    `Role: ${enquiry.role || "N/A"}`,
    "",
    enquiry.message,
    "",
    `Open support tickets: ${supportTicketsUrl}`,
  ].join("\n");
  const html = supportTicketEmailHtml(enquiry, supportTicketsUrl);

  if (!resendApiKey) {
    await logEmail({
      recipientEmail: notificationTo,
      recipientName: "Après School enquiries",
      emailType: "enquiry_notification",
      subject,
      status: "queued_without_provider",
      enquiryId,
      metadata: { enquiryType: enquiry.type, senderEmail: enquiry.email, senderName: enquiry.name },
    });
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [notificationTo],
      reply_to: enquiry.email || resendReplyTo,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Email notification failed for enquiry ${enquiryId}: ${response.status} ${detail}`);
    await logEmail({
      recipientEmail: notificationTo,
      recipientName: "Après School enquiries",
      emailType: "enquiry_notification",
      subject,
      status: "failed",
      errorMessage: `Resend email failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      enquiryId,
      metadata: { enquiryType: enquiry.type, senderEmail: enquiry.email, senderName: enquiry.name },
    });
    return;
  }

  const result = await response.json().catch(() => null);
  await logEmail({
    recipientEmail: notificationTo,
    recipientName: "Après School enquiries",
    emailType: "enquiry_notification",
    subject,
    status: "sent",
    providerMessageId: typeof result?.id === "string" ? result.id : "",
    enquiryId,
    metadata: { enquiryType: enquiry.type, senderEmail: enquiry.email, senderName: enquiry.name },
  });
}

function supportTicketEmailHtml(enquiry: ReturnType<typeof normalizeEnquiry>, supportTicketsUrl: string) {
  const safe = (value: string) => escapeHtml(value || "N/A");
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f7ff;font-family:Arial,sans-serif;color:#202a44">
    <div style="display:none;max-height:0;overflow:hidden">A new support ticket from ${safe(enquiry.name)} is waiting for review.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7ff;padding:28px 14px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 14px 38px rgba(38,63,169,.12)">
          <tr><td style="background:#2f49b7;padding:28px 32px;color:#ffffff">
            <div style="font-size:24px;font-weight:800">Apres School</div>
            <div style="margin-top:4px;color:#ffb44d;font-size:13px;font-weight:700;letter-spacing:.08em">SUPPORT TICKETS</div>
          </td></tr>
          <tr><td style="padding:32px">
            <div style="color:#ef9f28;font-size:12px;font-weight:800;letter-spacing:.12em">NEW TICKET</div>
            <h1 style="margin:8px 0 8px;color:#263fa9;font-size:28px;line-height:1.2">A customer needs support</h1>
            <p style="margin:0 0 24px;color:#68718a;line-height:1.55">A new ticket has been raised through the public website and is ready for the helpdesk team to review.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dfe5f5;border-radius:16px;background:#f9fbff">
              <tr><td style="padding:18px 20px;line-height:1.7">
                <strong style="color:#263fa9">${safe(enquiry.name)}</strong><br>
                <span>${safe(enquiry.email)}</span><br>
                <span>${safe(enquiry.organisation || "No organisation")}</span><br>
                <span>${safe(enquiry.type)}${enquiry.subject ? ` · ${safe(enquiry.subject)}` : ""}</span>
              </td></tr>
              <tr><td style="border-top:1px solid #dfe5f5;padding:18px 20px;color:#3f4860;white-space:pre-wrap;line-height:1.55">${safe(enquiry.message)}</td></tr>
            </table>
            <div style="padding-top:26px">
              <a href="${supportTicketsUrl}" style="display:inline-block;border-radius:999px;background:#2f49b7;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 24px">Open Support Tickets</a>
            </div>
            <p style="margin:24px 0 0;color:#7b8398;font-size:12px;line-height:1.5">Opening an unassigned ticket records who is handling it, helping the team avoid duplicate responses.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function logEmail(entry: {
  recipientEmail: string;
  recipientName?: string;
  emailType: string;
  subject: string;
  status: string;
  providerMessageId?: string;
  errorMessage?: string;
  enquiryId?: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from("email_logs").insert({
    recipient_email: entry.recipientEmail,
    recipient_name: entry.recipientName || null,
    email_type: entry.emailType,
    subject: entry.subject,
    status: entry.status,
    provider: "resend",
    provider_message_id: entry.providerMessageId || null,
    error_message: entry.errorMessage || null,
    enquiry_id: entry.enquiryId || null,
    metadata: entry.metadata || {},
    sent_at: entry.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) console.error(`Email log failed: ${error.message}`);
}

function json(body: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}
