const SITE_ORIGIN = "https://www.apres-school.co.uk";

const publicPages = [
  "/",
  "/bookings",
  "/holiday-clubs",
  "/wraparound",
];

const requiredBundleFragments = [
  {
    label: "Magicbooking login",
    fragment: "https://apres-school.magicbooking.co.uk/Identity/Account/Login",
  },
  {
    label: "King's House Pebble activity",
    fragment: "dc0775cd-5399-4810-b271-d03f7ccc81ba",
  },
  {
    label: "The Rowans Pebble activity",
    fragment: "b1b01598-0d9a-49a2-9100-d4cb1ed322a5",
  },
  {
    label: "Shrewsbury House Pebble activity",
    fragment: "5803947a-423c-42d3-963e-736800789a68",
  },
];

const forbiddenBundleFragments = [
  {
    label: "generic Pebble homepage",
    fragment: '"https://activities.bookpebble.co.uk/"',
  },
];

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

async function fetchStatus(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });
  return response.status;
}

function unique(values) {
  return [...new Set(values)];
}

function extractBundlePath(html) {
  return html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] || null;
}

function extractBookingUrls(bundle) {
  return unique(bundle.match(/https:\/\/[^"`')\s]+(?:magicbooking|bookpebble)[^"`')\s]*/g) || []).sort();
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

const bookingUrls = extractBookingUrls(bundle);
if (!bookingUrls.length) {
  throw new Error("No external booking URLs were found in the live app bundle");
}

for (const url of bookingUrls) {
  const status = await fetchStatus(url);
  if (status >= 400) {
    throw new Error(`${url} returned ${status}`);
  }
}

console.log("Public booking link audit passed");
console.table(bookingUrls.map((url) => ({ url })));
