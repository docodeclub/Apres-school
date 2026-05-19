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
const resendFrom = Deno.env.get("RESEND_FROM") ?? "Après School <hello@apres-school.co.uk>";
const defaultLoginUrl = Deno.env.get("STAFF_LOGIN_URL") ?? "https://www.apres-school.co.uk/staff-login";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(String(actor.role || "").toLowerCase())) {
      return json({ error: "Not authorised to manage staff accounts" }, 403);
    }

    const payload = normalizePayload(await request.json());
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);

    const user = payload.action === "invite"
      ? await createOrUpdateUser(payload)
      : await resetExistingUser(payload);

    await upsertProfile(user.id, payload);
    await linkStaffRecord(payload.staffRecordId, user.id);

    let emailed = false;
    let emailError = "";
    if (resendApiKey) {
      try {
        await sendAccountEmail(payload);
        emailed = true;
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Email provider failed";
        console.error(emailError);
      }
    }

    await supabase.from("audit_log").insert({
      actor_id: actor.id,
      action: payload.action === "invite" ? "staff_account_invited" : "staff_password_reset",
      table_name: "profiles",
      record_id: user.id,
      metadata: {
        email: payload.email,
        staffRecordId: payload.staffRecordId,
        emailProviderConfigured: Boolean(resendApiKey),
        emailSent: emailed,
        emailError,
      },
    });

    return json({ userId: user.id, email: payload.email, emailed, emailError });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to manage staff account" }, 500);
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

async function createOrUpdateUser(payload: StaffAccountPayload) {
  const existing = await findProfileUserByEmail(payload.email);
  if (existing) return updateExistingAuthUser(existing, payload);

  return createAuthUser(payload);
}

async function resetExistingUser(payload: StaffAccountPayload) {
  const existing = await findProfileUserByEmail(payload.email);
  if (!existing) return createOrUpdateUser(payload);
  return updateExistingAuthUser(existing, payload);
}

async function updateExistingAuthUser(existing: { id: string; email: string }, payload: StaffAccountPayload) {
  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
    password: payload.temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: payload.name, role: payload.role },
  });

  if (!error) return data.user;
  if (isAuthUserLoadError(error)) return repairExistingAuthUser(payload);
  throw error;
}

async function createAuthUser(payload: StaffAccountPayload) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: payload.email,
    password: payload.temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: payload.name, role: payload.role },
  });
  if (error && isAuthEmailConflict(error)) return recoverExistingAuthUser(payload, error);
  if (error) throw new Error(formatCreateUserError(error));
  return data.user;
}

async function recoverExistingAuthUser(payload: StaffAccountPayload, originalError: { message?: string }) {
  try {
    return await repairExistingAuthUser(payload);
  } catch {
    const existing = await findAuthUserByEmail(payload.email);
    if (!existing) throw new Error(formatCreateUserError(originalError));
    return updateExistingAuthUser({ id: existing.id, email: payload.email }, payload);
  }
}

async function createReplacementAuthUser(existing: { id: string; email: string }, payload: StaffAccountPayload) {
  const user = await createAuthUser(payload);
  if (user.id !== existing.id) await archiveProfileEmail(existing);
  return user;
}

async function repairExistingAuthUser(payload: StaffAccountPayload) {
  const { data, error } = await supabase
    .rpc("repair_staff_auth_email_user", {
      p_email: payload.email,
      p_password: payload.temporaryPassword,
      p_full_name: payload.name,
      p_role: payload.role,
    })
    .maybeSingle();

  if (error) throw new Error(`Supabase Auth repair failed: ${error.message}`);
  if (!data?.id) throw new Error(formatCreateUserError({ message: "database error checking email" }));
  return { id: data.id, email: data.email };
}

async function archiveProfileEmail(existing: { id: string; email: string }) {
  const archiveEmail = `archived-${Date.now()}-${existing.email}`;
  const { error } = await supabase
    .from("profiles")
    .update({ email: archiveEmail, active: false })
    .eq("id", existing.id);
  if (error) throw error;
}

function isAuthUserLoadError(error: { message?: string }) {
  return /database error loading user/i.test(error.message || "");
}

function isAuthEmailConflict(error: { message?: string }) {
  return /database error checking email|already|registered|exists/i.test(error.message || "");
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
  return { id: data.id, email: data.email };
}

async function findProfileUserByEmail(email: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function formatCreateUserError(error: { message?: string }) {
  const message = error.message || "Unable to create staff auth user";
  if (/database error checking email/i.test(message)) {
    return "Supabase Auth could not create this account because the email is in a broken or duplicate Auth state. Check Supabase Auth > Users for this email, then retry.";
  }
  if (/already|registered|exists/i.test(message)) {
    return "This email already exists in Supabase Auth but is not linked to a staff profile. Link or remove the existing Auth user, then retry.";
  }
  return message;
}

async function linkStaffRecord(staffRecordId: string, userId: string) {
  if (!staffRecordId) return;
  const { error } = await supabase
    .from("staff_records")
    .update({ profile_id: userId })
    .eq("id", staffRecordId);
  if (error) throw error;
}

async function upsertProfile(userId: string, payload: StaffAccountPayload) {
  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email: payload.email,
      full_name: payload.name,
      role: payload.role.toLowerCase(),
    }, { onConflict: "id" });
  if (error) throw error;
}

async function sendAccountEmail(payload: StaffAccountPayload) {
  const subject = payload.action === "invite"
    ? "Welcome to the Après School staff platform"
    : "Your Après School staff platform password has been reset";
  const text = buildEmailText(payload);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [payload.email],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Resend email failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

async function safeResponseText(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function buildEmailText(payload: StaffAccountPayload) {
  const greetingName = payload.name.split(" ")[0] || payload.name;
  const intro = payload.action === "invite"
    ? "Welcome to Après School. Your staff account has been created."
    : "Your Après School staff platform password has been reset.";

  return [
    `Hi ${greetingName},`,
    "",
    intro,
    "",
    `Login link: ${payload.loginUrl || defaultLoginUrl}`,
    `Temporary password: ${payload.temporaryPassword}`,
    "",
    "This platform is for staff-only features, including your sessions, assigned locations, policy documents, compliance evidence requests, HR files, pay information, expenses and internal announcements.",
    "",
    "It also helps Après School stay compliant across our sites and remain Ofsted ready, so we can provide evidence of documents, checks and operational records whenever Ofsted or a partner school requires it.",
    "",
    "Please log in and change your password when prompted.",
    "",
    "Thank you,",
    "Après School",
  ].join("\n");
}

type StaffAccountPayload = ReturnType<typeof normalizePayload>;

function normalizePayload(payload: Record<string, unknown>) {
  return {
    action: stringValue(payload.action) === "reset-password" ? "reset-password" : "invite",
    staffRecordId: stringValue(payload.staffRecordId),
    name: stringValue(payload.name),
    email: stringValue(payload.email).toLowerCase(),
    role: normalizeRole(stringValue(payload.role)),
    temporaryPassword: stringValue(payload.temporaryPassword),
    loginUrl: stringValue(payload.loginUrl) || defaultLoginUrl,
  };
}

function validatePayload(payload: StaffAccountPayload) {
  if (!payload.name) return "Staff name is required";
  if (!payload.email.includes("@")) return "Staff email is required";
  if (payload.temporaryPassword.length < 10) return "A temporary password of at least 10 characters is required";
  return null;
}

function normalizeRole(role: string) {
  const value = role.toLowerCase();
  if (value === "superadmin") return "superadmin";
  if (value === "admin") return "admin";
  if (value === "manager") return "manager";
  return "staff";
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
