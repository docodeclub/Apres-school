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
const notificationTo = Deno.env.get("ENQUIRY_NOTIFICATION_TO") ?? "hello@apres-school.co.uk";
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

    const { data, error } = await supabase
      .from("enquiries")
      .insert({
        name: enquiry.name,
        email: enquiry.email,
        organisation: enquiry.organisation,
        type: enquiry.type,
        subject: enquiry.subject,
        role: enquiry.role,
        message: enquiry.message,
        status: "new",
      })
      .select("*")
      .single();

    if (error) throw error;

    await notifyByEmail(enquiry, data.id);

    return json({ enquiry: data }, 200);
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to submit enquiry" }, 500);
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

async function notifyByEmail(enquiry: ReturnType<typeof normalizeEnquiry>, enquiryId: string) {
  const subject = `New Après School enquiry: ${enquiry.type}`;
  const text = [
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Organisation: ${enquiry.organisation || "N/A"}`,
    `Type: ${enquiry.type}`,
    `Subject: ${enquiry.subject || "N/A"}`,
    `Role: ${enquiry.role || "N/A"}`,
    "",
    enquiry.message,
  ].join("\n");

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
