import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
const runLive = args.has("--run");
const inviteRemaining = args.has("--remaining");
const cohortPath = value(args.get("--cohort-csv"));
const requestedLimit = Number(args.get("--limit") || 0);
const supabaseUrl = value(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const functionsUrl = value(process.env.SUPABASE_FUNCTIONS_URL)
  || `${supabaseUrl.replace(/\.supabase\.co\/?$/, ".functions.supabase.co")}`;
const serviceRoleKey = value(
  process.env.LIVE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.APRES_SERVICE_ROLE_KEY,
);
const anonKey = value(
  process.env.LIVE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY,
);

if (!cohortPath && !inviteRemaining) throw new Error("Provide --cohort-csv or --remaining.");
if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error("Supabase URL, service role key and anon key are required.");
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sourceRows = inviteRemaining
  ? await loadRemainingCohort(service)
  : parseCsv(readFileSync(cohortPath, "utf8"));
let rows = requestedLimit > 0 ? sourceRows.slice(0, requestedLimit) : sourceRows;
if (!rows.length && !inviteRemaining) throw new Error("The invitation cohort is empty.");
if (new Set(rows.map((row) => row.parent_account_id)).size !== rows.length) {
  throw new Error("The invitation cohort contains duplicate parent accounts.");
}
const emailCounts = new Map();
for (const row of rows) {
  const email = normalizeEmail(row.email);
  emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
}
const duplicateEmailAccounts = rows.filter((row) => (emailCounts.get(normalizeEmail(row.email)) || 0) > 1);
if (!inviteRemaining && duplicateEmailAccounts.length) {
  throw new Error("The invitation cohort contains duplicate email addresses.");
}
if (inviteRemaining) {
  rows = rows.filter((row) => (emailCounts.get(normalizeEmail(row.email)) || 0) === 1);
}

const parentAccounts = [];
for (const batch of chunks(rows.map((row) => row.parent_account_id), 75)) {
  const { data, error } = await service
    .from("parent_accounts")
    .select("id,profile_id,full_name,email,phone,portal_status,external_source,external_id,marketing_preferences,child_profiles(id,external_id,active)")
    .in("id", batch);
  if (error) throw error;
  parentAccounts.push(...(data || []));
}
const parentById = new Map(parentAccounts.map((parent) => [parent.id, parent]));

const { data: unresolvedHealth, error: healthError } = await service
  .from("migration_health_review_items")
  .select("external_parent_id")
  .eq("external_source", "magicbooking")
  .neq("status", "resolved");
if (healthError) throw healthError;
const blockedExternalIds = new Set((unresolvedHealth || []).map((item) => value(item.external_parent_id)));

const existingAuthEmails = new Set();
for (const batch of chunks(rows, 10)) {
  const matches = await Promise.all(batch.map(async (row) => {
    const { data, error } = await service
      .rpc("find_auth_user_id_by_email", { p_email: normalizeEmail(row.email) })
      .maybeSingle();
    if (error) throw error;
    return data?.id ? normalizeEmail(row.email) : "";
  }));
  for (const email of matches) if (email) existingAuthEmails.add(email);
}

const skipped = {
  duplicateEmailAccounts: duplicateEmailAccounts.length,
  missingParent: 0,
  identityMismatch: 0,
  emailMismatch: 0,
  alreadyActivatedOrInvited: 0,
  existingAuthenticationUser: 0,
  unresolvedMedicalReview: 0,
  noActiveChild: 0,
  childCountMismatch: 0,
};
if (inviteRemaining) {
  rows = rows.filter((row) => {
    const parent = parentById.get(row.parent_account_id);
    if (!parent) {
      skipped.missingParent += 1;
      return false;
    }
    if (parent.external_source !== "magicbooking" || value(parent.external_id) !== value(row.external_parent_id)) {
      skipped.identityMismatch += 1;
      return false;
    }
    if (normalizeEmail(parent.email) !== normalizeEmail(row.email)) {
      skipped.emailMismatch += 1;
      return false;
    }
    if (parent.profile_id || parent.portal_status !== "migration_review") {
      skipped.alreadyActivatedOrInvited += 1;
      return false;
    }
    if (existingAuthEmails.has(normalizeEmail(row.email))) {
      skipped.existingAuthenticationUser += 1;
      return false;
    }
    if (blockedExternalIds.has(value(parent.external_id))) {
      skipped.unresolvedMedicalReview += 1;
      return false;
    }
    if (!(parent.child_profiles || []).some((child) => child.active)) {
      skipped.noActiveChild += 1;
      return false;
    }
    if (Number(row.child_count) !== (parent.child_profiles || []).length) {
      skipped.childCountMismatch += 1;
      return false;
    }
    return true;
  });
}

for (const row of rows) {
  const parent = parentById.get(row.parent_account_id);
  if (!parent) throw new Error(`Cohort parent ${row.external_parent_id} is missing from the live database.`);
  if (parent.external_source !== "magicbooking" || value(parent.external_id) !== value(row.external_parent_id)) {
    throw new Error(`Cohort parent ${row.external_parent_id} does not match the imported identity.`);
  }
  if (normalizeEmail(parent.email) !== normalizeEmail(row.email)) {
    throw new Error(`Cohort parent ${row.external_parent_id} has a different live email address.`);
  }
  if (parent.profile_id || parent.portal_status !== "migration_review") {
    throw new Error(`Cohort parent ${row.external_parent_id} is already activated or invited.`);
  }
  if (existingAuthEmails.has(normalizeEmail(row.email))) {
    throw new Error(`Cohort parent ${row.external_parent_id} already has an authentication user.`);
  }
  if (blockedExternalIds.has(value(parent.external_id))) {
    throw new Error(`Cohort parent ${row.external_parent_id} has an unresolved medical safety review.`);
  }
  if (!(parent.child_profiles || []).some((child) => child.active)) {
    throw new Error(`Cohort parent ${row.external_parent_id} has no active child.`);
  }
  if (Number(row.child_count) !== (parent.child_profiles || []).length) {
    throw new Error(`Cohort parent ${row.external_parent_id} has a different live child count.`);
  }
}

const preview = {
  mode: runLive ? "live" : "dry-run",
  source: inviteRemaining ? "remaining-imported-parents" : "cohort-csv",
  candidateFamilies: sourceRows.length,
  requestedFamilies: rows.length,
  skippedFamilies: Object.values(skipped).reduce((total, count) => total + count, 0),
  skipped,
  preflightPassed: true,
  emailsSent: 0,
};
if (!runLive) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const temporaryAdminEmail = `migration-cohort-${Date.now()}@apres-school.test`;
const temporaryAdminPassword = makeTemporaryPassword();
let temporaryAdminId = "";
const sent = [];
const failures = [];
let consecutiveFailures = 0;

try {
  const { data: adminData, error: adminError } = await service.auth.admin.createUser({
    email: temporaryAdminEmail,
    password: temporaryAdminPassword,
    email_confirm: true,
    user_metadata: { full_name: "Migration invitation service", role: "superadmin" },
  });
  if (adminError) throw adminError;
  temporaryAdminId = adminData.user.id;

  const { error: profileError } = await service.from("profiles").upsert({
    id: temporaryAdminId,
    email: temporaryAdminEmail,
    full_name: "Migration invitation service",
    role: "superadmin",
    active: true,
    must_change_password: false,
  }, { onConflict: "id" });
  if (profileError) throw profileError;

  const publicClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signInData, error: signInError } = await publicClient.auth.signInWithPassword({
    email: temporaryAdminEmail,
    password: temporaryAdminPassword,
  });
  if (signInError) throw signInError;
  const accessToken = signInData.session?.access_token;
  if (!accessToken) throw new Error("The temporary migration administrator could not sign in.");

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const parent = parentById.get(row.parent_account_id);
    let createdUserId = "";
    try {
      const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/manage-parent-account`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: anonKey,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "invite",
          name: parent.full_name,
          email: parent.email,
          phone: parent.phone || "",
          temporaryPassword: makeTemporaryPassword(),
          loginUrl: "https://www.apres-school.co.uk/launch-booking",
          marketingPreferences: {
            ...(parent.marketing_preferences && typeof parent.marketing_preferences === "object"
              ? parent.marketing_preferences
              : {}),
            imported: true,
            source: "magicbooking",
            externalParentId: parent.external_id,
          },
        }),
      });
      const detail = await response.json().catch(() => ({}));
      createdUserId = value(detail.userId);
      if (!response.ok) throw new Error(value(detail.error) || `Invitation failed with HTTP ${response.status}.`);
      if (!detail.emailed) throw new Error(value(detail.emailError) || "The invitation email was not sent.");
      sent.push({
        parentAccountId: parent.id,
        externalParentId: parent.external_id,
        email: normalizeEmail(parent.email),
        childIds: (parent.child_profiles || []).map((child) => child.id).sort(),
      });
      consecutiveFailures = 0;
    } catch (error) {
      await rollbackPartialInvite(service, parent, createdUserId);
      failures.push({
        externalParentId: parent.external_id,
        reason: error instanceof Error ? error.message : "Invitation failed",
      });
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) break;
    }
    if ((index + 1) % 10 === 0) {
      console.error(`Processed ${index + 1}/${rows.length}: ${sent.length} sent, ${failures.length} failed.`);
    }
  }

  const verifiedParents = [];
  for (const batch of chunks(sent.map((item) => item.parentAccountId), 75)) {
    const { data, error } = await service
      .from("parent_accounts")
      .select("id,profile_id,portal_status,child_profiles(id)")
      .in("id", batch);
    if (error) throw error;
    verifiedParents.push(...(data || []));
  }
  const verifiedById = new Map(verifiedParents.map((parent) => [parent.id, parent]));
  const accountsVerified = sent.every((item) => {
    const parent = verifiedById.get(item.parentAccountId);
    const childIds = (parent?.child_profiles || []).map((child) => child.id).sort();
    return Boolean(parent?.profile_id)
      && parent.portal_status === "invited"
      && JSON.stringify(childIds) === JSON.stringify(item.childIds);
  });

  const recentEmailLogs = [];
  for (const batch of chunks(sent.map((item) => item.email), 75)) {
    const { data, error } = await service
      .from("email_logs")
      .select("recipient_email,status,email_type,created_at")
      .eq("email_type", "parent_migration_invite")
      .gte("created_at", startedAt)
      .in("recipient_email", batch);
    if (error) throw error;
    recentEmailLogs.push(...(data || []));
  }
  const loggedSentEmails = new Set(
    recentEmailLogs
      .filter((log) => log.status === "sent")
      .map((log) => normalizeEmail(log.recipient_email)),
  );
  const emailLogsVerified = sent.every((item) => loggedSentEmails.has(item.email));

  console.log(JSON.stringify({
    ...preview,
    processedFamilies: sent.length + failures.length,
    invitationsSent: sent.length,
    failures: failures.length,
    failureDetails: failures,
    stoppedAfterSystemicFailures: consecutiveFailures >= 3,
    accountsVerified,
    emailLogsVerified,
    childLinksPreserved: accountsVerified,
  }, null, 2));
} finally {
  if (temporaryAdminId) {
    await service.auth.admin.updateUserById(temporaryAdminId, {
      password: makeTemporaryPassword(),
      ban_duration: "876000h",
    }).catch(() => null);
    await service
      .from("profiles")
      .update({ active: false, must_change_password: false })
      .eq("id", temporaryAdminId);
  }
}

async function rollbackPartialInvite(client, originalParent, createdUserId) {
  let userId = createdUserId;
  if (!userId) {
    const { data } = await client
      .from("parent_accounts")
      .select("profile_id")
      .eq("id", originalParent.id)
      .maybeSingle();
    userId = value(data?.profile_id);
  }
  if (userId) await client.auth.admin.deleteUser(userId).catch(() => null);
  await client
    .from("parent_accounts")
    .update({
      profile_id: null,
      portal_status: "migration_review",
      marketing_preferences: originalParent.marketing_preferences || {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", originalParent.id);
}

function parseArgs(tokens) {
  const parsed = new Map();
  const booleanFlags = new Set(["--run", "--remaining"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    if (booleanFlags.has(token)) parsed.set(token, true);
    else {
      parsed.set(token, tokens[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

async function loadRemainingCohort(client) {
  const parents = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("parent_accounts")
      .select("id,email,external_id,child_profiles(id,active)")
      .eq("external_source", "magicbooking")
      .eq("portal_status", "migration_review")
      .is("profile_id", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    parents.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return parents.map((parent) => ({
    parent_account_id: parent.id,
    external_parent_id: parent.external_id,
    email: normalizeEmail(parent.email),
    child_count: String((parent.child_profiles || []).length),
  }));
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  const [headers, ...data] = records.filter((record) => record.some((cell) => cell !== ""));
  return data.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizeEmail(input) {
  return value(input).toLowerCase();
}

function value(input) {
  return String(input ?? "").trim();
}

function makeTemporaryPassword() {
  return `Ap!9${randomBytes(12).toString("base64url")}`;
}
