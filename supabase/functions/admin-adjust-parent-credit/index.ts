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

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Credit service is not configured" }, 500);

  try {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) return json({ error: "Sign in before adjusting credit" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Your admin session has expired" }, 401);

    const payload = await request.json().catch(() => ({}));
    const parentAccountId = stringValue(payload.parentAccountId);
    const amount = Number(payload.amount);
    const reason = stringValue(payload.reason);
    const note = stringValue(payload.note);

    const { data: adjustment, error: adjustmentError } = await callerClient.rpc("admin_adjust_parent_account_credit", {
      p_parent_account_id: parentAccountId,
      p_amount: amount,
      p_reason: reason,
      p_note: note,
    });
    if (adjustmentError) throw new Error(adjustmentError.message || "The credit adjustment could not be saved.");

    const signedAmount = Number(adjustment?.amount || 0);
    const absoluteAmount = Math.abs(signedAmount).toFixed(2);
    const balance = Number(adjustment?.balanceAfter || 0).toFixed(2);
    const added = signedAmount > 0;
    const customerName = stringValue(adjustment?.customerName) || "Parent or carer";
    const customerEmail = stringValue(adjustment?.customerEmail).toLowerCase();
    const reasonLabel = stringValue(adjustment?.reasonLabel) || "Credit adjustment";
    const subject = added
      ? `£${absoluteAmount} credit added to your Après School account`
      : `Your Après School account credit has been adjusted`;
    const lines = [
      `Hi ${firstName(customerName)},`,
      added
        ? `£${absoluteAmount} credit has been added to your Après School account.`
        : `£${absoluteAmount} has been removed from your Après School account credit.`,
      `Reason: ${reasonLabel}`,
      `Note from Après School: ${note}`,
      `Your available account credit is now £${balance}.`,
      "You can view your credit balance and history in the parent portal.",
      "If you have any questions, reply to this email and we will help.",
      "Thank you,",
      "Après School",
    ];

    let emailSent = false;
    let emailError = "";
    if (customerEmail) {
      try {
        const emailLog = await sendBookingEmail(serviceClient, {
          recipientEmail: customerEmail,
          recipientName: customerName,
          emailType: "admin_parent_credit_adjustment",
          subject,
          text: lines.join("\n"),
          html: paragraphsToHtml(lines, {
            title: added ? "Credit added to your account" : "Your account credit has been adjusted",
            preheader: `${reasonLabel}: your available credit is now £${balance}.`,
          }),
          sentBy: userData.user.id,
          metadata: {
            parentAccountId,
            creditEntryId: adjustment?.entryId,
            amount: signedAmount,
            balanceAfter: Number(adjustment?.balanceAfter || 0),
            reason,
            note,
          },
        });
        emailSent = emailLog?.status === "sent";
        emailError = stringValue(emailLog?.error_message);
      } catch (error) {
        emailError = error instanceof Error ? error.message : "The customer email could not be sent.";
      }
    } else {
      emailError = "This customer does not have an email address.";
    }

    await serviceClient
      .from("parent_account_credit_entries")
      .update({
        metadata: {
          source: "admin_customer_profile",
          reasonCode: adjustment.reasonCode,
          reasonLabel,
          adminNote: note,
          adjustedBy: userData.user.id,
          balanceBefore: adjustment.balanceBefore,
          balanceAfter: adjustment.balanceAfter,
          customerEmail,
          emailSent,
          emailError: emailError || null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", adjustment.entryId);

    return json({ adjustment, emailSent, emailError });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to adjust account credit" }, 400);
  }
});

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
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
