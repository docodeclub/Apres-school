import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const args = new Set(process.argv.slice(2));
const runLive = args.has("--run");
const jsonOnly = args.has("--json");
const rehearsalMode = clean(process.env.BOOKING_PARENT_ACCOUNT_REHEARSAL);
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL) || (projectRef ? `https://${projectRef}.supabase.co` : "");
const anonKey = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.VITE_SUPABASE_ANON_KEY);
const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY) || clean(process.env.APRES_SERVICE_ROLE_KEY);
const adminEmail = clean(process.env.APRES_REHEARSAL_ADMIN_EMAIL) || "admin-account-rehearsal@apres-school.test";
const parentEmail = clean(process.env.APRES_REHEARSAL_PARENT_EMAIL) || "parent-account-rehearsal@apres-school.test";
const parentName = clean(process.env.APRES_REHEARSAL_PARENT_NAME) || "Parent Account Rehearsal";
const adminPassword = clean(process.env.APRES_REHEARSAL_ADMIN_PASSWORD) || generatePassword("Admin");
const temporaryPassword = clean(process.env.APRES_REHEARSAL_PARENT_PASSWORD) || generatePassword("Parent");
const loginUrl = clean(process.env.PARENT_PORTAL_URL) || "https://www.apres-school.co.uk/booking-lab";

const missing = [];
if (!supabaseUrl) missing.push("VITE_SUPABASE_URL or SUPABASE_PROJECT_REF");
if (!functionsUrl) missing.push("SUPABASE_FUNCTIONS_URL or SUPABASE_PROJECT_REF");
if (!anonKey) missing.push("SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY");
if (!serviceRoleKey) missing.push("APRES_SERVICE_ROLE_KEY");
if (runLive && rehearsalMode !== "live") missing.push("BOOKING_PARENT_ACCOUNT_REHEARSAL=live");

const report = {
  parentAccountRehearsalReady: missing.length === 0,
  ranLive: runLive,
  loadedEnvFiles,
  functionsUrl: functionsUrl || null,
  supabaseUrl: supabaseUrl || null,
  guarded: true,
  guard: {
    runFlag: runLive,
    rehearsalMode: rehearsalMode || "missing",
  },
  requestSummary: {
    adminEmail,
    parentEmail,
    action: "invite",
    loginUrl,
  },
  steps: [],
  missing,
  next: [],
};

if (!runLive) {
  report.next.push("Dry run only. Set BOOKING_PARENT_ACCOUNT_REHEARSAL=live and rerun with --run.");
} else if (missing.length) {
  report.next.push(`Set missing rehearsal values: ${missing.join(", ")}.`);
} else {
  if (serviceRoleKey.startsWith("eyJ")) {
    report.steps.push({
      step: "local_service_role_key",
      ok: false,
      detail: "local .env uses a legacy JWT-style service key; refresh it from Supabase before local admin rehearsals",
    });
    report.parentAccountRehearsalReady = false;
    report.next.push("Refresh APRES_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY in local staging env, or run this from an environment with the current Supabase secret key.");
  } else {
  await runParentAccountRehearsal(report);
  }
}

if (!report.next.length) {
  report.next.push(report.parentAccountRehearsalReady ? "Parent account rehearsal completed; test the portal UI with the created parent account next." : "Resolve parent account rehearsal blockers before inviting real parents.");
}

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (runLive && !report.parentAccountRehearsalReady) process.exitCode = 1;

async function runParentAccountRehearsal(data) {
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const adminUser = await createOrUpdateAuthUser(serviceClient, {
      email: adminEmail,
      password: adminPassword,
      role: "admin",
      fullName: "Parent Account Rehearsal Admin",
    });
    data.steps.push({ step: "admin_auth_user", ok: Boolean(adminUser?.id), detail: "stable rehearsal admin ready" });

    await upsertProfile(serviceClient, {
      id: adminUser.id,
      email: adminEmail,
      role: "admin",
      fullName: "Parent Account Rehearsal Admin",
    });
    data.steps.push({ step: "admin_profile", ok: true, detail: "admin profile ready" });

    const { data: adminSession, error: signInError } = await publicClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });
    if (signInError) throw signInError;
    const adminToken = adminSession?.session?.access_token;
    if (!adminToken) throw new Error("Admin sign-in did not return an access token");
    data.steps.push({ step: "admin_sign_in", ok: true, detail: "admin JWT issued" });

    const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/manage-parent-account`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": anonKey,
        "authorization": `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        action: "invite",
        name: parentName,
        email: parentEmail,
        phone: "020 0000 0000",
        temporaryPassword,
        loginUrl,
        marketingPreferences: { rehearsal: true },
      }),
    });
    const functionDetail = await safeJsonOrText(response);
    if (!response.ok) throw new Error(`manage-parent-account failed with ${response.status}: ${summariseDetail(functionDetail)}`);
    data.steps.push({
      step: "manage_parent_account",
      ok: true,
      detail: {
        parentAccountId: functionDetail?.parentAccountId || "",
        userId: functionDetail?.userId || "",
        emailed: Boolean(functionDetail?.emailed),
        emailStatus: functionDetail?.emailed ? "sent" : functionDetail?.emailError ? "failed" : "not configured",
      },
    });

    const parentClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: parentSession, error: parentSignInError } = await parentClient.auth.signInWithPassword({
      email: parentEmail,
      password: temporaryPassword,
    });
    if (parentSignInError) throw parentSignInError;
    data.steps.push({ step: "parent_sign_in", ok: Boolean(parentSession?.user?.id), detail: "parent can sign in with temporary password" });

    const { data: parentAccount, error: accountError } = await parentClient
      .from("parent_accounts")
      .select("id, email, portal_status, profile_id")
      .eq("email", parentEmail)
      .maybeSingle();
    if (accountError) throw accountError;
    data.steps.push({
      step: "parent_account_rls",
      ok: Boolean(parentAccount?.id),
      detail: parentAccount ? { parentAccountId: parentAccount.id, portalStatus: parentAccount.portal_status || "" } : "parent account not visible",
    });

    data.parentAccountRehearsalReady = data.steps.every((step) => step.ok);
  } catch (error) {
    data.parentAccountRehearsalReady = false;
    data.steps.push({
      step: "error",
      ok: false,
      detail: error instanceof Error ? error.message : "Parent account rehearsal failed",
    });
    data.next.push("Parent account rehearsal failed; check deployed function secrets, profiles role data, and parent account migrations.");
  }
}

async function createOrUpdateAuthUser(client, payload) {
  const existing = await findAuthUserByEmail(client, payload.email);
  const attributes = {
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { full_name: payload.fullName, role: payload.role },
  };

  if (existing) {
    const { data, error } = await client.auth.admin.updateUserById(existing.id, attributes);
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await client.auth.admin.createUser(attributes);
  if (error) throw error;
  return data.user;
}

async function findAuthUserByEmail(client, email) {
  const targetEmail = email.toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail);
    if (found) return found;
    if (data.users.length < 1000) break;
    page += 1;
  }
  return null;
}

async function upsertProfile(client, payload) {
  const { error } = await client
    .from("profiles")
    .upsert({
      id: payload.id,
      email: payload.email,
      full_name: payload.fullName,
      role: payload.role,
      active: true,
    }, { onConflict: "id" });
  if (error) throw error;
}

async function safeJsonOrText(response) {
  const text = await response.text();
  if (!text) return "";
  try {
    return redactResponse(JSON.parse(text));
  } catch {
    return text.slice(0, 1000);
  }
}

function redactResponse(value) {
  if (Array.isArray(value)) return value.map(redactResponse);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/password|token|secret|key|authorization|signature/i.test(key)) return [key, "redacted"];
    return [key, redactResponse(item)];
  }));
}

function summariseDetail(detail) {
  if (typeof detail === "string") return detail;
  if (detail?.error) return detail.error;
  return JSON.stringify(detail);
}

function generatePassword(prefix) {
  return `Apres-${prefix}-${new Date().toISOString().slice(0, 10)}!`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
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
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

function loadLocalEnvFiles(files) {
  const loaded = [];
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    Object.entries(parsed).forEach(([key, value]) => {
      if (!process.env[key]) process.env[key] = value;
    });
    loaded.push(file);
  }
  return loaded;
}

function printHumanReport(data) {
  console.log(`Parent account rehearsal: ${data.parentAccountRehearsalReady ? "READY" : "OPEN ITEMS"}${data.ranLive ? "" : " (dry run)"}`);
  console.log(`Endpoint: ${data.functionsUrl ? `${data.functionsUrl.replace(/\/$/, "")}/manage-parent-account` : "missing"}`);
  console.log(`Guard: ${data.guard.runFlag ? "--run" : "dry"} / ${data.guard.rehearsalMode}`);
  console.log(`Admin: ${data.requestSummary.adminEmail}`);
  console.log(`Parent: ${data.requestSummary.parentEmail}`);
  data.steps.forEach((step) => console.log(`- ${step.ok ? "OK" : "FAIL"} ${step.step}: ${typeof step.detail === "string" ? step.detail : JSON.stringify(step.detail)}`));
  console.log("");
  console.log("Next:");
  data.next.forEach((item) => console.log(`- ${item}`));
}
