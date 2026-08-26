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
const staffLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || String(actor.role || "").toLowerCase() !== "superadmin") {
      return json({ error: "Only Superadmin can send an expense decision" }, 403);
    }

    const body = await request.json();
    const claimId = String(body?.claimId || "").trim();
    if (!claimId) return json({ error: "Expense claim id is required" }, 400);
    const claim = await getClaim(claimId);
    if (!claim) return json({ error: "Expense claim not found" }, 404);
    if (!["approved", "rejected"].includes(claim.status)) {
      return json({ error: "The expense has not been decided" }, 400);
    }
    if (!claim.email.includes("@")) return json({ error: "The staff account does not have a valid email address" }, 400);

    const existing = await findNotification(claim.id, claim.status);
    if (existing) return json({ emailed: true, alreadyNotified: true, emailLogId: existing.id });

    const approved = claim.status === "approved";
    const decision = approved ? "Approved" : "Not approved";
    const expenseUrl = buildExpenseUrl(claim.id);
    const subject = approved ? `Your ${money(claim.amount)} expense has been approved` : `Update on your ${money(claim.amount)} expense claim`;
    const greetingName = claim.name.split(" ")[0] || claim.name;
    const paragraphs = approved
      ? ["Your expense claim has been approved by Après School.", "It is now ready to be included in the appropriate payroll process."]
      : ["Your expense claim has not been approved and has been returned to you.", "Please review the decision note below. Contact Admin if you need clarification before submitting a replacement claim."];
    const details = [
      { label: "Decision", value: decision },
      { label: "Amount", value: money(claim.amount) },
      { label: "Expense date", value: formatDate(claim.expenseDate) },
      { label: "Category", value: claim.category },
      { label: "Reason", value: claim.description },
      ...(claim.reviewerNote ? [{ label: "Decision note", value: claim.reviewerNote }] : []),
    ];
    const html = buildStaffEmailHtml({
      preheader: `Your expense claim for ${money(claim.amount)} has been ${approved ? "approved" : "reviewed"}.`,
      eyebrow: "Expense decision",
      title: approved ? "Your expense has been approved" : "Your expense has not been approved",
      greeting: `Hi ${greetingName},`,
      paragraphs,
      details,
      action: { label: "View your expense claim", url: expenseUrl },
      notice: approved
        ? "Approved expenses are added to payroll separately. You can track the current status in the staff platform."
        : "Your receipt remains securely stored with the original claim for the audit record.",
      portalLabel: "Staff expenses",
      footerText: "Secure employee expenses, decisions and payroll records.",
    });
    const text = [
      `Hi ${greetingName},`, "", paragraphs.join("\n\n"), "",
      `Decision: ${decision}`, `Amount: ${money(claim.amount)}`, `Expense date: ${formatDate(claim.expenseDate)}`,
      `Category: ${claim.category}`, `Reason: ${claim.description}`,
      ...(claim.reviewerNote ? [`Decision note: ${claim.reviewerNote}`] : []),
      "", `View your claim: ${expenseUrl}`, "", "Après School",
    ].join("\n");

    if (!resendApiKey) {
      const emailLogId = await logEmail(claim, subject, "queued_without_provider", "", "Email provider is not configured", actor.id, expenseUrl);
      return json({ emailed: false, emailLogId, emailError: "Email provider is not configured" });
    }
    try {
      const providerMessageId = await sendEmail(claim.email, subject, text, html);
      const emailLogId = await logEmail(claim, subject, "sent", providerMessageId, "", actor.id, expenseUrl);
      await logAudit(actor.id, claim, true, "");
      return json({ emailed: true, emailLogId, providerMessageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send expense decision";
      const emailLogId = await logEmail(claim, subject, "failed", "", message, actor.id, expenseUrl);
      await logAudit(actor.id, claim, false, message);
      return json({ error: message, emailed: false, emailLogId }, 502);
    }
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to send expense decision" }, 500);
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
    id, staff_record_id, expense_date, category, amount, description, reviewer_note, status,
    staff_records!employee_expense_claims_staff_record_id_fkey(
      preferred_name, profiles!staff_records_profile_id_fkey(full_name,email)
    )
  `).eq("id", claimId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const staff = first(data.staff_records);
  const profile = first(staff?.profiles);
  return {
    id: data.id, staffRecordId: data.staff_record_id, expenseDate: data.expense_date,
    category: data.category, amount: Number(data.amount || 0), description: data.description || "",
    reviewerNote: data.reviewer_note || "", status: data.status,
    name: profile?.full_name || staff?.preferred_name || "Staff member",
    email: String(profile?.email || "").trim().toLowerCase(),
  };
}

async function findNotification(claimId: string, decision: string) {
  const { data, error } = await supabase.from("email_logs").select("id").eq("email_type", "employee_expense_decision").eq("status", "sent").contains("metadata", { claimId, decision }).limit(1).maybeSingle();
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

async function logEmail(claim: any, subject: string, status: string, providerMessageId: string, errorMessage: string, sentBy: string, expenseUrl: string) {
  const { data, error } = await supabase.from("email_logs").insert({
    recipient_email: claim.email, recipient_name: claim.name, email_type: "employee_expense_decision",
    subject, status, provider: "resend", provider_message_id: providerMessageId || null,
    error_message: errorMessage || null, sent_by: sentBy, staff_record_id: claim.staffRecordId,
    metadata: { claimId: claim.id, decision: claim.status, amount: claim.amount, category: claim.category, expenseUrl },
    sent_at: status === "sent" ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function logAudit(actorId: string, claim: any, emailed: boolean, emailError: string) {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: emailed ? "expense_decision_notification_sent" : "expense_decision_notification_failed",
    table_name: "employee_expense_claims",
    record_id: claim.id,
    metadata: { recipientEmail: claim.email, decision: claim.status, amount: claim.amount, emailSent: emailed, emailError },
  });
  if (error) console.error(error.message);
}

function buildExpenseUrl(claimId: string) {
  const url = new URL(staffLoginUrl);
  url.searchParams.set("section", "expenses");
  url.searchParams.set("expense", claimId);
  return url.toString();
}
function money(value: number) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value); }
function formatDate(value: string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/London" }); }
function first(value: any) { return Array.isArray(value) ? value[0] : value; }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
