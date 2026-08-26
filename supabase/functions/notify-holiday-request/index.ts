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
const notificationTo = Deno.env.get("APRES_HOLIDAY_NOTIFICATION_TO") ?? "luke@apres-school.co.uk";
const staffLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor) return json({ error: "Not authorised" }, 401);
    const body = await request.json();
    const requestId = String(body?.requestId || "").trim();
    const event = String(body?.event || "").trim().toLowerCase();
    if (!requestId || !["submitted", "approved", "declined"].includes(event)) return json({ error: "A valid holiday request and event are required" }, 400);
    const holiday = await getHoliday(requestId);
    if (!holiday) return json({ error: "Holiday request not found" }, 404);

    const role = String(actor.role || "").toLowerCase();
    const isOwner = holiday.profileId === actor.id;
    if (event === "submitted" && (!isOwner || holiday.status !== "requested")) return json({ error: "Only the employee can notify a newly submitted request" }, 403);
    if (event !== "submitted" && (!['manager','admin','superadmin'].includes(role) || holiday.status !== event || (role === "manager" && holiday.approvedBy !== actor.id))) return json({ error: "The holiday decision is not available to notify" }, 403);

    const recipients = event === "submitted" ? await approvalRecipients(holiday.staffRecordId) : [{ email: holiday.email, name: holiday.name }];
    if (!recipients.length) return json({ error: "No valid notification recipient was found" }, 400);
    const sent = [];
    for (const recipient of recipients) {
      if (!recipient.email.includes("@")) continue;
      const existing = await findNotification(requestId, event, recipient.email);
      if (existing) { sent.push({ email: recipient.email, alreadyNotified: true }); continue; }
      const content = emailContent(holiday, event, recipient.name);
      if (!resendApiKey) throw new Error("Email provider is not configured");
      const providerMessageId = await sendEmail(recipient.email, content.subject, content.text, content.html);
      await logEmail(holiday, event, recipient, content.subject, providerMessageId, actor.id);
      sent.push({ email: recipient.email, providerMessageId });
    }
    await supabase.from("audit_log").insert({ actor_id: actor.id, action: `holiday_${event}_notification_sent`, table_name: "staff_absences", record_id: requestId, metadata: { recipients: sent.map((item) => item.email) } });
    return json({ emailed: sent.length > 0, recipients: sent.length });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Holiday notification could not be sent" }, 500);
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

async function getHoliday(id: string) {
  const { data, error } = await supabase.from("staff_absences").select(`id,staff_record_id,start_date,end_date,requested_hours,day_portion,status,note,decision_note,approved_by,staff_records!staff_absences_staff_record_id_fkey(profile_id,preferred_name,primary_site,profiles!staff_records_profile_id_fkey(full_name,email))`).eq("id", id).eq("absence_type", "annual_leave").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const staff = first(data.staff_records); const profile = first(staff?.profiles);
  return { id: data.id, staffRecordId: data.staff_record_id, profileId: staff?.profile_id || "", approvedBy: data.approved_by || "", name: staff?.preferred_name || profile?.full_name || "Staff member", email: String(profile?.email || "").trim().toLowerCase(), site: staff?.primary_site || "Not recorded", startDate: data.start_date, endDate: data.end_date, hours: Number(data.requested_hours || 0), dayPortion: data.day_portion, status: data.status, note: data.note || "", decisionNote: data.decision_note || "" };
}

async function approvalRecipients(staffRecordId: string) {
  const recipients: Array<{email: string; name: string}> = [{ email: notificationTo.toLowerCase(), name: "Luke" }];
  const { data: lines } = await supabase.from("hr_reporting_lines").select("manager_staff_record_id").eq("staff_record_id", staffRecordId).is("effective_to", null);
  const managerIds = (lines || []).map((row: any) => row.manager_staff_record_id).filter(Boolean);
  if (managerIds.length) {
    const { data: managers } = await supabase.from("staff_records").select("preferred_name,profiles!staff_records_profile_id_fkey(full_name,email)").in("id", managerIds);
    for (const row of managers || []) { const profile = first(row.profiles); recipients.push({ email: String(profile?.email || "").trim().toLowerCase(), name: row.preferred_name || profile?.full_name || "Manager" }); }
  }
  const unique = new Map<string, {email: string; name: string}>();
  recipients.filter((item) => item.email.includes("@")).forEach((item) => unique.set(item.email, item));
  return [...unique.values()];
}

function emailContent(holiday: any, event: string, recipientName: string) {
  const submitted = event === "submitted"; const approved = event === "approved";
  const url = new URL(staffLoginUrl); url.searchParams.set("section", "holiday");
  const subject = submitted ? `Holiday request from ${holiday.name}` : approved ? "Your holiday request has been approved" : "Update on your holiday request";
  const title = submitted ? "A holiday request needs a decision" : approved ? "Your holiday is approved" : "Your holiday request was declined";
  const paragraphs = submitted ? [`${holiday.name} has requested time off.`, "Review the dates, allowance and staffing impact securely in the staff platform."] : approved ? ["Your holiday request has been approved.", "The staffing planner has been updated and your paid holiday is recorded separately for payroll."] : ["Your holiday request has been declined.", "Please review the decision note below and contact your manager if you need to discuss alternative dates."];
  const details = [{ label: "Employee", value: holiday.name }, { label: "Dates", value: dateRange(holiday.startDate, holiday.endDate) }, { label: "Paid holiday", value: `${holiday.hours.toFixed(2).replace(/\.00$/, "")} hours` }, { label: "Site", value: holiday.site }, ...(holiday.note ? [{ label: "Employee note", value: holiday.note }] : []), ...(holiday.decisionNote ? [{ label: "Decision note", value: holiday.decisionNote }] : [])];
  const html = buildStaffEmailHtml({ preheader: subject, eyebrow: "Employee holiday", title, greeting: `Hi ${firstName(recipientName)},`, paragraphs, details, action: { label: submitted ? "Review holiday request" : "View holiday record", url: url.toString() }, notice: submitted ? "Approving leave may mark existing rota assignments as needing cover." : "Holiday information is private and is available only through your secure staff account.", portalLabel: "Holiday", footerText: "Secure holiday requests, staffing cover and payroll records." });
  const text = [`Hi ${firstName(recipientName)},`, "", ...paragraphs, "", ...details.map((item) => `${item.label}: ${item.value}`), "", `Open holiday: ${url}`, "", "Après School"].join("\n");
  return { subject, html, text };
}

async function sendEmail(to: string, subject: string, text: string, html: string) { const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: resendFrom, to: [to], reply_to: resendReplyTo, subject, text, html }) }); if (!response.ok) throw new Error(`Email failed with ${response.status}: ${(await response.text()).slice(0, 250)}`); return (await response.json().catch(() => null))?.id || ""; }
async function findNotification(requestId: string, event: string, email: string) { const { data } = await supabase.from("email_logs").select("id").eq("email_type", "employee_holiday").eq("recipient_email", email).eq("status", "sent").contains("metadata", { requestId, event }).limit(1).maybeSingle(); return data; }
async function logEmail(holiday: any, event: string, recipient: any, subject: string, providerMessageId: string, sentBy: string) { const { error } = await supabase.from("email_logs").insert({ recipient_email: recipient.email, recipient_name: recipient.name, email_type: "employee_holiday", subject, status: "sent", provider: "resend", provider_message_id: providerMessageId || null, sent_by: sentBy, staff_record_id: holiday.staffRecordId, metadata: { requestId: holiday.id, event, startDate: holiday.startDate, endDate: holiday.endDate, hours: holiday.hours }, sent_at: new Date().toISOString() }); if (error) throw error; }
function dateRange(start: string, end: string) { const format = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/London" }); return start === end ? format(start) : `${format(start)} to ${format(end)}`; }
function firstName(value: string) { return String(value || "there").trim().split(/\s+/)[0] || "there"; }
function first(value: any) { return Array.isArray(value) ? value[0] : value; }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
