import http from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const accepted = new Map();
let acceptedCount = 0;

const mockServer = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(200).end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/functions/v1/notify-public-enquiry") {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  response.setHeader("Content-Type", "application/json");
  if (payload.email === "failure@example.com") {
    response.writeHead(503).end(JSON.stringify({ error: "We could not save your enquiry. Please try again." }));
    return;
  }

  const fingerprint = JSON.stringify([payload.name, payload.email, payload.organisation, payload.type, payload.message]);
  const existing = accepted.get(fingerprint);
  if (existing) {
    response.writeHead(200).end(JSON.stringify({ enquiry: existing, duplicate: true }));
    return;
  }

  acceptedCount += 1;
  const enquiry = { ...payload, id: `00000000-0000-4000-8000-${String(acceptedCount).padStart(12, "0")}` };
  accepted.set(fingerprint, enquiry);
  response.writeHead(200).end(JSON.stringify({ enquiry, duplicate: false }));
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockPort = mockServer.address().port;
const appPort = mockPort + 1;
process.stderr.write(`Mock enquiry server ready on ${mockPort}\n`);
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(appPort)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
    VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.mock-signature",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let browser;
try {
  await waitForUrl(`http://127.0.0.1:${appPort}/contact`);
  process.stderr.write(`Local site ready on ${appPort}\n`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${appPort}/contact`);
  await page.getByRole("button", { name: "Reject optional" }).click();

  await fillContactForm(page, { name: "Form QA", email: "success@example.com", message: "Safe local success check" });
  await page.getByRole("button", { name: "Send Enquiry" }).click();
  await page.getByText("Thanks. Your enquiry has been received and the Après School team will follow up.").waitFor();
  process.stderr.write("Success path passed\n");
  assert((await page.getByLabel("Name").inputValue()) === "", "Successful submission should reset the form");

  await fillContactForm(page, { name: "Form QA", email: "success@example.com", message: "Safe local success check" });
  await page.getByRole("button", { name: "Send Enquiry" }).click();
  await page.getByText("We already received this enquiry. There is no need to send it again.").waitFor();
  process.stderr.write("Duplicate path passed\n");
  assert(acceptedCount === 1, "Repeated submission should not create a second enquiry");

  await fillContactForm(page, { name: "Failure QA", email: "failure@example.com", message: "Keep this text after failure" });
  await page.getByRole("button", { name: "Send Enquiry" }).click();
  await page.getByText("We could not save your enquiry. Please try again.").waitFor();
  process.stderr.write("Failure path passed\n");
  assert((await page.getByLabel("Message").inputValue()) === "Keep this text after failure", "Failed submission should preserve the message");
  assert(await page.getByRole("button", { name: "Send Enquiry" }).isEnabled(), "Failed submission should be retryable");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${appPort}/contact`);
  const mobileLayout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    buttonVisible: Boolean(document.querySelector('.contact-form button[type="submit"]')?.getBoundingClientRect().width),
  }));
  assert(mobileLayout.bodyWidth <= mobileLayout.viewportWidth + 1, "Mobile contact page should not overflow horizontally");
  assert(mobileLayout.buttonVisible, "Mobile submit button should remain visible");

  console.log(JSON.stringify({ enquiryFormBrowserReady: true, acceptedCount, checks: 9 }, null, 2));
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  await new Promise((resolve) => mockServer.close(resolve));
}

async function waitForUrl(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Local enquiry test server did not start");
}

async function fillContactForm(page, { name, email, message }) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Message").fill(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
