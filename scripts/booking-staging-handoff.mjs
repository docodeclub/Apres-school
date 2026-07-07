import { existsSync, readFileSync } from "node:fs";

const envFile = ".env.staging";
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const projectRef = clean(env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const siteUrl = clean(env.PUBLIC_SITE_URL) || "https://www.apres-school.co.uk";
const stagingTarget = clean(env.BOOKING_STAGING_TARGET).toLowerCase();
const parentRehearsalMode = clean(env.BOOKING_PARENT_REHEARSAL);
const parentRehearsalJwt = clean(env.APRES_REHEARSAL_PARENT_JWT) || clean(env.APRES_PARENT_REHEARSAL_TOKEN);

const frontendKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_BOOKING_PREVIEW_TOKEN"];
const requiredSecretKeys = ["APRES_SERVICE_ROLE_KEY", "PONCHOPAY_API_URL", "PONCHOPAY_CHECKOUT_PATH", "PONCHOPAY_INTEGRATION_KEY", "PONCHOPAY_PROCESSOR_TOKEN"];
const optionalSecretKeys = [
  "PONCHOPAY_WEBHOOK_SECRET",
  "PONCHOPAY_PROVIDER_ID",
  "PONCHOPAY_LOCATION_URN_DEFAULT",
  "PUBLIC_SITE_URL",
  "STAFF_LOGIN_URL",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "APRES_EMAIL_FROM",
  "APRES_STAFF_EMAIL_FROM",
  "APRES_REPLY_TO",
  "ENQUIRY_NOTIFICATION_TO",
  "OPERATIONS_NOTIFICATION_TO",
];
const callbackSlugs = [
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

const frontend = frontendKeys.map((key) => ({
  key,
  present: Boolean(clean(env[key])),
  value: redact(env[key]),
  destination: "Hidden staging frontend/Vercel env",
}));
const supabaseSecrets = [...requiredSecretKeys, ...optionalSecretKeys].map((key) => ({
  key,
  required: requiredSecretKeys.includes(key),
  present: Boolean(clean(env[key])),
  value: redact(env[key]),
  destination: "Supabase Edge Function secret",
}));
const missingFrontend = frontend.filter((item) => !item.present).map((item) => item.key);
const missingRequiredSecrets = supabaseSecrets.filter((item) => item.required && !item.present).map((item) => item.key);

const report = {
  handoffReady: stagingTarget === "hidden" && Boolean(projectRef && functionsUrl) && missingFrontend.length === 0 && missingRequiredSecrets.length === 0,
  envFile,
  stagingGuard: {
    target: stagingTarget || "missing",
    protected: stagingTarget === "hidden",
  },
  project: {
    projectRef: projectRef || null,
    functionsUrl: functionsUrl || null,
    siteUrl,
  },
  frontend,
  supabaseSecrets,
  callbackUrls: callbackSlugs.map(([event, slug]) => ({
    event,
    url: `${siteUrl.replace(/\/$/, "")}/api/ponchopay/${slug}`,
  })),
  sharedWebhookUrl: `${siteUrl.replace(/\/$/, "")}/api/ponchopay/webhook`,
  redirectUrls: {
    paymentCompleted: `${siteUrl.replace(/\/$/, "")}/booking/success?reference={bookingReference}`,
    subscriptionSetUp: `${siteUrl.replace(/\/$/, "")}/booking/success?reference={bookingReference}`,
  },
  parentRehearsal: {
    enabled: parentRehearsalMode === "live",
    mode: parentRehearsalMode || "missing",
    parentJwt: parentRehearsalJwt ? "configured" : "missing",
    command: "BOOKING_PARENT_REHEARSAL=live APRES_REHEARSAL_PARENT_JWT=... npm run booking:parent-rehearsal:run",
    session: {
      labSessionId: clean(env.APRES_REHEARSAL_LAB_SESSION_ID) || "lab-willington-after",
      sessionDate: clean(env.APRES_REHEARSAL_SESSION_DATE) || "2026-09-03",
      sessionLabel: clean(env.APRES_REHEARSAL_SESSION_LABEL) || "Session 1",
    },
  },
  safeCopy: {
    frontendKeys,
    supabaseSecretKeys: supabaseSecrets.filter((item) => item.present).map((item) => item.key),
  },
  missing: {
    project: projectRef ? [] : ["SUPABASE_PROJECT_REF"],
    stagingGuard: stagingTarget === "hidden" ? [] : ["BOOKING_STAGING_TARGET"],
    frontend: missingFrontend,
    requiredSecrets: missingRequiredSecrets,
  },
  next: [],
};

if (!projectRef) report.next.push("Set SUPABASE_PROJECT_REF before handing callback URLs to PonchoPay.");
if (stagingTarget !== "hidden") report.next.push("Set BOOKING_STAGING_TARGET=hidden before handing this to staging.");
if (missingFrontend.length) report.next.push(`Set frontend env: ${missingFrontend.join(", ")}.`);
if (missingRequiredSecrets.length) report.next.push(`Set Supabase function secrets: ${missingRequiredSecrets.join(", ")}.`);
if (parentRehearsalMode !== "live" || !parentRehearsalJwt) report.next.push("Prepare a staging parent JWT before running booking:parent-rehearsal:run.");
if (!report.next.length) report.next.push("Copy frontend keys to hidden staging, apply Supabase secrets, deploy functions, then paste callback URLs into PonchoPay.");

console.log(JSON.stringify(report, null, 2));

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function redact(value) {
  const text = clean(value);
  if (!text) return "missing";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.length <= 8) return "configured";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
