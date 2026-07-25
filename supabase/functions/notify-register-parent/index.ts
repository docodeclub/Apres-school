import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendBookingEmail } from "../_shared/booking-email.ts";
import { buildStaffEmailHtml } from "../_shared/staff-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const badgeDetails: Record<string, { icon: string; title: string }> = {
  excellent_behaviour: { icon: "🏆", title: "Excellent Behaviour" },
  fab_friend: { icon: "🤝", title: "Fab Friend" },
  what_would_we_do_without_you: { icon: "🌟", title: "What Would We Do Without You?" },
  creativity: { icon: "🎨", title: "Creativity" },
  perseverance: { icon: "💪", title: "Perseverance" },
  team_player: { icon: "⚽", title: "Team Player" },
  positive_attitude: { icon: "😊", title: "Positive Attitude" },
  kindness: { icon: "❤️", title: "Kindness" },
};

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Parent notification service is not configured." }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before sending a parent notification." }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your staff session has expired." }, 401);

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("id, full_name, role, active")
      .eq("id", userData.user.id)
      .single();
    if (!profile?.active || !["staff", "manager", "admin", "superadmin"].includes(profile.role)) {
      return json({ error: "Staff register access is required." }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const kind = stringValue(payload.kind);
    const recordId = stringValue(payload.recordId);
    if (!["report", "reward"].includes(kind) || !recordId) return json({ error: "Choose a saved report or reward." }, 400);

    const context = kind === "report"
      ? await reportContext(recordId)
      : await rewardContext(recordId);
    if (!context) return json({ error: "The saved record could not be found." }, 404);
    if (kind === "report" && context.reportType === "safeguarding") {
      return json({ error: "Safeguarding records cannot be emailed from the register." }, 400);
    }
    if (!context.parentEmail) return json({ error: "The primary contact does not have an email address." }, 400);

    const lines = kind === "report"
      ? reportEmailLines(context)
      : rewardEmailLines(context);
    const subject = kind === "report"
      ? context.reportType === "incident" ? "Incident Report" : `${context.childName}: ${context.reportLabel} report`
      : `${context.childName} received an Après School badge`;
    const emailLog = await sendBookingEmail(serviceClient, {
      recipientEmail: context.parentEmail,
      recipientName: context.parentName,
      emailType: kind === "report" ? "register_parent_report_copy" : "register_child_reward",
      subject,
      text: lines.join("\n"),
      from: kind === "reward"
        ? "Après School Rewards <hello@apres-school.co.uk>"
        : "Après School <hello@apres-school.co.uk>",
      html: kind === "reward"
        ? await rewardEmailHtml(context)
        : reportEmailHtml(context),
      sentBy: userData.user.id,
      metadata: { kind, recordId, childId: context.childId },
    });
    if (emailLog?.status !== "sent") {
      throw new Error(stringValue(emailLog?.error_message) || "The email provider did not confirm delivery.");
    }

    if (kind === "report") {
      await serviceClient
        .from("incidents")
        .update({
          details: {
            ...(context.details || {}),
            parentCopyEmailedAt: new Date().toISOString(),
            parentCopyRecipient: context.parentEmail,
          },
        })
        .eq("id", recordId);
    } else {
      await serviceClient
        .from("child_rewards")
        .update({
          parent_email_sent_at: new Date().toISOString(),
          parent_email_recipient: context.parentEmail,
        })
        .eq("id", recordId);
    }

    return json({ ok: true, emailSent: true, recipient: context.parentEmail });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "The parent email could not be sent." }, 400);
  }
});

async function reportContext(id: string) {
  const { data, error } = await serviceClient
    .from("incidents")
    .select("id, child_id, reporter_id, type, summary, occurred_at, details, child_profiles!inner(full_name, preferred_name, parent_accounts!inner(full_name, email))")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const child = data.child_profiles;
  const parent = child.parent_accounts;
  const reportType = stringValue(data.type);
  const { data: reporter } = await serviceClient
    .from("profiles")
    .select("full_name")
    .eq("id", data.reporter_id)
    .maybeSingle();
  return {
    childId: data.child_id,
    childName: stringValue(child.preferred_name) || stringValue(child.full_name) || "Your child",
    parentName: stringValue(parent.full_name) || "Parent or carer",
    parentEmail: stringValue(parent.email).toLowerCase(),
    reportType,
    reportLabel: reportType === "first_aid" ? "First aid" : reportType === "incident" ? "Incident" : "Safeguarding",
    summary: stringValue(data.summary),
    occurredAt: data.occurred_at,
    details: data.details || {},
    staffName: stringValue(reporter?.full_name) || "Après School team",
  };
}

async function rewardContext(id: string) {
  const { data, error } = await serviceClient
    .from("child_rewards")
    .select("id, child_id, awarded_by, badge_type, reason, created_at, club_name, site_name, session_label, child_profiles!inner(full_name, preferred_name, parent_accounts!inner(full_name, email))")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const child = data.child_profiles;
  const parent = child.parent_accounts;
  const { data: staff } = await serviceClient
    .from("profiles")
    .select("full_name")
    .eq("id", data.awarded_by)
    .maybeSingle();
  const badge = badgeDetails[stringValue(data.badge_type)] || { icon: "🏅", title: "Après School Badge" };
  return {
    childId: data.child_id,
    childName: stringValue(child.preferred_name) || stringValue(child.full_name) || "Your child",
    parentName: stringValue(parent.full_name) || "Parent or carer",
    parentEmail: stringValue(parent.email).toLowerCase(),
    badgeIcon: badge.icon,
    badgeLabel: badge.title,
    reason: stringValue(data.reason),
    staffName: stringValue(staff?.full_name) || "Après School team",
    clubName: stringValue(data.club_name) || stringValue(data.session_label) || "Après School club",
    siteName: stringValue(data.site_name),
    createdAt: data.created_at,
  };
}

function reportEmailLines(context: Record<string, any>) {
  const detail = context.details || {};
  if (context.reportType === "incident") {
    return [
      `Hi ${firstName(context.parentName)},`,
      "Incident Report",
      `Child: ${context.childName}`,
      `Date: ${dateOnly(context.occurredAt)}`,
      `Time: ${timeOnly(context.occurredAt)}`,
      `Club: ${stringValue(detail.programmeName) || "Après School club"}`,
      `Recorded by: ${context.staffName}`,
      `What happened: ${context.summary}`,
      `Action taken: ${stringValue(detail.actionTaken)}`,
      `Outcome: ${stringValue(detail.outcome)}`,
      detail.followUpNotes ? `Follow-up: ${stringValue(detail.followUpNotes)}` : "",
      "If you would like to discuss this update, please contact the Après School team.",
      "Après School",
    ].filter(Boolean);
  }
  const bodyAreas = normaliseReportBodyAreas(detail);
  return [
    `Hi ${firstName(context.parentName)},`,
    `Here is a copy of the ${String(context.reportLabel).toLowerCase()} report recorded for ${context.childName}.`,
    `What happened: ${context.summary}`,
    detail.firstAidProvider ? `Who performed first aid: ${stringValue(detail.firstAidProvider)}` : "",
    `Date and time: ${dateTime(context.occurredAt)}.`,
    Array.isArray(detail.injuryTypes) && detail.injuryTypes.length ? `Injury type: ${detail.injuryTypes.join(", ")}.` : "",
    bodyAreas.length ? `Affected areas: ${bodyAreas.map((area) => `${area.part} (${area.side})`).join(", ")}.` : "",
    Array.isArray(detail.firstAidActions) && detail.firstAidActions.length ? `First aid administered: ${detail.firstAidActions.join(", ")}.` : "",
    detail.treatment ? `First aid given: ${detail.treatment}` : "",
    detail.actionTaken ? `Action taken: ${detail.actionTaken}` : "",
    "If you have any questions, reply to this email and the team will help.",
    "Thank you,",
    "Après School",
  ].filter(Boolean);
}

function reportEmailHtml(context: Record<string, any>) {
  const detail = context.details || {};
  if (context.reportType === "incident") {
    return buildStaffEmailHtml({
      preheader: `Incident Report for ${context.childName} from Après School.`,
      eyebrow: "Incident Report",
      title: "Incident Report",
      greeting: `Hi ${firstName(context.parentName)},`,
      paragraphs: [
        `We are sharing an update recorded for ${context.childName}.`,
      ],
      details: [
        { label: "Child", value: context.childName },
        { label: "Date", value: dateOnly(context.occurredAt) },
        { label: "Time", value: timeOnly(context.occurredAt) },
        { label: "Club", value: stringValue(detail.programmeName) || "Après School club" },
        { label: "Recorded by", value: context.staffName },
        { label: "What happened", value: context.summary },
        { label: "Action taken", value: stringValue(detail.actionTaken) },
        { label: "Outcome", value: stringValue(detail.outcome) },
        ...(detail.followUpNotes ? [{ label: "Follow-up", value: stringValue(detail.followUpNotes) }] : []),
      ],
      contentHtml: '<p style="margin:0 0 22px;color:#4a5572;font-size:15px;line-height:1.6;">If you would like to discuss this update, please contact the Après School team.</p>',
      portalLabel: "Incident Report",
      footerText: "Wraparound care, holiday clubs and school partnerships.",
    });
  }
  const injuryTypes = Array.isArray(detail.injuryTypes) ? detail.injuryTypes.map(stringValue).filter(Boolean) : [];
  const firstAidActions = Array.isArray(detail.firstAidActions) ? detail.firstAidActions.map(stringValue).filter(Boolean) : [];
  const bodyAreas = normaliseReportBodyAreas(detail);
  const isFirstAid = context.reportType === "first_aid";
  return buildStaffEmailHtml({
    preheader: `${context.reportLabel} report for ${context.childName}.`,
    eyebrow: isFirstAid ? "First aid report" : "Incident report",
    title: `${context.reportLabel} report for ${context.childName}`,
    greeting: `Hi ${firstName(context.parentName)},`,
    paragraphs: [
      `Here is the report recorded by the Après School team for ${context.childName}.`,
    ],
    details: [
      { label: "What happened:", value: context.summary },
      ...(detail.firstAidProvider
        ? [{ label: "Who performed first aid:", value: stringValue(detail.firstAidProvider) }]
        : []),
      { label: "Date and time", value: dateTime(context.occurredAt) },
      ...(injuryTypes.length ? [{ label: "Injury type", value: injuryTypes.join(" · ") }] : []),
      ...(bodyAreas.length ? [{ label: "Affected areas", value: bodyAreas.map((area) => `${area.part} (${area.side})`).join(" · ") }] : []),
      ...(firstAidActions.length ? [{ label: "First aid administered", value: firstAidActions.join(" · ") }] : []),
      ...(detail.treatment ? [{ label: "Relevant first aid details", value: stringValue(detail.treatment) }] : []),
      ...(detail.actionTaken ? [{ label: "Action taken", value: stringValue(detail.actionTaken) }] : []),
    ],
    contentHtml: isFirstAid && bodyAreas.length
      ? bodyMapEmailHtml(bodyAreas)
      : "",
    portalLabel: isFirstAid ? "First aid copy" : "Incident copy",
    footerText: "Wraparound care, holiday clubs and school partnerships.",
  });
}

function normaliseReportBodyAreas(detail: Record<string, any>) {
  if (Array.isArray(detail.bodyAreas)) {
    return detail.bodyAreas
      .map((area: any) => {
        if (typeof area === "string") {
          const [side, ...part] = area.split(":");
          return side && part.length ? { side: stringValue(side), part: stringValue(part.join(":")) } : null;
        }
        const side = stringValue(area?.side);
        const part = stringValue(area?.part);
        return side && part ? { side, part } : null;
      })
      .filter(Boolean) as Array<{ side: string; part: string }>;
  }
  const bodyPart = stringValue(detail.bodyPart);
  return bodyPart ? [{ side: stringValue(detail.bodySide) || "front", part: bodyPart }] : [];
}

function bodyMapEmailHtml(bodyAreas: Array<{ side: string; part: string }>) {
  const areaLabel = bodyAreas.map((area) => `${area.part} (${area.side})`).join(" · ");
  const encodedAreas = bodyAreas
    .map((area) => {
      const side = stringValue(area.side).toLowerCase() === "back" ? "back" : "front";
      return `${side}:${stringValue(area.part)}`;
    })
    .join("|");
  const imageUrl = `https://www.apres-school.co.uk/api/first-aid-body-map?areas=${encodeURIComponent(encodedAreas)}&v=20260725e`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;background:#f6fcf8;border:1px solid #c9e4d2;border-radius:16px;">
    <tr><td style="padding:16px;text-align:center;">
      <p style="margin:0 0 5px;font-size:12px;line-height:1.35;letter-spacing:.8px;text-transform:uppercase;color:#314bb8;font-weight:900;">Body map</p>
      <p style="margin:0 0 14px;font-size:16px;line-height:1.4;color:#25304f;font-weight:900;">Affected areas: ${escapeHtml(areaLabel)}</p>
      <img src="${imageUrl}" width="520" alt="Body map highlighting ${escapeHtml(areaLabel)}" style="display:block;width:100%;max-width:520px;height:auto;margin:0 auto;border:0;border-radius:14px;" />
    </td></tr>
  </table>`;
}

function rewardEmailLines(context: Record<string, any>) {
  return [
    `Hi ${firstName(context.parentName)},`,
    "🎉 Great news!",
    `${context.childName} has earned an Après School Badge.`,
    `${context.badgeIcon} ${context.badgeLabel}`,
    `Awarded by: ${context.staffName}`,
    `Club: ${context.clubName}`,
    `Date: ${dateOnly(context.createdAt)}`,
    `Reason: “${context.reason}”`,
    `Well done ${context.childName}!`,
    "We love recognising children who make our clubs such a positive place to be.",
    "Après School",
  ];
}

async function rewardEmailHtml(context: Record<string, any>) {
  const club = [context.clubName, context.siteName].filter(Boolean).join(" · ");
  const celebrationImageUrl = await rewardCelebrationImageUrl();
  return buildStaffEmailHtml({
    preheader: `${context.childName} has earned the ${context.badgeLabel} badge.`,
    eyebrow: "Badge awarded",
    title: `${context.badgeIcon} ${context.badgeLabel}`,
    greeting: `Hi ${firstName(context.parentName)},`,
    paragraphs: [
      `Great news — ${context.childName} has earned an Après School badge.`,
      `“${context.reason}”`,
      `Well done ${context.childName}!`,
      "We love recognising children who make our clubs such a positive place to be.",
    ],
    details: [
      { label: "Awarded by", value: context.staffName },
      { label: "Club", value: club || "Après School club" },
      { label: "Date", value: dateOnly(context.createdAt) },
    ],
    portalLabel: "Badge awarded",
    footerText: "Wraparound care, holiday clubs and school partnerships.",
    celebrationImage: celebrationImageUrl
      ? {
          src: celebrationImageUrl,
          alt: `Celebrating ${context.childName}'s ${context.badgeLabel} badge`,
          label: "Well done!",
        }
      : undefined,
  });
}

async function rewardCelebrationImageUrl() {
  const { data } = serviceClient.storage
    .from("email-brand-assets")
    .getPublicUrl("reward-celebration.gif");
  return stringValue(data?.publicUrl);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

function dateOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function timeOnly(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
