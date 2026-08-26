import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildStaffEmailHtml } from "../_shared/staff-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const resendFrom = Deno.env.get("APRES_STAFF_EMAIL_FROM") ?? Deno.env.get("RESEND_FROM") ?? "Après School Team <staff@apres-school.co.uk>";
const resendReplyTo = Deno.env.get("APRES_REPLY_TO") ?? Deno.env.get("RESEND_REPLY_TO") ?? "hello@apres-school.co.uk";
const notificationTo = Deno.env.get("APRES_EXPENSE_NOTIFICATION_TO") ?? "luke@apres-school.co.uk";
const staffLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor) return json({ error: "Not authorised" }, 401);
    const body = await request.json();
    const claimId = String(body?.claimId || "").trim();
    if (!claimId) return json({ error: "Expense claim id is required" }, 400);
    const claim = await getClaim(claimId);
    if (!claim) return json({ error: "Expense claim not found" }, 404);
    if (claim.profileId !== actor.id) return json({ error: "You can only notify an expense you submitted" }, 403);
    if (claim.status !== "submitted") return json({ error: "Only submitted expenses can trigger a notification" }, 400);

    const existing = await findNotification(claim.id);
    if (existing) return json({ emailed: true, alreadyNotified: true, emailLogId: existing.id });

    const reviewUrl = buildReviewUrl(claim.id);
    const subject = `Expense claim: ${money(claim.amount)} from ${claim.staffName}`;
    const html = buildStaffEmailHtml({
      preheader: `${claim.staffName} submitted an expense claim for ${money(claim.amount)}.`,
      eyebrow: "Expense approval",
      title: "A new expense needs your decision",
      greeting: "Hi Luke,",
      paragraphs: [
        `${claim.staffName} has submitted an expense claim for approval.`,
        "The receipt is stored securely in the staff platform and is not attached to this email.",
      ],
      details: [
        { label: "Staff member", value: claim.staffName },
        { label: "Amount", value: money(claim.amount) },
        { label: "Expense date", value: formatDate(claim.expenseDate) },
        { label: "Category", value: claim.category },
        { label: "Reason", value: claim.description },
        { label: "Evidence", value: claim.receiptName || "Receipt uploaded securely" },
      ],
      action: { label: "Review expense and evidence", url: reviewUrl },
      notice: "Only a Superadmin can approve or deny this claim. Sign in before opening the private receipt.",
      portalLabel: "Expense approval",
      footerText: "Secure expense approval, evidence and payroll records.",
    });
    const text = [
      "Hi Luke,", "", `${claim.staffName} submitted an expense claim for ${money(claim.amount)}.`,
      `Date: ${formatDate(claim.expenseDate)}`, `Category: ${claim.category}`, `Reason: ${claim.description}`,
      `Evidence: ${claim.receiptName || "Receipt uploaded securely"}`, "", `Review securely: ${reviewUrl}`,
      "", "Only a Superadmin can approve or deny this claim.", "", "Après School",
    ].join("\n");

    if (!resendApiKey) {
      const emailLogId = await logEmail(claim, subject, "queued_without_provider", "", "Email provider is not configured", actor.id, reviewUrl);
      return json({ emailed: false, emailLogId, emailError: "Email provider is not configured" });
    }
    try {
      const providerMessageId = await sendEmail(notificationTo, subject, text, html);
      const emailLogId = await logEmail(claim, subject, "sent", providerMessageId, "", actor.id, reviewUrl);
      await logAudit(actor.id, claim, true, "");
      return json({ emailed: true, emailLogId, providerMessageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send expense notification";
      const emailLogId = await logEmail(claim, subject, "failed", "", message, actor.id, reviewUrl);
      await logAudit(actor.id, claim, false, message);
      return json({ error: message, emailed: false, emailLogId }, 502);
    }
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to notify expense claim" }, 500);
  }
});

async function getActor(authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id,role,email,full_name").eq("id", data.user.id).maybeSingle();
  if (profileError) throw profileError;
  return profile;
}

async function getClaim(claimId: string) {
  const { data, error } = await supabase.from("employee_expense_claims").select(`
    id, staff_record_id, expense_date, category, amount, description, receipt_name, status,
    staff_records!employee_expense_claims_staff_record_id_fkey(
      preferred_name, profile_id, profiles!staff_records_profile_id_fkey(full_name,email)
    )
  `).eq("id", claimId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const staff = first(data.staff_records);
  const profile = first(staff?.profiles);
  return {
    id: data.id, staffRecordId: data.staff_record_id, expenseDate: data.expense_date,
    category: data.category, amount: Number(data.amount || 0), description: data.description || "",
    receiptName: data.receipt_name || "", status: data.status,
    profileId: staff?.profile_id || "", staffName: staff?.preferred_name || profile?.full_name || profile?.email || "Staff member",
  };
}

async function findNotification(claimId: string) {
  const { data, error } = await supabase.from("email_logs").select("id").eq("email_type", "employee_expense_submitted").eq("status", "sent").contains("metadata", { claimId }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: resendFrom, to: [to], reply_to: resendReplyTo, subject, text, html }),
  });
  if (!response.ok) throw new Error(`Resend email failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json().catch(() => null);
  return typeof result?.id === "string" ? result.id : "";
}

async function logEmail(claim: any, subject: string, status: string, providerMessageId: string, errorMessage: string, sentBy: string, reviewUrl: string) {
  const { data, error } = await supabase.from("email_logs").insert({
    recipient_email: notificationTo, recipient_name: "Luke Currie", email_type: "employee_expense_submitted",
    subject, status, provider: "resend", provider_message_id: providerMessageId || null,
    error_message: errorMessage || null, sent_by: sentBy, staff_record_id: claim.staffRecordId,
    metadata: { claimId: claim.id, amount: claim.amount, category: claim.category, reviewUrl },
    sent_at: status === "sent" ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function logAudit(actorId: string, claim: any, emailed: boolean, emailError: string) {
  const { error } = await supabase.from("audit_log").insert({ actor_id: actorId, action: emailed ? "expense_notification_sent" : "expense_notification_failed", table_name: "employee_expense_claims", record_id: claim.id, metadata: { recipientEmail: notificationTo, amount: claim.amount, emailSent: emailed, emailError } });
  if (error) console.error(error.message);
}

function buildReviewUrl(claimId: string) {
  const url = new URL(staffLoginUrl);
  url.searchParams.set("section", "expenses");
  url.searchParams.set("expense", claimId);
  return url.toString();
}
function money(value: number) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value); }
function formatDate(value: string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/London" }); }
function first(value: any) { return Array.isArray(value) ? value[0] : value; }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
