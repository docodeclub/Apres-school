import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.apres-school.co.uk";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Payment service is not configured" }, 500);

  try {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sign in before adding credit." }, 401);

    const body = await request.json().catch(() => ({}));
    const amount = moneyValue(body.amount);
    if (amount < 5 || amount > 500) return json({ error: "Choose a top-up amount between £5 and £500." }, 400);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active) return json({ error: "This parent account is not active." }, 403);

    const account = await resolveParentAccount(profile.id, profile.email || userData.user.email || "");
    if (!account) return json({ error: "Parent account could not be found." }, 404);

    const invoiceId = `credit_topup_${crypto.randomUUID()}`;
    const returnBase = `${publicSiteUrl.replace(/\/$/, "")}/api/ponchopay_redirect`;
    const checkoutPayload = {
      invoiceId,
      parentId: account.profile_id || profile.id,
      parentEmail: account.email || profile.email || userData.user.email,
      parentName: account.full_name || profile.full_name || "Parent",
      paymentMethod: "card",
      paymentPlan: "pay_now",
      amount,
      successUrl: `${returnBase}?payment=pending&invoice=${encodeURIComponent(invoiceId)}&reference=${encodeURIComponent(invoiceId)}`,
      cancelUrl: `${returnBase}?payment=cancelled&invoice=${encodeURIComponent(invoiceId)}&reference=${encodeURIComponent(invoiceId)}`,
      items: [{
        id: `topup-${invoiceId}`,
        childName: "Family account",
        siteName: stringValue(body.siteName) || "Willington Prep",
        careType: "Account credit",
        sessionId: `credit-${invoiceId}`,
        sessionName: "Parent account credit top-up",
        date: new Date().toISOString().slice(0, 10),
        quantity: 1,
        unitAmount: amount,
      }],
      metadata: {
        creditTopUp: true,
        topUpAmount: amount,
        parentAccountId: account.id,
        source: "parent_credit_topup",
      },
    };

    const response = await fetch(`${supabaseUrl}/functions/v1/ponchopay-create-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(checkoutPayload),
    });
    const checkout = await response.json().catch(() => ({}));
    if (!response.ok || checkout?.error) throw new Error(stringValue(checkout?.error) || "Unable to create secure top-up payment");

    await supabase.from("audit_log").insert({
      actor_id: profile.id,
      action: "parent_account_credit_topup_started",
      table_name: "booking_invoices",
      metadata: { invoiceId, parentAccountId: account.id, amount, checkoutStatus: checkout.status },
    });

    return json({ invoiceId, amount, checkout });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to start credit top-up" }, 500);
  }
});

async function resolveParentAccount(profileId: string, email: string) {
  const direct = await supabase
    .from("parent_accounts")
    .select("id, profile_id, email, full_name")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (direct.error) throw direct.error;
  if (direct.data) return direct.data;

  const linked = await supabase
    .from("parent_account_holders")
    .select("parent_accounts(id, profile_id, email, full_name)")
    .eq("profile_id", profileId)
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();
  if (linked.error && !["PGRST200", "PGRST205"].includes(linked.error.code || "")) throw linked.error;
  const linkedAccount = Array.isArray(linked.data?.parent_accounts) ? linked.data?.parent_accounts[0] : linked.data?.parent_accounts;
  if (linkedAccount) return linkedAccount;

  const byEmail = await supabase
    .from("parent_accounts")
    .select("id, profile_id, email, full_name")
    .ilike("email", email)
    .maybeSingle();
  if (byEmail.error) throw byEmail.error;
  return byEmail.data || null;
}

function moneyValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
