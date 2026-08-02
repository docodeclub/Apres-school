import { readFileSync } from "node:fs";

const privateRoutes = ["/booking-lab", "/launch-booking"];
const app = readFileSync("src/app.jsx", "utf8");
const robots = readFileSync("robots.txt", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const sitemap = readFileSync("sitemap.xml", "utf8");
const routeFiles = readFileSync("scripts/create-spa-route-files.mjs", "utf8");
const stagingEnvExample = readFileSync(".env.staging.example", "utf8");

const headerMap = new Map((vercel.headers || []).map((entry) => [entry.source, entry.headers || []]));
const failures = [];

for (const route of privateRoutes) {
  if (robots.includes(`Disallow: ${route}`)) {
    failures.push(`${route} must remain crawlable so search engines can read its noindex directive.`);
  }
  if (sitemap.includes(`https://www.apres-school.co.uk${route}`)) {
    failures.push(`${route} is exposed in sitemap.xml.`);
  }

  const headers = headerMap.get(route) || [];
  const robotsHeader = headers.find((header) => header.key === "X-Robots-Tag");
  const cacheHeader = headers.find((header) => header.key === "Cache-Control");
  if (robotsHeader?.value !== "noindex, nofollow") {
    failures.push(`${route} is missing X-Robots-Tag: noindex, nofollow.`);
  }
  if (cacheHeader?.value !== "no-store") {
    failures.push(`${route} is missing Cache-Control: no-store.`);
  }
}

for (const page of ["Booking Lab", "Launch Booking"]) {
  if (!app.includes(`"${page}"`)) {
    failures.push(`${page} page route is missing from app metadata.`);
  }
}
if (!/privatePrototypePages[\s\S]*noindex, nofollow/.test(app)) {
  failures.push("Private prototype pages are not assigned noindex metadata in the app.");
}
if (!/"launch-booking"[\s\S]*robots:\s*"noindex,nofollow"/.test(routeFiles)) {
  failures.push("Static /launch-booking route file is not generated with noindex metadata.");
}
if (/routes\s*=\s*\[[\s\S]*"booking-lab"/.test(routeFiles)) {
  failures.push("Static /booking-lab route file should not be generated for the hidden lab route.");
}
if (!/VITE_BOOKING_PREVIEW_TOKEN/.test(app) || !/hasBookingPreviewAccess/.test(app)) {
  failures.push("Private booking routes are missing the optional preview-token gate.");
}
if (!/VITE_BOOKING_PREVIEW_TOKEN=/.test(stagingEnvExample)) {
  failures.push(".env.staging.example is missing VITE_BOOKING_PREVIEW_TOKEN.");
}

const report = {
  hiddenRoutesReady: failures.length === 0,
  routes: privateRoutes,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
