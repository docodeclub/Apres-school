import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const strictEnv = process.argv.includes("--strict-env");
const productionUrl = process.env.PRODUCTION_URL || process.env.QA_URL || "";

const vercelRequired = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const supabaseRequired = ["APRES_SERVICE_ROLE_KEY"];
const emailRecommended = ["ENQUIRY_NOTIFICATION_TO", "OPERATIONS_NOTIFICATION_TO", "RESEND_API_KEY", "RESEND_FROM"];
const frontendForbidden = ["APRES_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM", "ENQUIRY_NOTIFICATION_TO", "OPERATIONS_NOTIFICATION_TO"];
const sourceDirs = ["src", "public"];
const deployRoutes = [
  "/",
  "/bookings",
  "/holiday-clubs",
  "/wraparound",
  "/schools",
  "/magicbooking",
  "/book-pebble",
  "/payments",
  "/cancellations",
  "/policies",
  "/contact",
  "/staff-application",
];

const envExample = parseEnvExample(readFileSync(join(root, ".env.example"), "utf8"));
const report = {
  envExample: {
    hasVercelVars: vercelRequired.every((key) => key in envExample),
    hasSupabaseSecrets: supabaseRequired.every((key) => key in envExample),
    hasEmailVars: emailRecommended.every((key) => key in envExample),
  },
  currentEnvironment: {
    missingVercel: missing(vercelRequired),
    missingSupabaseSecrets: missing(supabaseRequired),
    missingEmailRecommended: missing(emailRecommended),
    invalidUrls: invalidUrls(),
  },
  sourceScan: scanSourceForFrontendSecrets(),
  productionUrl: productionUrl || null,
  routeChecks: [],
};

if (productionUrl) {
  report.routeChecks = await checkProductionRoutes(productionUrl);
}

const failures = [];
if (!report.envExample.hasVercelVars) failures.push(".env.example is missing required Vercel frontend variables.");
if (!report.envExample.hasSupabaseSecrets) failures.push(".env.example is missing required Supabase secret names.");
if (report.sourceScan.matches.length) failures.push("Server-only secret names are referenced from frontend source/public files.");
if (report.currentEnvironment.invalidUrls.length) failures.push("One or more configured URLs are invalid.");
if (strictEnv && report.currentEnvironment.missingVercel.length) failures.push("Required Vercel environment variables are not set.");
if (strictEnv && report.currentEnvironment.missingSupabaseSecrets.length) failures.push("Required Supabase secrets are not set in the current environment.");
if (report.routeChecks.some((check) => !check.ok)) failures.push("One or more production routes did not return the expected app shell.");

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("Deploy check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(strictEnv ? "Strict deploy checks passed." : "Deploy checks passed. Use --strict-env when production secrets are loaded.");

function parseEnvExample(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function missing(keys) {
  return keys.filter((key) => !process.env[key]);
}

function invalidUrls() {
  const checks = ["VITE_SUPABASE_URL", "PUBLIC_SITE_URL", "PUBLIC_MAGICBOOKING_URL", "PUBLIC_BOOK_PEBBLE_URL", "PRODUCTION_URL", "QA_URL"];
  return checks.filter((key) => {
    const value = process.env[key];
    if (!value) return false;
    try {
      new URL(value);
      return false;
    } catch {
      return true;
    }
  });
}

function scanSourceForFrontendSecrets() {
  const matches = [];
  for (const dir of sourceDirs) {
    const dirPath = join(root, dir);
    if (!exists(dirPath)) continue;
    for (const file of walk(dirPath)) {
      if (!/\.(js|jsx|ts|tsx|css|html|json|md|txt|xml|webmanifest)$/.test(file)) continue;
      const content = readFileSync(file, "utf8");
      for (const key of frontendForbidden) {
        if (readsSecretFromFrontendEnv(content, key)) matches.push(`${file.replace(root + "/", "")}: ${key}`);
      }
    }
  }
  return { matches };
}

function readsSecretFromFrontendEnv(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`import\\.meta\\.env\\.${escaped}\\b`),
    new RegExp(`import\\.meta\\.env\\[['"\`]${escaped}['"\`]\\]`),
    new RegExp(`process\\.env\\.${escaped}\\b`),
    new RegExp(`process\\.env\\[['"\`]${escaped}['"\`]\\]`),
  ].some((pattern) => pattern.test(content));
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path;
  });
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function checkProductionRoutes(base) {
  return Promise.all(deployRoutes.map(async (route) => {
    const url = new URL(route, base).toString();
    try {
      const response = await fetch(url, { redirect: "follow" });
      const text = await response.text();
      return {
        route,
        status: response.status,
        ok: response.ok && text.includes("Après School") && text.includes("id=\"root\""),
      };
    } catch (error) {
      return {
        route,
        status: null,
        ok: false,
        error: error.message,
      };
    }
  }));
}
