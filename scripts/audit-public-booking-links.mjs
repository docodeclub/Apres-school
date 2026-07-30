const SITE_ORIGIN = "https://www.apres-school.co.uk";

const publicPages = [
  "/",
  "/bookings",
  "/magicbooking",
  "/book-pebble",
  "/holiday-clubs",
  "/wraparound",
  "/launch-booking",
];

const requiredBundleFragments = [
  {
    label: "family booking route",
    fragment: "/launch-booking",
  },
];

const forbiddenBundleFragments = [
  {
    label: "Magicbooking URL",
    fragment: "https://apres-school.magicbooking.co.uk",
  },
  {
    label: "Book Pebble URL",
    fragment: "https://activities.bookpebble.co.uk",
  },
];

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function unique(values) {
  return [...new Set(values)];
}

function extractBundlePath(html) {
  return html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] || null;
}

const cacheBust = Date.now();
const pageHtml = new Map();

for (const page of publicPages) {
  const html = await fetchText(`${SITE_ORIGIN}${page}?booking-audit=${cacheBust}`);
  pageHtml.set(page, html);
  if (!html.includes("<div id=\"root\">")) {
    throw new Error(`${page} does not look like the Après School app shell`);
  }
}

const bundlePaths = unique([...pageHtml.values()].map(extractBundlePath).filter(Boolean));

if (bundlePaths.length !== 1) {
  throw new Error(`Expected one shared app bundle, found ${bundlePaths.length}: ${bundlePaths.join(", ")}`);
}

const bundleUrl = `${SITE_ORIGIN}${bundlePaths[0]}`;
const bundle = await fetchText(bundleUrl);

for (const required of requiredBundleFragments) {
  if (!bundle.includes(required.fragment)) {
    throw new Error(`Missing required booking link: ${required.label}`);
  }
}

for (const forbidden of forbiddenBundleFragments) {
  if (bundle.includes(forbidden.fragment)) {
    throw new Error(`Forbidden booking link still present: ${forbidden.label}`);
  }
}

console.log("Public booking link audit passed");
console.table(publicPages.map((path) => ({ path, appShell: true })));
