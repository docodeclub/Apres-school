import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { paragraphsToHtml, sendBookingEmail } from "../_shared/booking-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("APRES_REGISTER_CRON_SECRET") ?? "";
const publicSiteUrl = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.apres-school.co.uk").replace(/\/$/, "");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!cronSecret || request.headers.get("x-apres-cron-secret") !== cronSecret) return json({ error: "Not authorised" }, 401);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Register sharing is unavailable" }, 503);

  try {
    const payload = await request.json().catch(() => ({}));
    if (request.headers.get("x-apres-register-bootstrap") === "1") {
      const { error: secretError } = await supabase.rpc("bootstrap_school_register_cron_secret", { p_secret: cronSecret });
      if (secretError) throw secretError;
    }
    const requestedTestDate = String(payload?.testDate || "");
    if (requestedTestDate && request.headers.get("x-apres-test-mode") !== "controlled") {
      return json({ error: "Controlled test header required" }, 403);
    }
    if (requestedTestDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedTestDate)) {
      return json({ error: "Invalid test date" }, 400);
    }
    const now = requestedTestDate ? { date: requestedTestDate, time: "23:59:00" } : londonParts(new Date());
    const { data: locations, error } = await supabase.rpc("school_register_share_due_locations", {
      p_local_date: now.date,
      p_local_time: now.time,
    });
    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const location of Array.isArray(locations) ? locations : []) {
      for (const recipient of Array.isArray(location.recipients) ? location.recipients : []) {
        const claim = await claimDelivery(location.locationId, recipient.id, now.date);
        if (!claim) {
          skipped += 1;
          continue;
        }
        const token = secureToken();
        const tokenHash = await sha256Hex(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { data: link, error: linkError } = await supabase.from("school_register_share_links").insert({
          location_id: location.locationId,
          recipient_id: recipient.id,
          register_date: now.date,
          token_hash: tokenHash,
          include_breakfast: Boolean(location.includeBreakfast),
          include_after_school: Boolean(location.includeAfterSchool),
          expires_at: expiresAt,
        }).select("id").single();
        if (linkError) {
          failed += 1;
          await failDelivery(claim.id, linkError.message);
          continue;
        }

        const registerUrl = `${publicSiteUrl}/shared-register?token=${encodeURIComponent(token)}`;
        const firstName = String(recipient.name || "there").trim().split(/\s+/)[0];
        const programmes = [location.includeBreakfast ? "Breakfast Club" : "", location.includeAfterSchool ? "After-school Club" : ""].filter(Boolean).join(" and ");
        const lines = [
          `Hi ${firstName},`,
          `The live ${programmes} register for ${location.schoolName} is ready for ${formatDate(now.date)}.`,
          location.includeBreakfast ? `Breakfast Club children: ${Number(location.breakfastCount || 0)}` : "",
          location.includeAfterSchool ? `After-school Club children: ${Number(location.afterSchoolCount || 0)}` : "",
          "The read-only list contains only each child's name, year group and class/form. You can filter it on screen.",
          `Open the live register: ${registerUrl}`,
          "Important: This is a private passwordless link for your school. Do not forward it. It expires automatically after 24 hours.",
          "Thank you,",
          "Après School",
        ].filter(Boolean);
        try {
          const email = await sendBookingEmail(supabase, {
            recipientEmail: recipient.email,
            recipientName: recipient.name || location.schoolName,
            emailType: "school_daily_register",
            subject: `${location.schoolName} register — ${formatDate(now.date)}`,
            text: lines.join("\n\n"),
            html: paragraphsToHtml(lines, {
              title: "Today's live school register",
              preheader: `${location.schoolName} register for ${formatDate(now.date)}.`,
              badge: "Read only · 24 hours",
              eyebrow: "School register",
            }),
            metadata: { locationId: location.locationId, registerDate: now.date, linkId: link.id, expiresAt },
          });
          if (email?.status !== "sent") throw new Error(String(email?.error_message || "Email provider did not confirm delivery"));
          await supabase.from("school_register_share_deliveries").update({
            link_id: link.id,
            status: "sent",
            provider_message_id: email.provider_message_id || null,
            email_log_id: email.id,
            error_message: null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", claim.id);
          sent += 1;
        } catch (emailError) {
          const message = emailError instanceof Error ? emailError.message : "Email could not be sent";
          await supabase.from("school_register_share_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
          await failDelivery(claim.id, message);
          failed += 1;
        }
      }
    }
    return json({ date: now.date, sent, skipped, failed }, failed ? 207 : 200);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Daily registers could not be sent" }, 500);
  }
});

async function claimDelivery(locationId: string, recipientId: string, registerDate: string) {
  const attemptedAt = new Date().toISOString();
  const { data, error } = await supabase.from("school_register_share_deliveries").insert({
    location_id: locationId,
    recipient_id: recipientId,
    register_date: registerDate,
    status: "processing",
    attempted_at: attemptedAt,
    updated_at: attemptedAt,
  }).select("id").single();
  if (!error) return data;
  if (error.code !== "23505") throw error;

  const { data: existing, error: existingError } = await supabase.from("school_register_share_deliveries")
    .select("id,status,attempted_at").eq("location_id", locationId).eq("recipient_id", recipientId).eq("register_date", registerDate).single();
  if (existingError) throw existingError;
  const stale = existing.status === "processing" && Date.now() - new Date(existing.attempted_at).getTime() > 15 * 60 * 1000;
  if (existing.status !== "failed" && !stale) return null;
  const { data: retried, error: retryError } = await supabase.from("school_register_share_deliveries").update({
    status: "processing", error_message: null, attempted_at: attemptedAt, updated_at: attemptedAt,
  }).eq("id", existing.id).select("id").single();
  if (retryError) throw retryError;
  return retried;
}

async function failDelivery(id: string, message: string) {
  await supabase.from("school_register_share_deliveries").update({
    status: "failed", error_message: message.slice(0, 1000), updated_at: new Date().toISOString(),
  }).eq("id", id);
}

function secureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function londonParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:00` };
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
