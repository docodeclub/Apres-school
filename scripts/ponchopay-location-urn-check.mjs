import { labSessions } from "../src/bookingLab/labData.js";
import {
  PONCHOPAY_LOCATION_PENDING,
  PONCHOPAY_LOCATION_URNS,
  ponchoLocationStatusForSite,
  ponchoLocationUrnForSite,
} from "../src/bookingLab/ponchoLocations.js";

const launchSites = [...new Set(
  labSessions
    .filter((session) => session.academicYear === "2026/27" && /ponchopay/i.test(session.paymentRoute || ""))
    .map((session) => session.site)
    .filter(Boolean),
)].sort();

const rows = launchSites.map((site) => ({
  site,
  status: ponchoLocationStatusForSite(site),
  urn: ponchoLocationUrnForSite(site) || null,
}));

const configured = rows.filter((row) => row.status === "configured");
const pending = rows.filter((row) => row.status === "pending");
const unexpectedMissing = rows.filter((row) => row.status !== "configured" && !PONCHOPAY_LOCATION_PENDING.includes(row.site));

const report = {
  ponchoPayLocationUrnsReady: unexpectedMissing.length === 0,
  configured: `${configured.length}/${rows.length}`,
  knownUrns: PONCHOPAY_LOCATION_URNS,
  pending: pending.map((row) => row.site),
  unexpectedMissing: unexpectedMissing.map((row) => row.site),
  rows,
};

console.log(JSON.stringify(report, null, 2));
if (unexpectedMissing.length) process.exitCode = 1;

