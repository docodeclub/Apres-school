import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base = "http://127.0.0.1:5198";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5198"], { env: { ...process.env, VITE_SUPABASE_URL: "http://127.0.0.1:5198", VITE_SUPABASE_ANON_KEY: "synthetic-test-key" }, stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let submits = 0;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/rest/")) {
      if (url.pathname.includes("public_holiday_camp_schedule")) return route.fulfill({ contentType: "application/json", body: JSON.stringify([1, 2].map(n => ({ session_id: `synthetic-${n}`, site_name: "Willington Prep", camp_name: `Synthetic holiday ${n}`, session_date: `2099-10-${n === 1 ? "19" : "26"}`, block_label: "Holiday Camp", starts_at: `2099-10-${n === 1 ? "19" : "26"}T09:00:00Z`, ends_at: `2099-10-${n === 1 ? "19" : "26"}T17:00:00Z`, price: 50 }))) });
      if (url.pathname.includes("notify-public-enquiry")) { submits++; const body = route.request().postDataJSON(); assert.equal(body.type, "School"); assert.equal(body.subject, "Assurance pack"); return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic service unavailable" }) }); }
      return route.fulfill({ contentType: "application/json", body: "[]" });
    }
    return route.continue();
  });
  await mkdir("output/audit-phase1", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/contact?type=School&subject=Assurance%20pack`);
    const reject = page.getByRole("button", { name: "Reject optional", exact: true });
    if (await reject.isVisible()) await reject.click();
    assert.equal(await page.locator('select[name="type"]').inputValue(), "School");
    assert.equal(await page.locator('input[name="subject"]').inputValue(), "Assurance pack");
    assert.ok((await page.locator('textarea[name="message"]').inputValue()).includes("assurance pack"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Contact overflow at ${width}`);
    await page.screenshot({ path: `output/audit-phase1/contact-${width}.png`, fullPage: true });
    await page.goto(`${base}/staff-application`);
    const declarations = page.locator('select[name="criminalDisclosure"]');
    if (!(await declarations.count())) throw new Error("Application route missing");
    // Recruitment declaration changes are deliberately excluded from this release.
    assert.equal(await declarations.inputValue(), "No");
    await declarations.selectOption("Yes");
    assert.equal(await declarations.evaluate(el => el.checkValidity()), true);
    await declarations.focus();
    assert.equal(await declarations.evaluate(el => document.activeElement === el), true);
    await page.screenshot({ path: `output/audit-phase1/application-${width}.png`, fullPage: true });
    await page.goto(`${base}/holiday-clubs`);
    const campLink = page.getByRole("link", { name: "View Holiday Clubs", exact: true });
    assert.equal(await campLink.getAttribute("href"), "#camp-venues");
    await campLink.click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator("#camp-venues").evaluate(el => el.getBoundingClientRect().top >= 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Camp overflow at ${width}`);
    await page.screenshot({ path: `output/audit-phase1/camps-${width}.png`, fullPage: true });
    const allHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.getByLabel("Choose your camp venue", { exact: true }).selectOption("Holiday Camp at Willington Prep");
    assert.equal(await page.locator(".camp-site-card").count(), 1);
    assert.ok((await page.locator(".camp-site-card").innerText()).includes("Nursery to Year 6"));
    assert.ok(!(await page.locator(".camp-site-card").innerText()).includes("Ages 4–11"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight) < allHeight);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const title of ["Holiday Camp at King's House School", "Holiday Camp at Ripley Court School", "Holiday Camp at The Rowans School", "Holiday Camp at Shrewsbury House School"]) {
      await page.getByLabel("Choose your camp venue", { exact: true }).selectOption(title);
      assert.equal(await page.locator(".camp-site-card").count(), 1);
      assert.equal(await page.locator(".camp-site-card h3").innerText(), title);
    }
    await page.getByLabel("Choose your camp venue", { exact: true }).selectOption("");
    assert.equal(await page.locator(".camp-site-card").count(), 5);
    await page.goto(`${base}/wraparound`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Wraparound overflow at ${width}`);
    await page.screenshot({ path: `output/audit-phase1/wraparound-${width}.png`, fullPage: true });
  }
  assert.equal(submits, 0, "No unintended submissions");
  await page.goto(`${base}/holiday-clubs`);
  await page.getByText("Later holidays (1)", { exact: true }).click();
  assert.ok(await page.getByText("Synthetic holiday 2", { exact: true }).isVisible());
  await page.goto(`${base}/contact?type=School&subject=Assurance%20pack`);
  await page.locator('input[name="name"]').fill("Synthetic Audit");
  await page.locator('input[name="email"]').fill("audit@example.com");
  await page.getByRole("button", { name: "Send Enquiry", exact: true }).click();
  await page.getByText("Synthetic service unavailable", { exact: true }).waitFor();
  assert.equal(submits, 1);
  assert.equal(await page.locator('input[name="name"]').inputValue(), "Synthetic Audit");
  await page.goto(base);
  assert.equal(await page.getByRole("dialog", { name: /booking/i }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "output/audit-phase1/home-desktop.png" });
  console.log("PASS: public desktop/mobile/narrow layouts, keyboard focus, camp anchor and school context; recruitment unchanged, external requests blocked");
} finally { await browser?.close(); vite.kill(); }
