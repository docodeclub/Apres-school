import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { enforcePublicRateLimit, sha256 } from "../_shared/public-rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.apres-school.co.uk",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const application = normalize(await request.json().catch(() => ({})));
    const validationError = validate(application);
    if (validationError) return json({ error: validationError }, 400);
    const allowed = await enforcePublicRateLimit(supabase, request, "staff-application", {
      limit: 3,
      windowSeconds: 86400,
      identity: application.email,
    });
    if (!allowed) return json({ error: "An application has already been received. Please contact us if you need to amend it." }, 429);

    const address = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    const { data, error } = await supabase.from("staff_applications").insert({
      name: application.name,
      email: application.email,
      phone: application.phone,
      date_of_birth: application.dateOfBirth,
      address: application.address,
      application_data: application.details,
      source_ip_hash: await sha256(address),
    }).select("id, status, created_at").single();
    if (error) throw error;
    return json({ application: data }, 201);
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to submit the application securely. Please try again." }, 500);
  }
});

function text(value: unknown, max = 5000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function normalize(input: Record<string, unknown>) {
  const details: Record<string, string> = {};
  for (const key of ["preferredRole", "preferredSchool", "availability", "qualifications", "hasQualification", "references", "employmentHistory", "employmentGaps", "criminalDisclosure", "barredListDisclosure", "firstAidDetails", "dbsUpdateService", "medicalFitness", "livedAbroad", "overseasDetails", "rightToWork", "rightToWorkType", "personalStatement", "safeguardingStatement"]) details[key] = text(input[key], 10000);
  return { name: text(input.name, 120), email: text(input.email, 254).toLowerCase(), phone: text(input.phone, 40), dateOfBirth: text(input.dateOfBirth, 10), address: text(input.address, 1000), details };
}
function validate(application: ReturnType<typeof normalize>) {
  if (!application.name || !application.phone || !application.dateOfBirth || !application.address) return "Complete all required identity and contact fields.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) return "Enter a valid email address.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(application.dateOfBirth)) return "Enter a valid date of birth.";
  if (!application.details.references || !application.details.safeguardingStatement) return "Complete the references and safeguarding declaration.";
  return "";
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
