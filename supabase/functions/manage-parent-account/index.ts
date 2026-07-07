import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
  Deno.env.get("APRES_PARENT_EMAIL_FROM") ??
  Deno.env.get("RESEND_FROM") ??
  "Après School <hello@apres-school.co.uk>";
const resendReplyTo =
  Deno.env.get("APRES_REPLY_TO") ??
  Deno.env.get("RESEND_REPLY_TO") ??
  "hello@apres-school.co.uk";
const defaultLoginUrl = Deno.env.get("PARENT_PORTAL_URL") ?? "https://www.apres-school.co.uk/booking-lab";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase service role is not configured" }, 500);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to manage parent accounts" }, 403);
    }

    const payload = normalizePayload(await request.json().catch(() => ({})));
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);

    const user = await createOrUpdateUser(payload);
    await upsertParentProfile(user.id, payload);
    const parentAccount = await upsertParentAccount(user.id, payload);
    const emailSubject = payload.action === "invite"
      ? "Your Après School parent account"
      : "Your Après School parent account password has been reset";

    let emailed = false;
    let emailError = "";
    if (resendApiKey) {
      try {
        const providerMessageId = await sendParentEmail(payload, emailSubject);
        emailed = true;
        await logEmail({
          recipientEmail: payload.email,
          recipientName: payload.name,
          emailType: payload.action === "invite" ? "parent_invite" : "parent_password_reset",
          subject: emailSubject,
          status: "sent",
          providerMessageId,
          sentBy: actor.id,
          metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
        });
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Email provider failed";
        await logEmail({
          recipientEmail: payload.email,
          recipientName: payload.name,
          emailType: payload.action === "invite" ? "parent_invite" : "parent_password_reset",
          subject: emailSubject,
          status: "failed",
          errorMessage: emailError,
          sentBy: actor.id,
          metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
        });
      }
    } else {
      await logEmail({
        recipientEmail: payload.email,
        recipientName: payload.name,
        emailType: payload.action === "invite" ? "parent_invite" : "parent_password_reset",
        subject: emailSubject,
        status: "queued_without_provider",
        sentBy: actor.id,
        metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
      });
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: payload.action === "invite" ? "parent_account_invited" : "parent_password_reset",
      table_name: "parent_accounts",
      record_id: parentAccount.id,
      metadata: {
        email: payload.email,
        parentAccountId: parentAccount.id,
        profileId: user.id,
        emailProviderConfigured: Boolean(resendApiKey),
        emailSent: emailed,
        emailError,
      },
    });

    return json({
      userId: user.id,
      parentAccountId: parentAccount.id,
      email: payload.email,
      emailed,
      emailError,
      temporaryPassword: payload.temporaryPassword,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to manage parent account" }, 500);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
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

async function createOrUpdateUser(payload: ParentAccountPayload) {
  const existing = await findAuthUserByEmail(payload.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: payload.temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: payload.name, role: "parent" },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: payload.email,
    password: payload.temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: payload.name, role: "parent" },
  });
  if (error) throw error;
  return data.user;
}

async function findAuthUserByEmail(email: string) {
  const targetEmail = email.toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail);
    if (found) return found;
    if (data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function upsertParentProfile(userId: string, payload: ParentAccountPayload) {
  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email: payload.email,
      full_name: payload.name,
      role: "parent",
      active: true,
      must_change_password: true,
    }, { onConflict: "id" });
  if (error) throw error;
}

async function upsertParentAccount(userId: string, payload: ParentAccountPayload) {
  const { data, error } = await supabase
    .from("parent_accounts")
    .upsert({
      profile_id: userId,
      full_name: payload.name,
      email: payload.email,
      phone: payload.phone || null,
      portal_status: "invited",
      marketing_preferences: payload.marketingPreferences,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" })
    .select("id, profile_id, full_name, email, portal_status")
    .single();
  if (error) throw error;
  return data;
}

async function sendParentEmail(payload: ParentAccountPayload, subject: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [payload.email],
      reply_to: resendReplyTo,
      subject,
      text: buildEmailText(payload),
    }),
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Resend email failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const result = await response.json().catch(() => null);
  return typeof result?.id === "string" ? result.id : "";
}

async function logEmail(entry: {
  recipientEmail: string;
  recipientName?: string;
  emailType: string;
  subject: string;
  status: string;
  providerMessageId?: string;
  errorMessage?: string;
  sentBy?: string;
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
    sent_by: entry.sentBy || null,
    metadata: entry.metadata || {},
    sent_at: entry.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) console.error(`Email log failed: ${error.message}`);
}

function buildEmailText(payload: ParentAccountPayload) {
  const firstName = payload.name.split(" ")[0] || payload.name;
  const intro = payload.action === "invite"
    ? "Your Après School parent account has been created."
    : "Your Après School parent account password has been reset.";

  return [
    `Hi ${firstName},`,
    "",
    intro,
    "",
    `Parent portal: ${payload.loginUrl}`,
    `Temporary password: ${payload.temporaryPassword}`,
    "",
    "Use your parent account to book wraparound care and holiday camp, view booked days, manage invoices, make payments and cancel eligible future sessions.",
    "",
    "Please sign in and change your password when prompted.",
    "",
    "Thank you,",
    "Après School",
  ].join("\n");
}

async function safeResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

type ParentAccountPayload = ReturnType<typeof normalizePayload>;

function normalizePayload(payload: Record<string, unknown>) {
  return {
    action: stringValue(payload.action) === "reset-password" ? "reset-password" : "invite",
    name: stringValue(payload.name),
    email: stringValue(payload.email).toLowerCase(),
    phone: stringValue(payload.phone),
    temporaryPassword: stringValue(payload.temporaryPassword),
    loginUrl: stringValue(payload.loginUrl) || defaultLoginUrl,
    marketingPreferences: isObject(payload.marketingPreferences) ? payload.marketingPreferences : {},
  };
}

function validatePayload(payload: ParentAccountPayload) {
  if (!payload.name) return "Parent name is required";
  if (!payload.email.includes("@")) return "Parent email is required";
  if (payload.temporaryPassword.length < 10) return "A temporary password of at least 10 characters is required";
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
