import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

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
const defaultLoginUrl = Deno.env.get("PARENT_PORTAL_URL") ?? "https://www.apres-school.co.uk/launch-booking";

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
    if (!actor) {
      return json({ error: "Sign in before managing parent accounts" }, 401);
    }

    const rawPayload = await request.json().catch(() => ({}));
    const action = stringValue(rawPayload.action);
    if (action === "invite-holder") return inviteLinkedAccountHolder(actor, rawPayload);
    if (action === "remove-holder") return removeLinkedAccountHolder(actor, rawPayload);

    if (!["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to manage parent accounts" }, 403);
    }

    const payload = normalizePayload(rawPayload);
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
    const emailLines = buildEmailLines(payload);
    const emailLog = await sendBookingEmail(supabase, {
      recipientEmail: payload.email,
      recipientName: payload.name,
      emailType: payload.action === "invite" ? "parent_invite" : "parent_password_reset",
      subject: emailSubject,
      text: emailLines.join("\n"),
      html: paragraphsToHtml(emailLines, {
        title: payload.action === "invite" ? "Your parent account is ready" : "Password reset",
        preheader: "Access your Après School parent portal.",
      }),
      sentBy: actor.id,
      metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
    });
    emailed = emailLog?.status === "sent";
    emailError = typeof emailLog?.error_message === "string" ? emailLog.error_message : "";

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

async function inviteLinkedAccountHolder(actor: ActorProfile, payload: Record<string, unknown>) {
  const parentAccountId = stringValue(payload.parentAccountId);
  const email = stringValue(payload.email).toLowerCase();
  const fullName = stringValue(payload.fullName);
  const loginUrl = stringValue(payload.loginUrl) || defaultLoginUrl;
  if (!parentAccountId) return json({ error: "Parent account is required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid second account holder email." }, 400);

  const parentAccount = await getPrimaryParentAccount(actor, parentAccountId);
  if (!parentAccount) return json({ error: "Only the main account holder can invite another adult." }, 403);
  if (String(parentAccount.email || "").toLowerCase() === email) {
    return json({ error: "That email is already the main account holder." }, 400);
  }

  const { data: existing, error: existingError } = await supabase
    .from("parent_account_holders")
    .select("id, email, full_name, role, status, invited_at, permissions")
    .eq("parent_account_id", parentAccountId)
    .eq("email", email)
    .neq("status", "removed")
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return json({ error: "That second account holder has already been invited." }, 409);

  const { data: holder, error } = await supabase
    .from("parent_account_holders")
    .insert({
      parent_account_id: parentAccountId,
      email,
      full_name: fullName || null,
      role: "secondary",
      status: "invited",
      invited_by: actor.id,
      permissions: {
        book: true,
        view_schedule: true,
        view_invoices: true,
        manage_holders: false,
      },
    })
    .select("id, email, full_name, role, status, invited_at, permissions")
    .single();
  if (error) throw error;

  const primaryName = stringValue(parentAccount.full_name) || "the main account holder";
  const inviteName = fullName.split(" ")[0] || "there";
  const emailLines = [
    `Hi ${inviteName},`,
    "",
    `${primaryName} has invited you to share access to their Après School family account.`,
    "",
    `Create or sign in here: ${loginUrl}`,
    "",
    "You can view booked days, book care, manage payments and see invoices for the linked family.",
    "",
    "Only the main account holder can remove linked adults from the family account.",
    "",
    "Thank you,",
    "Après School",
  ];
  const emailLog = await sendBookingEmail(supabase, {
    recipientEmail: email,
    recipientName: fullName || undefined,
    emailType: "parent_account_holder_invite",
    subject: "You’ve been invited to Après School bookings",
    text: emailLines.join("\n"),
    html: paragraphsToHtml(emailLines, {
      title: "You’re invited to Après School",
      preheader: "Create or sign in to share the family booking account.",
    }),
    sentBy: actor.id,
    metadata: { parentAccountId, holderId: holder.id, loginUrl },
  });

  await supabase.from("audit_log").insert({
    actor_id: actor.id,
    action: "parent_account_holder_invited",
    table_name: "parent_account_holders",
    record_id: holder.id,
    metadata: { parentAccountId, email, emailStatus: emailLog?.status || "unknown" },
  });

  return json({
    holder,
    emailed: emailLog?.status === "sent",
    emailError: typeof emailLog?.error_message === "string" ? emailLog.error_message : "",
  });
}

async function removeLinkedAccountHolder(actor: ActorProfile, payload: Record<string, unknown>) {
  const holderId = stringValue(payload.holderId);
  if (!holderId) return json({ error: "Second account holder is required" }, 400);

  const { data: holder, error: holderError } = await supabase
    .from("parent_account_holders")
    .select("id, parent_account_id, email, status")
    .eq("id", holderId)
    .maybeSingle();
  if (holderError) throw holderError;
  if (!holder) return json({ error: "Second account holder not found" }, 404);

  const parentAccount = await getPrimaryParentAccount(actor, String(holder.parent_account_id || ""));
  if (!parentAccount) return json({ error: "Only the main account holder can remove a second account holder." }, 403);

  const { data, error } = await supabase
    .from("parent_account_holders")
    .update({
      status: "removed",
      removed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", holderId)
    .select("id, email, status")
    .single();
  if (error) throw error;

  await supabase.from("audit_log").insert({
    actor_id: actor.id,
    action: "parent_account_holder_removed",
    table_name: "parent_account_holders",
    record_id: holderId,
    metadata: { parentAccountId: holder.parent_account_id, email: holder.email },
  });

  return json({ holder: data });
}

async function getPrimaryParentAccount(actor: ActorProfile, parentAccountId: string) {
  const { data, error } = await supabase
    .from("parent_accounts")
    .select("id, profile_id, email, full_name")
    .eq("id", parentAccountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const actorEmail = String(actor.email || "").toLowerCase();
  const accountEmail = String(data.email || "").toLowerCase();
  if (String(data.profile_id || "") === String(actor.id || "") || (actorEmail && accountEmail === actorEmail)) {
    return data;
  }
  return null;
}

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

function buildEmailLines(payload: ParentAccountPayload) {
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
  ];
}

type ParentAccountPayload = ReturnType<typeof normalizePayload>;

type ActorProfile = {
  id: string;
  role?: string | null;
  full_name?: string | null;
  email?: string | null;
};

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Enter a valid parent email.";
  if (payload.phone && !isValidPhoneNumber(payload.phone)) return "Enter a valid parent phone number.";
  if (payload.temporaryPassword.length < 10) return "A temporary password of at least 10 characters is required";
  return null;
}

function compactPhoneNumber(value: string) {
  return String(value || "").replace(/[\s().-]/g, "");
}

function isValidPhoneNumber(value: string, options: { required?: boolean } = {}) {
  const compact = compactPhoneNumber(value);
  if (!compact) return !options.required;
  return /^(\+44|0)\d{9,10}$/.test(compact) || /^\+[1-9]\d{7,14}$/.test(compact);
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
