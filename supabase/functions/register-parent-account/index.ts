import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";
import { enforcePublicRateLimit, sha256 } from "../_shared/public-rate-limit.ts";

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
    const payload = normalizePayload(await request.json().catch(() => ({})));
    const validationError = validatePayload(payload);
    if (validationError) return json({ error: validationError }, 400);
    const allowed = await enforcePublicRateLimit(supabase, request, "parent-registration", {
      limit: 3,
      windowSeconds: 3600,
      identity: payload.email,
    });
    if (!allowed) return json({ error: "Too many registration attempts. Please wait before trying again." }, 429);

    const linkedInvite = await findLinkedAccountInvite(payload.email, payload.inviteToken);
    const existing = await findAuthUserByEmail(payload.email);
    if (existing) {
      return json({ error: "A parent account already exists for this email. Please sign in." }, 409);
    }

    const { user, verificationUrl } = await createUser(payload);
    await upsertParentProfile(user.id, payload);
    if (linkedInvite) {
      const holder = await activateLinkedAccountInvite(linkedInvite, user.id, payload);
      const emailResult = await sendLinkedAccountWelcomeEmail(payload, linkedInvite, holder, verificationUrl);

      await supabase.from("audit_log").insert({
        actor_id: user.id,
        action: "parent_account_holder_registered",
        table_name: "parent_account_holders",
        record_id: holder.id,
        metadata: {
          email: payload.email,
          parentAccountId: linkedInvite.parent_account_id,
          emailProviderConfigured: Boolean(resendApiKey),
          emailSent: emailResult.emailed,
          emailError: emailResult.emailError,
        },
      });

      return json({
        userId: user.id,
        parentAccountId: linkedInvite.parent_account_id,
        linkedAccountHolder: true,
        email: payload.email,
        emailed: emailResult.emailed,
        emailError: emailResult.emailError,
        verificationRequired: true,
      });
    }

    const parentAccount = await upsertParentAccount(user.id, payload);

    const emailResult = await sendWelcomeEmail(payload, parentAccount.id, verificationUrl);

    await supabase.from("audit_log").insert({
      actor_id: user.id,
      action: "parent_account_self_registered",
      table_name: "parent_accounts",
      record_id: parentAccount.id,
      metadata: {
        email: payload.email,
        centre: payload.centre,
        emailProviderConfigured: Boolean(resendApiKey),
        emailSent: emailResult.emailed,
        emailError: emailResult.emailError,
      },
    });

    return json({
      userId: user.id,
      parentAccountId: parentAccount.id,
      email: payload.email,
      verificationRequired: true,
      parentAccount,
      emailed: emailResult.emailed,
      emailError: emailResult.emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: readableError(error) }, 500);
  }
});

async function createUser(payload: ParentRegistrationPayload) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "signup",
    email: payload.email,
    password: payload.password,
    options: {
      redirectTo: defaultLoginUrl,
      data: {
        full_name: payload.fullName,
        role: "parent",
        preferred_centre: payload.centre,
      },
    },
  });
  if (error) throw error;
  if (!data.user || !data.properties?.action_link) throw new Error("Unable to create a secure email verification link.");
  return { user: data.user, verificationUrl: data.properties.action_link };
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

async function upsertParentProfile(userId: string, payload: ParentRegistrationPayload) {
  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email: payload.email,
      full_name: payload.fullName,
      phone: payload.primaryPhone,
      role: "parent",
      active: true,
    }, { onConflict: "id" });
  if (error) throw error;
}

async function upsertParentAccount(userId: string, payload: ParentRegistrationPayload) {
  const { data, error } = await supabase
    .from("parent_accounts")
    .upsert({
      profile_id: userId,
      full_name: payload.fullName,
      email: payload.email,
      phone: payload.primaryPhone,
      billing_address: payload.billingAddress,
      emergency_contact: {
        primaryPhone: payload.primaryPhone,
        secondaryPhone: payload.secondaryPhone,
        contacts: [
          { type: "primary", name: payload.fullName, relationship: "Main account holder", email: payload.email, mobile: payload.primaryPhone },
          { type: "secondary", name: "Second emergency contact", relationship: "Emergency contact", mobile: payload.secondaryPhone },
        ],
      },
      marketing_preferences: payload.marketingPreferences,
      portal_status: "pending_verification",
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" })
    .select("id, profile_id, full_name, email, phone, billing_address, emergency_contact, portal_status")
    .single();
  if (error) throw error;
  return data;
}

async function findLinkedAccountInvite(email: string, inviteToken: string) {
  if (!inviteToken) return null;
  const { data, error } = await supabase
    .from("parent_account_holders")
    .select("id, parent_account_id, email, full_name, status, parent_accounts(id, full_name, email)")
    .eq("email", email.toLowerCase())
    .eq("status", "invited")
    .eq("invitation_token_hash", await sha256(inviteToken))
    .gt("invitation_expires_at", new Date().toISOString())
    .is("invitation_used_at", null)
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (["42P01", "42703", "PGRST200", "PGRST205"].includes(error.code || "")) return null;
    throw error;
  }
  return data as LinkedAccountInvite | null;
}

async function activateLinkedAccountInvite(invite: LinkedAccountInvite, userId: string, payload: ParentRegistrationPayload) {
  const { data, error } = await supabase
    .from("parent_account_holders")
    .update({
      profile_id: userId,
      full_name: payload.fullName,
      status: "active",
      accepted_at: new Date().toISOString(),
      invitation_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invite.id)
    .select("id, email, full_name, role, status, invited_at, accepted_at, permissions")
    .single();
  if (error) throw error;
  return data;
}

async function sendWelcomeEmail(payload: ParentRegistrationPayload, parentAccountId: string, verificationUrl: string) {
  const lines = [
    `Hi ${payload.firstName},`,
    "",
    "Confirm your email address to finish creating your Après School parent account.",
    "",
    `Confirm email: ${verificationUrl}`,
    "",
    "Before booking, please add your child profile, emergency contacts, medical information and consents.",
    "",
    "Best wishes,",
    "Après School",
  ];
  const emailLog = await sendBookingEmail(supabase, {
    recipientEmail: payload.email,
    recipientName: payload.fullName,
    emailType: "parent_registration",
    subject: "Confirm your Après School parent account",
    text: lines.join("\n"),
    html: paragraphsToHtml(lines, {
      title: "Confirm your email address",
      preheader: "Verify this email before signing in to your parent account.",
    }),
    metadata: { parentAccountId, verificationRequired: true },
  });
  return {
    emailed: emailLog?.status === "sent",
    emailError: typeof emailLog?.error_message === "string" ? emailLog.error_message : "",
  };
}

async function sendLinkedAccountWelcomeEmail(
  payload: ParentRegistrationPayload,
  invite: LinkedAccountInvite,
  holder: Record<string, unknown>,
  verificationUrl: string,
) {
  const parentAccount = Array.isArray(invite.parent_accounts) ? invite.parent_accounts[0] : invite.parent_accounts;
  const primaryName = cleanString(parentAccount?.full_name) || "the main account holder";
  const lines = [
    `Hi ${payload.firstName},`,
    "",
    `Confirm your email to finish connecting to ${primaryName}'s family account.`,
    "",
    `Confirm email: ${verificationUrl}`,
    "",
    "You can view booked days, book care, manage payments and see invoices for the linked family.",
    "",
    "Only the main account holder can remove linked adults from the family account.",
    "",
    "Best wishes,",
    "Après School",
  ];
  const emailLog = await sendBookingEmail(supabase, {
    recipientEmail: payload.email,
    recipientName: payload.fullName,
    emailType: "parent_account_holder_registration",
    subject: "Confirm your linked Après School account",
    text: lines.join("\n"),
    html: paragraphsToHtml(lines, {
      title: "Confirm your linked account",
      preheader: "Verify this email before accessing the shared family account.",
    }),
    metadata: { parentAccountId: invite.parent_account_id, holderId: holder.id, verificationRequired: true },
  });
  return {
    emailed: emailLog?.status === "sent",
    emailError: typeof emailLog?.error_message === "string" ? emailLog.error_message : "",
  };
}

function normalizePayload(input: Record<string, unknown>): ParentRegistrationPayload {
  const firstName = cleanString(input.firstName);
  const lastName = cleanString(input.lastName);
  const email = cleanString(input.email).toLowerCase();
  return {
    firstName,
    lastName,
    fullName: cleanString(input.fullName) || `${firstName} ${lastName}`.trim(),
    email,
    password: String(input.password || ""),
    centre: cleanString(input.centre),
    title: cleanString(input.title),
    gender: cleanString(input.gender),
    primaryPhone: cleanString(input.primaryPhone),
    secondaryPhone: cleanString(input.secondaryPhone),
    heardFrom: cleanString(input.heardFrom),
    terms: Boolean(input.terms),
    privacy: Boolean(input.privacy),
    loginUrl: defaultLoginUrl,
    inviteToken: cleanString(input.inviteToken),
    billingAddress: {
      line1: cleanString(input.address1),
      line2: cleanString(input.address2),
      town: cleanString(input.town),
      county: cleanString(input.county),
      country: cleanString(input.country) || "United Kingdom",
      postcode: cleanString(input.postcode).toUpperCase(),
    },
    marketingPreferences: {
      apresEmail: Boolean(input.marketingEmail),
      apresSms: Boolean(input.marketingSms),
      source: cleanString(input.heardFrom),
      acceptedTermsAt: new Date().toISOString(),
    },
  };
}

function validatePayload(payload: ParentRegistrationPayload) {
  const required = [
    ["first name", payload.firstName],
    ["last name", payload.lastName],
    ["email", payload.email],
    ["password", payload.password],
    ["centre", payload.centre],
    ["title", payload.title],
    ["gender", payload.gender],
    ["address line 1", payload.billingAddress.line1],
    ["town", payload.billingAddress.town],
    ["postcode", payload.billingAddress.postcode],
    ["primary phone", payload.primaryPhone],
    ["second emergency contact number", payload.secondaryPhone],
  ];
  const missing = required.find(([, value]) => !String(value || "").trim());
  if (missing) return `Parent ${missing[0]} is required.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Enter a valid parent email.";
  if (!isValidPhoneNumber(payload.primaryPhone, { required: true })) return "Enter a valid primary phone number.";
  if (!isValidPhoneNumber(payload.secondaryPhone, { required: true })) return "Enter a valid second emergency contact number.";
  if (compactPhoneNumber(payload.primaryPhone) === compactPhoneNumber(payload.secondaryPhone)) return "Use a different number for the second emergency contact.";
  if (
    payload.password.length < 6 ||
    !/[a-z]/.test(payload.password) ||
    !/[A-Z]/.test(payload.password) ||
    !/[0-9]/.test(payload.password) ||
    !/[^a-zA-Z0-9]/.test(payload.password)
  ) {
    return "Password must include upper case, lower case, a number and a special character.";
  }
  if (!payload.terms || !payload.privacy) return "Terms and privacy acceptance are required.";
  return "";
}

function compactPhoneNumber(value: string) {
  return String(value || "").replace(/[\s().-]/g, "");
}

function isValidPhoneNumber(value: string, options: { required?: boolean } = {}) {
  const compact = compactPhoneNumber(value);
  if (!compact) return !options.required;
  return /^(\+44|0)\d{9,10}$/.test(compact) || /^\+[1-9]\d{7,14}$/.test(compact);
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
  return "Unable to register parent account";
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

type ParentRegistrationPayload = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  password: string;
  centre: string;
  title: string;
  gender: string;
  primaryPhone: string;
  secondaryPhone: string;
  heardFrom: string;
  terms: boolean;
  privacy: boolean;
  loginUrl: string;
  inviteToken: string;
  billingAddress: {
    line1: string;
    line2: string;
    town: string;
    county: string;
    country: string;
    postcode: string;
  };
  marketingPreferences: Record<string, unknown>;
};

type LinkedAccountInvite = {
  id: string;
  parent_account_id: string;
  email: string;
  full_name?: string | null;
  status?: string | null;
  parent_accounts?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
  } | Array<{
    id?: string;
    full_name?: string | null;
    email?: string | null;
  }> | null;
};
