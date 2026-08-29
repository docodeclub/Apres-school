import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { serializeStructuredData, structuredDataForPath } from "../src/structuredData.js";

const distDir = path.resolve("dist");
const indexPath = path.join(distDir, "index.html");
const routes = [
  "bookings",
  "holiday-clubs",
  "wraparound",
  "schools",
  "magicbooking",
  "book-pebble",
  "payments",
  "cancellations",
  "launch-booking",
  "shared-register",
  "policies",
  "contact",
  "staff-application",
  "staff-login",
  "tutor",
  "booking/success",
  "booking/cancel",
  "booking/cancelled",
  "booking/payment",
  "booking/return",
  "ponchopay/return",
];
const routeMeta = {
  "": {
    title: "Après School | Wraparound Care for Schools & Holiday Camps",
    description: "Wraparound care, holiday camps and extended school provision that helps schools strengthen their parent offer.",
    keywords: "Après School, wraparound care for schools, holiday camps, extended school provision, after school club, breakfast club, school partnerships",
  },
  bookings: {
    title: "Book Après School Clubs & Holiday Camps",
    description: "Find your school, wraparound care site or holiday camp and continue to the correct booking platform.",
    keywords: "Après School bookings, book holiday camps, book after school club, Magicbooking, Book Pebble, school childcare bookings",
    robots: "noindex,nofollow",
  },
  "holiday-clubs": {
    title: "Holiday Camps for Schools and Families | Après School",
    description: "Active, creative holiday camps at selected school sites with clear booking routes for families.",
    keywords: "holiday camps, school holiday clubs, holiday childcare, activity camps, school holiday provision, Après School holiday camps",
  },
  wraparound: {
    title: "Wraparound Care for Schools | Après School",
    description: "Breakfast clubs and after-school care for schools that want reliable extended provision parents trust.",
    keywords: "wraparound care for schools, after school care, breakfast club, extended school day, school childcare, term-time childcare",
  },
  schools: {
    title: "Wraparound Care for Schools & Extended Provision | Après School",
    description: "Partner with Après School for wraparound care, holiday camps and extended provision that helps parents choose your school.",
    keywords: "wraparound care for schools, extended school provision, school partnerships, holiday camps for schools, after school provision, parent offer",
  },
  contact: {
    title: "Contact Après School | Wraparound Care & Holiday Camps",
    description: "Contact Après School about wraparound care for schools, holiday camps, school partnerships and staffing.",
    keywords: "school partnership enquiry, wraparound care enquiry, holiday camp enquiry, Après School contact",
  },
  policies: {
    title: "Policies & Safeguarding | Après School",
    description: "Safeguarding, behaviour, health and safety, privacy and complaints policy summaries for Après School families and partner schools.",
    keywords: "Après School policies, safeguarding policy, childcare policies, school assurance",
  },
  payments: {
    title: "Payments for Wraparound Care & Holiday Clubs | Après School",
    description: "Information for families about paying for Après School wraparound care and holiday club bookings.",
    keywords: "Après School payments, childcare payments, wraparound care payments, holiday club payments",
  },
  cancellations: {
    title: "Booking Cancellations & Account Credit | Après School",
    description: "Information about eligible booking changes, cancellations and account credit for Après School families.",
    keywords: "Après School cancellations, childcare booking changes, booking credit, family account",
  },
  "staff-login": {
    title: "Staff Login | Après School",
    description: "Secure staff and admin login for Après School.",
    keywords: "Après School staff login",
    robots: "noindex,nofollow",
  },
  "staff-application": {
    title: "Work With Après School | Staff Applications",
    description: "Apply to join the Après School team and support children through wraparound care and holiday programmes.",
    keywords: "Après School jobs, wraparound care jobs, holiday club jobs, childcare staff application",
  },
  tutor: {
    title: "Admin Dashboard | Après School",
    description: "Secure staff and admin dashboard for Après School.",
    keywords: "Après School admin dashboard",
    robots: "noindex,nofollow",
  },
  "launch-booking": {
    title: "Family Booking System | Après School",
    description: "Sign in to book Après School wraparound care and holiday club sessions for your family.",
    keywords: "Après School booking, wraparound booking, holiday club booking",
    robots: "noindex,nofollow",
  },
  "shared-register": {
    title: "Private School Register | Après School",
    description: "Time-limited read-only school register.",
    keywords: "",
    robots: "noindex,nofollow,noarchive",
  },
  magicbooking: {
    title: "Booking Route Moved | Après School",
    description: "Continue to the current Après School family booking system.",
    keywords: "Après School booking",
    robots: "noindex,nofollow",
  },
  "book-pebble": {
    title: "Booking Route Moved | Après School",
    description: "Continue to the current Après School family booking system.",
    keywords: "Après School booking",
    robots: "noindex,nofollow",
  },
  "booking/success": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
  "booking/cancel": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
  "booking/cancelled": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
  "booking/payment": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
  "booking/return": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
  "ponchopay/return": {
    title: "Payment Return | Après School Bookings",
    description: "Secure payment return for the Après School beta booking system.",
    keywords: "Après School booking payment return",
    robots: "noindex,nofollow",
  },
};
const hiddenRoutes = [`booking${"-lab"}`];
const crawlerContent = {
  "": ["Wraparound care and holiday camps children look forward to", "Après School provides breakfast clubs, after-school care, holiday camps and extended school provision for families and partner schools."],
  "holiday-clubs": ["Holiday clubs for active, creative school breaks", "Explore Après School holiday clubs at selected venues, with engaging activities, familiar routines and straightforward booking for families."],
  wraparound: ["Wraparound care that works for families and schools", "Après School provides dependable breakfast clubs and after-school care with child-first routines, active play and calmer choices."],
  schools: ["Extended school provision families can rely on", "Partner with Après School for wraparound care, holiday clubs and operational support designed around your school community."],
  payments: ["Payments for Après School bookings", "Find clear information about paying for wraparound care and holiday clubs through the Après School family booking system."],
  cancellations: ["Booking cancellations and account credit", "Review how to manage eligible booking changes and cancellations through your Après School family account."],
  policies: ["Policies, safeguarding and family assurance", "Read about the safeguarding, safer recruitment, behaviour, health and safety, privacy and complaints standards behind Après School provision."],
  contact: ["Contact Après School", "Get help with a family booking, ask about a school partnership or contact the Après School team."],
  "staff-application": ["Apply to work with Après School", "Find out about joining the Après School team and supporting children across our wraparound care and holiday programmes."],
};
const prerenderedPages = {
  "": "Home",
  "holiday-clubs": "Holiday Clubs",
  wraparound: "Wraparound",
  schools: "Schools",
  payments: "Payments",
  cancellations: "Cancellations",
  policies: "Policies",
  contact: "Contact",
  "staff-application": "Staff Application",
};
const prerenderedHtml = new Map();

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}

function crawlerHtmlForRoute(route) {
  if (prerenderedHtml.has(route)) {
    return `<!-- crawler-content:start -->\n      ${prerenderedHtml.get(route)}\n      <!-- crawler-content:end -->`;
  }
  const [heading, summary] = crawlerContent[route] || [routeMeta[route]?.title || "Après School", routeMeta[route]?.description || "Après School public information."];
  return `<!-- crawler-content:start -->
      <main style="font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:24px;color:#172b6d">
        <nav aria-label="Public site pages" style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:32px">
          <a href="/">Home</a><a href="/holiday-clubs">Holiday Clubs</a><a href="/wraparound">Wraparound Care</a><a href="/schools">Schools</a><a href="/payments">Payments</a><a href="/policies">Policies</a><a href="/contact">Contact</a>
        </nav>
        <h1>${escapeAttribute(heading)}</h1>
        <p>${escapeAttribute(summary)}</p>
        <p><a href="/launch-booking">Make a booking</a> or <a href="/contact">contact Après School</a>.</p>
      </main>
      <!-- crawler-content:end -->`;
}

function htmlForRoute(route, html) {
  const meta = routeMeta[route] || routeMeta[""];
  const url = `https://www.apres-school.co.uk/${route}`.replace(/\/$/, "/");
  const routeHtml = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeAttribute(meta.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeAttribute(meta.description)}" />`)
    .replace(/<meta\s+name="keywords"\s+content="[^"]*"\s*\/>/, `<meta name="keywords" content="${escapeAttribute(meta.keywords)}" />`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/, `<link rel="canonical" href="${escapeAttribute(url)}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeAttribute(meta.title)}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeAttribute(meta.description)}" />`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/, `<meta property="og:url" content="${escapeAttribute(url)}" />`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escapeAttribute(meta.title)}" />`)
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeAttribute(meta.description)}" />`)
    .replace(/<script\s+id="apres-structured-data"\s+type="application\/ld\+json">[\s\S]*?<\/script>/, () => {
      const data = structuredDataForPath(route ? `/${route}` : "/");
      return data ? `<script id="apres-structured-data" type="application/ld+json">${serializeStructuredData(data)}</script>` : "";
    })
    .replace(/<!-- crawler-content:start -->[\s\S]*?<!-- crawler-content:end -->/, crawlerHtmlForRoute(route));
  return meta.robots
    ? routeHtml.replace("</head>", `    <meta name="robots" content="${escapeAttribute(meta.robots)}" />\n  </head>`)
    : routeHtml;
}

const vite = await createViteServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const { renderStaticPublicPage } = await vite.ssrLoadModule("/src/staticRender.jsx");
  for (const [route, page] of Object.entries(prerenderedPages)) {
    prerenderedHtml.set(route, renderStaticPublicPage(page));
  }
} finally {
  await vite.close();
}

const indexHtml = await readFile(indexPath, "utf8");
await writeFile(indexPath, htmlForRoute("", indexHtml));

for (const route of hiddenRoutes) {
  await rm(path.join(distDir, `${route}.html`), { force: true });
  await rm(path.join(distDir, route), { recursive: true, force: true });
}

for (const route of routes) {
  const routeHtml = htmlForRoute(route, indexHtml);
  const routeFile = path.join(distDir, `${route}.html`);
  await mkdir(path.dirname(routeFile), { recursive: true });
  await writeFile(routeFile, routeHtml);
  const routeDir = path.join(distDir, route);
  await mkdir(routeDir, { recursive: true });
  await writeFile(path.join(routeDir, "index.html"), routeHtml);
}

await Promise.all([
  copyFile(path.resolve("robots.txt"), path.join(distDir, "robots.txt")),
  copyFile(path.resolve("sitemap.xml"), path.join(distDir, "sitemap.xml")),
]);

console.log(`Created static entry files for ${routes.length} routes, including ${prerenderedHtml.size} fully prerendered public pages, plus robots.txt and sitemap.xml.`);
