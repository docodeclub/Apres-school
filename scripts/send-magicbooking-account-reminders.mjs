import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
loadLocalEnvFiles([".env.staging", ".env.production.local", ".env.local", ".env"]);
const args = new Set(process.argv.slice(2));
const runLive = args.has("--run");
const force = args.has("--force");
const limitArg = process.argv.indexOf("--limit");
const requestedLimit = limitArg >= 0 ? Number(process.argv[limitArg + 1] || 0) : 0;
const daysArg = process.argv.indexOf("--days");
const cooldownDays = daysArg >= 0 ? Math.max(1, Number(process.argv[daysArg + 1] || 7)) : 7;
const supabaseUrl = value(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const serviceRoleKey = value(process.env.LIVE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APRES_SERVICE_ROLE_KEY);
const anonKey = value(process.env.LIVE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
const functionsUrl = value(process.env.SUPABASE_FUNCTIONS_URL)
  || `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error("Supabase URL, service role key and anon key are required.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const parents = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await service
    .from("parent_accounts")
    .select("id,profile_id,full_name,email,portal_status,external_source,marketing_preferences,migration_metadata,archived_at,child_profiles(id,active,migration_metadata)")
    .eq("external_source", "magicbooking")
    .in("portal_status", ["invited", "active"])
    .is("archived_at", null)
    .order("id", { ascending: true })
    .range(from, from + 499);
  if (error) throw error;
  parents.push(...(data || []));
  if ((data || []).length < 500) break;
}

const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
const skipped = { noLogin: 0, completedReview: 0, optedOut: 0, cooldown: 0, missingEmail: 0 };
let eligible = parents.filter((parent) => {
  const preferences = objectValue(parent.marketing_preferences);
  if (!parent.profile_id) {
    skipped.noLogin += 1;
    return false;
  }
  if (preferences.migrationSetupReminders === false) {
    skipped.optedOut += 1;
    return false;
  }
  if (!normalizeEmail(parent.email)) {
    skipped.missingEmail += 1;
    return false;
  }
  if (parent.portal_status === "active" && migrationOutstandingItemCount(parent) === 0) {
    skipped.completedReview += 1;
    return false;
  }
  const lastSentAt = Date.parse(value(preferences.migrationSetupReminderLastSentAt));
  if (!force && Number.isFinite(lastSentAt) && lastSentAt > cutoff) {
    skipped.cooldown += 1;
    return false;
  }
  return true;
});
if (requestedLimit > 0) eligible = eligible.slice(0, requestedLimit);

const preview = {
  mode: runLive ? "live" : "dry-run",
  migratedFamiliesAwaitingActivationOrReview: parents.length,
  eligibleFamilies: eligible.length,
  cooldownDays,
  force,
  skipped,
};
if (!runLive || !eligible.length) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const adminEmail = `migration-reminders-${Date.now()}@apres-school.test`;
const adminPassword = temporaryPassword();
let adminId = "";
const sent = [];
const failures = [];

try {
  const { data: adminData, error: adminError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: "Migration reminder service", role: "superadmin" },
  });
  if (adminError) throw adminError;
  adminId = adminData.user.id;
  const { error: profileError } = await service.from("profiles").upsert({
    id: adminId,
    email: adminEmail,
    full_name: "Migration reminder service",
    role: "superadmin",
    active: true,
    must_change_password: false,
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signInData, error: signInError } = await publicClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (signInError) throw signInError;
  const accessToken = signInData.session?.access_token;
  if (!accessToken) throw new Error("The temporary reminder administrator could not sign in.");

  let consecutiveFailures = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const parent = eligible[index];
    try {
      const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/manage-parent-account`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "send-migration-reminder", parentAccountId: parent.id }),
      });
      const detail = await response.json().catch(() => ({}));
      if (!response.ok || !detail.emailed) throw new Error(value(detail.error || detail.emailError) || `Reminder failed with HTTP ${response.status}.`);
      sent.push({ parentAccountId: parent.id, email: normalizeEmail(parent.email), reminderCount: detail.reminderCount });
      consecutiveFailures = 0;
    } catch (error) {
      failures.push({ parentAccountId: parent.id, email: normalizeEmail(parent.email), reason: error instanceof Error ? error.message : "Reminder failed" });
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) break;
    }
    if ((index + 1) % 25 === 0 || index + 1 === eligible.length) {
      console.error(`Processed ${index + 1}/${eligible.length}: ${sent.length} sent, ${failures.length} failed.`);
    }
  }

  console.log(JSON.stringify({
    ...preview,
    remindersSent: sent.length,
    failures: failures.length,
    failureDetails: failures,
  }, null, 2));
} finally {
  if (adminId) {
    await service.auth.admin.updateUserById(adminId, { password: temporaryPassword(), ban_duration: "876000h" }).catch(() => null);
    await service.from("profiles").update({ active: false }).eq("id", adminId);
  }
}

function temporaryPassword() {
  return `Ap!${randomBytes(18).toString("base64url")}9z`;
}

function objectValue(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function migrationOutstandingItemCount(parent) {
  const parentMetadata = objectValue(parent.migration_metadata);
  const parentMissing = Array.isArray(parentMetadata.missingFields) ? parentMetadata.missingFields.length : 0;
  const childMissing = (parent.child_profiles || []).reduce((total, child) => {
    if (!child || child.active === false) return total;
    const metadata = objectValue(child.migration_metadata);
    return total + (Array.isArray(metadata.missingFields) ? metadata.missingFields.length : 0);
  }, 0);
  return parentMissing + childMissing;
}

function normalizeEmail(input) {
  return value(input).toLowerCase();
}

function value(input) {
  return typeof input === "string" ? input.trim() : "";
}

function parseEnvFile(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const parsedValue = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, parsedValue];
      }),
  );
}

function loadLocalEnvFiles(files) {
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    Object.entries(parsed).forEach(([key, parsedValue]) => {
      if (!process.env[key]) process.env[key] = parsedValue;
    });
  }
}
