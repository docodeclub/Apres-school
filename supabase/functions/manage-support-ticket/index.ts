import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("APRES_SERVICE_ROLE_KEY") ??
  "";
const helpdeskEmail = Deno.env.get("APRES_HELPDESK_EMAIL") ?? "helpdesk@apres-school.co.uk";
const supportTicketsUrl = Deno.env.get("APRES_SUPPORT_TICKETS_URL") ?? "https://www.apres-school.co.uk/staff-login?section=support-tickets";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (request) => {
  if (request.method !== "GET") return responsePage("Link not recognised", "This support-ticket link is not valid.", 405, false);
  if (!supabaseUrl || !serviceRoleKey) return responsePage("Service unavailable", "Please email helpdesk@apres-school.co.uk for assistance.", 503, false);

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    const enquiryId = url.searchParams.get("ticket") || "";
    const token = url.searchParams.get("token") || "";
    if (action !== "reopen" || !isUuid(enquiryId) || !isUuid(token)) {
      return responsePage("Link not recognised", "This support-ticket link is incomplete or invalid.", 400, false);
    }

    const { data: ticket, error } = await supabase
      .from("enquiries")
      .select("id,name,email,subject,status,reopen_token,archived_at")
      .eq("id", enquiryId)
      .eq("reopen_token", token)
      .maybeSingle();
    if (error) throw error;
    if (!ticket) return responsePage("Link not recognised", "This support-ticket link is no longer valid.", 404, false);
    if (ticket.archived_at) {
      return responsePage("Ticket archived", "Please email helpdesk@apres-school.co.uk if you still need assistance.", 409, false);
    }
    if (ticket.status !== "closed") {
      return responsePage("Ticket already open", "Your support ticket is already open and our team can continue helping you.", 200, true);
    }

    const reopenedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("enquiries")
      .update({
        status: "reviewing",
        closed_at: null,
        closed_by: null,
        parent_reopened_at: reopenedAt,
      })
      .eq("id", ticket.id)
      .eq("status", "closed");
    if (updateError) throw updateError;

    await supabase.from("audit_log").insert({
      actor_id: null,
      action: "support_ticket_reopened_by_parent",
      table_name: "enquiries",
      record_id: ticket.id,
      metadata: {
        ticketName: ticket.name,
        ticketEmail: ticket.email,
        source: "parent-reopen-link",
      },
    });

    try {
      const lines = [
        "A parent has re-opened a support ticket.",
        `Parent: ${ticket.name || "Not recorded"}`,
        `Email: ${ticket.email || "Not recorded"}`,
        `Subject: ${ticket.subject || "Support request"}`,
        `Sign in here: ${supportTicketsUrl}`,
      ];
      await sendBookingEmail(supabase, {
        recipientEmail: helpdeskEmail,
        recipientName: "Après School Helpdesk",
        emailType: "support_ticket_reopened",
        subject: `Support ticket re-opened: ${ticket.name || "Parent"}`,
        text: lines.join("\n"),
        html: paragraphsToHtml(lines, {
          title: "A parent re-opened a ticket",
          preheader: "A closed support ticket needs another review.",
          badge: "Ticket Open",
          eyebrow: "Après School Support",
        }),
        enquiryId: ticket.id,
        metadata: { reopenedAt, reopenedBy: "parent" },
      });
    } catch (notificationError) {
      console.error("Ticket reopened, but helpdesk notification failed", notificationError);
    }

    return responsePage("Ticket re-opened", "Your ticket is open again. The Après School team has been notified and will continue helping you.", 200, true);
  } catch (error) {
    console.error(error);
    return responsePage("Unable to re-open ticket", "Please email helpdesk@apres-school.co.uk and we will help you directly.", 500, false);
  }
});

function responsePage(title: string, message: string, status: number, success: boolean) {
  const colour = success ? "#167344" : "#a42537";
  const panel = success ? "#edf9f2" : "#fff2f3";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Après School</title></head><body style="margin:0;background:#eef3ff;font-family:Arial,sans-serif;color:#25304f"><main style="max-width:620px;margin:8vh auto;padding:24px"><section style="background:#fff;border:1px solid #dbe5ff;border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(37,48,79,.14)"><header style="padding:24px;border-bottom:6px solid #f4aa3d"><strong style="display:block;color:#314bb8;font-size:24px">Après School</strong><span style="color:#c47708;font-size:13px;font-weight:800">Let's Learn and Play</span></header><div style="padding:32px 24px"><span style="display:inline-block;padding:8px 12px;border-radius:999px;background:${panel};color:${colour};font-weight:800">${success ? "Ticket Open" : "Support update"}</span><h1 style="font-size:30px;line-height:1.2;margin:20px 0 12px">${escapeHtml(title)}</h1><p style="font-size:17px;line-height:1.6;margin:0">${escapeHtml(message)}</p></div></section></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
