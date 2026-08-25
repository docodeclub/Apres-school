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
const defaultLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Administrator access is required" }, 403);
    }

    const input = await request.json().catch(() => ({}));
    const action = stringValue(input.action) === "restore" ? "restore" : "archive";
    const staffRecordId = stringValue(input.staffRecordId);
    const reason = stringValue(input.reason) || "Not recorded";
    const loginUrl = safeLoginUrl(stringValue(input.loginUrl));
    if (!staffRecordId) return json({ error: "Choose a staff member" }, 400);

    const staff = await loadStaff(staffRecordId);
    if (!staff?.profile?.id) return json({ error: "The staff account is not linked to a profile" }, 404);

    if (action === "restore") {
      await restoreStaff(staffRecordId, staff.profile.id);
      await writeAudit(actor.id, "staff_access_restored", staff, { reason: "Restored to current staff" });
      return json({ staffRecordId, restored: true });
    }

    const leftAt = new Date().toISOString();
    await archiveStaff(staffRecordId, staff.profile.id, reason, leftAt, actor.id);

    const subject = "Your Après School former staff document access";
    let emailed = false;
    let emailError = "";
    let providerMessageId = "";
    if (resendApiKey) {
      try {
        providerMessageId = await sendLeaverEmail(staff, subject, loginUrl);
        emailed = true;
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Email provider failed";
      }
    }

    await supabase.from("email_logs").insert({
      recipient_email: staff.profile.email,
      recipient_name: staff.name,
      email_type: "staff_leaver_access",
      subject,
      status: emailed ? "sent" : resendApiKey ? "failed" : "queued_without_provider",
      provider: "resend",
      provider_message_id: providerMessageId || null,
      error_message: emailError || null,
      sent_by: actor.id || null,
      staff_record_id: staffRecordId,
      metadata: { loginUrl, access: "former_staff_documents_only", reason },
      sent_at: emailed ? new Date().toISOString() : null,
    });

    await writeAudit(actor.id, "staff_moved_to_former_access", staff, {
      reason,
      leftAt,
      emailSent: emailed,
      emailError: emailError || null,
      retainedAccess: ["p45", "payslips", "own_hr_files"],
    });

    return json({
      staffRecordId,
      reason,
      dismissedAt: leftAt,
      formerAccess: true,
      emailed,
      emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to update former staff access" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if ((serviceRoleKey && token === serviceRoleKey) || jwtRole(token) === "service_role") return { id: null, role: "superadmin" };
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;
  const { data, error } = await supabase.from("profiles").select("id,role,active").eq("id", userData.user.id).maybeSingle();
  if (error || !data?.active) return null;
  return data;
}

async function loadStaff(staffRecordId: string) {
  const { data, error } = await supabase
    .from("staff_records")
    .select("id,preferred_name,archived_at,left_at,profiles!staff_records_profile_id_fkey(id,full_name,email,active,staff_access_status)")
    .eq("id", staffRecordId)
    .maybeSingle();
  if (error) throw error;
  const profile = Array.isArray(data?.profiles) ? data.profiles[0] : data?.profiles;
  if (!data || !profile) return null;
  return { ...data, profile, name: data.preferred_name || profile.full_name || "Former staff member" };
}

async function archiveStaff(staffRecordId: string, profileId: string, reason: string, leftAt: string, actorId: string | null) {
  const { error: staffError } = await supabase.from("staff_records").update({
    archived_at: leftAt,
    left_at: leftAt,
    leaving_reason: reason,
    archived_by: actorId,
  }).eq("id", staffRecordId);
  if (staffError) throw staffError;

  const { error: reportingError } = await supabase.from("hr_reporting_lines").update({
    archived_at: leftAt,
    effective_to: leftAt.slice(0, 10),
  }).eq("staff_record_id", staffRecordId).is("effective_to", null);
  if (reportingError) throw reportingError;

  const { error: profileError } = await supabase.from("profiles").update({
    active: false,
    staff_access_status: "former",
    must_change_password: false,
    updated_at: leftAt,
  }).eq("id", profileId);
  if (profileError) throw profileError;
}

async function restoreStaff(staffRecordId: string, profileId: string) {
  const now = new Date().toISOString();
  const { error: staffError } = await supabase.from("staff_records").update({
    archived_at: null,
    left_at: null,
    leaving_reason: null,
    archived_by: null,
  }).eq("id", staffRecordId);
  if (staffError) throw staffError;

  const { error: profileError } = await supabase.from("profiles").update({
    active: true,
    staff_access_status: "active",
    updated_at: now,
  }).eq("id", profileId);
  if (profileError) throw profileError;
}

async function sendLeaverEmail(staff: any, subject: string, loginUrl: string) {
  const firstName = String(staff.name || "there").trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${firstName},`,
    "",
    "Your employment access on the Après School staff platform has now changed to former staff access.",
    "",
    "You can continue to sign in securely to view and download your P45, previous payslips and other HR files retained for you. You will no longer be able to access registers, staffing, safeguarding, children, bookings, internal documents or any other operational areas.",
    "",
    `Sign in: ${loginUrl}`,
    "",
    "If you have difficulty signing in or believe a document is missing, please reply to this email.",
    "",
    "Kind regards,",
    "Après School",
  ].join("\n");
  const html = buildStaffEmailHtml({
    preheader: "Your former staff document access is ready.",
    eyebrow: "Former staff access",
    title: "Your documents remain available",
    greeting: `Hi ${firstName},`,
    paragraphs: [
      "Your employment access on the Après School staff platform has now changed to former staff access.",
      "You can continue to sign in securely to view and download your P45, previous payslips and other HR files retained for you.",
      "Your access to registers, staffing, safeguarding, children, bookings, internal documents and all other operational areas has ended.",
    ],
    action: { label: "Open your document portal", url: loginUrl },
    notice: "If you have difficulty signing in or believe a document is missing, please reply to this email. Documents are not attached to emails for security.",
    portalLabel: "Former staff documents",
  });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: resendFrom, to: [staff.profile.email], reply_to: resendReplyTo, subject, text, html }),
  });
  if (!response.ok) throw new Error(`Resend email failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json().catch(() => ({}));
  return typeof result?.id === "string" ? result.id : "";
}

async function writeAudit(actorId: string | null, action: string, staff: any, metadata: Record<string, unknown>) {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: actorId,
    action,
    table_name: "staff_records",
    record_id: staff.id,
    metadata: { staffName: staff.name, email: staff.profile.email, ...metadata },
  });
  if (error) console.error(`Audit log failed: ${error.message}`);
}

function safeLoginUrl(value: string) {
  try {
    const url = new URL(value || defaultLoginUrl);
    if (url.protocol !== "https:" || !["apres-school.co.uk", "www.apres-school.co.uk"].includes(url.hostname)) return defaultLoginUrl;
    url.pathname = "/staff-login";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return defaultLoginUrl;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function jwtRole(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return stringValue(decoded?.role);
  } catch {
    return "";
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
