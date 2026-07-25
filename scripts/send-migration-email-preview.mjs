import { createClient } from "@supabase/supabase-js";

const recipient = String(process.argv[2] || "").trim().toLowerCase();
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.LIVE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL || (supabaseUrl ? `${supabaseUrl}/functions/v1` : "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("Provide a valid preview recipient email address.");
if (!supabaseUrl || !anonKey || !serviceRoleKey || !functionsUrl) throw new Error("Supabase preview configuration is incomplete.");

const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = crypto.randomUUID();
const adminEmail = `migration-preview-${runId}@apres-school.test`;
const adminPassword = `Preview!${runId}9aA`;
let adminUserId = "";

try {
  const { data: userData, error: userError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (userError) throw userError;
  adminUserId = userData.user?.id || "";
  if (!adminUserId) throw new Error("Preview administrator was not created.");

  const { error: profileError } = await service.from("profiles").upsert({
    id: adminUserId,
    email: adminEmail,
    full_name: "Migration Email Preview",
    role: "admin",
    active: true,
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const { data: sessionData, error: signInError } = await publicClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (signInError) throw signInError;
  const accessToken = sessionData.session?.access_token || "";
  if (!accessToken) throw new Error("Preview administrator could not sign in.");

  const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/manage-parent-account`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: "preview-migration-invite",
      name: "Luke",
      email: recipient,
      loginUrl: "https://www.apres-school.co.uk/launch-booking",
    }),
  });
  const detail = await response.json().catch(() => ({}));
  if (!response.ok || !detail.sent) throw new Error(detail.error || `Preview email failed with HTTP ${response.status}.`);
  console.log(JSON.stringify({ sent: true, recipient, status: detail.status || "sent" }));
} finally {
  if (adminUserId) {
    await service.from("profiles").delete().eq("id", adminUserId);
    await service.auth.admin.deleteUser(adminUserId);
  }
}
