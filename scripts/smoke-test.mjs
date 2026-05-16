import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;

try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = require("/Users/lukecurrie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}

const baseUrl = process.env.SMOKE_URL || "http://127.0.0.1:5173";
const routes = [
  ["Home", "/"],
  ["Bookings", "/bookings"],
  ["Holiday Clubs", "/holiday-clubs"],
  ["Wraparound", "/wraparound"],
  ["Schools", "/schools"],
  ["Magicbooking", "/magicbooking"],
  ["Book Pebble", "/book-pebble"],
  ["Payments", "/payments"],
  ["Cancellations", "/cancellations"],
  ["Policies", "/policies"],
  ["Contact", "/contact"],
  ["Staff Application", "/staff-application"],
];
const leakPattern = /Maya|Jamie|Nadia|Oakfield|Riverside|safeguarding issues|admin CRM mock|incident\/safeguarding alerts/i;

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: viewport.mobile,
  });

  const results = [];

  for (const [route, path] of routes) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    const announcementClose = page.getByRole("button", { name: "Close camp announcement" });
    if (await announcementClose.isVisible()) await announcementClose.click();

    const bodyText = await page.locator("body").innerText();
    results.push({
      route,
      title: await page.title(),
      scrollY: await page.evaluate(() => window.scrollY),
      width: await page.locator("body").evaluate((el) => el.scrollWidth),
      leak: leakPattern.test(bodyText),
    });
  }

  await page.close();
  return { viewport: viewport.name, results };
}

const browser = await chromium.launch({ headless: true });
const report = [];

for (const viewport of [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  report.push(await checkViewport(browser, viewport));
}

await browser.close();

const failures = report.flatMap((group) =>
  group.results.filter((result) => result.leak || result.width > (group.viewport === "mobile" ? 390 : 1280))
);

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("Smoke test failed.");
  process.exit(1);
}
