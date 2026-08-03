import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";
import { enforcePublicRateLimit } from "../_shared/public-rate-limit.ts";

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
const resetCodeSecret =
  Deno.env.get("PARENT_RESET_CODE_SECRET") ??
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  serviceRoleKey;
const defaultLoginUrl = Deno.env.get("PARENT_PORTAL_URL") ?? "https://www.apres-school.co.uk/launch-booking";
const codeMinutes = Number(Deno.env.get("PARENT_RESET_CODE_MINUTES") || 15);
const maxAttempts = 5;

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
    const input = await request.json().catch(() => ({}));
    const action = cleanString(input.action);
    if (action === "request-code") return requestCode(input, request);
    if (action === "confirm-code") return confirmCode(input);
    return json({ error: "Unknown password reset action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: readableError(error) }, 500);
  }
});

async function requestCode(input: Record<string, unknown>, request: Request) {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return json({ error: "Enter a valid parent email address." }, 400);
  const allowed = await enforcePublicRateLimit(supabase, request, "parent-password-reset", {
    limit: 5,
    windowSeconds: 3600,
    identity: email,
  });
  if (!allowed) return json({ error: "Too many reset requests. Please wait before trying again." }, 429);

  const parentUser = await resolveParentUser(email);
  let emailSent = false;
  let emailError = "";

  if (parentUser) {
    const code = generateCode();
    const codeHash = await hashCode(email, code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(5, codeMinutes) * 60 * 1000).toISOString();

    await supabase
      .from("parent_password_reset_codes")
      .update({ used_at: now.toISOString() })
      .eq("email", email)
      .is("used_at", null);

    const { error: insertError } = await supabase
      .from("parent_password_reset_codes")
      .insert({
        email,
        code_hash: codeHash,
        expires_at: expiresAt,
        requested_ip: request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || null,
      });
    if (insertError) throw insertError;

    const firstName = firstNameFromUser(parentUser);
    const loginUrl = defaultLoginUrl;
    const lines = [
      `Hi ${firstName || "there"},`,
      "",
      "Use this passcode to reset your Après School parent portal password.",
      "",
      `Passcode: ${code}`,
      "",
      `This code expires in ${Math.max(5, codeMinutes)} minutes.`,
      "",
      `Parent portal: ${loginUrl}`,
      "",
      "If you did not request this, you can ignore this email.",
      "",
      "Thank you,",
      "Après School",
    ];

    try {
      await sendBookingEmail(supabase, {
        recipientEmail: email,
        recipientName: firstName,
        emailType: "parent_password_reset_code",
        subject: "Your Après School password reset code",
        text: lines.join("\n"),
        html: paragraphsToHtml(lines, {
          title: "Reset your parent password",
          preheader: "Use this passcode to set a new parent portal password.",
        }),
        sentBy: parentUser.id,
        metadata: {
          userId: parentUser.id,
          expiresAt,
        },
      });
      emailSent = true;
    } catch (error) {
      emailError = readableError(error);
      console.error(emailError);
    }

    await supabase.from("audit_log").insert({
      actor_id: parentUser.id,
      action: "parent_password_reset_code_requested",
      table_name: "parent_password_reset_codes",
      record_id: null,
      metadata: {
        email,
        emailSent,
        emailError,
        expiresAt,
      },
    });
  }

  return json({
    ok: true,
    message: "If a parent account exists for that email, a reset code has been sent.",
  });
}

async function confirmCode(input: Record<string, unknown>) {
  const email = normalizeEmail(input.email);
  const code = cleanString(input.code).replace(/\s/g, "");
  const password = cleanString(input.password);

  if (!isValidEmail(email)) return json({ error: "Enter a valid parent email address." }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6 digit passcode." }, 400);
  const passwordError = passwordValidationError(password);
  if (passwordError) return json({ error: passwordError }, 400);

  const parentUser = await resolveParentUser(email);
  if (!parentUser) return json({ error: "The reset code is invalid or has expired." }, 400);

  const { data: resetRow, error: resetError } = await supabase
    .from("parent_password_reset_codes")
    .select("id, code_hash, attempts, expires_at, used_at")
    .eq("email", email)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resetError) throw resetError;
  if (!resetRow || Number(resetRow.attempts || 0) >= maxAttempts) {
    return json({ error: "The reset code is invalid or has expired." }, 400);
  }

  const expectedHash = await hashCode(email, code);
  if (expectedHash !== resetRow.code_hash) {
    const attempts = Number(resetRow.attempts || 0) + 1;
    await supabase
      .from("parent_password_reset_codes")
      .update({
        attempts,
        ...(attempts >= maxAttempts ? { used_at: new Date().toISOString() } : {}),
      })
      .eq("id", resetRow.id);
    return json({ error: "The reset code is invalid or has expired." }, 400);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(parentUser.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...(parentUser.user_metadata || {}),
      role: "parent",
      password_reset_at: new Date().toISOString(),
    },
  });
  if (updateError) throw updateError;

  await supabase
    .from("profiles")
    .update({
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      active: true,
    })
    .eq("id", parentUser.id);

  await supabase
    .from("parent_password_reset_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", resetRow.id);

  await supabase.from("audit_log").insert({
    actor_id: parentUser.id,
    action: "parent_password_reset_completed",
    table_name: "profiles",
    record_id: parentUser.id,
    metadata: {
      email,
    },
  });

  return json({ ok: true, email });
}

async function resolveParentUser(email: string) {
  const authUser = await findAuthUserByEmail(email);
  if (!authUser?.id) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role === "parent") return { ...authUser, profile };

  const { data: parentAccount, error: parentError } = await supabase
    .from("parent_accounts")
    .select("id, full_name, email")
    .eq("email", email)
    .maybeSingle();
  if (parentError && !["42P01", "42703", "PGRST200", "PGRST205"].includes(parentError.code || "")) throw parentError;
  if (parentAccount) return { ...authUser, parentAccount };

  const { data: holder, error: holderError } = await supabase
    .from("parent_account_holders")
    .select("id, full_name, email, status")
    .eq("email", email)
    .neq("status", "removed")
    .maybeSingle();
  if (holderError && !["42P01", "42703", "PGRST200", "PGRST205"].includes(holderError.code || "")) throw holderError;
  if (holder) return { ...authUser, holder };

  return null;
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

function firstNameFromUser(user: Record<string, unknown>) {
  const profile = user.profile as Record<string, unknown> | undefined;
  const parentAccount = user.parentAccount as Record<string, unknown> | undefined;
  const holder = user.holder as Record<string, unknown> | undefined;
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = cleanString(profile?.full_name || parentAccount?.full_name || holder?.full_name || metadata?.full_name || user.email);
  return fullName.split(/\s+/)[0] || "";
}

function generateCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
}

async function hashCode(email: string, code: string) {
  const data = new TextEncoder().encode(`${email}:${code}:${resetCodeSecret}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function passwordValidationError(password: string) {
  if (
    password.length < 6 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^a-zA-Z0-9]/.test(password)
  ) {
    return "Password must include upper case, lower case, a number and a special character.";
  }
  return "";
}

function normalizeEmail(value: unknown) {
  return cleanString(value).toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function readableError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = cleanString(record.message);
    const details = cleanString(record.details);
    const hint = cleanString(record.hint);
    const code = cleanString(record.code);
    const parts = [message, details, hint, code ? `Code ${code}` : ""].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "Unable to reset parent password";
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
