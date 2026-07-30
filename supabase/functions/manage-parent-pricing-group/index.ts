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
const parentPortalUrl = Deno.env.get("PARENT_PORTAL_URL") ?? "https://www.apres-school.co.uk/launch-booking";
const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Pricing notifications are not configured." }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before changing a pricing tier." }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your staff session has expired." }, 401);

    const { data: actor } = await serviceClient.from("profiles").select("id,role,active").eq("id", userData.user.id).single();
    if (!actor?.active || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Admin access is required to change pricing tiers." }, 403);
    }

    const input = await request.json().catch(() => ({}));
    const parentAccountId = stringValue(input.parentAccountId);
    const pricingGroupId = stringValue(input.pricingGroupId);
    const effectiveFrom = dateValue(input.effectiveFrom) || new Date().toISOString().slice(0, 10);
    const effectiveTo = dateValue(input.effectiveTo) || null;
    const notes = stringValue(input.notes) || null;
    if (!parentAccountId || !pricingGroupId) return json({ error: "Choose a parent and pricing tier." }, 400);

    const [{ data: parent, error: parentError }, { data: group, error: groupError }, { data: rules, error: rulesError }] = await Promise.all([
      serviceClient.from("parent_accounts").select("id,full_name,email,archived_at").eq("id", parentAccountId).single(),
      serviceClient.from("pricing_groups").select("id,key,name,description,status,deleted_at").eq("id", pricingGroupId).single(),
      serviceClient.from("pricing_group_rules").select("id,name,school_id,programme_id,service_key,discount_type,discount_value,starts_on,ends_on,enabled,deleted_at,locations(name),programmes(name)").eq("pricing_group_id", pricingGroupId).eq("enabled", true).is("deleted_at", null).order("priority", { ascending: false }),
    ]);
    if (parentError || !parent || parent.archived_at) return json({ error: "The parent account could not be found." }, 404);
    if (groupError || !group || group.status !== "active" || group.deleted_at) return json({ error: "Choose an active pricing tier." }, 400);
    if (rulesError) throw rulesError;
    if (!stringValue(parent.email)) return json({ error: "This parent account does not have an email address." }, 400);

    const { data: assignment, error: assignmentError } = await callerClient.rpc("assign_parent_pricing_group", {
      p_parent_account_id: parentAccountId,
      p_pricing_group_id: pricingGroupId,
      p_effective_from: effectiveFrom,
      p_effective_to: effectiveTo,
      p_notes: notes,
    });
    if (assignmentError) throw assignmentError;

    const benefits = (rules || []).map(formatBenefit);
    const recipientName = stringValue(parent.full_name) || "Parent or carer";
    const subject = `Welcome to ${stringValue(group.name)} pricing at Après School`;
    const textLines = buildTextEmail(recipientName, stringValue(group.name), benefits, effectiveFrom, effectiveTo);
    let emailed = false;
    let emailError = "";
    let emailLogId = "";
    try {
      const emailLog = await sendBookingEmail(serviceClient, {
        recipientEmail: stringValue(parent.email),
        recipientName,
        emailType: "parent_pricing_tier_welcome",
        subject,
        text: textLines.join("\n"),
        html: buildPricingEmailHtml(recipientName, stringValue(group.name), benefits, effectiveFrom, effectiveTo),
        sentBy: actor.id,
        metadata: { parentAccountId, pricingGroupId, pricingGroupName: group.name, effectiveFrom, effectiveTo, benefitCount: benefits.length },
      });
      emailed = emailLog?.status === "sent";
      emailError = stringValue(emailLog?.error_message);
      emailLogId = stringValue(emailLog?.id);
    } catch (error) {
      emailError = error instanceof Error ? error.message : "The welcome email could not be sent.";
    }

    await serviceClient.from("pricing_group_events").insert({
      pricing_group_id: pricingGroupId,
      parent_account_id: parentAccountId,
      actor_id: actor.id,
      action: emailed ? "parent_assigned_email_sent" : "parent_assigned_email_failed",
      notes: notes || `Effective ${effectiveFrom}`,
      metadata: { effectiveFrom, effectiveTo, recipientEmail: String(parent.email).toLowerCase(), emailed, emailError, emailLogId },
    });

    return json({
      ok: true,
      assignment,
      pricing_group_id: pricingGroupId,
      parent_account_id: parentAccountId,
      recipient: String(parent.email).toLowerCase(),
      emailed,
      emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "The pricing tier could not be assigned." }, 400);
  }
});

type Benefit = { pricing: string; appliesTo: string; dates: string };

function formatBenefit(rule: Record<string, any>): Benefit {
  const pricing = rule.discount_type === "free_session"
    ? "Free"
    : rule.discount_type === "percentage"
      ? `${numberValue(rule.discount_value)}% off`
      : rule.discount_type === "fixed_amount"
        ? `${money(rule.discount_value)} off`
        : rule.discount_type === "fixed_price"
          ? `${money(rule.discount_value)} fixed price`
          : "Standard price";
  const service = rule.programmes?.name || serviceLabel(rule.service_key);
  const location = rule.locations?.name || "all Après School locations";
  const dates = rule.starts_on || rule.ends_on
    ? `${rule.starts_on ? `from ${displayDate(rule.starts_on)}` : "from now"}${rule.ends_on ? ` until ${displayDate(rule.ends_on)}` : ""}`
    : "No fixed end date";
  return { pricing, appliesTo: `${service} at ${location}`, dates };
}

function buildTextEmail(name: string, groupName: string, benefits: Benefit[], effectiveFrom: string, effectiveTo: string | null) {
  const lines = [
    `Hi ${firstName(name)},`,
    "",
    `You've been added to the ${groupName} pricing tier at Après School.`,
    "",
    "Your benefits:",
    ...(benefits.length ? benefits.map((benefit) => `• ${benefit.appliesTo} — ${benefit.pricing}${benefit.dates === "No fixed end date" ? "" : ` (${benefit.dates})`}`) : ["• Standard Après School pricing applies."]),
    "",
    `Your tier is effective from ${displayDate(effectiveFrom)}${effectiveTo ? ` until ${displayDate(effectiveTo)}` : ""}. These prices apply automatically when you make an eligible booking while signed in with this email address. You'll see the benefit on the activity and the confirmed saving in your basket before checkout.`,
    "",
    "The tier applies only to the services and locations listed above; other bookings remain at their usual price.",
    "Eligibility for this pricing tier is at the sole discretion of Après School and may be reviewed or withdrawn at any time.",
    "If anything looks wrong, simply reply to this email and we'll help.",
    "",
    "Welcome to the tier,",
    "The Après School team",
  ];
  return lines;
}

function buildPricingEmailHtml(name: string, groupName: string, benefits: Benefit[], effectiveFrom: string, effectiveTo: string | null) {
  const benefitCards = benefits.length
    ? benefits.map((benefit) => `<tr><td style="padding:0 0 10px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f9ff;border:1px solid #dbe5ff;border-radius:16px;"><tr><td style="padding:16px 18px;"><p style="margin:0 0 5px;color:#314bb8;font-size:19px;line-height:1.3;font-weight:900;">${escapeHtml(benefit.pricing)}</p><p style="margin:0 0 4px;color:#25304f;font-size:15px;line-height:1.5;font-weight:800;">${escapeHtml(benefit.appliesTo)}</p><p style="margin:0;color:#66708a;font-size:13px;line-height:1.45;">${escapeHtml(benefit.dates)}</p></td></tr></table></td></tr>`).join("")
    : `<tr><td style="padding:16px 18px;background:#f7f9ff;border:1px solid #dbe5ff;border-radius:16px;color:#25304f;">Standard Après School pricing applies.</td></tr>`;
  const contentHtml = `<p style="margin:4px 0 12px;color:#b96e00;font-size:12px;line-height:1.35;letter-spacing:1px;text-transform:uppercase;font-weight:900;">Your benefits</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">${benefitCards}</table>`;
  return buildStaffEmailHtml({
    preheader: `Welcome to ${groupName} pricing at Après School.`,
    eyebrow: "Your pricing benefits",
    title: `Welcome to ${groupName}`,
    greeting: `Hi ${firstName(name)},`,
    portalLabel: "Family pricing",
    paragraphs: [
      `You've been added to the ${groupName} pricing tier at Après School.`,
      `Your tier is effective from ${displayDate(effectiveFrom)}${effectiveTo ? ` until ${displayDate(effectiveTo)}` : ""}. Eligible prices apply automatically when you book while signed in with this email address.`,
      "You'll see your benefit on the activity and the confirmed saving in your basket before checkout.",
    ],
    contentHtml,
    action: { label: "View activities", url: parentPortalUrl },
    notice: "Your tier applies only to the services and locations listed above. Other bookings remain at their usual price. Eligibility for this pricing tier is at the sole discretion of Après School and may be reviewed or withdrawn at any time.",
    footerText: "Trusted wraparound care, holiday clubs and school partnerships.",
  });
}

function serviceLabel(value: unknown) {
  const labels: Record<string, string> = { all: "All services", breakfast_club: "Breakfast Club", after_school_club: "After School Club", holiday_club: "Holiday Clubs", activity_club: "Activity clubs" };
  return labels[stringValue(value)] || stringValue(value).replaceAll("_", " ") || "Eligible services";
}

function displayDate(value: unknown) {
  const text = stringValue(value);
  if (!text) return "";
  const date = new Date(`${text.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(date);
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(numberValue(value));
}

function numberValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function firstName(value: unknown) {
  return stringValue(value).split(/\s+/)[0] || "there";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
