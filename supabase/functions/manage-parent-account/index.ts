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
    if (action === "update-own-contact") return updateOwnContact(actor, rawPayload);
    if (action === "update-own-password") return updateOwnPassword(actor, rawPayload);

    if (!["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to manage parent accounts" }, 403);
    }

    if (action === "preview-migration-invite") {
      return sendMigrationInvitePreview(actor, rawPayload);
    }

    const payload = normalizePayload(rawPayload);
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);

    if (payload.action === "invite") {
      const safetyBlockers = await getMigrationInvitationSafetyBlockers(payload);
      if (safetyBlockers.length) {
        return json({
          error: "This invitation is blocked until the expired auto-injector record has been updated.",
          code: "migration_safety_review_required",
          blockers: safetyBlockers,
        }, 409);
      }
    }

    const user = await createOrUpdateUser(payload);
    await upsertParentProfile(user.id, payload);
    const parentAccount = await upsertParentAccount(user.id, payload);
    const migrationInvite = isMagicbookingMigrationInvite(payload);
    const emailSubject = migrationInvite
      ? "Welcome to the new Après School booking system"
      : payload.action === "invite"
        ? "Your Après School parent account"
      : "Your Après School parent account password has been reset";

    let emailed = false;
    let emailError = "";
    const emailLines = buildEmailLines(payload);
    const emailLog = await sendBookingEmail(supabase, {
      recipientEmail: payload.email,
      recipientName: payload.name,
      emailType: migrationInvite ? "parent_migration_invite" : payload.action === "invite" ? "parent_invite" : "parent_password_reset",
      subject: emailSubject,
      text: emailLines.join("\n"),
      html: paragraphsToHtml(emailLines, {
        title: migrationInvite ? "Your family account has moved to Après School" : payload.action === "invite" ? "Your parent account is ready" : "Password reset",
        preheader: migrationInvite ? "Your Magicbooking family details are ready to review." : "Access your Après School parent portal.",
      }),
      sentBy: actor.id,
      metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id, migrationInvite },
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

async function sendMigrationInvitePreview(actor: ActorProfile, rawPayload: Record<string, unknown>) {
  const recipientEmail = stringValue(rawPayload.email).toLowerCase();
  const recipientName = stringValue(rawPayload.name) || "Parent";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return json({ error: "Enter a valid preview email address." }, 400);
  }

  const payload = normalizePayload({
    action: "invite",
    name: recipientName,
    email: recipientEmail,
    temporaryPassword: "EXAMPLE-ONLY-NOT-A-REAL-PASSWORD",
    loginUrl: stringValue(rawPayload.loginUrl) || defaultLoginUrl,
    marketingPreferences: { imported: true, source: "magicbooking", preview: true },
  });
  const emailLines = buildEmailLines(payload);
  const emailLog = await sendBookingEmail(supabase, {
    recipientEmail,
    recipientName,
    emailType: "parent_migration_invite_preview",
    subject: "[Preview] Welcome to the new Après School booking system",
    text: emailLines.join("\n"),
    html: paragraphsToHtml(emailLines, {
      title: "Your family account has moved to Après School",
      preheader: "Your Magicbooking family details are ready to review.",
    }),
    sentBy: actor.id,
    metadata: { preview: true, migrationSource: "magicbooking" },
  });

  return json({
    sent: emailLog?.status === "sent",
    status: emailLog?.status || "unknown",
    error: typeof emailLog?.error_message === "string" ? emailLog.error_message : "",
  });
}

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

async function updateOwnContact(actor: ActorProfile, payload: Record<string, unknown>) {
  const fullName = stringValue(payload.fullName);
  const email = stringValue(payload.email).toLowerCase();
  const phone = stringValue(payload.phone);
  if (!fullName) return json({ error: "Your name is required." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (phone && !isValidPhoneNumber(phone)) return json({ error: "Enter a valid phone number." }, 400);

  const { data: primaryAccount, error: primaryError } = await supabase
    .from("parent_accounts")
    .select("id, profile_id, email, full_name, phone")
    .eq("profile_id", actor.id)
    .maybeSingle();
  if (primaryError) throw primaryError;

  let linkedHolder = null;
  if (!primaryAccount) {
    const { data, error } = await supabase
      .from("parent_account_holders")
      .select("id, parent_account_id, profile_id, email, full_name, status")
      .or(`profile_id.eq.${actor.id},email.eq.${actor.email || ""}`)
      .neq("status", "removed")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    linkedHolder = data;
  }
  if (!primaryAccount && !linkedHolder) return json({ error: "No parent account is attached to this login." }, 404);

  const { error: authError } = await supabase.auth.admin.updateUserById(actor.id, {
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "parent" },
  });
  if (authError) throw authError;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ email, full_name: fullName })
    .eq("id", actor.id);
  if (profileError) throw profileError;

  if (primaryAccount) {
    const { error } = await supabase
      .from("parent_accounts")
      .update({ email, full_name: fullName, phone: phone || null, updated_at: new Date().toISOString() })
      .eq("id", primaryAccount.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("parent_account_holders")
      .update({ email, full_name: fullName, updated_at: new Date().toISOString() })
      .eq("id", linkedHolder.id);
    if (error) throw error;
  }

  await supabase.from("audit_log").insert({
    actor_id: actor.id,
    action: "parent_contact_updated",
    table_name: primaryAccount ? "parent_accounts" : "parent_account_holders",
    record_id: primaryAccount?.id || linkedHolder.id,
    metadata: {
      previousEmail: actor.email,
      email,
      phoneChanged: Boolean(primaryAccount && String(primaryAccount.phone || "") !== phone),
      accountRole: primaryAccount ? "primary" : "secondary",
    },
  });

  return json({ ok: true, email, fullName, phone: primaryAccount ? phone : undefined, role: primaryAccount ? "primary" : "secondary" });
}

async function updateOwnPassword(actor: ActorProfile, payload: Record<string, unknown>) {
  const newPassword = stringValue(payload.newPassword);
  const passwordError = parentPasswordError(newPassword);
  if (passwordError) return json({ error: passwordError }, 400);

  const { error: authError } = await supabase.auth.admin.updateUserById(actor.id, { password: newPassword });
  if (authError) throw authError;
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
    .eq("id", actor.id);
  if (profileError) throw profileError;

  await supabase.from("audit_log").insert({
    actor_id: actor.id,
    action: "parent_password_changed",
    table_name: "profiles",
    record_id: actor.id,
    metadata: { selfService: true },
  });
  return json({ ok: true });
}

function parentPasswordError(password: string) {
  if (password.length < 10) return "Use at least 10 characters for your new password.";
  if (!/[A-Z]/.test(password)) return "Add at least one capital letter.";
  if (!/[a-z]/.test(password)) return "Add at least one lowercase letter.";
  if (!/\d/.test(password)) return "Add at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Add at least one symbol.";
  return "";
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
    if (error) return findAuthUserByEmailFromDatabase(email, error.message);
    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail);
    if (found) return found;
    if (data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function findAuthUserByEmailFromDatabase(email: string, adminApiError: string) {
  const { data, error } = await supabase
    .rpc("find_auth_user_id_by_email", { p_email: email })
    .maybeSingle();

  if (error) throw new Error(`Supabase Auth could not inspect existing users: ${adminApiError}`);
  if (!data?.id) return null;
  return { id: data.id, email: data.email, user_metadata: {} };
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
  if (isMagicbookingMigrationInvite(payload)) {
    return [
      `Hi ${firstName},`,
      "",
      "We are moving our family booking experience from Magicbooking to the new Après School booking system.",
      "",
      "Your existing family account and child records have been securely migrated, so you do not need to enter everything again.",
      "",
      "What to do next",
      "1. Open the parent portal using the link below.",
      "2. Sign in with your email address and the temporary password in this email.",
      "3. Enter the emailed security passcode and choose your own password when prompted.",
      "4. Review your family details and complete any items marked as needing attention.",
      "5. Book the September sessions you need.",
      "",
      `Parent portal: ${payload.loginUrl}`,
      `Temporary password: ${payload.temporaryPassword}`,
      "",
      "We may have imported contact details, child information, care notes, medical information and consent records from Magicbooking. Please check these carefully before making a booking so our team has the latest information.",
      "",
      "New September bookings are now available through the Après School parent portal.",
      "",
      "If you need help, reply to this email and our team will be happy to assist.",
      "",
      "Thank you,",
      "Après School",
    ];
  }
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

function isMagicbookingMigrationInvite(payload: ParentAccountPayload) {
  if (payload.action !== "invite") return false;
  const preferences = payload.marketingPreferences;
  return preferences.imported === true || stringValue(preferences.source).toLowerCase() === "magicbooking";
}

async function getMigrationInvitationSafetyBlockers(payload: ParentAccountPayload) {
  const externalParentId = stringValue(payload.marketingPreferences.externalParentId);
  let query = supabase
    .from("migration_health_review_items")
    .select("id,external_parent_id,child_name,item_type,item_name,expiry_date,status,recommended_action")
    .neq("status", "resolved");

  if (externalParentId) {
    query = query.eq("external_parent_id", externalParentId);
  } else {
    const { data: parentAccount, error: parentError } = await supabase
      .from("parent_accounts")
      .select("external_id")
      .eq("email", payload.email)
      .eq("external_source", "magicbooking")
      .maybeSingle();
    if (parentError) throw parentError;
    const matchedExternalParentId = stringValue(parentAccount?.external_id);
    if (!matchedExternalParentId) return [];
    query = query.eq("external_parent_id", matchedExternalParentId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((item) => ({
    id: item.id,
    childName: item.child_name,
    itemType: item.item_type,
    itemName: item.item_name,
    expiryDate: item.expiry_date,
    status: item.status,
    action: item.recommended_action || "Record a current device and expiry date before invitation.",
  }));
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
