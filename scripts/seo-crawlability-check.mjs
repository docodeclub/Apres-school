import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const failures = [];
const check = (pass, label) => {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures.push(label);
};

const robots = read("dist/robots.txt");
const sitemap = read("dist/sitemap.xml");
const app = read("src/app.jsx");
const publicRoutes = ["", "holiday-clubs", "wraparound", "schools", "payments", "cancellations", "policies", "contact", "staff-application"];
const noindexHtmlRoutes = ["/staff-login", "/tutor", "/booking-lab", "/launch-booking"];

function readStructuredData(html) {
  const match = html.match(/<script\s+id="apres-structured-data"\s+type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function readPrerenderedContent(html) {
  const match = html.match(/<!-- crawler-content:start -->([\s\S]*?)<!-- crawler-content:end -->/);
  return match?.[1] || "";
}

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#x27|#39);/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

check(robots.includes("User-agent: *") && robots.includes("Sitemap: https://www.apres-school.co.uk/sitemap.xml"), "robots.txt is deployed and advertises the sitemap");
check(robots.includes("Disallow: /api/") && noindexHtmlRoutes.every((route) => !robots.includes(`Disallow: ${route}`)), "robots.txt blocks APIs but allows noindex HTML routes to be crawled");
check(!sitemap.includes("/bookings</loc>") && !sitemap.includes("/magicbooking</loc>") && !sitemap.includes("/book-pebble</loc>"), "sitemap excludes obsolete booking routes");
check(publicRoutes.every((route) => sitemap.includes(`<loc>https://www.apres-school.co.uk/${route}</loc>`)), "sitemap includes every indexable public route");
check(app.includes("href={pagePaths[item] || \"/\"}") && app.includes("footer-column") && app.includes("href={pagePaths[link] || \"/\"}"), "header and footer navigation expose real links");

for (const route of publicRoutes) {
  const file = route ? `dist/${route}/index.html` : "dist/index.html";
  const html = read(file);
  const prerendered = readPrerenderedContent(html);
  const prerenderedText = visibleText(prerendered);
  check(prerendered.includes(`data-prerendered-page=`) && prerendered.includes("<main id=\"main-content\">") && prerendered.includes("site-footer"), `${route || "home"} has its complete public shell before JavaScript`);
  check(prerenderedText.length >= 1500 && (prerendered.match(/<h[1-6]\b/g) || []).length >= 6, `${route || "home"} pre-renders the full page copy and heading structure`);
  check(html.includes('rel="canonical"') && !html.includes('name="robots" content="noindex'), `${route || "home"} is canonical and indexable`);
  check((prerendered.match(/<a href="\//g) || []).length >= 14, `${route || "home"} exposes crawlable header, content and footer links`);
  const structuredData = readStructuredData(html);
  check(Boolean(structuredData?.["@graph"]?.length), `${route || "home"} has parseable route-specific JSON-LD`);
  const types = structuredData?.["@graph"]?.flatMap((item) => Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]) || [];
  check(!types.includes("ChildCare") && !types.includes("LocalBusiness"), `${route || "home"} avoids generic or unverified local-business markup`);
  if (route) check(types.includes("BreadcrumbList"), `${route} includes BreadcrumbList markup`);
  else check(types.includes("Organization") && structuredData["@graph"].some((item) => item["@type"] === "Organization" && item.legalName === "Après School Limited" && item.identifier?.value === "14934898"), "home includes full Organization details");
}

const holidayHtml = read("dist/holiday-clubs/index.html");
const holidayMain = holidayHtml.match(/<main id="main-content">([\s\S]*?)<footer class="site-footer">/)?.[1] || "";
const holidayImages = holidayMain.match(/<img\b[^>]*>/g) || [];
check(holidayImages.length >= 9, "holiday-clubs exposes venue and activity photography as real images");
check(holidayImages.every((image) => /\balt="[^"]+"/.test(image) && /\bwidth="\d+"/.test(image) && /\bheight="\d+"/.test(image)), "holiday-clubs images have useful alt text and intrinsic dimensions");
check(holidayImages.every((image) => /\bsrcSet="[^"]+\s480w[^\"]+\s800w[^\"]+\s1600w"/.test(image) && /\bsizes="[^"]+"/.test(image)), "holiday-clubs images expose responsive sources and sizes");
check(holidayImages.some((image) => /loading="eager"/.test(image) && /fetchpriority="high"/.test(image)) && holidayImages.filter((image) => /loading="lazy"/.test(image)).length >= 8, "holiday-clubs prioritises its hero image and lazy-loads later photography");

for (const route of ["launch-booking", "staff-login", "tutor"]) {
  const privateHtml = read(`dist/${route}/index.html`);
  check(privateHtml.includes('name="robots" content="noindex,nofollow"'), `${route} remains noindex while crawlable`);
}

if (failures.length) {
  console.error(`SEO crawlability check failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  process.exit(1);
}
console.log("SEO crawlability check passed.");
