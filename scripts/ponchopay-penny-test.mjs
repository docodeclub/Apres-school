import { existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";

const envFiles = [".env.staging", ".env.production", ".env.local", ".env.development", ".env"];
const loadedEnvFiles = loadLocalEnvFiles(envFiles);
const TRUE_VALUES = new Set(["1", "true", "yes", "live"]);
const enabled = TRUE_VALUES.has(String(process.env.PONCHOPAY_PENNY_TEST || "").toLowerCase());
const dryRun = process.argv.includes("--dry-run") || TRUE_VALUES.has(String(process.env.PONCHOPAY_DRY_RUN || "").toLowerCase());
const amount = Number(process.env.PONCHOPAY_PENNY_AMOUNT || "0.01");
const projectRef = clean(process.env.SUPABASE_PROJECT_REF);
const explicitFunctionsUrl = clean(process.env.SUPABASE_FUNCTIONS_URL);
const functionsUrl = explicitFunctionsUrl || (projectRef ? `https://${projectRef}.functions.supabase.co` : "");
const anonKey = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.VITE_SUPABASE_ANON_KEY);
const processorToken = clean(process.env.PONCHOPAY_PROCESSOR_TOKEN);
const runProcessor = TRUE_VALUES.has(String(process.env.PONCHOPAY_RUN_PROCESSOR || "").toLowerCase());
const processorOnly = TRUE_VALUES.has(String(process.env.PONCHOPAY_PROCESSOR_ONLY || "").toLowerCase());
const syntheticCallbacks = TRUE_VALUES.has(String(process.env.PONCHOPAY_SYNTHETIC_CALLBACKS || "").toLowerCase());
const integrationKey = clean(process.env.PONCHOPAY_INTEGRATION_KEY) || clean(process.env.PONCHOPAY_DEMO_INTEGRATION_KEY);
const ponchoApiUrl = clean(process.env.PONCHOPAY_API_URL);
const ponchoCheckoutPath = clean(process.env.PONCHOPAY_CHECKOUT_PATH) || "/api/integration/generic/initiate";

if (!enabled && !dryRun) {
  fail(`Refusing to create a live penny checkout. Set PONCHOPAY_PENNY_TEST=live to confirm this is intentional. Loaded env files: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "none"}.`);
}

if (!functionsUrl && !dryRun) {
  fail("Set SUPABASE_FUNCTIONS_URL or SUPABASE_PROJECT_REF so the script can call the deployed Supabase function.");
}

if (!Number.isFinite(amount) || amount <= 0 || amount > 1) {
  fail("PONCHOPAY_PENNY_AMOUNT must be greater than 0 and no more than 1.00.");
}

if (syntheticCallbacks && !integrationKey) {
  fail("PONCHOPAY_SYNTHETIC_CALLBACKS requires PONCHOPAY_INTEGRATION_KEY so callback signatures match the deployed function.");
}

if (processorOnly) {
  const processor = await callFunction("ponchopay-process-events", { limit: 20 }, {
    "x-processor-token": processorToken,
  });
  console.log(JSON.stringify({
    ok: true,
    mode: "processor_only",
    processor,
    next: ["Check booking_invoices and booking_receipts for the penny-test invoice state."],
  }, null, 2));
  process.exit(0);
}

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const invoiceId = `penny_${stamp}`;
const bookingId = `booking_${invoiceId}`;
const parentEmail = clean(process.env.PONCHOPAY_PENNY_PARENT_EMAIL) || "payments-test@apres-school.co.uk";
const parentName = clean(process.env.PONCHOPAY_PENNY_PARENT_NAME) || "PonchoPay Penny Test";
const successUrl = clean(process.env.PONCHOPAY_PENNY_SUCCESS_URL) || "https://www.apres-school.co.uk/launch-booking?payment=penny-success";
const cancelUrl = clean(process.env.PONCHOPAY_PENNY_CANCEL_URL) || "https://www.apres-school.co.uk/launch-booking?payment=penny-cancelled";

const checkoutPayload = {
  bookingId,
  invoiceId,
  parentEmail,
  parentName,
  paymentMethod: "card",
  paymentPlan: "pay_now",
  currency: "GBP",
  successUrl,
  cancelUrl,
  items: [
    {
      id: `item_${invoiceId}`,
      childName: "Penny Test",
      siteName: "Willington Prep",
      careType: "PonchoPay rehearsal",
      sessionName: "Live penny test",
      date: "2026-09-03",
      startTime: "15:30",
      endTime: "16:00",
      quantity: 1,
      unitAmount: amount,
    },
  ],
  metadata: {
    launchRehearsal: true,
    source: "scripts/ponchopay-penny-test.mjs",
    createdAt: startedAt.toISOString(),
    locationUrn: clean(process.env.PONCHOPAY_PENNY_LOCATION_URN) || "2764313",
  },
};

if (dryRun) {
  console.log(JSON.stringify({
    ok: Boolean(ponchoApiUrl && integrationKey),
    mode: "dry_run",
    loadedEnvFiles,
    endpoint: ponchoCheckoutEndpoint(ponchoApiUrl, ponchoCheckoutPath),
    functionsUrl: functionsUrl || null,
    amount,
    hasIntegrationKey: Boolean(integrationKey),
    hasSupabaseFunctionTarget: Boolean(functionsUrl),
    payload: checkoutPayload,
    next: [
      !ponchoApiUrl ? "Set PONCHOPAY_API_URL=https://pay.ponchopay.com." : "",
      !integrationKey ? "Set PONCHOPAY_INTEGRATION_KEY in server env/secrets." : "",
      !functionsUrl ? "Set SUPABASE_PROJECT_REF or SUPABASE_FUNCTIONS_URL before live rehearsal." : "",
      "When Supabase staging is deployed, rerun with PONCHOPAY_PENNY_TEST=live.",
    ].filter(Boolean),
  }, null, 2));
  process.exit(0);
}

const checkout = await callFunction("ponchopay-create-checkout", checkoutPayload);

const result = {
  ok: checkout.status === "ready_for_payment",
  rehearsalComplete: false,
  loadedEnvFiles,
  invoiceId: checkout.invoiceId || invoiceId,
  bookingId: checkout.bookingId || bookingId,
  amount: checkout.amount ?? amount,
  status: checkout.status,
  checkoutUrl: checkout.checkoutUrl || null,
  providerPaymentId: checkout.providerPaymentId || null,
  providerReference: checkout.providerReference || null,
  requiresProviderConfig: Boolean(checkout.requiresProviderConfig),
  message: checkout.message || "",
  evidence: {
    checkoutReady: checkout.status === "ready_for_payment",
    callbacksAccepted: false,
    processorRan: false,
    invoiceCleared: false,
    receiptCreated: false,
    bookingConfirmed: false,
  },
  next: [],
};

if (result.ok) {
  if (syntheticCallbacks) {
    result.next.push("Synthetic callbacks were sent to the deployed callback endpoint for staging rehearsal.");
  } else {
    result.next.push("Open checkoutUrl and pay the penny using the agreed PonchoPay test card/payment route.");
    result.next.push("Confirm PonchoPay sends payment-captured and payment-completed callbacks.");
  }
  result.next.push("Run ponchopay-process-events after provider callbacks arrive, or rerun this script with PONCHOPAY_PROCESSOR_ONLY=1.");
} else if (result.requiresProviderConfig) {
  result.next.push("Set PONCHOPAY_API_URL and PONCHOPAY_INTEGRATION_KEY in Supabase secrets, then redeploy ponchopay-create-checkout.");
} else {
  result.next.push("Do not send this link to a parent. Review provider_response in ponchopay_checkout_sessions.");
}

if (syntheticCallbacks && result.ok) {
  result.syntheticCallbacks = [];
  const callbackEvents = ["payment_captured", "payment_completed"];
  for (const eventType of callbackEvents) {
    result.syntheticCallbacks.push(await callPonchoCallback(eventType, {
      eventType,
      eventId: `${result.invoiceId}_${eventType}_${stamp}`,
      paymentId: result.providerPaymentId || `payment_${result.invoiceId}`,
      invoiceId: result.invoiceId,
      bookingId: result.bookingId,
      providerReference: result.providerReference || `ref_${result.invoiceId}`,
      amount: result.amount,
      expectedAmount: result.amount,
      currency: "GBP",
      parent: {
        email: parentEmail,
        name: parentName,
      },
      metadata: {
        synthetic: true,
        launchRehearsal: true,
        source: "scripts/ponchopay-penny-test.mjs",
      },
    }));
  }
  result.evidence.callbacksAccepted = result.syntheticCallbacks.every((callback) => callback.accepted === true);
}

if (runProcessor || syntheticCallbacks) {
  const processorPayload = { limit: 20 };
  const processor = await callFunction("ponchopay-process-events", processorPayload, {
    "x-processor-token": processorToken,
  });
  result.processor = processor;
  result.evidence.processorRan = true;
  result.evidence.invoiceCleared = hasProcessedPaymentStatus(processor, ["paid", "bank_confirmed"]);
  result.evidence.receiptCreated = Boolean(
    processor?.results?.some((item) => typeof item?.receiptId === "string" && item.receiptId.length > 0),
  );
  result.evidence.bookingConfirmed = Boolean(
    processor?.results?.some((item) => item?.bookingStatus === "confirmed"),
  );
}

result.rehearsalComplete = Object.values(result.evidence).every(Boolean);
if (result.rehearsalComplete) {
  result.next = ["Evidence complete: checkout, callbacks, invoice clearing, receipt creation and booking confirmation all passed."];
} else if (result.evidence.checkoutReady && !syntheticCallbacks && !runProcessor) {
  result.next.push("For a staging-only callback rehearsal, rerun with PONCHOPAY_SYNTHETIC_CALLBACKS=1 and PONCHOPAY_RUN_PROCESSOR=1.");
}

console.log(JSON.stringify(result, null, 2));

async function callFunction(name, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (anonKey) {
    headers.apikey = anonKey;
    headers.Authorization = `Bearer ${anonKey}`;
  }

  const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(parsed.error || `${name} returned ${response.status}`);
    error.response = parsed;
    throw error;
  }
  return parsed;
}

async function callPonchoCallback(eventType, payload) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", integrationKey).update(rawBody).digest("hex");
  const callbackPath = eventType.replace(/_/g, "-");
  const response = await fetch(`${functionsUrl.replace(/\/$/, "")}/ponchopay-callback/${callbackPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ponchopay-signature": signature,
    },
    body: rawBody,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(parsed.error || `ponchopay-callback/${callbackPath} returned ${response.status}`);
    error.response = parsed;
    throw error;
  }
  return {
    eventType,
    accepted: parsed.accepted === true,
    duplicate: Boolean(parsed.duplicate),
    eventId: payload.eventId,
    response: parsed,
  };
}

function hasProcessedPaymentStatus(processor, statuses) {
  return Boolean(
    processor?.results?.some((item) => item?.status === "processed" && statuses.includes(item?.paymentStatus)),
  );
}

function ponchoCheckoutEndpoint(baseUrl, path) {
  const base = clean(baseUrl).replace(/\/$/, "");
  if (!base) return null;
  if (/\/api\/integration\/generic\/initiate$/i.test(base)) return base;
  return `${base}${clean(path).replace(/^\/?/, "/")}`;
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
