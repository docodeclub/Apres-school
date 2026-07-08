import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  "booking-lab",
  "policies",
  "contact",
  "staff-application",
  "staff-login",
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
  "staff-login": {
    title: "Staff Login | Après School",
    description: "Secure staff and admin login for Après School.",
    keywords: "Après School staff login",
    robots: "noindex,nofollow",
  },
  "launch-booking": {
    title: "Beta Booking System | Après School",
    description: "Private beta booking flow for Après School wraparound care and holiday camp testing.",
    keywords: "Après School beta booking, wraparound booking, holiday camp booking",
    robots: "noindex,nofollow",
  },
  "booking-lab": {
    title: "Booking Lab | Après School",
    description: "Private booking system lab for Après School testing.",
    keywords: "Après School booking lab",
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

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
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
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeAttribute(meta.description)}" />`);
  return meta.robots
    ? routeHtml.replace("</head>", `    <meta name="robots" content="${escapeAttribute(meta.robots)}" />\n  </head>`)
    : routeHtml;
}

const indexHtml = await readFile(indexPath, "utf8");
await writeFile(indexPath, htmlForRoute("", indexHtml));

for (const route of routes) {
  const routeHtml = htmlForRoute(route, indexHtml);
  const routeFile = path.join(distDir, `${route}.html`);
  await mkdir(path.dirname(routeFile), { recursive: true });
  await writeFile(routeFile, routeHtml);
  const routeDir = path.join(distDir, route);
  await mkdir(routeDir, { recursive: true });
  await writeFile(path.join(routeDir, "index.html"), routeHtml);
}

console.log(`Created static entry files for ${routes.length} public routes.`);
