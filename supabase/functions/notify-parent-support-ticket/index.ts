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
const helpdeskEmail = Deno.env.get("APRES_HELPDESK_EMAIL") ?? "helpdesk@apres-school.co.uk";
const staffTicketsUrl = Deno.env.get("APRES_SUPPORT_TICKETS_URL") ?? "https://www.apres-school.co.uk/staff-login?section=crm";
const parentPortalUrl = Deno.env.get("APRES_PARENT_SUPPORT_URL") ?? "https://www.apres-school.co.uk/launch-booking?account=support";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Support notification service is unavailable." }, 503);

  try {
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sign in to update a support ticket." }, 401);

    const payload = await request.json().catch(() => ({}));
    const ticketId = String(payload.ticketId || "").trim();
    const event = ["created", "message", "reopened"].includes(payload.event) ? payload.event : "message";
    if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return json({ error: "Support ticket not found." }, 400);

    const { data: ticket, error: ticketError } = await supabase
      .from("enquiries")
      .select("id,name,email,subject,status,parent_account_id,archived_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket || ticket.archived_at || !ticket.parent_account_id) return json({ error: "Support ticket not found." }, 404);

    const userEmail = String(userData.user.email || "").toLowerCase();
    const [{ data: account }, { data: holderByProfile }, { data: holderByEmail }] = await Promise.all([
      supabase.from("parent_accounts").select("id,full_name,email,profile_id").eq("id", ticket.parent_account_id).maybeSingle(),
      supabase.from("parent_account_holders").select("id").eq("parent_account_id", ticket.parent_account_id).neq("status", "removed").eq("profile_id", userData.user.id).limit(1).maybeSingle(),
      supabase.from("parent_account_holders").select("id").eq("parent_account_id", ticket.parent_account_id).neq("status", "removed").ilike("email", userEmail).limit(1).maybeSingle(),
    ]);
    const hasAccess = account && (account.profile_id === userData.user.id || String(account.email || "").toLowerCase() === userEmail || Boolean(holderByProfile) || Boolean(holderByEmail));
    if (!hasAccess) return json({ error: "You do not have access to this support ticket." }, 403);

    const { data: latestMessage } = await supabase
      .from("support_ticket_messages")
      .select("body,created_at")
      .eq("enquiry_id", ticket.id)
      .eq("sender_type", "parent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const eventLabel = event === "created" ? "New support ticket" : event === "reopened" ? "Ticket re-opened" : "New parent message";
    const parentUrl = `${parentPortalUrl}${parentPortalUrl.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket.id)}`;
    const helpdeskLines = [
      eventLabel,
      `Parent: ${ticket.name || account.full_name || "Not recorded"}`,
      `Email: ${ticket.email || account.email || "Not recorded"}`,
      `Subject: ${ticket.subject || "Support request"}`,
      latestMessage?.body ? `Message: ${latestMessage.body}` : "",
      `Open Support Tickets: ${staffTicketsUrl}`,
    ].filter(Boolean);
    await sendBookingEmail(supabase, {
      recipientEmail: helpdeskEmail,
      recipientName: "Après School Helpdesk",
      emailType: `parent_support_ticket_${event}`,
      subject: `${eventLabel}: ${ticket.subject || ticket.name || "Parent support"}`,
      text: helpdeskLines.join("\n"),
      html: paragraphsToHtml(helpdeskLines, { title: eventLabel, preheader: ticket.subject || "Parent support update", badge: "Ticket Open", eyebrow: "Après School Support" }),
      enquiryId: ticket.id,
      metadata: { event, parentAccountId: ticket.parent_account_id, parentPortal: true },
    });

    const parentLines = [
      `Hi ${String(ticket.name || account.full_name || "there").split(/\s+/)[0]},`,
      event === "created" ? "We have received your support request." : event === "reopened" ? "Your support ticket has been re-opened and your new message has been sent to our team." : "Your additional message has been added to your support ticket.",
      `Subject: ${ticket.subject || "Support request"}`,
      `View your ticket securely: ${parentUrl}`,
      "Kind regards,",
      "Après School",
    ];
    await sendBookingEmail(supabase, {
      recipientEmail: ticket.email || account.email,
      recipientName: ticket.name || account.full_name || "Parent",
      emailType: `parent_support_confirmation_${event}`,
      subject: `${event === "created" ? "We received" : "Update received for"} your support ticket`,
      text: parentLines.join("\n"),
      html: paragraphsToHtml(parentLines, { title: "Your support ticket", preheader: "Your message is safely attached to your family account.", badge: "Ticket Open", eyebrow: "Après School Support" }),
      enquiryId: ticket.id,
      metadata: { event, parentAccountId: ticket.parent_account_id, parentPortal: true },
    });

    return json({ notified: true, event }, 200);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Support notification failed." }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
