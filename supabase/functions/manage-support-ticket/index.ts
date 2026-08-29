import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const helpdeskEmail = Deno.env.get("APRES_HELPDESK_EMAIL") ?? "helpdesk@apres-school.co.uk";
const supportTicketsUrl = Deno.env.get("APRES_SUPPORT_TICKETS_URL") ?? "https://www.apres-school.co.uk/staff-login?section=crm";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (!["GET", "POST"].includes(request.method)) return responsePage("Link not recognised", "This support-ticket link is not valid.", 405);
  if (!supabaseUrl || !serviceRoleKey) return responsePage("Service unavailable", "Please email helpdesk@apres-school.co.uk for assistance.", 503);
  try {
    const url = new URL(request.url);
    const enquiryId = url.searchParams.get("ticket") || "";
    const token = url.searchParams.get("token") || "";
    if (url.searchParams.get("action") !== "reopen" || !isUuid(enquiryId) || !isUuid(token)) return responsePage("Link not recognised", "This support-ticket link is incomplete or invalid.", 400);
    const { data: ticket, error } = await supabase.from("enquiries").select("id,name,email,subject,status,reopen_token,reopen_token_expires_at,parent_account_id,archived_at").eq("id", enquiryId).eq("reopen_token", token).maybeSingle();
    if (error) throw error;
    if (!ticket) return responsePage("Link not recognised", "This support-ticket link is no longer valid.", 404);
    if (ticket.parent_account_id) return responsePage("Sign in securely", "This ticket belongs to a family account. Sign in to your parent portal to view or re-open it.", 409, portalLink(ticket.id));
    if (ticket.archived_at) return responsePage("Ticket archived", "Please email helpdesk@apres-school.co.uk if you still need assistance.", 409);
    if (ticket.status !== "closed") return responsePage("Ticket already open", "Your support ticket is already open and our team can continue helping you.", 200);
    if (!ticket.reopen_token_expires_at || new Date(ticket.reopen_token_expires_at).getTime() < Date.now()) return responsePage("Link expired", "For your security, this re-open link has expired. Please email helpdesk@apres-school.co.uk.", 410);
    if (request.method === "GET") return reopenForm(ticket);

    const form = await request.formData();
    const message = String(form.get("message") || "").trim();
    if (message.length < 10 || message.length > 8000) return reopenForm(ticket, "Please explain what remains unresolved using at least 10 characters.", message, 400);
    const reopenedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("enquiries").update({ status: "reviewing", closed_at: null, closed_by: null, parent_reopened_at: reopenedAt, reopen_token: crypto.randomUUID(), reopen_token_expires_at: null }).eq("id", ticket.id).eq("status", "closed").eq("reopen_token", token);
    if (updateError) throw updateError;
    const { error: messageError } = await supabase.from("support_ticket_messages").insert({ enquiry_id: ticket.id, parent_account_id: null, sender_profile_id: null, sender_type: "parent", body: message });
    if (messageError) throw messageError;
    await supabase.from("audit_log").insert({ actor_id: null, action: "support_ticket_reopened_by_parent", table_name: "enquiries", record_id: ticket.id, metadata: { ticketName: ticket.name, ticketEmail: ticket.email, source: "single-use-parent-reopen-form" } });
    try {
      const lines = ["A parent has re-opened a support ticket with a new message.", `Parent: ${ticket.name || "Not recorded"}`, `Email: ${ticket.email || "Not recorded"}`, `Subject: ${ticket.subject || "Support request"}`, `Message: ${message}`, `Open Support Tickets: ${supportTicketsUrl}`];
      await sendBookingEmail(supabase, { recipientEmail: helpdeskEmail, recipientName: "Après School Helpdesk", emailType: "support_ticket_reopened", subject: `Support ticket re-opened: ${ticket.name || "Parent"}`, text: lines.join("\n"), html: paragraphsToHtml(lines, { title: "A parent re-opened a ticket", preheader: "A closed support ticket needs another review.", badge: "Ticket Open", eyebrow: "Après School Support" }), enquiryId: ticket.id, metadata: { reopenedAt, reopenedBy: "parent", messageRequired: true } });
    } catch (notificationError) { console.error("Ticket reopened, but helpdesk notification failed", notificationError); }
    return responsePage("Ticket re-opened", "Your message has been added and the Après School team has been notified.", 200);
  } catch (error) {
    console.error(error);
    return responsePage("Unable to re-open ticket", "Please email helpdesk@apres-school.co.uk and we will help you directly.", 500);
  }
});

function reopenForm(ticket: Record<string, unknown>, error = "", message = "", status = 200) {
  return new Response(pageShell("Re-open your ticket", `<span class="badge">Ticket Closed</span><h1>Tell us what still needs resolving</h1><p><strong>${escapeHtml(ticket.subject || "Support request")}</strong></p><p>Your message is required before the ticket can be re-opened. It will be sent securely to our helpdesk.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}<form method="post"><label for="message">Your message</label><textarea id="message" name="message" minlength="10" maxlength="8000" rows="7" required>${escapeHtml(message)}</textarea><button type="submit">Re-open ticket and send message</button></form>`), { status, headers: htmlHeaders() });
}
function responsePage(title: string, message: string, status: number, link = "") {
  return new Response(pageShell(title, `<span class="badge">Support update</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link ? `<a class="button" href="${escapeHtml(link)}">Open parent portal</a>` : ""}`), { status, headers: htmlHeaders() });
}
function pageShell(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Après School</title><style>body{margin:0;background:#eef3ff;font-family:Arial,sans-serif;color:#25304f}main{max-width:620px;margin:8vh auto;padding:24px}section{background:#fff;border:1px solid #dbe5ff;border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(37,48,79,.14)}header{padding:24px;border-bottom:6px solid #f4aa3d}.brand{display:block;color:#314bb8;font-size:24px}.tag{color:#c47708;font-size:13px;font-weight:800}.content{padding:32px 24px}.badge{display:inline-block;padding:8px 12px;border-radius:999px;background:#edf3ff;color:#314bb8;font-weight:800}h1{font-size:30px;line-height:1.2;margin:20px 0 12px}p{font-size:17px;line-height:1.6}label{display:block;font-weight:800;margin:22px 0 8px}textarea{box-sizing:border-box;width:100%;padding:14px;border:2px solid #dbe5ff;border-radius:14px;font:inherit}button,.button{display:inline-block;margin-top:16px;padding:14px 20px;border:0;border-radius:999px;background:#405fd5;color:#fff;font-weight:800;text-decoration:none;cursor:pointer}.error{padding:12px;border-radius:12px;background:#fff2f3;color:#a42537}</style></head><body><main><section><header><strong class="brand">Après School</strong><span class="tag">Let's Learn and Play</span></header><div class="content">${content}</div></section></main></body></html>`;
}
function portalLink(ticketId: unknown) { return `https://www.apres-school.co.uk/launch-booking?account=support&ticket=${encodeURIComponent(String(ticketId || ""))}`; }
function htmlHeaders() { return { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function escapeHtml(value: unknown) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
