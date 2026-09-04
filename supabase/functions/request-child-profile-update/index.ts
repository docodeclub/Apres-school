import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const parentPortalUrl = Deno.env.get("APRES_PARENT_PORTAL_URL") ?? "https://www.apres-school.co.uk/launch-booking";

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Profile update service is not configured" }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before requesting an update" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your admin session has expired" }, 401);

    const { data: actor, error: actorError } = await serviceClient
      .from("profiles")
      .select("id,role,active,full_name")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (actorError || !actor?.active || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Admin access is required" }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const childId = stringValue(payload.childId);
    const section = stringValue(payload.section).toLowerCase();
    const note = stringValue(payload.note).slice(0, 500);
    if (!childId || section !== "allergies") return json({ error: "Choose the allergy section for a child profile" }, 400);

    const { data: child, error: childError } = await serviceClient
      .from("child_profiles")
      .select("id,full_name,parent_account_id,active,archived_at,parent_accounts(id,full_name,email,archived_at)")
      .eq("id", childId)
      .maybeSingle();
    const parent = Array.isArray(child?.parent_accounts) ? child.parent_accounts[0] : child?.parent_accounts;
    if (childError || !child || child.active === false || child.archived_at || !parent || parent.archived_at) {
      return json({ error: "The active child and parent account could not be found" }, 404);
    }
    const recipientEmail = stringValue(parent.email).toLowerCase();
    if (!recipientEmail.includes("@")) return json({ error: "The parent account does not have a valid email address" }, 400);

    const actionUrl = `${parentPortalUrl.replace(/\/$/, "")}?account=family&child=${encodeURIComponent(child.id)}&care=allergies`;
    const parentName = stringValue(parent.full_name) || "Parent or carer";
    const childName = stringValue(child.full_name) || "your child";
    const lines = [
      `Hi ${firstName(parentName)},`,
      `Please review and update the allergy information held for ${childName}.`,
      "Accurate allergy information helps our staff provide safe care and ensures the register shows the correct alert.",
      note ? `Message from Après School: ${note}` : "Please confirm the record is correct, including when there are no known allergies.",
      `Parent portal: ${actionUrl}`,
      "Sign in, open the allergy section shown, make any necessary changes and save the record.",
      "If you need help, reply to this email.",
      "Thank you,",
      "Après School",
    ];
    const emailLog = await sendBookingEmail(serviceClient, {
      recipientEmail,
      recipientName: parentName,
      emailType: "child_allergy_update_requested",
      subject: `Please review ${childName}'s allergy information`,
      text: lines.join("\n"),
      html: paragraphsToHtml(lines, {
        title: "Please review allergy information",
        preheader: `Please check the allergy information held for ${childName}.`,
        badge: "Action requested",
        eyebrow: "Après School Care Information",
      }),
      sentBy: actor.id,
      metadata: { childId: child.id, parentAccountId: parent.id, section, note, requestedBy: actor.full_name || actor.id },
    });

    if (emailLog?.status !== "sent") {
      return json({ error: emailLog?.error_message || "The email provider did not confirm delivery" }, 502);
    }
    return json({ ok: true, recipient: recipientEmail, childName, requestedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to request the profile update" }, 400);
  }
});

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
