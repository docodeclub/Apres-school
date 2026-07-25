import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.jsx", import.meta.url), "utf8");
const bookingLabSource = await readFile(new URL("../src/BookingLab.jsx", import.meta.url), "utf8");

const wraparoundSchools = [
  "Willington Prep",
  "King's House School",
  "Shrewsbury House School",
  "Ripley Court",
];

const checks = [
  ["internal launch-booking route builder", appSource.includes("/launch-booking?school=${encodeURIComponent(school)}")],
  ["school query parameter is read", bookingLabSource.includes('new URLSearchParams(window.location.search).get("school")')],
  ["unknown school parameters are rejected", bookingLabSource.includes("labSessions.some((session) => session.site === requestedSchool)")],
  ["requested school controls the active session", bookingLabSource.includes("requestedLaunchSessionId()")],
  ["requested school survives signed-in account hydration", bookingLabSource.includes("const bookingSchool = launchRequestedSchool || hydratedFamily.registeredCentre")],
  ["login gate confirms the requested school", bookingLabSource.includes("is ready and will stay selected after you sign in")],
  ["homepage finder reuses the canonical booking routes", appSource.includes("const homeBookingRoutes = bookingSites.map")],
  ["homepage finder uses an internal Start booking CTA", appSource.includes('aria-label={`Start an Après School booking for ${selectedHomeSite.title}`}')],
  ["parent FAQ directs wraparound families to the family booking system", appSource.includes("Wraparound care opens the Après School family booking system with your school selected")],
  ["payments page describes secure PonchoPay checkout", appSource.includes("Wraparound bookings use secure PonchoPay checkout")],
  ["cancellations page directs families to their Après account", appSource.includes('["Après School family account", "Breakfast club and after-school care."')],
  ["legacy term-time Magicbooking claim is removed", !appSource.includes("Magicbooking is used for most term-time care")],
  ["legacy generic wraparound claim is removed", !appSource.includes("Most wraparound care uses Magicbooking")],
  ["holiday-camp Pebble routes remain present", appSource.includes("PEBBLE_KINGS_URL") && appSource.includes("PEBBLE_ROWANS_URL") && appSource.includes("PEBBLE_SHREWSBURY_URL")],
  ...wraparoundSchools.map((school) => [
    `${school} uses the family booking journey`,
    appSource.includes(`url: launchBookingPath("${school.replaceAll('"', '\\"')}")`),
  ]),
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length) {
  console.error("Wraparound CTA contract failed:");
  failed.forEach(([label]) => console.error(`- ${label}`));
  process.exit(1);
}

console.log(`Wraparound CTA contract passed (${checks.length} checks)`);
