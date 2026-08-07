import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildStaffEmailHtml } from "../_shared/staff-email.ts";

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
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom =
  Deno.env.get("APRES_STAFF_EMAIL_FROM") ??
  Deno.env.get("RESEND_FROM") ??
  "Après School Team <staff@apres-school.co.uk>";
const resendReplyTo =
  Deno.env.get("APRES_REPLY_TO") ??
  Deno.env.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";
const staffLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";

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
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to send payslip notifications" }, 403);
    }

    const body = await request.json();
    const hrFileId = stringValue(body?.hrFileId);
    const resend = body?.resend === true;
    if (!hrFileId) return json({ error: "Payslip file id is required" }, 400);

    const payslip = await getPayslip(hrFileId);
    if (!payslip) return json({ error: "Payslip file not found" }, 404);
    if (payslip.category.toLowerCase() !== "payslip") {
      return json({ error: "Only payslip files can trigger this notification" }, 400);
    }
    if (!payslip.email.includes("@")) {
      return json({ error: "The staff profile does not have a valid email address" }, 400);
    }

    const existing = await findSentNotification(payslip.id, payslip.staffRecordId);
    if (existing && !resend) {
      return json({
        emailed: true,
        alreadyNotified: true,
        emailLogId: existing.id,
      });
    }

    const period = formatPayslipPeriod(payslip.issueDate);
    const payslipUrl = buildPayslipUrl(payslip.id);
    const subject = `Your ${period} payslip is now available`;
    const text = buildEmailText({
      name: payslip.name,
      period,
      payslipUrl,
    });
    const greetingName = payslip.name.split(" ")[0] || payslip.name;
    const html = buildStaffEmailHtml({
      preheader: `Your ${period} payslip is ready to view securely.`,
      eyebrow: "Staff Pay & HR",
      title: "Your payslip is ready",
      greeting: `Hi ${greetingName},`,
      paragraphs: [
        `Your ${period} payslip is now available in the Après School staff platform.`,
        "All HR information, including payslips and other HR documents, is only available securely through the staff platform.",
      ],
      details: [
        {
          label: "Payroll period",
          value: period,
        },
      ],
      action: {
        label: "View your payslip",
        url: payslipUrl,
      },
      notice: "For security, please sign in to view your payslip. It is not attached to this email.",
    });
    const metadata = {
      hrFileId: payslip.id,
      payslipPeriod: payslip.issueDate,
      payslipUrl,
      resend,
    };

    if (!resendApiKey) {
      const emailLogId = await logEmail({
        payslip,
        subject,
        status: "queued_without_provider",
        sentBy: actor.id,
        metadata,
      });
      await logAudit(actor.id, payslip, false, "Email provider is not configured");
      return json({
        emailed: false,
        emailLogId,
        emailError: "Email provider is not configured",
      });
    }

    try {
      const providerMessageId = await sendEmail(payslip.email, subject, text, html);
      const emailLogId = await logEmail({
        payslip,
        subject,
        status: "sent",
        providerMessageId,
        sentBy: actor.id,
        metadata,
      });
      await logAudit(actor.id, payslip, true, "");
      return json({ emailed: true, emailLogId, providerMessageId });
    } catch (error) {
      const emailError = error instanceof Error ? error.message : "Unable to send payslip notification";
      const emailLogId = await logEmail({
        payslip,
        subject,
        status: "failed",
        errorMessage: emailError,
        sentBy: actor.id,
        metadata,
      });
      await logAudit(actor.id, payslip, false, emailError);
      return json({ error: emailError, emailed: false, emailLogId }, 502);
    }
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to send payslip notification" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (serviceRoleKey && token === serviceRoleKey) {
    return {
      id: null,
      role: "superadmin",
      full_name: "Payslip import automation",
      email: null,
    };
  }
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

async function getPayslip(hrFileId: string) {
  const { data, error } = await supabase
    .from("staff_hr_files")
    .select(`
      id,
      staff_record_id,
      title,
      issue_date,
      status,
      archived_at,
      hr_file_categories(name),
      staff_records!staff_hr_files_staff_record_id_fkey(
        preferred_name,
        profiles!staff_records_profile_id_fkey(full_name, email)
      )
    `)
    .eq("id", hrFileId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const category = first(data.hr_file_categories);
  const staffRecord = first(data.staff_records);
  const profile = first(staffRecord?.profiles);
  return {
    id: data.id,
    staffRecordId: data.staff_record_id,
    title: data.title || "Payslip",
    issueDate: data.issue_date || "",
    category: category?.name || "",
    name: profile?.full_name || staffRecord?.preferred_name || "Staff member",
    email: String(profile?.email || "").trim().toLowerCase(),
  };
}

async function findSentNotification(hrFileId: string, staffRecordId: string) {
  const { data, error } = await supabase
    .from("email_logs")
    .select("id, sent_at")
    .eq("email_type", "payslip_available")
    .eq("staff_record_id", staffRecordId)
    .eq("status", "sent")
    .contains("metadata", { hrFileId })
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [to],
      reply_to: resendReplyTo,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend email failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const result = await response.json().catch(() => null);
  return typeof result?.id === "string" ? result.id : "";
}

async function logEmail({
  payslip,
  subject,
  status,
  providerMessageId = "",
  errorMessage = "",
  sentBy,
  metadata,
}: {
  payslip: Awaited<ReturnType<typeof getPayslip>>;
  subject: string;
  status: string;
  providerMessageId?: string;
  errorMessage?: string;
  sentBy: string | null;
  metadata: Record<string, unknown>;
}) {
  if (!payslip) return "";
  const { data, error } = await supabase
    .from("email_logs")
    .insert({
      recipient_email: payslip.email,
      recipient_name: payslip.name,
      email_type: "payslip_available",
      subject,
      status,
      provider: "resend",
      provider_message_id: providerMessageId || null,
      error_message: errorMessage || null,
      sent_by: sentBy || null,
      staff_record_id: payslip.staffRecordId,
      metadata,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function logAudit(actorId: string | null, payslip: NonNullable<Awaited<ReturnType<typeof getPayslip>>>, emailed: boolean, emailError: string) {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: emailed ? "payslip_notification_sent" : "payslip_notification_failed",
    table_name: "staff_hr_files",
    record_id: payslip.id,
    metadata: {
      staffRecordId: payslip.staffRecordId,
      recipientEmail: payslip.email,
      payslipPeriod: payslip.issueDate,
      emailSent: emailed,
      emailError,
    },
  });
  if (error) console.error(`Audit log failed: ${error.message}`);
}

function buildEmailText({ name, period, payslipUrl }: { name: string; period: string; payslipUrl: string }) {
  const greetingName = name.split(" ")[0] || name;
  return [
    `Hi ${greetingName},`,
    "",
    `Your ${period} payslip is now available in the Après School staff platform.`,
    "",
    `View your payslip: ${payslipUrl}`,
    "",
    "For security, please sign in to the platform to view it. Your payslip is not attached to this email.",
    "",
    "All HR information, including payslips and other HR documents, is only available securely through the staff platform.",
    "",
    "Thank you,",
    "Après School",
  ].join("\n");
}

function buildPayslipUrl(hrFileId: string) {
  try {
    const url = new URL(staffLoginUrl);
    url.searchParams.set("section", "pay");
    url.searchParams.set("payslip", hrFileId);
    return url.toString();
  } catch {
    return `https://www.apres-school.co.uk/staff-login?section=pay&payslip=${encodeURIComponent(hrFileId)}`;
  }
}

function formatPayslipPeriod(issueDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return "latest";
  const date = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "latest";
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function first(value: unknown): any {
  return Array.isArray(value) ? value[0] : value;
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
