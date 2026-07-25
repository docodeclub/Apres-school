import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const env = loadEnv([".env.staging", ".env.local"]);
const url = env.VITE_SUPABASE_URL;
const projectRef = env.SUPABASE_PROJECT_REF;
const projectKeys = readProjectKeys(projectRef);
const anonKey = projectKeys.find((item) => item.name === "anon")?.api_key
  || env.VITE_SUPABASE_ANON_KEY
  || env.SUPABASE_ANON_KEY;
const serviceRoleKey = projectKeys.find((item) => item.name === "service_role")?.api_key;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error("Staging Supabase configuration is incomplete.");
}

const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stamp = Date.now();
const password = `Tmp-${randomBytes(18).toString("base64url")}!9`;
const identities = [
  {
    role: "staff",
    email: `codex-safeguarding-staff-${stamp}@example.invalid`,
    name: "Codex Safeguarding Staff Test",
  },
  {
    role: "superadmin",
    email: `codex-safeguarding-dsl-${stamp}@example.invalid`,
    name: "Codex Safeguarding DSL Test",
  },
];
const createdUserIds = [];
const report = { temporaryUsersRemoved: false, checks: {} };

try {
  for (const identity of identities) {
    const { data, error } = await service.auth.admin.createUser({
      email: identity.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: identity.name },
    });
    if (error) throw error;
    createdUserIds.push(data.user.id);
    identity.id = data.user.id;

    const { error: profileError } = await service.from("profiles").upsert({
      id: data.user.id,
      email: identity.email,
      full_name: identity.name,
      role: identity.role,
      active: true,
    }, { onConflict: "id" });
    if (profileError) throw profileError;
  }

  const staffClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const dslClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staffSignIn = await staffClient.auth.signInWithPassword({
    email: identities[0].email,
    password,
  });
  const dslSignIn = await dslClient.auth.signInWithPassword({
    email: identities[1].email,
    password,
  });
  if (staffSignIn.error) throw staffSignIn.error;
  if (dslSignIn.error) throw dslSignIn.error;

  const staffDsl = await staffClient.rpc("is_safeguarding_dsl");
  const dslDsl = await dslClient.rpc("is_safeguarding_dsl");
  const staffRestrictedList = await staffClient.rpc("list_safeguarding_cases", { p_limit: 10 });
  const staffOwnList = await staffClient.rpc("list_my_safeguarding_submissions", { p_limit: 10 });
  const staffDirect = await staffClient.from("safeguarding_cases").select("id").limit(5);
  const dslRestrictedList = await dslClient.rpc("list_safeguarding_cases", { p_limit: 10 });
  const staffSubmissionProbe = await staffClient.rpc("create_safeguarding_concern", {
    p_booking_item_id: "00000000-0000-0000-0000-000000000001",
    p_child_safe_now: true,
    p_concern_source: "Observed",
    p_categories: ["Other"],
    p_factual_account: "Permission probe only; no record should be created.",
    p_immediate_action: "No action because this is a nonexistent booking permission probe.",
    p_witnesses: {},
    p_dsl_informed: false,
    p_dsl_informed_who: null,
    p_dsl_informed_at: null,
    p_occurred_at: new Date().toISOString(),
  });
  const staffAppend = await staffClient.rpc("append_safeguarding_case_entry", {
    p_case_id: "00000000-0000-0000-0000-000000000001",
    p_entry_type: "Case note",
    p_content: "Permission probe only",
  });

  const visibleCaseId = Array.isArray(dslRestrictedList.data)
    ? dslRestrictedList.data[0]?.id
    : null;
  let crossCaseDenied = null;
  let dslDetailReadable = null;
  if (visibleCaseId) {
    const crossCase = await staffClient.rpc("get_safeguarding_case", {
      p_case_id: visibleCaseId,
    });
    const dslDetail = await dslClient.rpc("get_safeguarding_case", {
      p_case_id: visibleCaseId,
    });
    crossCaseDenied = crossCase.error?.code === "42501";
    dslDetailReadable = !dslDetail.error && dslDetail.data?.id === visibleCaseId;
  }

  report.checks = {
    staffDslFalse: staffDsl.error == null && staffDsl.data === false,
    superadminDslTrue: dslDsl.error == null && dslDsl.data === true,
    staffRestrictedListDenied: staffRestrictedList.error?.code === "42501",
    staffOwnSubmissionListAllowed: staffOwnList.error == null && Array.isArray(staffOwnList.data),
    staffDirectTableBlocked: staffDirect.error != null
      || (Array.isArray(staffDirect.data) && staffDirect.data.length === 0),
    superadminRestrictedListAllowed: dslRestrictedList.error == null
      && Array.isArray(dslRestrictedList.data),
    staffSubmissionRouteAllowed: staffSubmissionProbe.error?.code === "22023",
    staffChronologyWriteDenied: staffAppend.error?.code === "42501",
    crossCaseDenied,
    dslDetailReadable,
    existingCaseAvailableForDetailProbe: Boolean(visibleCaseId),
  };
  report.passed = Object.entries(report.checks)
    .filter(([key, value]) => !key.includes("existingCase") && value !== null)
    .every(([, value]) => value === true);

  await staffClient.auth.signOut();
  await dslClient.auth.signOut();
} finally {
  for (const userId of createdUserIds.reverse()) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) report.cleanupError = true;
  }
  report.temporaryUsersRemoved = !report.cleanupError;
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed || !report.temporaryUsersRemoved) process.exitCode = 1;

function loadEnv(files) {
  const values = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      if (key in values) continue;
      values[key] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return values;
}

function readProjectKeys(projectRef) {
  if (!projectRef) return [];
  const result = spawnSync(
    "node_modules/.bin/supabase",
    ["projects", "api-keys", "--project-ref", projectRef, "--output", "json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: [process.execPath.slice(0, process.execPath.lastIndexOf("/")), process.env.PATH]
          .filter(Boolean)
          .join(":"),
      },
    },
  );
  if (result.status !== 0) {
    throw new Error("The staging project API keys could not be read through the authenticated Supabase CLI.");
  }
  return JSON.parse(result.stdout || "[]");
}
