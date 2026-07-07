import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const applySecrets = args.has("--apply-secrets") || args.has("--all");
const pushDb = args.has("--push-db") || args.has("--all");
const deployFunctions = args.has("--deploy-functions") || args.has("--all");
const yes = args.has("--yes");
const allowPublicTarget = args.has("--allow-public-target");
const dryRun = !applySecrets && !pushDb && !deployFunctions;
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const stagingTarget = clean(process.env.BOOKING_STAGING_TARGET).toLowerCase();
const hiddenStagingProtected = stagingTarget === "hidden";

const requiredSecretKeys = [
  "APRES_SERVICE_ROLE_KEY",
  "PONCHOPAY_API_URL",
  "PONCHOPAY_CHECKOUT_PATH",
  "PONCHOPAY_INTEGRATION_KEY",
  "PONCHOPAY_PROCESSOR_TOKEN",
];

const optionalSecretKeys = [
  "PUBLIC_SITE_URL",
  "STAFF_LOGIN_URL",
  "RESEND_API_KEY",
  "APRES_EMAIL_FROM",
  "APRES_STAFF_EMAIL_FROM",
  "APRES_REPLY_TO",
  "ENQUIRY_NOTIFICATION_TO",
  "OPERATIONS_NOTIFICATION_TO",
];

const frontendKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_BOOKING_PREVIEW_TOKEN"];
const functionDeploys = [
  ["create-parent-booking", false],
  ["update-parent-booking", false],
  ["ponchopay-create-checkout", false],
  ["ponchopay-callback", true],
  ["ponchopay-process-events", false],
  ["notify-public-enquiry", true],
  ["notify-cover-move", false],
  ["manage-staff-account", false],
];

const secretKeysToApply = [...requiredSecretKeys, ...optionalSecretKeys].filter((key) => clean(process.env[key]));
const missingRequiredSecrets = requiredSecretKeys.filter((key) => !clean(process.env[key]));
const missingFrontend = frontendKeys.filter((key) => !clean(process.env[key]));
const missingFunctions = functionDeploys
  .map(([name]) => name)
  .filter((name) => !existsSync(join(root, "supabase", "functions", name, "index.ts")));
const cli = findSupabaseCli();
const envValidation = runEnvValidation();

const report = {
  ok: envValidation.valid && Boolean(projectRef) && !missingRequiredSecrets.length && !missingFrontend.length && !missingFunctions.length && Boolean(cli),
  dryRun,
  loadedEnvFiles,
  projectRef: projectRef || null,
  functionsUrl: functionsUrl || null,
  supabaseCli: cli || null,
  stagingGuard: {
    target: stagingTarget || "missing",
    protected: hiddenStagingProtected,
    allowPublicTarget,
    publicSiteUrl: clean(process.env.PUBLIC_SITE_URL) || null,
  },
  envValidation,
  secrets: {
    requiredReady: `${requiredSecretKeys.length - missingRequiredSecrets.length}/${requiredSecretKeys.length}`,
    optionalReady: `${optionalSecretKeys.filter((key) => clean(process.env[key])).length}/${optionalSecretKeys.length}`,
    willApply: secretKeysToApply.map((key) => ({ key, value: redact(process.env[key]) })),
    missingRequired: missingRequiredSecrets,
  },
  frontendEnv: frontendKeys.map((key) => ({
    key,
    present: Boolean(clean(process.env[key])),
    value: redact(process.env[key]),
    destination: "Hidden staging frontend/Vercel env, not Supabase secrets",
  })),
  functions: functionDeploys.map(([name, noVerifyJwt]) => ({
    name,
    noVerifyJwt,
    present: !missingFunctions.includes(name),
    command: `supabase functions deploy ${name}${noVerifyJwt ? " --no-verify-jwt" : ""}`,
    url: functionsUrl ? `${functionsUrl}/${name}` : null,
  })),
  callbackUrls: [
    "payment-captured",
    "payment-reported-complete",
    "payment-completed",
    "payment-in-bank",
    "payment-refunded",
    "payment-cancelled",
    "payment-updated",
  ].map((slug) => ({
    event: slug.replace(/-/g, "_"),
    url: functionsUrl ? `${functionsUrl}/ponchopay-callback/${slug}` : null,
  })),
  next: [],
};

if (!loadedEnvFiles.length) report.next.push("Create .env.staging from .env.staging.example and paste the staging values.");
if (!envValidation.valid) report.next.push(`Fix invalid staging env values: ${envValidation.invalid.map((item) => item.key).join(", ")}.`);
if (!projectRef) report.next.push("Set SUPABASE_PROJECT_REF before applying migrations, functions or secrets.");
if (!cli) report.next.push("Install dependencies so node_modules/.bin/supabase is available.");
if (missingRequiredSecrets.length) report.next.push(`Set required secrets in .env.staging: ${missingRequiredSecrets.join(", ")}.`);
if (missingFrontend.length) report.next.push(`Set hidden staging frontend env in .env.staging: ${missingFrontend.join(", ")}.`);
if (missingFunctions.length) report.next.push(`Restore missing functions: ${missingFunctions.join(", ")}.`);
if (!hiddenStagingProtected && !allowPublicTarget) report.next.push("Set BOOKING_STAGING_TARGET=hidden before making real staging changes.");
if (dryRun) report.next.push("Dry run only. Pass --apply-secrets, --push-db, --deploy-functions or --all --yes when staging values are ready.");

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (!dryRun && !yes) {
  fail("Refusing to change Supabase without --yes. Re-run with --yes after reviewing the dry-run output.");
}

if (!dryRun && !hiddenStagingProtected && !allowPublicTarget) {
  fail("Refusing to change Supabase because BOOKING_STAGING_TARGET is not 'hidden'. Set it for the hidden rehearsal, or pass --allow-public-target deliberately.");
}

if (!dryRun && !envValidation.valid) {
  fail(`Refusing to change Supabase because staging env values are invalid: ${envValidation.invalid.map((item) => item.key).join(", ")}.`);
}

if ((applySecrets || pushDb || deployFunctions) && !projectRef) {
  fail("SUPABASE_PROJECT_REF is required before applying staging changes.");
}

if ((applySecrets || pushDb || deployFunctions) && !cli) {
  fail("Supabase CLI was not found. Run the project install first.");
}

if (applySecrets) applySupabaseSecrets(secretKeysToApply);
if (pushDb) {
  runSupabase(["link", "--project-ref", projectRef], "Linking Supabase staging project");
  runSupabase(["db", "push"], "Pushing staging database migrations");
}
if (deployFunctions) {
  functionDeploys.forEach(([name, noVerifyJwt]) => {
    const command = ["functions", "deploy", name, "--project-ref", projectRef];
    if (noVerifyJwt) command.push("--no-verify-jwt");
    runSupabase(command, `Deploying ${name}`);
  });
}

function applySupabaseSecrets(keys) {
  if (missingRequiredSecrets.length) {
    fail(`Required secrets are missing: ${missingRequiredSecrets.join(", ")}.`);
  }
  if (!keys.length) fail("No Supabase secrets are present to apply.");

  const tempDir = mkdtempSync(join(tmpdir(), "apres-staging-secrets-"));
  const envPath = join(tempDir, "secrets.env");
  try {
    writeFileSync(envPath, keys.map((key) => `${key}=${quoteEnvValue(process.env[key])}`).join("\n"), { mode: 0o600 });
    runSupabase(["secrets", "set", "--project-ref", projectRef, "--env-file", envPath], `Applying ${keys.length} Supabase secrets`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runSupabase(command, label) {
  console.log(`${label}...`);
  const result = spawnSync(cli, command, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(":") },
  });
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${label} failed.`);
  }
}

function findSupabaseCli() {
  const candidates = ["node_modules/.bin/supabase", "supabase"];
  const pathWithCurrentNode = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(":");
  for (const command of candidates) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      env: { ...process.env, PATH: pathWithCurrentNode },
    });
    if (result.status === 0) return command;
  }
  return "";
}

function runEnvValidation() {
  const result = spawnSync(process.execPath, ["scripts/booking-staging-env-check.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return {
      valid: parsed.stagingEnvValid === true,
      present: parsed.present || "0/0",
      invalid: parsed.invalid || [],
    };
  } catch {
    return {
      valid: false,
      present: "unknown",
      invalid: [{ key: "booking-staging-env-check", detail: result.stderr || "Could not parse env validation output." }],
    };
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function quoteEnvValue(value) {
  return JSON.stringify(String(value ?? ""));
}

function redact(value) {
  const text = clean(value);
  if (!text) return "missing";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.length <= 8) return "configured";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
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
  console.log(`Booking staging apply: ${data.ok ? "READY" : "OPEN ITEMS"}${data.dryRun ? " (dry run)" : ""}`);
  console.log(`Loaded env files: ${data.loadedEnvFiles.length ? data.loadedEnvFiles.join(", ") : "none"}`);
  console.log(`Project ref: ${data.projectRef || "missing"}`);
  console.log(`Functions URL: ${data.functionsUrl || "missing"}`);
  console.log(`Supabase CLI: ${data.supabaseCli || "missing"}`);
  console.log(`Staging guard: ${data.stagingGuard.protected ? "hidden" : data.stagingGuard.target}${data.stagingGuard.allowPublicTarget ? " (override allowed)" : ""}`);
  console.log(`Staging env shape: ${data.envValidation.valid ? "valid" : "invalid"} (${data.envValidation.present})`);
  console.log("");
  console.log(`Required secrets: ${data.secrets.requiredReady}`);
  data.secrets.willApply.forEach((item) => console.log(`- ${item.key}: ${item.value}`));
  data.secrets.missingRequired.forEach((key) => console.log(`- ${key}: missing`));
  console.log("");
  console.log("Frontend env:");
  data.frontendEnv.forEach((item) => console.log(`- ${item.key}: ${item.value} -> ${item.destination}`));
  console.log("");
  console.log("Functions:");
  data.functions.forEach((item) => console.log(`- ${item.present ? "OK" : "MISSING"} ${item.command}`));
  console.log("");
  console.log("PonchoPay callback URLs:");
  data.callbackUrls.forEach((item) => console.log(`- ${item.event}: ${item.url || "set SUPABASE_PROJECT_REF first"}`));
  console.log("");
  console.log("Next:");
  data.next.forEach((item) => console.log(`- ${item}`));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
