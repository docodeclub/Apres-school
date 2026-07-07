import { existsSync, readFileSync } from "node:fs";

const envFile = ".env.staging";
const requiredFrontendKeys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_BOOKING_PREVIEW_TOKEN"];
const forbiddenFrontendKeys = [
  "APRES_SERVICE_ROLE_KEY",
  "PONCHOPAY_API_URL",
  "PONCHOPAY_CHECKOUT_PATH",
  "PONCHOPAY_INTEGRATION_KEY",
  "PONCHOPAY_PROCESSOR_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "APRES_EMAIL_FROM",
  "APRES_STAFF_EMAIL_FROM",
  "APRES_REPLY_TO",
  "ENQUIRY_NOTIFICATION_TO",
  "OPERATIONS_NOTIFICATION_TO",
];

const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const frontend = requiredFrontendKeys.map((key) => ({
  key,
  present: Boolean(clean(env[key])),
  value: redact(env[key]),
  destination: "Hidden staging frontend/Vercel env",
}));
const missing = frontend.filter((item) => !item.present).map((item) => item.key);
const blocked = forbiddenFrontendKeys.filter((key) => clean(env[key])).map((key) => ({
  key,
  value: redact(env[key]),
  destination: "Supabase Edge Function secret only",
}));

const report = {
  frontendEnvReady: missing.length === 0,
  envFile,
  frontend,
  missing,
  blocked,
  safeVercelKeys: frontend.map((item) => item.key),
  serverOnlyKeysPresent: blocked.map((item) => item.key),
  next: missing.length
    ? [`Set hidden staging frontend env: ${missing.join(", ")}.`]
    : ["Copy only the safeVercelKeys to the hidden staging frontend environment."],
};

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
