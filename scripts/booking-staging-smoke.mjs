import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const args = new Set(process.argv.slice(2));
const runLive = args.has("--run");
const jsonOnly = args.has("--json");
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const stagingTarget = clean(process.env.BOOKING_STAGING_TARGET).toLowerCase();
const integrationKey = clean(process.env.PONCHOPAY_INTEGRATION_KEY) || clean(process.env.PONCHOPAY_DEMO_INTEGRATION_KEY);
const processorToken = clean(process.env.PONCHOPAY_PROCESSOR_TOKEN);
const anonKey = clean(process.env.VITE_SUPABASE_ANON_KEY) || clean(process.env.SUPABASE_ANON_KEY);

const functionEndpoints = [
  ["create-parent-booking", "authenticated parent booking"],
  ["update-parent-booking", "authenticated parent booking changes"],
  ["ponchopay-create-checkout", "checkout creation"],
  ["ponchopay-callback/payment-completed", "public signed PonchoPay callback"],
  ["ponchopay-process-events", "internal event processor"],
  ["notify-public-enquiry", "public enquiry notification"],
  ["notify-cover-move", "staff cover move notification"],
  ["manage-staff-account", "admin staff account action"],
];

const callbackPayload = {
  eventId: `smoke-${Date.now()}`,
  eventType: "payment_completed",
  paymentId: "smoke-payment",
  invoiceId: "smoke-invoice",
  bookingId: "smoke-booking",
  amount: 0.01,
  expectedAmount: 0.01,
  currency: "GBP",
  metadata: {
    source: "booking-staging-smoke",
  },
};

const missing = [];
if (stagingTarget !== "hidden") missing.push("BOOKING_STAGING_TARGET=hidden");
if (!functionsUrl) missing.push("SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL");
if (runLive && !integrationKey) missing.push("PONCHOPAY_INTEGRATION_KEY");

const report = {
  smokeReady: missing.length === 0,
  ranLive: runLive,
  loadedEnvFiles,
  stagingGuard: {
    target: stagingTarget || "missing",
    protected: stagingTarget === "hidden",
  },
  functionsUrl: functionsUrl || null,
  endpoints: functionEndpoints.map(([path, purpose]) => ({
    path,
    purpose,
    url: functionsUrl ? `${functionsUrl.replace(/\/$/, "")}/${path}` : null,
    checked: false,
    ok: false,
    status: null,
  })),
  syntheticCallback: {
    enabled: runLive && Boolean(functionsUrl && integrationKey),
    url: functionsUrl ? `${functionsUrl.replace(/\/$/, "")}/ponchopay-callback/payment-completed` : null,
    ok: false,
    status: null,
  },
  processorProbe: {
    enabled: runLive && Boolean(functionsUrl && processorToken),
    url: functionsUrl ? `${functionsUrl.replace(/\/$/, "")}/ponchopay-process-events` : null,
    ok: false,
    status: null,
  },
  missing,
  next: [],
};

if (!runLive) {
  report.next.push("Dry run only. Add --run after hidden staging functions and secrets are deployed.");
} else if (!functionsUrl) {
  report.next.push("Set SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL before running endpoint smoke checks.");
} else {
  await runSmokeChecks(report);
}

if (missing.includes("PONCHOPAY_INTEGRATION_KEY")) {
  report.next.push("Set PONCHOPAY_INTEGRATION_KEY to test a signed synthetic callback.");
}
if (!processorToken) {
  report.next.push("Set PONCHOPAY_PROCESSOR_TOKEN to include the processor probe.");
}
if (!report.next.length) {
  report.next.push(report.smokeReady ? "Smoke checks passed; run the parent booking rehearsal next." : "Fix smoke blockers before staging rehearsal.");
}

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (runLive && !report.smokeReady) process.exitCode = 1;

async function runSmokeChecks(data) {
  data.endpoints = await Promise.all(data.endpoints.map(async (endpoint) => {
    const result = await probeOptions(endpoint.url);
    return { ...endpoint, checked: true, ...result };
  }));

  const failedOptions = data.endpoints.filter((endpoint) => !endpoint.ok);
  if (failedOptions.length) data.next.push(`Check deployed function CORS/availability: ${failedOptions.map((item) => item.path).join(", ")}.`);

  if (integrationKey) {
    const payload = JSON.stringify(callbackPayload);
    const signature = createHmac("sha256", integrationKey).update(payload).digest("base64url");
    const callbackResult = await postJson(data.syntheticCallback.url, payload, {
      "content-type": "application/json",
      "x-ponchopay-signature": signature,
    });
    data.syntheticCallback = { ...data.syntheticCallback, ...callbackResult };
    if (!callbackResult.ok) data.next.push("Synthetic PonchoPay callback did not store successfully; check function secrets and database migrations.");
  }

  if (processorToken) {
    const processorResult = await postJson(data.processorProbe.url, JSON.stringify({ limit: 5, source: "booking-staging-smoke" }), {
      "content-type": "application/json",
      ...(anonKey ? { authorization: `Bearer ${anonKey}` } : {}),
      "x-processor-token": processorToken,
    });
    data.processorProbe = { ...data.processorProbe, ...processorResult };
    if (!processorResult.ok) data.next.push("PonchoPay processor probe failed; check processor token and deployed function secrets.");
  }

  data.smokeReady =
    data.stagingGuard.protected &&
    Boolean(functionsUrl) &&
    data.endpoints.every((endpoint) => endpoint.ok) &&
    (!integrationKey || data.syntheticCallback.ok) &&
    (!processorToken || data.processorProbe.ok);
}

async function probeOptions(url) {
  if (!url) return { ok: false, status: null, detail: "missing URL" };
  try {
    const response = await fetch(url, { method: "OPTIONS" });
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? "OPTIONS ok" : await safeResponseText(response),
    };
  } catch (error) {
    return { ok: false, status: null, detail: error instanceof Error ? error.message : "request failed" };
  }
}

async function postJson(url, body, headers) {
  if (!url) return { ok: false, status: null, detail: "missing URL" };
  try {
    const response = await fetch(url, { method: "POST", headers, body });
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? await safeJsonOrText(response) : await safeResponseText(response),
    };
  } catch (error) {
    return { ok: false, status: null, detail: error instanceof Error ? error.message : "request failed" };
  }
}

async function safeJsonOrText(response) {
  const text = await response.text();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

async function safeResponseText(response) {
  const text = await response.text().catch(() => "");
  return text ? text.slice(0, 500) : response.statusText;
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
  console.log(`Booking staging smoke: ${data.smokeReady ? "READY" : "OPEN ITEMS"}${data.ranLive ? "" : " (dry run)"}`);
  console.log(`Staging guard: ${data.stagingGuard.protected ? "hidden" : data.stagingGuard.target}`);
  console.log(`Functions URL: ${data.functionsUrl || "missing"}`);
  console.log(`Loaded env files: ${data.loadedEnvFiles.length ? data.loadedEnvFiles.join(", ") : "none"}`);
  console.log("");
  console.log("Endpoints:");
  data.endpoints.forEach((endpoint) => {
    console.log(`- ${endpoint.checked ? endpoint.ok ? "OK" : "FAIL" : "PENDING"} ${endpoint.path}${endpoint.status ? ` (${endpoint.status})` : ""}`);
  });
  console.log("");
  console.log(`Synthetic callback: ${data.syntheticCallback.enabled ? data.syntheticCallback.ok ? "OK" : "CHECK" : "skipped"}${data.syntheticCallback.status ? ` (${data.syntheticCallback.status})` : ""}`);
  console.log(`Processor probe: ${data.processorProbe.enabled ? data.processorProbe.ok ? "OK" : "CHECK" : "skipped"}${data.processorProbe.status ? ` (${data.processorProbe.status})` : ""}`);
  console.log("");
  console.log("Next:");
  data.next.forEach((item) => console.log(`- ${item}`));
}
