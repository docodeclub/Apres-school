import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const jsonOnly = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const siteUrl = clean(process.env.PUBLIC_SITE_URL) || "https://www.apres-school.co.uk";
const supabaseUrl = clean(process.env.VITE_SUPABASE_URL) || (projectRef ? `https://${projectRef}.supabase.co` : "");
const anonKey = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.VITE_SUPABASE_ANON_KEY);
const previewToken = clean(process.env.VITE_BOOKING_PREVIEW_TOKEN);
const stagingTarget = clean(process.env.BOOKING_STAGING_TARGET).toLowerCase();

const migrationFiles = [
  "0025_email_logs.sql",
  "0041_booking_payment_foundations_backfill.sql",
  "0029_booking_core.sql",
  "0030_create_parent_booking_reservation.sql",
  "0045_seed_2026_wraparound_booking_sessions.sql",
  "0032_cancel_parent_booking.sql",
  "0033_amend_parent_booking_remove_items.sql",
  "0034_amend_parent_booking_add_items.sql",
  "0035_booking_payment_admin_actions.sql",
  "0036_booking_payment_events.sql",
  "0037_ponchopay_webhook_service_grants.sql",
  "0038_booking_payment_service_grants.sql",
];

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

const secretGroups = [
  ["APRES_SERVICE_ROLE_KEY", "Supabase service role key", false],
  ["PONCHOPAY_API_URL", "PonchoPay API URL", false],
  ["PONCHOPAY_CHECKOUT_PATH", "PonchoPay checkout creation path", false],
  ["PONCHOPAY_INTEGRATION_KEY", "PonchoPay integration key", false],
  ["PONCHOPAY_WEBHOOK_SECRET", "PonchoPay webhook signing secret", true],
  ["PONCHOPAY_PROVIDER_ID", "Après PonchoPay provider ID", true],
  ["PONCHOPAY_LOCATION_URN_DEFAULT", "Après default PonchoPay location URN", true],
  ["PONCHOPAY_PROCESSOR_TOKEN", "PonchoPay webhook processor token", false],
  ["PUBLIC_SITE_URL", "Public site URL", true],
  ["STAFF_LOGIN_URL", "Staff login URL", true],
  ["RESEND_API_KEY", "Resend API key", true],
  ["APRES_EMAIL_FROM", "Parent email sender", true],
  ["APRES_STAFF_EMAIL_FROM", "Staff email sender", true],
  ["APRES_REPLY_TO", "Reply-to email", true],
  ["ENQUIRY_NOTIFICATION_TO", "Public enquiry inbox", true],
  ["OPERATIONS_NOTIFICATION_TO", "Operations inbox", true],
];

const callbackEvents = [
  ["Payment captured callback", "captured"],
  ["Payment reported complete callback", "reported-complete"],
  ["Payment completed callback", "completed"],
  ["Payment in bank callback", "in-bank"],
  ["Payment refunded callback", "refunded"],
  ["Payment cancelled callback", "cancelled"],
  ["Payment updated callback", "updated"],
  ["Recurring payment captured callback", "recurring-captured"],
  ["Recurring payment set up callback", "recurring-set-up"],
  ["Recurring payment cancelled callback", "recurring-cancelled"],
];

const preflightCommands = [
  "npm run validate:wraparound",
  "npm run validate:booking-map",
  "npm run check:booking-contract",
  "npm run check:booking-live",
  "npm run check:ponchopay -- --json",
  "npm run build",
];

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  stagingOnly: true,
  stagingGuard: {
    target: stagingTarget || "missing",
    protected: stagingTarget === "hidden",
  },
  loadedEnvFiles,
  project: {
    projectRef: projectRef || null,
    supabaseUrl: supabaseUrl || null,
    functionsUrl: functionsUrl || null,
    siteUrl,
  },
  preflightCommands,
  migrations: migrationFiles.map((name) => ({
    name,
    present: existsSync(join(root, "supabase", "migrations", name)),
  })),
  functions: functionDeploys.map(([name, publicNoJwt]) => ({
    name,
    publicNoJwt,
    present: existsSync(join(root, "supabase", "functions", name, "index.ts")),
    deployCommand: `supabase functions deploy ${name}${publicNoJwt ? " --no-verify-jwt" : ""}`,
    url: functionsUrl ? `${functionsUrl}/${name}` : null,
  })),
  secrets: secretGroups.map(([key, label, recommended]) => ({
    key,
    label,
    required: !recommended,
    present: Boolean(clean(process.env[key])),
    command: key === "PUBLIC_SITE_URL"
      ? `supabase secrets set ${key}=${siteUrl}`
      : key === "STAFF_LOGIN_URL"
        ? `supabase secrets set ${key}=${siteUrl.replace(/\/$/, "")}/staff-login`
        : `supabase secrets set ${key}=...`,
  })),
  frontendEnv: [
    {
      key: "VITE_SUPABASE_URL",
      present: Boolean(supabaseUrl),
      valueHint: supabaseUrl || "https://PROJECT_REF.supabase.co",
      destination: "Hidden staging frontend env",
    },
    {
      key: "VITE_SUPABASE_ANON_KEY",
      present: Boolean(anonKey),
      valueHint: anonKey ? "configured" : "Supabase publishable/anon key",
      destination: "Hidden staging frontend env",
    },
    {
      key: "VITE_BOOKING_PREVIEW_TOKEN",
      present: Boolean(previewToken),
      valueHint: previewToken ? "configured" : "Non-obvious private preview token",
      destination: "Hidden staging frontend env",
    },
  ],
  callbackUrls: callbackEvents.map(([event, slug]) => ({
    event,
    url: `${siteUrl.replace(/\/$/, "")}/api/ponchopay/${slug}`,
  })),
  sharedWebhookUrl: `${siteUrl.replace(/\/$/, "")}/api/ponchopay/webhook`,
  redirectUrls: {
    paymentCompleted: `${siteUrl.replace(/\/$/, "")}/api/ponchopay_redirect?payment=pending`,
    subscriptionSetUp: `${siteUrl.replace(/\/$/, "")}/api/ponchopay_redirect?payment=pending`,
    paymentCancelled: `${siteUrl.replace(/\/$/, "")}/api/ponchopay_redirect?payment=cancelled`,
  },
  deployCommands: [
    "supabase db push",
    ...functionDeploys.map(([name, publicNoJwt]) => `supabase functions deploy ${name}${publicNoJwt ? " --no-verify-jwt" : ""}`),
  ],
  verificationCommands: [
    "npm run check:booking-live:strict",
    "PONCHOPAY_PENNY_TEST=live PONCHOPAY_PENNY_AMOUNT=0.01 node scripts/ponchopay-penny-test.mjs",
    "Open /booking-lab > Admin > Launch Gate > Run Rehearsal",
  ],
  notes: [
    "Use a hidden staging project first; do not link /launch-booking publicly yet.",
    "Set BOOKING_STAGING_TARGET=hidden before running staging apply commands.",
    "Set VITE_BOOKING_PREVIEW_TOKEN in hidden staging and share /launch-booking?preview=TOKEN only with testers.",
    "Never put APRES_SERVICE_ROLE_KEY, PONCHOPAY_INTEGRATION_KEY, PONCHOPAY_PROCESSOR_TOKEN or RESEND_API_KEY into frontend environment variables.",
    "Paste callback URLs into PonchoPay only after functions are deployed.",
  ],
  next: [],
};

const missingMigrations = report.migrations.filter((item) => !item.present);
const missingFunctions = report.functions.filter((item) => !item.present);
const missingRequiredSecrets = report.secrets.filter((item) => item.required && !item.present);
const missingFrontendEnv = report.frontendEnv.filter((item) => !item.present);

if (!projectRef && !functionsUrl) report.next.push("Set SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL before copying callback URLs.");
if (!report.stagingGuard.protected) report.next.push("Set BOOKING_STAGING_TARGET=hidden before applying staging changes.");
if (missingMigrations.length) report.next.push(`Restore missing migrations: ${missingMigrations.map((item) => item.name).join(", ")}.`);
if (missingFunctions.length) report.next.push(`Restore missing functions: ${missingFunctions.map((item) => item.name).join(", ")}.`);
if (missingRequiredSecrets.length) report.next.push(`Set required Supabase secrets: ${missingRequiredSecrets.map((item) => item.key).join(", ")}.`);
if (missingFrontendEnv.length) report.next.push(`Set hidden staging frontend env: ${missingFrontendEnv.map((item) => item.key).join(", ")}.`);
if (!report.next.length) {
  report.next.push("Run preflight commands, push migrations, deploy functions, paste PonchoPay callback URLs, then run the hidden admin rehearsal.");
}
report.ok = !missingMigrations.length && !missingFunctions.length && !missingRequiredSecrets.length && !missingFrontendEnv.length && Boolean(functionsUrl);

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
  console.log(`Booking staging bundle: ${data.ok ? "READY" : "OPEN ITEMS"}`);
  console.log(`Project ref: ${data.project.projectRef || "missing"}`);
  console.log(`Functions URL: ${data.project.functionsUrl || "missing"}`);
  console.log(`Staging guard: ${data.stagingGuard.protected ? "hidden" : data.stagingGuard.target}`);
  console.log(`Loaded env files: ${data.loadedEnvFiles.length ? data.loadedEnvFiles.join(", ") : "none"}`);
  console.log("");
  console.log("Preflight:");
  data.preflightCommands.forEach((command) => console.log(`- ${command}`));
  console.log("");
  console.log("Migrations:");
  data.migrations.forEach((item) => console.log(`- ${item.present ? "OK" : "MISSING"} ${item.name}`));
  console.log("");
  console.log("Supabase secrets:");
  data.secrets.forEach((item) => console.log(`- ${item.present ? "OK" : item.required ? "MISSING" : "OPTIONAL"} ${item.key} - ${item.label}`));
  console.log("");
  console.log("Secret commands:");
  data.secrets.forEach((item) => console.log(`- ${item.command}`));
  console.log("");
  console.log("Functions:");
  data.functions.forEach((item) => console.log(`- ${item.present ? "OK" : "MISSING"} ${item.deployCommand}${item.url ? ` -> ${item.url}` : ""}`));
  console.log("");
  console.log("PonchoPay callback URLs:");
  console.log(`- Shared webhook option: ${data.sharedWebhookUrl}`);
  data.callbackUrls.forEach((item) => console.log(`- ${item.event}: ${item.url || "set SUPABASE_PROJECT_REF first"}`));
  console.log("");
  console.log("PonchoPay redirect URLs:");
  console.log(`- Payment completed redirect: ${data.redirectUrls.paymentCompleted}`);
  console.log(`- Subscription set up redirect: ${data.redirectUrls.subscriptionSetUp}`);
  console.log(`- Payment cancelled redirect: ${data.redirectUrls.paymentCancelled}`);
  console.log("");
  console.log("Deploy:");
  data.deployCommands.forEach((command) => console.log(`- ${command}`));
  console.log("");
  console.log("Verify:");
  data.verificationCommands.forEach((command) => console.log(`- ${command}`));
  console.log("");
  console.log("Next:");
  data.next.forEach((item) => console.log(`- ${item}`));
}
