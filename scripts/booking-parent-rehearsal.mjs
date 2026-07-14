import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const args = new Set(process.argv.slice(2));
const runLive = args.has("--run");
const jsonOnly = args.has("--json");
const rehearsalMode = clean(process.env.BOOKING_PARENT_REHEARSAL);
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const functionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL) || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const publicSiteUrl = clean(process.env.PUBLIC_SITE_URL) || "https://www.apres-school.co.uk";
const anonKey = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.VITE_SUPABASE_ANON_KEY);
const parentJwt = clean(process.env.APRES_REHEARSAL_PARENT_JWT) || clean(process.env.APRES_PARENT_REHEARSAL_TOKEN);
const clientRequestId = clean(process.env.APRES_REHEARSAL_CLIENT_REQUEST_ID) || `hidden-staging-parent-rehearsal-${new Date().toISOString().slice(0, 10)}`;

const payload = {
  parent: {
    fullName: clean(process.env.APRES_REHEARSAL_PARENT_NAME) || "Hidden Staging Parent",
    email: clean(process.env.APRES_REHEARSAL_PARENT_EMAIL) || "parent-rehearsal@example.invalid",
  },
  clientRequestId,
  paymentMethod: clean(process.env.APRES_REHEARSAL_PAYMENT_METHOD) || "card",
  paymentPlan: clean(process.env.APRES_REHEARSAL_PAYMENT_PLAN) || "pay_now",
  paymentRoute: "ponchopay_card_voucher",
  source: "hidden_staging_parent_rehearsal",
  successUrl: `${publicSiteUrl.replace(/\/$/, "")}/booking/success?source=hidden-staging`,
  cancelUrl: `${publicSiteUrl.replace(/\/$/, "")}/booking/cancel?source=hidden-staging`,
  metadata: {
    clientRequestId,
    rehearsal: true,
    warning: "Hidden staging parent rehearsal. Reuse clientRequestId to avoid duplicate holds.",
  },
  items: [
    {
      childName: clean(process.env.APRES_REHEARSAL_CHILD_NAME) || "Rehearsal Child",
      labSessionId: clean(process.env.APRES_REHEARSAL_LAB_SESSION_ID) || "lab-willington-after",
      sessionDate: clean(process.env.APRES_REHEARSAL_SESSION_DATE) || "2026-09-03",
      sessionLabel: clean(process.env.APRES_REHEARSAL_SESSION_LABEL) || "Session 1",
      quantity: 1,
      metadata: {
        labBlockLabel: clean(process.env.APRES_REHEARSAL_SESSION_LABEL) || "Session 1",
        source: "booking-parent-rehearsal",
      },
    },
  ],
};

const missing = [];
if (!functionsUrl) missing.push("SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL");
if (!anonKey) missing.push("SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY");
if (runLive && rehearsalMode !== "live") missing.push("BOOKING_PARENT_REHEARSAL=live");
if (runLive && !parentJwt) missing.push("APRES_REHEARSAL_PARENT_JWT");

const report = {
  parentRehearsalReady: missing.length === 0,
  ranLive: runLive,
  loadedEnvFiles,
  functionsUrl: functionsUrl || null,
  endpoint: functionsUrl ? `${functionsUrl.replace(/\/$/, "")}/create-parent-booking` : null,
  guarded: true,
  guard: {
    runFlag: runLive,
    rehearsalMode: rehearsalMode || "missing",
    hasParentJwt: Boolean(parentJwt),
  },
  requestSummary: {
    clientRequestId,
    parentEmail: payload.parent.email,
    itemCount: payload.items.length,
    firstItem: payload.items[0],
    paymentMethod: payload.paymentMethod,
    paymentPlan: payload.paymentPlan,
  },
  response: null,
  missing,
  next: [],
};

if (!runLive) {
  report.next.push("Dry run only. Set APRES_REHEARSAL_PARENT_JWT, BOOKING_PARENT_REHEARSAL=live, then rerun with --run after staging deploy.");
} else if (missing.length) {
  report.next.push(`Set missing rehearsal values: ${missing.join(", ")}.`);
} else {
  await runParentRehearsal(report);
}

if (!report.next.length) {
  report.next.push(report.parentRehearsalReady ? "Parent rehearsal completed; review booking, invoice and checkout evidence in the admin launch gate." : "Resolve parent rehearsal blockers before launch.");
}

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

if (runLive && !report.parentRehearsalReady) process.exitCode = 1;

async function runParentRehearsal(data) {
  try {
    const response = await fetch(data.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": anonKey,
        "authorization": `Bearer ${parentJwt}`,
      },
      body: JSON.stringify(payload),
    });
    const detail = await safeJsonOrText(response);
    data.response = {
      ok: response.ok,
      status: response.status,
      detail,
    };
    data.parentRehearsalReady = response.ok;
    if (!response.ok) data.next.push("Parent booking rehearsal failed; check parent JWT, profile active status, seeded sessions, and PonchoPay checkout secrets.");
  } catch (error) {
    data.response = {
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : "request failed",
    };
    data.parentRehearsalReady = false;
    data.next.push("Parent booking rehearsal request failed before reaching the function.");
  }
}

async function safeJsonOrText(response) {
  const text = await response.text();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return redactResponse(parsed);
  } catch {
    return text.slice(0, 1000);
  }
}

function redactResponse(value) {
  if (Array.isArray(value)) return value.map(redactResponse);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|secret|key|authorization|signature/i.test(key)) return [key, "redacted"];
    return [key, redactResponse(item)];
  }));
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
  console.log(`Parent booking rehearsal: ${data.parentRehearsalReady ? "READY" : "OPEN ITEMS"}${data.ranLive ? "" : " (dry run)"}`);
  console.log(`Endpoint: ${data.endpoint || "missing"}`);
  console.log(`Guard: ${data.guard.runFlag ? "--run" : "dry"} / ${data.guard.rehearsalMode}`);
  console.log(`Client request: ${data.requestSummary.clientRequestId}`);
  console.log(`Session: ${data.requestSummary.firstItem.labSessionId} ${data.requestSummary.firstItem.sessionDate} ${data.requestSummary.firstItem.sessionLabel}`);
  if (data.response) console.log(`Response: ${data.response.ok ? "OK" : "FAIL"}${data.response.status ? ` (${data.response.status})` : ""}`);
  console.log("");
  console.log("Next:");
  data.next.forEach((item) => console.log(`- ${item}`));
}
