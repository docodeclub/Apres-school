import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;

try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = require("/Users/lukecurrie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}

const baseUrl = process.env.QA_URL || "http://127.0.0.1:5173";
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

const browser = await chromium.launch({ headless: true });
const report = [];

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: viewport.mobile,
  });

  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  for (const [name, path] of routes) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    const closeButton = page.getByRole("button", { name: "Close camp announcement" });
    if (await closeButton.isVisible()) await closeButton.click();

    const checks = await page.evaluate(() => {
      const doc = document.documentElement;
      const images = [...document.images].map((image) => ({
        src: image.currentSrc || image.src,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      }));
      const brokenImages = images.filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0);
      const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
      const description = document.querySelector('meta[name="description"]')?.content || "";
      const ogUrl = document.querySelector('meta[property="og:url"]')?.content || "";
      return {
        title: document.title,
        description,
        canonical,
        ogUrl,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: doc.clientWidth,
        horizontalOverflow: document.body.scrollWidth > doc.clientWidth + 1,
        brokenImages,
        buttonCount: document.querySelectorAll("button, a").length,
      };
    });

    report.push({ viewport: viewport.name, route: name, path, ...checks, consoleErrors: [...consoleErrors] });
    consoleErrors.length = 0;
  }

  await page.close();
}

await browser.close();

const failures = report.filter(
  (entry) =>
    entry.horizontalOverflow ||
    entry.brokenImages.length ||
    entry.consoleErrors.length ||
    !entry.title ||
    !entry.description ||
    !entry.canonical ||
    !entry.ogUrl,
);

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  console.error("Launch QA failed.");
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
