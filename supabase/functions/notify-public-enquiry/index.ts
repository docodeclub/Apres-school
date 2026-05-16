import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const notificationTo = Deno.env.get("ENQUIRY_NOTIFICATION_TO") ?? "hello@apres-school.co.uk";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom = Deno.env.get("RESEND_FROM") ?? "Après School <hello@apres-school.co.uk>";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await request.json();
    const enquiry = normalizeEnquiry(payload);
    const validationError = validateEnquiry(enquiry);

    if (validationError) return json({ error: validationError }, 400);

    const { data, error } = await supabase
      .from("enquiries")
      .insert({
        name: enquiry.name,
        email: enquiry.email,
        organisation: enquiry.organisation,
        type: enquiry.type,
        subject: enquiry.subject,
        role: enquiry.role,
        message: enquiry.message,
        status: "new",
      })
      .select("*")
      .single();

    if (error) throw error;

    await notifyByEmail(enquiry, data.id);

    return json({ enquiry: data }, 200);
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to submit enquiry" }, 500);
  }
});

function normalizeEnquiry(payload: Record<string, unknown>) {
  return {
    name: stringValue(payload.name),
    email: stringValue(payload.email),
    organisation: stringValue(payload.organisation),
    type: stringValue(payload.type) || "Other",
    subject: stringValue(payload.subject),
    role: stringValue(payload.role),
    message: stringValue(payload.message),
  };
}

function validateEnquiry(enquiry: ReturnType<typeof normalizeEnquiry>) {
  if (!enquiry.name) return "Name is required";
  if (!enquiry.email || !enquiry.email.includes("@")) return "Valid email is required";
  if (!enquiry.message) return "Message is required";
  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function notifyByEmail(enquiry: ReturnType<typeof normalizeEnquiry>, enquiryId: string) {
  if (!resendApiKey) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [notificationTo],
      subject: `New Après School enquiry: ${enquiry.type}`,
      text: [
        `Name: ${enquiry.name}`,
        `Email: ${enquiry.email}`,
        `Organisation: ${enquiry.organisation || "N/A"}`,
        `Type: ${enquiry.type}`,
        `Subject: ${enquiry.subject || "N/A"}`,
        `Role: ${enquiry.role || "N/A"}`,
        "",
        enquiry.message,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Email notification failed for enquiry ${enquiryId}: ${response.status} ${detail}`);
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
