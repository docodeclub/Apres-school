import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
loadLocalEnvFiles(envFiles);

const jsonOnly = process.argv.includes("--json");
const siteUrl = clean(process.env.PUBLIC_SITE_URL) || "https://www.apres-school.co.uk";
const base = siteUrl.replace(/\/$/, "");

const settings = {
  generatedAt: new Date().toISOString(),
  siteUrl: base,
  paymentCallbacks: [
    ["Payment captured URL", `${base}/api/ponchopay/captured`],
    ["Payment updated URL", `${base}/api/ponchopay/updated`],
    ["Payment reported complete URL", `${base}/api/ponchopay/reported-complete`],
    ["Payment completed URL", `${base}/api/ponchopay/completed`],
    ["Payment in bank URL", `${base}/api/ponchopay/in-bank`],
    ["Payment refunded URL", `${base}/api/ponchopay/refunded`],
    ["Payment cancelled URL", `${base}/api/ponchopay/cancelled`],
  ],
  recurringPaymentCallbacks: [
    ["Recurring payment captured URL", `${base}/api/ponchopay/recurring-captured`],
    ["Recurring payment set up URL", `${base}/api/ponchopay/recurring-set-up`],
    ["Recurring payment cancelled URL", `${base}/api/ponchopay/recurring-cancelled`],
  ],
  redirects: [
    ["Payment completed redirect", `${base}/booking/success?reference={bookingReference}`],
    ["Subscription set up redirect", `${base}/booking/success?reference={bookingReference}`],
  ],
  sharedWebhookAlternative: `${base}/api/ponchopay/webhook`,
  notes: [
    "Use the separate callback URLs above if Poncho allows each lifecycle field to be configured independently.",
    "The shared webhook alternative is available if Poncho lets all payment callbacks point to the same endpoint.",
    "Redirects are only for parent navigation; the webhook is the source of truth for confirming bookings.",
  ],
};

if (jsonOnly) {
  console.log(JSON.stringify(settings, null, 2));
} else {
  console.log("PonchoPay admin settings");
  console.log(`Site: ${settings.siteUrl}`);
  console.log("");
  console.log("Payment callbacks:");
  for (const [label, url] of settings.paymentCallbacks) console.log(`- ${label}: ${url}`);
  console.log("");
  console.log("Recurring payment callbacks:");
  for (const [label, url] of settings.recurringPaymentCallbacks) console.log(`- ${label}: ${url}`);
  console.log("");
  console.log("Redirects:");
  for (const [label, url] of settings.redirects) console.log(`- ${label}: ${url}`);
  console.log("");
  console.log(`Shared webhook alternative: ${settings.sharedWebhookAlternative}`);
}

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
  for (const file of files) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    Object.entries(parsed).forEach(([key, value]) => {
      if (!process.env[key]) process.env[key] = value;
    });
  }
}

