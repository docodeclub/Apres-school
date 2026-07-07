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

    const existing = await findAuthUserByEmail(payload.email);
    if (existing) {
      return json({ error: "A parent account already exists for this email. Please sign in." }, 409);
    }

    const user = await createUser(payload);
    await upsertParentProfile(user.id, payload);
    const parentAccount = await upsertParentAccount(user.id, payload);

    let emailed = false;
    let emailError = "";
    if (resendApiKey) {
      try {
        const providerMessageId = await sendWelcomeEmail(payload);
        emailed = true;
        await logEmail({
          recipientEmail: payload.email,
          recipientName: payload.fullName,
          emailType: "parent_registration",
          subject: "Your Après School parent account",
          status: "sent",
          providerMessageId,
          metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
        });
      } catch (error) {
        emailError = error instanceof Error ? error.message : "Email provider failed";
        await logEmail({
          recipientEmail: payload.email,
          recipientName: payload.fullName,
          emailType: "parent_registration",
          subject: "Your Après School parent account",
          status: "failed",
          errorMessage: emailError,
          metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
        });
      }
    } else {
      await logEmail({
        recipientEmail: payload.email,
        recipientName: payload.fullName,
        emailType: "parent_registration",
        subject: "Your Après School parent account",
        status: "queued_without_provider",
        metadata: { loginUrl: payload.loginUrl, parentAccountId: parentAccount.id },
      });
    }

    await supabase.from("audit_log").insert({
      actor_id: user.id,
      action: "parent_account_self_registered",
      table_name: "parent_accounts",
      record_id: parentAccount.id,
      metadata: {
        email: payload.email,
        centre: payload.centre,
        emailProviderConfigured: Boolean(resendApiKey),
        emailSent: emailed,
        emailError,
      },
    });

    return json({
      userId: user.id,
      parentAccountId: parentAccount.id,
      email: payload.email,
      parentAccount,
      emailed,
      emailError,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to register parent account" }, 500);
  }
});

async function createUser(payload: ParentRegistrationPayload) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: {
      full_name: payload.fullName,
      role: "parent",
      preferred_centre: payload.centre,
    },
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
      },
      marketing_preferences: payload.marketingPreferences,
      portal_status: "active",
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" })
    .select("id, profile_id, full_name, email, phone, billing_address, emergency_contact, portal_status")
    .single();
  if (error) throw error;
  return data;
}

async function sendWelcomeEmail(payload: ParentRegistrationPayload) {
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
      subject: "Your Après School parent account",
      text: [
        `Hi ${payload.firstName},`,
        "",
        "Your Après School parent account has been created.",
        "",
        `Sign in here: ${payload.loginUrl}`,
        "",
        "Before booking, please add your child profile, emergency contacts, medical information and consents.",
        "",
        "Best wishes,",
        "Après School",
      ].join("\n"),
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
    metadata: entry.metadata || {},
    sent_at: entry.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) console.error(`Email log failed: ${error.message}`);
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
    ethnicity: cleanString(input.ethnicity),
    gender: cleanString(input.gender),
    primaryPhone: cleanString(input.primaryPhone),
    secondaryPhone: cleanString(input.secondaryPhone),
    heardFrom: cleanString(input.heardFrom),
    terms: Boolean(input.terms),
    privacy: Boolean(input.privacy),
    loginUrl: cleanString(input.loginUrl) || defaultLoginUrl,
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
    ["ethnicity", payload.ethnicity],
    ["gender", payload.gender],
    ["address line 1", payload.billingAddress.line1],
    ["town", payload.billingAddress.town],
    ["postcode", payload.billingAddress.postcode],
    ["primary phone", payload.primaryPhone],
  ];
  const missing = required.find(([, value]) => !String(value || "").trim());
  if (missing) return `Parent ${missing[0]} is required.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Enter a valid parent email.";
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

function cleanString(value: unknown) {
  return String(value || "").trim();
}

async function safeResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
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
  ethnicity: string;
  gender: string;
  primaryPhone: string;
  secondaryPhone: string;
  heardFrom: string;
  terms: boolean;
  privacy: boolean;
  loginUrl: string;
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
