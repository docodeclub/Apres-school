import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);

const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL);
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL);
const anonKey = clean(process.env.VITE_SUPABASE_ANON_KEY) || clean(process.env.SUPABASE_ANON_KEY);
const serviceRoleKey = clean(process.env.APRES_SERVICE_ROLE_KEY);
const ponchoIntegrationKey = clean(process.env.PONCHOPAY_INTEGRATION_KEY);
const ponchoCheckoutPath = clean(process.env.PONCHOPAY_CHECKOUT_PATH);
const ponchoWebhookSecret = clean(process.env.PONCHOPAY_WEBHOOK_SECRET);
const ponchoProviderId = clean(process.env.PONCHOPAY_PROVIDER_ID);
const ponchoLocationUrn = clean(process.env.PONCHOPAY_LOCATION_URN_DEFAULT);
const ponchoProcessorToken = clean(process.env.PONCHOPAY_PROCESSOR_TOKEN);
const parentRehearsalMode = clean(process.env.BOOKING_PARENT_REHEARSAL);
const parentRehearsalJwt = clean(process.env.APRES_REHEARSAL_PARENT_JWT) || clean(process.env.APRES_PARENT_REHEARSAL_TOKEN);

const checks = [
  checkOptional("SUPABASE_PROJECT_REF", projectRef, isValidProjectRef, "Use the bare Supabase project ref, not a full URL."),
  checkOptional("SUPABASE_FUNCTIONS_URL", functionsUrl, isValidFunctionsUrl, "Expected https://PROJECT_REF.functions.supabase.co"),
  checkOptional("VITE_SUPABASE_URL", supabaseUrl, isValidSupabaseUrl, "Expected https://PROJECT_REF.supabase.co"),
  checkOptional("VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY", anonKey, isLikelyPublicKey, "Use a Supabase publishable/anon key."),
  checkOptional("VITE_BOOKING_PREVIEW_TOKEN", process.env.VITE_BOOKING_PREVIEW_TOKEN, isLikelyPreviewToken, "Use a non-obvious preview token for hidden staging links."),
  checkOptional("BOOKING_STAGING_TARGET", process.env.BOOKING_STAGING_TARGET, isValidStagingTarget, "Use 'hidden' for the private booking rehearsal."),
  checkOptional("APRES_SERVICE_ROLE_KEY", serviceRoleKey, isLikelyServiceRoleKey, "Use the Supabase service-role key, not the anon/publishable key."),
  checkOptional("PONCHOPAY_API_URL", process.env.PONCHOPAY_API_URL, isHttpUrl, "Expected a PonchoPay HTTPS API URL."),
  checkOptional("PONCHOPAY_CHECKOUT_PATH", ponchoCheckoutPath, isValidCheckoutPath, "Expected /api/integration/generic/initiate."),
  checkOptional("PONCHOPAY_INTEGRATION_KEY", ponchoIntegrationKey, isLikelySecret, "Integration key must not be blank or placeholder text."),
  checkOptional("PONCHOPAY_WEBHOOK_SECRET", ponchoWebhookSecret, isLikelySecret, "Optional if Poncho signs callbacks with the integration key."),
  checkOptional("PONCHOPAY_PROVIDER_ID", ponchoProviderId, isLikelySecret, "Après-only PonchoPay provider ID when Poncho supplies it."),
  checkOptional("PONCHOPAY_LOCATION_URN_DEFAULT", ponchoLocationUrn, isLikelySecret, "Après-only PonchoPay location URN when Poncho supplies it."),
  checkOptional("PONCHOPAY_PROCESSOR_TOKEN", ponchoProcessorToken, isLikelySecret, "Processor token must not be blank or placeholder text."),
  checkOptional("BOOKING_PARENT_REHEARSAL", parentRehearsalMode, isValidParentRehearsalMode, "Use 'live' only when deliberately running the parent rehearsal."),
  checkOptional("APRES_REHEARSAL_PARENT_JWT or APRES_PARENT_REHEARSAL_TOKEN", parentRehearsalJwt, isLikelyJwt, "Use a real signed-in staging parent JWT, never a service key."),
];

if (projectRef && supabaseUrl && !supabaseUrl.startsWith(`https://${projectRef}.`)) {
  checks.push({
    key: "VITE_SUPABASE_URL",
    present: true,
    valid: false,
    detail: "Supabase URL does not match SUPABASE_PROJECT_REF.",
  });
}

if (projectRef && functionsUrl && !functionsUrl.startsWith(`https://${projectRef}.`)) {
  checks.push({
    key: "SUPABASE_FUNCTIONS_URL",
    present: true,
    valid: false,
    detail: "Functions URL does not match SUPABASE_PROJECT_REF.",
  });
}

if (serviceRoleKey && anonKey && serviceRoleKey === anonKey) {
  checks.push({
    key: "APRES_SERVICE_ROLE_KEY",
    present: true,
    valid: false,
    detail: "Service-role key must not match the anon/publishable key.",
  });
}

if (ponchoIntegrationKey && ponchoProcessorToken && ponchoIntegrationKey === ponchoProcessorToken) {
  checks.push({
    key: "PONCHOPAY_PROCESSOR_TOKEN",
    present: true,
    valid: false,
    detail: "Processor token should be separate from the PonchoPay integration key.",
  });
}

const invalid = checks.filter((check) => check.present && !check.valid);
const present = checks.filter((check) => check.present).length;
const report = {
  stagingEnvValid: invalid.length === 0,
  loadedEnvFiles,
  present: `${present}/${checks.length}`,
  invalid: invalid.map((check) => ({
    key: check.key,
    detail: check.detail,
  })),
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (invalid.length) process.exitCode = 1;

function checkOptional(key, value, validate, detail) {
  const text = clean(value);
  return {
    key,
    present: Boolean(text),
    valid: !text || validate(text),
    detail: text ? detail : "Not set yet.",
    value: redact(text),
  };
}

function isValidProjectRef(value) {
  return /^[a-z0-9]{15,30}$/.test(value) && !isPlaceholder(value);
}

function isValidSupabaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && !isPlaceholder(value);
  } catch {
    return false;
  }
}

function isValidFunctionsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.functions\.supabase\.co$/.test(url.hostname) && !isPlaceholder(value);
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !isPlaceholder(value);
  } catch {
    return false;
  }
}

function isValidCheckoutPath(value) {
  return value === "/api/integration/generic/initiate";
}

function isLikelyPublicKey(value) {
  return value.length >= 20 && !isPlaceholder(value);
}

function isLikelyPreviewToken(value) {
  return value.length >= 12 && !isPlaceholder(value) && !/^(preview|test|password|apres)$/i.test(value);
}

function isValidStagingTarget(value) {
  return value === "hidden";
}

function isValidParentRehearsalMode(value) {
  return value === "live";
}

function isLikelyJwt(value) {
  return value.split(".").length === 3 && value.length >= 80 && !isPlaceholder(value);
}

function isLikelySecret(value) {
  return value.length >= 12 && !isPlaceholder(value);
}

function isLikelyServiceRoleKey(value) {
  return isLikelySecret(value) && !/^sb_publishable_/i.test(value) && !/^sb_anon_/i.test(value);
}

function isPlaceholder(value) {
  return /^(change-me|todo|your-|placeholder|project_ref|example|dummy|test)$/i.test(value) || /example\.invalid/i.test(value);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redact(value) {
  const text = clean(value);
  if (!text) return "missing";
  if (/^https:\/\//i.test(text)) return text;
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
