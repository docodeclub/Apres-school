import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom = Deno.env.get("APRES_STAFF_EMAIL_FROM") ?? Deno.env.get("RESEND_FROM") ?? "Après School Team <staff@apres-school.co.uk>";
const resendReplyTo = Deno.env.get("APRES_REPLY_TO") ?? Deno.env.get("RESEND_REPLY_TO") ?? "hello@apres-school.co.uk";
const staffPortalUrl = Deno.env.get("APRES_STAFF_PORTAL_URL") ?? "https://www.apres-school.co.uk/staff-login";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["manager", "admin", "superadmin"].includes(actor.role)) {
      return json({ error: "Not authorised to notify staffing publications" }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const publicationId = typeof body.publicationId === "string" ? body.publicationId : "";
    if (!publicationId) return json({ error: "Publication is required" }, 400);

    const { data: publication, error: publicationError } = await supabase
      .from("rota_publications")
      .select("id, period_start, period_end, version, status, assignment_snapshot, published_by, published_at")
      .eq("id", publicationId)
      .maybeSingle();
    if (publicationError) throw publicationError;
    if (!publication || publication.status !== "published") return json({ error: "Published rota not found" }, 404);
    if (actor.role === "manager" && publication.published_by !== actor.id) return json({ error: "Not authorised for this publication" }, 403);

    const assignments = Array.isArray(publication.assignment_snapshot)
      ? publication.assignment_snapshot.filter((item) => item && item.status !== "cancelled")
      : [];
    const staffIds = [...new Set(assignments.map((item) => item.staff_record_id).filter(Boolean))];
    const sessionIds = [...new Set(assignments.map((item) => item.session_id).filter(Boolean))];
    if (!staffIds.length || !sessionIds.length) return json({ notified: 0, queued: 0, message: "No assigned staff in this publication" });

    const [{ data: staffRows, error: staffError }, { data: sessionRows, error: sessionError }] = await Promise.all([
      supabase.from("staff_records").select("id, preferred_name, profiles!inner(full_name,email,active)").in("id", staffIds),
      supabase.from("sessions").select("id, starts_at, ends_at, programmes!inner(name, locations!inner(name,address))").in("id", sessionIds),
    ]);
    if (staffError) throw staffError;
    if (sessionError) throw sessionError;

    const staffById = new Map((staffRows || []).map((row) => [row.id, row]));
    const sessionById = new Map((sessionRows || []).map((row) => [row.id, row]));
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const assignment of assignments) {
      if (!staffById.has(assignment.staff_record_id) || !sessionById.has(assignment.session_id)) continue;
      const list = grouped.get(assignment.staff_record_id) || [];
      list.push(assignment);
      grouped.set(assignment.staff_record_id, list);
    }

    let notified = 0;
    let queued = 0;
    const failures: string[] = [];
    for (const [staffId, staffAssignments] of grouped) {
      const staff = staffById.get(staffId);
      const profile = Array.isArray(staff?.profiles) ? staff.profiles[0] : staff?.profiles;
      const email = typeof profile?.email === "string" ? profile.email.trim() : "";
      if (!email || profile?.active === false) continue;
      const name = staff?.preferred_name || profile?.full_name || "team member";
      const subject = `Your Après School rota · ${formatDate(publication.period_start)}–${formatDate(publication.period_end)}`;
      const shifts = staffAssignments
        .map((assignment) => ({ assignment, session: sessionById.get(assignment.session_id) }))
        .filter((item) => item.session)
        .sort((a, b) => String(a.session.starts_at).localeCompare(String(b.session.starts_at)));
      const text = buildMessage(name, publication.version, shifts);
      const status = resendApiKey ? "sending" : "queued_without_provider";
      if (!resendApiKey) {
        await logEmail(email, name, subject, status, publication, actor.id, staffAssignments.length);
        queued += 1;
        continue;
      }
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: resendFrom, to: [email], reply_to: resendReplyTo, subject, text }),
        });
        if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
        const provider = await response.json().catch(() => ({}));
        await logEmail(email, name, subject, "sent", publication, actor.id, staffAssignments.length, provider?.id || "");
        notified += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Email could not be sent";
        failures.push(`${email}: ${detail}`);
        await logEmail(email, name, subject, "failed", publication, actor.id, staffAssignments.length, "", detail);
      }
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: "staffing_publication_notifications_sent",
      table_name: "rota_publications",
      record_id: publication.id,
      metadata: { version: publication.version, notified, queued, failures: failures.length },
    });
    return json({ notified, queued, failed: failures.length });
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to send staffing notifications" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return null;
  const { data, error } = await supabase.from("profiles").select("id, role").eq("id", userData.user.id).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

function buildMessage(name: string, version: number, shifts: Array<{ assignment: Record<string, unknown>; session: any }>) {
  const lines = shifts.map(({ assignment, session }) => {
    const programme = Array.isArray(session.programmes) ? session.programmes[0] : session.programmes;
    const location = Array.isArray(programme?.locations) ? programme.locations[0] : programme?.locations;
    const arrive = assignment.scheduled_start || session.starts_at;
    const finish = assignment.scheduled_end || session.ends_at;
    const role = String(assignment.session_role || "assistant").replace(/^./, (letter) => letter.toUpperCase());
    return `${formatDateTime(session.starts_at)} · ${location?.name || "Après School"} · ${programme?.name || "Session"}\nArrive ${formatTime(arrive)} · finish ${formatTime(finish)} · ${role}`;
  });
  return [
    `Hi ${name},`, "", `Rota version ${version} has been published.`, "",
    ...lines.flatMap((line) => [line, ""]),
    "Please sign in to review and acknowledge each shift:", staffPortalUrl, "", "Thank you,", "Après School",
  ].join("\n");
}

async function logEmail(to: string, name: string, subject: string, status: string, publication: any, sentBy: string, shiftCount: number, providerMessageId = "", errorMessage = "") {
  const { error } = await supabase.from("email_logs").insert({
    recipient_email: to,
    recipient_name: name,
    email_type: "staffing_rota_publication",
    subject,
    status,
    provider: "resend",
    provider_message_id: providerMessageId || null,
    error_message: errorMessage || null,
    sent_by: sentBy,
    metadata: { publicationId: publication.id, version: publication.version, shiftCount },
    sent_at: status === "sent" ? new Date().toISOString() : null,
  });
  if (error) console.error(`Email log failed: ${error.message}`);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${value}T12:00:00Z`));
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(value));
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
