import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const runLive = process.argv.includes("--run");
const sourceEmail = normalizeEmail(args.get("--source-email"));
const targetEmail = normalizeEmail(args.get("--target-email"));
const supabaseUrl = stringValue(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const functionsUrl = stringValue(process.env.SUPABASE_FUNCTIONS_URL) || `${supabaseUrl.replace(/\.supabase\.co\/?$/, ".functions.supabase.co")}`;
const serviceRoleKey = stringValue(process.env.LIVE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APRES_SERVICE_ROLE_KEY);
const anonKey = stringValue(process.env.LIVE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);

if (!sourceEmail || !targetEmail) throw new Error("Provide --source-email and --target-email.");
if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error("Supabase URL, service role key and anon key are required.");
if (sourceEmail === targetEmail) throw new Error("Source and target email must be different.");

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let { data: source, error: sourceError } = await service
  .from("parent_accounts")
  .select("id, profile_id, full_name, email, phone, portal_status, external_source, external_id, migration_metadata, child_profiles(id, full_name, external_id, active)")
  .eq("email", sourceEmail)
  .maybeSingle();
if (sourceError) throw sourceError;
if (!source) {
  const { data: reassignedSource, error: reassignedSourceError } = await service
    .from("parent_accounts")
    .select("id, profile_id, full_name, email, phone, portal_status, external_source, external_id, migration_metadata, child_profiles(id, full_name, external_id, active)")
    .contains("migration_metadata", { original_email: sourceEmail })
    .maybeSingle();
  if (reassignedSourceError) throw reassignedSourceError;
  source = reassignedSource;
}
if (!source) throw new Error(`No parent account found for ${sourceEmail}.`);
if (source.external_source !== "magicbooking") throw new Error("Only a Magicbooking import may be reassigned with this script.");

const { data: targetAccount, error: targetError } = await service
  .from("parent_accounts")
  .select("id, email")
  .eq("email", targetEmail)
  .maybeSingle();
if (targetError) throw targetError;
if (targetAccount && targetAccount.id !== source.id) throw new Error(`A different family already uses ${targetEmail}.`);

const { data: targetAuth, error: targetAuthError } = await service
  .rpc("find_auth_user_id_by_email", { p_email: targetEmail })
  .maybeSingle();
if (targetAuthError) throw targetAuthError;
if (targetAuth?.id && targetAuth.id !== source.profile_id) throw new Error(`An existing login already uses ${targetEmail}.`);

const preview = {
  mode: runLive ? "live" : "dry-run",
  parentAccountId: source.id,
  externalParentId: source.external_id,
  parentName: source.full_name,
  sourceEmail,
  targetEmail,
  linkedChildren: (source.child_profiles || []).map((child) => ({
    id: child.id,
    externalChildId: child.external_id,
    name: child.full_name,
  })),
};

if (!runLive) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const temporaryPassword = makeTemporaryPassword();
const temporaryAdminPassword = makeTemporaryPassword();
const temporaryAdminEmail = `migration-invite-${Date.now()}@apres-school.test`;
let temporaryAdminId = "";
let emailChanged = false;

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
  if (!accessToken) throw new Error("Temporary migration administrator could not sign in.");

  const migrationMetadata = {
    ...(source.migration_metadata && typeof source.migration_metadata === "object" ? source.migration_metadata : {}),
    original_email: sourceEmail,
    testing_email_reassigned_at: new Date().toISOString(),
    testing_email_reassigned_to: targetEmail,
  };
  const { error: updateError } = await service
    .from("parent_accounts")
    .update({
      email: targetEmail,
      portal_status: "migration_review",
      migration_metadata: migrationMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", source.id);
  if (updateError) throw updateError;
  emailChanged = true;

  const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/manage-parent-account`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: "invite",
      name: source.full_name,
      email: targetEmail,
      phone: source.phone || "",
      temporaryPassword,
      loginUrl: "https://www.apres-school.co.uk/launch-booking",
      marketingPreferences: {
        imported: true,
        source: "magicbooking",
        externalParentId: source.external_id,
        testingRecord: true,
      },
    }),
  });
  const detail = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(detail.error || `Parent invitation failed with HTTP ${response.status}.`);

  const { data: verified, error: verifyError } = await service
    .from("parent_accounts")
    .select("id, profile_id, full_name, email, phone, portal_status, external_id, child_profiles(id, full_name, external_id, active)")
    .eq("id", source.id)
    .single();
  if (verifyError) throw verifyError;
  if (verified.email !== targetEmail) throw new Error("The family email reassignment did not persist.");
  if ((verified.child_profiles || []).length !== (source.child_profiles || []).length) {
    throw new Error("The family child links changed during reassignment.");
  }

  console.log(JSON.stringify({
    ...preview,
    status: "invited",
    emailed: Boolean(detail.emailed),
    emailStatus: detail.emailed ? "sent" : detail.emailError || "not sent",
    portalStatus: verified.portal_status,
    profileLinked: Boolean(verified.profile_id),
    childLinksPreserved: true,
  }, null, 2));
} catch (error) {
  if (emailChanged) {
    console.error(`The family email was changed to ${targetEmail}, but invitation completion failed.`);
  }
  throw error;
} finally {
  if (temporaryAdminId) {
    await service.auth.admin.deleteUser(temporaryAdminId).catch(() => null);
  }
}

function normalizeEmail(value) {
  return stringValue(value).toLowerCase();
}

function stringValue(value) {
  return String(value || "").trim();
}

function makeTemporaryPassword() {
  return `Ap!9${randomBytes(12).toString("base64url")}`;
}
