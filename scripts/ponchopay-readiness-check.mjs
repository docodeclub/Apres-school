import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);

const root = process.cwd();
const jsonOnly = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const publicSiteUrl = clean(process.env.PUBLIC_SITE_URL) || "https://www.apres-school.co.uk";
const anonKey = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.VITE_SUPABASE_ANON_KEY);

const requiredSecretGroups = [
  {
    name: "PonchoPay API URL",
    keys: ["PONCHOPAY_API_URL"],
    setCommand: "supabase secrets set PONCHOPAY_API_URL=https://pay.ponchopay.com",
  },
  {
    name: "PonchoPay checkout path",
    keys: ["PONCHOPAY_CHECKOUT_PATH"],
    setCommand: "supabase secrets set PONCHOPAY_CHECKOUT_PATH=/api/integration/generic/initiate",
  },
  {
    name: "PonchoPay integration key",
    keys: ["PONCHOPAY_INTEGRATION_KEY", "PONCHOPAY_DEMO_INTEGRATION_KEY"],
    setCommand: "supabase secrets set PONCHOPAY_INTEGRATION_KEY=...",
  },
  {
    name: "Public site URL",
    keys: ["PUBLIC_SITE_URL"],
    setCommand: "supabase secrets set PUBLIC_SITE_URL=https://www.apres-school.co.uk",
  },
  {
    name: "Supabase service role",
    keys: ["APRES_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    setCommand: "supabase secrets set APRES_SERVICE_ROLE_KEY=...",
  },
];

const recommendedSecrets = [
  "PONCHOPAY_PROCESSOR_TOKEN",
  "PONCHOPAY_WEBHOOK_SECRET",
  "PONCHOPAY_PROVIDER_ID",
  "PONCHOPAY_LOCATION_URN_DEFAULT",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_FUNCTIONS_URL",
];

const callbackEvents = [
  ["Payment captured callback", "captured", "Reserve/checkpoint"],
  ["Payment reported complete callback", "reported-complete", "Parent reported"],
  ["Payment completed callback", "completed", "Funds matched"],
  ["Payment in bank callback", "in-bank", "Bank matched"],
  ["Payment refunded callback", "refunded", "Refund recorded"],
  ["Payment cancelled callback", "cancelled", "Payment cancelled"],
  ["Payment updated callback", "updated", "Payment changed"],
  ["Recurring payment captured callback", "recurring-captured", "Monthly capture"],
  ["Recurring payment set up callback", "recurring-set-up", "Monthly plan ready"],
  ["Recurring payment cancelled callback", "recurring-cancelled", "Monthly plan stopped"],
];

const functionNames = [
  "ponchopay-create-checkout",
  "ponchopay-callback",
  "ponchopay-process-events",
];

const migrationFiles = [
  "0041_booking_payment_foundations_backfill.sql",
  "0036_booking_payment_events.sql",
  "0037_ponchopay_webhook_service_grants.sql",
  "0038_booking_payment_service_grants.sql",
];

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  functionsUrl: functionsUrl || null,
  publicSiteUrl,
  loadedEnvFiles: loadedEnvFiles,
  secrets: {
    required: requiredSecretGroups.map((group) => ({
      name: group.name,
      keys: group.keys,
      present: group.keys.some((key) => Boolean(clean(process.env[key]))),
      publicSafe: false,
      setCommand: group.setCommand,
    })),
    recommended: recommendedSecrets.map((name) => ({
      name,
      present: name === "SUPABASE_ANON_KEY" ? Boolean(anonKey) : Boolean(clean(process.env[name])),
      publicSafe: name === "SUPABASE_ANON_KEY" || name === "VITE_SUPABASE_ANON_KEY" || name === "SUPABASE_PROJECT_REF" || name === "SUPABASE_FUNCTIONS_URL",
    })),
  },
  functions: functionNames.map((name) => ({
    name,
    localPath: `supabase/functions/${name}`,
    localPresent: existsSync(join(root, "supabase", "functions", name, "index.ts")),
    deployCommand: name === "ponchopay-callback"
      ? `supabase functions deploy ${name} --no-verify-jwt`
      : `supabase functions deploy ${name}`,
    url: functionsUrl ? `${functionsUrl}/${name}` : null,
  })),
  migrations: migrationFiles.map((name) => ({
    name,
    present: existsSync(join(root, "supabase", "migrations", name)),
  })),
  callbackUrls: callbackEvents.map(([event, slug, state]) => ({
    event,
    slug,
    state,
    url: `${publicSiteUrl.replace(/\/$/, "")}/api/ponchopay/${slug}`,
  })),
  sharedWebhookUrl: `${publicSiteUrl.replace(/\/$/, "")}/api/ponchopay/webhook`,
  redirectUrls: {
    paymentCompleted: `${publicSiteUrl.replace(/\/$/, "")}/booking/success?reference={bookingReference}`,
    subscriptionSetUp: `${publicSiteUrl.replace(/\/$/, "")}/booking/success?reference={bookingReference}`,
  },
  deployPlan: {
    migrations: "supabase db push",
    functions: functionNames.map((name) => name === "ponchopay-callback"
      ? `supabase functions deploy ${name} --no-verify-jwt`
      : `supabase functions deploy ${name}`),
    secrets: requiredSecretGroups.map((group) => group.setCommand),
  },
  ponchoPaySettings: {
    location: "PonchoPay admin > Settings > API Integration",
    action: "Paste each callback URL against the matching lifecycle event, then save before testing callbacks.",
  },
  pennyTest: {
    command: "PONCHOPAY_PENNY_TEST=live PONCHOPAY_PENNY_AMOUNT=0.01 node scripts/ponchopay-penny-test.mjs",
    guarded: true,
    requires: ["SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL", "SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY", "PONCHOPAY_API_URL", "PONCHOPAY_CHECKOUT_PATH", "PONCHOPAY_INTEGRATION_KEY"],
  },
  launchGate: {
    blocksParentPaymentsUntil: [
      "PonchoPay credentials are present in Supabase secrets",
      "Callback URLs are pasted into PonchoPay API Integration settings",
      "Penny test returns ready_for_payment and callbacks process",
    ],
  },
  next: [],
};

const missingRequired = report.secrets.required.filter((item) => !item.present).map((item) => item.name);
const missingFunctions = report.functions.filter((item) => !item.localPresent).map((item) => item.name);
const missingMigrations = report.migrations.filter((item) => !item.present).map((item) => item.name);
if (!functionsUrl) {
  report.ok = false;
  report.next.push("Set SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL so callback URLs can be given to PonchoPay.");
}
if (missingRequired.length) {
  report.ok = false;
  report.next.push(`Set missing Supabase secrets: ${missingRequired.join(", ")}.`);
}
if (missingFunctions.length) {
  report.ok = false;
  report.next.push(`Restore missing local Supabase functions: ${missingFunctions.join(", ")}.`);
}
if (missingMigrations.length) {
  report.ok = false;
  report.next.push(`Apply or restore missing PonchoPay migrations: ${missingMigrations.join(", ")}.`);
}
if (!anonKey) {
  report.next.push("Set SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY before running the penny-test script.");
}
if (!missingRequired.length && functionsUrl && !missingFunctions.length && !missingMigrations.length) {
  report.next.push("Deploy the three PonchoPay functions and push the PonchoPay migrations.");
  report.next.push("Paste the callback URLs into PonchoPay API Integration settings.");
  report.next.push("Run the guarded live penny test with PONCHOPAY_PENNY_TEST=live.");
}

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}
if (!report.ok && strict) process.exit(1);

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
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

function printHumanReport(data) {
  console.log(`PonchoPay live readiness: ${data.ok ? "READY TO CONFIGURE" : "OPEN ITEMS"}`);
  console.log(`Functions URL: ${data.functionsUrl || "missing"}`);
  console.log(`Loaded env files: ${data.loadedEnvFiles.length ? data.loadedEnvFiles.join(", ") : "none"}`);
  console.log("");
  console.log("Required secrets:");
  for (const item of data.secrets.required) {
    console.log(`- ${item.present ? "OK" : "MISSING"} ${item.name} (${item.keys.join(" or ")})`);
  }
  console.log("");
  console.log("Secret commands:");
  for (const command of data.deployPlan.secrets) console.log(`- ${command}`);
  console.log("");
  console.log("Supabase functions:");
  for (const item of data.functions) {
    console.log(`- ${item.localPresent ? "OK" : "MISSING"} ${item.name}${item.url ? ` -> ${item.url}` : ""}`);
  }
  console.log("");
  console.log("PonchoPay callback URLs:");
  console.log(`- Shared webhook option: ${data.sharedWebhookUrl}`);
  for (const item of data.callbackUrls) {
    console.log(`- ${item.event}: ${item.url || "set SUPABASE_PROJECT_REF first"}`);
  }
  console.log("");
  console.log("PonchoPay redirect URLs:");
  console.log(`- Payment completed redirect: ${data.redirectUrls.paymentCompleted}`);
  console.log(`- Subscription set up redirect: ${data.redirectUrls.subscriptionSetUp}`);
  console.log("");
  console.log(`PonchoPay settings: ${data.ponchoPaySettings.location}`);
  console.log(`- ${data.ponchoPaySettings.action}`);
  console.log("");
  console.log("Deploy commands:");
  console.log(`- ${data.deployPlan.migrations}`);
  for (const command of data.deployPlan.functions) console.log(`- ${command}`);
  console.log("");
  console.log("Next:");
  for (const item of data.next) console.log(`- ${item}`);
}
