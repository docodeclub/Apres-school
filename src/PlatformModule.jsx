import { useEffect, useRef, useState } from "react";
import {
  bookingSystemConfigured,
  cancelStaffAdHocBooking,
  appendSafeguardingCaseEntry,
  completeSafeguardingCaseTask,
  createSafeguardingCaseTask,
  createSafeguardingConcern,
  createStaffAdHocBooking,
  createStaffRegisterReport,
  createStaffRegisterReward,
  fetchAdminBookingLedger,
  fetchAdminRewardsDashboard,
  fetchRegisterPupilReports,
  fetchSafeguardingCase,
  fetchSafeguardingCases,
  fetchStaffAdHocBookingOptions,
  fetchStaffChildActivityTimeline,
  fetchStaffRegister,
  fetchStaffRegisterTimetable,
  readSafeguardingDraft,
  saveSafeguardingDraft,
  updateSafeguardingCase,
  uploadSafeguardingAttachments,
  updateRegisterPupilReport,
  updateLivePaymentAdminAction,
  updateStaffRegisterEntry,
  upsertLiveBookingSessionOverride,
  upsertLiveBookingSessionSetup,
} from "./bookingSystem.js";
import { REWARD_BADGES, rewardBadge } from "./rewardBadges.js";
import {
  blockingPeriods,
  bookingGroups,
  schoolCalendarKeyForSite,
  teachingWindows,
} from "./bookingLab/schoolCalendars2026.js";

const willingtonAutumnTerm = bookingGroups("willington").terms.find((term) => term.term === "autumn")
  || bookingGroups("willington").terms[0];
const defaultBookingAdminDateFrom = willingtonAutumnTerm?.start || "";
const defaultBookingAdminDateTo = willingtonAutumnTerm?.end || "";

function canonicalTeachingSegments(school, dateFrom, dateTo) {
  const calendarKey = schoolCalendarKeyForSite(school);
  if (!calendarKey || !dateFrom || !dateTo || dateTo < dateFrom) return [];
  const shiftIsoDate = (date, days) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const containsWeekday = ({ dateFrom: start, dateTo: end }) => {
    for (let date = start; date <= end; date = shiftIsoDate(date, 1)) {
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (day >= 1 && day <= 5) return true;
    }
    return false;
  };
  let segments = teachingWindows(calendarKey)
    .map((window) => ({
      dateFrom: window.start > dateFrom ? window.start : dateFrom,
      dateTo: window.end < dateTo ? window.end : dateTo,
    }))
    .filter((window) => window.dateFrom <= window.dateTo);
  for (const blocked of blockingPeriods(calendarKey).filter((period) => period.end)) {
    segments = segments.flatMap((segment) => {
      if (blocked.end < segment.dateFrom || blocked.start > segment.dateTo) return [segment];
      const before = blocked.start > segment.dateFrom
        ? [{ ...segment, dateTo: shiftIsoDate(blocked.start, -1) }]
        : [];
      const after = blocked.end < segment.dateTo
        ? [{ ...segment, dateFrom: shiftIsoDate(blocked.end, 1) }]
        : [];
      return [...before, ...after];
    });
  }
  return segments.filter(containsWeekday);
}

function isCanonicalTeachingDate(school, date) {
  const calendarKey = schoolCalendarKeyForSite(school);
  if (!calendarKey || !date) return false;
  const insideTeaching = teachingWindows(calendarKey).some((window) => date >= window.start && date <= window.end);
  const blocked = blockingPeriods(calendarKey).some((period) => period.end && date >= period.start && date <= period.end);
  return insideTeaching && !blocked;
}

const hasSupabaseConfig = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
let supabaseModulePromise;

function isDynamicImportError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}

function recoverFromDynamicImportError(error) {
  if (typeof window === "undefined" || !isDynamicImportError(error)) {
    throw error;
  }

  const storageKey = "apres-dynamic-import-reload";
  const lastReload = Number(sessionStorage.getItem(storageKey) || 0);
  if (Date.now() - lastReload < 15000) {
    throw error;
  }

  sessionStorage.setItem(storageKey, String(Date.now()));
  const url = new URL(window.location.href);
  url.searchParams.set("refresh", String(Date.now()));
  window.location.replace(url.toString());
  return new Promise(() => {});
}

function loadSupabaseModule() {
  supabaseModulePromise ||= import("./supabaseClient.js").catch((error) => {
    supabaseModulePromise = undefined;
    return recoverFromDynamicImportError(error);
  });
  return supabaseModulePromise;
}

function getLocalEnquiries() {
  try {
    return JSON.parse(localStorage.getItem("apres-enquiries") || "[]");
  } catch {
    return [];
  }
}

function makeIcon(label) {
  return function Icon({ size = 22 }) {
    const paths = {
      AW: <><path d="M8 5h8v4a4 4 0 0 1-8 0V5Z" /><path d="M6 7H4a3 3 0 0 0 4 4" /><path d="M18 7h2a3 3 0 0 1-4 4" /><path d="M12 13v4" /><path d="M9 19h6" /></>,
      "!": <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
      BK: <><path d="M5 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H5V5Z" /><path d="M19 5h-5a3 3 0 0 0-3 3" /><path d="M19 5v11h-5a3 3 0 0 0-3 3" /></>,
      CA: <><path d="M7 3v4" /><path d="M17 3v4" /><path d="M4 8h16" /><rect x="4" y="5" width="16" height="16" rx="3" /></>,
      OK: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></>,
      ">": <path d="m9 6 6 6-6 6" />,
      CL: <><path d="M9 5h6" /><path d="M9 3h6v4H9z" /><rect x="5" y="5" width="14" height="16" rx="3" /><path d="m8.5 14 2 2 4.5-5" /></>,
      TI: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
      DL: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
      FI: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
      DB: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
      LK: <><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v2" /></>,
      "@": <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
      ME: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
      GBP: <><path d="M16 6a4 4 0 0 0-7 3v8" /><path d="M7 12h7" /><path d="M7 18h10" /></>,
      SE: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
      SH: <><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
      "*": <><path d="M12 3v5" /><path d="M12 16v5" /><path d="M3 12h5" /><path d="M16 12h5" /><path d="m6 6 3 3" /><path d="m15 15 3 3" /><path d="m18 6-3 3" /><path d="m9 15-3 3" /></>,
      ST: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
      UP: <><path d="M12 20V9" /><path d="m7 14 5-5 5 5" /><path d="M5 4h14" /></>,
      US: <><path d="M16 20v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="8" r="4" /><path d="M20 20v-2a3 3 0 0 0-3-3" /><path d="M4 20v-2a3 3 0 0 1 3-3" /></>,
      MD: <><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" /></>,
      SN: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="7" r="3" /><circle cx="12" cy="17" r="3" /><path d="m9 9 2 5" /><path d="m15 9-2 5" /></>,
      X: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
      default: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></>,
    };
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {paths[label] || paths.default}
      </svg>
    );
  };
}

const Award = makeIcon("AW");
const Bell = makeIcon("!");
const BookOpen = makeIcon("BK");
const CalendarDays = makeIcon("CA");
const CheckCircle2 = makeIcon("OK");
const ChevronRight = makeIcon(">");
const ClipboardCheck = makeIcon("CL");
const Clock = makeIcon("TI");
const Download = makeIcon("DL");
const FileText = makeIcon("FI");
const LayoutDashboard = makeIcon("DB");
const LockKeyhole = makeIcon("LK");
const Mail = makeIcon("@");
const Menu = makeIcon("ME");
const PoundSterling = makeIcon("GBP");
const Search = makeIcon("SE");
const ShieldCheck = makeIcon("SH");
const Sparkles = makeIcon("*");
const Star = makeIcon("ST");
const Upload = makeIcon("UP");
const Users = makeIcon("US");
const MedicalCross = makeIcon("MD");
const SendNeeds = makeIcon("SN");
const X = makeIcon("X");


const platformTabs = ["Staff", "Admin", "Customer Profiles", "Bookings", "Registers", "Incidents", "Safeguarding", "Booking Payments", "Finance", "Users", "HR", "HR Files", "Schools", "Rota", "Hours", "SCR", "Ofsted", "Documents", "Pay", "Rewards", "Sessions", "CRM", "Audit", "Settings"];
const platformGroups = [
  ["Today", ["Admin", "Staff"]],
  ["People", ["Customer Profiles", "Users", "SCR", "HR", "HR Files"]],
  ["Sites", ["Schools", "Bookings", "Registers", "Incidents", "Safeguarding", "Rota", "Hours", "Sessions", "Ofsted"]],
  ["Comms", ["Documents", "CRM"]],
  ["Finance", ["Finance", "Booking Payments", "Pay", "Rewards"]],
  ["System", ["Audit", "Settings"]],
];
const platformTabHints = {
  Staff: "Personal shifts, documents, pay and rewards",
  Admin: "Key actions across staffing, compliance and bookings",
  "Customer Profiles": "Review family records and manage parent account credit",
  Bookings: "Bookings, payments, capacity and admin-only setup controls",
  Registers: "Live attendance, collection, care alerts and emergency details",
  Incidents: "Review incidents, first aid and restricted safeguarding reports",
  Safeguarding: "Restricted DSL case management and chronology",
  "Booking Payments": "Parent balances, PonchoPay reconciliation, vouchers and refunds",
  Finance: "School invoices, customers, payments and credit notes",
  Users: "Invite staff and reset access",
  HR: "Reporting lines and manager structure",
  "HR Files": "Contracts, payslips and staff documents",
  Schools: "School sites, provision and operational notes",
  SCR: "Single Central Register and safer recruitment",
  Rota: "Site rota, cover and staffing requirements",
  Hours: "Approved hours, setup, session and clean-up time",
  Sessions: "Programmes, locations and assignments",
  Ofsted: "Inspection windows and site evidence",
  Documents: "Policies, acknowledgements and staff links",
  CRM: "School outreach and enquiries",
  Pay: "Rates, payroll and expenses",
  Rewards: "Staff recognition and achievements",
  Audit: "Important admin activity",
  Settings: "Platform preferences and controls",
};
const nextCamp = {
  title: "May Half Term Camp",
  dates: "26-29 May",
  sites: ["Willington Prep", "The Rowans", "King's House School"],
};
const payrollHoursStorageKey = "apres-payroll-hours";
const payrollRunsStorageKey = "apres-payroll-runs";
const staffPayOverridesStorageKey = "apres-staff-pay-overrides";
const staffSiteOverridesStorageKey = "apres-staff-site-overrides";
const formerStaffStorageKey = "apres-former-staff";
const bookingAdminSetupStorageKey = "apres-booking-admin-setup";
const bookingAdminOverrideStorageKey = "apres-booking-admin-override";

function currentPayrollPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function formatPayrollPeriod(period) {
  if (!period) return "Current month";
  const [year, month] = String(period).split("-");
  if (!year || !month) return period;
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function validPayrollPeriod(period) {
  return /^(20\d{2})-(0[1-9]|1[0-2])$/.test(String(period || ""));
}

function formatCurrency(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function monthlySalaryFromAnnual(value) {
  return Number(value || 0) / 12;
}

function mergePayrollHourRecords(remote = {}, local = {}) {
  const periods = new Set([...Object.keys(remote || {}), ...Object.keys(local || {})]);
  return Array.from(periods).reduce((merged, period) => {
    const schools = new Set([...Object.keys(remote?.[period] || {}), ...Object.keys(local?.[period] || {})]);
    merged[period] = Array.from(schools).reduce((schoolRecords, school) => {
      const remoteRecord = remote?.[period]?.[school];
      const localRecord = local?.[period]?.[school];
      if (!remoteRecord) {
        schoolRecords[school] = localRecord;
        return schoolRecords;
      }
      if (!localRecord) {
        schoolRecords[school] = remoteRecord;
        return schoolRecords;
      }
      if (localRecord.localDraft) {
        schoolRecords[school] = localRecord;
        return schoolRecords;
      }
      const remoteTime = new Date(remoteRecord.updatedAt || remoteRecord.submittedAt || 0).getTime() || 0;
      const localTime = new Date(localRecord.updatedAt || localRecord.submittedAt || 0).getTime() || 0;
      schoolRecords[school] = localTime >= remoteTime ? localRecord : remoteRecord;
      return schoolRecords;
    }, {});
    return merged;
  }, {});
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function staffAssignments(person) {
  const activeStatuses = new Set(["", "Active", "Scheduled", "Cover"]);
  const isActiveAssignment = (assignment = {}) => {
    const status = assignment.status || "Active";
    return activeStatuses.has(status) && !assignment.endDate;
  };
  if (Array.isArray(person?.siteAssignments) && person.siteAssignments.length) {
    return person.siteAssignments.filter(isActiveAssignment);
  }
  if (person?.location) return [{ school: person.location, role: person.role, startDate: "", endDate: "", status: "Active" }];
  return [];
}

function canonicalSchoolName(value) {
  const text = String(value || "").trim();
  const normalised = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const aliases = {
    "kings house": "King's House School",
    "kings house school": "King's House School",
    "ripley court": "Ripley Court School",
    "ripley court school": "Ripley Court School",
    "shrewsbury house": "Shrewsbury House School",
    "shrewsbury house school": "Shrewsbury House School",
    "willington": "Willington Prep",
    "willington prep": "Willington Prep",
    "holiday camp": "Holiday Camp",
  };
  return aliases[normalised] || text;
}

function sortPayrollSites(a, b) {
  const order = ["Willington Prep", "King's House School", "Shrewsbury House School", "Ripley Court School", "Holiday Camp"];
  const aIndex = order.indexOf(a);
  const bIndex = order.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  return a.localeCompare(b);
}

function staffSchoolNames(person) {
  return staffAssignments(person).map((assignment) => canonicalSchoolName(assignment.school)).filter(Boolean);
}

function staffPrimaryLocation(person) {
  const assignments = staffAssignments(person);
  if (!assignments.length) return "Unassigned";
  if (assignments.length === 1) return assignments[0].school;
  return `${assignments[0].school} +${assignments.length - 1}`;
}

function staffAssignedToSchool(person, school) {
  return staffSchoolNames(person).includes(canonicalSchoolName(school));
}

function staffMatchesSchoolScope(person, school) {
  if (!school) return true;
  return staffAssignedToSchool(person, school);
}

function ofstedSiteForSchool(school) {
  const canonical = canonicalSchoolName(school);
  return ofstedSites.find((site) => canonicalSchoolName(site.school) === canonical) || null;
}

function isFormerStaffRecord(person = {}) {
  return Boolean(person.formerRecord || person.archivedAt || person.leftAt || person.status === "Former staff");
}

function staffOptionLabel(staff) {
  const parts = [
    staff.fullName || staff.name,
    staff.email,
    staffPrimaryLocation(staff),
  ].filter(Boolean);
  return parts.join(" · ");
}

function payrollRecordStatus(record) {
  if (!record) return "Not started";
  if (record.localDraft) return "Local draft";
  return record.status || "Draft";
}

function staffIdentityFromEmail(email, role = "Staff") {
  const normalized = String(email || "").trim().toLowerCase();
  const known = {
    "luke@apres-school.co.uk": { name: "Luke Currie", role: "Managing Director" },
    "lindsay@apres-school.co.uk": { name: "Lindsay", role: "General Manager" },
    "kelly@apres-school.co.uk": { name: "Kelly", role: "Operations and Parent Improvement Manager" },
  };
  const mapped = known[normalized];
  const fallbackName = normalized
    ? normalized.split("@")[0].split(/[._-]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ")
    : "Staff member";
  return {
    id: `account-${normalized || "current"}`,
    profileId: `account-${normalized || "current"}`,
    name: mapped?.name || fallbackName,
    email: normalized,
    role: mapped?.role || role,
    accessRole: role,
    location: "Leadership",
    compliance: "Account only",
    contractType: "Not recorded",
  };
}

function resolveOwnStaffRecord(data, access, userEmail) {
  const current = access?.currentUser || {};
  const email = String(current.email || userEmail || "").toLowerCase();
  return data.staff.find((person) => person.id === current.staffRecordId)
    || data.staff.find((person) => person.profileId && person.profileId === current.id)
    || data.staff.find((person) => person.id === current.id)
    || data.staff.find((person) => String(person.email || "").toLowerCase() === email)
    || staffIdentityFromEmail(email, access?.role || current.role || "Staff");
}

function hasValidDate(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || ["pending", "not required", "not recorded", "missing", "unknown", "evidence to review"].includes(text)) return false;
  return true;
}

function staffMeetsRequirement(person, requirement) {
  if (requirement === "firstAid") return hasValidDate(person.firstAidExpiry);
  if (requirement === "eyfs") return String(person.eyfsLevel || person.role || "").toLowerCase().includes("level 3") || String(person.role || "").toLowerCase().includes("manager");
  if (requirement === "safeguarding") {
    const evidence = person.scrChecklist?.evidence?.safeguarding || {};
    return hasValidDate(person.safeguardingExpiry)
      || Boolean(evidence.reference && (evidence.noExpiryShown || evidence.noExpiryStated || evidence.status === "Approved" || evidence.storagePath));
  }
  if (requirement === "allergy") return hasValidDate(person.allergyAwarenessExpiry);
  return false;
}

function evidenceFor(person, key) {
  return person?.scrChecklist?.evidence?.[key] || {};
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not recorded";
}

function ofstedDbsPrintSummary(person) {
  const evidence = evidenceFor(person, "dbs");
  const number = firstText(
    evidence.dbsNumber,
    evidence.enhancedDbsNumber,
    evidence.certificateNumber,
    evidence.number,
    evidence.reference,
  );
  const result = firstText(evidence.result, evidence.dbsResult, evidence.status);
  const renewal = firstText(evidence.renewalDate, evidence.expiryDate, person.dbsRenewal);
  return [
    number ? `No. ${number}` : "Number not recorded",
    result ? `Result: ${result}` : "",
    renewal ? `Renewal/review: ${formatShortDate(renewal)}` : "",
  ].filter(Boolean).join("\n");
}

function ofstedReferencePrintSummary(person) {
  const evidence = evidenceFor(person, "references");
  const names = Array.isArray(evidence.references)
    ? evidence.references.map((reference) => reference.organisation ? `${reference.name} (${reference.organisation})` : reference.name).filter(Boolean)
    : Array.isArray(evidence.referenceNames)
      ? evidence.referenceNames.filter(Boolean)
      : [];
  const checked = firstText(evidence.checkedAt, evidence.dateSeen, evidence.verifiedAt);
  return [
    evidence.referencesReceived || evidence.referenceCount ? `${evidence.referenceCount || 2} received` : "Not recorded",
    names.length ? names.join("; ") : "",
    checked ? `Checked ${formatShortDate(checked)}` : "",
    `Would employ again: ${yesNo(evidence.wouldReemploy ?? evidence.wouldEmployAgain)}`,
    `Safeguarding concerns: ${yesNo(evidence.safeguardingConcerns)}`,
    `Children role: ${yesNo(evidence.recommendedForChildren ?? evidence.recommendForChildrenRole)}`,
  ].filter(Boolean).join("\n");
}

function ofstedTrainingPrintSummary(person, key, fallbackDate, label) {
  const evidence = evidenceFor(person, key);
  const certificate = firstText(evidence.reference, evidence.fileName, evidence.title);
  const date = firstText(evidence.completedAt, evidence.dateSeen, evidence.issueDate);
  const expiry = firstText(evidence.expiryDate, fallbackDate);
  const noExpiry = evidence.noExpiryShown || evidence.noExpiryStated;
  return [
    certificate || label,
    date ? `Completed/seen: ${formatShortDate(date)}` : "",
    noExpiry ? "No expiry shown" : expiry ? `Review: ${formatShortDate(expiry)}` : "Review not recorded",
  ].filter(Boolean).join("\n");
}

function ofstedFirstAidEyfsSummary(person) {
  const firstAid = ofstedTrainingPrintSummary(person, "firstAid", person.firstAidExpiry, "First aid");
  const eyfsEvidence = evidenceFor(person, "eyfsLevel");
  const eyfs = firstText(person.eyfsLevel, eyfsEvidence.reference, eyfsEvidence.level, eyfsEvidence.status);
  return [`First aid: ${firstAid}`, `EYFS: ${eyfs || "Not recorded"}`].join("\n");
}

function ofstedScrEvidenceScore(person) {
  const checks = [
    Boolean(person.scrChecklist?.dbs || evidenceFor(person, "dbs").reference || evidenceFor(person, "dbs").number || evidenceFor(person, "dbs").dbsNumber),
    Boolean(person.scrChecklist?.barredList || evidenceFor(person, "barredList").reference || evidenceFor(person, "barredList").status),
    Boolean(person.scrChecklist?.rightToWork || evidenceFor(person, "rightToWork").reference || evidenceFor(person, "rightToWork").status),
    Boolean(person.scrChecklist?.identity || evidenceFor(person, "identity").reference || evidenceFor(person, "identity").status),
    Boolean(person.scrChecklist?.safeguarding || staffMeetsRequirement(person, "safeguarding")),
    Boolean(person.scrChecklist?.allergy || staffMeetsRequirement(person, "allergy")),
    Boolean(person.scrChecklist?.references || evidenceFor(person, "references").referencesReceived || evidenceFor(person, "references").referenceCount),
    Boolean(person.scrChecklist?.firstAid || staffMeetsRequirement(person, "firstAid")),
    Boolean(person.scrChecklist?.eyfsLevel || staffMeetsRequirement(person, "eyfs")),
  ];
  const ready = checks.filter(Boolean).length;
  return `${ready}/${checks.length} key checks recorded`;
}

function evidenceExpiryStatus(evidence) {
  if (!evidence?.expiryDate) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${evidence.expiryDate}T00:00:00`);
  const days = Math.ceil((expiry - today) / 86400000);
  if (days < 0) return "Expired";
  if (days <= 60) return "Expiring soon";
  return "In date";
}

function evidenceExpiryDays(evidence) {
  if (!evidence?.expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${evidence.expiryDate}T00:00:00`);
  return Math.ceil((expiry - today) / 86400000);
}

function formatShortDate(value) {
  if (!value) return "";
  const parsed = new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function normaliseAuditText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function staffDisclosureText(person = {}) {
  return normaliseAuditText([
    person.fullName,
    person.name,
    person.email,
    person.role,
    person.location,
    person.dateOfBirth,
  ].filter(Boolean).join(" "));
}

function staffDbsNumber(person = {}) {
  return person.dbsNumber
    || person.scrChecklist?.dbsNumber
    || person.scrChecklist?.evidence?.dbs?.number
    || person.scrChecklist?.evidence?.dbs?.dbsNumber
    || person.scrChecklist?.evidence?.dbs?.dbs_number
    || person.scrChecklist?.evidence?.dbs?.certificateNo
    || person.scrChecklist?.evidence?.dbs?.certificate_no
    || person.scrChecklist?.dbs?.number
    || person.scrChecklist?.dbs?.dbsNumber
    || person.scrChecklist?.dbs?.dbs_number
    || person.scrChecklist?.dbs?.certificateNo
    || person.scrChecklist?.dbs?.certificate_no
    || "";
}

function staffDbsUpdateServiceLabel(person = {}) {
  const evidence = person.scrChecklist?.evidence?.dbs || {};
  const direct = person.scrChecklist?.dbs || {};
  const status = evidence.updateServiceStatus
    || evidence.update_service_status
    || direct.updateServiceStatus
    || direct.update_service_status
    || "";
  const active = evidence.updateServiceActive
    ?? evidence.update_service_active
    ?? evidence.updateService
    ?? direct.updateServiceActive
    ?? direct.update_service_active
    ?? direct.updateService
    ?? false;
  if (active === true || String(status).toLowerCase() === "active") return "Update Service active";
  return status ? `Update Service ${status}` : "";
}

function staffDbsClearDate(person = {}) {
  const evidence = person.scrChecklist?.evidence?.dbs || {};
  const direct = person.scrChecklist?.dbs || {};
  return evidence.clearDate
    || evidence.clear_date
    || evidence.issueDate
    || evidence.issue_date
    || evidence.date
    || direct.clearDate
    || direct.clear_date
    || direct.issueDate
    || direct.issue_date
    || direct.date
    || "";
}

function staffInspectionEvidenceLinks(person = {}, evidenceRows = []) {
  const row = evidenceRows.find((item) => item.person?.id === person.id);
  if (!row?.checks?.length) return [];
  const priority = ["dbs", "safeguarding", "firstAid", "allergy", "eyfsLevel", "references", "annualSuitability"];
  const seen = new Set();
  return [...row.checks]
    .sort((a, b) => {
      const aIndex = priority.indexOf(a.key);
      const bIndex = priority.indexOf(b.key);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .filter((check) => check.file?.fileUrl)
    .filter((check) => {
      const key = `${check.key}-${check.file.fileUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((check) => ({
      key: check.key,
      label: check.label || check.key,
      href: check.file.fileUrl,
      title: check.file.title || check.detail || check.label,
    }));
}

function staffScrCheckedDate(person = {}) {
  const checklist = person.scrChecklist || {};
  const evidence = checklist.evidence || {};
  return checklist.approvedAt
    || checklist.checkedAt
    || checklist.updatedAt
    || evidence.adminReview?.checkedAt
    || evidence.dbs?.checkedAt
    || evidence.dbs?.verifiedAt
    || evidence.safeguarding?.checkedAt
    || evidence.safeguarding?.verifiedAt
    || "";
}

function scoreDisclosureStaff(row, person) {
  const haystack = staffDisclosureText(person);
  let score = 0;
  row.terms.forEach((term) => {
    if (haystack.includes(normaliseAuditText(term))) score += 12;
  });
  if (person.dateOfBirth && person.dateOfBirth === row.dob) score += 25;
  if (haystack.includes(normaliseAuditText(row.surname))) score += 8;
  return score;
}

function resolveDbsDisclosureRow(row, staff = []) {
  const candidates = staff
    .map((person) => ({ person, score: scoreDisclosureStaff(row, person), currentDbs: staffDbsNumber(person) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return { status: "unmatched", row, candidates: [] };
  if (second && second.score === best.score) {
    return { status: "ambiguous", row, candidates: candidates.filter((candidate) => candidate.score === best.score) };
  }
  const currentDbs = best.currentDbs;
  return {
    status: currentDbs === row.certificateNo ? "updated" : currentDbs ? "different-current-dbs" : "matched-missing-dbs",
    row,
    person: best.person,
    currentDbs,
    score: best.score,
  };
}

function buildDbsDisclosureAudit(staff = []) {
  const results = dbsDisclosureRows.map((row) => resolveDbsDisclosureRow(row, staff));
  const summary = results.reduce((totals, result) => ({
    ...totals,
    [result.status]: (totals[result.status] || 0) + 1,
  }), {});
  return {
    results,
    summary,
    attentionCount: results.filter((result) => result.status !== "updated").length,
  };
}

function staffProfileFromApplication(application, id) {
  const school = application.preferredSchool || "Assignment needed";
  return {
    id,
    profileId: id,
    applicationId: application.id,
    name: application.name,
    email: application.email,
    phone: application.phone,
    role: application.preferredRole || "Playworker",
    location: school,
    siteAssignments: school === "Assignment needed" ? [] : [{ school, role: application.preferredRole || "Staff", startDate: "", endDate: "", status: "Pending" }],
    compliance: "Missing evidence",
    onboardingStatus: "Pending SCR",
    dbsRenewal: application.dbsUpdateService === "Yes" ? "Update service to verify" : "Pending",
    safeguardingExpiry: "Pending",
    allergyAwarenessExpiry: "Pending",
    firstAidExpiry: application.firstAidDetails ? "Evidence to review" : "Not required",
    eyfsLevel: application.qualifications?.toLowerCase().includes("level 3") ? "Level 3" : "",
    payRate: 0,
    startDate: "",
    address: application.address,
    dateOfBirth: application.dateOfBirth,
    rightToWork: application.rightToWork,
    rightToWorkType: application.rightToWorkType,
    references: application.references,
    employmentHistory: application.employmentHistory,
    employmentGaps: application.employmentGaps,
    criminalDisclosure: application.criminalDisclosure,
    barredListDisclosure: application.barredListDisclosure,
    medicalFitness: application.medicalFitness,
    livedAbroad: application.livedAbroad,
    source: "approved onboarding",
  };
}

function mergeStaffProfiles(staff, localStaff) {
  const existingIds = new Set(staff.map((person) => person.id));
  return [...staff, ...localStaff.filter((person) => !existingIds.has(person.id))];
}


const crmStatuses = ["New", "Prospect", "Contacted", "Follow up", "Responded", "Meeting", "Proposal", "Partner school", "Closed"];
const crmOwners = ["Unassigned", "Ops Lead", "School Partnerships", "Recruitment", "Finance"];
const crmStorageKey = "apres-crm-updates";
const userStorageKey = "apres-user-admin";
const userRoles = ["Staff", "Manager", "Admin", "Superadmin"];
const hierarchyStorageKey = "apres-hr-hierarchy";
const auditStorageKey = "apres-audit-log";
const rotaStorageKey = "apres-rota-assignments";
const coverMoveStorageKey = "apres-cover-moves";
const publicSettingsStorageKey = "apres-public-settings";
const documentLinksStorageKey = "apres-document-links";
const staffApplicationsStorageKey = "apres-staff-applications";
const onboardedStaffStorageKey = "apres-onboarded-staff";
const scrChecklistStorageKey = "apres-scr-checklists";
const scrRenewalRequestsStorageKey = "apres-scr-renewal-requests";
const staffProfileNotesStorageKey = "apres-staff-profile-notes";
const ofstedLogsStorageKey = "apres-ofsted-site-logs";
const ofstedInspectionDayStorageKey = "apres-ofsted-inspection-day";
const ofstedGapOwnersStorageKey = "apres-ofsted-gap-owners";
const scrEvidenceRequestOptions = [
  ["dbs", "Enhanced DBS"],
  ["safeguarding", "Safeguarding"],
  ["allergy", "Allergy awareness"],
  ["firstAid", "First aid"],
  ["eyfsLevel", "EYFS Level 3"],
  ["rightToWork", "Right to work"],
  ["identity", "Identity / address"],
  ["barredList", "Barred list"],
  ["references", "References"],
  ["declarations", "Annual declarations"],
];
const suitabilityDeclarationStatements = [
  ["medicalFit", "I remain medically fit to work with children."],
  ["noHealthCondition", "I am not aware of any physical or mental health condition that affects my suitability to work with children."],
  ["noCriminalChange", "I have not received any criminal caution, conviction, reprimand or warning since my last declaration that may affect my suitability to work with children."],
  ["notDisqualified", "I have not become disqualified from working with children under the Childcare Act 2006 or any other relevant legislation."],
  ["dbsUpdateActive", "My DBS Update Service subscription remains active, where applicable."],
  ["notifyChanges", "I understand I must notify Après School immediately if my DBS status or suitability changes."],
  ["readSafeguardingPolicy", "I have read and understood the current Safeguarding Policy."],
  ["knowDsl", "I know who the DSL and Deputy DSL are."],
  ["safeguardingEveryone", "I understand safeguarding is everyone’s responsibility."],
  ["readCorePolicies", "I have read and agree to follow the current Code of Conduct, Behaviour Policy, Health & Safety Policy, Mobile Phone & Camera Policy and Whistleblowing Policy."],
  ["contactDetailsCurrent", "My contact details and emergency contact details are up to date."],
  ["rightToWorkValid", "My right to work documentation remains valid."],
  ["qualificationsAccurate", "My qualification records held by Après School are accurate."],
  ["medicalChangesShared", "I have informed Après School of any changes to my medical information or allergies that could affect my work."],
];
const suitabilityDeclarationGroups = [
  {
    title: "Suitability and health",
    detail: "Personal fitness, disqualification and anything that could affect safe work with children.",
    keys: ["medicalFit", "noHealthCondition", "noCriminalChange", "notDisqualified", "medicalChangesShared"],
  },
  {
    title: "DBS and safeguarding",
    detail: "Ongoing safeguarding awareness and duty to report changes immediately.",
    keys: ["dbsUpdateActive", "notifyChanges", "readSafeguardingPolicy", "knowDsl", "safeguardingEveryone"],
  },
  {
    title: "Policies and records",
    detail: "Core conduct expectations and staff record details held by Après School.",
    keys: ["readCorePolicies", "contactDetailsCurrent", "rightToWorkValid", "qualificationsAccurate"],
  },
];
const suitabilityDeclarationStatementMap = Object.fromEntries(suitabilityDeclarationStatements);
const suitabilityFinalDeclarationText = "I confirm that the information above is true and complete. I understand my ongoing duty to notify Après School immediately if anything changes that may affect my suitability to work with children.";
const dbsDisclosureRows = [
  { surname: "ELEKES", dob: "2001-11-19", applicationRef: "E0873119464", certificateNo: "001897639742", issueDate: "2024-10-04", terms: ["angel", "elekes", "alekes"] },
  { surname: "ROSE", dob: "1961-12-17", applicationRef: "E0873119200", certificateNo: "001898008401", issueDate: "2024-10-07", terms: ["julie", "rose"] },
  { surname: "WATTS", dob: "2001-01-05", applicationRef: "E0873290870", certificateNo: "001898280331", issueDate: "2024-10-09", terms: ["jack", "watts"] },
  { surname: "HARRISON", dob: "1964-11-08", applicationRef: "E0873570208", certificateNo: "001898619439", issueDate: "2024-10-10", terms: ["brenda", "harrison"] },
  { surname: "NEWLAND", dob: "2001-04-13", applicationRef: "E0874177630", certificateNo: "001898755098", issueDate: "2024-10-11", terms: ["sonny", "newland"] },
  { surname: "SNELL", dob: "1977-09-25", applicationRef: "E0873119373", certificateNo: "001898911282", issueDate: "2024-10-14", terms: ["snell"] },
  { surname: "WOODLEY", dob: "1978-08-11", applicationRef: "E0873292660", certificateNo: "001901359590", issueDate: "2024-10-31", terms: ["sadie", "woodley"] },
  { surname: "TOPPING", dob: "2005-07-22", applicationRef: "E0877531318", certificateNo: "001902110271", issueDate: "2024-11-06", terms: ["hannah", "topping"] },
  { surname: "LALLY", dob: "2004-10-13", applicationRef: "E0877531214", certificateNo: "001902110211", issueDate: "2024-11-06", terms: ["josie", "lally"] },
  { surname: "MARSHALL", dob: "2005-04-18", applicationRef: "E0877527730", certificateNo: "001902127873", issueDate: "2024-11-06", terms: ["joel", "marshall"] },
  { surname: "NICOLIN", dob: "1979-03-25", applicationRef: "E0884832057", certificateNo: "001909625370", issueDate: "2025-01-15", terms: ["amanda", "nicholson", "nicolin"] },
  { surname: "AZEBAZE AYANGMA", dob: "2007-12-18", applicationRef: "E0886155639", certificateNo: "001910951943", issueDate: "2025-01-24", terms: ["joelle", "azebaze", "ayanam", "ayangma"] },
  { surname: "KELLY", dob: "1997-01-07", applicationRef: "E0888337193", certificateNo: "001916508152", issueDate: "2025-03-10", terms: ["kelly"] },
  { surname: "GRANT", dob: "2002-08-12", applicationRef: "E0913830370", certificateNo: "001941644626", issueDate: "2025-09-26", terms: ["grant"] },
];
const ofstedGapStatuses = ["Not started", "In progress", "Waiting on evidence", "Ready for review", "Resolved"];
const ofstedInspectionDayItems = [
  { id: "registration", title: "Registration details ready", detail: "URN, registers, address and Ofsted provider page are available for the selected site." },
  { id: "lead", title: "Named site lead and DSL route confirmed", detail: "The person meeting the inspector knows who to contact for safeguarding escalation and operational support." },
  { id: "staff", title: "Assigned staff and SCR checked", detail: "Staff present on the day match the site assignment list and SCR evidence is current." },
  { id: "cover", title: "First aider and EYFS cover confirmed", detail: "At least one first aider and one Level 3+ EYFS lead are identified for the session where required." },
  { id: "rota", title: "Rota, timings and handover routine clear", detail: "Setup, session, dismissal and cleanup responsibilities are understood by the team." },
  { id: "policies", title: "Core policies ready", detail: "Safeguarding, behaviour, first aid, complaints and health and safety evidence can be opened quickly." },
  { id: "logs", title: "Site logs and nil returns reviewed", detail: "Complaints, accidents, safeguarding entries and nil returns are up to date for this site." },
  { id: "premises", title: "Premises and risk walk completed", detail: "Arrival points, toilets, activity spaces, first aid location and emergency routes are checked." },
  { id: "records", title: "Attendance and contact process ready", detail: "Registers, collection process and emergency contact route are clear without exposing unnecessary child data." },
  { id: "briefing", title: "Staff inspection briefing complete", detail: "The team understands likely questions, safeguarding expectations and how to answer calmly and factually." },
];
const rotaSites = [
  { id: "willington", site: "Willington Prep", type: "After school", sessionStart: "15:30", sessionEnd: "18:00", setupMinutes: 15, cleanupMinutes: 5, address: "Willington Prep, Wimbledon", mapUrl: "https://www.google.com/maps/search/?api=1&query=Willington%20Prep%20Wimbledon" },
  { id: "kings-house", site: "King's House School", type: "After school", sessionStart: "15:15", sessionEnd: "18:00", setupMinutes: 15, cleanupMinutes: 5, address: "King's House School, Richmond", mapUrl: "https://www.google.com/maps/search/?api=1&query=King%27s%20House%20School%20Richmond" },
  { id: "shrewsbury-after", site: "Shrewsbury House School", type: "After school", sessionStart: "15:00", sessionEnd: "18:00", setupMinutes: 15, cleanupMinutes: 5, address: "Shrewsbury House School, Surbiton", mapUrl: "https://www.google.com/maps/search/?api=1&query=Shrewsbury%20House%20School%20Surbiton" },
  { id: "ripley", site: "Ripley Court School", type: "After school", sessionStart: "15:00", sessionEnd: "18:00", setupMinutes: 15, cleanupMinutes: 5, address: "Ripley Court School, Ripley", mapUrl: "https://www.google.com/maps/search/?api=1&query=Ripley%20Court%20School" },
  { id: "shrewsbury-breakfast", site: "Shrewsbury House School", type: "Breakfast club", sessionStart: "07:30", sessionEnd: "08:00", setupMinutes: 15, cleanupMinutes: 5, address: "Shrewsbury House School, Surbiton", mapUrl: "https://www.google.com/maps/search/?api=1&query=Shrewsbury%20House%20School%20Surbiton" },
  { id: "holiday-camp", site: "Holiday Camp", type: "Holiday camp", sessionStart: "08:30", sessionEnd: "17:30", setupMinutes: 15, cleanupMinutes: 5, address: "Holiday venue confirmed on rota", mapUrl: "https://www.apres-school.co.uk/bookings" },
];
const ofstedSites = [
  {
    id: "willington",
    name: "Après School at Willington Prep",
    school: "Willington Prep",
    urn: "2764313",
    providerUrl: "https://reports.ofsted.gov.uk/provider/16/2764313",
    registers: ["Early Years Register", "Compulsory Childcare Register", "Voluntary Childcare Register"],
    registrationDate: "2023-12-04",
    lastInspectionDate: "2024-09-19",
    reportPublishedDate: "2024-11-28",
    lastOutcome: "Met",
    reportReference: "Willington Inspection .PDF",
    notes: "Only inspected site so far. Site inspection completed 19 September 2024.",
  },
  {
    id: "kings-house",
    name: "Après School at King's House School",
    school: "King's House School",
    urn: "2801558",
    providerUrl: "https://reports.ofsted.gov.uk/provider/16/2801558",
    registers: ["Early Years Register", "Compulsory Childcare Register", "Voluntary Childcare Register"],
    registrationDate: "2024-10-22",
    lastInspectionDate: "",
    reportPublishedDate: "",
    lastOutcome: "Not yet inspected",
    reportReference: "",
    notes: "Registered site awaiting first inspection.",
  },
  {
    id: "ripley",
    name: "Après School at Ripley Court School",
    school: "Ripley Court School",
    urn: "2855967",
    providerUrl: "https://reports.ofsted.gov.uk/provider/16/2855967",
    registers: ["Early Years Register", "Compulsory Childcare Register", "Voluntary Childcare Register"],
    registrationDate: "2025-09-09",
    lastInspectionDate: "",
    reportPublishedDate: "",
    lastOutcome: "Not yet inspected",
    reportReference: "",
    notes: "Registered site awaiting first inspection.",
  },
  {
    id: "shrewsbury-house",
    name: "Après School at Shrewsbury House School",
    school: "Shrewsbury House School",
    urn: "2857999",
    providerUrl: "https://reports.ofsted.gov.uk/provider/16/2857999",
    registers: ["Early Years Register", "Compulsory Childcare Register", "Voluntary Childcare Register"],
    registrationDate: "2025-09-09",
    lastInspectionDate: "",
    reportPublishedDate: "",
    lastOutcome: "Not yet inspected",
    reportReference: "",
    notes: "Registered breakfast and after-school provision awaiting first inspection.",
  },
];
const coverReasons = ["Illness cover", "Planned absence", "Training cover", "Ratio support", "Emergency cover"];
const defaultStaffAvatar = "/assets/internal/default-staff-avatar.png";

function Platform({ role, tab, setTab, userEmail, onSignOut, data }) {
  const [staffProfileTargetId, setStaffProfileTargetId] = useState("");
  const [scrInspectionTarget, setScrInspectionTarget] = useState("");
  const [bookingAdminFocus, setBookingAdminFocus] = useState("");
  const [viewRole, setViewRole] = useState(role);
  const [previewUserId, setPreviewUserId] = useState("");
  const [openNavGroup, setOpenNavGroup] = useState(() => localStorage.getItem("apres-platform-open-nav-group") || "");
  const [staffPayOverrides, setStaffPayOverrides] = useState(() => readJson(staffPayOverridesStorageKey, {}));
  const [staffSiteOverrides, setStaffSiteOverrides] = useState(() => readJson(staffSiteOverridesStorageKey, {}));
  const [formerStaffRecords, setFormerStaffRecords] = useState(() => readJson(formerStaffStorageKey, {}));
  const localStaff = readOnboardedStaffProfiles();
  const canPreviewRoles = ["Admin", "Superadmin"].includes(role);
  const effectiveRole = canPreviewRoles ? viewRole : role;
  const isLiveSupabaseData = String(data.source || "").toLowerCase().includes("supabase");
  const mergedStaff = mergeStaffProfiles(data.staff, localStaff).map((person) => {
    const localFormerRecord = formerStaffRecords[person.id] || formerStaffRecords[person.profileId];
    const siteOverride = !isLiveSupabaseData ? staffSiteOverrides[person.id] : null;
    return {
      ...person,
      ...(staffPayOverrides[person.id] || {}),
      ...(siteOverride
        ? {
            location: siteOverride.location,
            siteAssignments: [{ school: siteOverride.location, role: person.role, startDate: person.startDate || "", endDate: "", status: "Active" }],
          }
        : {}),
      formerRecord: person.formerRecord || localFormerRecord || null,
    };
  });
  const enrichedData = {
    ...data,
    staff: mergedStaff.filter((person) => !person.formerRecord),
    allStaff: mergedStaff,
    source: localStaff.length ? `${data.source} + onboarding` : data.source,
  };
  const previewUsers = canPreviewRoles ? buildPreviewUsers(enrichedData, viewRole) : [];
  const selectedPreviewUser = previewUsers.find((user) => user.id === previewUserId) || null;
  const access = buildAccessContext(effectiveRole, userEmail, enrichedData, canPreviewRoles ? previewUserId : "");
  const scopedData = access.data;
  const staffProfileTarget = staffProfileTargetId
    ? (enrichedData.allStaff || []).find((person) => person.id === staffProfileTargetId || person.profileId === staffProfileTargetId)
    : null;
  const includeTargetStaff = (baseData) => {
    if (!staffProfileTarget || (baseData.staff || []).some((person) => person.id === staffProfileTarget.id)) return baseData;
    return {
      ...baseData,
      staff: [staffProfileTarget, ...(baseData.staff || [])],
      allStaff: enrichedData.allStaff || [staffProfileTarget, ...(baseData.staff || [])],
    };
  };
  const targetedScopedData = includeTargetStaff(scopedData);
  const targetedEnrichedData = includeTargetStaff(enrichedData);
  const visibleTabs = effectiveRole === "Staff"
    ? ["Staff", "Registers", "Documents", "Pay", "Rewards", "Sessions"]
    : effectiveRole === "Manager"
      ? ["Staff", "Registers", "Rota", "SCR", "Ofsted", "Documents", "Sessions"]
      : effectiveRole === "Superadmin"
        ? platformTabs
        : platformTabs.filter((item) => item !== "Safeguarding");
  const visibleGroups = platformGroups
    .map(([group, items]) => [group, items.filter((item) => visibleTabs.includes(item))])
    .filter(([, items]) => items.length);

  useEffect(() => {
    setViewRole(role);
    setPreviewUserId("");
  }, [role]);

  useEffect(() => {
    if (!canPreviewRoles || !["Staff", "Manager"].includes(viewRole)) {
      if (previewUserId) setPreviewUserId("");
      return;
    }
    if (!previewUsers.some((user) => user.id === previewUserId)) {
      setPreviewUserId(previewUsers[0]?.id || "");
    }
  }, [canPreviewRoles, previewUserId, previewUsers, viewRole]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] || "Staff");
  }, [setTab, tab, visibleTabs]);

  function setNavGroup(group) {
    const nextGroup = openNavGroup === group ? "" : group;
    setOpenNavGroup(nextGroup);
    localStorage.setItem("apres-platform-open-nav-group", nextGroup);
  }

  function selectNavItem(group, item) {
    setOpenNavGroup(group);
    localStorage.setItem("apres-platform-open-nav-group", group);
    setTab(item);
  }

  function openSiteScrFocusView() {
    setStaffProfileTargetId("");
    setOpenNavGroup("People");
    localStorage.setItem("apres-platform-open-nav-group", "People");
    setTab("SCR");
    addAuditLog("Site SCR focus opened", "Admin dashboard quick action");
  }

  function openBookingAdminFocus(focus = "") {
    setBookingAdminFocus(focus);
    setOpenNavGroup("Sites");
    localStorage.setItem("apres-platform-open-nav-group", "Sites");
    setTab("Bookings");
  }

  function updateStaffPayOverride(staffId, patch) {
    const next = {
      ...staffPayOverrides,
      [staffId]: {
        ...(staffPayOverrides[staffId] || {}),
        ...patch,
      },
    };
    setStaffPayOverrides(next);
    localStorage.setItem(staffPayOverridesStorageKey, JSON.stringify(next));
  }

  function updateStaffSiteOverride(staffId, location) {
    if (!staffId || !location) return;
    const person = (enrichedData.allStaff || enrichedData.staff || []).find((staff) => staff.id === staffId || staff.profileId === staffId);
    const next = {
      ...staffSiteOverrides,
      [staffId]: {
        location,
        updatedAt: new Date().toISOString(),
      },
    };
    setStaffSiteOverrides(next);
    localStorage.setItem(staffSiteOverridesStorageKey, JSON.stringify(next));
    addAuditLog("Staff usual site updated", `${person?.name || staffId}: ${location}${person?.email ? ` · ${person.email}` : ""}`);
    if (!hasSupabaseConfig || !isUuid(staffId)) return;
    loadSupabaseModule()
      .then(({ updateStaffSiteDetails }) => updateStaffSiteDetails(staffId, location))
      .catch((error) => {
        console.warn("Unable to save staff usual site", error);
        addAuditLog("Staff site save failed", `${person?.name || staffId}: ${location} · ${error.message || "Supabase rejected the update"}`);
      });
  }

  function updateHrReportingOverride({ staffRecordId, managerStaffRecordId = "", scope = "" }) {
    if (!staffRecordId || !hasSupabaseConfig || !isUuid(staffRecordId)) return;
    const staffPerson = (enrichedData.allStaff || enrichedData.staff || []).find((staff) => staff.id === staffRecordId || staff.profileId === staffRecordId);
    const managerPerson = (enrichedData.allStaff || enrichedData.staff || []).find((staff) => staff.id === managerStaffRecordId || staff.profileId === managerStaffRecordId);
    loadSupabaseModule()
      .then(({ updateHrReportingLine }) => updateHrReportingLine({ staffRecordId, managerStaffRecordId, scope }))
      .then((savedLine) => {
        addAuditLog("HR reporting line saved", `${staffPerson?.name || savedLine.staffRecordId}: reports to ${managerPerson?.name || "No manager assigned"} · ${savedLine.scope || "Organisation-wide"}${staffPerson?.email ? ` · ${staffPerson.email}` : ""}`);
      })
      .catch((error) => {
        console.warn("Unable to save HR reporting line", error);
        addAuditLog("HR reporting line save failed", `${staffPerson?.name || staffRecordId}: ${scope || "Organisation-wide"} · ${error.message || "Supabase rejected the update"}`);
      });
  }

  useEffect(() => {
    if (!canPreviewRoles || !["Staff", "Manager"].includes(viewRole)) {
      if (previewUserId) setPreviewUserId("");
      return;
    }
    if (!previewUsers.length) {
      if (previewUserId) setPreviewUserId("");
      return;
    }
    if (!previewUsers.some((user) => user.id === previewUserId)) {
      setPreviewUserId(previewUsers[0].id);
    }
  }, [canPreviewRoles, previewUserId, previewUsers, viewRole]);

  return (
    <main className="platform">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <p className="eyebrow">Internal platform</p>
          <h2>{effectiveRole === "Staff" ? "My Workspace" : effectiveRole === "Manager" ? "Manager Workspace" : "Admin Workspace"}</h2>
          <span>{effectiveRole === "Staff" ? "Your shifts, documents and pay" : effectiveRole === "Manager" ? "Your team, rota, hours and compliance" : "People, sites, compliance and bookings"}</span>
        </div>
        <nav className="platform-nav" aria-label="Internal platform sections">
          {visibleGroups.map(([group, items]) => (
            <div className={`platform-nav-group ${openNavGroup === group ? "open" : "collapsed"}`} key={group}>
              <button
                className="platform-nav-group-toggle"
                type="button"
                aria-expanded={openNavGroup === group}
                aria-controls={`platform-nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                onClick={() => setNavGroup(group)}
              >
                <span>{group}</span>
                <small>{items.length}</small>
                <ChevronRight />
              </button>
              <div className="platform-nav-group-items" id={`platform-nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <div>
                  {items.map((item) => (
                    <button key={item} type="button" aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : ""} title={platformTabHints[item] || item} onClick={() => selectNavItem(group, item)}>
                      {iconFor(item)} <span>{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <section className="workspace">
        <PlatformHeader
          role={effectiveRole}
          actualRole={role}
          canPreviewRoles={canPreviewRoles}
          viewRole={viewRole}
          setViewRole={setViewRole}
          previewUsers={previewUsers}
          previewUserId={previewUserId}
          setPreviewUserId={setPreviewUserId}
          selectedPreviewUser={selectedPreviewUser}
          userEmail={userEmail}
          onSignOut={onSignOut}
          data={enrichedData}
          access={access}
        />
        {tab === "Staff" && <StaffDashboard data={scopedData} access={access} userEmail={userEmail} />}
        {tab === "Admin" && <AdminDashboard data={scopedData} access={access} onOpenTab={setTab} onOpenBookingFocus={openBookingAdminFocus} onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }} onOpenInspectionView={openSiteScrFocusView} />}
        {tab === "Customer Profiles" && <FamilyImportReview access={access} />}
        {tab === "Bookings" && <BookingAdmin data={enrichedData} access={access} initialFocus={bookingAdminFocus} onClearInitialFocus={() => setBookingAdminFocus("")} />}
        {tab === "Registers" && <Registers />}
        {tab === "Booking Payments" && <BookingFinance data={enrichedData} access={access} onOpenBookingFocus={openBookingAdminFocus} />}
        {tab === "Finance" && <SchoolFinance data={enrichedData} access={access} />}
        {tab === "Users" && <UserManagement data={enrichedData} />}
        {tab === "HR" && (
          <HRHierarchy
            data={enrichedData}
            access={access}
            onUpdateStaffSite={updateStaffSiteOverride}
            onUpdateHrLine={updateHrReportingOverride}
            formerStaffRecords={formerStaffRecords}
            onFormerStaffChange={setFormerStaffRecords}
            onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }}
            onOpenHrFiles={(staffId) => { setStaffProfileTargetId(staffId); setTab("HR Files"); }}
            onOpenScr={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }}
            onOpenPay={(staffId) => { setStaffProfileTargetId(staffId); setTab("Pay"); }}
          />
        )}
        {tab === "Schools" && <SchoolsOperations data={enrichedData} />}
        {tab === "HR Files" && <HRFiles data={targetedEnrichedData} targetStaffId={staffProfileTargetId} onTargetHandled={() => setStaffProfileTargetId("")} />}
        {tab === "Rota" && <Rota data={scopedData} allData={enrichedData} access={access} />}
        {tab === "Hours" && <HoursTracker data={scopedData} access={access} />}
        {tab === "SCR" && <SCR data={targetedScopedData} access={access} targetStaffId={staffProfileTargetId} inspectionSchoolTarget={scrInspectionTarget} onInspectionTargetHandled={() => setScrInspectionTarget("")} onTargetHandled={() => setStaffProfileTargetId("")} onUpdateStaffPay={updateStaffPayOverride} onOpenHrFiles={(staffId) => { setStaffProfileTargetId(staffId); setTab("HR Files"); }} onOpenPay={(staffId) => { setStaffProfileTargetId(staffId); setTab("Pay"); }} />}
        {tab === "Ofsted" && <OfstedReadiness data={scopedData} />}
        {tab === "Documents" && <Documents data={scopedData} access={access} />}
        {tab === "Pay" && <Pay data={targetedScopedData} access={access} targetStaffId={staffProfileTargetId} onTargetHandled={() => setStaffProfileTargetId("")} onOpenTab={setTab} onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }} />}
        {tab === "Rewards" && <Rewards data={scopedData} />}
        {tab === "Sessions" && <Sessions data={scopedData} />}
        {tab === "Incidents" && <Incidents />}
        {tab === "Safeguarding" && effectiveRole === "Superadmin" && <SafeguardingCases />}
        {tab === "CRM" && <CRM data={enrichedData} />}
        {tab === "Audit" && <AuditLog data={scopedData} />}
        {tab === "Settings" && <Settings />}
      </section>
    </main>
  );
}

const registerReportLabels = {
  incident: "Incident",
  first_aid: "First aid",
  safeguarding: "Safeguarding concern",
};

const REGISTER_INCIDENT_CATEGORIES = [
  { value: "Behaviour", icon: "⚠️", description: "Challenging behaviour, conflict or repeated failure to follow expectations." },
  { value: "Collection Issue", icon: "👤", description: "Late collection, unauthorised collector or another collection concern." },
  { value: "Parent Concern", icon: "💬", description: "A concern, complaint or significant conversation involving a parent or carer." },
  { value: "Site or Property Issue", icon: "🏫", description: "Damage, unsafe behaviour involving equipment, or another site-related event." },
  { value: "Near Miss", icon: "🚧", description: "Something that could have caused harm or disruption but did not." },
  { value: "Other Significant Event", icon: "📝", description: "An important event that does not fit another category." },
];

const REGISTER_INCIDENT_SEVERITIES = [
  { value: "Information", tone: "information", description: "Useful context or a noteworthy event." },
  { value: "Minor", tone: "minor", description: "Resolved promptly with limited impact." },
  { value: "Moderate", tone: "moderate", description: "Needs monitoring or follow-up." },
  { value: "Serious", tone: "serious", description: "Requires immediate escalation." },
];

const REGISTER_INCIDENT_OUTCOMES = [
  "Resolved",
  "Child returned to normal activities",
  "Monitoring required",
  "Manager follow-up required",
  "Parent follow-up required",
  "Escalated",
];

const REGISTER_INCIDENT_PEOPLE = [
  "Parent or carer",
  "Site manager",
  "Après School manager",
  "School",
  "Other",
];

const SAFEGUARDING_SOURCES = [
  ["Observed", "👁️"],
  ["Child Disclosure", "🗣️"],
  ["Parent Disclosure", "👨"],
  ["Staff Concern", "👩"],
  ["Third Party", "📞"],
  ["External Agency", "📄"],
];

const SAFEGUARDING_CATEGORIES = [
  "Physical Abuse",
  "Emotional Abuse",
  "Neglect",
  "Sexual Abuse",
  "Online Safety",
  "Child-on-child",
  "Domestic Abuse",
  "Mental Health",
  "Self Harm",
  "Radicalisation",
  "Attendance",
  "Substance Misuse",
  "Other",
];

function incidentNeedsFollowUp(outcome) {
  return ["Monitoring required", "Manager follow-up required", "Parent follow-up required", "Escalated"].includes(outcome);
}

function registerReportInitialDraft(reportType, registerDate = "") {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(11, 16);
  const localNow = `${registerDate || new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)}T${localTime}`;
  return {
    occurredAt: localNow,
    summary: "",
    category: "",
    severity: "",
    actionTaken: "",
    parentNotified: "not_yet",
    peopleInformed: [],
    peopleInformedOther: "",
    outcome: "",
    followUpNotes: "",
    bodySide: "front",
    bodyPart: "",
    bodyAreas: [],
    injuryTypes: [],
    firstAidActions: [],
    firstAidProvider: "",
    treatment: "",
    childSafeNow: null,
    concernRoute: "",
    concernCategories: [],
    witnessStaff: "",
    witnessChildren: "",
    witnessAdults: "",
    dslNotified: "no",
    dslInformedWho: "",
    dslInformedAt: "",
    emailPrimaryContact: false,
  };
}

function registerBodyAreaKey(side, part) {
  return `${side}:${part}`;
}

function registerBodyAreas(details = {}) {
  if (Array.isArray(details.bodyAreas)) {
    return details.bodyAreas
      .map((area) => {
        if (typeof area === "string") {
          const [side, ...part] = area.split(":");
          return side && part.length ? { side, part: part.join(":") } : null;
        }
        return area?.side && area?.part ? { side: area.side, part: area.part } : null;
      })
      .filter(Boolean);
  }
  return details.bodyPart
    ? [{ side: details.bodySide || "front", part: details.bodyPart }]
    : [];
}

function registerBodyAreasLabel(details = {}) {
  const areas = registerBodyAreas(details);
  return areas.length
    ? areas.map((area) => `${area.part} (${area.side})`).join(" · ")
    : "Not recorded";
}

function registerRewardInitialDraft() {
  return {
    badgeType: "",
    reason: "",
    emailPrimaryContact: false,
  };
}

function RegisterBodyMap({ side, selectedParts = [], onToggle }) {
  const torsoPart = side === "front" ? "Chest" : "Upper back";
  const lowerTorsoPart = side === "front" ? "Abdomen" : "Lower back";
  const bodyZones = [
    { part: "Head", element: <path className="bodymap-zone" d="M100 9c-15 0-25 11-25 27 0 15 10 28 25 28s25-13 25-28c0-16-10-27-25-27Z" /> },
    { part: "Neck", element: <path className="bodymap-zone" d="M89 58h22l4 16H85l4-16Z" /> },
    { part: torsoPart, element: <path className="bodymap-zone" d="M82 70c-10 3-17 10-19 21l7 53c9 7 19 10 30 10s21-3 30-10l7-53c-2-11-9-18-19-21-11 6-25 6-36 0Z" /> },
    { part: lowerTorsoPart, element: <path className="bodymap-zone" d="M70 139c8 8 18 12 30 12s22-4 30-12l-4 37c-8 7-17 10-26 10s-18-3-26-10l-4-37Z" /> },
    { part: "Left arm", element: <path className="bodymap-zone" d="M66 80c-8 3-13 9-17 19l-18 59c-2 7 2 13 8 15 6 1 11-3 13-9l20-56 6-26-12-2Z" /> },
    { part: "Right arm", element: <path className="bodymap-zone" d="M134 80c8 3 13 9 17 19l18 59c2 7-2 13-8 15-6 1-11-3-13-9l-20-56-6-26 12-2Z" /> },
    { part: "Left hand", element: <path className="bodymap-zone" d="M39 166c-8-2-15 3-16 11-1 6 3 13 9 15 8 2 16-3 17-11 1-7-3-13-10-15Z" /> },
    { part: "Right hand", element: <path className="bodymap-zone" d="M161 166c8-2 15 3 16 11 1 6-3 13-9 15-8 2-16-3-17-11-1-7 3-13 10-15Z" /> },
    { part: "Left leg", element: <path className="bodymap-zone" d="M75 176c6 6 14 9 23 10l-5 82c-1 10-7 16-15 15-8-1-12-8-11-18l8-89Z" /> },
    { part: "Right leg", element: <path className="bodymap-zone" d="M125 176c-6 6-14 9-23 10l5 82c1 10 7 16 15 15 8-1 12-8 11-18l-8-89Z" /> },
    { part: "Left foot", element: <path className="bodymap-zone" d="M78 272c-7-1-12 4-16 10l-7 8c-3 4 0 8 5 8h27c6 0 9-4 8-9l-2-12-15-5Z" /> },
    { part: "Right foot", element: <path className="bodymap-zone" d="M122 272c7-1 12 4 16 10l7 8c3 4 0 8-5 8h-27c-6 0-9-4-8-9l2-12 15-5Z" /> },
  ];
  return (
    <div className="register-body-map">
      <svg viewBox="0 0 200 300" role="group" aria-label={`${side === "front" ? "Front" : "Back"} body map`}>
        {bodyZones.map(({ part, element }) => (
          <g
            key={part}
            className={selectedParts.includes(part) ? "selected" : ""}
            role="button"
            tabIndex="0"
            aria-label={`${selectedParts.includes(part) ? "Remove" : "Select"} ${part}`}
            aria-pressed={selectedParts.includes(part)}
            onClick={() => onToggle(part)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle(part);
              }
            }}
          >
            <title>{part}</title>
            {element}
          </g>
        ))}
      </svg>
      <strong>{selectedParts.length ? `${selectedParts.length} area${selectedParts.length === 1 ? "" : "s"} selected on this side` : "Select every affected area"}</strong>
    </div>
  );
}

function Registers() {
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const requestedRegisterDate = new URLSearchParams(window.location.search).get("registerDate");
  const initialRegisterDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedRegisterDate || "")
    ? requestedRegisterDate
    : localToday;
  const [registerDate, setRegisterDate] = useState(initialRegisterDate);
  const [rows, setRows] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [school, setSchool] = useState("All schools");
  const [programme, setProgramme] = useState("All activities");
  const [session, setSession] = useState("All sessions");
  const [search, setSearch] = useState("");
  const [fireDrill, setFireDrill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState("");
  const [message, setMessage] = useState({ tone: "info", text: "Loading the live register…" });
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocSearch, setAdHocSearch] = useState("");
  const [adHocOptions, setAdHocOptions] = useState({ children: [], sessions: [] });
  const [adHocChildId, setAdHocChildId] = useState("");
  const [adHocSessionIds, setAdHocSessionIds] = useState([]);
  const [adHocApplyFee, setAdHocApplyFee] = useState(false);
  const [adHocLoading, setAdHocLoading] = useState(false);
  const [adHocSaving, setAdHocSaving] = useState(false);
  const [adHocError, setAdHocError] = useState("");
  const [adHocCancellationRow, setAdHocCancellationRow] = useState(null);
  const [adHocCancellationSaving, setAdHocCancellationSaving] = useState(false);
  const [adHocCancellationError, setAdHocCancellationError] = useState("");
  const [registerReportType, setRegisterReportType] = useState("");
  const [registerReportDraft, setRegisterReportDraft] = useState(() => registerReportInitialDraft("incident"));
  const [registerReportSaving, setRegisterReportSaving] = useState(false);
  const [registerReportError, setRegisterReportError] = useState("");
  const [registerReportSuccess, setRegisterReportSuccess] = useState("");
  const [safeguardingDraftStatus, setSafeguardingDraftStatus] = useState("");
  const [safeguardingFiles, setSafeguardingFiles] = useState([]);
  const [registerRewardOpen, setRegisterRewardOpen] = useState(false);
  const [registerRewardDraft, setRegisterRewardDraft] = useState(registerRewardInitialDraft);
  const [registerRewardSaving, setRegisterRewardSaving] = useState(false);
  const [registerRewardError, setRegisterRewardError] = useState("");
  const [registerRewardSuccess, setRegisterRewardSuccess] = useState("");
  const [registerRewardCelebration, setRegisterRewardCelebration] = useState(null);
  const [childActivity, setChildActivity] = useState([]);
  const [childActivityLoading, setChildActivityLoading] = useState(false);
  const [childActivityError, setChildActivityError] = useState("");

  const statusLabels = {
    booked: "Expected",
    checked_in: "Checked in",
    checked_out: "Checked out",
    absent: "Absent",
    late_collection: "Late collection",
    incident: "Incident",
  };

  async function refreshRegister() {
    setLoading(true);
    setMessage({ tone: "info", text: "Loading the timetable and confirmed bookings…" });
    try {
      const timetableStart = new Date(`${registerDate}T00:00:00`);
      timetableStart.setMonth(Math.max(0, timetableStart.getMonth() - 1));
      const [registerResult, timetableResult] = await Promise.allSettled([
        fetchStaffRegister({ registerDate }),
        fetchStaffRegisterTimetable({ from: timetableStart }),
      ]);
      if (registerResult.status === "rejected") throw registerResult.reason;
      const nextRows = registerResult.value;
      const nextTimetable = timetableResult.status === "fulfilled" ? timetableResult.value : [];
      setRows(nextRows);
      setTimetable(nextTimetable);
      setMessage({
        tone: timetableResult.status === "fulfilled" ? "good" : "info",
        text: timetableResult.status === "rejected"
          ? `${nextRows.length} confirmed child ${nextRows.length === 1 ? "booking" : "bookings"} loaded. Timetable filters could not be refreshed.`
          : nextRows.length
          ? `${nextRows.length} confirmed child ${nextRows.length === 1 ? "booking" : "bookings"} loaded.`
          : "No confirmed children are booked for this date.",
      });
    } catch (error) {
      setRows([]);
      setTimetable([]);
      setMessage({ tone: "bad", text: error?.message || "The live register could not be loaded." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!bookingSystemConfigured()) {
      setLoading(false);
      setMessage({ tone: "bad", text: "The live register is not configured. No local examples are shown." });
      return;
    }
    refreshRegister();
  }, [registerDate]);

  const registerOptions = [...timetable, ...rows];
  const schools = ["All schools", ...new Set(registerOptions.map((row) => row.siteName).filter(Boolean))];
  const programmes = ["All activities", ...new Set(registerOptions
    .filter((row) => school === "All schools" || row.siteName === school)
    .map((row) => row.programmeName)
    .filter(Boolean))];
  const sessions = ["All sessions", ...new Set(registerOptions
    .filter((row) => school === "All schools" || row.siteName === school)
    .filter((row) => programme === "All activities" || row.programmeName === programme)
    .map((row) => row.sessionLabel)
    .filter(Boolean))];
  const normalizedSearch = search.trim().toLowerCase();
  const sessionScopeRows = rows.filter((row) => {
    if (school !== "All schools" && row.siteName !== school) return false;
    if (programme !== "All activities" && row.programmeName !== programme) return false;
    if (fireDrill && !["checked_in", "late_collection", "incident"].includes(row.attendanceStatus)) return false;
    if (!normalizedSearch) return true;
    return [
      row.childName,
      row.childYearGroup,
      row.childSchoolName,
      row.parentName,
      row.parentPhone,
      row.medicalNotes,
      row.allergyNotes,
      row.dietaryNotes,
      ...(row.flags || []),
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
  });
  const visibleRows = session === "All sessions"
    ? sessionScopeRows
    : sessionScopeRows.filter((row) => row.sessionLabel === session);
  const visibleSessionLabels = session === "All sessions" ? sessions.slice(1) : [session];
  const sessionSections = visibleSessionLabels.map((sessionLabel) => {
    const optionRows = registerOptions
      .filter((row) => school === "All schools" || row.siteName === school)
      .filter((row) => programme === "All activities" || row.programmeName === programme)
      .filter((row) => row.sessionLabel === sessionLabel);
    return {
      label: sessionLabel,
      activityNames: [...new Set(optionRows.map((row) => row.programmeName).filter(Boolean))],
      rows: visibleRows.filter((row) => row.sessionLabel === sessionLabel),
    };
  });
  const expectedCount = visibleRows.filter((row) => row.attendanceStatus === "booked").length;
  const presentCount = visibleRows.filter((row) => ["checked_in", "late_collection", "incident"].includes(row.attendanceStatus)).length;
  const completedCount = visibleRows.filter((row) => ["checked_out", "absent"].includes(row.attendanceStatus)).length;
  const selectedChild = rows.find((row) => row.bookingItemId === selectedChildId) || null;

  useEffect(() => {
    if (registerReportType !== "safeguarding" || !selectedChild?.bookingItemId) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await saveSafeguardingDraft({
          bookingItemId: selectedChild.bookingItemId,
          content: registerReportDraft,
        });
        setSafeguardingDraftStatus(`Draft saved ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
      } catch {
        setSafeguardingDraftStatus("Secure autosave is unavailable. Keep this form open and try again before leaving.");
      }
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [registerReportDraft, registerReportType, selectedChild?.bookingItemId]);
  const selectedAdHocChild = adHocOptions.children.find((child) => child.id === adHocChildId) || null;
  const selectedAdHocSessions = adHocOptions.sessions.filter((option) => adHocSessionIds.includes(option.id));
  const adHocSessionSubtotal = selectedAdHocSessions.reduce((total, option) => total + option.price, 0);
  const adHocTotal = adHocSessionSubtotal + (adHocApplyFee ? 2.5 : 0);
  const adHocCancellationRows = adHocCancellationRow
    ? rows.filter((row) => row.bookingId === adHocCancellationRow.bookingId)
    : [];

  function childAlreadyBookedInSession(childId, sessionBlockId) {
    return rows.some((row) => row.childId === childId && row.sessionBlockId === sessionBlockId);
  }

  function emergencyPhone(row) {
    const contact = row.emergencyContact || {};
    return contact.phone || contact.mobile || contact.telephone || contact.number || row.parentPhone || "";
  }

  function childAge(row) {
    if (!row.childDateOfBirth) return "";
    const birth = new Date(`${row.childDateOfBirth}T12:00:00`);
    if (Number.isNaN(birth.getTime())) return "";
    const onDate = new Date(`${registerDate}T12:00:00`);
    let age = onDate.getFullYear() - birth.getFullYear();
    if (onDate < new Date(onDate.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
    return age >= 0 ? String(age) : "";
  }

  function meaningfulCareValue(value) {
    if (Array.isArray(value)) return value.some(meaningfulCareValue);
    if (value && typeof value === "object") return Object.values(value).some(meaningfulCareValue);
    const normalized = String(value || "").trim().toLowerCase();
    return Boolean(normalized && !["no", "none", "n/a", "not applicable", "false"].includes(normalized));
  }

  function sendDetails(row) {
    const consents = row.consents || {};
    const registration = consents.registration || {};
    const structured = [
      consents.send,
      consents.SEND,
      registration.send,
      registration.SEND,
      registration.sendNeed,
      registration.sendDetails,
      registration.ehcp,
    ].filter(meaningfulCareValue);
    const flagText = (row.flags || []).filter((flag) => /\b(send|sen|ehcp|special educational|additional need)/i.test(String(flag)));
    return [...structured, ...flagText];
  }

  function hasMedicalCare(row) {
    const consents = row.consents || {};
    const registration = consents.registration || {};
    return meaningfulCareValue([
      row.medicalNotes,
      row.allergyNotes,
      registration.allergies,
      registration.medications,
      registration.autoInjectors,
      registration.medicalConditions,
      (row.flags || []).filter((flag) => /\b(medical|medication|allerg|asthma|auto-injector|epipen|emerade)/i.test(String(flag))),
    ]);
  }

  function careDetailLines(row) {
    return [
      row.allergyNotes && `Allergy: ${row.allergyNotes}`,
      row.medicalNotes && `Medical: ${row.medicalNotes}`,
      row.dietaryNotes && `Dietary: ${row.dietaryNotes}`,
      ...(row.flags || []),
    ].filter(Boolean);
  }

  function printableValue(value) {
    if (Array.isArray(value)) return value.map(printableValue).filter(Boolean).join(" · ");
    if (value && typeof value === "object") {
      return Object.entries(value)
        .filter(([, detail]) => meaningfulCareValue(detail))
        .map(([label, detail]) => `${label.replace(/([A-Z])/g, " $1")}: ${printableValue(detail)}`)
        .join(" · ");
    }
    return String(value || "").trim();
  }

  async function openRegisterReport(reportType) {
    setRegisterRewardOpen(false);
    setRegisterReportType(reportType);
    let nextDraft = registerReportInitialDraft(reportType, registerDate);
    if (reportType === "safeguarding" && selectedChild?.bookingItemId) {
      try {
        const saved = await readSafeguardingDraft({ bookingItemId: selectedChild.bookingItemId });
        if (saved?.content && Object.keys(saved.content).length) {
          nextDraft = { ...nextDraft, ...saved.content };
          setSafeguardingDraftStatus("Secure draft restored.");
        }
      } catch {
        setSafeguardingDraftStatus("Secure draft storage is currently unavailable.");
      }
    }
    setRegisterReportDraft(nextDraft);
    setRegisterReportError("");
    setRegisterReportSuccess("");
  }

  function openRegisterReward() {
    setRegisterReportType("");
    setRegisterRewardOpen(true);
    setRegisterRewardDraft(registerRewardInitialDraft());
    setRegisterRewardError("");
    setRegisterRewardSuccess("");
  }

  function updateRegisterReportDraft(field, value) {
    setRegisterReportDraft((current) => ({ ...current, [field]: value }));
    setRegisterReportError("");
  }

  function toggleRegisterReportChoice(field, value) {
    setRegisterReportDraft((current) => {
      const choices = Array.isArray(current[field]) ? current[field] : [];
      return {
        ...current,
        [field]: choices.includes(value)
          ? choices.filter((choice) => choice !== value)
          : [...choices, value],
      };
    });
    setRegisterReportError("");
  }

  function toggleRegisterBodyArea(side, part) {
    const key = registerBodyAreaKey(side, part);
    setRegisterReportDraft((current) => {
      const bodyAreas = Array.isArray(current.bodyAreas) ? current.bodyAreas : [];
      return {
        ...current,
        bodyAreas: bodyAreas.includes(key)
          ? bodyAreas.filter((area) => area !== key)
          : [...bodyAreas, key],
      };
    });
    setRegisterReportError("");
  }

  async function submitRegisterReport(event) {
    event.preventDefault();
    if (!selectedChild || !registerReportType) return;
    if (!registerReportDraft.summary.trim()) {
      setRegisterReportError("Add a clear factual account of what happened.");
      return;
    }
    if (registerReportType === "incident") {
      if (!registerReportDraft.category) {
        setRegisterReportError("Choose the incident category.");
        return;
      }
      if (!registerReportDraft.severity) {
        setRegisterReportError("Choose the incident severity.");
        return;
      }
      if (!registerReportDraft.actionTaken.trim()) {
        setRegisterReportError("Record what action staff took.");
        return;
      }
      if (!registerReportDraft.peopleInformed.length) {
        setRegisterReportError("Select who was informed.");
        return;
      }
      if (registerReportDraft.peopleInformed.includes("Other") && !registerReportDraft.peopleInformedOther.trim()) {
        setRegisterReportError("Add the name or role of the other person informed.");
        return;
      }
      if (!registerReportDraft.outcome) {
        setRegisterReportError("Choose the outcome.");
        return;
      }
      if (incidentNeedsFollowUp(registerReportDraft.outcome) && !registerReportDraft.followUpNotes.trim()) {
        setRegisterReportError("Add the required follow-up notes.");
        return;
      }
    }
    if (registerReportType === "first_aid" && !registerReportDraft.bodyAreas.length) {
      setRegisterReportError("Select at least one affected area on the body map.");
      return;
    }
    if (registerReportType === "first_aid" && !registerReportDraft.firstAidProvider.trim()) {
      setRegisterReportError("Add who performed first aid.");
      return;
    }
    if (registerReportType === "safeguarding") {
      if (registerReportDraft.childSafeNow === null) {
        setRegisterReportError("Confirm whether the child is currently safe.");
        return;
      }
      if (!registerReportDraft.concernRoute) {
        setRegisterReportError("Choose how the concern arose.");
        return;
      }
      if (!registerReportDraft.concernCategories.length) {
        setRegisterReportError("Choose at least one concern category.");
        return;
      }
      if (!registerReportDraft.actionTaken.trim()) {
        setRegisterReportError("Record what you did immediately.");
        return;
      }
      if (registerReportDraft.dslNotified === "yes"
        && (!registerReportDraft.dslInformedWho.trim() || !registerReportDraft.dslInformedAt)) {
        setRegisterReportError("Record who was informed and when.");
        return;
      }
    }

    setRegisterReportSaving(true);
    setRegisterReportError("");
    setRegisterReportSuccess("");
    try {
      const occurredAt = registerReportDraft.occurredAt
        ? new Date(registerReportDraft.occurredAt).toISOString()
        : new Date().toISOString();
      const standardDetails = {
          occurredAt,
          category: registerReportDraft.category,
          severity: registerReportDraft.severity,
          actionTaken: registerReportDraft.actionTaken.trim(),
          parentNotified: registerReportDraft.parentNotified,
          peopleInformed: registerReportDraft.peopleInformed,
          peopleInformedOther: registerReportDraft.peopleInformedOther.trim(),
          outcome: registerReportDraft.outcome,
          followUpNotes: registerReportDraft.followUpNotes.trim(),
          emailPrimaryContactRequested: registerReportDraft.emailPrimaryContact,
          bodySide: registerReportDraft.bodyAreas[0]?.split(":")[0] || registerReportDraft.bodySide,
          bodyPart: registerReportDraft.bodyAreas[0]?.split(":").slice(1).join(":") || "",
          bodyAreas: registerReportDraft.bodyAreas.map((area) => {
            const [side, ...part] = area.split(":");
            return { side, part: part.join(":") };
          }),
          injuryTypes: registerReportDraft.injuryTypes,
          firstAidActions: registerReportDraft.firstAidActions,
          firstAidProvider: registerReportDraft.firstAidProvider.trim(),
          treatment: registerReportDraft.treatment.trim(),
          concernRoute: registerReportDraft.concernRoute,
          dslNotified: registerReportDraft.dslNotified,
          registerDate,
        };
      const result = registerReportType === "safeguarding"
        ? await createSafeguardingConcern({
          bookingItemId: selectedChild.bookingItemId,
          childSafeNow: registerReportDraft.childSafeNow,
          concernSource: registerReportDraft.concernRoute,
          categories: registerReportDraft.concernCategories,
          factualAccount: registerReportDraft.summary,
          immediateAction: registerReportDraft.actionTaken,
          witnesses: {
            staff: registerReportDraft.witnessStaff.split(",").map((value) => value.trim()).filter(Boolean),
            children: registerReportDraft.witnessChildren.split(",").map((value) => value.trim()).filter(Boolean),
            otherAdults: registerReportDraft.witnessAdults.split(",").map((value) => value.trim()).filter(Boolean),
          },
          dslInformed: registerReportDraft.dslNotified === "yes",
          dslInformedWho: registerReportDraft.dslInformedWho,
          dslInformedAt: registerReportDraft.dslInformedAt
            ? new Date(registerReportDraft.dslInformedAt).toISOString()
            : null,
          occurredAt,
        })
        : await createStaffRegisterReport({
          bookingItemId: selectedChild.bookingItemId,
          reportType: registerReportType,
          summary: registerReportDraft.summary,
          details: standardDetails,
          emailPrimaryContact: registerReportDraft.emailPrimaryContact,
        });
      const label = registerReportLabels[registerReportType];
      let attachmentsUploaded = false;
      if (registerReportType === "safeguarding") {
        if (safeguardingFiles.length) {
          try {
            await uploadSafeguardingAttachments({ caseId: result.caseId, files: safeguardingFiles });
            attachmentsUploaded = true;
            setSafeguardingFiles([]);
          } catch (attachmentError) {
            setRegisterReportError(`Concern #${result?.concernNumber || ""} was saved, but one or more attachments could not be uploaded. ${attachmentError?.message || "Ask the DSL to add them from the case."}`);
          }
        }
        setSafeguardingDraftStatus(`Concern #${result?.concernNumber || ""} submitted. The original record is locked.`);
      }
      const successText = registerReportType === "safeguarding"
        ? `Safeguarding concern saved securely${attachmentsUploaded ? " with its attachments" : ""} and referred to the DSL.`
        : `${label} report saved securely${result?.emailSent ? " and emailed to the primary contact" : ""}.`;
      setRegisterReportSuccess(successText);
      if (registerReportDraft.emailPrimaryContact && !result?.emailSent) {
        setRegisterReportError(`The report was saved, but the email could not be sent. ${result?.emailError || "Check the primary contact email and try again."}`);
      }
      setRegisterReportDraft(registerReportInitialDraft(registerReportType, registerDate));
      await refreshRegister();
      setMessage({ tone: "good", text: `${selectedChild.childName}: ${successText}` });
    } catch (error) {
      setRegisterReportError(error?.message || "The report could not be saved.");
    } finally {
      setRegisterReportSaving(false);
    }
  }

  async function submitRegisterReward(event) {
    event.preventDefault();
    if (!selectedChild) return;
    if (!registerRewardDraft.badgeType) {
      setRegisterRewardError("Choose one badge before awarding it.");
      return;
    }
    if (!registerRewardDraft.reason.trim()) {
      setRegisterRewardError("Add a short reason for the badge.");
      return;
    }
    setRegisterRewardSaving(true);
    setRegisterRewardError("");
    setRegisterRewardSuccess("");
    try {
      const result = await createStaffRegisterReward({
        bookingItemId: selectedChild.bookingItemId,
        badgeType: registerRewardDraft.badgeType,
        reason: registerRewardDraft.reason,
        emailPrimaryContact: registerRewardDraft.emailPrimaryContact,
      });
      const badge = rewardBadge(registerRewardDraft.badgeType);
      const successText = `${badge.title} badge saved${result?.emailSent ? " and emailed to the primary contact" : ""}.`;
      setRegisterRewardSuccess(successText);
      if (registerRewardDraft.emailPrimaryContact && !result?.emailSent) {
        setRegisterRewardError(`The badge was saved, but the email could not be sent. ${result?.emailError || "Check the primary contact email and try again."}`);
      }
      setRegisterRewardCelebration({
        badge,
        childName: selectedChild.childName,
      });
      await refreshRegister();
      setMessage({ tone: "good", text: `${selectedChild.childName}: ${successText}` });
    } catch (error) {
      setRegisterRewardError(error?.message || "The reward could not be saved.");
    } finally {
      setRegisterRewardSaving(false);
    }
  }

  useEffect(() => {
    if (!registerRewardCelebration) return undefined;
    const closeTimer = window.setTimeout(() => {
      setRegisterRewardCelebration(null);
      setRegisterRewardOpen(false);
      setRegisterRewardDraft(registerRewardInitialDraft());
      setSelectedChildId("");
    }, 2800);
    return () => window.clearTimeout(closeTimer);
  }, [registerRewardCelebration]);

  useEffect(() => {
    if (!selectedChildId) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelectedChildId("");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedChildId]);

  useEffect(() => {
    setRegisterReportType("");
    setRegisterReportError("");
    setRegisterReportSuccess("");
    setRegisterRewardOpen(false);
    setRegisterRewardError("");
    setRegisterRewardSuccess("");
  }, [selectedChildId]);

  useEffect(() => {
    const childId = selectedChild?.childId;
    if (!childId) {
      setChildActivity([]);
      setChildActivityError("");
      return undefined;
    }
    let active = true;
    setChildActivityLoading(true);
    setChildActivityError("");
    fetchStaffChildActivityTimeline({ childId })
      .then((items) => {
        if (active) setChildActivity(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        if (active) setChildActivityError(error?.message || "Activity history could not be loaded.");
      })
      .finally(() => {
        if (active) setChildActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChild?.childId, registerReportSuccess, registerRewardSuccess]);

  useEffect(() => {
    if (!adHocOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !adHocSaving) setAdHocOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [adHocOpen, adHocSaving]);

  useEffect(() => {
    if (!adHocCancellationRow) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !adHocCancellationSaving) setAdHocCancellationRow(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [adHocCancellationRow, adHocCancellationSaving]);

  useEffect(() => {
    if (!adHocOpen) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setAdHocLoading(true);
      setAdHocError("");
      try {
        const options = await fetchStaffAdHocBookingOptions({
          registerDate,
          siteName: school === "All schools" ? null : school,
          programmeName: programme === "All activities" ? null : programme,
          childQuery: adHocSearch,
        });
        if (!active) return;
        setAdHocOptions(options);
        setAdHocSessionIds((current) => current.filter((id) => options.sessions.some((option) => option.id === id)));
      } catch (error) {
        if (!active) return;
        setAdHocOptions({ children: [], sessions: [] });
        setAdHocError(error?.message || "Pupils and sessions could not be loaded.");
      } finally {
        if (active) setAdHocLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [adHocOpen, adHocSearch, registerDate, school, programme]);

  function openAdHocBooking() {
    setAdHocSearch("");
    setAdHocOptions({ children: [], sessions: [] });
    setAdHocChildId("");
    setAdHocSessionIds([]);
    setAdHocApplyFee(false);
    setAdHocError("");
    setAdHocOpen(true);
  }

  function toggleAdHocSession(option) {
    if (!adHocChildId) {
      setAdHocError("Choose a pupil before selecting sessions.");
      return;
    }
    if (childAlreadyBookedInSession(adHocChildId, option.id)) return;
    if (option.placesLeft <= 0) return;
    setAdHocError("");
    setAdHocSessionIds((current) => current.includes(option.id)
      ? current.filter((id) => id !== option.id)
      : [...current, option.id]);
  }

  async function submitAdHocBooking() {
    if (!adHocChildId) {
      setAdHocError("Choose a pupil.");
      return;
    }
    if (!adHocSessionIds.length) {
      setAdHocError("Choose at least one available session.");
      return;
    }
    setAdHocSaving(true);
    setAdHocError("");
    try {
      const result = await createStaffAdHocBooking({
        childId: adHocChildId,
        registerDate,
        sessionBlockIds: adHocSessionIds,
        applyNonBookingFee: adHocApplyFee,
      });
      setAdHocOpen(false);
      await refreshRegister();
      setMessage({
        tone: "good",
        text: `${result.childName} added to ${result.sessionCount} ${result.sessionCount === 1 ? "session" : "sessions"}. £${Number(result.total || 0).toFixed(2)} charged to the family account${result.nonBookingFee ? ", including the £2.50 non-booking fee" : ""}.${Number(result.outstanding || 0) > 0 ? ` £${Number(result.outstanding).toFixed(2)} is now due and the parent has been notified.` : " Covered by account credit."}`,
      });
    } catch (error) {
      setAdHocError(error?.message || "The ad-hoc booking could not be created.");
    } finally {
      setAdHocSaving(false);
    }
  }

  function openAdHocCancellation(row) {
    setAdHocCancellationError("");
    setAdHocCancellationRow(row);
  }

  async function confirmAdHocCancellation() {
    if (!adHocCancellationRow?.bookingId) return;
    const childName = adHocCancellationRow.childName;
    setAdHocCancellationSaving(true);
    setAdHocCancellationError("");
    try {
      const result = await cancelStaffAdHocBooking({
        bookingId: adHocCancellationRow.bookingId,
        reason: "Cancelled by staff from the register",
      });
      setAdHocCancellationRow(null);
      await refreshRegister();
      setMessage({
        tone: "good",
        text: `${childName}'s ad-hoc care was cancelled. The family charge was reversed${Number(result.creditRestored || 0) > 0 ? ` and £${Number(result.creditRestored).toFixed(2)} credit was returned` : ""}.${result.emailSent ? " The parent has been emailed." : result.emailError ? ` Parent email warning: ${result.emailError}` : ""}`,
      });
    } catch (error) {
      setAdHocCancellationError(error?.message || "The ad-hoc booking could not be cancelled.");
    } finally {
      setAdHocCancellationSaving(false);
    }
  }

  async function updateRow(row, status) {
    setSavingIds((current) => [...new Set([...current, row.bookingItemId])]);
    try {
      await updateStaffRegisterEntry({
        bookingItemId: row.bookingItemId,
        status,
        note: row.attendanceNote || "",
      });
      await refreshRegister();
      setMessage({ tone: "good", text: `${row.childName} marked ${statusLabels[status].toLowerCase()}.` });
    } catch (error) {
      setMessage({ tone: "bad", text: error?.message || `${row.childName} could not be updated.` });
    } finally {
      setSavingIds((current) => current.filter((id) => id !== row.bookingItemId));
    }
  }

  async function bulkUpdate(status) {
    const actionable = visibleRows.filter((row) => !savingIds.includes(row.bookingItemId));
    if (!actionable.length) return;
    setSavingIds(actionable.map((row) => row.bookingItemId));
    const results = await Promise.allSettled(actionable.map((row) => updateStaffRegisterEntry({
      bookingItemId: row.bookingItemId,
      status,
      note: row.attendanceNote || "",
    })));
    const failed = results.filter((result) => result.status === "rejected").length;
    await refreshRegister();
    setSavingIds([]);
    setMessage({
      tone: failed ? "bad" : "good",
      text: failed
        ? `${actionable.length - failed} children updated; ${failed} could not be saved.`
        : `${actionable.length} visible ${actionable.length === 1 ? "child" : "children"} marked ${statusLabels[status].toLowerCase()}.`,
    });
  }

  function downloadRegister() {
    const header = ["Child", "School", "Year group", "Age", "Session", "Time", "Status", "Care alerts", "Parent", "Emergency phone"];
    const values = visibleRows.map((row) => [
      row.childName,
      row.childSchoolName || row.siteName,
      row.childYearGroup,
      childAge(row),
      row.sessionLabel,
      `${new Date(row.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-${new Date(row.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
      statusLabels[row.attendanceStatus] || row.attendanceStatus,
      [row.allergyNotes, row.medicalNotes, row.dietaryNotes, ...(row.flags || [])].filter(Boolean).join(" · "),
      row.parentName,
      emergencyPhone(row),
    ]);
    const csv = [header, ...values]
      .map((line) => line.map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `apres-register-${registerDate}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="workspace-section register-workspace">
      <div className="workspace-title-row">
        <div>
          <p className="eyebrow">Live attendance</p>
          <h1>Registers</h1>
          <p>Every confirmed child appears in the correct session. Record arrival, collection and care exceptions here.</p>
        </div>
        <div className="register-header-actions">
          <button className="button book register-adhoc-launch" type="button" onClick={openAdHocBooking}>Ad-hoc booking</button>
          <button className="button light" type="button" onClick={refreshRegister} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          <button className="button light" type="button" onClick={downloadRegister} disabled={!visibleRows.length}>Download CSV</button>
        </div>
      </div>

      <div className="register-selector-panel">
        <label>Date<input type="date" value={registerDate} onChange={(event) => {
          setRegisterDate(event.target.value);
          setSchool("All schools");
          setProgramme("All activities");
          setSession("All sessions");
        }} /></label>
        <label>School<select value={school} onChange={(event) => { setSchool(event.target.value); setProgramme("All activities"); setSession("All sessions"); }}>
          {schools.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label>Activity<select value={programme} onChange={(event) => { setProgramme(event.target.value); setSession("All sessions"); }}>
          {programmes.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label>Session<select value={session} onChange={(event) => setSession(event.target.value)}>
          {sessions.map((item) => <option key={item}>{item}</option>)}
        </select></label>
      </div>

      <nav className="register-session-filters" aria-label="Quick session filters">
        <span>Quick session view</span>
        <div>
          {sessions.map((item) => {
            const bookingCount = item === "All sessions"
              ? sessionScopeRows.length
              : sessionScopeRows.filter((row) => row.sessionLabel === item).length;
            return (
              <button
                className={session === item ? "active" : ""}
                type="button"
                key={item}
                onClick={() => setSession(item)}
                aria-pressed={session === item}
              >
                <strong>{item}</strong>
                <small>{bookingCount ? `${bookingCount} booked` : "No bookings"}</small>
              </button>
            );
          })}
        </div>
      </nav>

      <div className={`register-live-message ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}>
        <strong>{message.tone === "bad" ? "Register unavailable" : "Live register"}</strong>
        <span>{message.text}</span>
      </div>

      <div className="register-command-row">
        <label><span>Find a child or care need</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, year, allergy or contact" /></label>
        <button className={fireDrill ? "button book" : "button light"} type="button" onClick={() => setFireDrill((current) => !current)}>{fireDrill ? "Exit fire-drill view" : "Fire-drill register"}</button>
      </div>

      <div className="register-summary-grid" aria-label="Register totals">
        <article><span>Visible</span><strong>{visibleRows.length}</strong></article>
        <article><span>Expected</span><strong>{expectedCount}</strong></article>
        <article><span>Present</span><strong>{presentCount}</strong></article>
        <article><span>Complete</span><strong>{completedCount}</strong></article>
      </div>

      <div className="register-bulk-actions">
        <span>Apply to the visible children:</span>
        <button type="button" onClick={() => bulkUpdate("checked_in")} disabled={!visibleRows.length || savingIds.length}>Check in all</button>
        <button type="button" onClick={() => bulkUpdate("checked_out")} disabled={!visibleRows.length || savingIds.length}>Check out all</button>
        <button type="button" onClick={() => bulkUpdate("absent")} disabled={!visibleRows.length || savingIds.length}>Mark all absent</button>
      </div>

      <div className="register-session-sections">
        {sessionSections.map((section) => (
          <section className="register-session-section" key={section.label}>
            <header>
              <div>
                <p>Session</p>
                <h2>{section.label}</h2>
                {!!section.activityNames.length && <span>{section.activityNames.join(" · ")}</span>}
              </div>
              <strong className={section.rows.length ? "has-bookings" : "no-bookings"}>
                {section.rows.length ? `${section.rows.length} ${section.rows.length === 1 ? "booking" : "bookings"}` : "No bookings"}
              </strong>
            </header>
            <div className="register-table-wrap">
              <table className="register-table">
                <thead><tr><th>Child</th><th>Session</th><th>Needs</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {section.rows.map((row) => {
                    const busy = savingIds.includes(row.bookingItemId);
                    const hasSend = sendDetails(row).length > 0;
                    const hasMedical = hasMedicalCare(row);
                    return (
                      <tr key={row.bookingItemId} className={`status-${row.attendanceStatus}`}>
                        <td>
                          <button className="register-child-button" type="button" onClick={() => setSelectedChildId(row.bookingItemId)} aria-label={`Open details for ${row.childName}`}>
                            <strong>
                              {row.childName}
                              {!!row.rewardsToday?.length && (
                                <span className="register-earned-badges" aria-label={`${row.rewardsToday.length} badge${row.rewardsToday.length === 1 ? "" : "s"} earned today`}>
                                  {row.rewardsToday.slice(0, 3).map((reward) => {
                                    const badge = rewardBadge(reward.badgeType);
                                    return <span key={reward.id} className="register-earned-badge" title={`Earned: ${badge.title}`}>{badge.icon}</span>;
                                  })}
                                </span>
                              )}
                              {!!row.reportsToday?.length && (
                                <span className="register-report-markers" aria-label={`${row.reportsToday.length} report${row.reportsToday.length === 1 ? "" : "s"} recorded today`}>
                                  {row.reportsToday.slice(0, 3).map((report) => (
                                    <span
                                      className={`register-report-marker ${report.reportType}`}
                                      key={report.id}
                                      title={report.reportType === "incident"
                                        ? `Incident recorded: ${report.category || "Incident"}`
                                        : "First aid recorded"}
                                    >
                                      {report.reportType === "incident" ? "⚠️" : "🩹"}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </strong>
                            <span>{row.childYearGroup || "Year not recorded"}{childAge(row) ? ` · Age ${childAge(row)}` : ""}</span>
                          </button>
                        </td>
                        <td><strong>{row.sessionLabel}</strong><span>{new Date(row.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-{new Date(row.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span><small>{row.programmeName}</small></td>
                        <td><div className="register-need-icons">
                          {hasSend && <span className="register-need-icon send" title="SEND information recorded" aria-label="SEND information recorded"><SendNeeds size={17} /><b>SEND</b></span>}
                          {hasMedical && <span className="register-need-icon medical" title="Medical information recorded" aria-label="Medical information recorded"><MedicalCross size={17} /><b>Medical</b></span>}
                          {!hasSend && !hasMedical && <span className="register-no-needs" aria-label="No SEND or medical information recorded">—</span>}
                        </div></td>
                        <td><span className={`register-status status-${row.attendanceStatus}`}>{statusLabels[row.attendanceStatus] || row.attendanceStatus}</span></td>
                        <td><div className="register-row-actions">
                          <button type="button" onClick={() => updateRow(row, "checked_in")} disabled={busy || row.attendanceStatus === "checked_in"}>Check in</button>
                          <button type="button" onClick={() => updateRow(row, "checked_out")} disabled={busy || row.attendanceStatus === "checked_out"}>Check out</button>
                          <button type="button" onClick={() => updateRow(row, "absent")} disabled={busy || row.attendanceStatus === "absent"}>Absent</button>
                          {row.staffAdHoc && (
                            <button className="register-cancel-adhoc" type="button" onClick={() => openAdHocCancellation(row)} disabled={busy}>
                              Cancel ad-hoc
                            </button>
                          )}
                        </div></td>
                      </tr>
                    );
                  })}
                  {!section.rows.length && !loading && <tr><td className="register-empty" colSpan="5">No bookings for {section.label} on this date.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {!sessionSections.length && !loading && (
          <div className="register-no-sessions">
            <strong>No sessions available</strong>
            <span>There are no bookable sessions configured for this selection.</span>
          </div>
        )}
      </div>

      {selectedChild && (
        <div className="register-drawer-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedChildId("");
        }}>
          <aside className="register-child-drawer" role="dialog" aria-modal="true" aria-labelledby="register-child-drawer-title">
            <header>
              <div>
                <p className="eyebrow">Pupil details</p>
                <h2 id="register-child-drawer-title">{selectedChild.childName}</h2>
                <p>{selectedChild.childYearGroup || "Year not recorded"}{childAge(selectedChild) ? ` · Age ${childAge(selectedChild)}` : ""} · {selectedChild.childSchoolName || selectedChild.siteName}</p>
              </div>
              <button className="register-drawer-close" type="button" onClick={() => setSelectedChildId("")} aria-label="Close pupil details"><X size={20} /></button>
            </header>

            <section className="register-drawer-session">
              <span>Today’s booking</span>
              <strong>{selectedChild.sessionLabel} · {new Date(selectedChild.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-{new Date(selectedChild.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</strong>
              <small>{selectedChild.programmeName}</small>
            </section>

            <section>
              <h3>Medical and care information</h3>
              {careDetailLines(selectedChild).length
                ? <ul className="register-drawer-alerts">{careDetailLines(selectedChild).map((detail) => <li key={detail}>{detail}</li>)}</ul>
                : <p className="register-drawer-empty">No medical, allergy or dietary information recorded.</p>}
            </section>

            <section>
              <h3>SEND</h3>
              {sendDetails(selectedChild).length
                ? <ul className="register-drawer-alerts send">{sendDetails(selectedChild).map((detail, index) => <li key={`${index}-${printableValue(detail)}`}>{printableValue(detail)}</li>)}</ul>
                : <p className="register-drawer-empty">No SEND information recorded.</p>}
            </section>

            <section>
              <h3>Emergency contact</h3>
              <div className="register-drawer-contact">
                <strong>{selectedChild.parentName || "Parent not recorded"}</strong>
                <a href={emergencyPhone(selectedChild) ? `tel:${emergencyPhone(selectedChild).replace(/\s/g, "")}` : undefined}>{emergencyPhone(selectedChild) || "Emergency phone not recorded"}</a>
              </div>
            </section>

            <section>
              <h3>Authorised collectors</h3>
              {selectedChild.authorisedCollectors?.length
                ? <ul className="register-drawer-collectors">{selectedChild.authorisedCollectors.map((collector, index) => <li key={`${index}-${printableValue(collector)}`}>{printableValue(collector)}</li>)}</ul>
                : <p className="register-drawer-empty">No additional authorised collectors recorded.</p>}
            </section>

            <section className="register-child-timeline">
              <h3>Activity history</h3>
              <p className="register-child-timeline-intro">Rewards and care records for this child, latest first.</p>
              {childActivityLoading && <p className="register-drawer-empty">Loading activity history…</p>}
              {childActivityError && <p className="register-form-error" role="alert">{childActivityError}</p>}
              {!childActivityLoading && !childActivityError && !childActivity.length && (
                <p className="register-drawer-empty">No rewards or reports have been recorded yet.</p>
              )}
              {!!childActivity.length && (
                <div className="register-child-timeline-list">
                  {childActivity.map((activity) => {
                    const badge = activity.kind === "reward" ? rewardBadge(activity.title) : null;
                    const icon = badge?.icon || (activity.kind === "incident" ? "⚠️" : activity.kind === "first_aid" ? "🩹" : "🛡️");
                    const title = badge?.title || activity.title;
                    return (
                      <article className={`register-child-timeline-item ${activity.kind}`} key={`${activity.kind}-${activity.id}`}>
                        <span className="register-child-timeline-icon" aria-hidden="true">{icon}</span>
                        <div>
                          <strong>{title}</strong>
                          <span>{new Date(activity.occurredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                          <small>{[activity.staffName, activity.siteName, activity.sessionLabel].filter(Boolean).join(" · ")}</small>
                          {(activity.reason || activity.summary) && (
                            <details>
                              <summary>View details</summary>
                              <p>{activity.reason || activity.summary}</p>
                              {activity.actionTaken && <p><b>Action:</b> {activity.actionTaken}</p>}
                              {activity.outcome && <p><b>Outcome:</b> {activity.outcome}</p>}
                              {activity.followUpNotes && <p><b>Follow-up:</b> {activity.followUpNotes}</p>}
                            </details>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="register-drawer-reports">
              <div className="register-report-heading">
                <div>
                  <h3>Record, report and reward</h3>
                  <p>Choose an action. Each record is saved securely with your name and time.</p>
                </div>
              </div>
              <div className="register-report-actions" aria-label="Choose report type">
                <button
                  className={`incident ${registerReportType === "incident" ? "active" : ""}`}
                  type="button"
                  onClick={() => openRegisterReport("incident")}
                >
                  <span>Incident</span>
                  <small>Record behaviour, collection issues or other significant events.</small>
                </button>
                <button
                  className={`first-aid ${registerReportType === "first_aid" ? "active" : ""}`}
                  type="button"
                  onClick={() => openRegisterReport("first_aid")}
                >
                  <span>First aid</span>
                  <small>Injury, treatment and body map</small>
                </button>
                <button
                  className={`safeguarding ${registerReportType === "safeguarding" ? "active" : ""}`}
                  type="button"
                  onClick={() => openRegisterReport("safeguarding")}
                >
                  <span>Safeguarding</span>
                  <small>Restricted concern for the DSL</small>
                </button>
                <button
                  className={`reward ${registerRewardOpen ? "active" : ""}`}
                  type="button"
                  onClick={openRegisterReward}
                >
                  <span>Reward</span>
                  <small>Recognise something brilliant</small>
                </button>
              </div>

              {registerReportType && (
                <form className={`register-report-form report-${registerReportType}`} onSubmit={submitRegisterReport}>
                  <div className="register-report-form-title">
                    <div>
                      <span>{registerReportLabels[registerReportType]}</span>
                      <strong>{selectedChild.childName}</strong>
                    </div>
                    <button type="button" onClick={() => setRegisterReportType("")} disabled={registerReportSaving}>Close form</button>
                  </div>

                  {registerReportType === "safeguarding" && (
                    <div className="register-report-guidance safeguarding">
                      <strong>Safeguarding Concern · Confidential</strong>
                      <span>Record factual information only. This record will only be visible to authorised safeguarding staff.</span>
                    </div>
                  )}

                  {registerReportType === "safeguarding" && (
                    <>
                      <fieldset className="safeguarding-step safety">
                        <legend><span>1</span> Immediate safety</legend>
                        <strong>Is the child currently safe?</strong>
                        <div className="safeguarding-binary">
                          <button type="button" className={registerReportDraft.childSafeNow === true ? "is-selected" : ""} onClick={() => updateRegisterReportDraft("childSafeNow", true)}>Yes</button>
                          <button type="button" className={registerReportDraft.childSafeNow === false ? "is-selected urgent" : ""} onClick={() => updateRegisterReportDraft("childSafeNow", false)}>No</button>
                        </div>
                        {registerReportDraft.childSafeNow === false && (
                          <div className="safeguarding-urgent" role="alert">
                            Contact the Designated Safeguarding Lead immediately before continuing.
                          </div>
                        )}
                      </fieldset>

                      <fieldset className="safeguarding-step">
                        <legend><span>2</span> How did this concern arise?</legend>
                        <div className="safeguarding-source-grid">
                          {SAFEGUARDING_SOURCES.map(([source, icon]) => (
                            <button
                              type="button"
                              key={source}
                              className={registerReportDraft.concernRoute === source ? "is-selected" : ""}
                              onClick={() => updateRegisterReportDraft("concernRoute", source)}
                            >
                              <span aria-hidden="true">{icon}</span><strong>{source}</strong>
                            </button>
                          ))}
                        </div>
                      </fieldset>

                      <fieldset className="safeguarding-step">
                        <legend><span>3</span> Concern category</legend>
                        <p>Select every category that applies. These support DSL review and reporting.</p>
                        <div className="safeguarding-category-grid">
                          {SAFEGUARDING_CATEGORIES.map((category) => (
                            <label key={category} className={registerReportDraft.concernCategories.includes(category) ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={registerReportDraft.concernCategories.includes(category)}
                                onChange={() => toggleRegisterReportChoice("concernCategories", category)}
                              />
                              <span>{category}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

                  <div className="register-report-form-grid">
                    <label>
                      <span>Date and time</span>
                      <input
                        type="datetime-local"
                        value={registerReportDraft.occurredAt}
                        onChange={(event) => updateRegisterReportDraft("occurredAt", event.target.value)}
                        required
                      />
                    </label>

                    {registerReportType === "safeguarding" && <div className="safeguarding-auto-context"><strong>Automatically recorded</strong><span>Current user · site · club · session · submission time</span></div>}
                  </div>

                  {registerReportType === "incident" && (
                    <>
                      <fieldset className="register-incident-fieldset">
                        <legend>Choose an incident type</legend>
                        <div className="register-incident-card-grid">
                          {REGISTER_INCIDENT_CATEGORIES.map((category) => (
                            <button
                              type="button"
                              key={category.value}
                              className={registerReportDraft.category === category.value ? "is-selected" : ""}
                              aria-pressed={registerReportDraft.category === category.value}
                              onClick={() => updateRegisterReportDraft(
                                "category",
                                registerReportDraft.category === category.value ? "" : category.value,
                              )}
                            >
                              <span aria-hidden="true">{category.icon}</span>
                              <strong>{category.value}</strong>
                              <small>{category.description}</small>
                            </button>
                          ))}
                        </div>
                      </fieldset>

                      <fieldset className="register-incident-fieldset">
                        <legend>How serious was it?</legend>
                        <div className="register-incident-severity-grid">
                          {REGISTER_INCIDENT_SEVERITIES.map((severity) => (
                            <button
                              type="button"
                              key={severity.value}
                              className={`${severity.tone} ${registerReportDraft.severity === severity.value ? "is-selected" : ""}`}
                              aria-pressed={registerReportDraft.severity === severity.value}
                              onClick={() => updateRegisterReportDraft(
                                "severity",
                                registerReportDraft.severity === severity.value ? "" : severity.value,
                              )}
                            >
                              <strong>{severity.value}</strong>
                              <small>{severity.description}</small>
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

                  <label className={registerReportType === "safeguarding" ? "safeguarding-facts" : ""}>
                    <span>{registerReportType === "first_aid" ? "What happened?" : registerReportType === "safeguarding" ? "4 · What happened?" : "What happened?"}</span>
                    {registerReportType === "safeguarding" && <small>Record only factual observations. Use the child’s exact words where possible. Do not include opinions, assumptions or conclusions.</small>}
                    <textarea
                      rows={registerReportType === "safeguarding" ? "9" : "5"}
                      value={registerReportDraft.summary}
                      onChange={(event) => updateRegisterReportDraft("summary", event.target.value)}
                      placeholder={registerReportType === "incident"
                        ? "Record a clear, factual account of what was seen, heard or reported. Include the names of any relevant people present."
                        : registerReportType === "safeguarding"
                          ? "Record exactly what you saw or were told, including relevant times and the child’s own words."
                          : "Record what you saw or were told, including relevant times and people present."}
                      required
                    />
                    {registerReportType === "safeguarding" && <em className="safeguarding-autosave">{safeguardingDraftStatus || "Your factual account will autosave securely as you type."}</em>}
                  </label>

                  {registerReportType === "first_aid" && (
                    <>
                      <fieldset className="register-first-aid-quick-fieldset">
                        <legend>What type of injury was it?</legend>
                        <p>Select every option that applies.</p>
                        <div className="register-first-aid-quick-grid">
                          {["Bump", "Cut", "Bruise", "Graze", "Nosebleed", "Bite or sting", "Burn or scald", "Sprain or strain", "Other"].map((injury) => (
                            <label key={injury} className={registerReportDraft.injuryTypes.includes(injury) ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={registerReportDraft.injuryTypes.includes(injury)}
                                onChange={() => toggleRegisterReportChoice("injuryTypes", injury)}
                              />
                              <span>{injury}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      <div className="register-report-body-section">
                        <div>
                          <span className="register-report-label">Where was the injury?</span>
                          <div className="register-report-side-toggle" role="group" aria-label="Choose front or back of body">
                            <button
                              className={registerReportDraft.bodySide === "front" ? "active" : ""}
                              type="button"
                              onClick={() => updateRegisterReportDraft("bodySide", "front")}
                            >
                              Front
                            </button>
                            <button
                              className={registerReportDraft.bodySide === "back" ? "active" : ""}
                              type="button"
                              onClick={() => updateRegisterReportDraft("bodySide", "back")}
                            >
                              Back
                            </button>
                          </div>
                        </div>
                        <RegisterBodyMap
                          side={registerReportDraft.bodySide}
                          selectedParts={registerBodyAreas({ bodyAreas: registerReportDraft.bodyAreas })
                            .filter((area) => area.side === registerReportDraft.bodySide)
                            .map((area) => area.part)}
                          onToggle={(part) => toggleRegisterBodyArea(registerReportDraft.bodySide, part)}
                        />
                        <div className="register-body-map-selection" aria-live="polite">
                          <span className="register-report-label">Selected areas</span>
                          {registerReportDraft.bodyAreas.length ? (
                            <div>
                              {registerBodyAreas({ bodyAreas: registerReportDraft.bodyAreas }).map((area) => (
                                <button
                                  type="button"
                                  key={registerBodyAreaKey(area.side, area.part)}
                                  onClick={() => toggleRegisterBodyArea(area.side, area.part)}
                                  aria-label={`Remove ${area.part} on ${area.side}`}
                                >
                                  {area.part} · {area.side} ×
                                </button>
                              ))}
                            </div>
                          ) : <small>Tap every affected area on the front or back view.</small>}
                        </div>
                      </div>

                      <fieldset className="register-first-aid-quick-fieldset treatment">
                        <legend>First aid administered</legend>
                        <p>Select every option that applies.</p>
                        <div className="register-first-aid-quick-grid">
                          {["Antiseptic wipe", "Plaster or dressing", "Ice pack", "Observation", "Cleaned with water", "Rest", "Other"].map((action) => (
                            <label key={action} className={registerReportDraft.firstAidActions.includes(action) ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={registerReportDraft.firstAidActions.includes(action)}
                                onChange={() => toggleRegisterReportChoice("firstAidActions", action)}
                              />
                              <span>{action}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

              {registerReportType === "first_aid" ? (
                <>
                  <label>
                    <span>Who performed first aid?</span>
                    <input
                      type="text"
                      value={registerReportDraft.firstAidProvider}
                      onChange={(event) => updateRegisterReportDraft("firstAidProvider", event.target.value)}
                      placeholder="Full name of staff member"
                      required
                    />
                  </label>
                  <label>
                    <span>Relevant first aid details</span>
                    <textarea
                      rows="3"
                      value={registerReportDraft.treatment}
                      onChange={(event) => updateRegisterReportDraft("treatment", event.target.value)}
                      placeholder="Add any extra treatment details and how the child responded."
                      required
                    />
                  </label>
                </>
              ) : (
                    <label>
                      <span>{registerReportType === "safeguarding" ? "5 · What did you do immediately?" : "Action taken"}</span>
                      <textarea
                        rows="3"
                        value={registerReportDraft.actionTaken}
                        onChange={(event) => updateRegisterReportDraft("actionTaken", event.target.value)}
                        placeholder={registerReportType === "incident"
                          ? "Record what staff did immediately after the event."
                          : registerReportType === "safeguarding"
                            ? "For example: separated children, comforted child, contacted DSL or called emergency services."
                            : "Record what you did immediately after the event."}
                        required
                      />
                    </label>
                  )}

                  {registerReportType === "incident" && (
                    <>
                      <fieldset className="register-incident-fieldset">
                        <legend>Who was informed?</legend>
                        <div className="register-incident-check-grid">
                          {REGISTER_INCIDENT_PEOPLE.map((person) => (
                            <label key={person} className={registerReportDraft.peopleInformed.includes(person) ? "is-selected" : ""}>
                              <input
                                type="checkbox"
                                checked={registerReportDraft.peopleInformed.includes(person)}
                                onChange={() => toggleRegisterReportChoice("peopleInformed", person)}
                              />
                              <span>{person}</span>
                            </label>
                          ))}
                        </div>
                        {registerReportDraft.peopleInformed.includes("Other") && (
                          <label className="register-incident-other">
                            <span>Who else was informed?</span>
                            <input
                              value={registerReportDraft.peopleInformedOther}
                              onChange={(event) => updateRegisterReportDraft("peopleInformedOther", event.target.value)}
                              placeholder="Name or role"
                              required
                            />
                          </label>
                        )}
                      </fieldset>

                      <label>
                        <span>Parent notification</span>
                        <select value={registerReportDraft.parentNotified} onChange={(event) => updateRegisterReportDraft("parentNotified", event.target.value)}>
                          <option value="not_required">Not required</option>
                          <option value="not_yet">Not yet</option>
                          <option value="spoken_in_person">Spoken to in person</option>
                          <option value="contacted_by_phone">Contacted by phone</option>
                          <option value="email_sent">Email sent</option>
                          <option value="follow_up_required">Follow-up required</option>
                        </select>
                      </label>

                      <label>
                        <span>Outcome</span>
                        <select value={registerReportDraft.outcome} onChange={(event) => updateRegisterReportDraft("outcome", event.target.value)} required>
                          <option value="">Choose an outcome</option>
                          {REGISTER_INCIDENT_OUTCOMES.map((outcome) => <option key={outcome}>{outcome}</option>)}
                        </select>
                      </label>

                      {incidentNeedsFollowUp(registerReportDraft.outcome) && (
                        <label>
                          <span>Follow-up notes</span>
                          <textarea
                            rows="3"
                            value={registerReportDraft.followUpNotes}
                            onChange={(event) => updateRegisterReportDraft("followUpNotes", event.target.value)}
                            placeholder="Record what needs to happen next, who is responsible and any agreed timescale."
                            required
                          />
                        </label>
                      )}
                    </>
                  )}

                  {registerReportType === "safeguarding" ? (
                    <>
                      <fieldset className="safeguarding-step">
                        <legend><span>6</span> Attachments</legend>
                        <div className="safeguarding-attachment-note">
                          <LockKeyhole size={20} />
                          <div><strong>Secure case attachments</strong><p>Photographs, PDFs, letters, emails and screenshots are stored privately and added to the permanent audit trail.</p></div>
                        </div>
                        <label>
                          <span>Add files (optional)</span>
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,message/rfc822"
                            onChange={(event) => setSafeguardingFiles(Array.from(event.target.files || []))}
                          />
                        </label>
                        {safeguardingFiles.length ? <small>{safeguardingFiles.length} file{safeguardingFiles.length === 1 ? "" : "s"} ready for secure upload after submission.</small> : null}
                      </fieldset>
                      <fieldset className="safeguarding-step">
                        <legend><span>7</span> Witnesses</legend>
                        <div className="safeguarding-witness-grid">
                          <label><span>Staff present</span><input value={registerReportDraft.witnessStaff} onChange={(event) => updateRegisterReportDraft("witnessStaff", event.target.value)} placeholder="Names, separated by commas" /></label>
                          <label><span>Children present</span><input value={registerReportDraft.witnessChildren} onChange={(event) => updateRegisterReportDraft("witnessChildren", event.target.value)} placeholder="Names, separated by commas" /></label>
                          <label><span>Other adults present</span><input value={registerReportDraft.witnessAdults} onChange={(event) => updateRegisterReportDraft("witnessAdults", event.target.value)} placeholder="Names or roles" /></label>
                        </div>
                      </fieldset>
                      <fieldset className="safeguarding-step">
                        <legend><span>8</span> DSL notification</legend>
                        <label>
                          <span>Was the DSL informed?</span>
                          <select value={registerReportDraft.dslNotified} onChange={(event) => updateRegisterReportDraft("dslNotified", event.target.value)} required>
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </label>
                        {registerReportDraft.dslNotified === "yes" && (
                          <div className="safeguarding-witness-grid">
                            <label><span>Who was informed?</span><input value={registerReportDraft.dslInformedWho} onChange={(event) => updateRegisterReportDraft("dslInformedWho", event.target.value)} placeholder="Full name or role" required /></label>
                            <label><span>When?</span><input type="datetime-local" value={registerReportDraft.dslInformedAt} onChange={(event) => updateRegisterReportDraft("dslInformedAt", event.target.value)} required /></label>
                          </div>
                        )}
                      </fieldset>
                    </>
                  ) : registerReportType !== "incident" ? (
                    <label>
                      <span>Has the parent or carer been notified?</span>
                      <select value={registerReportDraft.parentNotified} onChange={(event) => updateRegisterReportDraft("parentNotified", event.target.value)}>
                        <option value="not_yet">Not yet</option>
                        <option value="yes">Yes</option>
                        <option value="not_required">Not required</option>
                      </select>
                    </label>
                  ) : null}

                  {registerReportType !== "safeguarding" && (
                    <label className="register-email-copy-option">
                      <input
                        type="checkbox"
                        checked={registerReportDraft.emailPrimaryContact}
                        onChange={(event) => updateRegisterReportDraft("emailPrimaryContact", event.target.checked)}
                      />
                      <span>
                        <strong>{registerReportType === "incident" ? "Email this incident report to the primary contact" : "Email a copy to the primary contact"}</strong>
                        <small>{registerReportType === "incident" ? "Send a professional copy after the report is saved." : "The report will be sent after it is saved."}</small>
                      </span>
                    </label>
                  )}

                  {registerReportError && <div className="register-report-message error" role="alert">{registerReportError}</div>}
                  {registerReportSuccess && <div className="register-report-message success" role="status">{registerReportSuccess}</div>}

                  <div className="register-report-submit">
                    <button type="button" onClick={() => setRegisterReportType("")} disabled={registerReportSaving}>Cancel</button>
                    <button type="submit" disabled={registerReportSaving}>
                      {registerReportSaving ? "Saving securely…" : registerReportType === "safeguarding" ? "Submit Safeguarding Concern" : registerReportType === "incident" ? "Save incident report" : `Save ${registerReportLabels[registerReportType].toLowerCase()} report`}
                    </button>
                  </div>
                </form>
              )}

              {registerRewardOpen && (
                <form className="register-report-form report-reward" onSubmit={submitRegisterReward}>
                  <div className="register-report-form-title">
                    <div>
                      <span>Reward</span>
                      <strong>{selectedChild.childName}</strong>
                    </div>
                    {!registerRewardCelebration && <button type="button" onClick={() => setRegisterRewardOpen(false)} disabled={registerRewardSaving}>Close form</button>}
                  </div>

                  {registerRewardCelebration ? (
                    <div className="register-reward-celebration" role="status" aria-live="polite">
                      <div className="reward-confetti" aria-hidden="true">
                        {Array.from({ length: 16 }, (_, index) => <i key={index} style={{ "--confetti-index": index }} />)}
                      </div>
                      <span className="register-reward-celebration-icon">{registerRewardCelebration.badge.icon}</span>
                      <h3>{registerRewardCelebration.childName} has earned the {registerRewardCelebration.badge.title} badge!</h3>
                      <p>{registerRewardCelebration.badge.description}</p>
                    </div>
                  ) : (
                    <>
                      <fieldset className="register-reward-badge-fieldset">
                        <legend>Choose a badge</legend>
                        <div className="register-reward-badge-grid">
                          {REWARD_BADGES.map((badge) => (
                            <button
                              type="button"
                              key={badge.type}
                              className={registerRewardDraft.badgeType === badge.type ? "is-selected" : ""}
                              aria-pressed={registerRewardDraft.badgeType === badge.type}
                              onClick={() => {
                                setRegisterRewardDraft((current) => ({
                                  ...current,
                                  badgeType: current.badgeType === badge.type ? "" : badge.type,
                                }));
                                setRegisterRewardError("");
                              }}
                            >
                              <span aria-hidden="true">{badge.icon}</span>
                              <strong>{badge.title}</strong>
                              <small>{badge.description}</small>
                            </button>
                          ))}
                        </div>
                      </fieldset>

                      <label>
                        <span>What did they do to earn this badge?</span>
                        <textarea
                          rows="6"
                          maxLength="700"
                          value={registerRewardDraft.reason}
                          onChange={(event) => {
                            setRegisterRewardDraft((current) => ({ ...current, reason: event.target.value }));
                            setRegisterRewardError("");
                          }}
                          placeholder="Share the brilliant moment, kind action or achievement that deserves celebrating."
                          required
                        />
                      </label>

                      <label className="register-email-copy-option reward-email">
                        <input
                          type="checkbox"
                          checked={registerRewardDraft.emailPrimaryContact}
                          onChange={(event) => setRegisterRewardDraft((current) => ({
                            ...current,
                            emailPrimaryContact: event.target.checked,
                          }))}
                        />
                        <span>
                          <strong>Email this reward home</strong>
                          <small>Send the family a celebratory certificate with this badge and note.</small>
                        </span>
                      </label>

                      {registerRewardError && <div className="register-report-message error" role="alert">{registerRewardError}</div>}
                      {registerRewardSuccess && <div className="register-report-message success" role="status">{registerRewardSuccess}</div>}

                      <div className="register-report-submit">
                        <button type="button" onClick={() => setRegisterRewardOpen(false)} disabled={registerRewardSaving}>Cancel</button>
                        <button type="submit" disabled={registerRewardSaving}>
                          {registerRewardSaving ? "Awarding badge…" : "Award badge"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </section>
          </aside>
        </div>
      )}

      {adHocOpen && (
        <div className="register-adhoc-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !adHocSaving) setAdHocOpen(false);
        }}>
          <section className="register-adhoc-dialog" role="dialog" aria-modal="true" aria-labelledby="register-adhoc-title">
            <header>
              <div>
                <p className="eyebrow">Unexpected arrival</p>
                <h2 id="register-adhoc-title">Ad-hoc booking</h2>
                <p>Find the pupil, then add only the sessions they need today.</p>
              </div>
              <button type="button" onClick={() => setAdHocOpen(false)} disabled={adHocSaving} aria-label="Close ad-hoc booking"><X size={20} /></button>
            </header>

            <div className="register-adhoc-step">
              <div className="register-adhoc-step-title">
                <span>1</span>
                <div><strong>Find the pupil</strong><small>Search active family records by pupil or parent name.</small></div>
              </div>
              <label className="register-adhoc-search">
                <span>Search pupil</span>
                <input
                  type="search"
                  value={adHocSearch}
                  onChange={(event) => setAdHocSearch(event.target.value)}
                  placeholder="Start typing a pupil’s name"
                  autoFocus
                />
              </label>
              <div className="register-adhoc-results" aria-live="polite">
                {adHocLoading && <p>Searching family records…</p>}
                {!adHocLoading && adHocOptions.children.map((child) => (
                  <button
                    className={adHocChildId === child.id ? "selected" : ""}
                    type="button"
                    key={child.id}
                    onClick={() => {
                      setAdHocChildId(child.id);
                      setAdHocSessionIds([]);
                      setAdHocError("");
                    }}
                  >
                    <strong>{child.name}</strong>
                    <span>{[child.schoolName, child.yearGroup].filter(Boolean).join(" · ") || "School details not recorded"}</span>
                    <small>{child.parentName || child.parentEmail}</small>
                  </button>
                ))}
                {!adHocLoading && !adHocOptions.children.length && (
                  <p>{adHocSearch.trim() ? "No active pupil matches this search." : "No active pupils are available."}</p>
                )}
              </div>
            </div>

            <div className="register-adhoc-step">
              <div className="register-adhoc-step-title">
                <span>2</span>
                <div><strong>Choose sessions</strong><small>{selectedAdHocChild ? `Adding care for ${selectedAdHocChild.name} on ${new Date(`${registerDate}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.` : "Choose a pupil first."}</small></div>
              </div>
              <div className="register-adhoc-sessions">
                {adHocOptions.sessions.map((option) => {
                  const alreadyBooked = adHocChildId && childAlreadyBookedInSession(adHocChildId, option.id);
                  const full = option.placesLeft <= 0;
                  const disabled = !adHocChildId || alreadyBooked || full;
                  const selected = adHocSessionIds.includes(option.id);
                  return (
                    <button
                      className={`${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                      type="button"
                      key={option.id}
                      onClick={() => toggleAdHocSession(option)}
                      disabled={disabled}
                      aria-pressed={selected}
                    >
                      <span className="register-adhoc-check">{selected ? "✓" : ""}</span>
                      <span><strong>{option.label}</strong><small>{option.programmeName} · {option.siteName}</small></span>
                      <span><strong>{new Date(option.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-{new Date(option.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</strong><small>{alreadyBooked ? "Already booked" : full ? "Full" : `${option.placesLeft} places left · £${option.price.toFixed(2)}`}</small></span>
                    </button>
                  );
                })}
                {!adHocLoading && !adHocOptions.sessions.length && (
                  <p>
                    No sessions are scheduled for {school === "All schools" ? "the selected schools" : school}
                    {programme === "All activities" ? "" : ` · ${programme}`} on{" "}
                    {new Date(`${registerDate}T12:00:00`).toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}. Change the register date or filters above, then reopen Ad-hoc booking.
                  </p>
                )}
              </div>
            </div>

            <label className="register-adhoc-fee">
              <input type="checkbox" checked={adHocApplyFee} onChange={(event) => setAdHocApplyFee(event.target.checked)} />
              <span><strong>Add £2.50 non-booking fee</strong><small>Optional. The full ad-hoc charge uses account credit first; any remainder becomes due on the parent’s invoice.</small></span>
              <b>£2.50</b>
            </label>

            {adHocError && <p className="register-adhoc-error" role="alert">{adHocError}</p>}

            <footer>
              <div>
                <span>{selectedAdHocSessions.length} {selectedAdHocSessions.length === 1 ? "session" : "sessions"}</span>
                <strong>£{adHocTotal.toFixed(2)}</strong>
              </div>
              <button className="button light" type="button" onClick={() => setAdHocOpen(false)} disabled={adHocSaving}>Cancel</button>
              <button className="button book" type="button" onClick={submitAdHocBooking} disabled={adHocSaving || !adHocChildId || !adHocSessionIds.length}>
                {adHocSaving ? "Adding to register…" : "Add to register"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {adHocCancellationRow && (
        <div className="register-adhoc-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !adHocCancellationSaving) setAdHocCancellationRow(null);
        }}>
          <section className="register-adhoc-dialog register-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="register-cancel-adhoc-title">
            <header>
              <div>
                <p className="eyebrow">Cancel ad-hoc care</p>
                <h2 id="register-cancel-adhoc-title">Cancel {adHocCancellationRow.childName}’s ad-hoc booking?</h2>
                <p>This removes every session added in this ad-hoc booking. It does not affect their other bookings.</p>
              </div>
              <button type="button" onClick={() => setAdHocCancellationRow(null)} disabled={adHocCancellationSaving} aria-label="Close cancellation confirmation"><X size={20} /></button>
            </header>

            <div className="register-cancel-summary">
              <strong>{adHocCancellationRows.length} {adHocCancellationRows.length === 1 ? "session" : "sessions"} will be cancelled</strong>
              <ul>
                {adHocCancellationRows.map((row) => (
                  <li key={row.bookingItemId}>
                    <b>{row.sessionLabel}</b>
                    <span>{new Date(row.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}-{new Date(row.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
              <p>The family account charge will be reversed and any credit used will be returned. The parent will receive a cancellation email and will not need to take any further action.</p>
            </div>

            {adHocCancellationError && <p className="register-adhoc-error" role="alert">{adHocCancellationError}</p>}

            <footer>
              <div><span>Booking reference</span><strong>{adHocCancellationRow.bookingReference || "Ad-hoc care"}</strong></div>
              <button className="button light" type="button" onClick={() => setAdHocCancellationRow(null)} disabled={adHocCancellationSaving}>Keep booking</button>
              <button className="button register-cancel-confirm" type="button" onClick={confirmAdHocCancellation} disabled={adHocCancellationSaving}>
                {adHocCancellationSaving ? "Cancelling…" : "Yes, cancel ad-hoc care"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function PlatformHeader({ role, actualRole, canPreviewRoles, viewRole, setViewRole, previewUsers, previewUserId, setPreviewUserId, selectedPreviewUser, userEmail, onSignOut, data, access }) {
  const headline = role === "Staff" ? "My Après Workspace" : "Today at Après";
  const subline = role === "Staff"
    ? "Your sessions, documents, pay and staff actions in one place."
    : "The key actions for staffing, compliance, bookings and site operations.";
  const previewingPerson = canPreviewRoles && selectedPreviewUser && ["Staff", "Manager"].includes(viewRole);
  return (
    <div className="platform-header">
      <div>
        <p className="eyebrow">Secure role-based platform</p>
        <h1>{headline}</h1>
        <p className="platform-subline">{subline}</p>
        {userEmail && <p className="platform-user">{previewingPerson ? `${selectedPreviewUser.name} · ${selectedPreviewUser.email}` : userEmail} · {role}</p>}
        {canPreviewRoles && viewRole !== actualRole && (
          <p className="platform-warning">
            Previewing the platform as {previewingPerson ? `${selectedPreviewUser.name} (${viewRole})` : viewRole}. Your real account remains {actualRole}.
          </p>
        )}
        <p className="platform-source">{data.loading ? "Loading live records..." : data.source}</p>
        {access?.isScoped && <p className="platform-source">Manager scope: {access.directReports.length} direct reports · own team records only</p>}
        {access?.isStaffScoped && <p className="platform-source">Staff scope: personal records only</p>}
        {data.error && <p className="platform-warning">{data.error}</p>}
        {Boolean(data.warnings?.length) && (
          <p className="platform-warning">
            Some live sections need attention: {data.warnings.slice(0, 2).join(" · ")}
            {data.warnings.length > 2 ? ` · ${data.warnings.length - 2} more` : ""}
          </p>
        )}
      </div>
      <div className="header-tools">
        {canPreviewRoles && (
          <label className="view-as-control">
            <span>View as</span>
            <select value={viewRole} onChange={(event) => setViewRole(event.target.value)}>
              {["Superadmin", "Admin", "Manager", "Staff"].map((item) => <option key={item}>{item}</option>)}
            </select>
            <small>Signed in as {actualRole}</small>
          </label>
        )}
        {canPreviewRoles && ["Staff", "Manager"].includes(viewRole) && (
          <label className="view-as-control view-person-control">
            <span>{viewRole === "Manager" ? "Preview manager" : "Preview staff member"}</span>
            <select value={previewUserId} onChange={(event) => setPreviewUserId(event.target.value)} disabled={!previewUsers.length}>
              {previewUsers.length
                ? previewUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)
                : <option value="">No {viewRole.toLowerCase()} records</option>}
            </select>
            <small>{previewUsers.length} available</small>
          </label>
        )}
        <span className="secure-label">Protected</span>
        <button className="button light" type="button" onClick={onSignOut}>Sign Out</button>
      </div>
    </div>
  );
}

const familyImportChildSections = ["Overview", "Contacts", "Consents", "Dietary", "Allergies", "Medication", "Medical", "SEND"];

function reviewValue(value, fallback = "Not provided") {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => reviewValue(item, "")).filter(Boolean).join(" · ") || fallback;
  if (value && typeof value === "object") {
    const preferred = value.name || value.label || value.value || value.detail || value.description;
    if (preferred) return String(preferred);
    return Object.entries(value)
      .filter(([, item]) => item !== "" && item !== null && item !== undefined && item !== false)
      .map(([key, item]) => `${key.replace(/([A-Z])/g, " $1")}: ${reviewValue(item, "")}`)
      .filter((item) => !item.endsWith(": "))
      .join(" · ") || fallback;
  }
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value || "").trim() || fallback;
}

function migrationHealthReviewStatus(status) {
  if (status === "parent_update_required") return "Invitation blocked";
  if (status === "parent_contacted") return "Parent contacted";
  if (status === "resolved") return "Resolved";
  return "Awaiting family import";
}

function FamilyImportReview({ access }) {
  const [families, setFamilies] = useState([]);
  const [healthReviewItems, setHealthReviewItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [centre, setCentre] = useState("All centres");
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
  const [childSection, setChildSection] = useState("Overview");
  const [healthResolutionItem, setHealthResolutionItem] = useState(null);
  const [healthResolutionDraft, setHealthResolutionDraft] = useState({ itemName: "", expiryDate: "", confirmationMethod: "", notes: "" });
  const [healthResolutionBusy, setHealthResolutionBusy] = useState(false);
  const [healthResolutionMessage, setHealthResolutionMessage] = useState("");
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [creditDraft, setCreditDraft] = useState({ amount: "", reason: "refund", note: "" });
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditMessage, setCreditMessage] = useState("");
  const [creditMessageTone, setCreditMessageTone] = useState("success");
  const canReview = ["Admin", "Superadmin"].includes(access?.role);

  useEffect(() => {
    let cancelled = false;
    if (!canReview) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    loadSupabaseModule()
      .then(({ fetchMigrationReviewFamilies, fetchMigrationHealthReviewItems }) => Promise.all([
        fetchMigrationReviewFamilies(),
        fetchMigrationHealthReviewItems(),
      ]))
      .then(([rows, reviewItems]) => {
        if (cancelled) return;
        setFamilies(rows);
        setHealthReviewItems(reviewItems);
        setSelectedFamilyId((current) => current || rows[0]?.id || "");
        setLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError?.message || "The imported family records could not be loaded.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canReview]);

  const centres = [...new Set(families.flatMap((family) => family.registered_centres || []).filter(Boolean))].sort();
  const normalisedSearch = search.trim().toLowerCase();
  const filteredFamilies = families.filter((family) => {
    const matchesCentre = centre === "All centres" || (family.registered_centres || []).includes(centre);
    const searchable = [family.full_name, family.email, ...(family.child_profiles || []).map((child) => child.full_name)].join(" ").toLowerCase();
    return matchesCentre && (!normalisedSearch || searchable.includes(normalisedSearch));
  });
  const selectedFamily = filteredFamilies.find((family) => family.id === selectedFamilyId) || filteredFamilies[0] || null;
  const selectedChildren = selectedFamily?.child_profiles || [];
  const selectedCreditEntries = selectedFamily?.parent_account_credit_entries || [];
  const selectedCreditBalance = selectedCreditEntries
    .filter((entry) => entry.status === "posted")
    .reduce((total, entry) => total + Number(entry.amount || 0), 0);
  const creditAmount = Math.round(Number(creditDraft.amount || 0) * 100) / 100;
  const creditBalancePreview = Math.round((selectedCreditBalance + (Number.isFinite(creditAmount) ? creditAmount : 0)) * 100) / 100;
  const selectedChild = selectedChildren.find((child) => child.id === selectedChildId) || selectedChildren[0] || null;
  const registration = selectedChild?.consents?.registration || {};
  const consentResponses = selectedChild?.consents?.responses || {};
  const missingParentFields = selectedFamily?.migration_metadata?.missingFields || [];
  const missingChildFields = selectedChild?.migration_metadata?.missingFields || [];
  const allChildren = families.flatMap((family) => family.child_profiles || []);
  const reviewFamilies = families.filter((family) => family.migration_metadata?.requiresReview === true).length;
  const linkedFamilies = families.filter((family) => family.profile_id).length;
  const unresolvedHealthItems = healthReviewItems.filter((item) => item.status !== "resolved");
  const parentUpdateHealthItems = unresolvedHealthItems.filter((item) => item.status === "parent_update_required").length;

  function openHealthReviewItem(item) {
    const family = families.find((candidate) => (candidate.child_profiles || []).some((child) => child.external_id === item.external_child_id));
    const child = family?.child_profiles?.find((candidate) => candidate.external_id === item.external_child_id);
    if (!family || !child) return;
    setSearch("");
    setCentre("All centres");
    setSelectedFamilyId(family.id);
    setSelectedChildId(child.id);
    setChildSection("Medication");
  }

  function startHealthResolution(item) {
    setHealthResolutionItem(item);
    setHealthResolutionDraft({ itemName: item.item_name || "", expiryDate: "", confirmationMethod: "", notes: "" });
    setHealthResolutionMessage("");
  }

  async function submitHealthResolution(event) {
    event.preventDefault();
    if (!healthResolutionItem || healthResolutionBusy) return;
    setHealthResolutionBusy(true);
    setHealthResolutionMessage("");
    try {
      const module = await loadSupabaseModule();
      await module.resolveMigrationHealthReviewItem({
        itemId: healthResolutionItem.id,
        itemName: healthResolutionDraft.itemName,
        expiryDate: healthResolutionDraft.expiryDate,
        confirmationMethod: healthResolutionDraft.confirmationMethod,
        notes: healthResolutionDraft.notes,
      });
      const [rows, reviewItems] = await Promise.all([
        module.fetchMigrationReviewFamilies(),
        module.fetchMigrationHealthReviewItems(),
      ]);
      setFamilies(rows);
      setHealthReviewItems(reviewItems);
      setHealthResolutionItem(null);
      setHealthResolutionMessage(`${healthResolutionItem.child_name}'s safety review is resolved. Their family invitation is now unlocked.`);
    } catch (resolutionError) {
      setHealthResolutionMessage(resolutionError?.message || "The safety review could not be resolved.");
    } finally {
      setHealthResolutionBusy(false);
    }
  }

  function openCreditAdjustment() {
    setCreditDraft({ amount: "", reason: "refund", note: "" });
    setCreditMessage("");
    setCreditDialogOpen(true);
  }

  async function submitCreditAdjustment(event) {
    event.preventDefault();
    if (!selectedFamily || creditBusy) return;
    if (!Number.isFinite(creditAmount) || creditAmount === 0) {
      setCreditMessageTone("error");
      setCreditMessage("Enter a positive amount to add credit or a negative amount to remove it.");
      return;
    }
    if (creditBalancePreview < 0) {
      setCreditMessageTone("error");
      setCreditMessage(`Only ${formatCurrency(selectedCreditBalance)} is available to remove.`);
      return;
    }
    setCreditBusy(true);
    setCreditMessage("");
    try {
      const module = await loadSupabaseModule();
      const result = await module.adjustParentAccountCredit({
        parentAccountId: selectedFamily.id,
        amount: creditAmount,
        reason: creditDraft.reason,
        note: creditDraft.note,
      });
      const rows = await module.fetchMigrationReviewFamilies();
      setFamilies(rows);
      setCreditDialogOpen(false);
      setCreditMessageTone(result.emailSent ? "success" : "warning");
      setCreditMessage(result.emailSent
        ? `${formatCurrency(Math.abs(creditAmount))} ${creditAmount > 0 ? "added to" : "removed from"} ${selectedFamily.full_name}'s credit. Confirmation emailed to ${selectedFamily.email}.`
        : `The credit was updated, but the customer email was not sent. ${result.emailError || "Please contact the customer manually."}`);
    } catch (creditError) {
      setCreditMessageTone("error");
      setCreditMessage(creditError?.message || "The credit adjustment could not be saved.");
    } finally {
      setCreditBusy(false);
    }
  }

  useEffect(() => {
    const familyChildren = selectedFamily?.child_profiles || [];
    if (!familyChildren.length) {
      if (selectedChildId) setSelectedChildId("");
      return;
    }
    if (!familyChildren.some((child) => child.id === selectedChildId)) setSelectedChildId(familyChildren[0].id);
  }, [selectedFamily?.id, selectedChildId]);

  if (!canReview) {
    return <EmptyList title="Admin access required" text="Imported family records are available only to Admin and Superadmin accounts." />;
  }

  return (
    <div className="family-import-review">
      <section className="family-import-review-head">
        <div>
          <p className="eyebrow">Protected migration review</p>
          <h2>Customer profiles</h2>
          <p>Review imported family records, account access and customer credit in one protected place.</p>
        </div>
        <div className="family-import-protection">
          <LockKeyhole />
          <div><strong>Controlled access</strong><span>Admin-only, audited safety updates</span></div>
        </div>
      </section>

      <div className="family-import-summary">
        <article><span>Families</span><strong>{families.length}</strong><small>Active imported records</small></article>
        <article><span>Children</span><strong>{allChildren.length}</strong><small>Linked to imported families</small></article>
        <article><span>Needs review</span><strong>{reviewFamilies}</strong><small>Complete before invitation</small></article>
        <article><span>Login accounts</span><strong>{linkedFamilies}</strong><small>{linkedFamilies ? "Check before continuing" : "None created"}</small></article>
      </div>

      <section className="family-import-health-review" aria-labelledby="migration-health-review-title">
        <div className="family-import-health-review-head">
          <div>
            <p className="eyebrow">Safety review</p>
            <h3 id="migration-health-review-title">Expired auto-injectors</h3>
            <p>Do not invite these families until a replacement device and current expiry date have been recorded.</p>
          </div>
          <div className="family-import-health-review-count"><strong>{unresolvedHealthItems.length}</strong><span>requiring review</span></div>
        </div>
        {unresolvedHealthItems.length ? (
          <div className="family-import-health-review-table" role="table" aria-label="Expired auto-injector review queue">
            <div className="family-import-health-review-row header" role="row">
              <span role="columnheader">Family</span><span role="columnheader">Child</span><span role="columnheader">Device</span><span role="columnheader">Expired</span><span role="columnheader">Status</span><span role="columnheader">Action</span>
            </div>
            {unresolvedHealthItems.map((item) => {
              const imported = item.status === "parent_update_required" && item.imported_child_profile_id;
              return (
                <div className={`family-import-health-review-row ${item.status}`} role="row" key={item.id}>
                  <span role="cell"><strong>{item.parent_name || "Parent pending"}</strong><small>{item.parent_email || "Email not imported"}</small></span>
                  <span role="cell"><strong>{item.child_name}</strong><small>Magicbooking ID {item.external_child_id}</small></span>
                  <span role="cell"><strong>{item.item_name}</strong><small>Auto-injector</small></span>
                  <span role="cell"><strong>{formatShortDate(item.expiry_date)}</strong><small>Expired</small></span>
                  <span role="cell"><strong>{migrationHealthReviewStatus(item.status)}</strong><small>{imported ? "Safety update required before invitation" : "Review when imported"}</small></span>
                  <span role="cell">{imported ? <div className="family-import-health-actions"><button className="button light" type="button" onClick={() => openHealthReviewItem(item)}>Review record</button><button className="button book" type="button" onClick={() => startHealthResolution(item)}>Resolve</button></div> : <span className="family-import-awaiting">Awaiting import</span>}</span>
                </div>
              );
            })}
          </div>
        ) : <EmptyList title="No expired auto-injectors" text="There are no unresolved auto-injector expiry reviews in this migration batch." />}
        <p className="family-import-health-review-note"><strong>{parentUpdateHealthItems} invitation{parentUpdateHealthItems === 1 ? " is" : "s are"} blocked now.</strong> {unresolvedHealthItems.length - parentUpdateHealthItems} more will be blocked automatically when their family is imported, until the safety review is resolved.</p>
        {healthResolutionMessage && <p className="family-import-health-resolution-message" role="status">{healthResolutionMessage}</p>}
      </section>

      {healthResolutionItem && (
        <div className="platform-modal-backdrop" role="presentation">
          <form className="hr-dismiss-modal family-import-health-resolution-modal" role="dialog" aria-modal="true" aria-labelledby="health-resolution-title" onSubmit={submitHealthResolution}>
            <button className="modal-close" type="button" aria-label="Close safety review" onClick={() => setHealthResolutionItem(null)}><X size={18} /></button>
            <p className="eyebrow">Resolve safety review</p>
            <h3 id="health-resolution-title">Confirm the replacement auto-injector</h3>
            <p>{healthResolutionItem.child_name} · Previous {healthResolutionItem.item_name} expired {formatShortDate(healthResolutionItem.expiry_date)}.</p>
            <div className="family-import-health-resolution-form">
              <label><span>Replacement device</span><input required value={healthResolutionDraft.itemName} onChange={(event) => setHealthResolutionDraft((current) => ({ ...current, itemName: event.target.value }))} /></label>
              <label><span>New expiry date</span><input required type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={healthResolutionDraft.expiryDate} onChange={(event) => setHealthResolutionDraft((current) => ({ ...current, expiryDate: event.target.value }))} /></label>
              <label><span>Confirmed through</span><select required value={healthResolutionDraft.confirmationMethod} onChange={(event) => setHealthResolutionDraft((current) => ({ ...current, confirmationMethod: event.target.value }))}><option value="">Choose confirmation method</option><option value="parent_email">Parent email</option><option value="parent_phone">Parent phone call</option><option value="parent_portal">Parent portal</option><option value="in_person">In person</option><option value="document">Document supplied</option></select></label>
              <label><span>Admin note (optional)</span><textarea value={healthResolutionDraft.notes} onChange={(event) => setHealthResolutionDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Add a concise note; avoid unnecessary medical detail." /></label>
            </div>
            <div className="family-import-health-resolution-warning"><strong>This unlocks the family invitation.</strong><span>Only continue after checking the replacement device and expiry date against the parent’s confirmation.</span></div>
            {healthResolutionMessage && <p className="platform-warning" role="alert">{healthResolutionMessage}</p>}
            <div className="dismiss-modal-actions"><button type="button" className="button secondary" onClick={() => setHealthResolutionItem(null)}>Cancel</button><button type="submit" className="button book" disabled={healthResolutionBusy || !healthResolutionDraft.itemName || !healthResolutionDraft.expiryDate || !healthResolutionDraft.confirmationMethod}>{healthResolutionBusy ? "Saving..." : "Resolve and unlock invitation"}</button></div>
          </form>
        </div>
      )}

      {creditDialogOpen && selectedFamily && (
        <div className="platform-modal-backdrop" role="presentation">
          <form className="hr-dismiss-modal family-credit-modal" role="dialog" aria-modal="true" aria-labelledby="family-credit-title" onSubmit={submitCreditAdjustment}>
            <button className="modal-close" type="button" aria-label="Close credit adjustment" onClick={() => setCreditDialogOpen(false)}><X size={18} /></button>
            <p className="eyebrow">Customer account credit</p>
            <h3 id="family-credit-title">Adjust {selectedFamily.full_name}'s credit</h3>
            <p>Add credit with a positive amount, or remove existing credit with a negative amount. Every change is recorded in the audit trail.</p>
            <div className="family-credit-balance" aria-live="polite">
              <div><span>Current balance</span><strong>{formatCurrency(selectedCreditBalance)}</strong></div>
              <div className={creditBalancePreview < 0 ? "invalid" : ""}><span>Balance after change</span><strong>{formatCurrency(creditBalancePreview)}</strong></div>
            </div>
            <div className="family-credit-form">
              <label><span>Amount (£)</span><input required type="number" inputMode="decimal" step="0.01" min="-10000" max="10000" value={creditDraft.amount} onChange={(event) => setCreditDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="25.00 or -10.00" /><small>Positive adds credit. Negative removes credit.</small></label>
              <label><span>Reason</span><select required value={creditDraft.reason} onChange={(event) => setCreditDraft((current) => ({ ...current, reason: event.target.value }))}><option value="refund">Refund</option><option value="goodwill">Goodwill</option><option value="credit_adjustment">Credit adjustment</option></select></label>
              <label className="family-credit-note"><span>Note for the customer</span><textarea required minLength="3" maxLength="300" value={creditDraft.note} onChange={(event) => setCreditDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Briefly explain why this credit is being changed." /><small>{creditDraft.note.length}/300 · This note and the reason will be included in the customer's email.</small></label>
            </div>
            {creditMessage && <p className={`family-credit-message ${creditMessageTone}`} role="alert">{creditMessage}</p>}
            <div className="dismiss-modal-actions"><button type="button" className="button secondary" onClick={() => setCreditDialogOpen(false)}>Cancel</button><button type="submit" className="button book" disabled={creditBusy || !creditDraft.note.trim() || !creditAmount || creditBalancePreview < 0}>{creditBusy ? "Saving..." : creditAmount < 0 ? `Remove ${formatCurrency(Math.abs(creditAmount))} credit` : `Add ${formatCurrency(Math.abs(creditAmount))} credit`}</button></div>
          </form>
        </div>
      )}

      <section className="family-import-controls" aria-label="Filter imported families">
        <label><span>Search families</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Parent, email or child" /></label>
        <label><span>Centre</span><select value={centre} onChange={(event) => setCentre(event.target.value)}><option>All centres</option>{centres.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div><span>Showing</span><strong>{filteredFamilies.length} of {families.length}</strong></div>
      </section>

      {loading && <EmptyList title="Loading imported families" text="Fetching the protected migration sample from Supabase." />}
      {error && <EmptyList title="Imported families could not be loaded" text={error} />}
      {!loading && !error && !families.length && <EmptyList title="No customer profiles" text="No active Magicbooking family records are available." />}

      {!loading && !error && families.length > 0 && (
        <div className="family-import-layout">
          <section className="family-import-list" aria-label="Imported family list">
            <div className="family-import-list-head"><strong>Families</strong><span>{filteredFamilies.length} shown</span></div>
            {filteredFamilies.map((family) => (
              <button type="button" className={selectedFamily?.id === family.id ? "active" : ""} key={family.id} onClick={() => { setSelectedFamilyId(family.id); setSelectedChildId(family.child_profiles?.[0]?.id || ""); setChildSection("Overview"); setCreditMessage(""); setCreditDialogOpen(false); }}>
                <span>{family.migration_metadata?.requiresReview === true ? "Review" : family.profile_id ? "Active" : "Record"}</span>
                <strong>{family.full_name}</strong>
                <small>{family.email}</small>
                <small>{family.child_profiles?.length || 0} child{family.child_profiles?.length === 1 ? "" : "ren"} · {reviewValue(family.registered_centres, "Centre missing")}</small>
              </button>
            ))}
            {!filteredFamilies.length && <EmptyList title="No matching families" text="Try another parent, child or centre." />}
          </section>

          {selectedFamily && (
            <section className="family-import-detail" aria-label={`Review ${selectedFamily.full_name}`}>
              <div className="family-import-family-head">
                <div><p className="eyebrow">Family record</p><h3>{selectedFamily.full_name}</h3><p>{selectedFamily.email} · {selectedFamily.phone || "Phone missing"}</p></div>
                <div className="family-credit-profile-actions"><div className="family-credit-profile-balance"><span>Account credit</span><strong>{formatCurrency(selectedCreditBalance)}</strong></div><button className="button book" type="button" onClick={openCreditAdjustment}>Top up / adjust credit</button><Badge value={selectedFamily.portal_status === "migration_review" ? "Migration review" : selectedFamily.portal_status || "Active"} /><span className="family-import-no-login">{selectedFamily.profile_id ? "Login linked" : "No login created"}</span></div>
              </div>
              {creditMessage && <p className={`family-credit-status ${creditMessageTone}`} role="status">{creditMessage}</p>}
              <div className="family-import-parent-grid">
                <article><span>Registered centres</span><strong>{reviewValue(selectedFamily.registered_centres, "Not recorded")}</strong></article>
                <article><span>Emergency contacts</span><strong>{selectedFamily.emergency_contact?.contacts?.length || 0} recorded</strong><small>{reviewValue([selectedFamily.emergency_contact?.primaryPhone, selectedFamily.emergency_contact?.secondaryPhone], "Numbers missing")}</small></article>
                <article><span>Address</span><strong>{reviewValue([selectedFamily.billing_address?.line1, selectedFamily.billing_address?.town, selectedFamily.billing_address?.postcode], "Not recorded")}</strong></article>
                <article className={missingParentFields.length ? "needs-review" : "complete"}><span>Parent review</span><strong>{missingParentFields.length ? `${missingParentFields.length} item${missingParentFields.length === 1 ? "" : "s"} missing` : "Source record complete"}</strong><small>{reviewValue(missingParentFields, "No missing fields")}</small></article>
              </div>

              <div className="family-import-child-picker" aria-label="Imported children">
                {selectedChildren.map((child) => <button type="button" className={selectedChild?.id === child.id ? "active" : ""} key={child.id} onClick={() => { setSelectedChildId(child.id); setChildSection("Overview"); }}><span>{selectedChild?.id === child.id ? "Selected child" : "Saved child"}</span><strong>{child.full_name}</strong><small>{child.school_name || "School missing"} · {child.year_group || "Year group missing"}</small></button>)}
              </div>

              {selectedChild ? (
                <>
                  <nav className="family-import-child-tabs" aria-label="Child review sections">
                    {familyImportChildSections.map((section) => <button type="button" className={childSection === section ? "active" : ""} aria-current={childSection === section ? "page" : undefined} key={section} onClick={() => setChildSection(section)}>{section}</button>)}
                  </nav>
                  <section className="family-import-child-panel">
                    <div className="family-import-child-panel-head"><div><p className="eyebrow">{childSection}</p><h4>{selectedChild.full_name}</h4></div><span>{missingChildFields.length ? `${missingChildFields.length} item${missingChildFields.length === 1 ? "" : "s"} to complete` : "Source record complete"}</span></div>
                    {childSection === "Overview" && <div className="family-import-data-grid"><article><span>Date of birth</span><strong>{formatShortDate(selectedChild.date_of_birth)}</strong></article><article><span>School</span><strong>{selectedChild.school_name || "Not provided"}</strong></article><article><span>Year group</span><strong>{selectedChild.year_group || "Not provided"}</strong></article><article><span>Ethnicity</span><strong>{registration.ethnicity || "Not provided"}</strong><small>Optional</small></article><article><span>Languages</span><strong>{reviewValue(registration.languages, "Not provided")}</strong></article><article className={missingChildFields.length ? "needs-review" : "complete"}><span>Missing information</span><strong>{reviewValue(missingChildFields, "Nothing flagged")}</strong></article></div>}
                    {childSection === "Contacts" && <div className="family-import-record-list"><article><div><span>Family emergency contacts</span><strong>{selectedFamily.emergency_contact?.contacts?.length || 0} recorded</strong><small>{reviewValue(selectedFamily.emergency_contact?.contacts, "No emergency contacts imported")}</small></div></article><article><div><span>Authorised collectors</span><strong>{selectedChild.authorised_collectors?.length || 0} recorded</strong><small>{reviewValue(selectedChild.authorised_collectors, "No authorised collectors imported")}</small></div></article><article><div><span>Collection password</span><strong>{registration.collectionPassword ? "Recorded" : "Not provided"}</strong><small>{registration.collectionPassword ? "Hidden during review" : "Parent will need to add this"}</small></div></article></div>}
                    {childSection === "Consents" && <div className="family-import-consent-list">{Object.entries(consentResponses).length ? Object.entries(consentResponses).map(([label, value]) => <article key={label}><span>{label}</span><strong className={value ? "yes" : "no"}>{value ? "Yes" : "No"}</strong></article>) : <EmptyList title="No consent responses imported" text="The parent will be asked to review current consents before booking." />}</div>}
                    {childSection === "Dietary" && <div className="family-import-record-list"><article><div><span>Dietary needs</span><strong>{selectedChild.dietary_notes || "No dietary needs recorded"}</strong><small>{selectedChild.dietary_notes ? "Review with parent" : "Nothing further required unless circumstances changed"}</small></div></article></div>}
                    {childSection === "Allergies" && <div className="family-import-record-list"><article><div><span>Allergies</span><strong>{selectedChild.allergy_notes || "No allergies recorded"}</strong><small>{selectedChild.allergy_notes ? "Review triggers, symptoms and initial action with parent" : "Nothing further required unless circumstances changed"}</small></div></article></div>}
                    {childSection === "Medication" && <div className="family-import-record-list"><article><div><span>Medication</span><strong>{reviewValue(registration.medications, "No medication recorded")}</strong><small>{registration.medications?.length ? "Medication details require parent confirmation" : "No action unless medication is now required"}</small></div></article><article><div><span>Auto-injectors</span><strong>{reviewValue(registration.autoInjectors, "No auto-injector recorded")}</strong><small>{registration.autoInjectors?.length ? "Check medicine name and expiry date" : "No action unless circumstances changed"}</small></div></article></div>}
                    {childSection === "Medical" && <div className="family-import-record-list"><article><div><span>Medical conditions</span><strong>{selectedChild.medical_notes || "No medical conditions recorded"}</strong><small>{selectedChild.medical_notes ? "Review care plan and staff instructions with parent" : "Nothing further required unless circumstances changed"}</small></div></article><article><div><span>Additional information</span><strong>{registration.additionalInfo || "Not provided"}</strong></div></article></div>}
                    {childSection === "SEND" && <div className="family-import-record-list"><article><div><span>SEND</span><strong>{reviewValue(registration.send, "No SEND information recorded")}</strong><small>{registration.send?.length ? "Review support needs and current plans with parent" : "No action unless support needs have changed"}</small></div></article><article><div><span>External agencies</span><strong>{reviewValue(registration.externalAgencies, "None recorded")}</strong></div></article></div>}
                  </section>
                </>
              ) : <EmptyList title="No child profiles" text="This family has no imported child record and needs manual review." />}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StaffDashboard({ data, access, userEmail }) {
  const pendingDocs = data.documents.reduce((total, doc) => total + Math.max(0, Number(doc.assigned || 0) - Number(doc.read || 0)), 0);
  const ownStaff = resolveOwnStaffRecord(data, access, userEmail);
  const [ownSuitabilityDeclarations, setOwnSuitabilityDeclarations] = useState(() => normaliseSuitabilityDeclarations(ownStaff || {}));
  const ownStaffForDeclaration = ownStaff ? { ...ownStaff, suitabilityDeclarations: ownSuitabilityDeclarations } : null;
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const ownStaffWithScr = ownStaff ? applyScrChecklistState([ownStaff])[0] : null;
  const staffRenewalItems = ownStaffWithScr ? buildScrRenewalItems([ownStaffWithScr]) : [];
  const staffEvidenceRequests = ownStaffWithScr ? buildStaffEvidenceRequests(ownStaffWithScr, staffRenewalItems, renewalRequests) : [];
  const payslips = ownStaff ? staffPayslips(data.hrFiles, ownStaff.id).slice(0, 6) : [];
  useEffect(() => {
    setOwnSuitabilityDeclarations(normaliseSuitabilityDeclarations(ownStaff || {}));
  }, [ownStaff?.id, ownStaff?.suitabilityDeclarations]);
  useEffect(() => {
    if (!data.scrRenewalRequests || !Object.keys(data.scrRenewalRequests).length) return;
    setRenewalRequests((current) => ({ ...current, ...data.scrRenewalRequests }));
  }, [data.scrRenewalRequests]);
  function saveEvidenceSubmission(item, submission) {
    const checklistState = readScrChecklistState();
    const currentProfile = checklistState[item.staffId] || ownStaffWithScr?.scrChecklist || {};
    const currentEvidence = currentProfile.evidence || {};
    const nextChecklistState = {
      ...checklistState,
      [item.staffId]: {
        ...currentProfile,
        evidence: {
          ...currentEvidence,
          [item.evidenceKey]: {
            ...(currentEvidence[item.evidenceKey] || {}),
            reference: submission.reference,
            expiryDate: submission.expiryDate,
            note: submission.note,
            submittedAt: new Date().toISOString(),
            submittedBy: ownStaff?.name || "Staff member",
            status: "Submitted for review",
          },
        },
        updatedAt: new Date().toISOString(),
      },
    };
    saveScrChecklistState(nextChecklistState);
    persistScrChecklistRecord(item.staffId, nextChecklistState[item.staffId], "SCR evidence submission saved");
    const nextRequests = {
      ...renewalRequests,
      [item.id]: {
        ...appendScrRequestHistory({
          ...(renewalRequests[item.id] || {}),
          status: "Submitted",
          evidenceReference: submission.reference,
          evidenceExpiryDate: submission.expiryDate,
          submittedAt: new Date().toISOString(),
          submittedBy: ownStaff?.name || "Staff member",
          submissionNote: submission.note,
          resubmittedAt: renewalRequests[item.id]?.status === "Rejected" ? new Date().toISOString() : renewalRequests[item.id]?.resubmittedAt,
        }, renewalRequests[item.id]?.status === "Rejected" ? "Resubmitted" : "Submitted", ownStaff?.name || "Staff member", submission.reference),
      },
    };
    setRenewalRequests(nextRequests);
    localStorage.setItem(scrRenewalRequestsStorageKey, JSON.stringify(nextRequests));
    persistScrEvidenceRequestRecord(item.id, item.staffId, item.evidenceKey, nextRequests[item.id], "SCR evidence submission synced");
    addAuditLog("SCR evidence submitted", `${item.title}: ${submission.reference}`);
  }
  return (
    <DashboardGrid className="staff-workspace-grid">
      {ownStaff && (
        <section className="staff-home-summary">
          <div className="staff-home-copy">
            <p className="eyebrow">My staff record</p>
            <h2>{ownStaff.preferredName || ownStaff.name}</h2>
            <p>{ownStaff.role} · {staffPrimaryLocation(ownStaff)}</p>
            <div className="staff-home-badges">
              <Badge value={ownStaff.compliance || "Review"} />
              <Badge value={ownStaff.contractType || "Contract not recorded"} />
            </div>
          </div>
          <div className="staff-home-details">
            <span><strong>{ownStaff.email || "Email not recorded"}</strong>Email</span>
            <span><strong>{ownStaff.phone || "Phone not recorded"}</strong>Phone</span>
            <span><strong>{ownStaff.startDate || "Not recorded"}</strong>Start date</span>
          </div>
        </section>
      )}
      <Metric icon={<CalendarDays />} label="Upcoming shifts" value={data.sessions.length} tone="green" />
      <Metric icon={<ClipboardCheck />} label="Compliance status" value={ownStaff?.compliance || "Review"} tone="blue" />
      <Metric icon={<BookOpen />} label="Docs to read" value={pendingDocs} tone={pendingDocs ? "amber" : "green"} />
      <Metric icon={<Upload />} label="Evidence requests" value={staffEvidenceRequests.filter((item) => ["Requested", "Rejected"].includes(item.status)).length} tone={staffEvidenceRequests.some((item) => ["Requested", "Rejected"].includes(item.status)) ? "amber" : "green"} />
      <Metric
        icon={<PoundSterling />}
        label="Pay data"
        value={ownStaff?.annualSalary ? `${formatCurrency(monthlySalaryFromAnnual(ownStaff.annualSalary))}/mo` : ownStaff?.payRate ? `${formatCurrency(ownStaff.payRate)}/hr` : "Pending"}
        tone="green"
      />
      <Panel title="My Evidence Requests"><StaffEvidenceRequestList items={staffEvidenceRequests} onSubmit={saveEvidenceSubmission} /></Panel>
      {ownStaffForDeclaration && (
        <Panel title="Annual Suitability Declaration">
          <SuitabilityDeclarationPanel
            person={ownStaffForDeclaration}
            canComplete
            onSaved={(declaration) => setOwnSuitabilityDeclarations((current) => normaliseSuitabilityDeclarations({ suitabilityDeclarations: [declaration, ...current] }))}
          />
        </Panel>
      )}
      <Panel title="My Payslips">
        <div className="list">
          {payslips.map((file) => (
            <article className="list-item" key={file.id}>
              <div>
                <strong>{file.title}</strong>
                <span>{file.issueDate ? formatShortDate(file.issueDate) : file.uploadedAt ? formatShortDate(file.uploadedAt.slice(0, 10)) : "Date pending"}</span>
                {file.notes && <small>{file.notes}</small>}
              </div>
              {file.fileUrl ? <a className="button light" href={file.fileUrl} target="_blank" rel="noreferrer">Open</a> : <Badge value={file.storagePath ? "Private file" : "No file"} />}
            </article>
          ))}
          {!payslips.length && <EmptyList title="No payslips yet" text="Payslips will appear here after admin uploads them." />}
        </div>
      </Panel>
      <Panel title="My Upcoming Sessions"><SessionList data={data} personal /></Panel>
      <Panel title="My Trophy Cabinet"><RewardList data={data} /></Panel>
      <Panel title="My Actions"><ActionList items={["Read assigned policy updates", "Confirm any annual declaration requests", "Upload evidence only when asked by admin"]} /></Panel>
    </DashboardGrid>
  );
}

function AdminDashboard({ data, access, onOpenTab, onOpenBookingFocus, onOpenStaffProfile, onOpenInspectionView }) {
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const [dashboardLedger, setDashboardLedger] = useState(() => ({
    invoices: [], bookings: [], fetchedAt: "", liveRequested: bookingSystemConfigured(),
  }));
  const [dashboardLedgerStatus, setDashboardLedgerStatus] = useState("Loading booking ledger...");
  const [dashboardLedgerError, setDashboardLedgerError] = useState("");
  const hasLiveBookingLedger = bookingSystemConfigured();
  const staffWithScrState = applyScrChecklistState(data.staff);
  const renewalItems = buildScrRenewalItems(staffWithScrState);
  const expiredRenewals = renewalItems.filter((item) => item.status === "Expired").length;
  const renewalActions = buildScrRenewalActions(renewalItems, renewalRequests);
  const outstandingRenewalRequests = renewalActions.filter((item) => item.request?.status === "Requested").length;
  const submittedEvidence = buildSubmittedEvidenceReviews(staffWithScrState, renewalRequests);
  const staffNeedingAction = data.staff.filter((person) => !String(person.compliance).toLowerCase().includes("compliant")).length;
  const pendingDocs = data.documents.reduce((total, doc) => total + Math.max(0, Number(doc.assigned || 0) - Number(doc.read || 0)), 0);
  const activeUsers = mergeUserRecords(data.staff, readUserAdminState()).filter((user) => user.status !== "Deactivated").length;
  const coverMoves = readJson(coverMoveStorageKey, []);
  const pendingCoverMoves = coverMoves.filter((move) => !["Sent", "Archived"].includes(move.status)).length;
  const suitabilityCounts = buildSuitabilityDeclarationCounts(staffWithScrState.filter((person) => !isFormerStaffRecord(person)));
  const suitabilityActions = suitabilityCounts.dueSoon + suitabilityCounts.expired + suitabilityCounts.missing;
  const websiteEnquiries = data.enquiries.filter((record) => record.type !== "Outreach");
  const newWebsiteEnquiries = websiteEnquiries.filter((record) => ["New", "Reviewing", "Follow up"].includes(record.status || "New")).length;
  const attentionCount = submittedEvidence.length + expiredRenewals + pendingCoverMoves + pendingDocs + suitabilityActions;
  const priorityItems = [
    [submittedEvidence.length, "Review submitted evidence", "Approve or send back staff evidence waiting for admin review.", "SCR"],
    [expiredRenewals, "Expired SCR evidence", "Request updated evidence and keep assurance records current.", "SCR"],
    [suitabilityActions, "Annual suitability declarations", "Chase missing, overdue or nearly due suitability declarations.", "SCR"],
    [pendingCoverMoves, "Cover notices pending", "Confirm rota cover emails when staff are moved between sites.", "Rota"],
    [pendingDocs, "Unread policy acknowledgements", "Chase missing reads from the document library.", "Documents"],
  ];
  const staffActionRows = staffWithScrState
    .filter((person) => !String(person.compliance).toLowerCase().includes("compliant"))
    .slice(0, 5);
  const quickActions = [
    ["Enquiries", `${newWebsiteEnquiries || websiteEnquiries.length} website contact response${(newWebsiteEnquiries || websiteEnquiries.length) === 1 ? "" : "s"}`, "CRM"],
    ["Site SCR", "Open site-scoped compliance and evidence tools", "Inspection"],
    ["Rota", "Cover, first aid and EYFS cover", "Rota"],
    ["Ofsted", "Site readiness and inspection window", "Ofsted"],
    ["Hours", "Paid windows and approvals", "Hours"],
  ];
  const bookingRows = hasLiveBookingLedger && !dashboardLedgerError
    ? normaliseBookingLedgerRows({
      ...dashboardLedger,
      bookings: dashboardLedger.bookings?.length ? dashboardLedger.bookings : [],
      invoices: dashboardLedger.invoices?.length ? dashboardLedger.invoices : [],
      useDemoFallback: false,
    }, data)
    : normaliseBookingLedgerRows(dashboardLedger, data);
  const dashboardMetrics = buildAdminBookingDashboardMetrics(bookingRows, data, {
    staffNeedingAction,
    pendingDocs,
    submittedEvidence: submittedEvidence.length,
    suitabilityActions,
    pendingCoverMoves,
    websiteEnquiries: newWebsiteEnquiries || websiteEnquiries.length,
    expiredRenewals,
  });
  const dashboardUpdatedLabel = dashboardLedger.fetchedAt ? `Updated ${formatDateTime(dashboardLedger.fetchedAt)}` : dashboardLedgerStatus;
  useEffect(() => {
    if (!data.scrRenewalRequests || !Object.keys(data.scrRenewalRequests).length) return;
    setRenewalRequests((current) => ({ ...current, ...data.scrRenewalRequests }));
  }, [data.scrRenewalRequests]);
  useEffect(() => {
    let cancelled = false;
    async function loadDashboardLedger() {
      if (!hasLiveBookingLedger) {
        setDashboardLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: false });
        setDashboardLedgerStatus("Demo ledger until live booking credentials are present.");
        return;
      }
      setDashboardLedgerStatus("Loading live booking ledger...");
      setDashboardLedgerError("");
      try {
        const nextLedger = await fetchAdminBookingLedger({ limit: 250 });
        if (cancelled) return;
        setDashboardLedger({ ...nextLedger, liveRequested: true });
        setDashboardLedgerStatus(nextLedger.bookings?.length ? "Live booking ledger loaded." : "Live ledger connected. No bookings found yet.");
      } catch (error) {
        if (cancelled) return;
        setDashboardLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: true });
        setDashboardLedgerStatus("Live booking data unavailable. No booking rows are being shown.");
        setDashboardLedgerError(error?.message || "Could not load live booking ledger.");
      }
    }
    loadDashboardLedger();
    return () => {
      cancelled = true;
    };
  }, [hasLiveBookingLedger]);
  function saveRenewalRequests(next) {
    setRenewalRequests(next);
    localStorage.setItem(scrRenewalRequestsStorageKey, JSON.stringify(next));
  }
  function requestEvidence(item) {
    const next = {
      ...renewalRequests,
      [item.id]: {
        ...appendScrRequestHistory({
          status: "Requested",
          requestedAt: new Date().toISOString(),
          requestedBy: access?.currentUser?.name || "Admin",
          note: `Updated ${item.check.toLowerCase()} evidence requested.`,
        }, "Requested", access?.currentUser?.name || "Admin", `Updated ${item.check.toLowerCase()} evidence requested.`),
      },
    };
    saveRenewalRequests(next);
    persistScrEvidenceRequestRecord(item.id, item.staffId, item.evidenceKey, next[item.id], "SCR evidence request synced");
    addAuditLog("SCR evidence requested", `${item.title}: ${item.meta}`);
  }
  function clearEvidenceRequest(item) {
    const next = {
      ...renewalRequests,
      [item.id]: {
        ...appendScrRequestHistory({
          ...(renewalRequests[item.id] || {}),
          status: "Cleared",
          clearedAt: new Date().toISOString(),
          clearedBy: access?.currentUser?.name || "Admin",
        }, "Cleared", access?.currentUser?.name || "Admin", "Admin cleared the evidence request."),
      },
    };
    saveRenewalRequests(next);
    persistScrEvidenceRequestRecord(item.id, item.staffId, item.evidenceKey, next[item.id], "SCR evidence request cleared");
    addAuditLog("SCR evidence request cleared", item.title);
  }
  function reviewSubmittedEvidence(item, decision, note = "") {
    const rejectionReason = note.trim() || "Please check the evidence reference, date or document and resubmit for review.";
    const checklistState = readScrChecklistState();
    const currentProfile = checklistState[item.staffId] || staffWithScrState.find((person) => person.id === item.staffId)?.scrChecklist || {};
    const currentEvidence = currentProfile.evidence || {};
    const nextChecklistState = {
      ...checklistState,
      [item.staffId]: {
        ...currentProfile,
        evidence: {
          ...currentEvidence,
          [item.evidenceKey]: {
            ...(currentEvidence[item.evidenceKey] || {}),
            status: decision === "approve" ? "Approved" : "Rejected",
            reviewedAt: new Date().toISOString(),
            reviewedBy: access?.currentUser?.name || "Admin",
            reviewNote: decision === "approve" ? "" : rejectionReason,
            verifiedBy: decision === "approve" ? (access?.currentUser?.name || "Admin") : currentEvidence[item.evidenceKey]?.verifiedBy,
            dateSeen: decision === "approve" ? new Date().toISOString().slice(0, 10) : currentEvidence[item.evidenceKey]?.dateSeen,
          },
        },
        updatedAt: new Date().toISOString(),
      },
    };
    saveScrChecklistState(nextChecklistState);
    persistScrChecklistRecord(item.staffId, nextChecklistState[item.staffId], decision === "approve" ? "SCR evidence approval synced" : "SCR evidence rejection synced");
    const nextRequests = {
      ...renewalRequests,
      [item.id]: {
        ...appendScrRequestHistory({
          ...(renewalRequests[item.id] || {}),
          status: decision === "approve" ? "Approved" : "Rejected",
          reviewedAt: new Date().toISOString(),
          reviewedBy: access?.currentUser?.name || "Admin",
          rejectionReason: decision === "approve" ? "" : rejectionReason,
        }, decision === "approve" ? "Approved" : "Sent back", access?.currentUser?.name || "Admin", decision === "approve" ? "Evidence approved." : rejectionReason),
      },
    };
    saveRenewalRequests(nextRequests);
    persistScrEvidenceRequestRecord(item.id, item.staffId, item.evidenceKey, nextRequests[item.id], decision === "approve" ? "SCR evidence approval request synced" : "SCR evidence rejection request synced");
    addAuditLog(decision === "approve" ? "SCR evidence approved" : "SCR evidence rejected", `${item.staffName}: ${item.check}`);
  }
  return (
    <>
      <section className="admin-engine-room">
        <div className="admin-engine-copy">
          <p className="eyebrow">Admin dashboard</p>
          <h2>{access?.isScoped ? `${access.scopeLabel || "Site"} control room.` : "Engine room."}</h2>
          <p>The operating picture for bookings, income, payments and the few operational issues that genuinely need attention.</p>
          <div className="admin-engine-kpis">
            <article>
              <span>Sessions today</span>
              <strong>{data.sessions.length}</strong>
              <small>{dashboardMetrics.sessionBlocks} booked session blocks in ledger</small>
            </article>
            <article>
              <span>Payment health</span>
              <strong>{dashboardMetrics.paymentHealth}%</strong>
              <small>{dashboardMetrics.paidCount + dashboardMetrics.guaranteedCount}/{dashboardMetrics.bookingCount || 0} paid or guaranteed</small>
            </article>
            <article>
              <span>Booking fill</span>
              <strong>{dashboardMetrics.bookingFill}%</strong>
              <small>{dashboardMetrics.activeSites} active booking site{dashboardMetrics.activeSites === 1 ? "" : "s"}</small>
            </article>
            <article>
              <span>Open actions</span>
              <strong>{dashboardMetrics.openActions}</strong>
              <small>Compliance, payment and delivery prompts</small>
            </article>
          </div>
        </div>
        <aside className="admin-engine-finance-card">
          <span>Current booking ledger</span>
          <strong>{formatCurrency(dashboardMetrics.bookedValue)}</strong>
          <p>Booked value</p>
          <dl>
            <div><dt>Collected / guaranteed</dt><dd>{formatCurrency(dashboardMetrics.collectedValue)}</dd></div>
            <div><dt>Outstanding</dt><dd>{formatCurrency(dashboardMetrics.outstandingValue)}</dd></div>
            <div><dt>Projected retained</dt><dd>{formatCurrency(dashboardMetrics.projectedRetained)}</dd></div>
            <div><dt>Bookings</dt><dd>{dashboardMetrics.bookingCount}</dd></div>
          </dl>
          <button className="button success" type="button" onClick={() => onOpenBookingFocus ? onOpenBookingFocus("all") : onOpenTab("Bookings")}>Open bookings</button>
          <small>{dashboardLedgerError || dashboardUpdatedLabel}</small>
        </aside>
      </section>
      <section className="admin-finance-strip">
        <button type="button" onClick={() => onOpenBookingFocus ? onOpenBookingFocus("week") : onOpenTab("Bookings")}>
          <span>Booked this week</span>
          <strong>{formatCurrency(dashboardMetrics.weekBookedValue)}</strong>
          <small>{dashboardMetrics.weekBookings} booking{dashboardMetrics.weekBookings === 1 ? "" : "s"} in the next 7 days</small>
        </button>
        <button type="button" className="blue" onClick={() => onOpenBookingFocus ? onOpenBookingFocus("collected") : onOpenTab("Bookings")}>
          <span>Collected / guaranteed</span>
          <strong>{formatCurrency(dashboardMetrics.collectedValue)}</strong>
          <small>{dashboardMetrics.paidCount} paid · {dashboardMetrics.guaranteedCount} guaranteed</small>
        </button>
        <button type="button" className={dashboardMetrics.outstandingValue ? "amber" : ""} onClick={() => onOpenBookingFocus ? onOpenBookingFocus("outstanding") : onOpenTab("Bookings")}>
          <span>Outstanding</span>
          <strong>{formatCurrency(dashboardMetrics.outstandingValue)}</strong>
          <small>{dashboardMetrics.pendingPaymentCount} payment action{dashboardMetrics.pendingPaymentCount === 1 ? "" : "s"}</small>
        </button>
        <button type="button" onClick={() => onOpenBookingFocus ? onOpenBookingFocus("all") : onOpenTab("Bookings")}>
          <span>Projected retained</span>
          <strong>{formatCurrency(dashboardMetrics.projectedRetained)}</strong>
          <small>Private admin-only margin model</small>
        </button>
      </section>
      <section className="admin-risk-strip">
        <article>
          <span>{dashboardMetrics.bookingFill}%</span>
          <strong>Booking utilisation</strong>
          <small>{dashboardMetrics.sessionBlocks} enrolled sessions across live orders</small>
        </article>
        <article className={dashboardMetrics.websiteEnquiries ? "amber" : ""}>
          <span>{dashboardMetrics.websiteEnquiries}</span>
          <strong>Open enquiries</strong>
          <small>New parent or school contact follow-ups</small>
        </article>
        <article className={dashboardMetrics.scrRisk ? "red" : ""}>
          <span>{dashboardMetrics.scrRisk}</span>
          <strong>SCR risk</strong>
          <small>Expired evidence, submitted evidence or suitability prompts</small>
        </article>
        <article className={dashboardMetrics.deliveryIssues ? "amber" : ""}>
          <span>{dashboardMetrics.deliveryIssues}</span>
          <strong>Delivery watch</strong>
          <small>Cover moves, unread policies or capacity notes</small>
        </article>
      </section>
      <section className="admin-control-room">
        <div>
          <p className="eyebrow">Control room</p>
          <h2>The four places admin actually needs most.</h2>
          <p>Everything else stays in the navigation. These are the daily levers for launch: money, bookings, people and site readiness.</p>
        </div>
        <div className="admin-control-cards">
          {[
            ["Finance", "Revenue, payment actions and reconciliation", "Finance", PoundSterling],
            ["Bookings", "Products, orders, capacity and PonchoPay flow", "Bookings", CalendarDays],
            ["People", "Staff, users and SCR assurance", "SCR", Users],
            ["Schools", "Site contracts, setup and delivery readiness", "Schools", ShieldCheck],
          ].map(([title, text, target, Icon]) => (
            <button key={title} type="button" onClick={() => onOpenTab(target)}>
              <Icon />
              <strong>{title}</strong>
              <span>{text}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="ops-briefing">
        <div>
          <p className="eyebrow">Today’s priorities</p>
          <h2>{access?.isScoped ? "Your team’s action list." : "What needs attention first."}</h2>
          <p>{attentionCount ? `${attentionCount} items need attention across compliance, rota and documents.` : "No urgent admin actions are waiting. Use quick actions for planned work."}</p>
          <div className="admin-quick-actions">
            {quickActions.map(([label, text, target]) => (
              <button key={label} className={target === "Inspection" ? "inspection" : ""} type="button" onClick={() => target === "Inspection" ? onOpenInspectionView?.() : onOpenTab(target)}>
                <strong>{label}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="priority-stack compact">
          {priorityItems.map(([count, title, text, target]) => (
            <article className={`priority-item ${count ? "amber" : "green"}`} key={title}>
              <span>{count || "OK"}</span>
              <strong>{title}</strong>
              <p>{count ? text : "Nothing urgent here."}</p>
              {Boolean(count) && <button type="button" onClick={() => onOpenTab(target)}>Open</button>}
            </article>
          ))}
        </div>
      </section>
      <DashboardGrid className="admin-dashboard-grid">
        <Metric icon={<Users />} label={access?.isScoped ? "Direct reports needing action" : "Staff needing action"} value={staffNeedingAction} tone={staffNeedingAction ? "amber" : "green"} />
        <Metric icon={<CalendarDays />} label="Upcoming sessions" value={data.sessions.length} tone="blue" />
        <Metric icon={<ClipboardCheck />} label="Submitted evidence" value={submittedEvidence.length} tone={submittedEvidence.length ? "amber" : "green"} />
        <Metric icon={<LockKeyhole />} label="Active users" value={activeUsers} tone="blue" />
        <Panel title="Annual Suitability">
          <div className="suitability-count-grid">
            <article><span>Current</span><strong>{suitabilityCounts.current}</strong></article>
            <article><span>Due within 30 days</span><strong>{suitabilityCounts.dueSoon}</strong></article>
            <article className={suitabilityCounts.expired ? "alert" : ""}><span>Expired</span><strong>{suitabilityCounts.expired}</strong></article>
            <article className={suitabilityCounts.missing ? "alert" : ""}><span>Missing</span><strong>{suitabilityCounts.missing}</strong></article>
          </div>
          <button className="button light" type="button" onClick={() => onOpenTab("SCR")}>Open staff profiles</button>
        </Panel>
        <Panel title="Staff Actions">
          <div className="list">
            {staffActionRows.map((person) => (
              <article
                className="list-item staff-action-card"
                key={person.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenStaffProfile(person.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenStaffProfile(person.id);
                  }
                }}
              >
                <div>
                  <strong>{person.name}</strong>
                  <span>{person.role} · {staffPrimaryLocation(person)}</span>
                  <small>DBS: {person.dbsRenewal || "Not recorded"} · Safeguarding: {person.safeguardingExpiry || "Not recorded"}</small>
                </div>
                <div className="staff-action-card-tools">
                  <Badge value={person.compliance || "Review"} />
                  <button className="button light" type="button" onClick={(event) => { event.stopPropagation(); onOpenStaffProfile(person.id); }}>View profile</button>
                </div>
              </article>
            ))}
            {!staffActionRows.length && <EmptyList title="No staff actions" text="Everyone in scope is currently marked compliant." />}
          </div>
          <button className="button light" type="button" onClick={() => onOpenTab("SCR")}>Open SCR</button>
        </Panel>
        <Panel title="SCR Snapshot">
          <ActionList items={[
            `${renewalItems.length} renewal prompts`,
            `${outstandingRenewalRequests} evidence requests waiting`,
            `${expiredRenewals} expired evidence items`,
          ]} />
          <button className="button light" type="button" onClick={() => onOpenTab("SCR")}>Open SCR</button>
        </Panel>
        <Panel title="Submitted Evidence Review"><SubmittedEvidenceReviewQueue items={submittedEvidence} onReview={reviewSubmittedEvidence} /></Panel>
        <Panel title="Recent Enquiries"><EnquiryList data={data} /></Panel>
      </DashboardGrid>
    </>
  );
}

function buildAdminBookingDashboardMetrics(rows, data, signals = {}) {
  const now = new Date();
  const weekAhead = new Date(now);
  weekAhead.setDate(now.getDate() + 7);
  const bookedValue = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const outstandingValue = rows.reduce((sum, row) => sum + Math.max(0, Number(row.balance || 0)), 0);
  const collectedValue = Math.max(0, bookedValue - outstandingValue);
  const paidCount = rows.filter((row) => row.statusGroup === "paid").length;
  const guaranteedCount = rows.filter((row) => row.statusGroup === "guaranteed").length;
  const pendingPaymentCount = rows.filter((row) => ["pending", "attention"].includes(row.statusGroup)).length;
  const sessionBlocks = rows.reduce((sum, row) => sum + Math.max(1, row.items?.length || 0), 0);
  const capacityNotes = rows.filter((row) => row.capacityNote).length;
  const weekRows = rows.filter((row) => {
    const date = bookingRowFirstDate(row);
    return date && date >= startOfDay(now) && date <= endOfDay(weekAhead);
  });
  const weekBookedValue = weekRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const activeSites = new Set(rows.map((row) => row.site).filter(Boolean)).size;
  const paymentHealth = rows.length ? Math.round(((paidCount + guaranteedCount) / rows.length) * 100) : 100;
  const notionalCapacity = Math.max(sessionBlocks, (data.sessions?.length || 1) * 8);
  const bookingFill = notionalCapacity ? Math.min(100, Math.round((sessionBlocks / notionalCapacity) * 100)) : 0;
  const scrRisk = Number(signals.submittedEvidence || 0) + Number(signals.expiredRenewals || 0) + Number(signals.suitabilityActions || 0);
  const deliveryIssues = Number(signals.pendingCoverMoves || 0) + Number(signals.pendingDocs || 0) + capacityNotes;
  return {
    bookingCount: rows.length,
    bookedValue,
    outstandingValue,
    collectedValue,
    projectedRetained: Math.round(bookedValue * 0.62 * 100) / 100,
    paidCount,
    guaranteedCount,
    pendingPaymentCount,
    sessionBlocks,
    activeSites,
    paymentHealth,
    bookingFill,
    weekBookings: weekRows.length,
    weekBookedValue,
    websiteEnquiries: Number(signals.websiteEnquiries || 0),
    scrRisk,
    deliveryIssues,
    openActions: pendingPaymentCount + scrRisk + deliveryIssues + Number(signals.staffNeedingAction || 0),
  };
}

function bookingRowFirstDate(row) {
  const startsAt = row.items?.find((item) => item.startsAt)?.startsAt;
  if (!startsAt) return null;
  const date = new Date(startsAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bookingRowMatchesFocus(row, focus) {
  if (!focus || focus === "all") return true;
  if (focus === "outstanding") return Number(row.balance || 0) > 0 || ["pending", "attention"].includes(row.statusGroup);
  if (focus === "collected") return ["paid", "guaranteed"].includes(row.statusGroup) || Number(row.balance || 0) <= 0;
  if (focus === "week") {
    const firstDate = bookingRowFirstDate(row);
    if (!firstDate) return false;
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(now.getDate() + 7);
    return firstDate >= startOfDay(now) && firstDate <= endOfDay(weekAhead);
  }
  return true;
}

function bookingFocusLabel(focus) {
  const labels = {
    all: "All bookings",
    outstanding: "Outstanding payments",
    collected: "Collected or guaranteed",
    week: "Bookings in the next 7 days",
  };
  return labels[focus] || "Dashboard focus";
}

function bookingFinanceBucket(row) {
  const text = [
    row.status,
    row.paymentStatus,
    row.statusLabel,
    row.financeStatus,
    row.financeStatusLabel,
    row.paymentLabel,
    row.parentPortalStatus,
    row.providerPaymentId,
    ...(row.checkoutSessions || []).map((session) => `${session.status || ""} ${session.paymentMethod || ""} ${session.paymentPlan || ""}`),
  ].join(" ").toLowerCase();
  if (Number(row.refundedAmount || 0) > 0 || text.includes("refund") || text.includes("credit")) return "refunds";
  if (text.includes("failed") || text.includes("cancel") || text.includes("review") || row.statusGroup === "attention") return "failed";
  if (text.includes("voucher") || text.includes("guarantee") || text.includes("tax-free") || text.includes("tfc")) return "voucher";
  if (Number(row.balance || 0) > 0 || row.statusGroup === "pending") return "outstanding";
  return "reconciled";
}

function buildBookingFinanceSummary(rows) {
  const booked = rows.reduce((total, row) => total + Number(row.total || 0), 0);
  const outstanding = rows.reduce((total, row) => total + Math.max(0, Number(row.balance || 0)), 0);
  const refunded = rows.reduce((total, row) => total + Number(row.refundedAmount || 0), 0);
  const needsAction = rows.filter((row) => bookingFinanceBucket(row) === "failed").length;
  return {
    booked,
    outstanding,
    refunded,
    needsAction,
    collectedOrGuaranteed: Math.max(0, booked - outstanding),
  };
}

function buildBookingFinanceViewCounts(rows) {
  const counts = { outstanding: 0, voucher: 0, failed: 0, refunds: 0, reconciled: 0, all: rows.length };
  rows.forEach((row) => {
    const bucket = bookingFinanceBucket(row);
    counts[bucket] = (counts[bucket] || 0) + 1;
    if (Number(row.balance || 0) > 0 && bucket !== "outstanding") counts.outstanding += 1;
  });
  return counts;
}

function bookingFinanceFocusForRow(row) {
  if (!row) return "all";
  if (Number(row.balance || 0) > 0 || row.statusGroup === "pending") return "outstanding";
  if (row.statusGroup === "paid" || row.statusGroup === "guaranteed") return "collected";
  return "all";
}

function buildBookingFinanceRecommendation(row) {
  const bucket = bookingFinanceBucket(row);
  if (bucket === "voucher") {
    return {
      tone: "voucher",
      title: "Watch the voucher guarantee",
      detail: "Mark it reconciled when PonchoPay confirms the voucher. If the voucher does not arrive, log the fallback card charge so the parent balance and audit trail stay clear.",
    };
  }
  if (bucket === "refunds") {
    return {
      tone: "warn",
      title: "Confirm the credit route",
      detail: "Record whether this should remain as parent account credit or move to a card refund request, then keep the action against this invoice.",
    };
  }
  if (Number(row.balance || 0) > 0) {
    return {
      tone: "outstanding",
      title: "Chase the outstanding balance",
      detail: "Resend the payment link first. If the parent has paid by voucher, move this to voucher reconciliation so it does not look like a card debt.",
    };
  }
  if (bucket === "failed") {
    return {
      tone: "danger",
      title: "Review before confirming care",
      detail: "Check the provider reference, payment event trail and parent record before confirming the place or issuing a new payment route.",
    };
  }
  return {
    tone: "good",
    title: "No finance action needed",
    detail: "This invoice looks paid, reconciled or guaranteed. Keep receipts and payment events for audit only.",
  };
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function BookingAdmin({ data, access, initialFocus = "", onClearInitialFocus }) {
  const [ledger, setLedger] = useState(() => ({
    invoices: [], bookings: [], fetchedAt: "", liveRequested: bookingSystemConfigured(),
  }));
  const [status, setStatus] = useState("Loading booking ledger...");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState(initialFocus || "");
  const [selectedId, setSelectedId] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [setupDraft, setSetupDraft] = useState(() => readJson(bookingAdminSetupStorageKey, {
    school: "Willington Prep",
    dateFrom: defaultBookingAdminDateFrom,
    dateTo: defaultBookingAdminDateTo,
    sessionLabel: "Session 1",
    timeWindow: "15:30-16:00",
    price: "6.80",
    capacity: "24",
    eligibility: "Reception to Year 6",
    paymentRoute: "PonchoPay card + vouchers",
    cancellationHours: "24",
    applySimilar: true,
  }));
  const [dayOverride, setDayOverride] = useState(() => readJson(bookingAdminOverrideStorageKey, {
    school: "Willington Prep",
    sessionDate: defaultBookingAdminDateFrom,
    sessionLabel: "Session 1",
    timeWindow: "15:30-16:00",
    price: "6.80",
    capacity: "24",
    status: "open",
    parentBookable: true,
    eligibility: "Reception to Year 6",
    paymentRoute: "PonchoPay card + vouchers",
    cancellationHours: "24",
    notes: "",
  }));
  const hasLiveLedger = bookingSystemConfigured();
  const rows = normaliseBookingLedgerRows(ledger, data);
  const visibleRows = rows.filter((row) => {
    const haystack = [row.reference, row.parent, row.email, row.children, row.site, row.status, row.paymentStatus].join(" ").toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || row.statusGroup === statusFilter;
    const matchesSite = siteFilter === "all" || row.site === siteFilter;
    const matchesFocus = bookingRowMatchesFocus(row, focusFilter);
    return matchesQuery && matchesStatus && matchesSite && matchesFocus;
  });
  const selected = rows.find((row) => row.id === selectedId) || visibleRows[0] || rows[0] || null;
  const sites = Array.from(new Set(rows.map((row) => row.site).filter(Boolean))).sort();
  const pendingCount = rows.filter((row) => row.statusGroup === "pending").length;
  const paidCount = rows.filter((row) => row.statusGroup === "paid").length;
  const outstanding = rows.reduce((total, row) => total + Number(row.balance || 0), 0);
  const capacityAlerts = rows.filter((row) => row.capacityNote).length;
  const selectedFinanceFacts = selected ? buildBookingFinanceFacts(selected) : [];
  const selectedTimeline = selected ? buildBookingTimelineItems(selected) : [];

  useEffect(() => {
    let cancelled = false;
    async function loadLedger() {
      setError("");
      if (!hasLiveLedger) {
        if (!cancelled) {
          setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: false });
          setStatus("Using local booking examples until Supabase is available.");
        }
        return;
      }
      try {
        setStatus("Loading live Supabase booking ledger...");
        const nextLedger = await fetchAdminBookingLedger({ limit: 120 });
        if (cancelled) return;
        setLedger({ ...nextLedger, liveRequested: true });
        setStatus(`Live ledger loaded${nextLedger.fetchedAt ? ` at ${formatDateTime(nextLedger.fetchedAt)}` : ""}.`);
      } catch (loadError) {
        if (cancelled) return;
        setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: true });
        setError(loadError?.message || "Could not load live bookings.");
        setStatus("Live ledger unavailable. No booking data is being shown.");
      }
    }
    loadLedger();
    return () => {
      cancelled = true;
    };
  }, [hasLiveLedger]);

  useEffect(() => {
    if (!initialFocus) return;
    setFocusFilter(initialFocus);
    setQuery("");
    setStatusFilter("all");
    setSiteFilter("all");
  }, [initialFocus]);

  useEffect(() => {
    const selectedStillVisible = visibleRows.some((row) => row.id === selectedId);
    if ((!selectedId || !selectedStillVisible) && visibleRows[0]) {
      setSelectedId(visibleRows[0].id);
    }
  }, [selectedId, visibleRows]);

  function refreshLedger() {
    if (!hasLiveLedger) {
      setStatus("Local examples refreshed.");
      setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: false });
      return;
    }
    setLedger((current) => ({ ...current, fetchedAt: "" }));
    fetchAdminBookingLedger({ limit: 120 })
      .then((nextLedger) => {
        setLedger({ ...nextLedger, liveRequested: true });
        setError("");
        setStatus(`Live ledger refreshed at ${formatDateTime(new Date().toISOString())}.`);
      })
      .catch((refreshError) => {
        setError(refreshError?.message || "Could not refresh bookings.");
        setStatus("Refresh failed. Existing rows are still visible.");
      });
  }

  async function runPaymentAction(action) {
    if (!selected) return;
    setActionPending(action);
    const label = action === "resend_payment_link" ? "Payment link resent" : action === "resend_receipt" ? "Receipt resent" : "Finance review marked";
    try {
      if (hasLiveLedger && selected.invoiceId) {
        await updateLivePaymentAdminAction({
          invoiceId: selected.invoiceId,
          action,
          note: adminNote || `${label} from staff admin bookings.`,
        });
        const nextLedger = await fetchAdminBookingLedger({ limit: 120 });
        setLedger({ ...nextLedger, liveRequested: true });
      }
      addAuditLog(label, `${selected.reference} · ${selected.parent}`);
      setStatus(`${label} for ${selected.reference}.`);
      setAdminNote("");
    } catch (actionError) {
      setError(actionError?.message || "Payment action failed.");
      setStatus("Payment action could not be completed.");
    } finally {
      setActionPending("");
    }
  }

  async function saveSetupDraft() {
    const canonicalSegments = canonicalTeachingSegments(setupDraft.school, setupDraft.dateFrom, setupDraft.dateTo);
    if (!canonicalSegments.length) {
      setError("This range does not contain a published teaching window for the selected school.");
      setStatus("Booking setup was not saved. Choose dates from the canonical 2026–27 school calendar.");
      return;
    }
    setActionPending("setup");
    localStorage.setItem(bookingAdminSetupStorageKey, JSON.stringify(setupDraft));
    try {
      if (hasLiveLedger) {
        const results = [];
        for (const segment of canonicalSegments) {
          results.push(await upsertLiveBookingSessionSetup({ ...setupDraft, ...segment }));
        }
        const sessionsUpserted = results.reduce((total, result) => total + Number(result.sessionsUpserted || 0), 0);
        const result = results[results.length - 1] || {};
        addAuditLog("Booking setup saved", `${result.school || setupDraft.school} · ${result.sessionLabel || setupDraft.sessionLabel} · ${sessionsUpserted} sessions`);
        setError("");
        setStatus(`Booking setup saved live: ${sessionsUpserted} eligible ${result.sessionLabel || setupDraft.sessionLabel} sessions updated for ${result.school || setupDraft.school}. Holidays and blocked dates were excluded.`);
        refreshLedger();
      } else {
        addAuditLog("Booking setup draft saved", `${setupDraft.school} · ${setupDraft.sessionLabel} · ${formatCurrency(setupDraft.price)}`);
        setStatus("Admin setup draft saved locally. Supabase is not configured in this environment.");
      }
    } catch (setupError) {
      setError(setupError?.message || "Could not save booking setup.");
      setStatus("Setup saved locally, but the live booking tables were not updated.");
    } finally {
      setActionPending("");
    }
  }

  function updateSetupField(field, value) {
    setSetupDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveDayOverride() {
    if (dayOverride.parentBookable && !isCanonicalTeachingDate(dayOverride.school, dayOverride.sessionDate)) {
      setError("That date is not eligible for parent-bookable wraparound care.");
      setStatus("Day override was not saved. Use a canonical teaching date or turn off parent booking.");
      return;
    }
    setActionPending("override");
    localStorage.setItem(bookingAdminOverrideStorageKey, JSON.stringify(dayOverride));
    try {
      if (hasLiveLedger) {
        const result = await upsertLiveBookingSessionOverride(dayOverride);
        addAuditLog("Booking day override saved", `${result.school || dayOverride.school} · ${result.sessionDate || dayOverride.sessionDate} · ${result.sessionLabel || dayOverride.sessionLabel}`);
        setError("");
        setStatus(`Day override saved live: ${result.school || dayOverride.school} · ${formatShortDate(result.sessionDate || dayOverride.sessionDate)} · ${result.sessionLabel || dayOverride.sessionLabel}.`);
        refreshLedger();
      } else {
        addAuditLog("Booking day override draft saved", `${dayOverride.school} · ${dayOverride.sessionDate} · ${dayOverride.sessionLabel}`);
        setStatus("Day override saved locally. Supabase is not configured in this environment.");
      }
    } catch (overrideError) {
      setError(overrideError?.message || "Could not save day override.");
      setStatus("Override saved locally, but the live booking tables were not updated.");
    } finally {
      setActionPending("");
    }
  }

  function updateOverrideField(field, value) {
    setDayOverride((current) => ({ ...current, [field]: value }));
  }

  function exportLedgerCsv() {
    const header = ["Reference", "Parent", "Email", "Children", "Site", "First session", "Status", "Payment", "Total", "Balance"];
    const lines = visibleRows.map((row) => [
      row.reference,
      row.parent,
      row.email,
      row.children,
      row.site,
      row.firstDate,
      row.status,
      row.paymentStatus,
      row.total,
      row.balance,
    ].map(csvCell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `apres-bookings-${dateInputValue(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visibleRows.length} booking rows.`);
  }

  function clearDashboardFocus() {
    setFocusFilter("");
    onClearInitialFocus?.();
  }

  return (
    <div className="booking-admin">
      <section className="booking-admin-hero">
        <div>
          <p className="eyebrow">Admin bookings</p>
          <h2>Booking command centre.</h2>
          <p>Track parent bookings, payment state, children, sessions and the commercial settings only admins should control.</p>
        </div>
        <div className="booking-admin-hero-actions">
          <button className="button light" type="button" onClick={refreshLedger}>Refresh</button>
          <button className="button light" type="button" onClick={exportLedgerCsv}>Export CSV</button>
        </div>
      </section>

      <DashboardGrid className="booking-admin-metrics">
        <Metric icon={<CalendarDays />} label="Bookings" value={rows.length} tone="blue" />
        <Metric icon={<PoundSterling />} label="Outstanding" value={formatCurrency(outstanding)} tone={outstanding ? "amber" : "green"} />
        <Metric icon={<Clock />} label="Pending payment" value={pendingCount} tone={pendingCount ? "amber" : "green"} />
        <Metric icon={<ShieldCheck />} label="Confirmed" value={paidCount} tone="green" />
      </DashboardGrid>

      <div className="booking-admin-status">
        <span>{focusFilter ? `${bookingFocusLabel(focusFilter)} · ${visibleRows.length} matching booking${visibleRows.length === 1 ? "" : "s"}` : status}</span>
        {error && <strong>{error}</strong>}
        {capacityAlerts > 0 && <Badge value={`${capacityAlerts} capacity note${capacityAlerts === 1 ? "" : "s"}`} />}
        {focusFilter && <button type="button" onClick={clearDashboardFocus}>Clear dashboard focus</button>}
      </div>

      <section className="booking-admin-layout">
        <div className="booking-admin-list-panel">
          <div className="booking-admin-toolbar">
            <label>
              <span>Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Parent, child, school or reference" />
            </label>
            <label>
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="pending">Needs payment</option>
                <option value="guaranteed">Guaranteed</option>
                <option value="paid">Paid</option>
                <option value="attention">Needs admin</option>
              </select>
            </label>
            <label>
              <span>School</span>
              <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
                <option value="all">All schools</option>
                {sites.map((site) => <option key={site} value={site}>{site}</option>)}
              </select>
            </label>
          </div>
          <div className="booking-admin-list">
            {visibleRows.map((row) => (
              <button key={row.id} type="button" className={`booking-admin-row ${selected?.id === row.id ? "active" : ""}`} onClick={() => setSelectedId(row.id)}>
                <span>
                  <strong>{row.reference}</strong>
                  <small>{row.parent} · {row.children}</small>
                </span>
                <span>
                  <strong>{row.site}</strong>
                  <small>{row.firstDate || "No session date"}</small>
                </span>
                <span>
                  <Badge value={row.statusLabel} />
                  <small>{row.paymentLabel}</small>
                </span>
                <strong>{formatCurrency(row.total)}</strong>
              </button>
            ))}
            {!visibleRows.length && <EmptyList title="No matching bookings" text="Clear the filters or refresh the live ledger." />}
          </div>
        </div>

        <aside className="booking-admin-detail">
          {selected ? (
            <>
              <div className="booking-admin-detail-head">
                <span>
                  <small>Selected booking</small>
                  <strong>{selected.reference}</strong>
                </span>
                <Badge value={selected.statusLabel} />
              </div>
              <dl className="booking-admin-facts">
                <div><dt>Parent</dt><dd>{selected.parent}<small>{selected.email}</small></dd></div>
                <div><dt>Children</dt><dd>{selected.children}</dd></div>
                <div><dt>School</dt><dd>{selected.site}</dd></div>
                <div><dt>Payment</dt><dd>{selected.paymentLabel}<small>{formatCurrency(selected.balance)} outstanding</small></dd></div>
              </dl>
              <div className="booking-admin-session-list">
                {selected.items.map((item) => (
                  <article key={item.id}>
                    <strong>{item.sessionLabel || "Session"}</strong>
                    <span>{formatShortDate(item.startsAt)} · {sessionTimeRange(item)}</span>
                    <small>{item.childName || selected.children} · {formatCurrency(item.lineTotal || item.unitAmount)}</small>
                  </article>
                ))}
              </div>
              <section className="booking-finance-panel">
                <div className="booking-finance-head">
                  <span>
                    <small>Finance detail</small>
                    <strong>Invoice, PonchoPay and reconciliation</strong>
                  </span>
                  <Badge value={selected.financeStatusLabel} />
                </div>
                <div className="booking-finance-grid">
                  {selectedFinanceFacts.map((fact) => (
                    <article key={fact.label} className={`booking-finance-card ${fact.tone || ""}`}>
                      <small>{fact.label}</small>
                      <strong>{fact.value}</strong>
                      {fact.detail && <span>{fact.detail}</span>}
                    </article>
                  ))}
                </div>
                <div className="booking-finance-trail">
                  <strong>Payment and email trail</strong>
                  {selectedTimeline.length ? selectedTimeline.map((event) => (
                    <article key={event.id} className="booking-finance-event">
                      <span>{event.label}</span>
                      <small>{event.detail}</small>
                      <time>{event.when}</time>
                    </article>
                  )) : (
                    <p>No payment events, receipts or admin actions have been recorded yet.</p>
                  )}
                </div>
              </section>
              <label className="booking-admin-note">
                <span>Admin note</span>
                <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Optional note for the audit trail" />
              </label>
              <div className="booking-admin-actions">
                <button type="button" onClick={() => runPaymentAction("resend_payment_link")} disabled={actionPending || !selected.invoiceId || selected.balance <= 0}>{actionPending === "resend_payment_link" ? "Sending..." : "Resend payment link"}</button>
                <button type="button" onClick={() => runPaymentAction("resend_receipt")} disabled={actionPending || !selected.invoiceId}>{actionPending === "resend_receipt" ? "Sending..." : "Resend receipt"}</button>
                <button type="button" onClick={() => runPaymentAction("mark_finance_review")} disabled={actionPending || !selected.invoiceId}>{actionPending === "mark_finance_review" ? "Saving..." : "Mark finance review"}</button>
              </div>
            </>
          ) : (
            <EmptyList title="Choose a booking" text="Select a booking from the ledger to see sessions, payment and parent details." />
          )}
        </aside>
      </section>

      <div className="booking-admin-control-grid">
        <section className="booking-admin-setup">
          <div>
            <p className="eyebrow">Admin only</p>
            <h3>Session setup controls.</h3>
            <p>Dates, prices, capacity, eligibility and payment route stay in admin. Saving updates the matching session name across every weekday in the selected range.</p>
          </div>
          <div className="booking-admin-setup-grid">
            <label><span>School</span><input value={setupDraft.school} onChange={(event) => updateSetupField("school", event.target.value)} /></label>
            <label><span>From</span><input type="date" value={setupDraft.dateFrom} onChange={(event) => updateSetupField("dateFrom", event.target.value)} /></label>
            <label><span>To</span><input type="date" value={setupDraft.dateTo} onChange={(event) => updateSetupField("dateTo", event.target.value)} /></label>
            <label><span>Session</span><input value={setupDraft.sessionLabel} onChange={(event) => updateSetupField("sessionLabel", event.target.value)} /></label>
            <label><span>Time</span><input value={setupDraft.timeWindow} onChange={(event) => updateSetupField("timeWindow", event.target.value)} /></label>
            <label><span>Price</span><input type="number" min="0" step="0.01" value={setupDraft.price} onChange={(event) => updateSetupField("price", event.target.value)} /></label>
            <label><span>Capacity</span><input type="number" min="0" step="1" value={setupDraft.capacity} onChange={(event) => updateSetupField("capacity", event.target.value)} /></label>
            <label><span>Cancellation window</span><input type="number" min="0" step="1" value={setupDraft.cancellationHours} onChange={(event) => updateSetupField("cancellationHours", event.target.value)} /></label>
            <label className="wide"><span>Eligibility</span><input value={setupDraft.eligibility} onChange={(event) => updateSetupField("eligibility", event.target.value)} /></label>
            <label className="wide"><span>Payment route</span><input value={setupDraft.paymentRoute} onChange={(event) => updateSetupField("paymentRoute", event.target.value)} /></label>
            <label className="booking-admin-check wide"><input type="checkbox" checked={setupDraft.applySimilar !== false} onChange={(event) => updateSetupField("applySimilar", event.target.checked)} /><span>Apply price and capacity to all matching {setupDraft.sessionLabel || "sessions"} in this date range</span></label>
          </div>
          <button className="button book" type="button" onClick={saveSetupDraft} disabled={actionPending === "setup"}>
            {actionPending === "setup" ? "Saving setup..." : hasLiveLedger ? "Save live setup" : "Save setup draft"}
          </button>
        </section>

        <section className="booking-admin-setup">
          <div>
            <p className="eyebrow">Day override</p>
            <h3>Edit one day.</h3>
            <p>Use this for a single changed day: close bookings, reduce capacity, change the time or adjust the price without changing the full term setup.</p>
          </div>
          <div className="booking-admin-setup-grid compact">
            <label><span>School</span><input value={dayOverride.school} onChange={(event) => updateOverrideField("school", event.target.value)} /></label>
            <label><span>Date</span><input type="date" value={dayOverride.sessionDate} onChange={(event) => updateOverrideField("sessionDate", event.target.value)} /></label>
            <label><span>Session</span><input value={dayOverride.sessionLabel} onChange={(event) => updateOverrideField("sessionLabel", event.target.value)} /></label>
            <label><span>Status</span><select value={dayOverride.status} onChange={(event) => {
              const nextStatus = event.target.value;
              setDayOverride((current) => ({
                ...current,
                status: nextStatus,
                parentBookable: ["closed", "full", "cancelled"].includes(nextStatus) ? false : current.parentBookable,
              }));
            }}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="full">Full</option>
              <option value="cancelled">Cancelled</option>
            </select></label>
            <label><span>Time</span><input value={dayOverride.timeWindow} onChange={(event) => updateOverrideField("timeWindow", event.target.value)} /></label>
            <label><span>Price</span><input type="number" min="0" step="0.01" value={dayOverride.price} onChange={(event) => updateOverrideField("price", event.target.value)} /></label>
            <label><span>Capacity</span><input type="number" min="0" step="1" value={dayOverride.capacity} onChange={(event) => updateOverrideField("capacity", event.target.value)} /></label>
            <label><span>Cancellation window</span><input type="number" min="0" step="1" value={dayOverride.cancellationHours} onChange={(event) => updateOverrideField("cancellationHours", event.target.value)} /></label>
            <label className="booking-admin-check"><input type="checkbox" checked={dayOverride.parentBookable !== false} disabled={["closed", "full", "cancelled"].includes(dayOverride.status)} onChange={(event) => updateOverrideField("parentBookable", event.target.checked)} /><span>Parents can book this day</span></label>
            <label className="wide"><span>Eligibility</span><input value={dayOverride.eligibility} onChange={(event) => updateOverrideField("eligibility", event.target.value)} /></label>
            <label className="wide"><span>Payment route</span><input value={dayOverride.paymentRoute} onChange={(event) => updateOverrideField("paymentRoute", event.target.value)} /></label>
            <label className="wide"><span>Admin note</span><input value={dayOverride.notes} onChange={(event) => updateOverrideField("notes", event.target.value)} placeholder="Optional reason shown in audit" /></label>
          </div>
          <button className="button book" type="button" onClick={saveDayOverride} disabled={actionPending === "override"}>
            {actionPending === "override" ? "Saving override..." : hasLiveLedger ? "Save day override" : "Save override draft"}
          </button>
        </section>
      </div>
    </div>
  );
}

const financeSections = ["Dashboard", "Invoices", "Customers", "Credit Notes", "Reports", "Settings"];
const financeVatRates = ["No VAT", "Exempt", "Zero Rated", "Standard Rated"];
const financeServiceTypes = ["School trip", "Sports day staffing", "PPA cover", "Supply staff", "One-off event", "Consultancy", "Holiday camp", "Venue hire", "Ad-hoc service"];
const financeChaseStatuses = ["Not started", "Emailed", "Awaiting response", "Query raised", "Payment promised"];

function bytesToBase64(bytes) {
  if (typeof bytes === "string") return btoa(bytes);
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < array.length; index += chunkSize) {
    binary += String.fromCharCode(...array.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function downloadBase64Pdf(base64 = "", filename = "invoice.pdf") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyFinanceEmailTemplate(template = "", invoice = {}, customer = {}) {
  const replacements = {
    InvoiceNumber: invoice.invoiceNumber || invoice.draftReference || "",
    CustomerName: customer?.customerName || "",
    Contact: customer?.accountsContact || customer?.customerName || "Accounts team",
    InvoiceDate: formatShortDate(invoice.invoiceDate),
    DueDate: formatShortDate(invoice.dueDate),
    Total: formatCurrency(invoice.total || 0),
    AmountPaid: formatCurrency(invoice.amountPaid || 0),
    BalanceDue: formatCurrency(invoice.balanceDue ?? invoice.total ?? 0),
  };
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template || "",
  );
}

function createFinanceInvoiceEmailDraft(invoice = {}, customer = {}, settings = {}) {
  const subjectTemplate = "Invoice {InvoiceNumber} from Après School";
  const bodyTemplate = [
    "Dear {Contact},",
    "",
    "Please find attached invoice {InvoiceNumber} from Après School.",
    "",
    "If you have any questions regarding this invoice, please don't hesitate to contact us.",
    "",
    "Kind regards,",
    "",
    "Luke Currie",
    "",
    "Managing Director",
    "",
    "Après School",
  ].join("\n");
  return {
    emailKind: "invoice",
    invoiceId: invoice.id || "",
    invoiceNumber: invoice.invoiceNumber || invoice.draftReference || "",
    customerName: customer?.customerName || invoice.customerName || "Customer",
    to: customer?.accountsEmail || "",
    cc: "",
    bcc: "",
    subject: applyFinanceEmailTemplate(subjectTemplate, invoice, customer),
    body: applyFinanceEmailTemplate(bodyTemplate, invoice, customer),
    pdfFilename: invoice.invoiceNumber ? `apres-invoice-${invoice.invoiceNumber}.pdf` : "apres-invoice.pdf",
  };
}

function createFinanceInvoiceReminderDraft(invoice = {}, customer = {}, settings = {}) {
  const subjectTemplate = "Payment reminder: invoice {InvoiceNumber} from Après School";
  const bodyTemplate = [
    "Dear {Contact},",
    "",
    "I hope you are well.",
    "",
    "This is a polite reminder that invoice {InvoiceNumber} for {BalanceDue} remains outstanding and was due on {DueDate}.",
    "",
    "I have attached a copy of the invoice for ease of reference. Please use the invoice number as the payment reference when paying by BACS.",
    "",
    "Kind regards,",
    "",
    settings?.companyName || "Après School Finance",
  ].join("\n");
  return {
    emailKind: "payment_reminder",
    invoiceId: invoice.id || "",
    invoiceNumber: invoice.invoiceNumber || invoice.draftReference || "",
    customerName: customer?.customerName || invoice.customerName || "Customer",
    to: customer?.accountsEmail || "",
    cc: "",
    bcc: "",
    subject: applyFinanceEmailTemplate(subjectTemplate, invoice, customer),
    body: applyFinanceEmailTemplate(bodyTemplate, invoice, customer),
    pdfFilename: invoice.invoiceNumber ? `apres-invoice-${invoice.invoiceNumber}.pdf` : "apres-invoice.pdf",
  };
}

function createFinanceInvoiceResendDraft(invoice = {}, customer = {}, settings = {}) {
  const subjectTemplate = "Corrected invoice {InvoiceNumber} from Après School";
  const bodyTemplate = [
    "Dear {Contact},",
    "",
    "Please find attached a corrected copy of invoice {InvoiceNumber} from Après School.",
    "",
    "This copy replaces the previous invoice PDF. The invoice number remains the same for payment reference purposes.",
    "",
    "If you have any questions regarding this invoice, please don't hesitate to contact us.",
    "",
    "Kind regards,",
    "",
    "Luke Currie",
    "",
    "Managing Director",
    "",
    "Après School",
  ].join("\n");
  return {
    emailKind: "invoice_resend",
    invoiceId: invoice.id || "",
    invoiceNumber: invoice.invoiceNumber || invoice.draftReference || "",
    customerName: customer?.customerName || invoice.customerName || "Customer",
    to: customer?.accountsEmail || "",
    cc: "",
    bcc: "",
    subject: applyFinanceEmailTemplate(subjectTemplate, invoice, customer),
    body: applyFinanceEmailTemplate(bodyTemplate, invoice, customer),
    pdfFilename: invoice.invoiceNumber ? `apres-invoice-${invoice.invoiceNumber}-corrected.pdf` : "apres-invoice-corrected.pdf",
  };
}

function SchoolFinance({ data, access }) {
  const canViewFinance = ["Admin", "Superadmin"].includes(access?.role);
  const canManageFinance = access?.role === "Superadmin" || access?.role === "Admin";
  const [view, setView] = useState("Dashboard");
  const [finance, setFinance] = useState(() => emptySchoolFinanceData(data));
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading finance records...");
  const [query, setQuery] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [invoiceDraft, setInvoiceDraft] = useState(() => createFinanceInvoiceDraft());
  const [customerDraft, setCustomerDraft] = useState(() => createFinanceCustomerDraft());
  const [paymentDraft, setPaymentDraft] = useState({ amount: "", paidAt: dateInputValue(new Date()), reference: "", notes: "" });
  const [settingsDraft, setSettingsDraft] = useState(() => emptySchoolFinanceData(data).settings);
  const [emailPreview, setEmailPreview] = useState(null);
  const [dashboardInvoiceFilter, setDashboardInvoiceFilter] = useState("outstanding");
  const [debtorDrafts, setDebtorDrafts] = useState({});
  const [saving, setSaving] = useState("");

  useEffect(() => {
    let active = true;
    async function loadFinance() {
      if (!canViewFinance) {
        setLoading(false);
        setStatus("Finance is restricted to admin users.");
        return;
      }
      if (!hasSupabaseConfig) {
        setFinance(emptySchoolFinanceData(data));
        setSettingsDraft(emptySchoolFinanceData(data).settings);
        setLoading(false);
        setStatus("Supabase is not configured, so finance is using local demo data.");
        return;
      }
      try {
        const { fetchSchoolFinanceData } = await loadSupabaseModule();
        const next = await fetchSchoolFinanceData();
        if (!active) return;
        const merged = {
          ...emptySchoolFinanceData(data),
          ...next,
          locations: next.locations?.length ? next.locations : emptySchoolFinanceData(data).locations,
        };
        setFinance(merged);
        setSettingsDraft(merged.settings);
        setStatus(next.warnings?.length ? next.warnings.join(" ") : "Finance records loaded.");
      } catch (error) {
        if (!active) return;
        setFinance(emptySchoolFinanceData(data));
        setStatus(error?.message || "Finance records could not load yet.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadFinance();
    return () => { active = false; };
  }, [canViewFinance, data]);

  const customers = finance.customers || [];
  const invoices = finance.invoices || [];
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) || invoices[0] || null;
  const customerForInvoice = selectedInvoice ? customers.find((customer) => customer.id === selectedInvoice.customerId) : null;
  const invoiceMatches = filterFinanceInvoices(invoices, query, customers);
  const selectedInvoiceActivity = selectedInvoice ? buildFinanceInvoiceActivity(selectedInvoice, finance.audit || finance.auditEvents || []) : [];
  const kpis = calculateSchoolFinanceKpis(invoices);
  const reminderPrompts = buildFinanceReminderPrompts(invoices, customers);
  const dashboardFilterOptions = buildFinanceDashboardFilterOptions(invoices);
  const dashboardInvoiceRows = filterFinanceDashboardInvoices(invoices, dashboardInvoiceFilter);
  const activeDashboardFilter = dashboardFilterOptions.find((option) => option.id === dashboardInvoiceFilter) || dashboardFilterOptions[0];
  const debtorSummary = buildFinanceDebtorSummary(invoices, customers);
  const reports = calculateSchoolFinanceReports(invoices, customers, finance.locations || []);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || customers[0] || null;
  const selectedCustomerActivity = selectedCustomer ? buildFinanceCustomerActivity(selectedCustomer, invoices, finance.audit || finance.auditEvents || []) : [];

  useEffect(() => {
    if (!selectedInvoiceId && invoices[0]?.id) setSelectedInvoiceId(invoices[0].id);
  }, [invoices, selectedInvoiceId]);

  useEffect(() => {
    if (!selectedCustomerId && customers[0]?.id) setSelectedCustomerId(customers[0].id);
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    setDebtorDrafts((current) => {
      const next = {};
      customers.forEach((customer) => {
        next[customer.id] = current[customer.id] || {
          financeChaseStatus: customer.financeChaseStatus || "Not started",
          financeChaseNotes: customer.financeChaseNotes || "",
        };
      });
      return next;
    });
  }, [customers]);

  function setInvoiceField(field, value) {
    setInvoiceDraft((current) => ({ ...current, [field]: value }));
  }

  function setInvoiceLine(lineId, field, value) {
    setInvoiceDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, [field]: value } : line)),
    }));
  }

  function addInvoiceLine() {
    setInvoiceDraft((current) => ({ ...current, lines: [...current.lines, createFinanceLine()] }));
  }

  function removeInvoiceLine(lineId) {
    setInvoiceDraft((current) => ({ ...current, lines: current.lines.length > 1 ? current.lines.filter((line) => line.id !== lineId) : current.lines }));
  }

  function editInvoice(invoice) {
    setView("Invoices");
    setSelectedInvoiceId(invoice.id);
    setInvoiceDraft(invoiceToDraft(invoice));
  }

  async function refreshFinance(message = "Finance records refreshed.") {
    const { fetchSchoolFinanceData } = await loadSupabaseModule();
    const next = await fetchSchoolFinanceData();
    const merged = { ...emptySchoolFinanceData(data), ...next, locations: next.locations?.length ? next.locations : emptySchoolFinanceData(data).locations };
    setFinance(merged);
    setSettingsDraft(merged.settings);
    setStatus(message);
    return merged;
  }

  async function saveCustomer() {
    if (!canManageFinance) return;
    setSaving("customer");
    try {
      const { saveFinanceCustomer } = await loadSupabaseModule();
      await saveFinanceCustomer(customerDraft);
      addAuditLog("Finance customer saved", customerDraft.customerName || "Customer");
      await refreshFinance("Customer saved.");
      setCustomerDraft(createFinanceCustomerDraft());
    } catch (error) {
      setStatus(error?.message || "Customer could not be saved.");
    } finally {
      setSaving("");
    }
  }

  async function saveCustomerChase(customerId) {
    if (!canManageFinance || !customerId) return;
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;
    const draft = debtorDrafts[customerId] || {};
    setSaving(`customer-chase-${customerId}`);
    try {
      const { saveFinanceCustomer } = await loadSupabaseModule();
      const nextStatus = draft.financeChaseStatus || customer.financeChaseStatus || "Not started";
      const nextNotes = draft.financeChaseNotes ?? customer.financeChaseNotes ?? "";
      const activityChanged = nextStatus !== (customer.financeChaseStatus || "Not started") || nextNotes !== (customer.financeChaseNotes || "");
      const financeChaseActivity = activityChanged
        ? [{
          id: `chase-${Date.now()}`,
          createdAt: new Date().toISOString(),
          status: nextStatus,
          note: nextNotes,
        }, ...(customer.financeChaseActivity || [])].slice(0, 50)
        : customer.financeChaseActivity || [];
      await saveFinanceCustomer({
        ...customer,
        financeChaseStatus: nextStatus,
        financeChaseNotes: nextNotes,
        financeChaseActivity,
      });
      addAuditLog("Finance debtor chase updated", customer.customerName || "Customer");
      await refreshFinance("Customer chase status saved.");
    } catch (error) {
      setStatus(error?.message || "Customer chase status could not be saved.");
    } finally {
      setSaving("");
    }
  }

  async function saveInvoice() {
    if (!canManageFinance) return;
    setSaving("invoice");
    try {
      const { saveFinanceInvoice } = await loadSupabaseModule();
      const saved = await saveFinanceInvoice(invoiceDraft);
      addAuditLog("Finance invoice draft saved", saved?.invoiceNumber || invoiceDraft.title || "Invoice");
      await refreshFinance("Invoice saved.");
      setSelectedInvoiceId(saved?.id || selectedInvoiceId);
      setInvoiceDraft(createFinanceInvoiceDraft());
    } catch (error) {
      setStatus(error?.message || "Invoice could not be saved.");
    } finally {
      setSaving("");
    }
  }

  async function approveInvoice(invoiceId) {
    setSaving(`approve-${invoiceId}`);
    try {
      const { approveFinanceInvoice } = await loadSupabaseModule();
      const saved = await approveFinanceInvoice(invoiceId);
      addAuditLog("Finance invoice approved", saved?.invoiceNumber || invoiceId);
      await refreshFinance("Invoice approved and numbered.");
    } catch (error) {
      setStatus(error?.message || "Invoice could not be approved.");
    } finally {
      setSaving("");
    }
  }

  function openFinanceEmailPreview(invoiceId) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    const customer = customers.find((item) => item.id === invoice?.customerId);
    if (!invoice?.invoiceNumber) {
      setStatus("Approve and number this invoice before emailing it.");
      return;
    }
    if (!customer?.accountsEmail) {
      setStatus("Add an accounts email to the customer before sending.");
      return;
    }
    setEmailPreview(createFinanceInvoiceEmailDraft(invoice, customer, finance.settings || {}));
  }

  function openFinanceReminderPreview(invoiceId) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    const customer = customers.find((item) => item.id === invoice?.customerId);
    const balance = Number(invoice?.balanceDue ?? invoice?.total ?? 0);
    if (!invoice?.invoiceNumber) {
      setStatus("Approve and number this invoice before sending a reminder.");
      return;
    }
    if (balance <= 0) {
      setStatus("This invoice has no outstanding balance to chase.");
      return;
    }
    if (!customer?.accountsEmail) {
      setStatus("Add an accounts email to the customer before sending a reminder.");
      return;
    }
    setEmailPreview(createFinanceInvoiceReminderDraft(invoice, customer, finance.settings || {}));
  }

  function openFinanceResendPreview(invoiceId) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    const customer = customers.find((item) => item.id === invoice?.customerId);
    if (!invoice?.invoiceNumber) {
      setStatus("Approve and number this invoice before resending it.");
      return;
    }
    if (!customer?.accountsEmail) {
      setStatus("Add an accounts email to the customer before resending.");
      return;
    }
    if (!(invoice.emails || []).length) {
      setStatus("Use Send invoice first. Resend corrected invoice is for invoices that already have send history.");
      return;
    }
    setEmailPreview(createFinanceInvoiceResendDraft(invoice, customer, finance.settings || {}));
  }

  async function recordInvoiceEmail(draft = emailPreview) {
    const invoiceId = draft?.invoiceId;
    if (!invoiceId) return;
    setSaving(`email-${invoiceId}`);
    try {
      const { sendFinanceInvoiceEmail } = await loadSupabaseModule();
      const invoice = invoices.find((item) => item.id === invoiceId);
      const customer = customers.find((item) => item.id === invoice?.customerId);
      if (!invoice?.invoiceNumber) throw new Error("Approve and number this invoice before emailing it.");
      if (!draft?.to?.includes("@")) throw new Error("Add a valid recipient before sending.");
      const { exportFinanceInvoicePdf } = await import("./pdfExports.js");
      const pdfBytes = exportFinanceInvoicePdf(invoice, customer || {}, finance.settings || {}, { returnBytes: true });
      const result = await sendFinanceInvoiceEmail({
        invoiceId,
        emailKind: draft.emailKind || "invoice",
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        pdfBase64: bytesToBase64(pdfBytes),
        pdfFilename: draft.pdfFilename || `apres-invoice-${invoice.invoiceNumber}.pdf`,
      });
      const isReminder = draft.emailKind === "payment_reminder";
      const isResend = draft.emailKind === "invoice_resend";
      addAuditLog(isReminder ? "Finance invoice reminder sent" : isResend ? "Corrected finance invoice resent" : "Finance invoice emailed", invoice.invoiceNumber || invoiceId);
      setEmailPreview(null);
      await refreshFinance(result?.emailed
        ? isReminder
          ? "Payment reminder emailed with PDF attached."
          : isResend
            ? "Corrected invoice emailed with PDF attached."
            : "Invoice emailed with PDF attached."
        : isReminder
          ? "Payment reminder was queued, but the email provider did not send it."
          : isResend
            ? "Corrected invoice email was queued, but the email provider did not send it."
            : "Invoice email was queued, but the email provider did not send it.");
    } catch (error) {
      setStatus(error?.message || "Invoice email could not be sent.");
    } finally {
      setSaving("");
    }
  }

  async function recordPayment() {
    if (!selectedInvoice) return;
    setSaving("payment");
    try {
      const { recordFinancePayment } = await loadSupabaseModule();
      await recordFinancePayment(selectedInvoice.id, {
        amount: Number(paymentDraft.amount || 0),
        paidAt: paymentDraft.paidAt,
        reference: paymentDraft.reference,
        notes: paymentDraft.notes,
      });
      addAuditLog("BACS payment recorded", `${selectedInvoice.invoiceNumber || selectedInvoice.title}: ${formatCurrency(paymentDraft.amount)}`);
      await refreshFinance("Payment recorded.");
      setPaymentDraft({ amount: "", paidAt: dateInputValue(new Date()), reference: "", notes: "" });
    } catch (error) {
      setStatus(error?.message || "Payment could not be recorded.");
    } finally {
      setSaving("");
    }
  }

  async function downloadInvoicePdf(invoice) {
    const sentAttachment = (invoice.emails || [])
      .filter((email) => email.status === "sent" && email.attachmentBase64)
      .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")))[0];
    if (sentAttachment?.attachmentBase64) {
      downloadBase64Pdf(sentAttachment.attachmentBase64, sentAttachment.attachmentFilename || `apres-invoice-${invoice.invoiceNumber || invoice.draftReference || "invoice"}.pdf`);
      return;
    }
    const { exportFinanceInvoicePdf } = await import("./pdfExports.js");
    const customer = customers.find((item) => item.id === invoice.customerId) || {};
    exportFinanceInvoicePdf(invoice, customer, finance.settings || {});
  }

  async function saveSettings() {
    setSaving("settings");
    try {
      const { saveFinanceSettings } = await loadSupabaseModule();
      await saveFinanceSettings(settingsDraft);
      addAuditLog("Finance settings saved", "Invoice defaults and payment details updated");
      await refreshFinance("Finance settings saved.");
    } catch (error) {
      setStatus(error?.message || "Finance settings could not be saved.");
    } finally {
      setSaving("");
    }
  }

  if (!canViewFinance) {
    return (
      <section className="section-card">
        <p className="eyebrow">Finance</p>
        <h2>Restricted Area</h2>
        <p className="muted">School invoicing is only visible to admin and finance users.</p>
      </section>
    );
  }

  return (
    <div className="school-finance">
      <section className="section-card finance-hero">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>School invoicing and receivables</h2>
          <p className="muted">Create invoices for schools and organisations, track BACS payments, issue credit notes and keep a clean audit trail.</p>
        </div>
        <div className="finance-status">
          <Badge value={loading ? "Loading" : hasSupabaseConfig ? "Supabase" : "Demo"} />
          <span>{status}</span>
        </div>
      </section>

      <div className="finance-subnav" role="tablist" aria-label="Finance sections">
        {financeSections.map((section) => (
          <button key={section} type="button" className={view === section ? "active" : ""} onClick={() => setView(section)}>
            {section}
          </button>
        ))}
      </div>

      {view === "Dashboard" && (
        <>
          <DashboardGrid>
            <Metric icon={<PoundSterling />} label="Outstanding" value={formatCurrency(kpis.outstanding)} tone="warn" />
            <Metric icon={<Bell />} label="Overdue" value={formatCurrency(kpis.overdue)} tone={kpis.overdue > 0 ? "bad" : "good"} />
            <Metric icon={<CheckCircle2 />} label="Paid this month" value={formatCurrency(kpis.paidThisMonth)} tone="good" />
            <Metric icon={<FileText />} label="Invoiced this month" value={formatCurrency(kpis.invoicedThisMonth)} />
            <Metric icon={<Clock />} label="Due in 7 days" value={String(kpis.dueSoonCount)} tone="warn" />
            <Metric icon={<ClipboardCheck />} label="Draft invoices" value={String(kpis.draftCount)} />
            <Metric icon={<Clock />} label="Avg payment time" value={`${kpis.averagePaymentDays} days`} />
            <Metric icon={<Users />} label="Customers" value={String(customers.length)} />
          </DashboardGrid>
          <Panel title="Reminder prompts">
            <TableWrap>
              <table>
                <thead><tr><th>Priority</th><th>Invoice</th><th>Customer</th><th>Due</th><th>Balance</th><th>Last reminder</th><th></th></tr></thead>
                <tbody>
                  {reminderPrompts.slice(0, 8).map((prompt) => (
                    <tr key={prompt.invoice.id}>
                      <td><Badge value={prompt.priorityLabel} /></td>
                      <td><strong>{prompt.invoice.invoiceNumber || prompt.invoice.draftReference}</strong><br /><span className="muted">{prompt.invoice.serviceType || prompt.invoice.title || "School invoice"}</span></td>
                      <td>{prompt.customer?.customerName || prompt.invoice.customerName || "Customer"}<br /><span className="muted">{prompt.customer?.accountsEmail || "No accounts email"}</span></td>
                      <td>{formatShortDate(prompt.invoice.dueDate)}<br /><span className="muted">{prompt.daysLabel}</span></td>
                      <td>{formatCurrency(prompt.balance)}</td>
                      <td>{prompt.lastReminderAt ? formatShortDate(prompt.lastReminderAt) : "Not sent"}<br /><span className="muted">{prompt.reminderCount ? `${prompt.reminderCount} reminder${prompt.reminderCount === 1 ? "" : "s"}` : "Ready to chase"}</span></td>
                      <td className="table-actions">
                        <button type="button" className="button secondary" onClick={() => { setView("Invoices"); setSelectedInvoiceId(prompt.invoice.id); }}>Open</button>
                        <button type="button" className="button secondary" disabled={!canManageFinance || !prompt.canRemind || saving === `email-${prompt.invoice.id}`} onClick={() => openFinanceReminderPreview(prompt.invoice.id)}>
                          {saving === `email-${prompt.invoice.id}` ? "Sending..." : "Reminder"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!reminderPrompts.length && <EmptyList title="No reminders needed" text="There are no overdue or due-soon invoice balances to chase right now." />}
            </TableWrap>
          </Panel>
          <div className="finance-two-col">
            <Panel title="Invoice focus">
              <div className="finance-subnav" style={{ position: "static", marginBottom: 12 }} role="tablist" aria-label="Dashboard invoice filters">
                {dashboardFilterOptions.map((option) => (
                  <button key={option.id} type="button" className={dashboardInvoiceFilter === option.id ? "active" : ""} onClick={() => setDashboardInvoiceFilter(option.id)}>
                    {option.label} <span className="muted">({option.count})</span>
                  </button>
                ))}
              </div>
              <p className="muted">{activeDashboardFilter.description}</p>
              <FinanceInvoiceTable invoices={dashboardInvoiceRows.slice(0, 8)} customers={customers} onSelect={(invoiceId) => { setSelectedInvoiceId(invoiceId); setView("Invoices"); }} onEdit={editInvoice} onPdf={downloadInvoicePdf} />
            </Panel>
            <Panel title="Recent Payments">
              <TableWrap>
                <table>
                  <thead><tr><th>Invoice</th><th>Paid</th><th>Amount</th><th>Reference</th></tr></thead>
                  <tbody>
                    {flattenFinancePayments(invoices).slice(0, 8).map((payment) => (
                      <tr key={payment.id}><td>{payment.invoiceNumber}</td><td>{formatShortDate(payment.paidAt)}</td><td>{formatCurrency(payment.amount)}</td><td>{payment.reference || "BACS"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Panel>
          </div>
          <Panel title="Debtor summary">
            <div className="finance-toolbar">
              <p className="muted">Outstanding balances grouped by school or organisation, with ageing buckets for quick chasing.</p>
              <button type="button" className="button secondary" onClick={() => downloadCsv("apres-school-debtors.csv", debtorSummary.csvRows)}>Export CSV</button>
            </div>
            <TableWrap>
              <table>
                <thead><tr><th>Customer</th><th>Outstanding</th><th>Ageing</th><th>Chase status</th><th>Finance note</th><th>Invoices</th><th></th></tr></thead>
                <tbody>
                  {debtorSummary.rows.map((row) => (
                    <tr key={row.customerId || row.customerName}>
                      <td><strong>{row.customerName}</strong><br /><span className="muted">{row.accountsEmail || "No accounts email"}</span></td>
                      <td><strong>{formatCurrency(row.totalOutstanding)}</strong></td>
                      <td>
                        <span className="muted">Current {formatCurrency(row.current)}</span><br />
                        <span className="muted">1-30 {formatCurrency(row.days1to30)} · 31-60 {formatCurrency(row.days31to60)} · 60+ {formatCurrency(row.days60plus)}</span>
                      </td>
                      <td>
                        <select
                          value={debtorDrafts[row.customerId]?.financeChaseStatus || row.financeChaseStatus || "Not started"}
                          onChange={(event) => setDebtorDrafts((current) => ({
                            ...current,
                            [row.customerId]: {
                              ...(current[row.customerId] || {}),
                              financeChaseStatus: event.target.value,
                              financeChaseNotes: current[row.customerId]?.financeChaseNotes ?? row.financeChaseNotes ?? "",
                            },
                          }))}
                          disabled={!canManageFinance || !row.customerRecordId}
                        >
                          {financeChaseStatuses.map((statusOption) => <option key={statusOption}>{statusOption}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          value={debtorDrafts[row.customerId]?.financeChaseNotes ?? row.financeChaseNotes ?? ""}
                          onChange={(event) => setDebtorDrafts((current) => ({
                            ...current,
                            [row.customerId]: {
                              ...(current[row.customerId] || {}),
                              financeChaseStatus: current[row.customerId]?.financeChaseStatus || row.financeChaseStatus || "Not started",
                              financeChaseNotes: event.target.value,
                            },
                          }))}
                          placeholder="Next chase note"
                          disabled={!canManageFinance || !row.customerRecordId}
                        />
                      </td>
                      <td>{row.invoiceCount}</td>
                      <td className="table-actions">
                        <button type="button" className="button secondary" onClick={() => { setView("Invoices"); setQuery(row.customerName); }}>View invoices</button>
                        <button type="button" className="button secondary" disabled={!canManageFinance || !row.customerRecordId || saving === `customer-chase-${row.customerRecordId}`} onClick={() => saveCustomerChase(row.customerRecordId)}>
                          {saving === `customer-chase-${row.customerRecordId}` ? "Saving..." : "Save"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!debtorSummary.rows.length && <EmptyList title="No customer debt" text="There are no unpaid school or organisation invoices at the moment." />}
            </TableWrap>
          </Panel>
        </>
      )}

      {view === "Invoices" && (
        <div className="finance-two-col finance-two-col-wide">
          <section className="section-card">
            <div className="finance-toolbar">
              <div>
                <p className="eyebrow">Invoices</p>
                <h2>Invoice register</h2>
              </div>
              <div className="finance-toolbar-actions">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, customer, PO or school" />
                <button type="button" className="button secondary" onClick={() => { setInvoiceDraft(createFinanceInvoiceDraft()); setSelectedInvoiceId(""); }}>New invoice</button>
              </div>
            </div>
            <FinanceInvoiceTable invoices={invoiceMatches} customers={customers} onSelect={setSelectedInvoiceId} onEdit={editInvoice} onPdf={downloadInvoicePdf} onApprove={approveInvoice} onEmail={openFinanceEmailPreview} saving={saving} />
          </section>
          <div className="finance-invoice-side">
            <section className="section-card">
              <FinanceSelectedInvoicePanel
                invoice={selectedInvoice}
                customer={customerForInvoice}
                activity={selectedInvoiceActivity}
                paymentDraft={paymentDraft}
                setPaymentDraft={setPaymentDraft}
                canManageFinance={canManageFinance}
                saving={saving}
                onApprove={approveInvoice}
                onEmail={openFinanceEmailPreview}
                onResend={openFinanceResendPreview}
                onReminder={openFinanceReminderPreview}
                onPdf={downloadInvoicePdf}
                onRecordPayment={recordPayment}
              />
            </section>
            <section className="section-card finance-editor-card">
              <p className="eyebrow">{invoiceDraft.id ? "Edit invoice" : "New invoice"}</p>
              <h2>{invoiceDraft.id ? invoiceDraft.invoiceNumber || "Draft invoice" : "Create school invoice"}</h2>
              <div className="finance-form">
                <label><span>Customer</span><select value={invoiceDraft.customerId} onChange={(event) => setInvoiceField("customerId", event.target.value)}><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}</select></label>
                <label><span>School / site</span><select value={invoiceDraft.locationId} onChange={(event) => setInvoiceField("locationId", event.target.value)}><option value="">No linked school</option>{(finance.locations || []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label><span>Service type</span><select value={invoiceDraft.serviceType} onChange={(event) => setInvoiceField("serviceType", event.target.value)}>{financeServiceTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label><span>Invoice date</span><input type="date" value={invoiceDraft.invoiceDate} onChange={(event) => setInvoiceField("invoiceDate", event.target.value)} /></label>
                <label><span>Due date</span><input type="date" value={invoiceDraft.dueDate} onChange={(event) => setInvoiceField("dueDate", event.target.value)} /></label>
                <label><span>PO number</span><input value={invoiceDraft.purchaseOrder} onChange={(event) => setInvoiceField("purchaseOrder", event.target.value)} /></label>
                <label><span>Service start</span><input type="date" value={invoiceDraft.servicePeriodStart} onChange={(event) => setInvoiceField("servicePeriodStart", event.target.value)} /></label>
                <label><span>Service end</span><input type="date" value={invoiceDraft.servicePeriodEnd} onChange={(event) => setInvoiceField("servicePeriodEnd", event.target.value)} /></label>
                <label className="wide"><span>Title</span><input value={invoiceDraft.title} onChange={(event) => setInvoiceField("title", event.target.value)} placeholder="Sports day staffing at..." /></label>
                <label className="wide"><span>Notes on invoice</span><textarea value={invoiceDraft.notes} onChange={(event) => setInvoiceField("notes", event.target.value)} /></label>
              </div>
              <div className="finance-lines">
                <div className="finance-lines-head"><strong>Invoice lines</strong><button type="button" className="button secondary" onClick={addInvoiceLine}>Add line</button></div>
                {invoiceDraft.lines.map((line) => (
                  <div className="finance-line" key={line.id}>
                    <input className="line-description" value={line.description} onChange={(event) => setInvoiceLine(line.id, "description", event.target.value)} placeholder="Description" />
                    <input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => setInvoiceLine(line.id, "quantity", event.target.value)} aria-label="Quantity" />
                    <input value={line.unit} onChange={(event) => setInvoiceLine(line.id, "unit", event.target.value)} aria-label="Unit" />
                    <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setInvoiceLine(line.id, "unitPrice", event.target.value)} aria-label="Unit price" />
                    <select value={line.vatRate} onChange={(event) => setInvoiceLine(line.id, "vatRate", event.target.value)}>{financeVatRates.map((rate) => <option key={rate}>{rate}</option>)}</select>
                    <button type="button" className="button secondary" onClick={() => removeInvoiceLine(line.id)}>Remove</button>
                  </div>
                ))}
                <div className="finance-total-preview">
                  <span>Draft total</span>
                  <strong>{formatCurrency(calculateFinanceDraftTotal(invoiceDraft.lines))}</strong>
                </div>
              </div>
              <button type="button" className="button book" onClick={saveInvoice} disabled={!canManageFinance || saving === "invoice" || !invoiceDraft.customerId}>{saving === "invoice" ? "Saving..." : "Save invoice draft"}</button>
            </section>
          </div>
        </div>
      )}

      {view === "Customers" && (
        <div className="finance-two-col finance-two-col-wide">
          <section className="section-card">
            <p className="eyebrow">Customers</p>
            <h2>Schools and organisations</h2>
            <TableWrap>
              <table>
                <thead><tr><th>Customer</th><th>Accounts contact</th><th>Outstanding</th><th>Invoices</th><th></th></tr></thead>
                <tbody>
                  {customers.map((customer) => {
                    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
                    const outstanding = customerInvoices.reduce((sum, invoice) => sum + Number(invoice.balanceDue || 0), 0);
                    return (
                      <tr key={customer.id}>
                        <td><strong>{customer.customerName}</strong><br /><span className="muted">{customer.customerType}</span></td>
                        <td>{customer.accountsContact || "Not set"}<br /><span className="muted">{customer.accountsEmail || "No email"}</span></td>
                        <td>{formatCurrency(outstanding)}</td>
                        <td>{customerInvoices.length}</td>
                        <td><button type="button" className="button secondary" onClick={() => { setSelectedCustomerId(customer.id); setCustomerDraft(customerToDraft(customer)); }}>Open</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </section>
          <section className="section-card">
            <p className="eyebrow">{customerDraft.id ? "Edit customer" : "New customer"}</p>
            <h2>Customer details</h2>
            <div className="finance-form">
              <label><span>Name</span><input value={customerDraft.customerName} onChange={(event) => setCustomerDraft((current) => ({ ...current, customerName: event.target.value }))} /></label>
              <label><span>Type</span><select value={customerDraft.customerType} onChange={(event) => setCustomerDraft((current) => ({ ...current, customerType: event.target.value }))}><option>School</option><option>Organisation</option><option>Local Authority</option><option>Other</option></select></label>
              <label><span>Accounts contact</span><input value={customerDraft.accountsContact} onChange={(event) => setCustomerDraft((current) => ({ ...current, accountsContact: event.target.value }))} /></label>
              <label><span>Accounts email</span><input type="email" value={customerDraft.accountsEmail} onChange={(event) => setCustomerDraft((current) => ({ ...current, accountsEmail: event.target.value }))} /></label>
              <label><span>Telephone</span><input value={customerDraft.telephone || ""} onChange={(event) => setCustomerDraft((current) => ({ ...current, telephone: event.target.value }))} /></label>
              <label><span>Payment terms</span><input type="number" min="0" value={customerDraft.paymentTermsDays} onChange={(event) => setCustomerDraft((current) => ({ ...current, paymentTermsDays: event.target.value }))} /></label>
              <label><span>Chase status</span><select value={customerDraft.financeChaseStatus || "Not started"} onChange={(event) => setCustomerDraft((current) => ({ ...current, financeChaseStatus: event.target.value }))}>{financeChaseStatuses.map((statusOption) => <option key={statusOption}>{statusOption}</option>)}</select></label>
              <label className="wide"><span>Billing address</span><textarea value={customerDraft.billingAddress} onChange={(event) => setCustomerDraft((current) => ({ ...current, billingAddress: event.target.value }))} /></label>
              <label className="wide"><span>Finance chase note</span><textarea value={customerDraft.financeChaseNotes || ""} onChange={(event) => setCustomerDraft((current) => ({ ...current, financeChaseNotes: event.target.value }))} /></label>
              <label className="wide"><span>Internal notes</span><textarea value={customerDraft.internalNotes} onChange={(event) => setCustomerDraft((current) => ({ ...current, internalNotes: event.target.value }))} /></label>
            </div>
            <button type="button" className="button book" disabled={!canManageFinance || saving === "customer" || !customerDraft.customerName} onClick={saveCustomer}>{saving === "customer" ? "Saving..." : "Save customer"}</button>
            <section className="finance-command-block" style={{ marginTop: 16 }}>
              <div className="finance-command-block-head">
                <span>
                  <small>Customer timeline</small>
                  <strong>{selectedCustomer?.customerName || "Choose a customer"}</strong>
                </span>
                <Badge value={`${selectedCustomerActivity.length} events`} />
              </div>
              <div className="finance-activity-list">
                {selectedCustomerActivity.slice(0, 12).map((item) => (
                  <article key={item.id}>
                    <span>{item.label}</span>
                    <small>{item.detail}</small>
                    <time>{item.when}</time>
                  </article>
                ))}
                {!selectedCustomerActivity.length && <p className="muted">No finance activity has been recorded for this customer yet.</p>}
              </div>
            </section>
          </section>
        </div>
      )}

      {view === "Credit Notes" && (
        <section className="section-card">
          <p className="eyebrow">Credit notes</p>
          <h2>Credit note register</h2>
          <p className="muted">Credit-note storage, numbering and audit tables are ready. The next pass will add the create-and-email workflow once invoices are being used live.</p>
          <TableWrap>
            <table>
              <thead><tr><th>Credit note</th><th>Invoice</th><th>Reason</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {invoices.flatMap((invoice) => (invoice.creditNotes || []).map((note) => (
                  <tr key={note.id}><td>{note.creditNoteNumber || "Draft credit note"}</td><td>{invoice.invoiceNumber || "Draft"}</td><td>{note.reason || "Not recorded"}</td><td>{formatCurrency(note.total)}</td><td><Badge value={note.status || "Draft"} /></td></tr>
                )))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      )}

      {view === "Reports" && (
        <section className="section-card">
          <div className="finance-toolbar">
            <div>
              <p className="eyebrow">Reports</p>
              <h2>School finance reports</h2>
            </div>
            <button type="button" className="button secondary" onClick={() => downloadCsv("apres-school-finance-report.csv", reports.csvRows)}>Export CSV</button>
          </div>
          <div className="finance-report-grid">
            <FinanceReport title="Revenue by month" rows={reports.byMonth} />
            <FinanceReport title="Revenue by customer" rows={reports.byCustomer} />
            <FinanceReport title="Outstanding debtors" rows={reports.debtors} />
            <FinanceReport title="Revenue by school" rows={reports.bySchool} />
          </div>
        </section>
      )}

      {view === "Settings" && (
        <section className="section-card">
          <p className="eyebrow">Finance settings</p>
          <h2>Invoice defaults</h2>
          <div className="finance-form">
            <label><span>Company name</span><input value={settingsDraft.companyName || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, companyName: event.target.value }))} /></label>
            <label><span>Finance email</span><input value={settingsDraft.financeEmail || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, financeEmail: event.target.value }))} /></label>
            <label><span>Default terms</span><input type="number" min="0" value={settingsDraft.defaultPaymentTermsDays || 14} onChange={(event) => setSettingsDraft((current) => ({ ...current, defaultPaymentTermsDays: event.target.value }))} /></label>
            <label><span>VAT mode</span><select value={settingsDraft.vatStatus || "not_registered"} onChange={(event) => setSettingsDraft((current) => ({ ...current, vatStatus: event.target.value }))}><option value="not_registered">Not VAT registered</option><option value="registered">VAT registered</option></select></label>
            <label><span>Account name</span><input value={settingsDraft.bankAccountName || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, bankAccountName: event.target.value }))} /></label>
            <label><span>Sort code</span><input value={settingsDraft.bankSortCode || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, bankSortCode: event.target.value }))} /></label>
            <label><span>Account number</span><input value={settingsDraft.bankAccountNumber || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, bankAccountNumber: event.target.value }))} /></label>
            <label><span>Invoice prefix</span><input value={settingsDraft.invoicePrefix || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, invoicePrefix: event.target.value }))} /></label>
            <label className="wide"><span>Default email subject</span><input value={settingsDraft.defaultEmailSubject || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, defaultEmailSubject: event.target.value }))} /></label>
            <label className="wide"><span>Default invoice footer</span><textarea value={settingsDraft.defaultInvoiceFooter || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, defaultInvoiceFooter: event.target.value }))} /></label>
            <label className="wide"><span>Default email body</span><textarea value={settingsDraft.defaultEmailBody || ""} onChange={(event) => setSettingsDraft((current) => ({ ...current, defaultEmailBody: event.target.value }))} /></label>
          </div>
          <button type="button" className="button book" disabled={!canManageFinance || saving === "settings"} onClick={saveSettings}>{saving === "settings" ? "Saving..." : "Save finance settings"}</button>
        </section>
      )}
      {emailPreview && (
        <FinanceInvoiceEmailModal
          draft={emailPreview}
          setDraft={setEmailPreview}
          saving={saving === `email-${emailPreview.invoiceId}`}
          onClose={() => setEmailPreview(null)}
          onSend={() => recordInvoiceEmail(emailPreview)}
        />
      )}
    </div>
  );
}

function FinanceInvoiceEmailModal({ draft, setDraft, saving, onClose, onSend }) {
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const isReminder = draft.emailKind === "payment_reminder";
  const isResend = draft.emailKind === "invoice_resend";
  return (
    <div className="platform-modal-backdrop" role="presentation">
      <section className="hr-dismiss-modal finance-email-modal" role="dialog" aria-modal="true" aria-labelledby="finance-email-preview-title">
        <button className="modal-close" type="button" aria-label="Close invoice email preview" onClick={onClose}><X size={18} /></button>
        <p className="eyebrow">{isReminder ? "Payment reminder" : isResend ? "Corrected invoice" : "Invoice email"}</p>
        <h3 id="finance-email-preview-title">{isReminder ? "Check reminder before sending" : isResend ? "Check corrected invoice before resending" : "Check before sending"}</h3>
        <p>{draft.invoiceNumber} for {draft.customerName}. {isReminder ? "A copy of the invoice PDF will be attached for reference." : isResend ? "A fresh corrected PDF will be attached and logged as a separate resend." : "The PDF invoice will be attached automatically."}</p>
        <div className="finance-email-preview-grid">
          <label><span>To</span><input type="email" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>
          <label><span>CC</span><input value={draft.cc} onChange={(event) => update("cc", event.target.value)} placeholder="Optional, comma separated" /></label>
          <label><span>BCC</span><input value={draft.bcc} onChange={(event) => update("bcc", event.target.value)} placeholder="Optional, comma separated" /></label>
          <label><span>PDF attachment</span><input value={draft.pdfFilename} onChange={(event) => update("pdfFilename", event.target.value)} /></label>
          <label className="wide"><span>Subject</span><input value={draft.subject} onChange={(event) => update("subject", event.target.value)} /></label>
          <label className="wide"><span>Message</span><textarea value={draft.body} onChange={(event) => update("body", event.target.value)} /></label>
        </div>
        <div className="dismiss-modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="button book" disabled={saving || !draft.to || !draft.subject || !draft.body} onClick={onSend}>{saving ? "Sending..." : isReminder ? "Send reminder" : isResend ? "Resend corrected invoice" : "Send now"}</button>
        </div>
      </section>
    </div>
  );
}

function FinanceSelectedInvoicePanel({ invoice, customer, activity, paymentDraft, setPaymentDraft, canManageFinance, saving, onApprove, onEmail, onResend, onReminder, onPdf, onRecordPayment }) {
  if (!invoice) {
    return <EmptyList title="Choose an invoice" text="Select an invoice from the register to see the workflow, payment controls and audit trail." />;
  }
  const balance = Number(invoice.balanceDue ?? invoice.total ?? 0);
  const canApprove = ["Draft", "Submitted"].includes(invoice.status);
  const canSend = Boolean(invoice.invoiceNumber);
  const canResend = canSend && (invoice.emails || []).some((email) => ["invoice", "invoice_resend"].includes(email.emailKind));
  const canPay = balance > 0 && !["Draft", "Void", "Credited"].includes(invoice.status);
  const canRemind = canSend && canPay;
  const steps = buildFinanceWorkflowSteps(invoice);
  return (
    <div className="finance-command-panel">
      <header className="finance-command-head">
        <div>
          <p className="eyebrow">Selected invoice</p>
          <h2>{invoice.invoiceNumber || invoice.draftReference || "Draft invoice"}</h2>
          <p>{customer?.customerName || invoice.customerName || "Customer"}{invoice.purchaseOrder ? ` · PO ${invoice.purchaseOrder}` : ""}</p>
        </div>
        <Badge value={invoice.status || "Draft"} />
      </header>

      <div className="finance-command-money">
        <article><span>Total</span><strong>{formatCurrency(invoice.total)}</strong></article>
        <article><span>Paid</span><strong>{formatCurrency(invoice.amountPaid || 0)}</strong></article>
        <article className={balance > 0 ? "warn" : "good"}><span>Balance</span><strong>{formatCurrency(balance)}</strong></article>
      </div>

      <div className="finance-workflow-steps" aria-label="Invoice workflow">
        {steps.map((step) => (
          <article key={step.label} className={step.state}>
            <span>{step.label}</span>
            <small>{step.detail}</small>
          </article>
        ))}
      </div>

      <div className="finance-command-actions">
        <button type="button" className="button secondary" disabled={!canManageFinance || !canApprove || saving === `approve-${invoice.id}`} onClick={() => onApprove(invoice.id)}>
          {saving === `approve-${invoice.id}` ? "Approving..." : "Approve"}
        </button>
        <button type="button" className="button secondary" onClick={() => onPdf(invoice)}>View PDF</button>
        <button type="button" className="button book" disabled={!canManageFinance || !canSend || saving === `email-${invoice.id}`} onClick={() => onEmail(invoice.id)}>
          {saving === `email-${invoice.id}` ? "Sending..." : "Send invoice"}
        </button>
        <button type="button" className="button secondary" disabled={!canManageFinance || !canResend || saving === `email-${invoice.id}`} onClick={() => onResend(invoice.id)}>
          {saving === `email-${invoice.id}` ? "Sending..." : "Resend corrected invoice"}
        </button>
        <button type="button" className="button secondary" disabled={!canManageFinance || !canRemind || saving === `email-${invoice.id}`} onClick={() => onReminder(invoice.id)}>
          {saving === `email-${invoice.id}` ? "Sending..." : "Send reminder"}
        </button>
      </div>

      <section className="finance-command-block">
        <div className="finance-command-block-head">
          <span>
            <small>BACS payment</small>
            <strong>Record money received</strong>
          </span>
          <button type="button" className="button secondary" disabled={!canPay} onClick={() => setPaymentDraft((current) => ({ ...current, amount: String(balance.toFixed(2)), reference: invoice.invoiceNumber || current.reference }))}>Use balance</button>
        </div>
        <div className="finance-form compact">
          <label><span>Amount</span><input type="number" min="0" step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label><span>Date paid</span><input type="date" value={paymentDraft.paidAt} onChange={(event) => setPaymentDraft((current) => ({ ...current, paidAt: event.target.value }))} /></label>
          <label><span>Reference</span><input value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
          <label><span>Notes</span><input value={paymentDraft.notes} onChange={(event) => setPaymentDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div>
        <button type="button" className="button book" disabled={!canManageFinance || !canPay || saving === "payment" || !Number(paymentDraft.amount)} onClick={onRecordPayment}>
          {saving === "payment" ? "Recording..." : "Record BACS payment"}
        </button>
      </section>

      <FinanceInvoiceEmailHistory emails={invoice.emails || []} />

      <section className="finance-command-block">
        <div className="finance-command-block-head">
          <span>
            <small>Trail</small>
            <strong>Email, payment and audit history</strong>
          </span>
        </div>
        <div className="finance-activity-list">
          {activity.slice(0, 8).map((item) => (
            <article key={item.id}>
              <span>{item.label}</span>
              <small>{item.detail}</small>
              <time>{item.when}</time>
            </article>
          ))}
          {!activity.length && <p className="muted">No activity has been recorded for this invoice yet.</p>}
        </div>
      </section>
    </div>
  );
}

function FinanceInvoiceEmailHistory({ emails = [] }) {
  const sortedEmails = [...emails].sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")));
  const downloadAttachment = (email) => {
    if (!email.attachmentBase64) return;
    downloadBase64Pdf(email.attachmentBase64, email.attachmentFilename || "invoice.pdf");
  };
  return (
    <section className="finance-command-block">
      <div className="finance-command-block-head">
        <span>
          <small>Email activity</small>
          <strong>Invoice send trail</strong>
        </span>
        <Badge value={`${sortedEmails.length} records`} />
      </div>
      <div className="finance-email-history-list">
        {sortedEmails.map((email, index) => {
          const isReminder = email.emailKind === "payment_reminder";
          const isResend = email.emailKind === "invoice_resend";
          const kindLabel = isReminder ? "Reminder" : isResend ? "Corrected invoice" : "Invoice";
          const status = String(email.status || "").toLowerCase();
          const providerAccepted = status === "sent" && Boolean(email.providerMessageId);
          const statusText = providerAccepted
            ? "Resend accepted"
            : email.status === "failed"
              ? "Failed"
              : email.status === "queued_without_provider"
                ? "Queued, provider missing"
                : email.status || "Recorded";
          const hasAttachment = Boolean(email.attachmentBase64);
          const attachmentDetail = hasAttachment
            ? `${email.attachmentFilename || "Invoice PDF"}${email.attachmentBytes ? ` · ${formatBytes(email.attachmentBytes)}` : ""}`
            : email.attachmentFilename || "No stored attachment";
          return (
            <article key={email.id} className={`finance-email-history-card ${status || "recorded"}`}>
              <div className="finance-email-history-head">
                <span>
                  <strong>{email.subject || "No subject recorded"}</strong>
                  <small>{kindLabel} · {email.sentAt ? formatDateTime(email.sentAt) : "Time not recorded"}</small>
                </span>
                <span className={`finance-email-status ${providerAccepted ? "sent" : status || "recorded"}`}>{statusText}</span>
              </div>
              <div className="finance-email-recipient-strip">
                <span><strong>To</strong>{email.to || "Not recorded"}</span>
                <span><strong>CC</strong>{email.cc || "None"}</span>
                <span><strong>BCC</strong>{email.bcc || "None"}</span>
              </div>
              <dl>
                <div><dt>Attachment</dt><dd>{attachmentDetail}</dd></div>
                <div><dt>Provider</dt><dd>{email.provider || "Not recorded"}</dd></div>
                <div><dt>Provider ID</dt><dd>{email.providerMessageId || "Not returned"}</dd></div>
                <div><dt>Sent by</dt><dd>{email.sentBy || "Not recorded"}</dd></div>
              </dl>
              <div className="finance-email-history-actions">
                <button type="button" className="button secondary" disabled={!hasAttachment} onClick={() => downloadAttachment(email)}>
                  Download attached PDF
                </button>
                {index === 0 && hasAttachment && <span className="finance-email-latest-pdf">Latest PDF on record</span>}
                {!hasAttachment && <small>Older/manual records may not have a stored PDF attachment.</small>}
              </div>
              <details>
                <summary>View message body</summary>
                <pre>{email.body || "No message body recorded."}</pre>
              </details>
              {email.errorMessage && <p className="finance-email-error">{email.errorMessage}</p>}
            </article>
          );
        })}
        {!sortedEmails.length && <p className="muted">No invoice emails have been sent yet.</p>}
      </div>
    </section>
  );
}

function FinanceInvoiceTable({ invoices, customers, onSelect, onEdit, onPdf, onApprove, onEmail, saving }) {
  return (
    <TableWrap>
      <table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Service</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {invoices.map((invoice) => {
            const customer = customers.find((item) => item.id === invoice.customerId);
            return (
              <tr key={invoice.id || invoice.localId} onClick={() => onSelect?.(invoice.id)} className="clickable-row">
                <td><strong>{invoice.invoiceNumber || "Draft"}</strong><br /><span className="muted">{formatShortDate(invoice.invoiceDate)}</span></td>
                <td>{customer?.customerName || invoice.customerName || "Customer"}</td>
                <td>{invoice.serviceType || invoice.title || "Service"}</td>
                <td>{formatShortDate(invoice.dueDate)}</td>
                <td>{formatCurrency(invoice.total)}</td>
                <td>{formatCurrency(invoice.balanceDue ?? invoice.total)}</td>
                <td><Badge value={invoice.status || "Draft"} /></td>
                <td className="table-actions">
                  {onEdit && <button type="button" className="button secondary" onClick={(event) => { event.stopPropagation(); onEdit(invoice); }}>Edit</button>}
                  {onApprove && ["Draft", "Submitted"].includes(invoice.status) && <button type="button" className="button secondary" disabled={saving === `approve-${invoice.id}`} onClick={(event) => { event.stopPropagation(); onApprove(invoice.id); }}>Approve</button>}
                  {onPdf && <button type="button" className="button secondary" onClick={(event) => { event.stopPropagation(); onPdf(invoice); }}>PDF</button>}
                  {onEmail && invoice.invoiceNumber && <button type="button" className="button secondary" disabled={saving === `email-${invoice.id}`} onClick={(event) => { event.stopPropagation(); onEmail(invoice.id); }}>{saving === `email-${invoice.id}` ? "Sending..." : "Send invoice"}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!invoices.length && <EmptyList title="No invoices yet" text="Create the first school invoice when you are ready." />}
    </TableWrap>
  );
}

function FinanceReport({ title, rows }) {
  return (
    <div className="finance-report">
      <h3>{title}</h3>
      {rows.slice(0, 8).map((row) => (
        <div key={row.label} className="finance-report-row"><span>{row.label}</span><strong>{formatCurrency(row.value)}</strong></div>
      ))}
      {!rows.length && <p className="muted">No data yet.</p>}
    </div>
  );
}

function emptySchoolFinanceData(data = {}) {
  const locations = (data.sites || data.schools || []).map((site) => ({ id: site.id || site.name, name: site.name || site.school || "School" }));
  return {
    customers: [],
    invoices: [],
    permissions: [],
    auditEvents: [],
    locations,
    settings: {
      companyName: "Après School Limited",
      companyAddress: "",
      companyEmail: "hello@apres-school.co.uk",
      financeEmail: "hello@apres-school.co.uk",
      invoicePrefix: "AS-INV",
      creditNotePrefix: "AS-CN",
      defaultPaymentTermsDays: 14,
      vatStatus: "not_registered",
      defaultInvoiceFooter: "Thank you for working with Après School.",
      defaultEmailSubject: "Invoice {InvoiceNumber} from Après School",
      defaultEmailBody: "Please find your invoice attached. Payment can be made by BACS using the invoice number as the reference.",
      bankAccountName: "Après School Limited",
      bankSortCode: "04-00-03",
      bankAccountNumber: "21773814",
    },
  };
}

function createFinanceCustomerDraft() {
  return {
    id: "",
    customerName: "",
    customerType: "School",
    accountsContact: "",
    accountsEmail: "",
    telephone: "",
    billingAddress: "",
    paymentTermsDays: 14,
    financeChaseStatus: "Not started",
    financeChaseNotes: "",
    financeChaseActivity: [],
    internalNotes: "",
    isActive: true,
  };
}

function createFinanceInvoiceDraft() {
  const invoiceDate = dateInputValue(new Date());
  const dueDate = dateInputValue(addDays(new Date(), 14));
  return {
    id: "",
    customerId: "",
    locationId: "",
    status: "Draft",
    title: "",
    serviceType: financeServiceTypes[0],
    invoiceDate,
    dueDate,
    servicePeriodStart: "",
    servicePeriodEnd: "",
    purchaseOrder: "",
    notes: "",
    internalNotes: "",
    lines: [createFinanceLine()],
  };
}

function createFinanceLine() {
  return {
    id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    description: "",
    quantity: 1,
    unit: "Fixed Fee",
    unitPrice: "",
    vatRate: "No VAT",
  };
}

function customerToDraft(customer) {
  return { ...createFinanceCustomerDraft(), ...customer };
}

function invoiceToDraft(invoice) {
  return {
    ...createFinanceInvoiceDraft(),
    ...invoice,
    invoiceDate: dateInputValue(invoice.invoiceDate),
    dueDate: dateInputValue(invoice.dueDate),
    servicePeriodStart: dateInputValue(invoice.servicePeriodStart),
    servicePeriodEnd: dateInputValue(invoice.servicePeriodEnd),
    lines: invoice.lines?.length ? invoice.lines.map((line) => ({ ...line, id: line.id || createFinanceLine().id })) : [createFinanceLine()],
  };
}

function filterFinanceInvoices(invoices, query, customers) {
  const needle = String(query || "").toLowerCase().trim();
  if (!needle) return invoices;
  return invoices.filter((invoice) => {
    const customer = customers.find((item) => item.id === invoice.customerId);
    return [invoice.invoiceNumber, invoice.title, invoice.serviceType, invoice.purchaseOrder, invoice.status, customer?.customerName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

function buildFinanceDashboardFilterOptions(invoices = []) {
  const filters = [
    ["outstanding", "Outstanding", "Invoices with a remaining balance, excluding paid, void or credited invoices."],
    ["overdue", "Overdue", "Outstanding invoices past their due date."],
    ["dueSoon", "Due soon", "Outstanding invoices due within the next seven days."],
    ["recentlyPaid", "Recently paid", "Invoices with a payment recorded in the last 30 days."],
  ];
  return filters.map(([id, label, description]) => ({
    id,
    label,
    description,
    count: filterFinanceDashboardInvoices(invoices, id).length,
  }));
}

function filterFinanceDashboardInvoices(invoices = [], filter = "outstanding") {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const hasBalance = (invoice) => Number(invoice.balanceDue ?? invoice.total ?? 0) > 0;
  const isOpen = (invoice) => !["Paid", "Void", "Credited"].includes(invoice.status) && hasBalance(invoice);
  const latestPaymentTime = (invoice) => Math.max(
    0,
    ...(invoice.payments || []).map((payment) => new Date(`${payment.paidAt || payment.recordedAt || ""}T00:00:00`).getTime()).filter((time) => Number.isFinite(time)),
  );

  const rows = invoices.filter((invoice) => {
    if (filter === "overdue") return isOpen(invoice) && isPastDue(invoice.dueDate);
    if (filter === "dueSoon") {
      const days = invoice.dueDate ? daysBetween(today, invoice.dueDate) : 9999;
      return isOpen(invoice) && days >= 0 && days <= 7;
    }
    if (filter === "recentlyPaid") return latestPaymentTime(invoice) >= thirtyDaysAgo.getTime();
    return isOpen(invoice);
  });

  return rows.sort((a, b) => {
    if (filter === "recentlyPaid") return latestPaymentTime(b) - latestPaymentTime(a);
    return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
  });
}

function buildFinanceDebtorSummary(invoices = [], customers = []) {
  const today = new Date();
  const rowsByCustomer = new Map();

  invoices.forEach((invoice) => {
    const balance = Number(invoice.balanceDue ?? invoice.total ?? 0);
    if (balance <= 0 || ["Paid", "Void", "Credited"].includes(invoice.status)) return;

    const customer = customers.find((item) => item.id === invoice.customerId);
    const customerId = invoice.customerId || invoice.customerName || "unknown";
    const row = rowsByCustomer.get(customerId) || {
      customerId,
      customerRecordId: customer?.id || "",
      customerName: customer?.customerName || invoice.customerName || "Unknown customer",
      accountsEmail: customer?.accountsEmail || invoice.accountsEmail || "",
      financeChaseStatus: customer?.financeChaseStatus || "Not started",
      financeChaseNotes: customer?.financeChaseNotes || "",
      totalOutstanding: 0,
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days60plus: 0,
      invoiceCount: 0,
    };

    const overdueDays = invoice.dueDate && isPastDue(invoice.dueDate) ? daysBetween(invoice.dueDate, today) : 0;
    row.totalOutstanding += balance;
    row.invoiceCount += 1;
    if (!overdueDays) row.current += balance;
    else if (overdueDays <= 30) row.days1to30 += balance;
    else if (overdueDays <= 60) row.days31to60 += balance;
    else row.days60plus += balance;
    rowsByCustomer.set(customerId, row);
  });

  const rows = Array.from(rowsByCustomer.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  const csvRows = [
    ["Customer", "Accounts email", "Outstanding", "Current", "1-30 days", "31-60 days", "60+ days", "Invoice count", "Chase status", "Finance note"],
    ...rows.map((row) => [
      row.customerName,
      row.accountsEmail,
      row.totalOutstanding.toFixed(2),
      row.current.toFixed(2),
      row.days1to30.toFixed(2),
      row.days31to60.toFixed(2),
      row.days60plus.toFixed(2),
      row.invoiceCount,
      row.financeChaseStatus,
      row.financeChaseNotes,
    ]),
  ];

  return { rows, csvRows };
}

function calculateSchoolFinanceKpis(invoices) {
  const today = new Date();
  const monthKey = today.toISOString().slice(0, 7);
  const outstandingInvoices = invoices.filter((invoice) => !["Paid", "Void", "Credited"].includes(invoice.status));
  const paidInvoices = invoices.filter((invoice) => invoice.status === "Paid");
  const paymentDays = paidInvoices.map((invoice) => daysBetween(invoice.invoiceDate, invoice.paidAt || invoice.updatedAt)).filter((days) => Number.isFinite(days) && days >= 0);
  return {
    outstanding: outstandingInvoices.reduce((sum, invoice) => sum + Number(invoice.balanceDue ?? invoice.total ?? 0), 0),
    overdue: outstandingInvoices.filter((invoice) => isPastDue(invoice.dueDate)).reduce((sum, invoice) => sum + Number(invoice.balanceDue ?? invoice.total ?? 0), 0),
    paidThisMonth: flattenFinancePayments(invoices).filter((payment) => String(payment.paidAt || "").startsWith(monthKey)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    invoicedThisMonth: invoices.filter((invoice) => String(invoice.invoiceDate || "").startsWith(monthKey)).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
    draftCount: invoices.filter((invoice) => invoice.status === "Draft").length,
    dueSoonCount: outstandingInvoices.filter((invoice) => daysBetween(today, invoice.dueDate) >= 0 && daysBetween(today, invoice.dueDate) <= 7).length,
    averagePaymentDays: paymentDays.length ? Math.round(paymentDays.reduce((sum, days) => sum + days, 0) / paymentDays.length) : 0,
  };
}

function calculateSchoolFinanceReports(invoices, customers, locations) {
  const byMonthMap = new Map();
  const byCustomerMap = new Map();
  const bySchoolMap = new Map();
  const debtors = [];
  invoices.forEach((invoice) => {
    const month = String(invoice.invoiceDate || "Un dated").slice(0, 7);
    const total = Number(invoice.total || 0);
    byMonthMap.set(month, (byMonthMap.get(month) || 0) + total);
    const customer = customers.find((item) => item.id === invoice.customerId);
    const customerName = customer?.customerName || "Unknown customer";
    byCustomerMap.set(customerName, (byCustomerMap.get(customerName) || 0) + total);
    const location = locations.find((item) => item.id === invoice.locationId);
    const schoolName = location?.name || invoice.locationName || "No linked school";
    bySchoolMap.set(schoolName, (bySchoolMap.get(schoolName) || 0) + total);
    if (Number(invoice.balanceDue || 0) > 0) debtors.push({ label: `${customerName} · ${invoice.invoiceNumber || "Draft"}`, value: Number(invoice.balanceDue || 0) });
  });
  const byMonth = mapToReportRows(byMonthMap).sort((a, b) => b.label.localeCompare(a.label));
  const byCustomer = mapToReportRows(byCustomerMap);
  const bySchool = mapToReportRows(bySchoolMap);
  const csvRows = invoices.map((invoice) => {
    const customer = customers.find((item) => item.id === invoice.customerId);
    return {
      invoice: invoice.invoiceNumber || "Draft",
      customer: customer?.customerName || "",
      service_type: invoice.serviceType || "",
      invoice_date: invoice.invoiceDate || "",
      due_date: invoice.dueDate || "",
      status: invoice.status || "",
      total: invoice.total || 0,
      balance_due: invoice.balanceDue || 0,
    };
  });
  return { byMonth, byCustomer, bySchool, debtors: debtors.sort((a, b) => b.value - a.value), csvRows };
}

function mapToReportRows(map) {
  return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function flattenFinancePayments(invoices) {
  return invoices.flatMap((invoice) => (invoice.payments || []).map((payment) => ({ ...payment, invoiceNumber: invoice.invoiceNumber || "Draft invoice" }))).sort((a, b) => String(b.paidAt || "").localeCompare(String(a.paidAt || "")));
}

function buildFinanceWorkflowSteps(invoice = {}) {
  const approved = Boolean(invoice.invoiceNumber || invoice.approvedAt || !["Draft", "Submitted"].includes(invoice.status));
  const sent = Boolean(invoice.sentAt || (invoice.emails || []).some((email) => ["sent", "recorded"].includes(String(email.status || "").toLowerCase())) || ["Sent", "Viewed", "Part Paid", "Paid", "Overdue"].includes(invoice.status));
  const paid = Number(invoice.balanceDue ?? invoice.total ?? 0) <= 0 && Number(invoice.total || 0) > 0;
  return [
    { label: "Draft", detail: invoice.draftReference || "Saved invoice details", state: "done" },
    { label: "Approved", detail: approved ? invoice.invoiceNumber || "Number assigned" : "Needs approval", state: approved ? "done" : "pending" },
    { label: "Sent", detail: sent ? formatShortDate(invoice.sentAt || invoice.emails?.[0]?.sentAt) : "Email not sent", state: sent ? "done" : approved ? "active" : "pending" },
    { label: "Paid", detail: paid ? "Balance cleared" : `${formatCurrency(invoice.balanceDue ?? invoice.total ?? 0)} due`, state: paid ? "done" : sent ? "active" : "pending" },
  ];
}

function buildFinanceInvoiceActivity(invoice = {}, auditEvents = []) {
  const events = [
    ...(invoice.emails || []).map((email) => ({
      id: `email-${email.id}`,
      whenRaw: email.sentAt || invoice.sentAt || invoice.updatedAt || "",
      label: email.emailKind === "payment_reminder"
        ? email.status === "sent" ? "Payment reminder sent" : "Payment reminder recorded"
        : email.emailKind === "invoice_resend"
          ? email.status === "sent" ? "Corrected invoice resent" : "Corrected invoice resend recorded"
        : email.status === "sent" ? "Invoice email sent" : "Invoice email recorded",
      detail: [email.to, email.subject].filter(Boolean).join(" · "),
    })),
    ...(invoice.payments || []).map((payment) => ({
      id: `payment-${payment.id}`,
      whenRaw: payment.recordedAt || payment.paidAt || "",
      label: "BACS payment recorded",
      detail: `${formatCurrency(payment.amount)}${payment.reference ? ` · ${payment.reference}` : ""}`,
    })),
    ...(auditEvents || []).filter((event) => event.invoiceId === invoice.id).map((event) => ({
      id: `audit-${event.id}`,
      whenRaw: event.createdAt || "",
      label: event.action || "Audit event",
      detail: [event.detail, event.actor].filter(Boolean).join(" · "),
    })),
  ];
  return events
    .filter((event) => event.label)
    .sort((a, b) => String(b.whenRaw || "").localeCompare(String(a.whenRaw || "")))
    .map((event) => ({
      ...event,
      when: event.whenRaw ? formatDateTime(event.whenRaw) : "Time not recorded",
    }));
}

function buildFinanceCustomerActivity(customer = {}, invoices = [], auditEvents = []) {
  const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
  const events = [
    ...(customer.financeChaseActivity || []).map((event, index) => ({
      id: event.id || `customer-chase-${index}`,
      whenRaw: event.createdAt || customer.updatedAt || "",
      label: event.status ? `Chase status: ${event.status}` : "Finance chase updated",
      detail: event.note || "No note recorded",
    })),
    ...customerInvoices.map((invoice) => ({
      id: `customer-invoice-${invoice.id}`,
      whenRaw: invoice.approvedAt || invoice.createdAt || invoice.invoiceDate || "",
      label: invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : "Draft invoice created",
      detail: `${invoice.status || "Draft"} · ${formatCurrency(invoice.total || 0)}${Number(invoice.balanceDue || 0) > 0 ? ` · ${formatCurrency(invoice.balanceDue)} outstanding` : ""}`,
    })),
    ...customerInvoices.flatMap((invoice) => (invoice.emails || []).map((email) => ({
      id: `customer-email-${email.id}`,
      whenRaw: email.sentAt || invoice.sentAt || "",
      label: email.emailKind === "payment_reminder" ? "Payment reminder sent" : email.emailKind === "invoice_resend" ? "Corrected invoice resent" : "Invoice email sent",
      detail: `${invoice.invoiceNumber || invoice.draftReference || "Invoice"} · ${email.to || "recipient not recorded"}`,
    }))),
    ...customerInvoices.flatMap((invoice) => (invoice.payments || []).map((payment) => ({
      id: `customer-payment-${payment.id}`,
      whenRaw: payment.recordedAt || payment.paidAt || "",
      label: "Payment received",
      detail: `${invoice.invoiceNumber || invoice.draftReference || "Invoice"} · ${formatCurrency(payment.amount)}${payment.reference ? ` · ${payment.reference}` : ""}`,
    }))),
    ...(auditEvents || []).filter((event) => event.customerId === customer.id).map((event) => ({
      id: `customer-audit-${event.id}`,
      whenRaw: event.createdAt || "",
      label: event.action || "Finance audit event",
      detail: [event.detail, event.actor].filter(Boolean).join(" · "),
    })),
  ];
  return events
    .filter((event) => event.label)
    .sort((a, b) => String(b.whenRaw || "").localeCompare(String(a.whenRaw || "")))
    .map((event) => ({
      ...event,
      when: event.whenRaw ? formatDateTime(event.whenRaw) : "Time not recorded",
    }));
}

function buildFinanceReminderPrompts(invoices = [], customers = []) {
  const today = new Date();
  return invoices
    .map((invoice) => {
      const balance = Number(invoice.balanceDue ?? invoice.total ?? 0);
      const status = String(invoice.status || "");
      const customer = customers.find((item) => item.id === invoice.customerId);
      const dueInDays = invoice.dueDate ? daysBetween(today, invoice.dueDate) : 9999;
      const daysOverdue = invoice.dueDate ? daysBetween(invoice.dueDate, today) : 0;
      const reminderEmails = (invoice.emails || []).filter((email) => email.emailKind === "payment_reminder");
      const lastReminderAt = reminderEmails
        .map((email) => email.sentAt)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || "";
      const priority = daysOverdue > 0 ? "overdue" : dueInDays >= 0 && dueInDays <= 7 ? "due_soon" : "";
      const priorityLabel = priority === "overdue" ? "Overdue" : priority === "due_soon" ? "Due soon" : "Monitor";
      const daysLabel = priority === "overdue"
        ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
        : dueInDays === 0
          ? "Due today"
          : `Due in ${dueInDays} day${dueInDays === 1 ? "" : "s"}`;
      return {
        invoice,
        customer,
        balance,
        dueInDays,
        daysOverdue,
        priority,
        priorityLabel,
        daysLabel,
        lastReminderAt,
        reminderCount: reminderEmails.length,
        canRemind: Boolean(invoice.invoiceNumber && customer?.accountsEmail && balance > 0),
        hidden: ["Paid", "Void", "Credited"].includes(status) || balance <= 0 || !priority,
      };
    })
    .filter((prompt) => !prompt.hidden)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "overdue" ? -1 : 1;
      if (a.priority === "overdue") return b.daysOverdue - a.daysOverdue;
      return a.dueInDays - b.dueInDays;
    });
}

function calculateFinanceDraftTotal(lines = []) {
  return lines.reduce((sum, line) => {
    const net = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    const vat = line.vatRate === "Standard Rated" ? net * 0.2 : 0;
    return sum + net + vat;
  }, 0);
}

function isPastDue(date) {
  if (!date) return false;
  const due = new Date(`${date}T23:59:59`);
  return !Number.isNaN(due.getTime()) && due < new Date();
}

function daysBetween(start, end) {
  const startDate = start instanceof Date ? start : new Date(`${start}T00:00:00`);
  const endDate = end instanceof Date ? end : new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.round((endDate - startDate) / 86400000);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function BookingFinance({ data, onOpenBookingFocus }) {
  const [ledger, setLedger] = useState(() => ({
    invoices: [], bookings: [], fetchedAt: "", liveRequested: bookingSystemConfigured(),
  }));
  const [status, setStatus] = useState("Loading booking finance...");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("outstanding");
  const [selectedId, setSelectedId] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [financeActionDraft, setFinanceActionDraft] = useState({
    amount: "",
    reason: "",
    creditType: "session_credit",
  });
  const hasLiveLedger = bookingSystemConfigured();
  const rows = normaliseBookingLedgerRows(ledger, data);
  const financeRows = rows.map((row) => ({ ...row, financeBucket: bookingFinanceBucket(row) }));
  const visibleRows = financeRows.filter((row) => {
    const haystack = [
      row.reference,
      row.parent,
      row.email,
      row.children,
      row.site,
      row.statusLabel,
      row.financeStatusLabel,
      row.paymentLabel,
      row.providerPaymentId,
    ].join(" ").toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesView = view === "all" || row.financeBucket === view || (view === "outstanding" && Number(row.balance || 0) > 0);
    return matchesQuery && matchesView;
  });
  const selected = financeRows.find((row) => row.id === selectedId) || visibleRows[0] || financeRows[0] || null;
  const selectedFinanceFacts = selected ? buildBookingFinanceFacts(selected) : [];
  const selectedTimeline = selected ? buildBookingTimelineItems(selected) : [];
  const selectedRecommendation = selected ? buildBookingFinanceRecommendation(selected) : null;
  const totals = buildBookingFinanceSummary(financeRows);
  const viewCounts = buildBookingFinanceViewCounts(financeRows);

  useEffect(() => {
    let cancelled = false;
    async function loadFinance() {
      setError("");
      if (!hasLiveLedger) {
        if (!cancelled) {
          setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: false });
          setStatus("Using local examples until Supabase is available.");
        }
        return;
      }
      try {
        setStatus("Loading live PonchoPay and booking ledger...");
        const nextLedger = await fetchAdminBookingLedger({ limit: 250 });
        if (cancelled) return;
        setLedger({ ...nextLedger, liveRequested: true });
        setStatus(`Live finance ledger loaded${nextLedger.fetchedAt ? ` at ${formatDateTime(nextLedger.fetchedAt)}` : ""}.`);
      } catch (loadError) {
        if (cancelled) return;
        setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: true });
        setError(loadError?.message || "Could not load finance ledger.");
        setStatus("Live ledger unavailable. No finance data is being shown.");
      }
    }
    loadFinance();
    return () => {
      cancelled = true;
    };
  }, [hasLiveLedger]);

  useEffect(() => {
    const selectedStillVisible = visibleRows.some((row) => row.id === selectedId);
    if ((!selectedId || !selectedStillVisible) && visibleRows[0]) {
      setSelectedId(visibleRows[0].id);
    }
  }, [selectedId, visibleRows]);

  useEffect(() => {
    if (!selected) return;
    const suggestedAmount = Number(selected.balance || 0) > 0
      ? selected.balance
      : Number(selected.refundedAmount || 0) > 0
        ? selected.refundedAmount
        : selected.total || "";
    setFinanceActionDraft({
      amount: suggestedAmount ? String(suggestedAmount) : "",
      reason: "",
      creditType: selected.financeBucket === "voucher" ? "voucher_reconciliation" : "session_credit",
    });
    setAdminNote("");
  }, [selected?.id]);

  function refreshLedger() {
    if (!hasLiveLedger) {
      setLedger({ invoices: [], bookings: [], fetchedAt: new Date().toISOString(), liveRequested: false });
      setStatus("Local finance examples refreshed.");
      return;
    }
    setStatus("Refreshing finance ledger...");
    fetchAdminBookingLedger({ limit: 250 })
      .then((nextLedger) => {
        setLedger({ ...nextLedger, liveRequested: true });
        setError("");
        setStatus(`Finance ledger refreshed at ${formatDateTime(new Date().toISOString())}.`);
      })
      .catch((refreshError) => {
        setError(refreshError?.message || "Could not refresh finance ledger.");
        setStatus("Refresh failed. Existing rows are still visible.");
      });
  }

  function updateFinanceActionDraft(key, value) {
    setFinanceActionDraft((current) => ({ ...current, [key]: value }));
  }

  async function runFinanceAction(action) {
    if (!selected) return;
    const actionAmount = Number(financeActionDraft.amount || 0);
    const needsAmount = ["record_credit_note", "request_refund", "mark_fallback_card_charge"].includes(action);
    if (needsAmount && (!Number.isFinite(actionAmount) || actionAmount <= 0)) {
      setError("Enter an amount before recording that finance action.");
      setStatus("Finance action needs an amount.");
      return;
    }
    setActionPending(action);
    const label = {
      resend_payment_link: "Payment link resent",
      resend_receipt: "Receipt resent",
      mark_finance_review: "Finance review marked",
      record_credit_note: "Credit note recorded",
      request_refund: "Refund request logged",
      mark_voucher_reconciled: "Voucher marked reconciled",
      mark_fallback_card_charge: "Fallback card charge logged",
    }[action] || "Finance action recorded";
    try {
      if (hasLiveLedger && selected.invoiceId) {
        await updateLivePaymentAdminAction({
          invoiceId: selected.invoiceId,
          action,
          note: adminNote || `${label} from finance control room.`,
          amount: actionAmount || null,
          reason: financeActionDraft.reason,
          metadata: {
            creditType: financeActionDraft.creditType,
            bookingReference: selected.reference,
            parentEmail: selected.email,
            source: "booking_finance_control_room",
          },
        });
        const nextLedger = await fetchAdminBookingLedger({ limit: 250 });
        setLedger({ ...nextLedger, liveRequested: true });
      }
      addAuditLog(label, `${selected.reference} · ${selected.parent}`);
      setStatus(`${label} for ${selected.reference}.`);
      setAdminNote("");
      setFinanceActionDraft((current) => ({ ...current, reason: "" }));
    } catch (actionError) {
      setError(actionError?.message || "Finance action failed.");
      setStatus("Finance action could not be completed.");
    } finally {
      setActionPending("");
    }
  }

  function exportFinanceCsv() {
    const header = ["Reference", "Parent", "Email", "Children", "Site", "Finance status", "Payment route", "Total", "Paid", "Outstanding", "Refunded", "Provider payment"];
    const lines = visibleRows.map((row) => [
      row.reference,
      row.parent,
      row.email,
      row.children,
      row.site,
      row.financeStatusLabel,
      row.paymentLabel,
      row.total,
      row.paidAmount,
      row.balance,
      row.refundedAmount,
      row.providerPaymentId,
    ].map(csvCell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `apres-booking-finance-${dateInputValue(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visibleRows.length} finance rows.`);
  }

  return (
    <div className="booking-finance-console">
      <section className="booking-finance-hero">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Booking finance control room.</h2>
          <p>Track parent balances, PonchoPay status, voucher guarantees, refunds and the payment actions that need admin attention.</p>
        </div>
        <div className="booking-finance-hero-actions">
          <button className="button light" type="button" onClick={refreshLedger}>Refresh</button>
          <button className="button light" type="button" onClick={exportFinanceCsv}>Export CSV</button>
          <button className="button book" type="button" onClick={() => onOpenBookingFocus?.("all")}>Open bookings</button>
        </div>
      </section>

      <section className="booking-finance-kpis" aria-label="Booking finance summary">
        <article>
          <span>Booked value</span>
          <strong>{formatCurrency(totals.booked)}</strong>
          <small>{financeRows.length} order{financeRows.length === 1 ? "" : "s"} in the ledger</small>
        </article>
        <article className={totals.outstanding ? "warn" : "good"}>
          <span>Outstanding</span>
          <strong>{formatCurrency(totals.outstanding)}</strong>
          <small>{viewCounts.outstanding} parent balance{viewCounts.outstanding === 1 ? "" : "s"} to chase</small>
        </article>
        <article className="good">
          <span>Collected/guaranteed</span>
          <strong>{formatCurrency(totals.collectedOrGuaranteed)}</strong>
          <small>{viewCounts.voucher} voucher guarantee{viewCounts.voucher === 1 ? "" : "s"}</small>
        </article>
        <article className={totals.needsAction ? "danger" : "good"}>
          <span>Needs action</span>
          <strong>{totals.needsAction}</strong>
          <small>Failed, cancelled or manual finance review</small>
        </article>
        <article className={totals.refunded ? "warn" : ""}>
          <span>Refunds/credits</span>
          <strong>{formatCurrency(totals.refunded)}</strong>
          <small>{viewCounts.refunds} refund or credit row{viewCounts.refunds === 1 ? "" : "s"}</small>
        </article>
      </section>

      <div className="booking-finance-status">
        <span>{status}</span>
        {error && <strong>{error}</strong>}
      </div>

      <section className="booking-finance-workspace">
        <div className="booking-finance-list-panel">
          <div className="booking-finance-toolbar">
            <label>
              <span>Search finance</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Parent, child, reference or provider ID" />
            </label>
          </div>
          <div className="booking-finance-tabs" role="tablist" aria-label="Finance filters">
            {[
              ["outstanding", "Outstanding"],
              ["voucher", "Vouchers"],
              ["failed", "Failed"],
              ["refunds", "Refunds"],
              ["reconciled", "Reconciled"],
              ["all", "All"],
            ].map(([key, label]) => (
              <button key={key} type="button" className={view === key ? "active" : ""} onClick={() => setView(key)}>
                <span>{label}</span>
                <small>{viewCounts[key] || 0}</small>
              </button>
            ))}
          </div>
          <div className="booking-finance-list">
            {visibleRows.map((row) => (
              <button key={row.id} type="button" className={`booking-finance-row ${selected?.id === row.id ? "active" : ""}`} onClick={() => setSelectedId(row.id)}>
                <span>
                  <strong>{row.reference}</strong>
                  <small>{row.parent} · {row.children}</small>
                </span>
                <span>
                  <strong>{row.site}</strong>
                  <small>{row.firstDate || "No session date"}</small>
                </span>
                <span>
                  <Badge value={row.financeStatusLabel || row.statusLabel} />
                  <small>{row.paymentLabel}</small>
                </span>
                <span className="booking-finance-money">
                  <strong>{formatCurrency(row.balance || 0)}</strong>
                  <small>Outstanding</small>
                </span>
              </button>
            ))}
            {!visibleRows.length && <EmptyList title="No finance rows" text="Try another finance filter or refresh the live ledger." />}
          </div>
        </div>

        <aside className="booking-finance-detail-panel">
          {selected ? (
            <>
              <div className="booking-finance-detail-head">
                <span>
                  <small>Selected order</small>
                  <strong>{selected.reference}</strong>
                  <em>{selected.parent} · {selected.email || "No email recorded"}</em>
                </span>
                <Badge value={selected.financeStatusLabel || selected.statusLabel} />
              </div>
              <div className="booking-finance-grid">
                {selectedFinanceFacts.map((fact) => (
                  <article key={fact.label} className={`booking-finance-card ${fact.tone || ""}`}>
                    <small>{fact.label}</small>
                    <strong>{fact.value}</strong>
                    {fact.detail && <span>{fact.detail}</span>}
                  </article>
                ))}
              </div>
              <section className="booking-finance-order">
                <h3>Order</h3>
                <dl>
                  <div><dt>Total</dt><dd>{formatCurrency(selected.total || 0)}</dd></div>
                  <div><dt>Paid</dt><dd>{formatCurrency(selected.paidAmount || 0)}</dd></div>
                  <div><dt>Outstanding</dt><dd>{formatCurrency(selected.balance || 0)}</dd></div>
                  <div><dt>Refunded</dt><dd>{formatCurrency(selected.refundedAmount || 0)}</dd></div>
                </dl>
              </section>
              <div className="booking-finance-trail">
                <strong>Payment and reconciliation trail</strong>
                {selectedTimeline.length ? selectedTimeline.map((event) => (
                  <article key={event.id} className="booking-finance-event">
                    <span>{event.label}</span>
                    <small>{event.detail}</small>
                    <time>{event.when}</time>
                  </article>
                )) : (
                  <p>No payment events, receipts or admin actions have been recorded yet.</p>
                )}
              </div>
              {selectedRecommendation && (
                <section className={`booking-finance-recommendation ${selectedRecommendation.tone || ""}`}>
                  <small>Recommended next step</small>
                  <strong>{selectedRecommendation.title}</strong>
                  <p>{selectedRecommendation.detail}</p>
                </section>
              )}
              <section className="booking-finance-action-panel">
                <div>
                  <h3>Reconciliation actions</h3>
                  <p>Use these for finance events that need an audit trail before or after PonchoPay settles the money.</p>
                </div>
                <div className="booking-finance-action-grid">
                  <label>
                    <span>Amount</span>
                    <input
                      value={financeActionDraft.amount}
                      onChange={(event) => updateFinanceActionDraft("amount", event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    <span>Type</span>
                    <select value={financeActionDraft.creditType} onChange={(event) => updateFinanceActionDraft("creditType", event.target.value)}>
                      <option value="session_credit">Session credit</option>
                      <option value="refund_to_card">Refund to card</option>
                      <option value="voucher_reconciliation">Voucher reconciliation</option>
                      <option value="fallback_card">Fallback card</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>Reason</span>
                    <input
                      value={financeActionDraft.reason}
                      onChange={(event) => updateFinanceActionDraft("reason", event.target.value)}
                      placeholder="Short reason shown in the audit trail"
                    />
                  </label>
                </div>
                <div className="booking-finance-action-buttons">
                  <button type="button" onClick={() => runFinanceAction("record_credit_note")} disabled={actionPending || !selected.invoiceId}>{actionPending === "record_credit_note" ? "Saving..." : "Record credit note"}</button>
                  <button type="button" onClick={() => runFinanceAction("request_refund")} disabled={actionPending || !selected.invoiceId}>{actionPending === "request_refund" ? "Saving..." : "Request refund"}</button>
                  <button type="button" onClick={() => runFinanceAction("mark_voucher_reconciled")} disabled={actionPending || !selected.invoiceId}>{actionPending === "mark_voucher_reconciled" ? "Saving..." : "Mark voucher reconciled"}</button>
                  <button type="button" onClick={() => runFinanceAction("mark_fallback_card_charge")} disabled={actionPending || !selected.invoiceId}>{actionPending === "mark_fallback_card_charge" ? "Saving..." : "Log fallback charge"}</button>
                </div>
              </section>
              <label className="booking-admin-note">
                <span>Admin note</span>
                <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="Optional note for the finance audit trail" />
              </label>
              <div className="booking-finance-actions">
                <button type="button" onClick={() => runFinanceAction("resend_payment_link")} disabled={actionPending || !selected.invoiceId || selected.balance <= 0}>{actionPending === "resend_payment_link" ? "Sending..." : "Resend payment link"}</button>
                <button type="button" onClick={() => runFinanceAction("resend_receipt")} disabled={actionPending || !selected.invoiceId}>{actionPending === "resend_receipt" ? "Sending..." : "Resend receipt"}</button>
                <button type="button" onClick={() => runFinanceAction("mark_finance_review")} disabled={actionPending || !selected.invoiceId}>{actionPending === "mark_finance_review" ? "Saving..." : "Mark review"}</button>
                <button type="button" onClick={() => onOpenBookingFocus?.(bookingFinanceFocusForRow(selected))}>Open in bookings</button>
              </div>
            </>
          ) : (
            <EmptyList title="Choose a finance row" text="Select a booking to see PonchoPay, invoice, receipt and reconciliation detail." />
          )}
        </aside>
      </section>
    </div>
  );
}

function normaliseBookingLedgerRows(ledger, data) {
  const invoices = new Map((ledger.invoices || []).map((invoice) => [invoice.id, invoice]));
  const liveRows = (ledger.bookings || []).map((booking) => {
    const invoice = invoices.get(booking.invoiceId) || Array.from(invoices.values()).find((item) => item.bookingId === booking.id) || {};
    const items = booking.items?.length ? booking.items : invoice.metadata?.items || [];
    const firstItem = items[0] || {};
    const paymentStatus = invoice.paymentStatus || booking.status || "pending_payment";
    const balance = Number(invoice.balance ?? booking.outstandingBalance ?? 0);
    const statusGroup = bookingStatusGroup(paymentStatus, invoice.financeStatus, balance);
    return {
      id: booking.id || invoice.id,
      invoiceId: invoice.id || booking.invoiceId || "",
      reference: booking.bookingReference || invoice.providerReference || invoice.id || "Booking",
      parent: booking.parentName || invoice.metadata?.parentName || booking.parentEmail || invoice.parentEmail || "Parent",
      email: booking.parentEmail || invoice.parentEmail || "",
      children: childNamesFromItems(items),
      site: firstItem.siteName || booking.metadata?.siteName || invoice.metadata?.siteName || "School not recorded",
      firstDate: firstItem.startsAt ? formatShortDate(firstItem.startsAt) : "",
      status: booking.status || paymentStatus,
      paymentStatus,
      statusGroup,
      statusLabel: bookingStatusLabel(paymentStatus, invoice.financeStatus, balance),
      paymentLabel: paymentRouteLabel(booking, invoice),
      total: Number(invoice.totalAmount ?? booking.totalAmount ?? 0),
      paidAmount: Number(invoice.paidAmount ?? 0),
      refundedAmount: Number(invoice.refundedAmount ?? 0),
      balance,
      currency: invoice.currency || "GBP",
      providerPaymentId: invoice.providerPaymentId || invoice.checkoutSessions?.[0]?.providerPaymentId || "",
      providerReference: invoice.providerReference || invoice.checkoutSessions?.[0]?.providerReference || "",
      parentPortalStatus: invoice.parentPortalStatus || "",
      receiptStatus: invoice.receiptStatus || "",
      financeStatus: invoice.financeStatus || "",
      lastProviderEventId: invoice.lastProviderEventId || "",
      createdAt: booking.createdAt || invoice.createdAt || "",
      updatedAt: booking.updatedAt || invoice.updatedAt || "",
      metadata: { ...(invoice.metadata || {}), ...(booking.metadata || {}) },
      receipts: invoice.receipts || [],
      adminActions: invoice.adminActions || [],
      checkoutSessions: invoice.checkoutSessions || [],
      financeStatusLabel: financeStatusLabel(invoice, booking, balance),
      capacityNote: booking.metadata?.capacityNote || "",
      items: items.length ? items : [{ id: `${booking.id || invoice.id}-summary`, childName: childNamesFromItems(items), sessionLabel: "Booking summary", startsAt: booking.createdAt, lineTotal: Number(invoice.totalAmount ?? booking.totalAmount ?? 0) }],
    };
  });
  if (liveRows.length) return liveRows;
  if (ledger.liveRequested) return [];
  return ledger.useDemoFallback === false ? [] : demoBookingAdminRows(data);
}

function demoBookingAdminRows(data) {
  const fallbackSchool = data?.schools?.[0]?.name || "Willington Prep";
  return [
    demoBookingRow("demo-paid", "APR-WIL-1001", "Lindsay Lindsay", "lindsay@example.com", "Dolly Ewing", fallbackSchool, "2026-09-03T15:30:00", "Session 1", 6.8, 0, "Paid", "paid"),
    demoBookingRow("demo-voucher", "APR-RIP-1002", "Sam Patel", "sam@example.com", "Arlo Patel", "Ripley Court", "2026-09-04T16:00:00", "Session 2", 11.3, 0, "Voucher guaranteed", "guaranteed"),
    demoBookingRow("demo-pending", "APR-SHS-1003", "Emma Brown", "emma@example.com", "Noah Brown", "Shrewsbury House School", "2026-09-07T15:30:00", "Session 1", 6.8, 6.8, "Payment pending", "pending"),
  ];
}

function demoBookingRow(id, reference, parent, email, child, site, startsAt, sessionLabel, total, balance, statusLabel, statusGroup) {
  return {
    id,
    invoiceId: "",
    reference,
    parent,
    email,
    children: child,
    site,
    firstDate: formatShortDate(startsAt),
    status: statusLabel,
    paymentStatus: statusLabel,
    statusGroup,
    statusLabel,
    paymentLabel: balance > 0 ? "PonchoPay link sent" : statusGroup === "guaranteed" ? "PonchoPay voucher guarantee" : "Card paid",
    total,
    paidAmount: Math.max(total - balance, 0),
    refundedAmount: 0,
    balance,
    currency: "GBP",
    providerPaymentId: statusGroup === "pending" ? "Not created" : `demo-${reference.toLowerCase()}`,
    providerReference: reference,
    parentPortalStatus: statusGroup === "pending" ? "payment_required" : "visible",
    receiptStatus: statusGroup === "paid" ? "sent" : "not_sent",
    financeStatus: statusGroup,
    lastProviderEventId: statusGroup === "pending" ? "" : `evt-${id}`,
    createdAt: startsAt,
    updatedAt: startsAt,
    metadata: {},
    receipts: statusGroup === "paid" ? [{ id: `${id}-receipt`, receiptNumber: `R-${reference}`, amount: total, deliveryStatus: "sent", issuedAt: startsAt }] : [],
    adminActions: [],
    checkoutSessions: [{ id: `${id}-checkout`, providerPaymentId: `demo-${reference.toLowerCase()}`, providerReference: reference, paymentMethod: statusGroup === "guaranteed" ? "childcare_voucher_card_guarantee" : "card", paymentPlan: "pay_now", status: statusGroup === "pending" ? "created" : "completed", amount: total, createdAt: startsAt, updatedAt: startsAt }],
    financeStatusLabel: statusGroup === "guaranteed" ? "Voucher guaranteed" : statusGroup === "paid" ? "Reconciled" : "Awaiting payment",
    capacityNote: "",
    items: [{ id: `${id}-item`, childName: child, siteName: site, sessionLabel, startsAt, endsAt: new Date(new Date(startsAt).getTime() + 30 * 60000).toISOString(), unitAmount: total, lineTotal: total }],
  };
}

function bookingStatusGroup(paymentStatus, financeStatus, balance) {
  const combined = `${paymentStatus || ""} ${financeStatus || ""}`.toLowerCase();
  if (combined.includes("review") || combined.includes("failed") || combined.includes("cancel")) return "attention";
  if (combined.includes("guarantee") || combined.includes("voucher") || combined.includes("reconciliation")) return "guaranteed";
  if (combined.includes("paid") || combined.includes("captured") || combined.includes("complete") || balance <= 0) return "paid";
  return "pending";
}

function bookingStatusLabel(paymentStatus, financeStatus, balance) {
  const group = bookingStatusGroup(paymentStatus, financeStatus, balance);
  if (group === "attention") return "Needs admin";
  if (group === "guaranteed") return "Guaranteed";
  if (group === "paid") return "Paid";
  return "Needs payment";
}

function paymentRouteLabel(booking, invoice) {
  const route = booking.paymentRoute || invoice.checkoutSessions?.[0]?.paymentMethod || booking.paymentMethod || invoice.financeStatus || "PonchoPay";
  return String(route || "PonchoPay").replace(/_/g, " ");
}

function financeStatusLabel(invoice = {}, booking = {}, balance = 0) {
  const session = invoice.checkoutSessions?.[0] || {};
  const route = `${booking.paymentRoute || session.paymentMethod || booking.paymentMethod || ""}`.toLowerCase();
  const finance = `${invoice.financeStatus || invoice.paymentStatus || session.status || ""}`.toLowerCase();
  if (finance.includes("fallback")) return "Fallback card paid";
  if (finance.includes("reconciled") || (balance <= 0 && (finance.includes("paid") || finance.includes("complete")))) return "Reconciled";
  if (route.includes("voucher") || finance.includes("voucher") || finance.includes("guarantee")) return "Voucher guaranteed";
  if (finance.includes("failed") || finance.includes("cancel")) return "Payment attention";
  if (balance <= 0) return "Paid";
  return "Awaiting payment";
}

function buildBookingFinanceFacts(row) {
  const latestSession = latestByDate(row.checkoutSessions, "updatedAt") || latestByDate(row.checkoutSessions, "createdAt") || {};
  const latestReceipt = latestByDate(row.receipts, "issuedAt") || {};
  const guaranteed = [row.paymentLabel, row.financeStatus, latestSession.paymentMethod].join(" ").toLowerCase().includes("voucher")
    || [row.paymentLabel, row.financeStatus, latestSession.paymentMethod].join(" ").toLowerCase().includes("guarantee");
  return [
    {
      label: "Invoice",
      value: row.invoiceId ? row.reference : "Not created",
      detail: row.invoiceId ? `Portal: ${humaniseStatus(row.parentPortalStatus || row.status)}` : "Booking has no linked invoice yet",
      tone: row.invoiceId ? "good" : "warn",
    },
    {
      label: "PonchoPay",
      value: row.providerPaymentId && row.providerPaymentId !== "Not created" ? "Linked" : "Not linked",
      detail: row.providerPaymentId && row.providerPaymentId !== "Not created" ? row.providerPaymentId : humaniseStatus(latestSession.status || "checkout pending"),
      tone: row.providerPaymentId && row.providerPaymentId !== "Not created" ? "good" : "warn",
    },
    {
      label: "Payment route",
      value: humaniseStatus(latestSession.paymentMethod || row.paymentLabel || "PonchoPay"),
      detail: humaniseStatus(latestSession.paymentPlan || row.metadata?.paymentPlan || "single payment"),
    },
    {
      label: "Voucher guarantee",
      value: guaranteed ? "In use" : "Not used",
      detail: guaranteed ? "Card guarantee protects the place while vouchers reconcile" : "Card or direct payment route",
      tone: guaranteed ? "good" : "",
    },
    {
      label: "Balance",
      value: `${formatCurrency(row.paidAmount || 0)} paid`,
      detail: `${formatCurrency(row.balance || 0)} outstanding · ${formatCurrency(row.refundedAmount || 0)} refunded`,
      tone: Number(row.balance || 0) > 0 ? "warn" : "good",
    },
    {
      label: "Receipt/email",
      value: humaniseStatus(row.receiptStatus || latestReceipt.deliveryStatus || "not sent"),
      detail: latestReceipt.receiptNumber ? `${latestReceipt.receiptNumber} · ${formatDateTime(latestReceipt.issuedAt)}` : "No issued receipt recorded",
      tone: String(row.receiptStatus || latestReceipt.deliveryStatus || "").toLowerCase().includes("sent") ? "good" : "warn",
    },
  ];
}

function buildBookingTimelineItems(row) {
  const events = [];
  (row.checkoutSessions || []).forEach((session) => {
    events.push({
      id: `checkout-${session.id}`,
      label: `PonchoPay ${humaniseStatus(session.status || "checkout")}`,
      detail: [humaniseStatus(session.paymentMethod || "payment method"), formatCurrency(session.amount || row.total || 0), session.providerReference].filter(Boolean).join(" · "),
      date: session.updatedAt || session.createdAt,
    });
  });
  (row.receipts || []).forEach((receipt) => {
    events.push({
      id: `receipt-${receipt.id}`,
      label: `Receipt ${humaniseStatus(receipt.deliveryStatus || "issued")}`,
      detail: [receipt.receiptNumber, formatCurrency(receipt.amount || 0), receipt.providerReference].filter(Boolean).join(" · "),
      date: receipt.issuedAt,
    });
  });
  (row.adminActions || []).forEach((action) => {
    events.push({
      id: `action-${action.id}`,
      label: humaniseStatus(action.action || "Admin action"),
      detail: [action.actorEmail, humaniseStatus(action.status || ""), action.note].filter(Boolean).join(" · "),
      date: action.createdAt,
    });
  });
  if (row.lastProviderEventId) {
    events.push({
      id: `provider-${row.lastProviderEventId}`,
      label: "Latest provider event",
      detail: row.lastProviderEventId,
      date: row.updatedAt,
    });
  }
  return events
    .filter((event) => event.date || event.detail)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 8)
    .map((event) => ({ ...event, when: event.date ? formatDateTime(event.date) : "No date recorded" }));
}

function latestByDate(items = [], key) {
  return [...items].filter((item) => item?.[key]).sort((a, b) => new Date(b[key]) - new Date(a[key]))[0] || null;
}

function humaniseStatus(value) {
  if (!value) return "Not recorded";
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function childNamesFromItems(items = []) {
  const names = Array.from(new Set(items.map((item) => item.childName).filter(Boolean)));
  return names.join(", ") || "Child not recorded";
}

function sessionTimeRange(item) {
  if (!item.startsAt && !item.endsAt) return "Time not recorded";
  const formatTime = (value) => value ? new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  return [formatTime(item.startsAt), formatTime(item.endsAt)].filter(Boolean).join("-");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function UserManagement({ data }) {
  const [state, setState] = useState(() => readUserAdminState());
  const [applications, setApplications] = useState(() => readJson(staffApplicationsStorageKey, []));
  const [selectedStaffId, setSelectedStaffId] = useState(data.staff[0]?.id || "");
  const [accountMessage, setAccountMessage] = useState("");
  const [busyAccountId, setBusyAccountId] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [rolloutFilter, setRolloutFilter] = useState("All");
  const users = mergeUserRecords(data.staff, state);
  const staffOptions = data.staff.map((person) => {
    const id = person.profileId || person.id;
    const user = users.find((item) => item.id === id) || {};
    const freshEmail = isRealStaffEmail(person.email) ? person.email : "";
    const freshRole = person.accessRole || (person.role?.toLowerCase().includes("manager") ? "Manager" : "Staff");
    return {
      ...person,
      id,
      staffRecordId: person.id,
      email: freshEmail || user.email || person.email || "",
      role: freshRole || user.role || "Staff",
      status: user.status || "Active",
    };
  });
  const selectedStaff = staffOptions.find((person) => person.id === selectedStaffId) || staffOptions[0];
  const accountRows = buildAccountRolloutRows(staffOptions, users);
  const rolloutCounts = {
    ready: accountRows.filter((row) => row.readiness === "Ready").length,
    missing: accountRows.filter((row) => row.readiness === "Missing email").length,
    invited: accountRows.filter((row) => row.status === "Invited").length,
    active: accountRows.filter((row) => row.status === "Active").length,
    admins: accountRows.filter((row) => ["Admin", "Superadmin"].includes(row.role)).length,
  };
  const resendSetupReady = accountRows.some((row) => /welcome email sent|reset email sent/i.test(row.emailStatus || ""));
  const manualInviteMode = hasSupabaseConfig && !resendSetupReady;
  const visibleAccountRows = accountRows.filter((row) => {
    const matchesQuery = [row.name, row.email, row.role, row.location].join(" ").toLowerCase().includes(accountQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (rolloutFilter === "All") return true;
    if (rolloutFilter === "Ready") return row.readiness === "Ready";
    if (rolloutFilter === "Missing email") return row.readiness === "Missing email";
    if (rolloutFilter === "Invited") return row.status === "Invited";
    if (rolloutFilter === "Active") return row.status === "Active";
    if (rolloutFilter === "Admin") return ["Admin", "Superadmin"].includes(row.role);
    if (rolloutFilter === "Manager") return row.role === "Manager";
    if (rolloutFilter === "Staff") return row.role === "Staff";
    return true;
  });

  function saveState(next) {
    setState(next);
    localStorage.setItem(userStorageKey, JSON.stringify(next));
  }

  async function inviteStaffMember(targetStaff = selectedStaff) {
    if (!targetStaff?.id) return;
    const email = targetStaff.email || "";
    if (!isRealStaffEmail(email)) {
      setAccountMessage("Add a real email address to this staff record before inviting them.");
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const now = new Date().toISOString();
    setBusyAccountId(targetStaff.id);
    setAccountMessage("Creating invite...");

    const patch = {
      id: targetStaff.id,
      name: targetStaff.name,
      email,
      role: targetStaff.role,
      status: "Invited",
      source: "staff record",
      temporaryPassword,
      temporaryPasswordUpdatedAt: now,
      lastInviteAt: now,
      accountAction: "Invite created locally",
      emailStatus: hasSupabaseConfig ? "Sending" : "Local preview",
    };

    try {
      let result = null;
      if (hasSupabaseConfig) {
        const { createStaffAccountInvite, getStaffLoginUrl } = await loadSupabaseModule();
        result = await createStaffAccountInvite({
          staffRecordId: targetStaff.staffRecordId || targetStaff.id,
          name: targetStaff.name,
          email,
          role: targetStaff.role,
          temporaryPassword,
          loginUrl: getStaffLoginUrl(),
        });
      }

      saveState({
        ...state,
        [targetStaff.id]: {
          ...users.find((user) => user.id === targetStaff.id),
          ...state[targetStaff.id],
          ...patch,
          supabaseUserId: result?.userId || state[targetStaff.id]?.supabaseUserId || "",
          emailStatus: result?.emailed
            ? "Welcome email sent"
            : (result?.emailError || (hasSupabaseConfig ? "Account created, email not sent" : "Local preview only")),
        },
      });
      setAccountMessage(result?.emailed
        ? "Invite sent. The temporary password is visible below."
        : "Account created. Email was not sent, so use the visible temporary password.");
      addAuditLog("Staff account invited", `${email} invited to the staff platform${result?.emailed ? " by email" : " for manual handover"}`);
    } catch (error) {
      saveState({
        ...state,
        [targetStaff.id]: {
          ...users.find((user) => user.id === targetStaff.id),
          ...state[targetStaff.id],
          ...patch,
          accountAction: "Invite failed",
          emailStatus: error.message || "Invite failed",
        },
      });
      setAccountMessage(`Invite saved locally, but live account creation failed: ${error.message}`);
    } finally {
      setBusyAccountId("");
    }
  }

  async function resetUserPassword(user) {
    if (!isRealStaffEmail(user?.email)) {
      setAccountMessage("This staff member needs a real email before a password can be reset.");
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const now = new Date().toISOString();
    setBusyAccountId(user.id);
    setAccountMessage("Preparing password reset...");

    const patch = {
      temporaryPassword,
      temporaryPasswordUpdatedAt: now,
      lastPasswordResetAt: now,
      accountAction: "Password reset locally",
      emailStatus: hasSupabaseConfig ? "Sending reset email" : "Local preview",
    };

    try {
      let result = null;
      if (hasSupabaseConfig) {
        const { resetStaffAccountPassword, getStaffLoginUrl } = await loadSupabaseModule();
        result = await resetStaffAccountPassword({
          staffRecordId: user.staffRecordId || user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          temporaryPassword,
          loginUrl: getStaffLoginUrl(),
        });
      }

      updateUser(user.id, {
        ...patch,
        status: user.status === "Deactivated" ? "Invited" : user.status,
        supabaseUserId: result?.userId || user.supabaseUserId || "",
        emailStatus: result?.emailed
          ? "Reset email sent"
          : (result?.emailError || (hasSupabaseConfig ? "Password reset, email not sent" : "Local preview only")),
      });
      setAccountMessage(result?.emailed
        ? "Temporary password generated and reset email sent."
        : "Temporary password generated. Email was not sent, so use the visible password.");
      addAuditLog("Staff password reset", `${user.email} password reset generated${result?.emailed ? " and emailed" : " for manual handover"}`);
    } catch (error) {
      updateUser(user.id, {
        ...patch,
        emailStatus: error.message || "Reset failed",
      });
      setAccountMessage(`Temporary password saved locally, but live reset failed: ${error.message}`);
    } finally {
      setBusyAccountId("");
    }
  }

  function updateUser(id, patch) {
    const existing = users.find((user) => user.id === id) || {};
    saveState({
      ...state,
      [id]: {
        ...existing,
        ...state[id],
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });
    addAuditLog("User updated", `${existing.email || existing.name} changed: ${Object.entries(patch).map(([key, value]) => `${key} ${value}`).join(", ")}`);
  }

  function saveApplications(next) {
    setApplications(next);
    localStorage.setItem(staffApplicationsStorageKey, JSON.stringify(next));
  }

  function approveApplication(application) {
    const id = `onboarded-${Date.now()}`;
    const staffProfile = staffProfileFromApplication(application, id);
    saveState({
      ...state,
      [id]: {
        id,
        name: application.name,
        email: application.email,
        role: application.preferredRole?.includes("Manager") || application.preferredRole?.includes("Lead") ? "Manager" : "Staff",
        status: "Invited",
        source: "approved onboarding",
        scope: application.preferredSchool || "Assignment needed",
        invitedAt: new Date().toISOString(),
      },
    });
    saveOnboardedStaffProfile(staffProfile);
    saveApplications(applications.map((item) => item.id === application.id ? { ...item, status: "Approved", approvedAt: new Date().toISOString(), staffProfileId: id } : item));
    addAuditLog("Staff application approved", `${application.name} approved, SCR profile opened and account invite created`);
  }

  function rejectApplication(application) {
    saveApplications(applications.map((item) => item.id === application.id ? { ...item, status: "Rejected", rejectedAt: new Date().toISOString() } : item));
    addAuditLog("Staff application rejected", `${application.name} marked as rejected`);
  }

  return (
    <div className="user-admin">
      <section className="user-invite">
        <div>
          <p className="eyebrow">User management</p>
          <h2>Invite staff into the Après workspace.</h2>
          <p>Select a staff member, generate their account, and send a welcome email with a login link and temporary password. The system is for staff-only features: sessions, documents, compliance evidence, HR files, pay and internal updates.</p>
          <p>It also helps Après School stay compliant across sites and ready to provide evidence to Ofsted or partner schools when required.</p>
          <div className="account-rollout-stats">
            <span><strong>{rolloutCounts.ready}</strong> ready</span>
            <span><strong>{rolloutCounts.missing}</strong> missing email</span>
            <span><strong>{rolloutCounts.invited}</strong> invited</span>
            <span><strong>{rolloutCounts.admins}</strong> admin access</span>
          </div>
        </div>
        <div className="account-invite-panel">
          {manualInviteMode && (
            <div className="manual-invite-notice">
              <strong>Manual invite mode</strong>
              <span>Resend is not fully configured yet. Accounts can still be created and passwords can be handed to staff directly.</span>
            </div>
          )}
          <label>Staff member
            <select value={selectedStaff?.id || ""} onChange={(event) => setSelectedStaffId(event.target.value)}>
              {staffOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email || "No email"}</option>)}
            </select>
          </label>
          {selectedStaff && (
            <div className="account-preview">
              <strong>{selectedStaff.name}</strong>
              <span>{selectedStaff.email || "Email missing"}</span>
              <small>{selectedStaff.role} · {selectedStaff.location || "Assigned sites"}</small>
            </div>
          )}
          <button className="button book" type="button" disabled={!selectedStaff || !isRealStaffEmail(selectedStaff.email) || busyAccountId === selectedStaff.id} onClick={() => inviteStaffMember()}>
            {busyAccountId === selectedStaff?.id ? "Creating..." : "Invite to Create Account"}
          </button>
          {accountMessage && <p className="account-message">{accountMessage}</p>}
        </div>
      </section>
      <section className="account-rollout">
        <div className="scr-assignments-heading">
          <div>
            <p className="eyebrow">Account rollout</p>
            <h2>Create users in a controlled run.</h2>
            <p>Use this list to test one real invite first, then work through ready staff. Missing-email rows are blocked until their staff profile is updated.</p>
            <p className="panel-note">Temporary passwords are visible for handover while email sending is being configured. Copy details only when you are ready to share them with the staff member.</p>
          </div>
          <div className="status-stack">
            <Badge value={hasSupabaseConfig ? "Live Supabase" : "Local preview"} />
            {manualInviteMode && <Badge value="Manual handover" />}
          </div>
        </div>
        <div className="crm-controls account-controls">
          <label>Search staff<input value={accountQuery} onChange={(event) => setAccountQuery(event.target.value)} placeholder="Search name, email, role or site" /></label>
          <label>Show<select value={rolloutFilter} onChange={(event) => setRolloutFilter(event.target.value)}>
            {["Ready", "Missing email", "Invited", "Active", "Admin", "Manager", "Staff", "All"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
        </div>
        <div className="account-rollout-table-wrap">
          <table className="account-rollout-table">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role / site</th>
                <th>Readiness</th>
                <th>Last account action</th>
                <th>Last login</th>
                <th>Temporary password</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccountRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <span>{row.email || "Email missing"}</span>
                  </td>
                  <td>
                    <strong>{row.role}</strong>
                    <span>{row.location || "Assigned sites"}</span>
                  </td>
                  <td><Badge value={row.readiness} /></td>
                  <td><span>{row.emailStatus || row.status}</span></td>
                  <td><span>{row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Not tracked yet"}</span></td>
                  <td>
                    {row.temporaryPassword ? (
                      <div className="temporary-password-inline">
                        <code>{row.temporaryPassword}</code>
                        <button className="button light" type="button" onClick={() => copyTemporaryPassword(row.temporaryPassword, row.name)}>Copy</button>
                        <button className="button light" type="button" onClick={() => copyLoginDetails(row)}>Copy login</button>
                      </div>
                    ) : <span>Not generated</span>}
                  </td>
                  <td>
                    {row.readiness === "Missing email" ? (
                      <button className="button light" type="button" disabled>Needs email</button>
                    ) : row.status === "Invited" || row.temporaryPassword ? (
                      <button className="button light" type="button" disabled={busyAccountId === row.id} onClick={() => resetUserPassword(row)}>{busyAccountId === row.id ? "Working..." : "Reset"}</button>
                    ) : (
                      <button className="button book" type="button" disabled={busyAccountId === row.id} onClick={() => inviteStaffMember(row)}>{busyAccountId === row.id ? "Creating..." : "Invite"}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleAccountRows.length && <EmptyList title="No matching staff" text="Adjust the search or filter to see staff account readiness." />}
        </div>
      </section>
      <section className="onboarding-admin">
        <div className="scr-assignments-heading">
          <div>
            <p className="eyebrow">Staff onboarding</p>
            <h2>Review applications before accounts are created.</h2>
            <p>Submitted forms stay pending until an admin approves them. Approval creates an invited platform account ready for site and hours assignment.</p>
          </div>
          <Badge value={`${applications.filter((item) => item.status === "Pending approval").length} pending`} />
        </div>
        <div className="onboarding-list">
          {applications.map((application) => (
            <article className="onboarding-card" key={application.id}>
              <div className="crm-card-head">
                <div>
                  <span>{application.preferredRole || "Staff applicant"}</span>
                  <h3>{application.name}</h3>
                  <p>{application.email} · {application.phone}</p>
                </div>
                <Badge value={application.status} />
              </div>
              <p>{application.preferredSchool || "No preferred school"} · {application.availability || "Availability not provided"}</p>
              <small>Qualification: {application.hasQualification} · Right to work: {application.rightToWork}</small>
              <label>Admin note<textarea rows="2" value={application.adminNote || ""} onChange={(event) => saveApplications(applications.map((item) => item.id === application.id ? { ...item, adminNote: event.target.value } : item))} /></label>
              <div className="hero-actions">
                <button className="button book" type="button" disabled={application.status === "Approved"} onClick={() => approveApplication(application)}>Approve & Invite</button>
                <button className="button light" type="button" disabled={application.status === "Rejected"} onClick={() => rejectApplication(application)}>Reject</button>
              </div>
            </article>
          ))}
          {!applications.length && <EmptyList title="No applications yet" text="Public staff application submissions will appear here for approval." />}
        </div>
      </section>
      <section className="user-grid">
        {users.map((user) => (
          <article className="user-card" key={user.id}>
            <div>
              <h3>{user.name}</h3>
              <p>{user.email}</p>
            </div>
            <Badge value={user.status} />
            <label>Role<select value={user.role} onChange={(event) => updateUser(user.id, { role: event.target.value })}>{userRoles.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Status<select value={user.status} onChange={(event) => updateUser(user.id, { status: event.target.value })}>{["Active", "Invited", "Deactivated"].map((item) => <option key={item}>{item}</option>)}</select></label>
            {user.temporaryPassword && (
              <div className="temporary-password">
                <span>Temporary password</span>
                <div className="temporary-password-row">
                  <code>{user.temporaryPassword}</code>
                  <button className="button light" type="button" onClick={() => copyTemporaryPassword(user.temporaryPassword, user.name)}>Copy</button>
                  <button className="button light" type="button" onClick={() => copyLoginDetails(user)}>Copy login details</button>
                </div>
                <small>{user.temporaryPasswordUpdatedAt ? `Generated ${formatDateTime(user.temporaryPasswordUpdatedAt)}` : "Generated locally"}</small>
              </div>
            )}
            <div className="user-card-actions">
              <button className="button light" type="button" disabled={busyAccountId === user.id} onClick={() => resetUserPassword(user)}>
                {busyAccountId === user.id ? "Working..." : "Reset Password"}
              </button>
            </div>
            <small>{user.emailStatus || (user.source === "local invite" ? "Local invite" : "Mapped from staff record")} · {user.updatedAt ? "Updated locally" : "Ready"}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function HRHierarchy({ data, onUpdateStaffSite, onUpdateHrLine, formerStaffRecords, onFormerStaffChange, onOpenStaffProfile, onOpenHrFiles, onOpenScr, onOpenPay }) {
  const [state, setState] = useState(() => readHierarchyState());
  const [localFormerStaff, setLocalFormerStaff] = useState(() => readJson(formerStaffStorageKey, {}));
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("All sites");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [selectedRecordTab, setSelectedRecordTab] = useState("Overview");
  const [selectedFormerStaffId, setSelectedFormerStaffId] = useState("");
  const [dismissTargetId, setDismissTargetId] = useState("");
  const [dismissReason, setDismissReason] = useState("Resigned");
  const staffSource = data.allStaff || data.staff;
  const formerStaff = formerStaffRecords || localFormerStaff;
  const setFormerStaff = onFormerStaffChange || setLocalFormerStaff;
  const users = mergeUserRecords(staffSource, readUserAdminState());
  const leavingReasons = [
    "Resigned",
    "End of fixed-term contract",
    "End of zero-hours engagement",
    "Moved away",
    "No longer available",
    "Performance or probation outcome",
    "Dismissed",
    "Redundancy",
    "Other",
  ];
  const schoolOptions = Array.from(new Set([
    "Organisation-wide",
    ...rotaSites.map((site) => canonicalSchoolName(site.site)),
    ...staffSource.flatMap((person) => staffSchoolNames(person)),
  ].filter(Boolean))).sort((a, b) => {
    if (a === "Organisation-wide") return -1;
    if (b === "Organisation-wide") return 1;
    return sortPayrollSites(a, b);
  });
  const userIdByStaffRecordId = new Map(users.map((user) => [user.staffRecordId, user.id]).filter(([staffRecordId]) => staffRecordId));
  const rows = users.map((user) => {
    const staffProfile = staffSource.find((person) => (person.profileId || person.id) === user.id) || {};
    const persistedLine = data.hrReportingLines?.[user.staffRecordId || staffProfile.id] || {};
    const persistedReportsTo = persistedLine.managerStaffRecordId ? (userIdByStaffRecordId.get(persistedLine.managerStaffRecordId) || "") : "";
    const reportsTo = (state[user.id]?.reportsTo ?? persistedReportsTo) || defaultReportsTo(user, users);
    const rawScope = state[user.id]?.scope || persistedLine.scope || staffPrimaryLocation(staffProfile) || "Organisation-wide";
    const scope = rawScope === "Unassigned" ? "Organisation-wide" : canonicalSchoolName(rawScope);
    return {
      ...user,
      staffRecordId: user.staffRecordId || staffProfile.id,
      reportsTo,
      scope,
      updatedAt: state[user.id]?.updatedAt,
      managerName: users.find((person) => person.id === reportsTo)?.name || "No manager assigned",
    };
  });
  const rowsWithLeaverStatus = rows.map((person) => {
    const staffProfile = staffSource.find((staff) => staff.id === person.staffRecordId || staff.profileId === person.id || staff.id === person.id);
    const formerRecord = staffProfile?.formerRecord || formerStaff[person.id] || formerStaff[person.staffRecordId];
    return { ...person, formerRecord };
  });
  const baseActiveRows = rowsWithLeaverStatus.filter((person) => !person.formerRecord);
  const activeIds = new Set(baseActiveRows.map((person) => person.id));
  const activeRows = baseActiveRows.map((person) => (
    person.reportsTo && !activeIds.has(person.reportsTo)
      ? { ...person, reportsTo: "", managerName: "No manager assigned" }
      : person
  ));
  const formerRows = rowsWithLeaverStatus
    .filter((person) => person.formerRecord)
    .sort((a, b) => new Date(b.formerRecord?.dismissedAt || 0) - new Date(a.formerRecord?.dismissedAt || 0));
  const managerOptions = activeRows.filter((person) => ["Manager", "Admin", "Superadmin"].includes(person.role));
  const selectedStaff = activeRows.find((person) => person.id === selectedStaffId) || activeRows[0] || null;
  const dismissTarget = activeRows.find((person) => person.id === dismissTargetId) || null;
  const selectedStaffProfile = selectedStaff ? staffSource.find((person) => person.id === selectedStaff.staffRecordId || person.profileId === selectedStaff.id || person.id === selectedStaff.id) : null;
  const selectedStaffFiles = selectedStaff ? (data.hrFiles || []).filter((file) => file.staffRecordId === selectedStaff.staffRecordId) : [];
  const selectedStaffPayslips = selectedStaffProfile ? staffPayslips(data.hrFiles, selectedStaffProfile.id) : [];
  const selectedStaffRestrictedFiles = selectedStaffFiles.filter((file) => file.sensitivity === "restricted" || staffHrFileBucket(file) === "Restricted");
  const selectedStaffScr = selectedStaffProfile ? staffScrOperationalSummary(selectedStaffProfile) : null;
  const selectedStaffPay = selectedStaffProfile ? staffPayrollOperationalSummary(data, selectedStaffProfile) : null;
  const selectedStaffNotes = selectedStaffProfile ? chooseLatestStaffProfileNotes(readJson(staffProfileNotesStorageKey, {})[selectedStaffProfile.id], data.staffProfileNotes?.[selectedStaffProfile.id]) : normalizeStaffProfileNotes(null);
  const selectedDirectReports = selectedStaff ? activeRows.filter((person) => person.reportsTo === selectedStaff.id) : [];
  const selectedFormerStaff = formerRows.find((person) => person.id === selectedFormerStaffId || person.staffRecordId === selectedFormerStaffId) || formerRows[0] || null;
  const selectedFormerRecord = selectedFormerStaff?.formerRecord || {};
  const selectedFormerProfile = selectedFormerStaff ? staffSource.find((person) => person.id === selectedFormerStaff.staffRecordId || person.profileId === selectedFormerStaff.id || person.id === selectedFormerStaff.id) : null;
  const selectedFormerFiles = selectedFormerStaff ? (data.hrFiles || []).filter((file) => file.staffRecordId === selectedFormerStaff.staffRecordId) : [];
  const selectedFormerPayslips = selectedFormerProfile ? staffPayslips(data.hrFiles, selectedFormerProfile.id) : [];
  const selectedFormerScr = selectedFormerProfile ? staffScrOperationalSummary(selectedFormerProfile) : null;
  const selectedFormerPay = selectedFormerProfile ? staffPayrollOperationalSummary({ ...data, staff: staffSource }, selectedFormerProfile) : null;
  const filteredRows = activeRows.filter((person) => {
    const matchesSite = siteFilter === "All sites" || person.scope === siteFilter;
    const haystack = [person.name, person.email, person.role, person.scope, person.managerName].join(" ").toLowerCase();
    return matchesSite && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  });
  const unmappedStaff = activeRows.filter((person) => person.role !== "Superadmin" && !person.reportsTo).length;
  const siteCoverage = schoolOptions.filter((site) => site !== "Organisation-wide").map((site) => ({
    site,
    managers: activeRows.filter((person) => person.scope === site && ["Manager", "Admin", "Superadmin"].includes(person.role)).length,
    staff: activeRows.filter((person) => person.scope === site).length,
    files: (data.hrFiles || []).filter((file) => activeRows.some((person) => person.staffRecordId === file.staffRecordId && person.scope === site)).length,
  }));
  const staffWithNoFiles = activeRows.filter((person) => person.role !== "Superadmin" && !(data.hrFiles || []).some((file) => file.staffRecordId === person.staffRecordId)).length;
  const profileFor = (person) => staffSource.find((staff) => staff.id === person.staffRecordId || staff.profileId === person.id || staff.id === person.id) || null;
  const filesFor = (person) => (data.hrFiles || []).filter((file) => file.staffRecordId === person.staffRecordId);
  const operationalRows = activeRows.map((person) => {
    const profile = profileFor(person);
    const files = filesFor(person);
    const scr = profile ? staffScrOperationalSummary(profile) : null;
    const pay = profile ? staffPayrollOperationalSummary(data, profile) : null;
    const issues = [];
    if (person.role !== "Superadmin" && !person.reportsTo) issues.push("Line manager");
    if (person.role !== "Superadmin" && !files.length) issues.push("HR files");
    if (scr?.status && !/compliant|ready|clear/i.test(scr.status)) issues.push("SCR");
    if (!profile?.payRate && !profile?.annualSalary) issues.push("Pay basis");
    return { person, profile, files, scr, pay, issues };
  });
  const attentionRows = operationalRows
    .filter((row) => row.issues.length)
    .sort((a, b) => b.issues.length - a.issues.length || String(a.person.name).localeCompare(String(b.person.name)))
    .slice(0, 8);
  const readyRecords = Math.max(0, activeRows.length - operationalRows.filter((row) => row.issues.length).length);
  const operationalRowById = new Map(operationalRows.map((row) => [row.person.id, row]));
  const selectedOperationalRow = selectedStaff ? operationalRowById.get(selectedStaff.id) : null;
  const selectedIssueCount = selectedOperationalRow?.issues.length || 0;
  const selectedReadinessScore = selectedStaff ? Math.round(((4 - Math.min(selectedIssueCount, 4)) / 4) * 100) : 0;
  const selectedRecordChecks = selectedStaff ? [
    ["Line manager", Boolean(selectedStaff.reportsTo), selectedStaff.managerName || "No manager assigned"],
    ["HR files", Boolean(selectedStaffFiles.length), selectedStaffFiles.length ? `${selectedStaffFiles.length} uploaded` : "No files attached"],
    ["SCR", Boolean(selectedStaffScr?.status && /compliant|ready|clear/i.test(selectedStaffScr.status)), selectedStaffScr?.status || "Review needed"],
    ["Pay basis", Boolean(selectedStaffProfile?.payRate || selectedStaffProfile?.annualSalary), selectedStaffPay?.basis || "Not recorded"],
  ] : [];
  const recordTabs = ["Overview", "Compliance", "HR Files", "Pay", "Notes", "Exit"];
  const latestStaffFiles = selectedStaffFiles.slice(0, 4);
  const latestStaffPayslips = selectedStaffPayslips.slice(0, 3);

  useEffect(() => {
    if (activeRows.length && (!selectedStaffId || !activeRows.some((person) => person.id === selectedStaffId))) {
      setSelectedStaffId(activeRows[0].id);
    }
  }, [activeRows, selectedStaffId]);

  useEffect(() => {
    if (!formerRows.length) {
      if (selectedFormerStaffId) setSelectedFormerStaffId("");
      return;
    }
    if (!selectedFormerStaffId || !formerRows.some((person) => person.id === selectedFormerStaffId || person.staffRecordId === selectedFormerStaffId)) {
      setSelectedFormerStaffId(formerRows[0].id);
    }
  }, [formerRows, selectedFormerStaffId]);

  function save(next) {
    setState(next);
    localStorage.setItem(hierarchyStorageKey, JSON.stringify(next));
  }

  function updatePerson(id, patch) {
    const person = activeRows.find((item) => item.id === id);
    const nextReportsTo = Object.prototype.hasOwnProperty.call(patch, "reportsTo") ? patch.reportsTo : person?.reportsTo;
    const nextScope = Object.prototype.hasOwnProperty.call(patch, "scope") ? patch.scope : person?.scope;
    const manager = activeRows.find((item) => item.id === nextReportsTo);
    const next = {
      ...state,
      [id]: {
        ...state[id],
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    save(next);
    if (Object.prototype.hasOwnProperty.call(patch, "scope") && patch.scope && patch.scope !== "Organisation-wide") {
      onUpdateStaffSite?.(person?.staffRecordId || person?.id, patch.scope);
    }
    if (person?.staffRecordId) {
      onUpdateHrLine?.({
        staffRecordId: person.staffRecordId,
        managerStaffRecordId: manager?.staffRecordId || "",
        scope: nextScope || "Organisation-wide",
      });
    }
    const changedFields = [];
    if (Object.prototype.hasOwnProperty.call(patch, "reportsTo")) changedFields.push(`manager ${manager?.name || "No manager assigned"}`);
    if (Object.prototype.hasOwnProperty.call(patch, "scope")) changedFields.push(`site ${nextScope || "Organisation-wide"}`);
    addAuditLog("HR hierarchy updated", `${person?.name || id}: ${changedFields.join(" · ") || Object.keys(patch).join(", ")}${person?.email ? ` · ${person.email}` : ""}`);
  }

  function childrenOf(managerId) {
    return activeRows.filter((person) => person.reportsTo === managerId);
  }

  function openDismissModal(person) {
    setDismissTargetId(person.id);
    setDismissReason("Resigned");
  }

  function dismissStaffMember() {
    if (!dismissTarget) return;
    const key = dismissTarget.staffRecordId || dismissTarget.id;
    const record = {
      id: key,
      userId: dismissTarget.id,
      staffRecordId: dismissTarget.staffRecordId,
      name: dismissTarget.name,
      email: dismissTarget.email,
      role: dismissTarget.role,
      scope: dismissTarget.scope,
      reportsTo: dismissTarget.reportsTo,
      managerName: dismissTarget.managerName,
      reason: dismissReason,
      dismissedAt: new Date().toISOString(),
    };
    const next = {
      ...formerStaff,
      [key]: record,
      [dismissTarget.id]: record,
    };
    setFormerStaff(next);
    localStorage.setItem(formerStaffStorageKey, JSON.stringify(next));
    addAuditLog("Staff moved to former staff", `${dismissTarget.name}: ${dismissReason}`);
    setSelectedFormerStaffId(dismissTarget.id);
    if (hasSupabaseConfig && isUuid(dismissTarget.staffRecordId)) {
      loadSupabaseModule()
        .then(({ dismissStaffRecord }) => dismissStaffRecord({ staffRecordId: dismissTarget.staffRecordId, reason: dismissReason }))
        .then((savedRecord) => {
          addAuditLog("Former staff saved to Supabase", `${dismissTarget.name}: ${savedRecord.reason || dismissReason}`);
        })
        .catch((error) => {
          console.warn("Unable to save former staff record", error);
          addAuditLog("Former staff save failed", `${dismissTarget.name}: ${error.message || "Supabase rejected the update"}`);
        });
    }
    const nextActive = activeRows.find((person) => person.id !== dismissTarget.id);
    setSelectedStaffId(nextActive?.id || "");
    setDismissTargetId("");
  }

  function restoreStaffMember(person) {
    const next = { ...formerStaff };
    delete next[person.id];
    delete next[person.staffRecordId];
    setFormerStaff(next);
    localStorage.setItem(formerStaffStorageKey, JSON.stringify(next));
    addAuditLog("Former staff restored", person.name);
    if (selectedFormerStaffId === person.id || selectedFormerStaffId === person.staffRecordId) {
      const nextFormer = formerRows.find((item) => item.id !== person.id && item.staffRecordId !== person.staffRecordId);
      setSelectedFormerStaffId(nextFormer?.id || "");
    }
    if (hasSupabaseConfig && isUuid(person.staffRecordId)) {
      loadSupabaseModule()
        .then(({ restoreStaffRecord }) => restoreStaffRecord(person.staffRecordId))
        .then(() => {
          addAuditLog("Former staff restored in Supabase", person.name);
        })
        .catch((error) => {
          console.warn("Unable to restore former staff record", error);
          addAuditLog("Former staff restore failed", `${person.name}: ${error.message || "Supabase rejected the update"}`);
        });
    }
    setSelectedStaffId(person.id);
  }

  function initials(person) {
    return String(person?.name || person?.fullName || "AS")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "AS";
  }

  return (
    <div className="stack hr-workspace">
      <div className="toolbar">
        <div>
          <h2>Staff Records Hub</h2>
          <p className="panel-note">Current staff, line management, HR files, SCR links and pay access in one operational record.</p>
        </div>
        <Badge value="Private HR workspace" />
      </div>
      <div className="hr-summary">
        <Metric icon={<Users />} label="Active people" value={activeRows.length} tone="blue" />
        <Metric icon={<ShieldCheck />} label="Ready records" value={readyRecords} tone="green" />
        <Metric icon={<ClipboardCheck />} label="No line manager" value={unmappedStaff} tone={unmappedStaff ? "amber" : "green"} />
        <Metric icon={<FileText />} label="No HR files" value={staffWithNoFiles} tone={staffWithNoFiles ? "amber" : "green"} />
      </div>
      <section className="hr-attention-panel">
        <div className="crm-card-head">
          <div>
            <span>Needs action</span>
            <h3>HR attention queue</h3>
            <p>Records with missing manager, HR files, SCR review or pay basis appear here first.</p>
          </div>
          <Badge value={`${attentionRows.length} shown`} />
        </div>
        <div className="hr-attention-list">
          {attentionRows.map(({ person, profile, files, scr, pay, issues }) => (
            <article className="hr-attention-card" key={`${person.id}-attention`}>
              <button type="button" onClick={() => setSelectedStaffId(person.id)}>
                <span className="hr-mini-avatar">{initials(person)}</span>
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.scope} · {person.role}</small>
                </span>
              </button>
              <div className="hr-attention-issues">
                {issues.map((issue) => <Badge key={issue} value={issue} />)}
              </div>
              <div className="hr-attention-actions">
                <button type="button" onClick={() => profile && onOpenStaffProfile?.(profile.id)}>Profile</button>
                <button type="button" onClick={() => profile && onOpenScr?.(profile.id)}>SCR</button>
                <button type="button" onClick={() => profile && onOpenHrFiles?.(profile.id)}>Files {files.length ? `(${files.length})` : ""}</button>
                <button type="button" onClick={() => profile && onOpenPay?.(profile.id)}>Pay</button>
              </div>
              <small>{scr?.nextAction || pay?.basis || "Open the record to complete HR setup."}</small>
            </article>
          ))}
          {!attentionRows.length && <EmptyList title="HR records are looking tidy" text="No missing line managers, HR files, SCR review or pay-basis issues are currently showing." />}
        </div>
      </section>
      <section className="hr-ops-grid">
        <aside className="hr-spotlight">
          {selectedStaff ? (
            <>
              <div className="hr-spotlight-head">
                <div className="hr-avatar">{initials(selectedStaff)}</div>
                <div>
                  <p className="eyebrow">Selected profile</p>
                  <h3>{selectedStaff.name}</h3>
                  <span>{selectedStaff.email || "No email recorded"}</span>
                </div>
              </div>
              <div className="hr-profile-facts">
                <div><span>Role</span><strong>{selectedStaff.role}</strong></div>
                <div><span>Usual site</span><strong>{selectedStaff.scope}</strong></div>
                <div><span>Reports to</span><strong>{selectedStaff.managerName}</strong></div>
                <div><span>Direct reports</span><strong>{selectedDirectReports.length}</strong></div>
                <div><span>HR files</span><strong>{selectedStaffFiles.length}</strong></div>
                <div><span>Contract</span><strong>{selectedStaffProfile?.contractType || selectedStaffProfile?.employmentType || "Not recorded"}</strong></div>
              </div>
              <div className="hr-record-tabs" role="tablist" aria-label={`${selectedStaff.name} HR record sections`}>
                {recordTabs.map((tabName) => (
                  <button
                    key={tabName}
                    type="button"
                    className={selectedRecordTab === tabName ? "active" : ""}
                    onClick={() => setSelectedRecordTab(tabName)}
                  >
                    {tabName}
                  </button>
                ))}
              </div>
              <div className="hr-record-tab-panel">
                {selectedRecordTab === "Overview" && (
                  <div className="hr-tab-stack">
                    <div className="hr-record-health">
                      <div className="hr-record-health-head">
                        <div>
                          <span>Record health</span>
                          <strong>{selectedReadinessScore}% complete</strong>
                        </div>
                        <Badge value={selectedIssueCount ? `${selectedIssueCount} action${selectedIssueCount === 1 ? "" : "s"}` : "Ready"} />
                      </div>
                      <div className="hr-record-health-bar" aria-hidden="true"><span style={{ width: `${selectedReadinessScore}%` }} /></div>
                      <div className="hr-record-checks">
                        {selectedRecordChecks.map(([label, ok, detail]) => (
                          <article key={label} className={ok ? "ready" : "needs-work"}>
                            <span>{ok ? "Ready" : "Action"}</span>
                            <strong>{label}</strong>
                            <small>{detail}</small>
                          </article>
                        ))}
                      </div>
                    </div>
                    <div className="hr-profile-controls">
                      <label>Line manager<select value={selectedStaff.reportsTo || ""} onChange={(event) => updatePerson(selectedStaff.id, { reportsTo: event.target.value })}>
                        <option value="">No manager</option>
                        {activeRows.filter((option) => option.id !== selectedStaff.id).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select></label>
                      <label>Usual site<select value={selectedStaff.scope} onChange={(event) => updatePerson(selectedStaff.id, { scope: event.target.value })}>
                        {schoolOptions.map((site) => <option key={site} value={site}>{site}</option>)}
                      </select></label>
                    </div>
                    <div className="hr-direct-report-strip">
                      <span>Direct reports</span>
                      {selectedDirectReports.slice(0, 6).map((person) => (
                        <button type="button" key={person.id} onClick={() => setSelectedStaffId(person.id)}>{person.name}</button>
                      ))}
                      {!selectedDirectReports.length && <small>No direct reports assigned.</small>}
                    </div>
                  </div>
                )}
                {selectedRecordTab === "Compliance" && (
                  <div className="hr-tab-stack">
                    <div className="hr-operational-snapshot">
                      <article>
                        <span>SCR readiness</span>
                        <strong>{selectedStaffScr?.status || "Review needed"}</strong>
                        <small>{selectedStaffScr?.nextAction || "Open SCR profile to review evidence."}</small>
                      </article>
                      <article>
                        <span>Restricted files</span>
                        <strong>{selectedStaffRestrictedFiles.length}</strong>
                        <small>Restricted HR files attached to this staff record.</small>
                      </article>
                    </div>
                    <div className="hr-action-grid" aria-label={`${selectedStaff.name} compliance actions`}>
                      <button type="button" onClick={() => selectedStaffProfile && onOpenScr?.(selectedStaffProfile.id)}>
                        <ClipboardCheck size={18} />
                        <span><strong>Open SCR</strong><small>{selectedStaffScr?.nextAction || "Review recruitment and training evidence"}</small></span>
                      </button>
                      <button type="button" onClick={() => selectedStaffProfile && onOpenStaffProfile?.(selectedStaffProfile.id)}>
                        <ShieldCheck size={18} />
                        <span><strong>Open full profile</strong><small>Training, evidence requests and internal notes</small></span>
                      </button>
                    </div>
                  </div>
                )}
                {selectedRecordTab === "HR Files" && (
                  <div className="hr-tab-stack">
                    <div className="hr-operational-snapshot">
                      <article>
                        <span>Total files</span>
                        <strong>{selectedStaffFiles.length}</strong>
                        <small>{selectedStaffRestrictedFiles.length} restricted · {selectedStaffPayslips.length} payslips</small>
                      </article>
                      <article>
                        <span>Latest file</span>
                        <strong>{latestStaffFiles[0]?.title || "No files yet"}</strong>
                        <small>{latestStaffFiles[0]?.category || "Upload contracts, letters and evidence from HR Files."}</small>
                      </article>
                    </div>
                    <div className="hr-mini-file-list">
                      {latestStaffFiles.map((file) => (
                        <a key={file.id} href={file.fileUrl || undefined} target="_blank" rel="noreferrer" aria-disabled={!file.fileUrl}>
                          <span>{file.category || "HR file"}</span>
                          <strong>{file.title}</strong>
                          <small>{file.issueDate ? formatShortDate(file.issueDate) : file.uploadedAt ? formatShortDate(file.uploadedAt.slice(0, 10)) : "Date not recorded"}</small>
                        </a>
                      ))}
                      {!latestStaffFiles.length && <small>No HR files attached yet.</small>}
                    </div>
                    <div className="hr-action-grid single">
                      <button type="button" onClick={() => selectedStaffProfile && onOpenHrFiles?.(selectedStaffProfile.id)}>
                        <FileText size={18} />
                        <span><strong>Manage HR files</strong><small>Open the full contracts, payslips, letters and secure file record</small></span>
                      </button>
                    </div>
                  </div>
                )}
                {selectedRecordTab === "Pay" && (
                  <div className="hr-tab-stack">
                    <div className="hr-operational-snapshot">
                      <article>
                        <span>Pay basis</span>
                        <strong>{selectedStaffPay?.basis || "Not recorded"}</strong>
                        <small>{selectedStaffProfile?.annualSalary ? `${formatCurrency(selectedStaffProfile.annualSalary)} annual salary` : selectedStaffProfile?.payRate ? `${formatCurrency(selectedStaffProfile.payRate)}/hour` : "Add pay details on the Pay page."}</small>
                      </article>
                      <article>
                        <span>Latest payroll</span>
                        <strong>{selectedStaffPay?.latestPeriod ? formatPayrollPeriod(selectedStaffPay.latestPeriod) : "No run"}</strong>
                        <small>{selectedStaffPay?.latestPeriod ? `${formatCurrency(selectedStaffPay.latestGross)} gross` : "No submitted payroll period found."}</small>
                      </article>
                    </div>
                    <div className="hr-mini-file-list">
                      {latestStaffPayslips.map((file) => (
                        <a key={file.id} href={file.fileUrl || undefined} target="_blank" rel="noreferrer" aria-disabled={!file.fileUrl}>
                          <span>{file.issueDate ? formatShortDate(file.issueDate) : "Payslip"}</span>
                          <strong>{file.title}</strong>
                          <small>{file.notes || "PDF retained for staff view"}</small>
                        </a>
                      ))}
                      {!latestStaffPayslips.length && <small>No payslips attached yet.</small>}
                    </div>
                    <div className="hr-action-grid single">
                      <button type="button" onClick={() => selectedStaffProfile && onOpenPay?.(selectedStaffProfile.id)}>
                        <PoundSterling size={18} />
                        <span><strong>Open pay history</strong><small>Monthly pay, hours, adjustments and uploaded payslips</small></span>
                      </button>
                    </div>
                  </div>
                )}
                {selectedRecordTab === "Notes" && (
                  <div className="hr-tab-stack">
                    <div className="hr-note-preview-grid">
                      {[
                        ["Manager notes", selectedStaffNotes.manager],
                        ["Contract notes", selectedStaffNotes.contract],
                        ["Compliance notes", selectedStaffNotes.compliance],
                        ["Payroll notes", selectedStaffNotes.payroll],
                      ].map(([label, note]) => (
                        <article key={label}>
                          <span>{label}</span>
                          <p>{note || "No note recorded yet."}</p>
                        </article>
                      ))}
                    </div>
                    <div className="hr-action-grid single">
                      <button type="button" onClick={() => selectedStaffProfile && onOpenStaffProfile?.(selectedStaffProfile.id)}>
                        <ShieldCheck size={18} />
                        <span><strong>Edit structured notes</strong><small>Open the full staff profile to update manager, contract, compliance and payroll notes</small></span>
                      </button>
                    </div>
                  </div>
                )}
                {selectedRecordTab === "Exit" && (
                  <div className="hr-tab-stack">
                    <div className="hr-exit-panel">
                      <span>Leaver workflow</span>
                      <strong>Move this person to Former Staff</strong>
                      <p>This removes them from current HR views while retaining SCR history, HR files, payslips and audit records.</p>
                    </div>
                    <div className="hr-action-grid single">
                      <button className="hr-danger-action" type="button" onClick={() => openDismissModal(selectedStaff)}>
                        <X size={18} />
                        <span><strong>Dismiss / archive staff member</strong><small>Choose a reason for leaving and retain their record securely</small></span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyList title="No staff records" text="Staff records will appear here once added." />
          )}
        </aside>
        <div className="hr-directory-panel">
          <div className="hr-directory-controls">
            <div>
              <h3>Current Staff Records</h3>
              <p className="panel-note">Showing {filteredRows.length} of {activeRows.length}. Select a person to manage their operational record.</p>
            </div>
            <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff, email, manager or site" /></label>
            <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
              <option>All sites</option>
              {schoolOptions.map((site) => <option key={site} value={site}>{site}</option>)}
            </select></label>
          </div>
          <div className="hr-person-list">
            {filteredRows.map((person) => (
              <article className={`hr-person-row ${selectedStaff?.id === person.id ? "active" : ""}`} key={person.id}>
                <button className="hr-person-main" type="button" onClick={() => setSelectedStaffId(person.id)}>
                  <span className="hr-mini-avatar">{initials(person)}</span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.email || "No email"} · {person.role}</small>
                  </span>
                </button>
                <span>{person.managerName}</span>
                <span>{person.scope}</span>
                <div className="hr-row-status">
                  {(operationalRowById.get(person.id)?.issues || []).slice(0, 2).map((issue) => <Badge key={issue} value={issue} />)}
                  {!(operationalRowById.get(person.id)?.issues || []).length && <Badge value={childrenOf(person.id).length ? `${childrenOf(person.id).length} reports` : "Ready"} />}
                  {(operationalRowById.get(person.id)?.issues || []).length > 2 && <Badge value={`+${(operationalRowById.get(person.id)?.issues || []).length - 2}`} />}
                </div>
              </article>
            ))}
            {!filteredRows.length && <EmptyList title="No staff found" text="Change the search or site filter to show more staff." />}
          </div>
        </div>
      </section>
      <section className="hr-site-board">
        <div>
          <p className="eyebrow">Site coverage</p>
          <h3>Named people by school</h3>
          <p>Use this to spot thin management coverage, missing assignments and where HR files are concentrated.</p>
        </div>
        <div className="hr-site-coverage">
          {siteCoverage.map((site) => (
            <article key={site.site}>
              <strong>{site.site}</strong>
              <span>{site.managers} manager{site.managers === 1 ? "" : "s"} · {site.staff} staff · {site.files} files</span>
            </article>
          ))}
        </div>
      </section>
      <section className="hr-former-section">
        <div className="crm-card-head">
          <div>
            <span>Former staff</span>
            <h3>Archived staff records</h3>
            <p>Leavers are removed from current HR views but their SCR, HR files and pay history remain available.</p>
          </div>
          <Badge value={`${formerRows.length} archived`} />
        </div>
        {selectedFormerStaff && (
          <div className="former-profile-panel">
            <div className="former-profile-head">
              <div className="hr-avatar">{initials(selectedFormerStaff)}</div>
              <div>
                <p className="eyebrow">Retained leaver record</p>
                <h4>{selectedFormerRecord.name || selectedFormerStaff.name}</h4>
                <span>{selectedFormerRecord.email || selectedFormerStaff.email || "No email recorded"}</span>
              </div>
              <Badge value={selectedFormerRecord.reason || "Reason not recorded"} />
            </div>
            <div className="former-profile-grid">
              <article>
                <span>Left</span>
                <strong>{selectedFormerRecord.dismissedAt ? formatDateTime(selectedFormerRecord.dismissedAt) : "Date not recorded"}</strong>
                <small>{selectedFormerRecord.scope || selectedFormerStaff.scope || "Usual site not recorded"}</small>
              </article>
              <article>
                <span>SCR status</span>
                <strong>{selectedFormerScr?.status || "Retained"}</strong>
                <small>{selectedFormerScr?.nextAction || "SCR history remains on file."}</small>
              </article>
              <article>
                <span>HR files</span>
                <strong>{selectedFormerFiles.length}</strong>
                <small>{selectedFormerPayslips.length} payslip{selectedFormerPayslips.length === 1 ? "" : "s"} retained</small>
              </article>
              <article>
                <span>Latest pay</span>
                <strong>{selectedFormerPay?.latestPeriod ? formatPayrollPeriod(selectedFormerPay.latestPeriod) : "No run"}</strong>
                <small>{selectedFormerPay?.latestGross ? formatCurrency(selectedFormerPay.latestGross) : "No submitted payroll found"}</small>
              </article>
            </div>
            <div className="former-record-actions">
              <button type="button" onClick={() => selectedFormerProfile && onOpenHrFiles?.(selectedFormerProfile.id)}>Open HR files</button>
              <button type="button" onClick={() => selectedFormerProfile && onOpenScr?.(selectedFormerProfile.id)}>Open SCR history</button>
              <button type="button" onClick={() => selectedFormerProfile && onOpenPay?.(selectedFormerProfile.id)}>Open pay history</button>
              <button type="button" onClick={() => restoreStaffMember(selectedFormerStaff)}>Restore to current staff</button>
            </div>
            <div className="former-retained-files">
              {selectedFormerFiles.slice(0, 4).map((file) => (
                <a key={file.id} href={file.fileUrl || undefined} target="_blank" rel="noreferrer" aria-disabled={!file.fileUrl}>
                  <span>{file.category || "HR file"}</span>
                  <strong>{file.title}</strong>
                  <small>{file.issueDate ? formatShortDate(file.issueDate) : file.uploadedAt ? formatShortDate(file.uploadedAt.slice(0, 10)) : "Date not recorded"}</small>
                </a>
              ))}
              {!selectedFormerFiles.length && <small>No retained HR files are attached yet.</small>}
            </div>
          </div>
        )}
        <div className="former-staff-list">
          {formerRows.map((person) => {
            const record = person.formerRecord || {};
            return (
              <article className={`former-staff-row ${selectedFormerStaff?.id === person.id ? "active" : ""}`} key={`${person.id}-former`}>
                <button className="hr-person-main" type="button" onClick={() => setSelectedFormerStaffId(person.id)}>
                  <span className="hr-mini-avatar">{initials(person)}</span>
                  <span>
                    <strong>{record.name || person.name}</strong>
                    <small>{record.email || person.email || "No email"} · {record.role || person.role}</small>
                  </span>
                </button>
                <span>{record.scope || person.scope}</span>
                <span>{record.reason || "Reason not recorded"}</span>
                <span>{record.dismissedAt ? formatDateTime(record.dismissedAt) : "Date not recorded"}</span>
                <div className="former-staff-actions">
                  <button type="button" onClick={() => setSelectedFormerStaffId(person.id)}>View record</button>
                  <button type="button" onClick={() => person.staffRecordId && onOpenHrFiles?.(person.staffRecordId)}>HR files</button>
                  <button type="button" onClick={() => person.staffRecordId && onOpenScr?.(person.staffRecordId)}>SCR</button>
                  <button type="button" onClick={() => person.staffRecordId && onOpenPay?.(person.staffRecordId)}>Pay</button>
                  <button type="button" onClick={() => restoreStaffMember(person)}>Restore</button>
                </div>
              </article>
            );
          })}
          {!formerRows.length && <EmptyList title="No former staff yet" text="Dismissed staff will be archived here with their reason for leaving and record links." />}
        </div>
      </section>
      <section className="hr-org">
        <div className="crm-card-head">
          <div>
            <span>Reporting structure</span>
            <h3>Line management map</h3>
            <p>Senior leaders and people without managers show first, with their direct reports below.</p>
          </div>
        </div>
        <div className="org-tree">
          {activeRows.filter((person) => !person.reportsTo || person.role === "Superadmin").map((person) => (
            <article className="org-node" key={person.id}>
              <strong>{person.name}</strong>
              <span>{person.role} · {person.scope}</span>
              <div>
                {childrenOf(person.id).map((child) => (
                  <button type="button" key={child.id} onClick={() => setSelectedStaffId(child.id)}>{child.name} · {child.role}</button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      {dismissTarget && (
        <div className="platform-modal-backdrop" role="presentation">
          <section className="hr-dismiss-modal" role="dialog" aria-modal="true" aria-labelledby="dismiss-staff-title">
            <button className="modal-close" type="button" aria-label="Close dismiss staff dialog" onClick={() => setDismissTargetId("")}><X size={18} /></button>
            <p className="eyebrow">Move to former staff</p>
            <h3 id="dismiss-staff-title">Dismiss {dismissTarget.name}</h3>
            <p>This will remove them from current HR views while keeping their SCR, HR files, pay records and audit history stored.</p>
            <label className="dismiss-reason-form">Reason for leaving:
              <select value={dismissReason} onChange={(event) => setDismissReason(event.target.value)}>
                {leavingReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <div className="dismiss-modal-actions">
              <button className="button light" type="button" onClick={() => setDismissTargetId("")}>Cancel</button>
              <button className="button danger" type="button" onClick={dismissStaffMember}>Move to Former Staff</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SchoolsOperations({ data }) {
  const schoolProfiles = [
    {
      name: "Willington Prep",
      area: "Wimbledon",
      provision: ["After-school care", "Holiday camps"],
      times: "After-school 15:30-18:00",
      booking: "Magicbooking",
      manager: "Lindsay",
      note: "Core wraparound site with holiday camp provision and established school routines.",
    },
    {
      name: "King's House School",
      area: "Richmond",
      provision: ["After-school care", "Holiday camps"],
      times: "After-school 15:15-18:00",
      booking: "Magicbooking / camp route",
      manager: "Rama",
      note: "School partnership with a structured after-school offer and camp availability when scheduled.",
    },
    {
      name: "Shrewsbury House School",
      area: "Surbiton",
      provision: ["Breakfast club", "After-school care"],
      times: "Breakfast 07:30-08:00 · After-school 15:00-18:00",
      booking: "Magicbooking",
      manager: "Abi",
      note: "Combined breakfast and after-school provision with clear daily handover routines.",
    },
    {
      name: "Ripley Court School",
      area: "Ripley",
      provision: ["After-school care"],
      times: "After-school 15:00-18:00",
      booking: "Magicbooking",
      manager: "Idy / Wendy",
      note: "After-school provision with named site leadership and cover planning.",
    },
    {
      name: "The Rowans School",
      area: "Wimbledon",
      provision: ["Holiday camps"],
      times: "Camp timings vary by programme",
      booking: "Pebble",
      manager: "Camp lead assigned per camp",
      note: "Holiday camp site used for selected camp dates and seasonal programmes.",
    },
  ];
  const activeSites = schoolProfiles.filter((school) => school.provision.length).length;
  const wraparoundSites = schoolProfiles.filter((school) => school.provision.some((item) => item.toLowerCase().includes("after") || item.toLowerCase().includes("breakfast"))).length;
  const campSites = schoolProfiles.filter((school) => school.provision.some((item) => item.toLowerCase().includes("camp"))).length;

  function assignedStaffFor(siteName) {
    return data.staff.filter((person) => staffAssignedToSchool(person, siteName));
  }

  return (
    <div className="stack schools-operations">
      <div className="toolbar">
        <div>
          <h2>Schools</h2>
          <p className="panel-note">Operational snapshot of each partner school, provision type, booking route and named site leadership.</p>
        </div>
        <Badge value="Internal site directory" />
      </div>
      <div className="hr-summary">
        <Metric icon={<LayoutDashboard />} label="Active school records" value={activeSites} tone="blue" />
        <Metric icon={<Clock />} label="Wraparound sites" value={wraparoundSites} tone="green" />
        <Metric icon={<CalendarDays />} label="Camp sites" value={campSites} tone="amber" />
      </div>
      <section className="schools-directory-grid">
        {schoolProfiles.map((school) => {
          const assigned = assignedStaffFor(school.name);
          return (
            <article className="school-ops-card" key={school.name}>
              <div className="school-ops-head">
                <div>
                  <span>{school.area}</span>
                  <h3>{school.name}</h3>
                </div>
                <Badge value={school.booking} />
              </div>
              <p>{school.note}</p>
              <div className="school-ops-meta">
                <div><span>Provision</span><strong>{school.provision.join(" · ")}</strong></div>
                <div><span>Hours</span><strong>{school.times}</strong></div>
                <div><span>Named manager</span><strong>{school.manager}</strong></div>
                <div><span>Assigned staff</span><strong>{assigned.length}</strong></div>
              </div>
              <div className="school-ops-staff">
                {assigned.slice(0, 5).map((person) => <small key={person.id}>{person.fullName || person.name}</small>)}
                {assigned.length > 5 && <small>+{assigned.length - 5} more</small>}
                {!assigned.length && <small>No staff currently assigned</small>}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

const fallbackHrFileCategories = [
  { id: "contract", name: "Contract", sensitivity: "restricted" },
  { id: "payslip", name: "Payslip", sensitivity: "restricted" },
  { id: "letter", name: "Letter / Communication", sensitivity: "confidential" },
  { id: "disciplinary", name: "Disciplinary", sensitivity: "restricted" },
  { id: "right-to-work", name: "Right to Work", sensitivity: "restricted" },
  { id: "dbs", name: "DBS", sensitivity: "restricted" },
  { id: "training", name: "Training Certificate", sensitivity: "confidential" },
  { id: "id-lanyard", name: "ID / Lanyard", sensitivity: "confidential" },
];

function HRFiles({ data, targetStaffId = "", onTargetHandled }) {
  const [files, setFiles] = useState(data.hrFiles || []);
  const [query, setQuery] = useState("");
  const [staffFilter, setStaffFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sensitivityFilter, setSensitivityFilter] = useState("All");
  const [status, setStatus] = useState("");
  const [storageHealth, setStorageHealth] = useState({ state: hasSupabaseConfig ? "checking" : "local", message: hasSupabaseConfig ? "Checking Supabase Storage..." : "Supabase is not configured for this environment." });
  const categories = data.hrFileCategories?.length ? data.hrFileCategories : fallbackHrFileCategories;
  const staff = data.staff || [];
  const search = query.trim().toLowerCase();
  const selectedStaff = staff.find((person) => person.id === staffFilter) || null;
  const visibleFiles = files.filter((file) => {
    const matchesStaff = staffFilter === "All" || file.staffRecordId === staffFilter;
    const matchesCategory = categoryFilter === "All" || file.category === categoryFilter || staffHrFileBucket(file) === categoryFilter;
    const matchesSensitivity = sensitivityFilter === "All" || file.sensitivity === sensitivityFilter;
    const haystack = [file.staffName, file.staffEmail, file.title, file.category, file.sensitivity, file.notes, file.status].filter(Boolean).join(" ").toLowerCase();
    return matchesStaff && matchesCategory && matchesSensitivity && (!search || haystack.includes(search));
  }).sort((a, b) => String(b.uploadedAt || b.issueDate || "").localeCompare(String(a.uploadedAt || a.issueDate || "")));
  const activeCount = files.filter((file) => file.status !== "archived").length;
  const restrictedCount = files.filter((file) => file.sensitivity === "restricted").length;
  const staffWithFiles = new Set(files.map((file) => file.staffRecordId).filter(Boolean)).size;
  const privateStorageCount = files.filter((file) => file.storagePath && file.storagePath !== "Pending upload").length;
  const missingExpiryCount = files.filter((file) => ["Contracts", "Restricted"].includes(staffHrFileBucket(file)) && !file.expiryDate).length;
  const categoryCards = ["Contracts", "Payslips", "Letters", "Restricted", "Other"].map((bucket) => {
    const bucketFiles = files.filter((file) => staffHrFileBucket(file) === bucket);
    return {
      bucket,
      count: bucketFiles.length,
      restricted: bucketFiles.filter((file) => file.sensitivity === "restricted").length,
      latest: bucketFiles.sort((a, b) => String(b.uploadedAt || b.issueDate || "").localeCompare(String(a.uploadedAt || a.issueDate || "")))[0],
    };
  });

  useEffect(() => {
    setFiles(data.hrFiles || []);
  }, [data.hrFiles]);

  useEffect(() => {
    if (!targetStaffId) return;
    setStaffFilter(targetStaffId);
    onTargetHandled?.();
  }, [targetStaffId, onTargetHandled]);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;
    let active = true;
    loadSupabaseModule()
      .then(({ checkHrFileStorageHealth }) => checkHrFileStorageHealth())
      .then(() => {
        if (active) setStorageHealth({ state: "ready", message: "Private HR file storage is ready." });
      })
      .catch((error) => {
        if (active) setStorageHealth({ state: "failed", message: error.message || "Storage health check failed." });
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveHrFile(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const staffRecordId = String(form.get("staffRecordId") || "");
    const categoryName = String(form.get("category") || "");
    const category = categories.find((item) => item.name === categoryName) || categories[0];
    const person = staff.find((item) => item.id === staffRecordId) || {};
    const uploadFile = form.get("file");
    const hasUploadFile = uploadFile && typeof uploadFile === "object" && uploadFile.name;
    const payload = {
      staffRecordId,
      categoryId: isUuid(category?.id) ? category.id : "",
      category: category?.name || "HR file",
      sensitivity: category?.sensitivity || "confidential",
      title: String(form.get("title") || "").trim() || uploadFile?.name || "",
      fileUrl: String(form.get("fileUrl") || "").trim(),
      storagePath: String(form.get("storagePath") || "").trim(),
      issueDate: String(form.get("issueDate") || ""),
      expiryDate: String(form.get("expiryDate") || ""),
      notes: String(form.get("notes") || "").trim(),
      status: "active",
    };
    if (!payload.staffRecordId || !payload.title) {
      setStatus("Choose a staff member and add a title before saving.");
      return;
    }

    const localRecord = {
      id: `hr-file-${Date.now()}`,
      ...payload,
      staffName: person.name || "Staff member",
      staffEmail: person.email || "",
      uploadedAt: new Date().toISOString(),
      storagePath: hasUploadFile ? "Pending upload" : payload.storagePath,
    };
    setFiles((current) => [localRecord, ...current]);
    setStatus(hasSupabaseConfig ? (hasUploadFile ? "Uploading HR file..." : "Saving HR file...") : "Saved locally for this browser. Connect Supabase to persist.");
    addAuditLog("HR file added", `${localRecord.staffName}: ${payload.title}`);
    event.currentTarget.reset();

    if (!hasSupabaseConfig) return;
    try {
      const { createHrFile, uploadHrFile, notifyPayslipAvailable } = await loadSupabaseModule();
      const saved = hasUploadFile ? await uploadHrFile(payload, uploadFile) : await createHrFile(payload);
      if (/payslip/i.test(payload.category) && !saved.payslipNotification) {
        try {
          saved.payslipNotification = await notifyPayslipAvailable(saved.id);
        } catch (notificationError) {
          saved.payslipNotification = {
            emailed: false,
            emailError: notificationError.message || "Payslip notification failed.",
          };
        }
      }
      setFiles((current) => current.map((file) => file.id === localRecord.id ? saved : file));
      setStatus(saved.payslipNotification
        ? saved.payslipNotification.emailed
          ? "Payslip uploaded and availability email sent."
          : `Payslip uploaded, but its availability email was not sent: ${saved.payslipNotification.emailError || "check email settings"}`
        : hasUploadFile ? "HR file uploaded and saved." : "HR file saved.");
    } catch (error) {
      setFiles((current) => current.map((file) => file.id === localRecord.id ? { ...file, storagePath: "", syncError: error.message || "Save failed" } : file));
      setStatus(error.message || "Supabase could not save this HR file. Check permissions/storage settings.");
    }
  }

  async function archiveFile(file) {
    setFiles((current) => current.filter((item) => item.id !== file.id));
    addAuditLog("HR file archived", `${file.staffName}: ${file.title}`);
    if (!hasSupabaseConfig || String(file.id).startsWith("hr-file-")) {
      setStatus("HR file removed from this view.");
      return;
    }
    try {
      const { archiveHrFile } = await loadSupabaseModule();
      await archiveHrFile(file.id);
      setStatus("HR file archived.");
    } catch (error) {
      setFiles((current) => [file, ...current]);
      setStatus(error.message || "Unable to archive HR file.");
    }
  }

  return (
    <div className="stack hr-files-workspace">
      <div className="toolbar">
        <div>
          <h2>HR Files</h2>
          <p className="panel-note">Store staff HR document metadata for contracts, payslips, letters, disciplinary records and secure compliance files.</p>
        </div>
        <Badge value="Restricted admin area" />
      </div>
      <div className="hr-summary">
        <Metric icon={<FileText />} label="Active files" value={activeCount} tone="blue" />
        <Metric icon={<Users />} label="Staff with files" value={staffWithFiles} tone="green" />
        <Metric icon={<LockKeyhole />} label="Restricted files" value={restrictedCount} tone="amber" />
        <Metric icon={<ShieldCheck />} label="Private uploads" value={privateStorageCount} tone="green" />
      </div>
      <section className={`storage-health ${storageHealth.state}`}>
        <div>
          <strong>{storageHealth.state === "ready" ? "Storage ready" : storageHealth.state === "failed" ? "Storage needs attention" : storageHealth.state === "local" ? "Local mode" : "Checking storage"}</strong>
          <span>{storageHealth.message}</span>
        </div>
        <Badge value={storageHealth.state === "ready" ? "Uploaded files private" : storageHealth.state === "failed" ? "Check Supabase" : "Pending"} />
      </section>
      <section className="hr-vault-board">
        <div className="hr-vault-intro">
          <p className="eyebrow">Document vault</p>
          <h3>{selectedStaff ? `${selectedStaff.name}'s HR file record` : "All retained staff documents"}</h3>
          <p>{selectedStaff ? `${selectedStaff.email || "No email recorded"} · ${staffPrimaryLocation(selectedStaff)} · ${selectedStaff.role || "Role not recorded"}` : "Use this area to see whether contracts, payslips, restricted checks and letters are actually attached to staff records."}</p>
        </div>
        <div className="hr-vault-alerts">
          <article>
            <span>Filtered results</span>
            <strong>{visibleFiles.length}</strong>
            <small>Files currently matching your search and filters.</small>
          </article>
          <article>
            <span>Needs review</span>
            <strong>{missingExpiryCount}</strong>
            <small>Contract or restricted records without an expiry/review date.</small>
          </article>
        </div>
      </section>
      <section className="hr-vault-categories" aria-label="HR file category summary">
        {categoryCards.map((card) => (
          <button key={card.bucket} type="button" className={categoryFilter === card.bucket ? "active" : ""} onClick={() => setCategoryFilter(categoryFilter === card.bucket ? "All" : card.bucket)}>
            <span>{card.bucket}</span>
            <strong>{card.count}</strong>
            <small>{card.latest ? `Latest: ${card.latest.title}` : "No files yet"}{card.restricted ? ` · ${card.restricted} restricted` : ""}</small>
          </button>
        ))}
      </section>
      <section className="hr-file-console">
        <form className="hr-file-form" onSubmit={saveHrFile}>
          <div>
            <p className="eyebrow">Add HR record</p>
            <h3>Upload a document to a staff profile.</h3>
            <p>Files are stored privately in Supabase Storage, with the category, dates and notes kept against the staff record.</p>
          </div>
          <label>Staff member<select name="staffRecordId" defaultValue="">
            <option value="" disabled>Choose staff</option>
            {staff.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}
          </select></label>
          <label>Category<select name="category" defaultValue={categories[0]?.name}>{categories.map((category) => <option key={category.id || category.name}>{category.name}</option>)}</select></label>
          <div className="hr-category-help">
            <span>Category sets sensitivity</span>
            <p>Contracts, payslips and letters are confidential. DBS, right-to-work and disciplinary records should be treated as restricted.</p>
          </div>
          <label>Title<input name="title" placeholder="Signed contract, May payslip, HR letter..." /></label>
          <label>Upload file<input name="file" type="file" accept="application/pdf,.doc,.docx,image/png,image/jpeg,image/webp" /></label>
          <div className="form-two">
            <label>Issue date<input name="issueDate" type="date" /></label>
            <label>Expiry date<input name="expiryDate" type="date" /></label>
          </div>
          <details className="metadata-fallback">
            <summary>Use an existing secure link instead</summary>
            <label>File URL<input name="fileUrl" type="url" placeholder="Optional secure link" /></label>
            <label>Storage path<input name="storagePath" placeholder="Optional Supabase Storage path" /></label>
          </details>
          <label>Notes<textarea name="notes" rows="3" placeholder="Internal note, payroll month, signed date..." /></label>
          <button className="button book" type="submit"><Upload size={18} /> Upload / save HR file</button>
          {status && <p className="panel-note">{status}</p>}
        </form>
        <div className="hr-file-list-panel">
          <div className="hr-files-toolbar">
            <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files or staff" /></label>
            <label>Staff<select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}>
              <option>All</option>
              {staff.map((person) => <option key={person.id} value={person.id}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}
            </select></label>
            <label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option>All</option>
              <option>Contracts</option>
              <option>Payslips</option>
              <option>Letters</option>
              <option>Restricted</option>
              <option>Other</option>
              {categories.map((category) => <option key={category.id || category.name}>{category.name}</option>)}
            </select></label>
            <label>Sensitivity<select value={sensitivityFilter} onChange={(event) => setSensitivityFilter(event.target.value)}>
              <option>All</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select></label>
          </div>
          <div className="hr-file-list">
            {visibleFiles.map((file) => (
              <article className={`hr-file-row ${file.sensitivity === "restricted" ? "restricted" : ""}`} key={file.id}>
                <div className="hr-file-icon"><FileText size={20} /></div>
                <div>
                  <strong>{file.title}</strong>
                  <span>{file.staffName}{file.staffEmail ? ` · ${file.staffEmail}` : ""}</span>
                  <small>{staffHrFileBucket(file)} · {file.issueDate ? `Issued ${formatShortDate(file.issueDate)}` : "Issue date not recorded"}{file.expiryDate ? ` · Review/expiry ${formatShortDate(file.expiryDate)}` : ""}</small>
                  {file.storagePath && <small className="storage-note">{file.storagePath === "Pending upload" ? "Upload pending" : "Private storage file"}</small>}
                  {file.notes && <p>{file.notes}</p>}
                  {file.syncError && <small className="sync-error">{file.syncError}</small>}
                </div>
                <div className="hr-file-actions">
                  <Badge value={hrFileStorageStatus(file)} />
                  <span className={`hr-file-category ${file.sensitivity === "restricted" ? "restricted" : ""}`}>{file.sensitivity === "restricted" ? "Restricted" : "Confidential"}</span>
                  <span className="hr-file-category">{file.category}</span>
                  {file.fileUrl && <a className="button light" href={file.fileUrl} target="_blank" rel="noreferrer">Open file</a>}
                  <button className="button subtle" type="button" onClick={() => archiveFile(file)}>Archive</button>
                </div>
              </article>
            ))}
            {!visibleFiles.length && <EmptyList title="No HR files found" text="Add a document reference or change the filters." />}
          </div>
        </div>
      </section>
    </div>
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function hrFileStorageStatus(file) {
  if (file.syncError) return "Failed";
  if (file.storagePath === "Pending upload") return "Uploading";
  if (file.storagePath && file.fileUrl) return "Uploaded";
  if (file.storagePath) return "Private";
  if (file.fileUrl) return "Linked";
  return "Metadata";
}

function Rota({ data, allData = data, access }) {
  const [assignments, setAssignments] = useState(() => readJson(rotaStorageKey, {}));
  const [moves, setMoves] = useState(() => readJson(coverMoveStorageKey, []));
  const [moveStatus, setMoveStatus] = useState("");
  const staffOptions = data.staff.map((person) => person.name);
  const allStaffOptions = allData.staff.map((person) => person.name);
  const coveredSites = rotaSites.filter((site) => assignments[site.id]?.firstAider && assignments[site.id]?.eyfsLead).length;
  const pendingMoves = moves.filter((move) => !["Sent", "Archived"].includes(move.status)).length;

  function update(siteId, field, value) {
    const site = rotaSites.find((item) => item.id === siteId);
    const next = {
      ...assignments,
      [siteId]: {
        ...assignments[siteId],
        [field]: value,
      },
    };
    localStorage.setItem(rotaStorageKey, JSON.stringify(next));
    setAssignments(next);
    addAuditLog("Rota updated", `${site?.site || siteId}: ${field} set to ${value || "unassigned"}`);
  }

  async function createCoverMove(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const coverStaff = String(form.get("coverStaff") || "");
    const coveredStaff = String(form.get("coveredStaff") || "");
    const siteId = String(form.get("siteId") || "");
    if (coverStaff === coveredStaff) {
      setMoveStatus("Choose two different staff members for a cover move.");
      return;
    }
    const site = rotaSites.find((item) => item.id === siteId);
    const coverPerson = allData.staff.find((person) => person.name === coverStaff) || {};
    const coveredPerson = allData.staff.find((person) => person.name === coveredStaff) || {};
    const coverEmail = coverPerson.email || emailForName(coverStaff);
    const coveredEmail = coveredPerson.email || emailForName(coveredStaff);
    const record = {
      id: `move-${Date.now()}`,
      coverStaff,
      coveredStaff,
      siteId,
      siteName: site?.site || "Selected site",
      sessionType: site?.type || "Session",
      sessionTime: site ? `${site.sessionStart}-${site.sessionEnd}` : "Session time TBC",
      address: site?.address || "Location details TBC",
      mapUrl: site?.mapUrl || "",
      date: form.get("date") || "Next session",
      reason: form.get("reason") || "Cover",
      notes: form.get("notes") || "",
      coverEmail,
      coveredEmail,
      createdAt: new Date().toISOString(),
      status: hasSupabaseConfig ? "Sending" : "Local preview",
    };
    const next = [record, ...moves].slice(0, 12);
    setMoves(next);
    localStorage.setItem(coverMoveStorageKey, JSON.stringify(next));
    addAuditLog("Cover move queued", `${coverStaff} covering ${coveredStaff} at ${record.siteName}`);
    setMoveStatus(hasSupabaseConfig ? "Sending cover emails..." : "Local email previews queued. Configure Supabase to send live emails.");
    event.currentTarget.reset();
    if (!hasSupabaseConfig) return;

    try {
      const { sendCoverMoveNotifications } = await loadSupabaseModule();
      await sendCoverMoveNotifications(record);
      updateCoverMove(record.id, { status: "Sent", sentAt: new Date().toISOString() }, setMoves);
      setMoveStatus("Cover emails sent and logged.");
      addAuditLog("Cover emails sent", `${coverStaff} and ${coveredStaff} notified for ${record.siteName}`);
    } catch (error) {
      updateCoverMove(record.id, { status: "Send failed", error: error.message || "Email function failed" }, setMoves);
      setMoveStatus("Cover email send failed. The move is still saved for follow-up.");
      addAuditLog("Cover email failed", `${coverStaff} cover at ${record.siteName}`);
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Staff Rota</h2>
          <p className="panel-note">Each school/day should have a first aider and a Level 3 or higher EYFS lead assigned.{access?.isScoped ? " Staff selectors are limited to your direct reports." : ""}</p>
        </div>
      </div>
      <div className="hr-summary">
        <Metric icon={<ShieldCheck />} label="Covered sites" value={`${coveredSites}/${rotaSites.length}`} tone={coveredSites === rotaSites.length ? "green" : "amber"} />
        <Metric icon={<Users />} label="Available staff" value={staffOptions.length} tone="blue" />
        <Metric icon={<Mail />} label="Pending cover notices" value={pendingMoves} tone={pendingMoves ? "amber" : "green"} />
      </div>
      <section className="cover-move-panel">
        <div>
          <p className="eyebrow">Cover workflow</p>
          <h3>Move staff between sites</h3>
          <p className="panel-note">Queue a professional cover notice to the flexible staff member and to the person being covered. Site location details are included automatically.</p>
        </div>
        <form className="compact-form" onSubmit={createCoverMove}>
          <label>Covering staff<select required name="coverStaff"><option value="">Choose staff</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
          <label>Person being covered<select required name="coveredStaff"><option value="">Choose staff</option>{allStaffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
          <label>Moved to site<select required name="siteId"><option value="">Choose site</option>{rotaSites.map((site) => <option key={site.id} value={site.id}>{site.site} · {site.type}</option>)}</select></label>
          <label>Date<input name="date" type="date" /></label>
          <label>Reason<select name="reason">{coverReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
          <label className="full">Notes<input name="notes" placeholder="Optional context for the cover move" /></label>
          <button className="button book" type="submit">Queue Cover Emails</button>
          {moveStatus && <p className="success full">{moveStatus}</p>}
        </form>
      </section>
      {!staffOptions.length && <EmptyList title="No staff in scope" text="Your current manager scope has no direct reports to assign." />}
      {!!moves.length && (
        <div className="cover-email-grid">
          {moves.slice(0, 2).map((move) => (
            <article className="email-preview" key={move.id}>
              <div className="crm-card-head">
                <div>
                  <span>{move.status}</span>
                  <h3>{move.coverStaff} to {move.siteName}</h3>
                  <p>{move.date} · {move.sessionTime} · covering {move.coveredStaff}</p>
                </div>
                <Badge value={move.status} />
              </div>
              <div>
                <strong>To {move.coverEmail}</strong>
                <p>Thank you for your flexibility whilst covering at {move.siteName}. You are covering {move.coveredStaff} for the {move.sessionType.toLowerCase()} session at {move.address}. {move.mapUrl ? "A location link will be included." : ""}</p>
              </div>
              <div>
                <strong>To {move.coveredEmail}</strong>
                <p>{move.coverStaff} has been assigned to cover your session at {move.siteName}. The rota has been updated so the team has the latest cover information.</p>
              </div>
              {move.error && <small className="platform-warning">{move.error}</small>}
            </article>
          ))}
        </div>
      )}
      {!!moves.length && (
        <Panel title="Cover Move History">
          <TableWrap>
            <table>
              <thead><tr><th>Date</th><th>Covering</th><th>Covered</th><th>Site</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>{moves.map((move) => (
                <tr key={move.id}>
                  <td>{move.date || "Next session"}</td>
                  <td>{move.coverStaff}</td>
                  <td>{move.coveredStaff}</td>
                  <td>{move.siteName}</td>
                  <td>{move.reason || "Cover"}</td>
                  <td><Badge value={move.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
      <div className="rota-grid">
        {rotaSites.map((site) => {
          const assignment = assignments[site.id] || {};
          const start = addMinutes(site.sessionStart, -site.setupMinutes);
          const finish = addMinutes(site.sessionEnd, site.cleanupMinutes);
          return (
            <article className="rota-card" key={site.id}>
              <div className="crm-card-head">
                <div>
                  <span>{site.type}</span>
                  <h3>{site.site}</h3>
                  <p>{start}-{finish} incl. setup/cleanup · session {site.sessionStart}-{site.sessionEnd}</p>
                </div>
                <Badge value={assignment.firstAider && assignment.eyfsLead ? "Covered" : "Needs cover"} />
              </div>
              <div className="crm-controls">
                <label>Lead staff<select value={assignment.lead || ""} onChange={(event) => update(site.id, "lead", event.target.value)}><option value="">Unassigned</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
                <label>Support staff<select value={assignment.support || ""} onChange={(event) => update(site.id, "support", event.target.value)}><option value="">Unassigned</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
                <label>First aider<select value={assignment.firstAider || ""} onChange={(event) => update(site.id, "firstAider", event.target.value)}><option value="">Required</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
                <label>Level 3+ EYFS<select value={assignment.eyfsLead || ""} onChange={(event) => update(site.id, "eyfsLead", event.target.value)}><option value="">Required</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></label>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function HoursTracker({ data, access }) {
  const isAdmin = ["Admin", "Superadmin"].includes(access?.role);
  const usingSupabase = String(data.source || "").startsWith("Supabase");
  const canonicalRotaSites = Array.from(new Set(rotaSites.map((site) => canonicalSchoolName(site.site))));
  const savedPayrollSites = Object.values(data.payrollHours || {})
    .flatMap((periodRecords) => Object.keys(periodRecords || {}).map(canonicalSchoolName));
  const schoolOptions = Array.from(new Set([...canonicalRotaSites, ...savedPayrollSites]))
    .filter((site) => !["Admin", "Manager", "Staff", "Superadmin"].includes(site))
    .sort(sortPayrollSites);
  const [period, setPeriod] = useState(currentPayrollPeriod());
  const [school, setSchool] = useState(schoolOptions[0] || "");
  const [records, setRecords] = useState(() => mergePayrollHourRecords(usingSupabase ? (data.payrollHours || {}) : {}, readJson(payrollHoursStorageKey, {})));
  const [syncStatus, setSyncStatus] = useState("");
  const remoteSaveRef = useRef({ timer: null, token: 0 });
  const selectedRecord = records[period]?.[school] || { rows: [], status: "Draft" };
  const staffOptions = data.staff
    .map((person) => ({ ...person, assignedHere: staffAssignedToSchool(person, school) }))
    .sort((a, b) => Number(b.assignedHere) - Number(a.assignedHere) || String(a.name || "").localeCompare(String(b.name || "")));
  const enteredRows = selectedRecord.rows || [];
  const hasIncompletePayrollRows = enteredRows.some((row) => !isUuid(row.staffId));
  const canUnlockPayroll = access?.role === "Superadmin";
  const schoolLocked = selectedRecord.status === "Approved";
  const totalHours = enteredRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const totalGross = enteredRows.reduce((sum, row) => {
    const person = data.staff.find((staff) => staff.id === row.staffId || staff.profileId === row.staffId);
    return sum + Number(row.hours || 0) * Number(row.rate ?? person?.payRate ?? 0);
  }, 0);
  const periodRecords = Object.values(records[period] || {});
  const payrollReviewRows = schoolOptions.map((site) => {
    const record = records[period]?.[site];
    const rows = record?.rows || [];
    const hours = rows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const gross = rows.reduce((sum, row) => {
      const person = data.staff.find((staff) => staff.id === row.staffId || staff.profileId === row.staffId);
      return sum + Number(row.hours || 0) * Number(row.rate ?? person?.payRate ?? 0);
    }, 0);
    return {
      school: site,
      status: payrollRecordStatus(record),
      rows,
      staffCount: rows.length,
      hours,
      gross,
      updatedAt: record?.updatedAt || "",
      submittedAt: record?.submittedAt || "",
    };
  });
  const periodSubmitted = payrollReviewRows.filter((record) => ["Submitted", "Approved"].includes(record.status)).length;
  const periodApproved = payrollReviewRows.filter((record) => record.status === "Approved").length;
  const periodTotalHours = payrollReviewRows.reduce((sum, record) => sum + record.hours, 0);
  const periodTotalGross = payrollReviewRows.reduce((sum, record) => sum + record.gross, 0);

  useEffect(() => {
    if (schoolOptions.length && !schoolOptions.includes(school)) setSchool(schoolOptions[0]);
  }, [school, schoolOptions]);

  useEffect(() => {
    if (usingSupabase) setRecords(mergePayrollHourRecords(data.payrollHours || {}, readJson(payrollHoursStorageKey, {})));
  }, [data.payrollHours, usingSupabase]);

  useEffect(() => () => {
    if (remoteSaveRef.current.timer) clearTimeout(remoteSaveRef.current.timer);
  }, []);

  function saveRecord(nextRecord, action = "Payroll hours updated", options = {}) {
    const { debounce = false } = options;
    const recordToSave = {
      ...nextRecord,
      localDraft: usingSupabase,
      updatedAt: new Date().toISOString(),
      updatedBy: access?.currentUser?.email || access?.currentUser?.name || "Admin",
    };
    const next = {
      ...records,
      [period]: {
        ...(records[period] || {}),
        [school]: recordToSave,
      },
    };
    localStorage.setItem(payrollHoursStorageKey, JSON.stringify(next));
    setRecords(next);
    addAuditLog(action, `${formatPayrollPeriod(period)} · ${school}`);
    if (!usingSupabase) return;
    if ((recordToSave.rows || []).some((row) => !isUuid(row.staffId))) {
      setSyncStatus("Saved locally · choose staff before syncing to Supabase");
      return;
    }
    const saveToken = remoteSaveRef.current.token + 1;
    remoteSaveRef.current.token = saveToken;
    if (remoteSaveRef.current.timer) clearTimeout(remoteSaveRef.current.timer);
    const remoteSave = () => {
      setSyncStatus("Saving to Supabase...");
      loadSupabaseModule()
      .then(({ savePayrollHourRecord }) => savePayrollHourRecord({ period, school, record: recordToSave, action }))
      .then((savedRecord) => {
        if (remoteSaveRef.current.token !== saveToken) return;
        const cleanSavedRecord = { ...savedRecord, localDraft: false, syncedAt: new Date().toISOString() };
        setRecords((current) => {
          const currentRecord = current?.[period]?.[school];
          if (currentRecord?.updatedAt && currentRecord.updatedAt !== recordToSave.updatedAt) return current;
          const nextRecords = {
            ...current,
            [period]: {
              ...(current[period] || {}),
              [school]: cleanSavedRecord,
            },
          };
          localStorage.setItem(payrollHoursStorageKey, JSON.stringify(nextRecords));
          return nextRecords;
        });
        setSyncStatus("Saved to Supabase");
      })
      .catch((error) => {
        if (remoteSaveRef.current.token !== saveToken) return;
        setSyncStatus(`Supabase save failed: ${error.message || "check SQL permissions"}`);
      });
    };
    if (debounce) {
      setSyncStatus("Saved locally · syncing shortly");
      remoteSaveRef.current.timer = setTimeout(remoteSave, 700);
    } else {
      remoteSave();
    }
  }

  function addStaffRow(staffId = "") {
    if (schoolLocked) return;
    const person = staffOptions.find((staff) => staff.id === staffId || staff.profileId === staffId);
    const nextRow = {
      id: `hours-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      staffId: person?.id || "",
      staffName: person?.name || "",
      hours: "",
      rate: Number(person?.payRate || 0),
      notes: "",
    };
    saveRecord({ ...selectedRecord, rows: [...enteredRows, nextRow] }, "Payroll staff row added", { debounce: true });
  }

  function updateRow(rowId, patch) {
    if (schoolLocked) return;
    const nextRows = enteredRows.map((row) => {
      if (row.id !== rowId) return row;
      const staffId = patch.staffId !== undefined ? patch.staffId : row.staffId;
      const person = data.staff.find((staff) => staff.id === staffId || staff.profileId === staffId);
      return {
        ...row,
        ...patch,
        staffName: patch.staffId !== undefined ? (person?.name || "") : (person?.name || row.staffName),
        rate: patch.rate !== undefined
          ? Number(patch.rate || 0)
          : patch.staffId !== undefined
            ? Number(person?.payRate || 0)
            : Number(row.rate ?? person?.payRate ?? 0),
      };
    });
    saveRecord({ ...selectedRecord, rows: nextRows }, "Payroll hours autosaved", { debounce: true });
  }

  function removeRow(rowId) {
    if (schoolLocked) return;
    saveRecord({ ...selectedRecord, rows: enteredRows.filter((row) => row.id !== rowId) }, "Payroll staff row removed", { debounce: true });
  }

  function submitMonth() {
    if (schoolLocked) return;
    saveRecord({
      ...selectedRecord,
      rows: enteredRows.map((row) => ({ ...row, hours: Number(row.hours || 0) })),
      status: "Submitted",
      submittedAt: new Date().toISOString(),
      submittedBy: access?.currentUser?.email || access?.currentUser?.name || "Admin",
    }, "Payroll month submitted");
  }

  function approveSchoolMonth() {
    if (schoolLocked) return;
    saveRecord({
      ...selectedRecord,
      rows: enteredRows.map((row) => ({ ...row, hours: Number(row.hours || 0) })),
      status: "Approved",
      approvedAt: new Date().toISOString(),
      approvedBy: access?.currentUser?.email || access?.currentUser?.name || "Admin",
    }, "Payroll school month approved");
  }

  function unlockSchoolMonth() {
    if (!canUnlockPayroll || !schoolLocked) return;
    saveRecord({
      ...selectedRecord,
      status: "Submitted",
      unlockedAt: new Date().toISOString(),
      unlockedBy: access?.currentUser?.email || access?.currentUser?.name || "Superadmin",
    }, "Payroll school month unlocked");
  }

  if (!isAdmin) {
    return (
      <Panel title="Hours Tracker">
        <p className="panel-note">Payroll hours are managed by admin only because they create the monthly salary record. Staff can see their own approved hours and pay on the Pay page.</p>
      </Panel>
    );
  }

  return (
    <div className="stack payroll-console">
      <div className="toolbar">
        <div>
          <h2>Monthly Hours</h2>
          <p className="panel-note">Select a month and school, add the staff who worked there, then enter the exact paid hours for payroll. Submitted months stay editable.</p>
        </div>
        <div className="payroll-toolbar">
          <label>Month<input type="month" value={period} onChange={(event) => setPeriod(event.target.value || currentPayrollPeriod())} /></label>
          <label>School<select value={school} onChange={(event) => setSchool(event.target.value)}>{schoolOptions.map((site) => <option key={site}>{site}</option>)}</select></label>
        </div>
      </div>
      <div className="hr-summary">
        <Metric icon={<Clock />} label="Month hours" value={periodTotalHours.toFixed(2)} tone={periodTotalHours ? "green" : "amber"} />
        <Metric icon={<PoundSterling />} label="Month gross" value={formatCurrency(periodTotalGross)} tone="green" />
        <Metric icon={<Users />} label="Selected school staff" value={enteredRows.length} tone="blue" />
        <Metric icon={<ClipboardCheck />} label="Submitted sites" value={`${periodSubmitted}/${schoolOptions.length || 0}`} tone={periodSubmitted ? "blue" : "amber"} />
      </div>
      <Panel title={`${formatPayrollPeriod(period)} Site Review`}>
        <div className="payroll-review-grid">
          {payrollReviewRows.map((record) => (
            <button className={`payroll-review-card ${record.school === school ? "active" : ""}`} type="button" key={record.school} onClick={() => setSchool(record.school)}>
              <span>{record.school}</span>
              <Badge value={record.status} />
              <strong>{record.hours.toFixed(2)} hrs · {formatCurrency(record.gross)}</strong>
              <small>{record.staffCount ? `${record.staffCount} staff on record` : "No staff added yet"}</small>
            </button>
          ))}
        </div>
        <p className="panel-note">{periodApproved}/{schoolOptions.length || 0} sites approved. Use each card to check the school month before approving the payroll run.</p>
      </Panel>
      <PayrollAuditTrail
        events={data.payrollAudit}
        period={period}
        school={school}
        title={`${formatPayrollPeriod(period)} Payroll Audit`}
      />
      <Panel title={`${school || "School"} · ${formatPayrollPeriod(period)}`}>
        <div className="payroll-record-head">
          <div>
            <Badge value={selectedRecord.status || "Draft"} />
            {selectedRecord.localDraft && <Badge value="Local draft" />}
            {selectedRecord.source === "supabase" && !selectedRecord.localDraft && <Badge value="Synced" />}
            {selectedRecord.submittedAt && <small>Submitted {formatShortDate(selectedRecord.submittedAt)} by {selectedRecord.submittedBy || "admin"}</small>}
            {schoolLocked && <small>Approved records are locked for payroll. {canUnlockPayroll ? "Unlock this school to make a correction." : "Ask a Superadmin to unlock corrections."}</small>}
            {hasIncompletePayrollRows && <small>Choose a staff member for every payroll row before submitting or syncing to Supabase.</small>}
            {syncStatus && <small>{syncStatus}</small>}
          </div>
          <div className="payroll-submit-actions">
            {canUnlockPayroll && schoolLocked && <button className="button subtle" type="button" onClick={unlockSchoolMonth}>Unlock school</button>}
            <button className="button light" type="button" onClick={() => addStaffRow()} disabled={schoolLocked}>Add staff member</button>
          </div>
        </div>
        <TableWrap>
          <table>
            <thead><tr><th>Staff member</th><th>Usual site</th><th>Paid hours this month</th><th>Rate</th><th>Gross</th><th>Notes</th><th>Action</th></tr></thead>
            <tbody>
              {enteredRows.length ? enteredRows.map((row) => {
                const person = data.staff.find((staff) => staff.id === row.staffId || staff.profileId === row.staffId);
                const rate = Number(row.rate ?? person?.payRate ?? 0);
                const gross = Number(row.hours || 0) * rate;
                return (
                  <tr key={row.id}>
                    <td>
                      <select value={row.staffId || ""} onChange={(event) => updateRow(row.id, { staffId: event.target.value })} disabled={schoolLocked}>
                        <option value="">Select staff member</option>
                        {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staffOptionLabel(staff)}{staff.assignedHere ? "" : " · cover"}</option>)}
                      </select>
                    </td>
                    <td>{person ? staffPrimaryLocation(person) : "Choose staff"}</td>
                    <td><input type="number" min="0" step="0.25" value={row.hours} onChange={(event) => updateRow(row.id, { hours: event.target.value })} aria-label={`${person?.name || row.staffName || "staff"} paid hours`} disabled={schoolLocked} /></td>
                    <td><input type="number" min="0" step="0.01" value={row.rate ?? rate} onChange={(event) => updateRow(row.id, { rate: event.target.value })} aria-label={`${person?.name || row.staffName || "staff"} hourly rate`} disabled={schoolLocked} /></td>
                    <td><strong>{formatCurrency(gross)}</strong></td>
                    <td><input type="text" value={row.notes || ""} onChange={(event) => updateRow(row.id, { notes: event.target.value })} placeholder="Optional note" disabled={schoolLocked} /></td>
                    <td><button className="button subtle" type="button" onClick={() => removeRow(row.id)} disabled={schoolLocked}>Remove</button></td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="7"><strong>No staff added yet.</strong> Add the staff who worked at this school for {formatPayrollPeriod(period)}.</td></tr>
              )}
            </tbody>
          </table>
        </TableWrap>
        <div className="payroll-submit-row">
          <p>Submitting creates the monthly hours record used by payroll. Approving confirms this school is ready for the monthly payroll run.</p>
          <div className="payroll-submit-actions">
            <button className="button light" type="button" onClick={submitMonth} disabled={!enteredRows.length || schoolLocked || hasIncompletePayrollRows}>Submit month</button>
            <button className="button primary" type="button" onClick={approveSchoolMonth} disabled={!enteredRows.length || schoolLocked || hasIncompletePayrollRows}>Approve school</button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SCR({ data, access, targetStaffId, inspectionSchoolTarget = "", onInspectionTargetHandled, onTargetHandled, onUpdateStaffPay, onOpenHrFiles, onOpenPay }) {
  const [checklistState, setChecklistState] = useState(() => readScrChecklistState());
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const [evidenceFilter, setEvidenceFilter] = useState("Action needed");
  const [profileTargetId, setProfileTargetId] = useState("");
  const [siteFocusMode, setSiteFocusMode] = useState(false);
  const [siteBlockersOnly, setSiteBlockersOnly] = useState(false);
  const [assignmentState, setAssignmentState] = useState(() => Object.fromEntries(
    data.staff.map((person) => [person.id, staffAssignments(person)]),
  ));
  const assignmentSchools = Array.from(new Set([
    ...rotaSites.map((site) => site.site),
    ...data.staff.flatMap((person) => staffSchoolNames({ ...person, siteAssignments: assignmentState[person.id] || staffAssignments(person) })),
  ].filter(Boolean)));
  const staffWithAssignments = data.staff.map((person) => ({
    ...person,
    siteAssignments: assignmentState[person.id] || staffAssignments(person),
    dbsNumber: checklistState[person.id]?.dbsNumber
      || checklistState[person.id]?.evidence?.dbs?.number
      || checklistState[person.id]?.evidence?.dbs?.dbsNumber
      || person.dbsNumber
      || person.scrChecklist?.dbsNumber
      || person.scrChecklist?.evidence?.dbs?.number
      || person.scrChecklist?.evidence?.dbs?.dbsNumber
      || "",
    scrChecklist: {
      ...(person.scrChecklist || {}),
      ...(checklistState[person.id] || {}),
      evidence: {
        ...(person.scrChecklist?.evidence || {}),
        ...(checklistState[person.id]?.evidence || {}),
      },
    },
    ...(checklistState[person.id]?.approvedAt
      ? { compliance: "Compliant", onboardingStatus: "SCR approved" }
      : {}),
  }));
  const scrData = { ...data, staff: staffWithAssignments };
  const activeScrStaff = scrData.staff.filter((person) => !isFormerStaffRecord(person));
  const issueDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const [summaryStaffId, setSummaryStaffId] = useState(data.staff[0]?.id || "");
  const schoolOptions = [...assignmentSchools].sort(sortPayrollSites);
  const [selectedScrSchool, setSelectedScrSchool] = useState(schoolOptions[0] || "");
  const selectedSchoolStaff = selectedScrSchool
    ? activeScrStaff.filter((person) => staffAssignedToSchool(person, selectedScrSchool))
    : activeScrStaff;
  const totalStaff = selectedSchoolStaff.length;
  const compliantStaff = selectedSchoolStaff.filter((person) => person.compliance === "Compliant").length;
  const reviewStaff = Math.max(totalStaff - compliantStaff, 0);
  const completion = totalStaff ? Math.round((compliantStaff / totalStaff) * 100) : 100;
  const samplePerson = selectedSchoolStaff.find((person) => person.id === summaryStaffId) || selectedSchoolStaff[0] || {};
  const [assuranceSchool, setAssuranceSchool] = useState(schoolOptions[0] || "Partner School");
  const [includeEvidenceAppendix, setIncludeEvidenceAppendix] = useState(false);
  const assuranceStaff = activeScrStaff.filter((person) => staffAssignedToSchool(person, assuranceSchool));
  const selectedAssuranceStaff = assuranceStaff;
  const assuranceStatements = [
    "Enhanced DBS details, barred list checks and update-service status are recorded against each staff member.",
    "Right to work, identity checks and proof-of-address evidence can be tracked with verifier and review dates.",
    "Safeguarding, KCSIE, company policy and allergy-awareness training are monitored with completion evidence.",
    "First aid is tracked by qualification, role and site requirement, with expiry dates where applicable.",
    "References, employment gaps, overseas checks and qualification evidence are captured for safer recruitment.",
    "Annual medical, criminal and childcare disqualification declarations are prompted and reconfirmed digitally.",
  ];
  const onboardingProfiles = selectedSchoolStaff.filter((person) => person.onboardingStatus);
  const renewalItems = buildScrRenewalItems(selectedSchoolStaff);
  const evidenceWorkflowItems = buildEvidenceWorkflowItems(selectedSchoolStaff, renewalItems, renewalRequests);
  const submittedEvidence = buildSubmittedEvidenceReviews(selectedSchoolStaff, renewalRequests);
  const [ofstedLogs] = useState(() => readJson(ofstedLogsStorageKey, []));
  useEffect(() => {
    if (!data.scrRenewalRequests || !Object.keys(data.scrRenewalRequests).length) return;
    setRenewalRequests((current) => ({ ...current, ...data.scrRenewalRequests }));
  }, [data.scrRenewalRequests]);
  useEffect(() => {
    if (!schoolOptions.length) return;
    if (!selectedScrSchool || !schoolOptions.includes(selectedScrSchool)) {
      setSelectedScrSchool(schoolOptions[0]);
    }
    if (!schoolOptions.includes(assuranceSchool)) {
      setAssuranceSchool(schoolOptions[0]);
    }
  }, [assuranceSchool, schoolOptions, selectedScrSchool]);
  useEffect(() => {
    if (!targetStaffId) return;
    const targetPerson = activeScrStaff.find((person) => person.id === targetStaffId);
    const targetSchool = staffSchoolNames(targetPerson)[0];
    if (targetSchool && targetSchool !== selectedScrSchool) {
      setSelectedScrSchool(targetSchool);
      setAssuranceSchool(targetSchool);
    }
  }, [activeScrStaff, selectedScrSchool, targetStaffId]);
  useEffect(() => {
    if (!inspectionSchoolTarget || !schoolOptions.length) return;
    const targetSchool = schoolOptions.find((school) => canonicalSchoolName(school) === canonicalSchoolName(inspectionSchoolTarget));
    if (targetSchool) {
      selectInspectionSchool(targetSchool);
    }
    onInspectionTargetHandled?.();
  }, [inspectionSchoolTarget, onInspectionTargetHandled, schoolOptions]);
  useEffect(() => {
    if (selectedSchoolStaff.some((person) => person.id === summaryStaffId)) return;
    setSummaryStaffId(selectedSchoolStaff[0]?.id || "");
  }, [selectedSchoolStaff, summaryStaffId]);
  function selectInspectionSchool(school) {
    setSelectedScrSchool(school);
    setAssuranceSchool(school);
    const nextStaff = activeScrStaff.find((person) => staffAssignedToSchool(person, school));
    setSummaryStaffId(nextStaff?.id || "");
  }
  function updateAssignment(staffId, index, patch) {
    if (isFormerStaffRecord(scrData.staff.find((person) => person.id === staffId))) return;
    setAssignmentState((current) => {
      const assignments = [...(current[staffId] || [])];
      assignments[index] = { ...assignments[index], ...patch };
      return { ...current, [staffId]: assignments };
    });
  }
  function addAssignment(staffId) {
    if (isFormerStaffRecord(scrData.staff.find((person) => person.id === staffId))) return;
    setAssignmentState((current) => {
      const assignments = current[staffId] || [];
      const staffPerson = scrData.staff.find((person) => person.id === staffId);
      return {
        ...current,
        [staffId]: [...assignments, { school: assignmentSchools[0] || "New site", role: staffPerson?.role || "Staff", startDate: "", endDate: "", status: "Active" }],
      };
    });
  }
  function removeAssignment(staffId, index) {
    if (isFormerStaffRecord(scrData.staff.find((person) => person.id === staffId))) return;
    setAssignmentState((current) => ({
      ...current,
      [staffId]: (current[staffId] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }
  function updateChecklist(staffId, patch) {
    const staffPerson = scrData.staff.find((person) => person.id === staffId);
    if (isFormerStaffRecord(staffPerson)) return;
    setChecklistState((current) => {
      const remoteChecklist = staffPerson?.scrChecklist || {};
      const next = {
        ...current,
        [staffId]: {
          ...remoteChecklist,
          ...current[staffId],
          ...patch,
          evidence: {
            ...(remoteChecklist.evidence || {}),
            ...(current[staffId]?.evidence || {}),
            ...(patch.evidence || {}),
          },
          updatedAt: new Date().toISOString(),
        },
      };
      saveScrChecklistState(next);
      persistScrChecklistRecord(staffId, next[staffId]);
      return next;
    });
    addAuditLog("SCR checklist updated", `${staffPerson?.name || staffId}: ${Object.keys(patch).join(", ")}${staffPerson?.email ? ` · ${staffPerson.email}` : ""}`);
  }
  function applyDbsDisclosureNumber(result) {
    const person = result?.person;
    const row = result?.row;
    if (!person?.id || !row?.certificateNo || isFormerStaffRecord(person)) return;
    const currentProfile = checklistState[person.id] || person.scrChecklist || {};
    const currentEvidence = currentProfile.evidence || {};
    const nextChecklist = {
      ...currentProfile,
      dbs: true,
      dbsNumber: row.certificateNo,
      evidence: {
        ...currentEvidence,
        dbs: {
          ...(currentEvidence.dbs || {}),
          status: "Approved",
          number: row.certificateNo,
          dbsNumber: row.certificateNo,
          certificateNo: row.certificateNo,
          applicationRef: row.applicationRef,
          issueDate: row.issueDate,
          reference: "Disclosure Results 27 June 2026",
          verifiedAt: new Date().toISOString(),
          verifiedBy: access?.currentUser?.name || "Admin",
          sourceSurname: row.surname,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    setChecklistState((current) => {
      const next = { ...current, [person.id]: nextChecklist };
      saveScrChecklistState(next);
      return next;
    });
    persistScrChecklistRecord(person.id, nextChecklist, "DBS disclosure number applied");
    addAuditLog("DBS disclosure number applied", `${person.name}: ${row.certificateNo}`);
  }
  function approveScrProfile(staffId) {
    const person = scrData.staff.find((item) => item.id === staffId);
    if (isFormerStaffRecord(person)) return;
    setChecklistState((current) => {
      const remoteChecklist = person?.scrChecklist || {};
      const next = {
        ...current,
        [staffId]: {
          ...remoteChecklist,
          ...current[staffId],
          approvedAt: new Date().toISOString(),
          approvedBy: "Admin",
          updatedAt: new Date().toISOString(),
        },
      };
      saveScrChecklistState(next);
      persistScrChecklistRecord(staffId, next[staffId], "SCR profile approval synced");
      return next;
    });
    approveOnboardedStaffProfile(staffId);
    addAuditLog("SCR profile approved", `${person?.name || staffId} marked compliant`);
  }
  function saveRenewalRequests(next) {
    setRenewalRequests(next);
    localStorage.setItem(scrRenewalRequestsStorageKey, JSON.stringify(next));
  }
  function requestProfileEvidence(person, evidenceKey, note = "") {
    if (isFormerStaffRecord(person)) return;
    const id = `${person.id}-${evidenceKey}`;
    const check = scrEvidenceLabel(evidenceKey);
    const requestNote = note.trim() || `${check} evidence requested from staff profile.`;
    const next = {
      ...renewalRequests,
      [id]: appendScrRequestHistory({
        ...(renewalRequests[id] || {}),
        status: "Requested",
        requestedAt: new Date().toISOString(),
        requestedBy: access?.currentUser?.name || "Admin",
        note: requestNote,
      }, "Requested", access?.currentUser?.name || "Admin", requestNote),
    };
    saveRenewalRequests(next);
    persistScrEvidenceRequestRecord(id, person.id, evidenceKey, next[id]);
    addAuditLog("SCR evidence requested", `${person.name}: ${check}`);
  }
  function clearProfileEvidenceRequest(request) {
    const person = scrData.staff.find((item) => item.id === request.staffId);
    if (isFormerStaffRecord(person)) return;
    const next = {
      ...renewalRequests,
      [request.id]: appendScrRequestHistory({
        ...(renewalRequests[request.id] || {}),
        status: "Cleared",
        clearedAt: new Date().toISOString(),
        clearedBy: access?.currentUser?.name || "Admin",
      }, "Cleared", access?.currentUser?.name || "Admin", "Admin cleared this evidence request from the staff profile."),
    };
    saveRenewalRequests(next);
    persistScrEvidenceRequestRecord(request.id, request.staffId, request.evidenceKey, next[request.id], "SCR evidence request cleared");
    addAuditLog("SCR evidence request cleared", `${person?.name || request.staffId}: ${request.check}${person?.email ? ` · ${person.email}` : ""}`);
  }
  function markProfileEvidenceChecked(person, evidenceKey, label = "") {
    if (isFormerStaffRecord(person)) return;
    const requestId = `${person.id}-${evidenceKey}`;
    const currentProfile = checklistState[person.id] || person.scrChecklist || {};
    const currentEvidence = currentProfile.evidence || {};
    const evidence = currentEvidence[evidenceKey] || {};
    const nextChecklist = {
      ...currentProfile,
      evidence: {
        ...currentEvidence,
        [evidenceKey]: {
          ...evidence,
          status: "Approved",
          reviewedAt: new Date().toISOString(),
          reviewedBy: access?.currentUser?.name || "Admin",
          verifiedBy: access?.currentUser?.name || evidence.verifiedBy || "Admin",
          dateSeen: new Date().toISOString().slice(0, 10),
        },
      },
      updatedAt: new Date().toISOString(),
    };
    const nextChecklistState = {
      ...checklistState,
      [person.id]: nextChecklist,
    };
    setChecklistState(nextChecklistState);
    saveScrChecklistState(nextChecklistState);
    persistScrChecklistRecord(person.id, nextChecklist, "SCR evidence marked checked");

    if (renewalRequests[requestId] && renewalRequests[requestId].status !== "Cleared") {
      const nextRequests = {
        ...renewalRequests,
        [requestId]: appendScrRequestHistory({
          ...(renewalRequests[requestId] || {}),
          status: "Approved",
          reviewedAt: new Date().toISOString(),
          reviewedBy: access?.currentUser?.name || "Admin",
          rejectionReason: "",
        }, "Approved", access?.currentUser?.name || "Admin", "Evidence checked from staff profile."),
      };
      saveRenewalRequests(nextRequests);
      persistScrEvidenceRequestRecord(requestId, person.id, evidenceKey, nextRequests[requestId], "SCR evidence marked checked request synced");
    }
    addAuditLog("SCR evidence marked checked", `${person.name}: ${label || scrEvidenceLabel(evidenceKey)}`);
  }
  function reviewSubmittedEvidence(item, decision, note = "") {
    if (isFormerStaffRecord(scrData.staff.find((person) => person.id === item.staffId))) return;
    const rejectionReason = note.trim() || "Please check the evidence reference, date or document and resubmit for review.";
    const currentProfile = checklistState[item.staffId] || scrData.staff.find((person) => person.id === item.staffId)?.scrChecklist || {};
    const currentEvidence = currentProfile.evidence || {};
    const nextChecklistState = {
      ...checklistState,
      [item.staffId]: {
        ...currentProfile,
        evidence: {
          ...currentEvidence,
          [item.evidenceKey]: {
            ...(currentEvidence[item.evidenceKey] || {}),
            status: decision === "approve" ? "Approved" : "Rejected",
            reviewedAt: new Date().toISOString(),
            reviewedBy: access?.currentUser?.name || "Admin",
            reviewNote: decision === "approve" ? "" : rejectionReason,
            verifiedBy: decision === "approve" ? (access?.currentUser?.name || "Admin") : currentEvidence[item.evidenceKey]?.verifiedBy,
            dateSeen: decision === "approve" ? new Date().toISOString().slice(0, 10) : currentEvidence[item.evidenceKey]?.dateSeen,
          },
        },
        updatedAt: new Date().toISOString(),
      },
    };
    setChecklistState(nextChecklistState);
    saveScrChecklistState(nextChecklistState);
    persistScrChecklistRecord(item.staffId, nextChecklistState[item.staffId], decision === "approve" ? "SCR evidence approval synced" : "SCR evidence rejection synced");
    const nextRequests = {
      ...renewalRequests,
      [item.id]: appendScrRequestHistory({
        ...(renewalRequests[item.id] || {}),
        status: decision === "approve" ? "Approved" : "Rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: access?.currentUser?.name || "Admin",
        rejectionReason: decision === "approve" ? "" : rejectionReason,
      }, decision === "approve" ? "Approved" : "Sent back", access?.currentUser?.name || "Admin", decision === "approve" ? "Evidence approved." : rejectionReason),
    };
    saveRenewalRequests(nextRequests);
    persistScrEvidenceRequestRecord(item.id, item.staffId, item.evidenceKey, nextRequests[item.id], decision === "approve" ? "SCR evidence approval request synced" : "SCR evidence rejection request synced");
    addAuditLog(decision === "approve" ? "SCR evidence approved" : "SCR evidence rejected", `${item.staffName}: ${item.check}`);
  }
  async function downloadStaffSummary() {
    const { exportStaffScrSummary } = await import("./pdfExports.js");
    exportStaffScrSummary(samplePerson, scrData.staff, { evidenceRequests: renewalRequests });
  }
  async function downloadAssuranceLetter() {
    const { exportSchoolAssuranceLetter } = await import("./pdfExports.js");
    exportSchoolAssuranceLetter(selectedAssuranceStaff, assuranceSchool, { includeEvidenceAppendix, evidenceRequests: renewalRequests });
  }
  async function downloadInspectionEvidencePack() {
    const { exportInspectionEvidencePack } = await import("./pdfExports.js");
    exportInspectionEvidencePack({
      site: selectedOfstedSite,
      timing: selectedOfstedTiming,
      staff: selectedSchoolStaff,
      evidenceRows: selectedStaffEvidenceRows,
      documents: data.documents || [],
      documentLinks: selectedSiteDocumentLinks,
      rota: selectedSiteRota,
      logs: selectedSiteLogs,
      evidenceRequests: renewalRequests,
      scheduledInspection,
    });
    addAuditLog("Inspection evidence pack exported", selectedScrSchool);
  }
  const requirementRows = (selectedScrSchool ? [selectedScrSchool] : schoolOptions).map((school) => {
    const assigned = activeScrStaff.filter((person) => staffAssignedToSchool(person, school));
    const checks = [
      ["First aider", "firstAid"],
      ["EYFS Level 3+", "eyfs"],
      ["Safeguarding", "safeguarding"],
      ["Allergy awareness", "allergy"],
    ].map(([label, key]) => {
      const matching = assigned.filter((person) => staffMeetsRequirement(person, key));
      return { label, met: matching.length > 0, names: matching.map((person) => person.name).join(", ") };
    });
    return { school, assigned, checks, gaps: checks.filter((check) => !check.met).length };
  });
  const requirementGapCount = requirementRows.reduce((total, row) => total + row.gaps, 0);
  const evidenceStatusPriority = { Submitted: 0, Rejected: 1, Requested: 2, Prompt: 3, Approved: 4, Cleared: 5 };
  const evidenceActionQueue = evidenceWorkflowItems
    .filter((item) => ["Submitted", "Rejected", "Requested", "Prompt"].includes(item.status))
    .sort((a, b) => {
      const priorityDiff = (evidenceStatusPriority[a.status] ?? 9) - (evidenceStatusPriority[b.status] ?? 9);
      return priorityDiff || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    })
    .slice(0, 4);
  const siteAssuranceQueue = requirementRows
    .filter((row) => row.gaps)
    .sort((a, b) => b.gaps - a.gaps || a.school.localeCompare(b.school))
    .slice(0, 4);
  const selectedAssuranceComplete = selectedAssuranceStaff.filter((person) => person.compliance === "Compliant").length;
  const selectedAssuranceCompletion = selectedAssuranceStaff.length
    ? Math.round((selectedAssuranceComplete / selectedAssuranceStaff.length) * 100)
    : 100;
  const selectedOfstedSite = ofstedSiteForSchool(selectedScrSchool);
  const selectedOfstedTiming = selectedOfstedSite ? calculateOfstedInspectionWindow(selectedOfstedSite) : null;
  const selectedSiteRota = rotaSites.filter((site) => canonicalSchoolName(site.site) === canonicalSchoolName(selectedScrSchool));
  const selectedSiteLogs = selectedOfstedSite ? ofstedLogs.filter((log) => log.siteId === selectedOfstedSite.id) : [];
  const inspectionRows = selectedOfstedSite
    ? buildOfstedReadinessRows(selectedOfstedSite, selectedSchoolStaff, data.documents || [], selectedOfstedTiming, selectedSiteRota, selectedSiteLogs)
    : [];
  const inspectionReadyCount = inspectionRows.filter((row) => row.status === "Ready").length;
  const inspectionAttentionCount = inspectionRows.length - inspectionReadyCount;
  const inspectionReadinessScore = inspectionRows.length ? Math.round((inspectionReadyCount / inspectionRows.length) * 100) : 0;
  const staffEvidenceGaps = selectedSchoolStaff
    .map((person) => {
      const gaps = [
        !hasValidDate(person.dbsRenewal) && "DBS",
        !hasValidDate(person.safeguardingExpiry) && "Safeguarding",
        !hasValidDate(person.allergyAwarenessExpiry) && "Allergy awareness",
        !person.scrChecklist?.approvedAt && person.compliance !== "Compliant" && "Admin review",
      ].filter(Boolean);
      return { person, gaps };
    })
    .filter((item) => item.gaps.length)
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  const scheduledInspection = selectedOfstedSite ? scheduledInspectionForSite(selectedOfstedSite) : null;
  const scrFocusItems = [
    [reviewStaff, "Staff to review", reviewStaff ? "Check missing or incomplete SCR records for this site." : "This site is currently marked compliant."],
    [renewalItems.length, "Renewal prompts", renewalItems.length ? "Expiry or review dates need follow-up." : "No renewals due in the next 60 days."],
    [requirementGapCount, "Site cover gaps", requirementGapCount ? "Check first aid, EYFS, safeguarding or allergy cover." : "Site requirements are covered."],
    [onboardingProfiles.length, "Onboarding queue", onboardingProfiles.length ? "Approve new staff only when evidence is complete." : "No onboarding records waiting."],
  ];
  const selectedStaffEvidenceRows = buildScrSiteEvidenceRows(selectedSchoolStaff, data.hrFiles || [], renewalRequests);
  const siteBlockerRows = selectedStaffEvidenceRows.filter((row) => !row.ready);
  const siteVisibleEvidenceRows = siteFocusMode && siteBlockersOnly
    ? siteBlockerRows
    : selectedStaffEvidenceRows;
  const siteVisibleStaffIds = new Set(siteVisibleEvidenceRows.map((row) => row.person.id));
  const siteVisibleStaff = siteFocusMode && siteBlockersOnly
    ? selectedSchoolStaff.filter((person) => siteVisibleStaffIds.has(person.id))
    : selectedSchoolStaff;
  const selectedSiteDocumentLinks = readJson(documentLinksStorageKey, {});
  const dbsDisclosureAudit = buildDbsDisclosureAudit(activeScrStaff);
  function openEvidenceStaffProfile(staffId) {
    setProfileTargetId(staffId);
    setSummaryStaffId(staffId);
    document.getElementById("scr-staff-register")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function activateSiteFocusMode() {
    setSiteFocusMode(true);
  }

  return (
    <div className="stack">
      <section className={`scr-site-focus ${siteFocusMode ? "active" : ""}`} aria-label="Site SCR focus mode">
        <div>
          <p className="eyebrow">Site focus</p>
          <h3>{siteFocusMode ? `${selectedScrSchool || "Selected site"} register is focused.` : "Focus the register on one site."}</h3>
          <p>{siteFocusMode ? "Showing only the site checklist, required cover, assigned staff and export controls." : "Use this for school assurance, Ofsted preparation or a quick compliance review without the full SCR noise."}</p>
        </div>
        <div className="scr-site-focus-actions">
          <button className="button book" type="button" onClick={activateSiteFocusMode}><ShieldCheck size={16} /> {siteFocusMode ? "Refresh Site Focus" : "Open Site Focus"}</button>
          {siteFocusMode && <button className="button light" type="button" onClick={() => setSiteFocusMode(false)}>Show Full SCR</button>}
        </div>
        {siteFocusMode && (
          <div className="scr-site-focus-filter" aria-label="Site focus missing evidence filter">
            <span><strong>{siteBlockerRows.length}</strong> staff with blockers</span>
            <span><strong>{selectedStaffEvidenceRows.length}</strong> staff in site view</span>
            <button
              className={siteBlockersOnly ? "scr-filter-toggle active" : "scr-filter-toggle"}
              type="button"
              onClick={() => setSiteBlockersOnly((value) => !value)}
            >
              {siteBlockersOnly ? "Showing blockers" : "Show blockers only"}
            </button>
          </div>
        )}
      </section>
      <section className="scr-school-switcher" aria-label="SCR site selector">
        <div className="scr-school-switcher-copy">
          <p className="eyebrow">Site register</p>
          <h3>{selectedScrSchool || "Choose a site"}</h3>
          <p>
            Choose a school to see only the staff, checks and evidence that belong to that provision.
          </p>
        </div>
        <div className="scr-school-switcher-control">
          <label>
            School / site
            <select value={selectedScrSchool} onChange={(event) => selectInspectionSchool(event.target.value)}>
              {schoolOptions.map((school) => <option key={school} value={school}>{school}</option>)}
            </select>
          </label>
          <div className="scr-school-counts">
            <span><strong>{selectedSchoolStaff.length}</strong> assigned</span>
            <span><strong>{compliantStaff}</strong> complete</span>
            <span><strong>{reviewStaff}</strong> to review</span>
          </div>
        </div>
        <div className="scr-school-buttons" aria-label="Quick school switcher">
          {schoolOptions.map((school) => {
            const count = activeScrStaff.filter((person) => staffAssignedToSchool(person, school)).length;
            return (
              <button
                key={school}
                className={school === selectedScrSchool ? "active" : ""}
                type="button"
                onClick={() => selectInspectionSchool(school)}
              >
                <strong>{school}</strong>
                <span>{count} staff</span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="toolbar">
        <div>
          <h2>Single Central Register</h2>
          <p className="panel-note">The evidence below is scoped to {selectedScrSchool || "the selected school"}.</p>
          {access?.isScoped && <p className="panel-note">Manager view: compliance table is limited to direct reports.</p>}
        </div>
        <div>
          <button className="button light" type="button" onClick={downloadStaffSummary}><Download size={16} /> Staff Summary</button>
          <button className="button light" type="button" onClick={downloadAssuranceLetter}><FileText size={16} /> Assurance Letter</button>
          {siteFocusMode
            ? <button className="button dark" type="button" onClick={downloadInspectionEvidencePack}><Download size={16} /> Inspection Pack</button>
            : <button className="button dark" type="button"><Upload size={16} /> Request Evidence</button>}
        </div>
      </div>
      {!siteFocusMode && (
        <SCRInspectionLaunchPanel
          site={selectedOfstedSite}
          timing={selectedOfstedTiming}
          school={selectedScrSchool}
          staff={selectedSchoolStaff}
          rows={inspectionRows}
          score={inspectionReadinessScore}
          attentionCount={inspectionAttentionCount}
          staffEvidenceGaps={staffEvidenceGaps}
          scheduledInspection={scheduledInspection}
        />
      )}
      <SCRInspectionChecklist
        school={selectedScrSchool}
        rows={siteVisibleEvidenceRows}
        onOpenStaff={openEvidenceStaffProfile}
        emptyTitle={siteBlockersOnly ? "No missing evidence in this view." : undefined}
        emptyText={siteBlockersOnly ? "Clear the filter to show every assigned staff member again." : undefined}
      />
      {siteFocusMode && (
        <SCRRequirementPanel rows={requirementRows} compactTitle="Required cover for this site" />
      )}
      {!siteFocusMode && <SCRSiteEvidenceBoard
        school={selectedScrSchool}
        rows={selectedStaffEvidenceRows}
        onOpenStaff={openEvidenceStaffProfile}
      />}
      {!siteFocusMode && <DBSDisclosureAuditPanel audit={dbsDisclosureAudit} onOpenStaff={openEvidenceStaffProfile} onApply={applyDbsDisclosureNumber} />}
      <StaffTable
        data={{ ...scrData, staff: siteVisibleStaff }}
        siteScopeLabel={selectedScrSchool}
        targetStaffId={profileTargetId || targetStaffId}
        onTargetHandled={() => {
          setProfileTargetId("");
          onTargetHandled?.();
        }}
        evidenceRequests={renewalRequests}
        onRequestEvidence={requestProfileEvidence}
        onClearEvidenceRequest={clearProfileEvidenceRequest}
        onMarkEvidenceChecked={markProfileEvidenceChecked}
        onOpenHrFiles={onOpenHrFiles}
        onOpenPay={onOpenPay}
        access={access}
        onUpdateStaffPay={onUpdateStaffPay}
      />
      {!siteFocusMode && <SCRDetailsPanel title="Exports and assurance" summary={`${selectedAssuranceStaff.length} staff in ${assuranceSchool} · ${selectedAssuranceCompletion}% ready`}>
        <section className="scr-output-grid">
          <article className="scr-output-card">
            <div>
              <p className="eyebrow">Staff SCR summary</p>
              <h3>{samplePerson.name || "Staff member"} record pack</h3>
              <p>Download a staff record with recruitment checks, training, DBS, right to work and admin review status.</p>
            </div>
            <label>
              Staff member
              <select value={samplePerson.id || ""} onChange={(event) => setSummaryStaffId(event.target.value)}>
                {selectedSchoolStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
            <div className="scr-record-preview">
              <div><span>Role</span><strong>{samplePerson.role || "Role pending"}</strong></div>
              <div><span>Assigned sites</span><strong>{staffPrimaryLocation(samplePerson)}</strong></div>
              <div><span>DBS renewal</span><strong>{samplePerson.dbsRenewal || "Not recorded"}</strong></div>
              <div><span>Safeguarding</span><strong>{samplePerson.safeguardingExpiry || "Not recorded"}</strong></div>
            </div>
          </article>
          <article className="scr-output-card dark">
            <div>
              <p className="eyebrow">School assurance letter</p>
              <h3>For DSL, SBM and compliance contacts.</h3>
              <p>Generate a school-facing assurance letter for the selected site only.</p>
            </div>
            <label className="scr-school-select">
              School / site
              <select value={assuranceSchool} onChange={(event) => selectInspectionSchool(event.target.value)}>
                {schoolOptions.map((school) => <option key={school}>{school}</option>)}
              </select>
            </label>
            <label className="scr-evidence-toggle">
              <input type="checkbox" checked={includeEvidenceAppendix} onChange={(event) => setIncludeEvidenceAppendix(event.target.checked)} />
              <span>{includeEvidenceAppendix ? "Include evidence appendix" : "Summary only"}</span>
            </label>
            <div className="assurance-mini-table">
              {selectedAssuranceStaff.length ? selectedAssuranceStaff.map((person) => (
                <div key={person.id}>
                  <strong>{person.name}</strong>
                  <span>{person.role}</span>
                  <Badge value={person.compliance} />
                </div>
              )) : <p className="empty-inline">No staff are currently assigned to this site.</p>}
            </div>
          </article>
        </section>
      </SCRDetailsPanel>}
      {!siteFocusMode && <SCRDetailsPanel title="Evidence inbox and renewals" summary={`${evidenceActionQueue.length} priority actions · ${renewalItems.length} renewals`}>
        <section className="scr-evidence-console">
          <div className="scr-assignments-heading">
            <div>
              <p className="eyebrow">Evidence inbox</p>
              <h3>Track evidence requests when you need the workflow.</h3>
              <p>Requested, submitted, rejected and approved evidence sits here with audit history.</p>
            </div>
            <div className="renewal-mini-metrics">
              <Metric icon={<Bell />} label="Action needed" value={evidenceWorkflowItems.filter((item) => ["Prompt", "Requested", "Submitted", "Rejected"].includes(item.status)).length} tone="amber" />
              <Metric icon={<ClipboardCheck />} label="Submitted" value={submittedEvidence.length} tone={submittedEvidence.length ? "amber" : "green"} />
            </div>
          </div>
          <EvidenceWorkflowInbox items={evidenceWorkflowItems} filter={evidenceFilter} onFilter={setEvidenceFilter} />
          <SubmittedEvidenceReviewQueue items={submittedEvidence} onReview={reviewSubmittedEvidence} />
        </section>
        <SCRRenewalPanel items={renewalItems} />
      </SCRDetailsPanel>}
      {!siteFocusMode && <SCRDetailsPanel title="Assignments and requirements" summary={`${requirementGapCount} site cover gaps · ${onboardingProfiles.length} onboarding`}>
        {!!onboardingProfiles.length && <SCROnboardingQueue staff={onboardingProfiles} onUpdate={updateChecklist} onApprove={approveScrProfile} />}
        <SCRAssignmentsPanel
          staff={selectedSchoolStaff}
          schools={assignmentSchools}
          onAdd={addAssignment}
          onRemove={removeAssignment}
          onUpdate={updateAssignment}
        />
        <SCRRequirementPanel rows={requirementRows} />
      </SCRDetailsPanel>}
      {!siteFocusMode && <SCRDetailsPanel title="Reference" summary="SCR fields and assurance statements">
        <section className="scr-assurance-statements">
          <div>
            <p className="eyebrow">Included in assurance output</p>
            <h3>What schools can be shown when records are complete.</h3>
          </div>
          <div className="statement-grid">
            {assuranceStatements.map((statement) => (
              <article key={statement}><CheckCircle2 size={18} /><p>{statement}</p></article>
            ))}
          </div>
        </section>
        <div className="scr-grid">
          {["Personal Info", "Right to Work", "Identity Checks", "DBS", "Safeguarding", "Allergy Awareness", "First Aid", "Annual Declarations", "Recruitment Checks", "Admin Review"].map((group) => (
            <article key={group}>
              <h3>{group}</h3>
              <p>{scrCopy[group]}</p>
            </article>
          ))}
        </div>
      </SCRDetailsPanel>}
    </div>
  );
}

function SCRDetailsPanel({ title, summary, children }) {
  return (
    <details className="scr-details-panel">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{summary}</span>
        </div>
        <em>Open</em>
      </summary>
      <div className="scr-details-panel-body">{children}</div>
    </details>
  );
}

function KingHouseMondayPackShortcut({ staff = [], evidenceRows = [], onOpenStaff, onExportPdf }) {
  const currentStaff = [...staff].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const blockerRows = evidenceRows
    .map((row) => ({
      person: row.person,
      checks: row.checks.filter((check) => check.tone !== "ready" && check.tone !== "neutral"),
    }))
    .filter((row) => row.checks.length);
  const readyStaff = evidenceRows.filter((row) => row.ready).length;
  const dbsReady = currentStaff.filter((person) => staffDbsNumber(person)).length;
  function jumpTo(id) {
    if (typeof document === "undefined") return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <section className="khs-monday-shortcut" aria-label="King's House Monday pack shortcut">
      <div className="khs-monday-copy">
        <p className="eyebrow">King&apos;s House Monday Pack</p>
        <h3>Open the evidence you are most likely to need first.</h3>
        <p>Site-scoped staff only: current roster, SCR evidence, DBS numbers, checked dates and export tools for Monday&apos;s inspection.</p>
      </div>
      <div className="khs-monday-metrics">
        <span><strong>{currentStaff.length}</strong> staff</span>
        <span><strong>{readyStaff}/{evidenceRows.length || 0}</strong> ready</span>
        <span><strong>{dbsReady}/{currentStaff.length || 0}</strong> DBS</span>
        <span><strong>{blockerRows.length}</strong> blockers</span>
      </div>
      <div className="khs-monday-staff">
        {currentStaff.map((person) => {
          const row = evidenceRows.find((item) => item.person.id === person.id);
          const blockers = row?.checks?.filter((check) => check.tone !== "ready" && check.tone !== "neutral").length || 0;
          return (
            <button key={person.id} type="button" onClick={() => onOpenStaff?.(person.id)}>
              <strong>{person.name}</strong>
              <span>{staffDbsNumber(person) ? `DBS ${staffDbsNumber(person)}` : "DBS not recorded"}</span>
              <em>{blockers ? `${blockers} to check` : "Ready"}</em>
            </button>
          );
        })}
      </div>
      <div className="khs-monday-actions">
        <button className="button book" type="button" onClick={() => jumpTo("khs-inspection-pack")}><ShieldCheck size={16} /> Open Monday Pack</button>
        <button className="button light" type="button" onClick={() => jumpTo("scr-site-evidence-board")}><ClipboardCheck size={16} /> Evidence Board</button>
        <button className="button light" type="button" onClick={() => jumpTo("scr-staff-register")}><Users size={16} /> Staff Profiles</button>
        <button className="button dark" type="button" onClick={onExportPdf}><Download size={16} /> Export PDF</button>
      </div>
    </section>
  );
}

function SCRSiteEvidenceBoard({ school, rows, onOpenStaff }) {
  const [showBlockersOnly, setShowBlockersOnly] = useState(false);
  const readyRows = rows.filter((row) => row.ready);
  const needsAction = rows.length - readyRows.length;
  const blockerRows = rows
    .map((row) => ({
      ...row,
      checks: row.checks.filter((check) => check.tone !== "ready" && check.tone !== "neutral"),
    }))
    .filter((row) => row.checks.length);
  const visibleRows = showBlockersOnly ? blockerRows : rows;
  const evidenceOrder = ["dbs", "safeguarding", "allergy", "firstAid", "references", "annualSuitability", "eyfsLevel", "adminReview"];
  function orderedChecks(checks = []) {
    return [...checks].sort((a, b) => evidenceOrder.indexOf(a.key) - evidenceOrder.indexOf(b.key));
  }
  return (
    <section className="scr-evidence-board" id="scr-site-evidence-board" aria-label={`${school} SCR evidence board`}>
      <div className="scr-evidence-board-head">
        <div>
          <p className="eyebrow">Evidence board</p>
          <h3>{school} staff evidence at a glance.</h3>
          <p>Current assigned staff only. Blockers are shown first; checked evidence is collapsed so the inspection view stays calm.</p>
        </div>
        <div className="scr-evidence-board-metrics">
          <span><strong>{rows.length}</strong> staff</span>
          <span><strong>{readyRows.length}</strong> ready</span>
          <span><strong>{needsAction}</strong> to check</span>
        </div>
        <div className="scr-evidence-board-actions">
          <button className={showBlockersOnly ? "scr-filter-toggle active" : "scr-filter-toggle"} type="button" onClick={() => setShowBlockersOnly((value) => !value)}>
            {showBlockersOnly ? "Showing blockers" : "Show blockers only"}
          </button>
        </div>
      </div>
      <div className="scr-evidence-board-list">
        {visibleRows.map((row) => {
          const ordered = orderedChecks(row.checks);
          const blockerChecks = ordered.filter((check) => check.tone !== "ready" && check.tone !== "neutral");
          const readyChecks = ordered.filter((check) => check.tone === "ready" || check.tone === "neutral");
          const priorityChecks = blockerChecks.length ? blockerChecks : ordered.slice(0, 3);
          const hiddenReadyChecks = blockerChecks.length ? readyChecks : ordered.slice(3);
          const dbsNumber = staffDbsNumber(row.person);
          const checkedDate = staffScrCheckedDate(row.person);
          return (
            <article className={row.ready ? "ready compact" : "needs-action compact"} key={row.person.id}>
              <div className="scr-evidence-person">
                <div>
                  <h4>{row.person.name}</h4>
                  <p>{row.person.role} · {row.person.email || "No email recorded"}</p>
                  <div className="scr-evidence-mini-facts">
                    <span>DBS {dbsNumber || "not recorded"}</span>
                    <span>SCR checked {checkedDate ? formatShortDate(checkedDate) : "not recorded"}</span>
                  </div>
                </div>
                <div className="scr-evidence-row-status">
                  <span className={blockerChecks.length ? "needs-action" : "ready"}>{blockerChecks.length ? `${blockerChecks.length} to check` : "Ready"}</span>
                  <small>{readyChecks.length} checked</small>
                </div>
                <button className="button subtle" type="button" onClick={() => onOpenStaff(row.person.id)}>Open record</button>
              </div>
              <div className="scr-evidence-checks compact priority">
                {priorityChecks.map((check) => (
                  <SCREvidenceChip check={check} key={check.key} />
                ))}
              </div>
              {!!hiddenReadyChecks.length && (
                <details className="scr-evidence-ready-details">
                  <summary>{hiddenReadyChecks.length} checked / lower priority item{hiddenReadyChecks.length === 1 ? "" : "s"}</summary>
                  <div className="scr-evidence-checks compact ready-items">
                    {hiddenReadyChecks.map((check) => (
                      <SCREvidenceChip check={check} key={check.key} />
                    ))}
                  </div>
                </details>
              )}
            </article>
          );
        })}
        {!rows.length && <EmptyList title="No staff assigned to this site" text="Use the assignment section to add staff before producing assurance output." />}
        {rows.length > 0 && !visibleRows.length && <EmptyList title="No blockers for this site" text="All visible SCR evidence is either checked, recorded or not required." />}
      </div>
    </section>
  );
}

function SCRInspectionChecklist({ school, rows, onOpenStaff, emptyTitle = "No current staff are assigned to this site.", emptyText = "" }) {
  const checklistOrder = ["dbs", "safeguarding", "allergy", "firstAid", "references", "annualSuitability"];
  const readyRows = rows.filter((row) => row.ready);
  const needsAction = rows.length - readyRows.length;
  const visibleChecks = (row) => checklistOrder.map((key) => row.checks.find((check) => check.key === key)).filter(Boolean);
  const checkLabel = (check) => check.file?.fileUrl ? "View file" : check.file?.storagePath ? "Private file" : check.detail;
  return (
    <section className="scr-inspection-checklist" aria-label={`${school} SCR inspection checklist`}>
      <div className="scr-inspection-checklist-head">
        <div>
          <p className="eyebrow">Inspection checklist</p>
          <h3>{school} staff compliance table.</h3>
          <p>Site-filtered, current staff only. Use this as the calm front page before opening individual evidence records.</p>
        </div>
        <div className="scr-inspection-checklist-metrics">
          <span><strong>{rows.length}</strong> staff</span>
          <span><strong>{readyRows.length}</strong> ready</span>
          <span><strong>{needsAction}</strong> actions</span>
        </div>
      </div>
      <TableWrap>
        <table className="scr-inspection-checklist-table">
          <thead>
            <tr>
              <th>Staff member</th>
              <th>DBS no.</th>
              <th>Safeguarding</th>
              <th>Allergy</th>
              <th>First aid</th>
              <th>References</th>
              <th>Suitability</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checks = Object.fromEntries(visibleChecks(row).map((check) => [check.key, check]));
              const dbsNumber = staffDbsNumber(row.person);
              return (
                <tr key={row.person.id}>
                  <td>
                    <strong>{row.person.name}</strong>
                    <small>{row.person.role || "Staff"} · SCR checked {staffScrCheckedDate(row.person) ? formatShortDate(staffScrCheckedDate(row.person)) : "not recorded"}</small>
                  </td>
                  <td>
                    <span className={dbsNumber ? "scr-mini-status ready" : "scr-mini-status bad"}>{dbsNumber || "Missing"}</span>
                  </td>
                  {["safeguarding", "allergy", "firstAid", "references", "annualSuitability"].map((key) => {
                    const check = checks[key];
                    return (
                      <td key={key}>
                        {check ? (
                          <div className={`scr-checklist-cell ${check.tone}`}>
                            <strong>{check.status}</strong>
                            {check.file?.fileUrl
                              ? <a href={check.file.fileUrl} target="_blank" rel="noreferrer">{checkLabel(check)}</a>
                              : <span>{checkLabel(check)}</span>}
                          </div>
                        ) : (
                          <span className="scr-mini-status neutral">Not recorded</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button className="button subtle" type="button" onClick={() => onOpenStaff(row.person.id)}>Open</button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan="8">
                  <strong>{emptyTitle}</strong>
                  {emptyText && <small>{emptyText}</small>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}

function DBSDisclosureAuditPanel({ audit, onOpenStaff, onApply }) {
  const [showNeedsAttentionOnly, setShowNeedsAttentionOnly] = useState(true);
  const visibleResults = showNeedsAttentionOnly
    ? audit.results.filter((result) => result.status !== "updated")
    : audit.results;
  const statusCopy = {
    updated: ["Updated", "ready"],
    "matched-missing-dbs": ["Needs update", "warn"],
    "different-current-dbs": ["Mismatch", "bad"],
    ambiguous: ["Ambiguous", "warn"],
    unmatched: ["No match", "bad"],
  };
  return (
    <section className="dbs-disclosure-audit" aria-label="DBS disclosure import check">
      <div className="dbs-disclosure-head">
        <div>
          <p className="eyebrow">Disclosure import check</p>
          <h3>DBS numbers from the 27 June disclosure report.</h3>
          <p>Use this to confirm the disclosure PDF has been reflected in the SCR. Rows marked updated already match the certificate number on the staff record.</p>
        </div>
        <div className="dbs-disclosure-summary">
          <span><strong>{audit.summary.updated || 0}</strong> updated</span>
          <span><strong>{audit.attentionCount}</strong> to check</span>
          <span><strong>{audit.summary.unmatched || 0}</strong> unmatched</span>
        </div>
        <button className={showNeedsAttentionOnly ? "scr-filter-toggle active" : "scr-filter-toggle"} type="button" onClick={() => setShowNeedsAttentionOnly((value) => !value)}>
          {showNeedsAttentionOnly ? "Showing checks" : "Show checks only"}
        </button>
      </div>
      <TableWrap>
        <table className="dbs-disclosure-table">
          <thead>
            <tr>
              <th>Disclosure row</th>
              <th>Certificate no</th>
              <th>Matched staff</th>
              <th>Current SCR</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleResults.map((result) => {
              const [label, tone] = statusCopy[result.status] || ["Check", "warn"];
              const canApply = Boolean(result.person && ["matched-missing-dbs", "different-current-dbs"].includes(result.status));
              const candidateText = result.status === "ambiguous"
                ? result.candidates.map((candidate) => candidate.person.name).join(", ")
                : result.person?.name || "No current staff match";
              return (
                <tr key={`${result.row.applicationRef}-${result.row.certificateNo}`}>
                  <td>
                    <strong>{result.row.surname}</strong>
                    <small>DOB {formatShortDate(result.row.dob)} · issued {formatShortDate(result.row.issueDate)}</small>
                  </td>
                  <td><code>{result.row.certificateNo}</code></td>
                  <td>{candidateText}</td>
                  <td>{result.currentDbs ? <code>{result.currentDbs}</code> : "Not recorded"}</td>
                  <td><span className={`badge ${tone === "bad" ? "bad" : tone === "warn" ? "warn" : "good"}`}>{label}</span></td>
                  <td>
                    <div className="dbs-disclosure-actions">
                      {canApply && <button className="button light" type="button" onClick={() => onApply(result)}>Apply DBS</button>}
                      {result.person
                        ? <button className="button subtle" type="button" onClick={() => onOpenStaff(result.person.id)}>Open record</button>
                        : <span className="panel-note">Manual review</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!visibleResults.length && (
              <tr><td colSpan="6"><strong>All disclosure rows match the current SCR DBS numbers.</strong></td></tr>
            )}
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}

function SCREvidenceChip({ check }) {
  return (
    <div className={`scr-evidence-chip ${check.tone}`}>
      <span>{check.label}</span>
      <strong>{check.status}</strong>
      <small>{check.detail}</small>
      {check.file?.fileUrl
        ? <a href={check.file.fileUrl} target="_blank" rel="noreferrer">Open evidence</a>
        : check.file?.storagePath
          ? <em>Private file</em>
          : null}
    </div>
  );
}

function OfstedReadiness({ data }) {
  const [siteId, setSiteId] = useState(ofstedSites[0].id);
  const [logs, setLogs] = useState(() => readJson(ofstedLogsStorageKey, []));
  const [inspectionDayChecks, setInspectionDayChecks] = useState(() => readJson(ofstedInspectionDayStorageKey, {}));
  const [gapOwners, setGapOwners] = useState(() => readJson(ofstedGapOwnersStorageKey, {}));
  const site = ofstedSites.find((item) => item.id === siteId) || ofstedSites[0];
  const timing = calculateOfstedInspectionWindow(site);
  const siteInspectionDayChecks = inspectionDayChecks[site.id] || {};
  const siteGapOwners = gapOwners[site.id] || {};
  const ownerOptions = buildOfstedOwnerOptions(data.staff);
  const inspectionDayComplete = ofstedInspectionDayItems.filter((item) => siteInspectionDayChecks[item.id]?.done).length;
  const assignedStaff = data.staff.filter((person) => staffAssignedToSchool(person, site.school));
  const siteRota = rotaSites.filter((item) => item.site === site.school);
  const siteLogs = logs.filter((log) => log.siteId === site.id);
  const openSiteLogs = siteLogs.filter((log) => log.status !== "Closed");
  const nilReturnLogs = siteLogs.filter((log) => log.type === "Nil return");
  const corePolicyNames = ["Safeguarding Policy", "Behaviour Policy", "First Aid Policy", "Staff Handbook"];
  const corePolicies = data.documents.filter((document) => corePolicyNames.includes(document.name));
  const readinessRows = buildOfstedReadinessRows(site, assignedStaff, data.documents, timing, siteRota, siteLogs);
  const evidenceGaps = readinessRows.filter((row) => row.status !== "Ready");
  const readyCount = readinessRows.filter((item) => item.status === "Ready").length;
  const attentionCount = readinessRows.filter((item) => item.status !== "Ready").length;
  const readinessScore = readinessRows.length ? Math.round((readyCount / readinessRows.length) * 100) : 0;
  function saveLogs(next) {
    setLogs(next);
    localStorage.setItem(ofstedLogsStorageKey, JSON.stringify(next));
  }
  function addLog(entry) {
    const next = [
      {
        id: `ofsted-log-${Date.now()}`,
        siteId: site.id,
        siteName: site.school,
        createdAt: new Date().toISOString(),
        ...entry,
      },
      ...logs,
    ];
    saveLogs(next);
    addAuditLog("Ofsted log added", `${site.school}: ${entry.type}`);
  }
  function updateLog(id, patch) {
    const next = logs.map((log) => (log.id === id ? { ...log, ...patch, updatedAt: new Date().toISOString() } : log));
    saveLogs(next);
    addAuditLog("Ofsted log updated", `${site.school}: ${patch.status || "entry updated"}`);
  }
  function updateInspectionDayCheck(itemId, patch) {
    const next = {
      ...inspectionDayChecks,
      [site.id]: {
        ...(inspectionDayChecks[site.id] || {}),
        [itemId]: {
          ...((inspectionDayChecks[site.id] || {})[itemId] || {}),
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    setInspectionDayChecks(next);
    localStorage.setItem(ofstedInspectionDayStorageKey, JSON.stringify(next));
    addAuditLog("Ofsted inspection day checklist updated", `${site.school}: ${itemId}`);
  }
  function resetInspectionDayChecks() {
    const next = {
      ...inspectionDayChecks,
      [site.id]: {},
    };
    setInspectionDayChecks(next);
    localStorage.setItem(ofstedInspectionDayStorageKey, JSON.stringify(next));
    addAuditLog("Ofsted inspection day checklist reset", site.school);
  }
  function updateGapOwner(area, patch) {
    const next = {
      ...gapOwners,
      [site.id]: {
        ...(gapOwners[site.id] || {}),
        [area]: {
          ...((gapOwners[site.id] || {})[area] || {}),
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    setGapOwners(next);
    localStorage.setItem(ofstedGapOwnersStorageKey, JSON.stringify(next));
    addAuditLog("Ofsted gap owner updated", `${site.school}: ${area}`);
  }
  function printSitePack() {
    window.print();
    addAuditLog("Ofsted site pack generated", site.school);
  }
  const ofstedFocusItems = [
    [`${readinessScore}%`, "Readiness", attentionCount ? `${attentionCount} checklist items need action.` : "Evidence checklist is clear."],
    [timing.primaryNumber, timing.primaryLabel, timing.summary],
    [assignedStaff.length, "Assigned staff", assignedStaff.length ? "Staff assigned to this site only." : "Assign site staff before inspection."],
    [`${inspectionDayComplete}/${ofstedInspectionDayItems.length}`, "Inspection day", inspectionDayComplete === ofstedInspectionDayItems.length ? "Day-of checklist is complete." : "Keep practical evidence ready."],
  ];
  return (
    <div className="stack ofsted-workspace">
      <div className="toolbar">
        <div>
          <h2>Ofsted Site Readiness</h2>
          <p className="panel-note">Site-specific inspection preparation. Inspectors look at the registered provision they are visiting, not every site at once.</p>
        </div>
        <label className="ofsted-site-select">
          Site
          <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            {ofstedSites.map((item) => <option key={item.id} value={item.id}>{item.school}</option>)}
          </select>
        </label>
        <button className="button book" type="button" onClick={printSitePack}><Download size={16} /> Generate Site Pack</button>
      </div>
      <section className="ofsted-focus-strip" aria-label={`${site.school} inspection summary`}>
        {ofstedFocusItems.map(([value, title, text]) => (
          <article key={title}>
            <strong>{value}</strong>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="ofsted-print-pack" aria-label="Ofsted inspection export">
        <div className="ofsted-print-header">
          <div>
            <p className="eyebrow">Ofsted inspection pack</p>
            <h1>{site.school}</h1>
            <p>Prepared for a site-specific inspection. Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}.</p>
          </div>
          <div>
            <strong>URN {site.urn}</strong>
            <span>{timing.status}</span>
          </div>
        </div>
        <div className="ofsted-print-summary">
          <div><span>Readiness</span><strong>{readinessScore}%</strong></div>
          <div><span>Assigned staff</span><strong>{assignedStaff.length}</strong></div>
          <div><span>Open logs</span><strong>{openSiteLogs.length}</strong></div>
          <div><span>Nil returns</span><strong>{nilReturnLogs.length}</strong></div>
          <div><span>Inspection day</span><strong>{inspectionDayComplete}/{ofstedInspectionDayItems.length}</strong></div>
        </div>
        <div className="ofsted-print-grid">
          <article>
            <h2>Registration</h2>
            <p>{site.name}</p>
            <p>URN: {site.urn}</p>
            <p>Registered {formatShortDate(site.registrationDate)}</p>
            <p>Registers: {site.registers.join(", ")}</p>
            <p>Last inspection: {site.lastInspectionDate ? formatShortDate(site.lastInspectionDate) : "Not yet inspected"}</p>
            <p>Next due by: {formatShortDate(timing.dueBy)}</p>
            <p>Ofsted page: {site.providerUrl}</p>
          </article>
          <article>
            <h2>Inspection Window</h2>
            <p>Status: {timing.status}</p>
            <p>Preparation window opens: {formatShortDate(timing.prepWindowOpen)}</p>
            <p>Expected due-by date: {formatShortDate(timing.dueBy)}</p>
            <p>{timing.summary}</p>
          </article>
        </div>
        <article>
          <h2>Assigned Staff and SCR Evidence</h2>
          <p className="ofsted-print-note">This table is filtered to staff assigned to {site.school}. Use it as the inspection front sheet, then open the individual staff profile for evidence files.</p>
          {assignedStaff.length ? (
            <table className="ofsted-scr-print-table"><thead><tr><th>Staff member</th><th>Role</th><th>DBS / barred list</th><th>References</th><th>Safeguarding / allergy</th><th>First aid / EYFS</th><th>Annual suitability</th><th>SCR state</th></tr></thead><tbody>
              {assignedStaff.map((person) => {
                const suitability = suitabilityDeclarationState(person);
                return (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong><br />{person.email || "Email not recorded"}</td>
                    <td>{person.role || "Staff"}<br />{staffPrimaryLocation(person)}</td>
                    <td>{ofstedDbsPrintSummary(person)}<br />Barred list: {person.scrChecklist?.barredList ? "Recorded" : firstText(evidenceFor(person, "barredList").status, evidenceFor(person, "barredList").reference, "Not recorded")}</td>
                    <td>{ofstedReferencePrintSummary(person)}</td>
                    <td>{ofstedTrainingPrintSummary(person, "safeguarding", person.safeguardingExpiry, "Safeguarding")}<br />Allergy: {ofstedTrainingPrintSummary(person, "allergy", person.allergyAwarenessExpiry, "Allergy awareness")}</td>
                    <td>{ofstedFirstAidEyfsSummary(person)}</td>
                    <td>{suitability.label}<br />{suitability.nextDueDate ? `Next due ${formatShortDate(suitability.nextDueDate)}` : suitability.detail}</td>
                    <td>{person.compliance || "Review needed"}<br />{ofstedScrEvidenceScore(person)}</td>
                  </tr>
                );
              })}
            </tbody></table>
          ) : <p>No staff are currently assigned to this site in the SCR.</p>}
        </article>
        <article>
          <h2>Rota and Required Cover</h2>
          {siteRota.length ? (
            <table><thead><tr><th>Provision</th><th>Setup</th><th>Session</th><th>Cleanup</th><th>Expected cover</th></tr></thead><tbody>
              {siteRota.map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.setupMinutes} minutes</td><td>{item.sessionStart}-{item.sessionEnd}</td><td>{item.cleanupMinutes} minutes</td><td>First aider and EYFS Level 3+ lead checked against assigned staff.</td></tr>)}
            </tbody></table>
          ) : <p>No rota details are currently configured for this registered site.</p>}
        </article>
        <article>
          <h2>Policy and Document Evidence</h2>
          {corePolicies.length ? (
            <table><thead><tr><th>Document</th><th>Version</th><th>Assigned</th><th>Read</th><th>Status</th></tr></thead><tbody>
              {corePolicies.map((document) => <tr key={document.name}><td>{document.name}</td><td>{document.version}</td><td>{document.assigned}</td><td>{document.read}</td><td>{document.status}</td></tr>)}
            </tbody></table>
          ) : <p>No core policy documents are currently recorded in the library.</p>}
        </article>
        <article>
          <h2>Evidence Checklist</h2>
          <table><thead><tr><th>Area</th><th>Status</th><th>Evidence</th><th>Next action</th></tr></thead><tbody>
            {readinessRows.map((row) => <tr key={row.area}><td>{row.area}</td><td>{row.status}</td><td>{row.evidence}</td><td>{row.nextAction}</td></tr>)}
          </tbody></table>
        </article>
        <article>
          <h2>Evidence Gaps</h2>
          {evidenceGaps.length ? (
            <table><thead><tr><th>Gap</th><th>Owner</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>
              {evidenceGaps.map((gap) => {
                const owner = siteGapOwners[gap.area] || {};
                return <tr key={gap.area}><td>{gap.area}</td><td>{owner.owner || suggestOfstedOwner(gap.area)}</td><td>{owner.dueDate ? formatShortDate(owner.dueDate) : "Not set"}</td><td>{owner.status || "Not started"}</td><td>{gap.nextAction}</td></tr>;
              })}
            </tbody></table>
          ) : <p>No evidence gaps are currently blocking this site's inspection pack.</p>}
        </article>
        <article>
          <h2>Inspection Day Checklist</h2>
          <table><thead><tr><th>Item</th><th>Status</th><th>Notes</th></tr></thead><tbody>
            {ofstedInspectionDayItems.map((item) => {
              const check = siteInspectionDayChecks[item.id] || {};
              return <tr key={item.id}><td>{item.title}</td><td>{check.done ? "Ready" : "Not confirmed"}</td><td>{check.note || item.detail}</td></tr>;
            })}
          </tbody></table>
        </article>
        <article>
          <h2>Nil Returns</h2>
          {nilReturnLogs.length ? (
            <table><thead><tr><th>Period</th><th>Categories</th><th>Confirmed by</th><th>Recorded</th></tr></thead><tbody>
              {nilReturnLogs.map((log) => <tr key={log.id}><td>{formatShortDate(log.periodStart)} to {formatShortDate(log.periodEnd)}</td><td>{log.nilTypes?.join(", ") || "Complaint, Accident, Safeguarding"}</td><td>{log.owner || "Admin"}</td><td>{formatShortDate(log.date)}</td></tr>)}
            </tbody></table>
          ) : <p>No nil returns are currently recorded for this site.</p>}
        </article>
        <article>
          <h2>Site Logs</h2>
          {siteLogs.length ? (
            <table><thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Summary</th><th>Action</th></tr></thead><tbody>
              {siteLogs.map((log) => <tr key={log.id}><td>{formatShortDate(log.date)}</td><td>{log.type}</td><td>{log.status}</td><td>{log.summary}</td><td>{log.action || "No action recorded"}</td></tr>)}
            </tbody></table>
          ) : <p>No site log entries recorded for this site.</p>}
        </article>
        <article className="ofsted-print-signoff">
          <h2>Admin Sign-off</h2>
          <p>This pack is generated from the selected site's operational records. Final inspection preparation should confirm that live evidence, staff records and site documents match the current provision.</p>
          <div><span>Prepared by</span><span>Date</span></div>
        </article>
      </section>
      <section className={`ofsted-hero ${timing.tone}`}>
        <div>
          <p className="eyebrow">Inspection countdown</p>
          <h3>{site.school}</h3>
          <p>{timing.summary}</p>
          <div className="ofsted-registers">{site.registers.map((register) => <span key={register}>{register}</span>)}</div>
        </div>
        <div className="ofsted-countdown">
          <strong>{timing.primaryNumber}</strong>
          <span>{timing.primaryLabel}</span>
          <Badge value={timing.status} />
        </div>
      </section>
      <div className="ofsted-metrics">
        <Metric icon={<ShieldCheck />} label="Readiness" value={`${readinessScore}%`} tone={attentionCount ? "amber" : "green"} />
        <Metric icon={<Users />} label="Assigned staff" value={assignedStaff.length} tone={assignedStaff.length ? "blue" : "amber"} />
        <Metric icon={<CalendarDays />} label="Registered" value={formatShortDate(site.registrationDate)} tone="blue" />
        <Metric icon={<FileText />} label="Last inspection" value={site.lastInspectionDate ? formatShortDate(site.lastInspectionDate) : "Not yet"} tone={site.lastInspectionDate ? "green" : "amber"} />
      </div>
      <section className="ofsted-grid">
        <article className="ofsted-card">
          <p className="eyebrow">Registration</p>
          <h3>{site.name}</h3>
          <div className="ofsted-facts">
            <div><span>URN</span><strong>{site.urn}</strong></div>
            <div><span>Outcome</span><strong>{site.lastOutcome}</strong></div>
            <div><span>Report published</span><strong>{site.reportPublishedDate ? formatShortDate(site.reportPublishedDate) : "Not applicable"}</strong></div>
            <div><span>Next due by</span><strong>{formatShortDate(timing.dueBy)}</strong></div>
          </div>
          <a className="button light" href={site.providerUrl} target="_blank" rel="noreferrer">Open Ofsted Page</a>
        </article>
        <article className="ofsted-card">
          <p className="eyebrow">Inspection pack</p>
          <h3>Site-specific evidence only.</h3>
          <p>{site.notes}</p>
          <div className="ofsted-pack-list">
            {["Site registration details", "Assigned staff SCR status", "Site rota and first aid/EYFS cover", "Policies and acknowledgements", "Complaints, accident and safeguarding logs", "Risk assessments and site procedures"].map((item) => <span key={item}><CheckCircle2 size={16} />{item}</span>)}
          </div>
        </article>
      </section>
      <OfstedEvidenceGaps
        site={site}
        gaps={evidenceGaps}
        owners={siteGapOwners}
        ownerOptions={ownerOptions}
        onUpdate={updateGapOwner}
      />
      <section className="ofsted-readiness-panel">
        <div>
          <p className="eyebrow">Evidence checklist</p>
          <h3>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention` : "Inspection pack looks ready"}</h3>
        </div>
        <TableWrap>
          <table>
            <thead><tr><th>Area</th><th>Status</th><th>Evidence</th><th>Next action</th></tr></thead>
            <tbody>
              {readinessRows.map((row) => (
                <tr key={row.area}>
                  <td>{row.area}</td>
                  <td><Badge value={row.status} /></td>
                  <td>{row.evidence}</td>
                  <td>{row.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
      <OfstedInspectionDayMode
        site={site}
        checks={siteInspectionDayChecks}
        onUpdate={updateInspectionDayCheck}
        onReset={resetInspectionDayChecks}
      />
      <OfstedSiteLogs site={site} logs={siteLogs} onAdd={addLog} onUpdate={updateLog} />
    </div>
  );
}

function OfstedEvidenceGaps({ site, gaps, owners, ownerOptions, onUpdate }) {
  const urgentGaps = gaps.filter((gap) => gap.status === "Missing").length;
  const ownedGaps = gaps.filter((gap) => owners[gap.area]?.owner).length;
  return (
    <section className={`ofsted-gap-panel ${gaps.length ? "has-gaps" : "clear"}`}>
      <div className="ofsted-gap-head">
        <div>
          <p className="eyebrow">Evidence gaps</p>
          <h3>{gaps.length ? `${gaps.length} blocker${gaps.length === 1 ? "" : "s"} before ${site.school} is inspection-ready` : `${site.school} has no current evidence blockers`}</h3>
          <p>{gaps.length ? "This pulls the non-ready items out of the checklist so the admin team can work from a short action list." : "Keep this clear by updating SCR records, rota cover, policies and site logs as evidence changes."}</p>
        </div>
        <div className="ofsted-gap-score">
          <strong>{urgentGaps}</strong>
          <span>urgent gap{urgentGaps === 1 ? "" : "s"}</span>
          {!!gaps.length && <small>{ownedGaps}/{gaps.length} owned</small>}
        </div>
      </div>
      {gaps.length ? (
        <div className="ofsted-gap-list">
          {gaps.map((gap) => (
            <article key={gap.area}>
              <div>
                <Badge value={gap.status} />
                <h4>{gap.area}</h4>
                <p>{gap.evidence}</p>
              </div>
              <div className="ofsted-gap-owner">
                <label>Owner
                  <select
                    value={owners[gap.area]?.owner || ""}
                    onChange={(event) => onUpdate(gap.area, { owner: event.target.value })}
                  >
                    <option value="">Suggested: {suggestOfstedOwner(gap.area)}</option>
                    {ownerOptions.map((owner) => <option key={owner.id} value={owner.name}>{owner.name} · {owner.role}</option>)}
                  </select>
                </label>
                <label>Due date
                  <input
                    type="date"
                    value={owners[gap.area]?.dueDate || ""}
                    onChange={(event) => onUpdate(gap.area, { dueDate: event.target.value })}
                  />
                </label>
                <label>Status
                  <select
                    value={owners[gap.area]?.status || "Not started"}
                    onChange={(event) => onUpdate(gap.area, { status: event.target.value })}
                  >
                    {ofstedGapStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label className="full">Note
                  <input
                    value={owners[gap.area]?.note || ""}
                    onChange={(event) => onUpdate(gap.area, { note: event.target.value })}
                    placeholder={gap.nextAction}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="ofsted-gap-clear">
          <CheckCircle2 size={20} />
          <span>Evidence checklist is currently clear for this site.</span>
        </div>
      )}
    </section>
  );
}

function OfstedInspectionDayMode({ site, checks, onUpdate, onReset }) {
  const complete = ofstedInspectionDayItems.filter((item) => checks[item.id]?.done).length;
  const progress = Math.round((complete / ofstedInspectionDayItems.length) * 100);
  const remaining = ofstedInspectionDayItems.length - complete;
  return (
    <section className="ofsted-day-panel">
      <div className="ofsted-day-head">
        <div>
          <p className="eyebrow">Inspection Day Mode</p>
          <h3>{site.school} day-of-readiness checklist</h3>
          <p>Use this when the call comes in or an inspector arrives. It keeps the team focused on the practical evidence needed for this site.</p>
        </div>
        <div className="ofsted-day-score">
          <strong>{progress}%</strong>
          <span>{remaining ? `${remaining} to confirm` : "Ready for inspection"}</span>
        </div>
      </div>
      <div className="ofsted-day-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="ofsted-day-list">
        {ofstedInspectionDayItems.map((item) => {
          const check = checks[item.id] || {};
          return (
            <article className={check.done ? "done" : ""} key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!!check.done}
                  onChange={(event) => onUpdate(item.id, { done: event.target.checked, checkedAt: event.target.checked ? new Date().toISOString() : "" })}
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
              </label>
              <input
                value={check.note || ""}
                onChange={(event) => onUpdate(item.id, { note: event.target.value })}
                placeholder="Optional note or owner"
                aria-label={`${item.title} note`}
              />
            </article>
          );
        })}
      </div>
      <div className="ofsted-day-actions">
        <button className="button light" type="button" onClick={onReset}>Reset This Site</button>
        <Badge value={remaining ? "In progress" : "Ready"} />
      </div>
    </section>
  );
}

function OfstedSiteLogs({ site, logs, onAdd, onUpdate }) {
  const types = ["Complaint", "Accident", "Safeguarding", "Inspection note", "Visitor note", "Premises/risk"];
  const nilReturnTypes = ["Complaint", "Accident", "Safeguarding"];
  const openLogs = logs.filter((log) => log.status !== "Closed").length;
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onAdd({
      type: form.get("type"),
      date: form.get("date"),
      summary: form.get("summary"),
      status: form.get("status"),
      owner: form.get("owner"),
      action: form.get("action"),
    });
    event.currentTarget.reset();
  }
  function submitNilReturn(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedTypes = form.getAll("nilTypes");
    const periodStart = form.get("periodStart");
    const periodEnd = form.get("periodEnd");
    if (!selectedTypes.length) return;
    onAdd({
      type: "Nil return",
      date: periodEnd,
      periodStart,
      periodEnd,
      nilTypes: selectedTypes,
      summary: `Nil return for ${selectedTypes.join(", ").toLowerCase()} records from ${formatShortDate(periodStart)} to ${formatShortDate(periodEnd)}.`,
      status: "Closed",
      owner: form.get("confirmedBy") || "Admin",
      action: "No entries were recorded for the selected categories during this period.",
    });
    event.currentTarget.reset();
  }
  return (
    <section className="ofsted-log-panel">
      <div className="ofsted-log-heading">
        <div>
          <p className="eyebrow">Site logs</p>
          <h3>{site.school} inspection evidence log</h3>
          <p>Keep complaints, accidents, safeguarding concerns and inspection notes separated by site.</p>
        </div>
        <Badge value={`${openLogs} open`} />
      </div>
      <form className="ofsted-log-form" onSubmit={submit}>
        <label>Type<select name="type">{types.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Date<input required type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Status<select name="status"><option>Open</option><option>Reviewing</option><option>Closed</option></select></label>
        <label>Owner<input name="owner" placeholder="DSL, site lead, ops..." /></label>
        <label className="full">Summary<textarea required name="summary" rows="2" placeholder="Brief factual record. Avoid unnecessary personal data." /></label>
        <label className="full">Action / resolution<textarea name="action" rows="2" placeholder="What happened next, resolution, parent/school communication or follow-up." /></label>
        <button className="button book" type="submit">Add Site Log</button>
      </form>
      <form className="ofsted-log-form ofsted-nil-form" onSubmit={submitNilReturn}>
        <div className="full ofsted-nil-copy">
          <p className="eyebrow">Nil return</p>
          <h4>Confirm there were no records for a period.</h4>
          <p>Useful for inspections when a site has no complaints, accidents or safeguarding entries to show.</p>
        </div>
        <label>Period start<input required type="date" name="periodStart" /></label>
        <label>Period end<input required type="date" name="periodEnd" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Confirmed by<input name="confirmedBy" placeholder="Admin or site lead" /></label>
        <div className="ofsted-nil-options">
          {nilReturnTypes.map((type) => (
            <label key={type}><input type="checkbox" name="nilTypes" value={type} defaultChecked /> {type}</label>
          ))}
        </div>
        <button className="button light" type="submit">Record Nil Return</button>
      </form>
      <TableWrap>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Summary</th><th>Status</th><th>Owner</th><th>Action</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatShortDate(log.date)}</td>
                <td>{log.type}</td>
                <td>{log.summary}</td>
                <td><select value={log.status} onChange={(event) => onUpdate(log.id, { status: event.target.value })}><option>Open</option><option>Reviewing</option><option>Closed</option></select></td>
                <td>{log.owner || "Unassigned"}</td>
                <td>{log.action || "No action recorded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!logs.length && <EmptyList title="No site logs yet" text="Record entries as they happen, or add a nil return to show a checked period with nothing to report." />}
    </section>
  );
}

function KingHouseInspectionEvidencePack({ site, timing, staff, evidenceRows, documents, documentLinks, rota, logs, onOpenStaff, onExportPdf }) {
  const managers = staff.filter((person) => String(person.role || "").toLowerCase().includes("manager"));
  const firstAiders = staff.filter((person) => staffMeetsRequirement(person, "firstAid"));
  const eyfsLeads = staff.filter((person) => staffMeetsRequirement(person, "eyfs"));
  const safeguardingStaff = staff.filter((person) => staffMeetsRequirement(person, "safeguarding"));
  const allergyStaff = staff.filter((person) => staffMeetsRequirement(person, "allergy"));
  const blockerRows = evidenceRows
    .map((row) => ({
      person: row.person,
      checks: row.checks.filter((check) => check.tone !== "ready" && check.tone !== "neutral"),
    }))
    .filter((row) => row.checks.length);
  const policyNames = [
    "Safeguarding Policy",
    "Behaviour Policy",
    "Health and Safety Policy",
    "Complaints Policy",
    "Illness and Accidents",
    "First Aid Policy",
    "Code of Conduct",
    "Staff Handbook",
  ];
  const policyRows = policyNames.map((name) => {
    const doc = documents.find((item) => item.name === name) || {};
    return {
      name,
      link: documentLinks[name] || doc.url || "",
      status: documentLinks[name] || doc.url ? "Linked" : "Add link",
      read: Number(doc.read || 0),
      assigned: Number(doc.assigned || 0),
      version: doc.version || "Current version",
    };
  });
  const coverRows = [
    ["Named manager", managers],
    ["First aider", firstAiders],
    ["EYFS Level 3+", eyfsLeads],
    ["Safeguarding trained", safeguardingStaff],
    ["Allergy aware", allergyStaff],
  ];
  const openLogs = logs.filter((log) => log.status !== "Closed");
  const dbsReadyCount = staff.filter((person) => staffDbsNumber(person)).length;
  const linkedPolicyCount = policyRows.filter((row) => row.link).length;
  const currentStaffRows = [...staff].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const mondayChecklist = [
    {
      label: "DBS numbers present",
      ready: staff.length > 0 && dbsReadyCount === staff.length,
      detail: `${dbsReadyCount}/${staff.length || 0} assigned staff`,
    },
    {
      label: "Named manager",
      ready: managers.length > 0,
      detail: managers.length ? managers.map((person) => person.name).join(", ") : "Add manager evidence",
    },
    {
      label: "First aider",
      ready: firstAiders.length > 0,
      detail: firstAiders.length ? firstAiders.map((person) => person.name).join(", ") : "Check rota cover",
    },
    {
      label: "EYFS Level 3",
      ready: eyfsLeads.length > 0,
      detail: eyfsLeads.length ? eyfsLeads.map((person) => person.name).join(", ") : "Assign qualified lead",
    },
    {
      label: "Safeguarding/allergy",
      ready: safeguardingStaff.length > 0 && allergyStaff.length > 0,
      detail: `${safeguardingStaff.length} safeguarding · ${allergyStaff.length} allergy`,
    },
    {
      label: "Policy links",
      ready: linkedPolicyCount >= Math.max(policyRows.length - 2, 1),
      detail: `${linkedPolicyCount}/${policyRows.length} core policies linked`,
    },
  ];
  const namedEvidence = buildKingHouseNamedEvidence(staff, evidenceRows);
  const questionPrompts = buildKingHouseInspectionPrompts(managers[0], firstAiders, eyfsLeads, safeguardingStaff, allergyStaff);
  return (
    <section className="khs-inspection-pack" id="khs-inspection-pack" aria-label="King's House inspection evidence pack">
      <div className="khs-inspection-pack-head">
        <div>
          <p className="eyebrow">Monday evidence pack</p>
          <h3>King&apos;s House inspection view</h3>
          <p>Everything here is scoped to staff and evidence assigned to King&apos;s House School only.</p>
        </div>
        <div className="khs-inspection-pack-actions">
          <Badge value={blockerRows.length ? `${blockerRows.length} staff to check` : "No SCR blockers"} />
          <button className="button book" type="button" onClick={onExportPdf}><Download size={16} /> Export PDF</button>
          {site?.providerUrl && <a className="button light" href={site.providerUrl} target="_blank" rel="noreferrer">Open Ofsted page</a>}
        </div>
      </div>
      <div className="khs-pack-summary">
        <div>
          <span>Registered provision</span>
          <strong>{site?.name || "King's House School"}</strong>
          <small>URN {site?.urn || "not linked"} · Registered {site?.registrationDate ? formatShortDate(site.registrationDate) : "date pending"}</small>
        </div>
        <div>
          <span>Inspection timing</span>
          <strong>{scheduledInspectionForSite(site)?.daysUntil ? `${scheduledInspectionForSite(site).daysUntil} days` : "Scheduled"}</strong>
          <small>{scheduledInspectionForSite(site)?.label || timing?.summary || "Check Ofsted timing"}</small>
        </div>
        <div>
          <span>Assigned staff</span>
          <strong>{staff.length}</strong>
          <small>Only King&apos;s House assigned staff are included.</small>
        </div>
        <div>
          <span>Open logs</span>
          <strong>{openLogs.length}</strong>
          <small>{openLogs.length ? "Review before inspection." : "No open site logs recorded."}</small>
        </div>
      </div>
      <article className="khs-current-staff" aria-label="Current King's House SCR staff">
        <div className="khs-pack-card-head">
          <div>
            <span>Current staff only</span>
            <h4>King&apos;s House SCR roster for inspection</h4>
          </div>
          <Badge value={`${currentStaffRows.length} active staff`} />
        </div>
        <TableWrap>
          <table>
            <thead><tr><th>Staff member</th><th>Role</th><th>DBS number</th><th>Certificate links</th><th>SCR checked</th><th>Status</th></tr></thead>
            <tbody>
              {currentStaffRows.map((person) => {
                const dbsNumber = staffDbsNumber(person);
                const updateService = staffDbsUpdateServiceLabel(person);
                const dbsClearDate = staffDbsClearDate(person);
                const evidenceLinks = staffInspectionEvidenceLinks(person, evidenceRows);
                return (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong>{person.email && <><br /><small>{person.email}</small></>}</td>
                    <td>{person.role || "Staff"}</td>
                    <td>
                      <strong>{dbsNumber || "Not recorded"}</strong>
                      {dbsClearDate && <><br /><small>Clear {formatShortDate(dbsClearDate)}</small></>}
                      {updateService && <><br /><small>{updateService}</small></>}
                    </td>
                    <td>
                      <div className="khs-roster-evidence-links">
                        {evidenceLinks.slice(0, 5).map((link) => (
                          <a href={link.href} key={`${person.id}-${link.key}-${link.href}`} target="_blank" rel="noreferrer" title={link.title}>
                            {link.label}
                          </a>
                        ))}
                        {evidenceLinks.length > 5 && <small>+{evidenceLinks.length - 5} more on profile</small>}
                        {!evidenceLinks.length && <button type="button" onClick={() => onOpenStaff(person.id)}>Open profile</button>}
                      </div>
                    </td>
                    <td>{staffScrCheckedDate(person) ? formatShortDate(staffScrCheckedDate(person)) : "Not recorded"}</td>
                    <td><Badge value={person.compliance || (person.scrChecklist?.approvedAt ? "Compliant" : "Review needed")} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {!currentStaffRows.length && <p className="empty-inline">No active King&apos;s House staff are currently assigned.</p>}
      </article>
      <article className="khs-named-evidence" aria-label="King's House named evidence shortcuts">
        <div className="khs-pack-card-head">
          <div>
            <span>Named evidence</span>
            <h4>Open these first if the inspector asks</h4>
          </div>
          <Badge value={`${namedEvidence.filter((item) => item.ready).length}/${namedEvidence.length} ready`} />
        </div>
        <div className="khs-named-evidence-grid">
          {namedEvidence.map((item) => (
            <article className={item.ready ? "ready" : "check"} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <div>
                {item.file?.fileUrl ? <a href={item.file.fileUrl} target="_blank" rel="noreferrer">View file</a> : <em>{item.ready ? "Open profile" : "Evidence needed"}</em>}
                {item.person?.id && <button type="button" onClick={() => onOpenStaff(item.person.id)}>Staff profile</button>}
              </div>
            </article>
          ))}
        </div>
      </article>
      <article className="khs-question-prompts" aria-label="King's House inspection question prompts">
        <div className="khs-pack-card-head">
          <div>
            <span>Staff prompts</span>
            <h4>Likely inspection questions to rehearse</h4>
          </div>
          <Badge value={`${questionPrompts.length} prompts`} />
        </div>
        <div className="khs-question-grid">
          {questionPrompts.map((prompt) => (
            <article key={prompt.question}>
              <span>{prompt.area}</span>
              <strong>{prompt.question}</strong>
              <small>{prompt.answer}</small>
              <em>{prompt.evidence}</em>
            </article>
          ))}
        </div>
      </article>
      <article className="khs-ready-checklist">
        <div className="khs-pack-card-head">
          <div>
            <span>Before Monday</span>
            <h4>Inspection-ready physical checks</h4>
          </div>
          <Badge value={mondayChecklist.every((item) => item.ready) ? "Ready" : `${mondayChecklist.filter((item) => !item.ready).length} to check`} />
        </div>
        <div className="khs-ready-grid">
          {mondayChecklist.map((item) => (
            <div className={item.ready ? "ready" : "check"} key={item.label}>
              <span>{item.ready ? "Ready" : "Check"}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </article>
      <div className="khs-pack-grid">
        <article className="khs-pack-card">
          <div className="khs-pack-card-head">
            <div>
              <span>People evidence</span>
              <h4>Named cover and leadership</h4>
            </div>
            <Badge value={coverRows.every(([, people]) => people.length) ? "Covered" : "Check gaps"} />
          </div>
          <div className="khs-pack-list">
            {coverRows.map(([label, people]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{people.length ? people.map((person) => person.name).join(", ") : "Gap to resolve"}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="khs-pack-card">
          <div className="khs-pack-card-head">
            <div>
              <span>SCR blockers</span>
              <h4>Open these records first</h4>
            </div>
            <Badge value={blockerRows.length ? "Action" : "Clear"} />
          </div>
          <div className="khs-pack-list">
            {blockerRows.length ? blockerRows.slice(0, 6).map((row) => (
              <button className="khs-pack-staff-link" type="button" key={row.person.id} onClick={() => onOpenStaff(row.person.id)}>
                <strong>{row.person.name}</strong>
                <span>{row.checks.map((check) => check.label).join(", ")}</span>
              </button>
            )) : <p className="empty-inline">No blocker rows are currently flagged for King&apos;s House.</p>}
          </div>
        </article>
        <article className="khs-pack-card">
          <div className="khs-pack-card-head">
            <div>
              <span>Site operation</span>
              <h4>Session and register context</h4>
            </div>
            <Badge value={rota.length ? "Configured" : "Missing"} />
          </div>
          <div className="khs-pack-list">
            {rota.length ? rota.map((item) => (
              <div key={item.id}>
                <strong>{item.type}</strong>
                <span>{item.sessionStart}-{item.sessionEnd} · setup {item.setupMinutes} mins · cleanup {item.cleanupMinutes} mins</span>
              </div>
            )) : <p className="empty-inline">No rota window is currently configured for this site.</p>}
          </div>
        </article>
      </div>
      <article className="khs-policy-pack">
        <div className="khs-pack-card-head">
          <div>
            <span>Documents to have ready</span>
            <h4>Core policies and evidence links</h4>
          </div>
          <Badge value={`${policyRows.filter((row) => row.link).length}/${policyRows.length} linked`} />
        </div>
        <div className="khs-policy-grid">
          {policyRows.map((doc) => (
            <div className={doc.link ? "linked" : "missing"} key={doc.name}>
              <span>{doc.name}</span>
              <strong>{doc.status}</strong>
              <small>{doc.assigned ? `${doc.read}/${doc.assigned} acknowledgements` : doc.version}</small>
              {doc.link ? <a href={doc.link} target="_blank" rel="noreferrer">Open document</a> : <em>Add in Documents</em>}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function buildKingHouseInspectionPrompts(manager, firstAiders = [], eyfsLeads = [], safeguardingStaff = [], allergyStaff = []) {
  const managerName = manager?.name || "Rama";
  const firstAidNames = namesOrGap(firstAiders);
  const eyfsNames = namesOrGap(eyfsLeads);
  const safeguardingNames = namesOrGap(safeguardingStaff);
  const allergyNames = namesOrGap(allergyStaff);
  return [
    {
      area: "Safeguarding",
      question: "What would you do if a child made a disclosure?",
      answer: `Stay calm, listen, do not promise confidentiality, write factual notes and escalate to the DSL route. ${managerName} is the named site lead for King's House.`,
      evidence: `Show: safeguarding policy, DSL evidence, staff SCR checks. Covered by: ${safeguardingNames}.`,
    },
    {
      area: "Ratios and supervision",
      question: "How do you know children are safely supervised?",
      answer: "Explain the register, headcounts, collection routines, handover points and how staff are positioned during active play, snack and dismissal.",
      evidence: "Show: site rota, session times, assigned staff list and register process.",
    },
    {
      area: "First aid",
      question: "Who is first aid trained today?",
      answer: `Name the trained person on site, where the first aid kit is kept, and how accidents are recorded and shared with parents.`,
      evidence: `Show: first aid certificate and incident/accident procedure. Covered by: ${firstAidNames}.`,
    },
    {
      area: "EYFS",
      question: "How do you support younger children?",
      answer: "Talk through settling, choice, toileting/comfort routines, age-appropriate activities, and when EYFS-qualified oversight is used.",
      evidence: `Show: EYFS Level 3 evidence and site routine. Covered by: ${eyfsNames}.`,
    },
    {
      area: "Allergies",
      question: "How are allergies and medical needs managed?",
      answer: "Describe checking records before snack, named staff awareness, avoiding cross-contamination and escalation if a child becomes unwell.",
      evidence: `Show: allergy awareness evidence, illness/accident policy and snack routine. Covered by: ${allergyNames}.`,
    },
  ];
}

function namesOrGap(people = []) {
  return people.length ? people.map((person) => person.name).join(", ") : "gap to confirm";
}

function buildKingHouseNamedEvidence(staff = [], evidenceRows = []) {
  const rama = staff.find((person) => {
    const text = `${person.name || ""} ${person.fullName || ""} ${person.email || ""}`.toLowerCase();
    return text.includes("rama") && text.includes("singh");
  }) || staff.find((person) => String(person.role || "").toLowerCase().includes("manager"));
  const ramaEvidence = rama?.scrChecklist?.evidence || {};
  const ramaRow = evidenceRows.find((row) => row.person.id === rama?.id);
  const checkFile = (key) => ramaRow?.checks.find((check) => check.key === key)?.file;
  const evidenceFile = (key) => {
    const evidence = ramaEvidence[key] || {};
    return checkFile(key) || (evidence.storagePath ? { title: evidence.title || evidence.reference, storagePath: evidence.storagePath } : null);
  };
  const safeguarding = ramaEvidence.safeguarding || {};
  const firstAid = ramaEvidence.firstAid || {};
  const send = ramaEvidence.eyfsLevel || {};

  return [
    {
      label: "Site manager",
      title: rama ? rama.name : "Manager not selected",
      detail: rama ? `${rama.role || "Manager"} · ${rama.location || "King's House School"}` : "Add the named King’s House manager.",
      ready: Boolean(rama),
      person: rama,
    },
    {
      label: "DSL / safeguarding",
      title: safeguarding.reference || "Safeguarding evidence missing",
      detail: safeguarding.issueDate || safeguarding.completionDate
        ? `Completed ${formatShortDate(safeguarding.completionDate || safeguarding.issueDate)}${safeguarding.expiryDate ? ` · expires ${formatShortDate(safeguarding.expiryDate)}` : " · no expiry shown"}`
        : "Open Rama’s SCR profile and attach the DSL certificate.",
      ready: Boolean(safeguarding.reference || evidenceFile("safeguarding")),
      file: evidenceFile("safeguarding"),
      person: rama,
    },
    {
      label: "Paediatric first aid",
      title: firstAid.reference || firstAid.qualification || "First aid evidence missing",
      detail: firstAid.expiryDate
        ? `Issued ${formatShortDate(firstAid.issueDate)} · expires ${formatShortDate(firstAid.expiryDate)}`
        : "Add issue and expiry dates for the first aid certificate.",
      ready: Boolean(firstAid.reference && firstAid.expiryDate),
      file: evidenceFile("firstAid"),
      person: rama,
    },
    {
      label: "SEND inclusion",
      title: send.reference || "SEND evidence missing",
      detail: send.issueDate ? `Dated ${formatShortDate(send.issueDate)} · no expiry shown` : "Attach SEND / inclusion evidence if relevant.",
      ready: Boolean(send.reference || evidenceFile("eyfsLevel")),
      file: evidenceFile("eyfsLevel"),
      person: rama,
    },
  ];
}

function SCRInspectionLaunchPanel({ site, timing, school, staff, rows, score, attentionCount, staffEvidenceGaps, scheduledInspection }) {
  const urgentRows = rows.filter((row) => row.status !== "Ready");
  const firstAiders = staff.filter((person) => staffMeetsRequirement(person, "firstAid"));
  const eyfsLeads = staff.filter((person) => staffMeetsRequirement(person, "eyfs"));
  const safeguardingStaff = staff.filter((person) => staffMeetsRequirement(person, "safeguarding"));
  const allergyStaff = staff.filter((person) => staffMeetsRequirement(person, "allergy"));
  const inspectionMetric = scheduledInspection
    ? { label: "Inspection", value: scheduledInspection.daysUntil ? `${scheduledInspection.daysUntil} days` : "Today", tone: "amber" }
    : { label: "Ofsted window", value: timing?.status || "Check site", tone: timing?.tone === "bad" || timing?.tone === "warn" ? "amber" : "green" };
  return (
    <section className="scr-inspection-launch" aria-label={`${school} SCR launch readiness`}>
      <div className="scr-inspection-launch-head">
        <div>
          <p className="eyebrow">Site compliance</p>
          <h3>{school} readiness overview</h3>
          <p>
            {scheduledInspection ? `${scheduledInspection.label}. ` : ""}
            Assigned staff, required cover, evidence gaps and assurance outputs in one calm view.
          </p>
        </div>
        <div className="scr-inspection-score">
          <strong>{score}%</strong>
          <span>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} to fix` : "ready"}</span>
        </div>
      </div>
      <div className="scr-inspection-metrics">
        <Metric icon={<ShieldCheck />} label="Assigned staff" value={staff.length} tone={staff.length ? "blue" : "amber"} />
        <Metric icon={<Bell />} label={inspectionMetric.label} value={inspectionMetric.value} tone={inspectionMetric.tone} />
        <Metric icon={<FileText />} label="URN" value={site?.urn || "Not linked"} tone={site ? "green" : "amber"} />
        <Metric icon={<CheckCircle2 />} label="Window" value={timing?.status || "Check site"} tone={attentionCount ? "amber" : "green"} />
      </div>
      <div className="scr-inspection-grid">
        <article className="scr-inspection-card">
          <div className="scr-inspection-card-head">
            <div>
              <span>Required cover</span>
              <h4>Named staff for key requirements</h4>
            </div>
            <Badge value={firstAiders.length && eyfsLeads.length && safeguardingStaff.length && allergyStaff.length ? "Covered" : "Gaps"} />
          </div>
          <div className="inspection-cover-list">
            {[
              ["First aider", firstAiders],
              ["EYFS Level 3+", eyfsLeads],
              ["Safeguarding", safeguardingStaff],
              ["Allergy awareness", allergyStaff],
            ].map(([label, people]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{people.length ? people.map((person) => person.name).join(", ") : "Gap to resolve"}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="scr-inspection-card">
          <div className="scr-inspection-card-head">
            <div>
              <span>Staff evidence</span>
              <h4>Missing records to clear first</h4>
            </div>
            <Badge value={staffEvidenceGaps.length ? "Action needed" : "Clear"} />
          </div>
          <div className="inspection-gap-list">
            {staffEvidenceGaps.length ? staffEvidenceGaps.map(({ person, gaps }) => (
              <div key={person.id}>
                <strong>{person.name}</strong>
                <span>{gaps.join(", ")}</span>
              </div>
            )) : <p className="empty-inline">No named staff evidence gaps found for this site.</p>}
          </div>
        </article>
        <article className="scr-inspection-card">
          <div className="scr-inspection-card-head">
            <div>
              <span>Operational checks</span>
              <h4>Site-level actions still open</h4>
            </div>
            <Badge value={urgentRows.length ? `${urgentRows.length} gaps` : "Ready"} />
          </div>
          <div className="inspection-gap-list">
            {urgentRows.length ? urgentRows.map((row) => (
              <div key={row.area}>
                <strong>{row.area}</strong>
                <span>{row.nextAction}</span>
              </div>
            )) : <p className="empty-inline">Site readiness checks are currently clear.</p>}
          </div>
        </article>
      </div>
      {site ? (
        <div className="scr-inspection-registration">
          <span>{site.name}</span>
          <strong>URN {site.urn}</strong>
          <span>Registered {formatShortDate(site.registrationDate)}</span>
          <span>{site.lastInspectionDate ? `Last inspected ${formatShortDate(site.lastInspectionDate)}` : "Not yet inspected"}</span>
          {timing?.dueBy && <span>Expected due by {formatShortDate(timing.dueBy)}</span>}
        </div>
      ) : (
        <div className="scr-inspection-registration warning">
          <strong>No Ofsted registration record is linked to {school}.</strong>
          <span>Check the Ofsted page before generating assurance evidence.</span>
        </div>
      )}
    </section>
  );
}

function SCRAssignmentsPanel({ staff, schools, onAdd, onRemove, onUpdate }) {
  const statuses = ["Active", "Scheduled", "Cover", "Paused", "Ended"];
  return (
    <section className="scr-assignments">
      <div className="scr-assignments-heading">
        <div>
          <p className="eyebrow">School assignments</p>
          <h3>Control which staff appear on each school assurance letter.</h3>
          <p>Assign staff to one or more schools/sites with active dates and assignment status. The selected school export only includes staff listed here.</p>
        </div>
      </div>
      <div className="assignment-list">
        {staff.map((person) => {
          const assignments = person.siteAssignments || staffAssignments(person);
          return (
            <article className="assignment-card" key={person.id}>
              <div className="assignment-person">
                <div>
                  <h4>{person.name}</h4>
                  <p>{person.role} · {assignments.length} assignment{assignments.length === 1 ? "" : "s"}</p>
                </div>
                <button className="button light" type="button" onClick={() => onAdd(person.id)}>Add Site</button>
              </div>
              <div className="assignment-rows">
                {assignments.map((assignment, index) => (
                  <div className="assignment-row" key={`${person.id}-${index}`}>
                    <label>
                      School / site
                      <select value={assignment.school} onChange={(event) => onUpdate(person.id, index, { school: event.target.value })}>
                        {schools.map((school) => <option key={school} value={school}>{school}</option>)}
                      </select>
                    </label>
                    <label>
                      Assignment role
                      <input value={assignment.role || person.role} onChange={(event) => onUpdate(person.id, index, { role: event.target.value })} />
                    </label>
                    <label>
                      Start date
                      <input type="date" value={assignment.startDate || ""} onChange={(event) => onUpdate(person.id, index, { startDate: event.target.value })} />
                    </label>
                    <label>
                      End date
                      <input type="date" value={assignment.endDate || ""} onChange={(event) => onUpdate(person.id, index, { endDate: event.target.value })} />
                    </label>
                    <label>
                      Status
                      <select value={assignment.status || "Active"} onChange={(event) => onUpdate(person.id, index, { status: event.target.value })}>
                        {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                    <button className="button light assignment-remove" type="button" onClick={() => onRemove(person.id, index)}>Remove</button>
                  </div>
                ))}
                {!assignments.length && <p className="panel-note">No assignments yet. Add a site before including this person on a school assurance letter.</p>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function applyScrChecklistState(staff) {
  const state = readScrChecklistState();
  return staff.map((person) => ({
    ...person,
    scrChecklist: state[person.id] || person.scrChecklist || {},
  }));
}

function buildScrSiteEvidenceRows(staff = [], hrFiles = [], evidenceRequests = {}) {
  return staff.map((person) => {
    const checks = [
      scrEvidenceBoardCheck(person, "dbs", "DBS", person.dbsRenewal, hrFiles, evidenceRequests),
      scrEvidenceBoardCheck(person, "safeguarding", "Safeguarding", person.safeguardingExpiry, hrFiles, evidenceRequests),
      scrEvidenceBoardCheck(person, "allergy", "Allergy", person.allergyAwarenessExpiry, hrFiles, evidenceRequests),
      scrEvidenceBoardCheck(person, "firstAid", "First aid", person.firstAidExpiry, hrFiles, evidenceRequests),
      scrEvidenceBoardCheck(person, "eyfsLevel", "EYFS Level 3", person.eyfsLevel, hrFiles, evidenceRequests),
      scrReferenceEvidenceCheck(person, hrFiles, evidenceRequests),
      scrSuitabilityEvidenceCheck(person),
      scrEvidenceBoardCheck(person, "adminReview", "Admin review", person.scrChecklist?.approvedAt || person.compliance, hrFiles, evidenceRequests),
    ];
    return {
      person,
      checks,
      ready: checks.every((check) => check.tone === "ready" || check.tone === "neutral"),
    };
  }).sort((a, b) => {
    const actionDiff = Number(a.ready) - Number(b.ready);
    return actionDiff || a.person.name.localeCompare(b.person.name);
  });
}

function scrReferenceEvidenceCheck(person, hrFiles, evidenceRequests) {
  const key = "references";
  const evidence = person.scrChecklist?.evidence?.references || {};
  const request = evidenceRequests?.[`${person.id}-${key}`] || {};
  const file = findScrEvidenceFile(person, evidence, "References", hrFiles);
  const summary = referenceAnswerSummary(evidence).filter(Boolean);
  const received = Boolean(person.scrChecklist?.references || evidence.referencesReceived || evidence.referenceReceived || evidence.referenceCount > 0 || evidence.reference || file);
  const wouldReemploy = evidence.wouldReemploy ?? evidence.wouldEmployAgain;
  const safeguardingConcerns = evidence.safeguardingConcerns;
  const recommended = evidence.recommendedForChildren ?? evidence.recommendForChildrenRole;
  const requiredAnswersRecorded = wouldReemploy !== undefined && safeguardingConcerns !== undefined && recommended !== undefined;
  const cleanAnswers = wouldReemploy !== false && safeguardingConcerns !== true && recommended !== false;
  if (received && requiredAnswersRecorded && cleanAnswers) {
    return {
      key,
      label: "References",
      status: "Complete",
      detail: summary.join(" · "),
      tone: "ready",
      file,
    };
  }
  if (received) {
    return {
      key,
      label: "References",
      status: cleanAnswers ? "Answers needed" : "Review",
      detail: summary.join(" · "),
      tone: cleanAnswers ? "warn" : "bad",
      file,
    };
  }
  return {
    key,
    label: "References",
    status: request.status || "Missing",
    detail: request.note || "No reference evidence recorded.",
    tone: request.status === "Requested" || request.status === "Submitted" ? "warn" : "bad",
    file,
  };
}

function scrSuitabilityEvidenceCheck(person) {
  const state = suitabilityDeclarationState(person);
  const tone = state.tone === "ready" ? "ready" : state.tone === "pending" ? "warn" : "bad";
  return {
    key: "annualSuitability",
    label: "Annual suitability",
    status: state.label,
    detail: state.detail,
    tone,
    file: null,
  };
}

function scrEvidenceBoardCheck(person, key, label, profileValue, hrFiles, evidenceRequests) {
  const evidenceKey = key === "eyfsLevel" ? "eyfsLevel" : key;
  const evidence = person.scrChecklist?.evidence?.[evidenceKey] || {};
  const request = evidenceRequests?.[`${person.id}-${evidenceKey}`] || {};
  const file = findScrEvidenceFile(person, evidence, label, hrFiles);
  const value = String(profileValue || evidence.expiryDate || evidence.reference || "").trim();
  const lowerValue = value.toLowerCase();
  const noExpiry = lowerValue === "no expiry stated" || evidence.noExpiryStated;
  const status = evidenceExpiryStatus({ expiryDate: evidence.expiryDate || profileValue });

  if (key === "adminReview") {
    const approved = Boolean(person.scrChecklist?.approvedAt) || person.compliance === "Compliant";
    return {
      key,
      label,
      status: approved ? "Approved" : request.status || "Needs review",
      detail: approved
        ? person.scrChecklist?.approvedAt ? `Approved ${formatShortDate(person.scrChecklist.approvedAt)}` : "Marked compliant"
        : "Open the record and complete admin review.",
      tone: approved ? "ready" : "warn",
      file,
    };
  }

  if (key === "eyfsLevel") {
    const hasLevel3 = String(person.eyfsLevel || evidence.reference || evidence.status || "").toLowerCase().includes("level 3");
    const pending = evidence.status === "Evidence pending" || request.status === "Requested";
    return {
      key,
      label,
      status: hasLevel3 ? (pending ? "Pending evidence" : "On file") : "Missing",
      detail: hasLevel3
        ? file ? file.title : pending ? "Qualification recorded, certificate still needed." : "Level 3 Early Years qualification recorded."
        : "No Level 3 EYFS evidence recorded.",
      tone: hasLevel3 ? (pending ? "warn" : "ready") : "bad",
      file,
    };
  }

  if (lowerValue === "not required") {
    return { key, label, status: "Not required", detail: "Not required for this role/site record.", tone: "neutral", file };
  }

  if (status === "Expired") {
    return { key, label, status: "Expired", detail: value ? `Expired ${formatShortDate(value)}` : "Expiry date has passed.", tone: "bad", file };
  }
  if (status === "Expiring soon") {
    return { key, label, status: "Expiring soon", detail: value ? `Expires ${formatShortDate(value)}` : "Renewal date is close.", tone: "warn", file };
  }
  if (hasValidDate(value) || evidence.reference || file) {
    return {
      key,
      label,
      status: noExpiry ? "No expiry stated" : status || "On file",
      detail: file?.title || evidence.reference || (value ? `${noExpiry ? "Evidence" : "Date"}: ${noExpiry ? "certificate does not state an expiry" : formatShortDate(value)}` : "Evidence recorded."),
      tone: "ready",
      file,
    };
  }

  return {
    key,
    label,
    status: request.status || "Missing",
    detail: request.note || "No evidence recorded yet.",
    tone: request.status === "Requested" || request.status === "Submitted" ? "warn" : "bad",
    file,
  };
}

function findScrEvidenceFile(person, evidence = {}, label = "", hrFiles = []) {
  const files = (hrFiles || []).filter((file) => file.staffRecordId === person.id && file.status !== "archived");
  if (!files.length) return null;
  if (evidence.fileId) {
    const file = files.find((item) => item.id === evidence.fileId);
    if (file) return file;
  }
  if (evidence.storagePath) {
    const file = files.find((item) => item.storagePath === evidence.storagePath);
    if (file) return file;
  }
  const tokens = [
    evidence.reference,
    evidence.certificateTitle,
    evidence.provider,
    label,
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  return files.find((file) => {
    const haystack = `${file.title || ""} ${file.category || ""} ${file.notes || ""}`.toLowerCase();
    return tokens.some((token) => token && (haystack.includes(token) || token.includes(file.title?.toLowerCase?.() || "__no_title__")));
  }) || null;
}

function buildScrRenewalItems(staff) {
  const labels = {
    rightToWork: "Right to work",
    identity: "Identity / address",
    dbs: "Enhanced DBS",
    barredList: "Barred list",
    safeguarding: "Safeguarding",
    allergy: "Allergy awareness",
    references: "References",
    declarations: "Annual declarations",
    firstAid: "First aid",
  };
  const profileFallbacks = [
    ["dbs", "dbsRenewal"],
    ["safeguarding", "safeguardingExpiry"],
    ["allergy", "allergyAwarenessExpiry"],
    ["firstAid", "firstAidExpiry"],
  ];
  return staff.flatMap((person) => {
    const evidenceItems = Object.entries(person.scrChecklist?.evidence || {}).map(([key, evidence]) => {
    const status = evidenceExpiryStatus(evidence);
    const days = evidenceExpiryDays(evidence);
    return {
      id: `${person.id}-${key}`,
      staffId: person.id,
      staffName: person.name,
      evidenceKey: key,
      check: labels[key] || key,
      status,
      days,
      expiryDate: evidence.expiryDate,
      reference: evidence.reference,
      verifiedBy: evidence.verifiedBy,
      source: "SCR evidence",
    };
    });
    const evidenceKeys = new Set(Object.keys(person.scrChecklist?.evidence || {}));
    const profileItems = profileFallbacks
      .filter(([key]) => !evidenceKeys.has(key))
      .map(([key, field]) => {
        const expiryDate = person[field];
        if (!hasValidDate(expiryDate)) return null;
        const evidence = { expiryDate };
        const status = evidenceExpiryStatus(evidence);
        const days = evidenceExpiryDays(evidence);
        return {
          id: `${person.id}-${key}`,
          staffId: person.id,
          staffName: person.name,
          evidenceKey: key,
          check: labels[key] || key,
          status,
          days,
          expiryDate,
          reference: "Profile expiry date",
          verifiedBy: "Staff profile",
          source: "Staff profile",
        };
      })
      .filter(Boolean);
    return [...evidenceItems, ...profileItems];
  }).filter((item) => item.status === "Expired" || item.status === "Expiring soon").sort((a, b) => a.days - b.days);
}

function scrEvidenceLabel(key) {
  const labels = {
    rightToWork: "Right to work",
    identity: "Identity / address",
    dbs: "Enhanced DBS",
    barredList: "Barred list",
    safeguarding: "Safeguarding",
    allergy: "Allergy awareness",
    eyfsLevel: "EYFS Level 3",
    references: "References",
    declarations: "Annual declarations",
    firstAid: "First aid",
  };
  return labels[key] || key;
}

function splitScrRequestId(id) {
  const keys = ["rightToWork", "identity", "dbs", "barredList", "safeguarding", "allergy", "eyfsLevel", "references", "declarations", "firstAid"];
  const key = keys.find((item) => id.endsWith(`-${item}`));
  if (!key) return { staffId: "", evidenceKey: "" };
  return { staffId: id.slice(0, -(key.length + 1)), evidenceKey: key };
}

function appendScrRequestHistory(request, type, by, note = "") {
  return {
    ...request,
    history: [
      ...(request.history || []),
      {
        id: `${Date.now()}-${type}`,
        type,
        at: new Date().toISOString(),
        by,
        note,
      },
    ],
  };
}

function buildScrEvidenceHistory(request = {}) {
  if (Array.isArray(request.history) && request.history.length) {
    return [...request.history].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  }
  const events = [];
  if (request.requestedAt) events.push({ id: "requested", type: "Requested", at: request.requestedAt, by: request.requestedBy || "Admin", note: request.note || "Evidence requested." });
  if (request.submittedAt) events.push({ id: "submitted", type: request.resubmittedAt ? "Submitted" : "Submitted", at: request.submittedAt, by: request.submittedBy || "Staff", note: request.submissionNote || "Evidence submitted for review." });
  if (request.resubmittedAt) events.push({ id: "resubmitted", type: "Resubmitted", at: request.resubmittedAt, by: request.submittedBy || "Staff", note: request.submissionNote || "Evidence resubmitted for review." });
  if (request.reviewedAt && request.status === "Rejected") events.push({ id: "rejected", type: "Sent back", at: request.reviewedAt, by: request.reviewedBy || "Admin", note: request.rejectionReason || "Evidence sent back for correction." });
  if (request.reviewedAt && request.status === "Approved") events.push({ id: "approved", type: "Approved", at: request.reviewedAt, by: request.reviewedBy || "Admin", note: "Evidence approved." });
  if (request.clearedAt) events.push({ id: "cleared", type: "Cleared", at: request.clearedAt, by: request.clearedBy || "Admin", note: "Evidence request cleared." });
  return events.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

function buildStaffEvidenceRequests(staff, renewalItems, requests = {}) {
  const renewalById = Object.fromEntries(renewalItems.map((item) => [item.id, item]));
  const staffPrefix = `${staff.id}-`;
  return Object.entries(requests)
    .map(([id, request]) => {
      if (!id.startsWith(staffPrefix) || !["Requested", "Rejected", "Submitted", "Approved"].includes(request.status)) return null;
      const evidenceKey = id.slice(staffPrefix.length);
      const renewalItem = renewalById[id];
      const evidence = staff.scrChecklist?.evidence?.[evidenceKey] || {};
      const expiryDate = renewalItem?.expiryDate || evidence.expiryDate;
      const status = renewalItem?.status || evidenceExpiryStatus(evidence) || "Requested";
      const dateText = expiryDate ? formatShortDate(expiryDate) : "No date recorded";
      const rejected = request.status === "Rejected";
      const submitted = request.status === "Submitted";
      const approved = request.status === "Approved";
      return {
        id,
        staffId: staff.id,
        evidenceKey,
        check: renewalItem?.check || scrEvidenceLabel(evidenceKey),
        title: `${renewalItem?.check || scrEvidenceLabel(evidenceKey)} evidence`,
        meta: rejected
          ? "Sent back · please resubmit"
          : submitted
            ? "Submitted · waiting for admin review"
            : approved
              ? "Approved · no action needed"
              : `${status} · ${status === "Expired" ? "expired" : `due ${dateText}`}`,
        request,
        history: buildScrEvidenceHistory(request),
        status: request.status,
        rejected,
        submitted,
        approved,
        previousReference: evidence.reference,
        previousNote: evidence.note,
      };
    })
    .filter(Boolean);
}

function buildStaffProfileEvidenceRequests(staff, requests = {}) {
  const staffPrefix = `${staff.id}-`;
  return Object.entries(requests)
    .map(([id, request]) => {
      if (!id.startsWith(staffPrefix) || request.status === "Cleared") return null;
      const evidenceKey = id.slice(staffPrefix.length);
      const evidence = staff.scrChecklist?.evidence?.[evidenceKey] || {};
      return {
        id,
        staffId: staff.id,
        evidenceKey,
        check: scrEvidenceLabel(evidenceKey),
        status: request.status || "Requested",
        requestedAt: request.requestedAt,
        requestedBy: request.requestedBy,
        note: request.note || request.rejectionReason || request.submissionNote || evidence.note || "",
        history: buildScrEvidenceHistory(request),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
}

function buildSubmittedEvidenceReviews(staff, requests = {}) {
  const staffById = Object.fromEntries(staff.map((person) => [person.id, person]));
  return Object.entries(requests)
    .map(([id, request]) => {
      if (request.status !== "Submitted") return null;
      const { staffId, evidenceKey } = splitScrRequestId(id);
      const person = staffById[staffId];
      if (!person) return null;
      const evidence = person.scrChecklist?.evidence?.[evidenceKey] || {};
      return {
        id,
        staffId,
        staffName: person.name,
        evidenceKey,
        check: scrEvidenceLabel(evidenceKey),
        reference: evidence.reference || "No reference recorded",
        expiryDate: evidence.expiryDate,
        submittedAt: request.submittedAt || evidence.submittedAt,
        submittedBy: request.submittedBy || evidence.submittedBy || person.name,
        note: evidence.note || request.submissionNote || "No note",
        history: buildScrEvidenceHistory(request),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
}

function buildEvidenceWorkflowItems(staff, renewalItems, requests = {}) {
  const staffById = Object.fromEntries(staff.map((person) => [person.id, person]));
  const renewalById = Object.fromEntries(renewalItems.map((item) => [item.id, item]));
  const requestItems = Object.entries(requests).map(([id, request]) => {
    const { staffId, evidenceKey } = splitScrRequestId(id);
    const person = staffById[staffId];
    if (!person) return null;
    const evidence = person.scrChecklist?.evidence?.[evidenceKey] || {};
    const renewalItem = renewalById[id];
    return {
      id,
      staffName: person.name,
      check: renewalItem?.check || scrEvidenceLabel(evidenceKey),
      status: request.status || "Requested",
      reference: evidence.reference || renewalItem?.reference || "No reference recorded",
      updatedAt: request.reviewedAt || request.submittedAt || request.requestedAt || request.clearedAt || evidence.submittedAt || "",
      owner: request.reviewedBy || request.submittedBy || request.requestedBy || "Admin",
      note: request.rejectionReason || request.submissionNote || evidence.note || request.note || "",
      history: buildScrEvidenceHistory(request),
    };
  }).filter(Boolean);
  const requestedIds = new Set(requestItems.map((item) => item.id));
  const promptItems = renewalItems
    .filter((item) => !requestedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      staffName: item.staffName,
      check: item.check,
      status: "Prompt",
      reference: item.reference || "No reference recorded",
      updatedAt: item.expiryDate || "",
      owner: item.verifiedBy || "Not assigned",
      note: item.status,
      history: [],
    }));
  return [...requestItems, ...promptItems].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function buildScrRenewalActions(items, requests = {}) {
  return items.slice(0, 6).map((item) => {
    const dateText = item.expiryDate ? formatShortDate(item.expiryDate) : "No date recorded";
    const urgency = item.status === "Expired" ? "Request updated evidence now" : `Renew before ${dateText}`;
    const request = requests[item.id] && requests[item.id].status !== "Cleared" ? requests[item.id] : null;
    return {
      id: item.id,
      title: `${item.check} · ${item.staffName}`,
      meta: `${item.status} · ${urgency}`,
      detail: `${item.reference || "No evidence reference"} · ${item.verifiedBy || "verifier not recorded"}`,
      check: item.check,
      staffId: item.staffId,
      evidenceKey: item.evidenceKey,
      request,
      history: request ? buildScrEvidenceHistory(request) : [],
    };
  });
}

function SCRRenewalActionList({ items, onRequest, onClear, onOpenSCR }) {
  if (!items.length) {
    return <EmptyList title="No SCR renewals due" text="Expiry and review dates within 60 days will appear here as admin follow-up actions." />;
  }
  return (
    <div className="renewal-action-list">
      {items.map((item) => (
        <article className={`renewal-action ${item.request ? "requested" : ""}`} key={item.id}>
          <Bell size={18} />
          <div className="renewal-action-copy">
            <strong>{item.title}</strong>
            <span>{item.meta}</span>
            <small>{item.detail}</small>
            {item.request && (
              <em>
                {item.request.status === "Submitted"
                  ? `Submitted ${formatShortDate(item.request.submittedAt?.slice(0, 10))} by ${item.request.submittedBy || "Staff"}`
                  : `Requested ${formatShortDate(item.request.requestedAt?.slice(0, 10))} by ${item.request.requestedBy || "Admin"}`}
              </em>
            )}
            {!!item.history.length && <EvidenceHistoryTimeline events={item.history} />}
          </div>
          <div className="renewal-action-controls">
            {item.request ? (
              <button className="button light" type="button" onClick={() => onClear(item)}>Clear</button>
            ) : (
              <button className="button light" type="button" onClick={() => onRequest(item)}>Mark requested</button>
            )}
          </div>
        </article>
      ))}
      <button className="button light" type="button" onClick={onOpenSCR}>Open SCR</button>
    </div>
  );
}

function EvidenceWorkflowInbox({ items, filter, onFilter }) {
  const [query, setQuery] = useState("");
  const filters = ["Action needed", "Requested", "Submitted", "Rejected", "Approved", "All"];
  const queryText = query.trim().toLowerCase();
  const filteredByStatus = items.filter((item) => {
    if (filter === "All") return true;
    if (filter === "Action needed") return ["Prompt", "Requested", "Submitted", "Rejected"].includes(item.status);
    return item.status === filter;
  });
  const filtered = filteredByStatus.filter((item) => {
    if (!queryText) return true;
    const haystack = [
      item.staffName,
      item.check,
      item.status,
      item.reference,
      item.owner,
      item.note,
      ...(item.history || []).flatMap((event) => [event.type, event.by, event.note]),
    ].join(" ").toLowerCase();
    return haystack.includes(queryText);
  });
  const counts = Object.fromEntries(filters.map((item) => [item, items.filter((row) => {
    if (item === "All") return true;
    if (item === "Action needed") return ["Prompt", "Requested", "Submitted", "Rejected"].includes(row.status);
    return row.status === item;
  }).length]));
  return (
    <div className="evidence-inbox">
      <div className="evidence-filter-row" role="tablist" aria-label="Evidence workflow filters">
        {filters.map((item) => (
          <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>
            {item}<span>{counts[item]}</span>
          </button>
        ))}
      </div>
      <label className="evidence-search">
        Search evidence
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff, DBS, reference, note..." />
      </label>
      {filtered.length ? (
        <div className="evidence-inbox-list">
          {filtered.map((item) => (
            <article className="evidence-inbox-item" key={`${item.id}-${item.status}`}>
              <div>
                <strong>{item.check} · {item.staffName}</strong>
                <span>{item.reference}</span>
                <small>{item.updatedAt ? formatShortDate(item.updatedAt.slice(0, 10)) : "No date"} · {item.owner}</small>
                {item.note && <p>{item.note}</p>}
                <EvidenceHistoryTimeline events={item.history} />
              </div>
              <Badge value={item.status === "Prompt" ? "Renewal prompt" : item.status} />
            </article>
          ))}
        </div>
      ) : <EmptyList title="No evidence in this view" text={queryText ? "Clear the search or try a different evidence filter." : "Change the filter or wait for the next staff evidence update."} />}
    </div>
  );
}

function SubmittedEvidenceReviewQueue({ items, onReview }) {
  const [sendBackId, setSendBackId] = useState("");
  if (!items.length) {
    return <EmptyList title="No submitted evidence waiting" text="Staff evidence submissions will appear here for approval or follow-up." />;
  }
  function sendBack(event, item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onReview(item, "reject", form.get("rejectionReason"));
    setSendBackId("");
  }
  return (
    <div className="submitted-evidence-list">
      {items.map((item) => (
        <article className="submitted-evidence-card" key={item.id}>
          <div>
            <p className="eyebrow">Submitted for review</p>
            <h3>{item.check} · {item.staffName}</h3>
            <p>{item.reference}</p>
            <small>
              Submitted {formatShortDate(item.submittedAt?.slice(0, 10))} by {item.submittedBy}
              {item.expiryDate ? ` · new review date ${formatShortDate(item.expiryDate)}` : ""}
            </small>
            <span>{item.note}</span>
            <EvidenceHistoryTimeline events={item.history} />
          </div>
          <div className="submitted-evidence-actions">
            <button className="button book" type="button" onClick={() => onReview(item, "approve")}>Approve</button>
            <button className="button light" type="button" onClick={() => setSendBackId(sendBackId === item.id ? "" : item.id)}>Send Back</button>
          </div>
          {sendBackId === item.id && (
            <form className="submitted-evidence-reject" onSubmit={(event) => sendBack(event, item)}>
              <label>Reason for staff member<textarea required name="rejectionReason" rows="2" placeholder="Tell the staff member exactly what needs correcting." /></label>
              <div>
                <button className="button book" type="submit">Send Back With Note</button>
                <button className="button light" type="button" onClick={() => setSendBackId("")}>Cancel</button>
              </div>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}

function EvidenceHistoryTimeline({ events }) {
  if (!events?.length) return null;
  return (
    <div className="evidence-history" aria-label="Evidence history">
      {events.map((event) => (
        <div key={event.id || `${event.type}-${event.at}`}>
          <span>{event.type}</span>
          <small>{formatShortDate(event.at?.slice(0, 10))} · {event.by || "System"}</small>
          {event.note && <p>{event.note}</p>}
        </div>
      ))}
    </div>
  );
}

function buildDbsEvidenceHistory(person, evidence = {}) {
  const number = evidence.certificateNo || evidence.dbsNumber || evidence.number || person.dbsNumber || person.scrChecklist?.dbsNumber;
  const source = evidence.reference || evidence.source || evidence.fileName || "SCR record";
  const rows = [
    ["DBS number", number],
    ["Application ref", evidence.applicationRef],
    ["Issue date", evidence.issueDate ? formatShortDate(evidence.issueDate) : null],
    ["Checked by", evidence.verifiedBy],
    ["Checked on", evidence.verifiedAt ? formatShortDate(evidence.verifiedAt.slice(0, 10)) : null],
    ["Source", evidence.sourceSurname ? `${source} · ${evidence.sourceSurname}` : source],
  ].filter(([, value]) => value);
  return rows.length ? { rows } : null;
}

function DbsEvidenceHistory({ history }) {
  if (!history?.rows?.length) return null;
  return (
    <dl className="dbs-evidence-history" aria-label="DBS evidence history">
      {history.rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StaffEvidenceRequestList({ items, onSubmit }) {
  if (!items.length) {
    return <EmptyList title="No evidence requested" text="Any SCR evidence requests from your manager or admin team will appear here." />;
  }
  const actionItems = items.filter((item) => ["Requested", "Rejected"].includes(item.status));
  const submittedItems = items.filter((item) => item.status === "Submitted");
  const approvedItems = items.filter((item) => item.status === "Approved");
  function submit(event, item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(item, {
      reference: form.get("reference"),
      expiryDate: form.get("expiryDate"),
      note: form.get("note"),
    });
    event.currentTarget.reset();
  }
  return (
    <div className="staff-evidence-list">
      <div className="staff-evidence-summary">
        <span><strong>{actionItems.length}</strong> to complete</span>
        <span><strong>{submittedItems.length}</strong> waiting for review</span>
        <span><strong>{approvedItems.length}</strong> approved</span>
      </div>
      {items.map((item) => (
        <article className={`staff-evidence-card ${item.rejected ? "rejected" : ""} ${item.submitted ? "submitted" : ""} ${item.approved ? "approved" : ""}`} key={item.id}>
          <div className="staff-evidence-content">
            <p className="eyebrow">{item.rejected ? "Action needed" : item.submitted ? "Waiting for review" : item.approved ? "Approved" : "Evidence requested"}</p>
            <h3>{item.title}</h3>
            <p>{item.meta}</p>
            <small>
              {item.rejected
                ? `Reviewed ${formatShortDate(item.request.reviewedAt?.slice(0, 10))} by ${item.request.reviewedBy || "Admin"}.`
                : item.submitted
                  ? `Submitted ${formatShortDate(item.request.submittedAt?.slice(0, 10))} by ${item.request.submittedBy || "you"}.`
                  : item.approved
                    ? `Approved ${formatShortDate(item.request.reviewedAt?.slice(0, 10))} by ${item.request.reviewedBy || "Admin"}.`
                    : `Requested ${formatShortDate(item.request.requestedAt?.slice(0, 10))} by ${item.request.requestedBy || "Admin"}.`}
            </small>
            {item.request.note && <p className="staff-evidence-instruction">{item.request.note}</p>}
            {item.rejected && <strong className="staff-evidence-feedback">{item.request.rejectionReason || "Please resubmit this evidence for review."}</strong>}
            {(item.rejected || item.submitted || item.approved) && (item.request.evidenceReference || item.previousReference) && <small>Latest submission: {item.request.evidenceReference || item.previousReference}</small>}
            {!!item.history?.length && (
              <details className="staff-evidence-history">
                <summary>Activity history</summary>
                <EvidenceHistoryTimeline events={item.history} />
              </details>
            )}
          </div>
          {["Requested", "Rejected"].includes(item.status) ? (
            <form className="staff-evidence-form" onSubmit={(event) => submit(event, item)}>
              <label>Evidence reference<input required name="reference" placeholder="Certificate name, DBS ref or uploaded file name" /></label>
              <label>New expiry / review date<input name="expiryDate" type="date" /></label>
              <label className="full">Note<textarea name="note" rows="2" placeholder="Anything the admin team should know." /></label>
              <button className="button book" type="submit">{item.rejected ? "Resubmit Evidence" : "Submit Evidence"}</button>
            </form>
          ) : (
            <div className="staff-evidence-state">
              <strong>{item.submitted ? "No action needed right now" : "Evidence accepted"}</strong>
              <span>{item.submitted ? "The admin team will review this and send it back only if something needs correcting." : "This request is complete and remains visible here for your records."}</span>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function SCRRenewalPanel({ items }) {
  const expired = items.filter((item) => item.status === "Expired").length;
  const soon = items.filter((item) => item.status === "Expiring soon").length;
  return (
    <section className="scr-renewal-panel">
      <div className="scr-assignments-heading">
        <div>
          <p className="eyebrow">Expiring soon</p>
          <h3>Evidence renewals that need attention.</h3>
          <p>Tracks expiry and review dates recorded against SCR evidence items across staff.</p>
        </div>
        <div className="renewal-mini-metrics">
          <Metric icon={<Bell />} label="Expired" value={expired} tone={expired ? "amber" : "green"} />
          <Metric icon={<Clock />} label="Due within 60 days" value={soon} tone={soon ? "amber" : "green"} />
        </div>
      </div>
      {items.length ? (
        <TableWrap>
          <table>
            <thead><tr><th>Staff</th><th>Check</th><th>Expiry / review</th><th>Status</th><th>Evidence</th><th>Verified by</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.id}>
                <td>{item.staffName}</td>
                <td>{item.check}</td>
                <td>{item.expiryDate}</td>
                <td><Badge value={item.status} /></td>
                <td>{item.reference || "No reference"}</td>
                <td>{item.verifiedBy || "Not recorded"}</td>
              </tr>
            ))}</tbody>
          </table>
        </TableWrap>
      ) : <EmptyList title="No evidence expiring soon" text="Items with expiry or review dates within 60 days will appear here." />}
    </section>
  );
}

function SCROnboardingQueue({ staff, onUpdate, onApprove }) {
  const checks = [
    ["rightToWork", "Right to work"],
    ["identity", "Identity / address"],
    ["dbs", "Enhanced DBS"],
    ["barredList", "Barred list"],
    ["safeguarding", "Safeguarding"],
    ["allergy", "Allergy awareness"],
    ["references", "References"],
    ["declarations", "Annual declarations"],
  ];
  function updateEvidence(person, key, patch) {
    const evidence = {
      ...(person.scrChecklist?.evidence || {}),
      [key]: {
        ...(person.scrChecklist?.evidence?.[key] || {}),
        ...patch,
      },
    };
    onUpdate(person.id, { evidence });
  }
  return (
    <section className="scr-onboarding-queue">
      <div className="scr-assignments-heading">
        <div>
          <p className="eyebrow">New staff onboarding</p>
          <h3>Approved applicants now become pending SCR profiles.</h3>
          <p>Complete these records before marking them compliant or assigning regular paid hours.</p>
        </div>
        <Badge value={`${staff.filter((person) => !person.scrChecklist?.approvedAt).length} pending`} />
      </div>
      <div className="onboarding-scr-grid">
        {staff.map((person) => (
          <article key={person.id}>
            <div>
              <h4>{person.name}</h4>
              <p>{person.role} · {staffPrimaryLocation(person)}</p>
            </div>
            <div className="scr-checklist-grid">
              {checks.map(([key, label]) => (
                <details className="scr-evidence-item" key={key}>
                  <summary>
                    <label className="scr-check-item">
                      <input type="checkbox" checked={Boolean(person.scrChecklist?.[key])} onChange={(event) => onUpdate(person.id, { [key]: event.target.checked })} />
                      <span>{label}</span>
                      {evidenceExpiryStatus(person.scrChecklist?.evidence?.[key]) && <Badge value={evidenceExpiryStatus(person.scrChecklist?.evidence?.[key])} />}
                    </label>
                  </summary>
                  <EvidenceFields evidenceKey={key} evidence={person.scrChecklist?.evidence?.[key] || {}} onChange={(patch) => updateEvidence(person, key, patch)} />
                </details>
              ))}
            </div>
            <label>Admin note<textarea rows="2" value={person.scrChecklist?.note || ""} onChange={(event) => onUpdate(person.id, { note: event.target.value })} placeholder="Evidence requested, dates, verifier or next step." /></label>
            <ChecklistProgress person={person} checks={checks} onApprove={() => onApprove(person.id)} />
          </article>
        ))}
      </div>
    </section>
  );
}

function referenceAnswerSummary(evidence = {}) {
  const received = evidence.referencesReceived ?? evidence.referenceReceived ?? evidence.referenceCount > 0;
  const wouldReemploy = evidence.wouldReemploy ?? evidence.wouldEmployAgain;
  const safeguardingConcerns = evidence.safeguardingConcerns;
  const recommended = evidence.recommendedForChildren ?? evidence.recommendForChildrenRole;
  const referenceNames = Array.isArray(evidence.references)
    ? evidence.references.map((reference) => reference.organisation ? `${reference.name} (${reference.organisation})` : reference.name).filter(Boolean)
    : Array.isArray(evidence.referenceNames)
      ? evidence.referenceNames.filter(Boolean)
      : [];
  return [
    referenceNames.length ? `References: ${referenceNames.join(", ")}` : "",
    received ? "Reference received" : "Reference not confirmed",
    wouldReemploy === true ? "Would employ again" : wouldReemploy === false ? "Would not employ again" : "Re-employ answer not recorded",
    safeguardingConcerns === false ? "No safeguarding concerns" : safeguardingConcerns === true ? "Safeguarding concerns recorded" : "Safeguarding answer not recorded",
    recommended === true ? "Recommended for work with children" : recommended === false ? "Not recommended for work with children" : "Recommendation answer not recorded",
  ];
}

function EvidenceFields({ evidenceKey = "", evidence, onChange }) {
  const isReferences = evidenceKey === "references";
  return (
    <div className="evidence-fields">
      <label>Evidence / document ref<input value={evidence.reference || ""} onChange={(event) => onChange({ reference: event.target.value })} placeholder="Certificate, DBS ref, file name..." /></label>
      <label>Date seen<input type="date" value={evidence.dateSeen || ""} onChange={(event) => onChange({ dateSeen: event.target.value })} /></label>
      <label>Expiry / review date<input type="date" value={evidence.expiryDate || ""} onChange={(event) => onChange({ expiryDate: event.target.value })} /></label>
      <label>Verified by<input value={evidence.verifiedBy || ""} onChange={(event) => onChange({ verifiedBy: event.target.value })} placeholder="Admin name" /></label>
      {isReferences && (
        <div className="reference-answer-grid">
          <label><input type="checkbox" checked={Boolean(evidence.referencesReceived ?? evidence.referenceCount > 0)} onChange={(event) => onChange({ referencesReceived: event.target.checked, referenceCount: event.target.checked ? (evidence.referenceCount || 2) : 0 })} /> Reference received</label>
          <label><input type="checkbox" checked={Boolean(evidence.wouldReemploy ?? evidence.wouldEmployAgain)} onChange={(event) => onChange({ wouldReemploy: event.target.checked, wouldEmployAgain: event.target.checked })} /> Would employ again</label>
          <label><input type="checkbox" checked={evidence.safeguardingConcerns === false} onChange={(event) => onChange({ safeguardingConcerns: event.target.checked ? false : null })} /> No safeguarding concerns</label>
          <label><input type="checkbox" checked={Boolean(evidence.recommendedForChildren ?? evidence.recommendForChildrenRole)} onChange={(event) => onChange({ recommendedForChildren: event.target.checked, recommendForChildrenRole: event.target.checked })} /> Recommended for work with children</label>
          <small>{referenceAnswerSummary(evidence).join(" · ")}</small>
        </div>
      )}
      <label>Evidence note<textarea rows="2" value={evidence.note || ""} onChange={(event) => onChange({ note: event.target.value })} placeholder="Expiry date, provider, issue notes or follow-up." /></label>
    </div>
  );
}

function ChecklistProgress({ person, checks, onApprove }) {
  const complete = checks.filter(([key]) => person.scrChecklist?.[key]).length;
  const total = checks.length;
  const ready = complete === total;
  const approved = Boolean(person.scrChecklist?.approvedAt);
  return (
    <div className="checklist-progress">
      <Progress value={Math.round((complete / total) * 100)} label={`${complete}/${total} complete`} />
      <div className="checklist-actions">
        <Badge value={approved ? "Compliant" : ready ? "Ready for admin review" : "Pending evidence"} />
        <button className="button book" type="button" disabled={!ready || approved} onClick={onApprove}>
          {approved ? "SCR Approved" : "Mark Compliant"}
        </button>
      </div>
    </div>
  );
}

function SCRRequirementPanel({ rows, compactTitle = "" }) {
  return (
    <section className="scr-requirements">
      <div className="scr-assignments-heading">
        <div>
          <p className="eyebrow">Site requirement checks</p>
          <h3>{compactTitle || "Flag rota and SCR gaps before a school assurance letter goes out."}</h3>
          <p>{compactTitle ? "Confirm the selected site has named cover for inspection: first aid, EYFS Level 3+, safeguarding and allergy awareness." : "Each site checks for at least one first aider, one EYFS Level 3+ lead, safeguarding training and allergy awareness among assigned staff."}</p>
        </div>
      </div>
      <div className="requirement-grid">
        {rows.map((row) => (
          <article key={row.school} className="requirement-card">
            <div className="crm-card-head">
              <div>
                <span>{row.assigned.length} assigned staff</span>
                <h4>{row.school}</h4>
              </div>
              <Badge value={row.gaps ? `${row.gaps} gaps` : "Ready"} />
            </div>
            <div className="requirement-checks">
              {row.checks.map((check) => (
                <div key={check.label}>
                  <strong>{check.label}</strong>
                  <span>{check.met ? check.names : "Gap to resolve"}</span>
                  <Badge value={check.met ? "Covered" : "Missing"} />
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Documents({ data, access }) {
  const [links, setLinks] = useState(() => readJson(documentLinksStorageKey, {}));
  const [linkStatus, setLinkStatus] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("attention");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedChaseIds, setSelectedChaseIds] = useState([]);
  const [localChaseLog, setLocalChaseLog] = useState({});
  const canManageDocuments = ["Admin", "Superadmin"].includes(access?.role);
  const isStaffView = access?.role === "Staff";
  const staffRecordId = access?.currentUser?.staffRecordId || access?.currentUser?.id || "";
  const [acknowledged, setAcknowledged] = useState({});
  const documents = data.documents || [];
  const staffById = new Map((data.staff || []).map((person) => [person.id, person]));
  const documentState = documents.map((doc) => {
    const assignment = (doc.assignments || []).find((item) => item.staffRecordId === staffRecordId);
    const staffAcknowledged = Boolean(assignment?.acknowledgedAt || acknowledged[doc.id]);
    const assigned = isStaffView && assignment ? 1 : Number(doc.assigned || 0);
    const read = isStaffView && assignment ? (staffAcknowledged ? 1 : 0) : Number(doc.read || 0);
    return {
      ...doc,
      assigned,
      read,
      staffAssignment: assignment || null,
      staffAcknowledged,
      chaseLog: [...(localChaseLog[doc.id] || []), ...(doc.chaseLog || [])],
    };
  });
  const totalAssigned = documentState.reduce((total, doc) => total + Number(doc.assigned || 0), 0);
  const totalRead = documentState.reduce((total, doc) => total + Number(doc.read || 0), 0);
  const missingAcknowledgements = Math.max(0, totalAssigned - totalRead);
  const linkedCount = documentState.filter((doc) => Boolean(links[doc.name] || doc.url)).length;
  const missingLinkCount = documentState.length - linkedCount;
  const completeDocumentCount = documentState.filter((doc) => {
    const link = links[doc.name] || doc.url || "";
    const assigned = Number(doc.assigned || 0);
    const read = Number(doc.read || 0);
    return link && assigned > 0 && read >= assigned;
  }).length;
  const documentReadiness = documentState.length ? Math.round((completeDocumentCount / documentState.length) * 100) : 100;
  const priorityDocuments = documentState
    .map((doc) => {
      const link = links[doc.name] || doc.url || "";
      const assigned = Number(doc.assigned || 0);
      const read = Number(doc.read || 0);
      const missing = Math.max(0, assigned - read);
      const status = !link ? "Link needed" : missing ? "Chase reads" : assigned ? "Complete" : "Assign staff";
      const weight = !link ? 0 : missing ? 1 : assigned ? 3 : 2;
      return { ...doc, link, assigned, read, missing, status, weight };
    })
    .sort((a, b) => a.weight - b.weight || b.missing - a.missing || String(a.name).localeCompare(String(b.name)))
    .slice(0, 4);
  const nextChaseDocument = priorityDocuments.find((doc) => doc.missing > 0) || priorityDocuments.find((doc) => !doc.link) || null;
  const visibleDocuments = documentState
    .filter((doc) => {
      const search = `${doc.name} ${doc.category || ""} ${doc.version || ""}`.toLowerCase();
      if (query && !search.includes(query.toLowerCase())) return false;
      const link = links[doc.name] || doc.url || "";
      const assigned = Number(doc.assigned || 0);
      const read = Number(doc.read || 0);
      const missing = Math.max(0, assigned - read);
      if (filter === "needs-link") return !link;
      if (filter === "needs-ack") return missing > 0;
      if (filter === "complete") return link && assigned > 0 && missing === 0;
      if (filter === "attention") return !link || missing > 0;
      return true;
    })
    .sort((a, b) => {
      const aLink = Boolean(links[a.name] || a.url);
      const bLink = Boolean(links[b.name] || b.url);
      const aMissing = Math.max(0, Number(a.assigned || 0) - Number(a.read || 0));
      const bMissing = Math.max(0, Number(b.assigned || 0) - Number(b.read || 0));
      return Number(aLink) - Number(bLink) || bMissing - aMissing || String(a.name).localeCompare(String(b.name));
    });
  const selectedDocument = documentState.find((doc) => doc.id === selectedDocumentId) || visibleDocuments[0] || null;
  const selectedAssignments = selectedDocument
    ? (selectedDocument.assignments || []).map((assignment) => {
        const person = staffById.get(assignment.staffRecordId) || {};
        return {
          ...assignment,
          name: person.name || person.fullName || "Staff member",
          email: person.email || "",
          location: person.location || "Site not recorded",
          acknowledged: Boolean(assignment.acknowledgedAt),
        };
      }).sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || String(a.name).localeCompare(String(b.name)))
    : [];
  const selectedOutstanding = selectedAssignments.filter((assignment) => !assignment.acknowledged);
  const chaseRecipients = selectedOutstanding.filter((assignment) => selectedChaseIds.includes(assignment.staffRecordId));
  const selectedDocumentLink = selectedDocument ? (links[selectedDocument.name] || selectedDocument.url || "") : "";
  const chaseSubject = selectedDocument ? `Please read and acknowledge ${selectedDocument.name}` : "Policy acknowledgement reminder";
  const chaseMessage = selectedDocument
    ? [
        `Hi,`,
        ``,
        `Please can you read and acknowledge ${selectedDocument.name} in your Après School staff area.`,
        selectedDocumentLink ? `Policy link: ${selectedDocumentLink}` : `You can find this policy in the Document & Policy Library.`,
        `Staff login: https://www.apres-school.co.uk/staff-login`,
        ``,
        `Keeping policies acknowledged helps us stay compliant across our sites and ready for Ofsted or school assurance checks.`,
        ``,
        `Thank you,`,
        `Après School`,
      ].join("\n")
    : "";
  const chaseEmailHref = chaseRecipients.length
    ? `mailto:${chaseRecipients.map((assignment) => assignment.email).filter(Boolean).join(",")}?subject=${encodeURIComponent(chaseSubject)}&body=${encodeURIComponent(chaseMessage)}`
    : "";
  useEffect(() => {
    setSelectedChaseIds(selectedOutstanding.map((assignment) => assignment.staffRecordId));
  }, [selectedDocument?.id]);
  function updateDocumentLink(name, value) {
    const next = { ...links, [name]: value.trim() };
    if (!next[name]) delete next[name];
    setLinks(next);
    localStorage.setItem(documentLinksStorageKey, JSON.stringify(next));
  }
  function toggleChaseRecipient(staffId) {
    setSelectedChaseIds((current) => (
      current.includes(staffId)
        ? current.filter((id) => id !== staffId)
        : [...current, staffId]
    ));
  }
  async function copyChaseMessage() {
    const recipientLines = chaseRecipients.map((assignment) => `${assignment.name}${assignment.email ? ` <${assignment.email}>` : ""}`).join("\n");
    const text = [`Recipients:`, recipientLines || "No recipients selected", ``, `Subject: ${chaseSubject}`, ``, chaseMessage].join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      await saveChaseEvent("copy");
      setLinkStatus(`${chaseRecipients.length} policy reminder${chaseRecipients.length === 1 ? "" : "s"} copied and logged.`);
      return;
    }
    setLinkStatus("Clipboard is not available in this browser.");
  }
  async function saveChaseEvent(channel) {
    if (!selectedDocument || !chaseRecipients.length) return null;
    const fallbackEvent = {
      id: `local-${Date.now()}`,
      documentVersionId: selectedDocument.id,
      actor: access?.currentUser?.name || access?.currentUser?.email || "You",
      actorEmail: access?.currentUser?.email || "",
      recipientStaffRecordIds: chaseRecipients.map((assignment) => assignment.staffRecordId),
      recipientCount: chaseRecipients.length,
      channel,
      message: chaseMessage,
      metadata: {
        subject: chaseSubject,
        recipients: chaseRecipients.map((assignment) => ({ name: assignment.name, email: assignment.email })),
      },
      createdAt: new Date().toISOString(),
    };
    if (!hasSupabaseConfig || !isUuid(selectedDocument.id)) {
      setLocalChaseLog((current) => ({ ...current, [selectedDocument.id]: [fallbackEvent, ...(current[selectedDocument.id] || [])] }));
      return fallbackEvent;
    }
    try {
      const { recordDocumentChase } = await loadSupabaseModule();
      const saved = await recordDocumentChase({
        documentVersionId: selectedDocument.id,
        recipientStaffRecordIds: fallbackEvent.recipientStaffRecordIds,
        channel,
        message: chaseMessage,
        metadata: fallbackEvent.metadata,
      });
      const event = { ...fallbackEvent, ...saved };
      setLocalChaseLog((current) => ({ ...current, [selectedDocument.id]: [event, ...(current[selectedDocument.id] || [])] }));
      return event;
    } catch (error) {
      setLocalChaseLog((current) => ({ ...current, [selectedDocument.id]: [fallbackEvent, ...(current[selectedDocument.id] || [])] }));
      setLinkStatus(`${error.message || "Unable to save reminder to Supabase."} A local reminder record has been added for this session.`);
      return fallbackEvent;
    }
  }
  async function openChaseEmail() {
    if (!chaseEmailHref) return;
    await saveChaseEvent("email");
    window.location.href = chaseEmailHref;
  }
  async function saveDocumentLink(doc) {
    const link = links[doc.name] ?? doc.url ?? "";
    if (!hasSupabaseConfig || !isUuid(doc.id)) {
      setLinkStatus("Policy link saved locally on this browser.");
      return;
    }
    try {
      const { updateDocumentSourceUrl } = await loadSupabaseModule();
      await updateDocumentSourceUrl(doc.id, link);
      setLinkStatus(`${doc.name} link saved to Supabase.`);
    } catch (error) {
      setLinkStatus(error.message || "Unable to save policy link to Supabase.");
    }
  }
  async function acknowledgeDocument(doc) {
    if (!doc.staffAssignment || !staffRecordId) {
      setLinkStatus("No personal document assignment was found for this policy.");
      return;
    }
    if (!hasSupabaseConfig || !isUuid(doc.id) || !isUuid(staffRecordId)) {
      setAcknowledged((current) => ({ ...current, [doc.id]: new Date().toISOString() }));
      setLinkStatus(`${doc.name} marked as read on this device.`);
      return;
    }
    try {
      const { acknowledgeDocumentAssignment } = await loadSupabaseModule();
      const saved = await acknowledgeDocumentAssignment({ documentVersionId: doc.id, staffRecordId });
      setAcknowledged((current) => ({ ...current, [doc.id]: saved.acknowledgedAt || new Date().toISOString() }));
      setLinkStatus(`${doc.name} acknowledged.`);
    } catch (error) {
      setLinkStatus(error.message || "Unable to save acknowledgement.");
    }
  }
  return (
    <Panel title="Document & Policy Library">
      <p className="panel-note">{isStaffView ? "Open each assigned policy and confirm once you have read it." : "Live policy documents, source links and staff acknowledgement progress in one place."}</p>
      {linkStatus && <p className="panel-note">{linkStatus}</p>}
      <div className="documents-console">
        <section className="documents-command-board" aria-label="Document library command view">
          <article className="documents-command-card primary">
            <div>
              <p className="eyebrow">{isStaffView ? "Your policy status" : "Library readiness"}</p>
              <h3>{isStaffView ? `${missingAcknowledgements || "No"} policies left to acknowledge` : `${documentReadiness}% operationally ready`}</h3>
              <p>{isStaffView ? "Open each assigned policy, read it in Google Docs, then confirm the acknowledgement here." : "Google Doc links, version notes and staff acknowledgements are tracked together for Ofsted and school assurance."}</p>
            </div>
            <div className="documents-readiness-line"><span style={{ width: `${documentReadiness}%` }} /></div>
          </article>
          <article className="documents-command-card">
            <div className="documents-command-head">
              <div>
                <p className="eyebrow">Priority queue</p>
                <h3>{nextChaseDocument ? nextChaseDocument.name : "Nothing urgent"}</h3>
              </div>
              <Badge value={nextChaseDocument ? nextChaseDocument.status : "Clear"} />
            </div>
            <div className="documents-priority-list">
              {priorityDocuments.map((doc) => (
                <button type="button" key={doc.id || doc.name} onClick={() => setSelectedDocumentId(doc.id)}>
                  <span>
                    <strong>{doc.name}</strong>
                    <small>{doc.link ? `${doc.read}/${doc.assigned} read` : "Add Google Doc link"}</small>
                  </span>
                  <Badge value={doc.status} />
                </button>
              ))}
            </div>
          </article>
          <article className="documents-command-card compact">
            <div>
              <p className="eyebrow">Assurance checks</p>
              <h3>Policy evidence in one place.</h3>
            </div>
            <div className="documents-check-list">
              <span><CheckCircle2 size={16} /> Source links saved</span>
              <span><ClipboardCheck size={16} /> Staff reads tracked</span>
              <span><Bell size={16} /> Chases logged</span>
            </div>
          </article>
        </section>
        <div className="documents-summary">
          <Metric icon={<FileText />} label={isStaffView ? "Assigned policies" : "Documents"} value={documentState.length} tone="blue" />
          <Metric icon={<CheckCircle2 />} label="Policy links" value={`${linkedCount}/${documentState.length}`} tone={missingLinkCount ? "amber" : "green"} />
          <Metric icon={<ClipboardCheck />} label={isStaffView ? "To acknowledge" : "Acknowledgements due"} value={missingAcknowledgements} tone={missingAcknowledgements ? "amber" : "green"} />
        </div>
        <div className="documents-toolbar">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search policies" /></label>
          <label>View<select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="attention">Needs attention</option>
            <option value="needs-link">Needs link</option>
            <option value="needs-ack">Needs acknowledgement</option>
            <option value="complete">Complete</option>
            <option value="all">All documents</option>
          </select></label>
        </div>
        <div className="document-list">
          {visibleDocuments.map((doc) => {
            const assigned = Number(doc.assigned || 0);
            const read = Number(doc.read || 0);
            const percent = assigned ? Math.round((read / assigned) * 100) : 100;
            const link = links[doc.name] || doc.url || "";
            const missing = Math.max(0, assigned - read);
            return (
              <article className="document-card-row" key={doc.id || doc.name}>
                <div className="document-title-block">
                  <div className="document-icon"><FileText size={20} /></div>
                  <div>
                    <strong>{doc.name}</strong>
                    <span>{doc.category || "Policy"} · Version {doc.version || "Not recorded"}</span>
                  </div>
                </div>
                <div className="document-link-cell">
                  {canManageDocuments ? (
                    <>
                      <input value={link} onChange={(event) => updateDocumentLink(doc.name, event.target.value)} onBlur={() => saveDocumentLink(doc)} placeholder="Paste Google Doc link" />
                      <button className="button subtle" type="button" onClick={() => saveDocumentLink(doc)}>Save</button>
                    </>
                  ) : (
                    <span className={link ? "document-link-ready" : "document-link-missing"}>{link ? "Policy link ready" : "Link pending"}</span>
                  )}
                </div>
                <div className="document-progress-block">
                  <Progress value={percent} label={`${read}/${assigned} read`} />
                  <small>{isStaffView ? (doc.staffAcknowledged ? "You have acknowledged this policy" : "Please confirm once read") : (missing ? `${missing} acknowledgement${missing === 1 ? "" : "s"} outstanding` : "All assigned staff have acknowledged")}</small>
                </div>
                <div className="document-actions">
                  <Badge value={link ? "Linked" : "Link needed"} />
                  <Badge value={isStaffView ? (doc.staffAcknowledged ? "Acknowledged" : "Read required") : (missing ? `Chase ${missing}` : "Complete")} />
                  {link ? <a className="button light" href={link} target="_blank" rel="noreferrer">Open policy</a> : <span className="muted-inline">No source link yet</span>}
                  {isStaffView && link && !doc.staffAcknowledged && <button className="button book" type="button" onClick={() => acknowledgeDocument(doc)}>I have read this</button>}
                  {canManageDocuments && <button className="button subtle" type="button" onClick={() => setSelectedDocumentId(doc.id)}>View readers</button>}
                  {canManageDocuments && missing > 0 && <button className="button subtle" type="button" onClick={() => { setSelectedDocumentId(doc.id); setLinkStatus(`${doc.name}: choose staff below, then copy or open the reminder.`); }}>Chase</button>}
                </div>
              </article>
            );
          })}
          {!visibleDocuments.length && <EmptyList title="No documents match" text="Change the filter or search to see more records." />}
        </div>
        {canManageDocuments && selectedDocument && (
          <section className="document-readers-panel">
            <div className="document-readers-header">
              <div>
                <p className="eyebrow">Acknowledgement drill-down</p>
                <h3>{selectedDocument.name}</h3>
                <span>{selectedOutstanding.length ? `${selectedOutstanding.length} staff still need to read this policy.` : "Everyone assigned has acknowledged this policy."}</span>
              </div>
              <Badge value={`${selectedDocument.read}/${selectedDocument.assigned} read`} />
            </div>
            <div className="document-reader-list">
              {selectedAssignments.map((assignment) => (
                <article className="document-reader-row" key={assignment.id || assignment.staffRecordId}>
                  <div className="document-reader-person">
                    {!assignment.acknowledged && (
                      <input
                        aria-label={`Select ${assignment.name} for reminder`}
                        checked={selectedChaseIds.includes(assignment.staffRecordId)}
                        onChange={() => toggleChaseRecipient(assignment.staffRecordId)}
                        type="checkbox"
                      />
                    )}
                    <div>
                      <strong>{assignment.name}</strong>
                      <span>{assignment.email || "Email not recorded"} · {assignment.location}</span>
                    </div>
                  </div>
                  <div>
                    <Badge value={assignment.acknowledged ? "Read" : "Outstanding"} />
                    <small>
                      {assignment.acknowledged
                        ? `Acknowledged ${formatShortDate(assignment.acknowledgedAt)}`
                        : assignment.dueAt
                          ? `Due ${formatShortDate(assignment.dueAt)}`
                          : "No due date"}
                    </small>
                  </div>
                </article>
              ))}
              {!selectedAssignments.length && <EmptyList title="No assignments" text="This policy has no staff assignments yet." />}
            </div>
            {selectedOutstanding.length > 0 && (
              <div className="document-chase-panel">
                <div>
                  <p className="eyebrow">Reminder workflow</p>
                  <h4>{chaseRecipients.length} selected for chase</h4>
                  <span>Select outstanding staff above, then copy a ready-to-send message or open an email draft.</span>
                </div>
                <div className="document-chase-actions">
                  <button className="button subtle" type="button" onClick={() => setSelectedChaseIds(selectedOutstanding.map((assignment) => assignment.staffRecordId))}>Select all</button>
                  <button className="button subtle" type="button" onClick={() => setSelectedChaseIds([])}>Clear</button>
                  <button className="button book" type="button" onClick={copyChaseMessage} disabled={!chaseRecipients.length}>Copy reminder</button>
                  {chaseEmailHref ? <button className="button light" type="button" onClick={openChaseEmail}>Open email</button> : <span className="muted-inline">No email recipients selected</span>}
                </div>
                <div className="document-chase-preview">
                  <strong>{chaseSubject}</strong>
                  <p>{chaseMessage.split("\n").slice(2, 5).join(" ")}</p>
                </div>
              </div>
            )}
            {selectedDocument.chaseLog?.length > 0 && (
              <div className="document-chase-log">
                <p className="eyebrow">Chase history</p>
                {selectedDocument.chaseLog.slice(0, 6).map((event) => (
                  <article key={event.id}>
                    <div>
                      <strong>{formatShortDate(event.createdAt)}</strong>
                      <span>{event.actor || "Admin"} chased {event.recipientCount || event.recipientStaffRecordIds?.length || 0} staff member{(event.recipientCount || event.recipientStaffRecordIds?.length || 0) === 1 ? "" : "s"} via {event.channel || "manual"}.</span>
                    </div>
                    <Badge value={event.channel || "manual"} />
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}

function Pay({ data, access, targetStaffId = "", onTargetHandled, onOpenTab, onOpenStaffProfile }) {
  const usingSupabase = String(data.source || "").startsWith("Supabase");
  const records = usingSupabase ? (data.payrollHours || {}) : readJson(payrollHoursStorageKey, {});
  const [runs, setRuns] = useState(() => usingSupabase ? (data.payrollRuns || {}) : readJson(payrollRunsStorageKey, {}));
  const [hrFiles, setHrFiles] = useState(data.hrFiles || []);
  const [syncStatus, setSyncStatus] = useState("");
  const [payslipStatus, setPayslipStatus] = useState("");
  const [payrollQuery, setPayrollQuery] = useState("");
  const [payrollFilter, setPayrollFilter] = useState("pay-due");
  const [historyStaffId, setHistoryStaffId] = useState("");
  const [payPrivacyReady, setPayPrivacyReady] = useState(false);
  const [hasPayPin, setHasPayPin] = useState(false);
  const [payUnlocked, setPayUnlocked] = useState(false);
  const [payPrivacyMode, setPayPrivacyMode] = useState("");
  const [payPrivacyBusy, setPayPrivacyBusy] = useState(false);
  const [payPrivacyStatus, setPayPrivacyStatus] = useState("");
  const [payPinDraft, setPayPinDraft] = useState("");
  const [payCurrentPinDraft, setPayCurrentPinDraft] = useState("");
  const [payNewPinDraft, setPayNewPinDraft] = useState("");
  const [payPasswordDraft, setPayPasswordDraft] = useState("");
  const requestedPayslipId = new URLSearchParams(window.location.search).get("payslip") || "";
  const [selectedPayslipId, setSelectedPayslipId] = useState(requestedPayslipId);
  const payslipPeriods = Array.from(new Set(
    (hrFiles || [])
      .filter((file) => staffHrFileBucket(file) === "Payslips")
      .map((file) => payslipPeriod(file))
      .filter(validPayrollPeriod),
  )).sort().reverse();
  const availablePeriods = Array.from(new Set(
    [...Object.keys(records), ...payslipPeriods].filter(validPayrollPeriod),
  )).sort().reverse();
  const [period, setPeriod] = useState(availablePeriods[0] || currentPayrollPeriod());
  const isStaff = access?.role === "Staff";
  const isAdmin = ["Admin", "Superadmin"].includes(access?.role);
  const canMarkPaid = access?.role === "Superadmin";

  useEffect(() => {
    let active = true;
    setPayPrivacyReady(false);
    setPayPrivacyStatus("");
    loadSupabaseModule()
      .then(({ getStaffPayPinStatus }) => getStaffPayPinStatus())
      .then((result) => {
        if (!active) return;
        const configured = Boolean(result?.hasPin);
        setHasPayPin(configured);
        setPayUnlocked(!configured);
        setPayPrivacyReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setPayPrivacyStatus(error.message || "Pay privacy could not be checked.");
        setPayUnlocked(false);
        setPayPrivacyReady(true);
      });
    return () => {
      active = false;
    };
  }, [access?.currentUser?.id, access?.currentUser?.email]);
  const currentRun = runs[period] || { status: "Draft", adjustments: {} };
  const payRunIsPublished = (run) => run?.status === "Paid";
  const showStaffPayCalculation = !isStaff || payRunIsPublished(currentRun);
  const periodRecords = showStaffPayCalculation ? (records[period] || {}) : {};
  const runLocked = currentRun.status === "Paid";
  const staffIds = new Set(data.staff.map((person) => person.id));
  const payrollRows = data.staff.map((person) => {
    const allPayslips = staffPayslips(hrFiles, person.id);
    const payslips = allPayslips.filter((file) => payslipMatchesPeriod(file, period));
    const payslipPay = payslipPayRecord(payslips);
    const schoolRows = Object.entries(periodRecords).flatMap(([schoolName, record]) => (record.rows || [])
      .filter((row) => row.staffId === person.id || row.staffId === person.profileId)
      .map((row) => ({ ...row, schoolName, status: record.status || "Draft" })));
    const hours = schoolRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const hourlyGross = schoolRows.reduce((sum, row) => sum + Number(row.hours || 0) * Number(row.rate ?? person.payRate ?? 0), 0);
    const monthlySalary = showStaffPayCalculation ? monthlySalaryFromAnnual(person.annualSalary) : 0;
    const calculatedGross = monthlySalary + hourlyGross;
    const gross = payslipPay ? payslipPay.gross : calculatedGross;
    const adjustment = showStaffPayCalculation ? (currentRun.adjustments?.[person.id] || {}) : {};
    const expenses = Number(adjustment.expenses || 0);
    const deductions = Number(adjustment.deductions || 0);
    const net = payslipPay ? payslipPay.net : gross + expenses - deductions;
    return { ...person, payrollEntries: schoolRows, hours, monthlySalary, hourlyGross, calculatedGross, gross, net, expenses, deductions, payrollNote: adjustment.note || "", payslips, allPayslips, payslipPay };
  });
  const totalHours = payrollRows.reduce((sum, row) => sum + row.hours, 0);
  const totalGross = payrollRows.reduce((sum, row) => sum + row.gross, 0);
  const totalExpenses = payrollRows.reduce((sum, row) => sum + row.expenses, 0);
  const totalDeductions = payrollRows.reduce((sum, row) => sum + row.deductions, 0);
  const totalNet = payrollRows.reduce((sum, row) => sum + row.net, 0);
  const periodRecordList = Object.values(periodRecords);
  const submittedSites = periodRecordList.filter((record) => ["Submitted", "Approved"].includes(record.status)).length;
  const approvedSites = periodRecordList.filter((record) => record.status === "Approved").length;
  const unapprovedHourSites = periodRecordList.filter((record) => (record.rows || []).some((row) => Number(row.hours || 0) > 0) && record.status !== "Approved");
  const payrollReady = payrollRows.some((row) => row.hours > 0 || row.monthlySalary > 0 || row.payslips.length > 0);
  const staffToPay = payrollRows.filter((row) => row.hours > 0 || row.monthlySalary > 0 || row.payslips.length > 0);
  const staffPayslipFiles = isStaff ? payrollRows.flatMap((row) => row.allPayslips || []) : [];
  const periodStaffPayslipFiles = staffPayslipFiles.filter((file) => payslipMatchesPeriod(file, period));
  const selectedStaffPayslip = staffPayslipFiles.find((file) => file.id === selectedPayslipId) || periodStaffPayslipFiles[0] || staffPayslipFiles[0] || null;
  const monthlyPayslipFiles = payrollRows.flatMap((row) => row.payslips.map((file) => ({
    ...file,
    staffName: row.name,
    staffEmail: row.email || "",
    staffNetPay: row.net,
  })));
  const payslipsUploaded = staffToPay.filter((row) => row.payslips.length > 0).length;
  const missingPayslipRows = staffToPay.filter((row) => !row.payslips.length);
  const hourlyRows = payrollRows.filter((row) => row.hours > 0);
  const salaryRows = payrollRows.filter((row) => row.monthlySalary > 0);
  const adjustmentRows = payrollRows.filter((row) => row.expenses > 0 || row.deductions > 0 || row.payrollNote);
  const adjustmentNet = adjustmentRows.reduce((sum, row) => sum + row.expenses - row.deductions, 0);
  const filterCounts = {
    all: payrollRows.length,
    "pay-due": staffToPay.length,
    hours: hourlyRows.length,
    salary: salaryRows.length,
    adjustments: adjustmentRows.length,
    "missing-payslips": missingPayslipRows.length,
  };
  const payrollFilterOptions = [
    ["pay-due", "Pay due"],
    ["missing-payslips", "Missing payslips"],
    ["hours", "With hours"],
    ["salary", "Salaried"],
    ["adjustments", "Adjustments"],
    ["all", "All staff"],
  ];
  const payrollSearch = payrollQuery.trim().toLowerCase();
  const visiblePayrollRows = payrollRows.filter((row) => {
    const matchesFilter = payrollFilter === "all"
      || (payrollFilter === "pay-due" && (row.hours > 0 || row.monthlySalary > 0 || row.payslips.length > 0))
      || (payrollFilter === "missing-payslips" && (row.hours > 0 || row.monthlySalary > 0) && !row.payslips.length)
      || (payrollFilter === "hours" && row.hours > 0)
      || (payrollFilter === "salary" && row.monthlySalary > 0)
      || (payrollFilter === "adjustments" && (row.expenses > 0 || row.deductions > 0 || row.payrollNote));
    const schools = Array.from(new Set(row.payrollEntries.map((entry) => entry.schoolName))).join(" ");
    const haystack = [row.name, row.fullName, row.email, row.role, staffPrimaryLocation(row), schools, row.payrollNote].filter(Boolean).join(" ").toLowerCase();
    return matchesFilter && (!payrollSearch || haystack.includes(payrollSearch));
  });
  const checklistItems = [
    {
      title: "Hours entered",
      text: submittedSites ? `${submittedSites} site${submittedSites === 1 ? "" : "s"} submitted for ${formatPayrollPeriod(period)}.` : "Enter and submit hours for each active school.",
      done: submittedSites > 0,
      action: "Open Hours",
      onClick: () => onOpenTab?.("Hours"),
    },
    {
      title: "Site hours approved",
      text: approvedSites ? `${approvedSites} site${approvedSites === 1 ? "" : "s"} approved.` : "Approve school hours before final payroll approval.",
      done: approvedSites > 0 && approvedSites >= submittedSites,
      action: "Review Hours",
      onClick: () => onOpenTab?.("Hours"),
    },
    {
      title: "Payroll reviewed",
      text: currentRun.reviewedAt ? `Reviewed ${formatShortDate(currentRun.reviewedAt.slice(0, 10))}.` : "Check salary, hours, expenses and deductions.",
      done: ["Reviewed", "Approved", "Paid"].includes(currentRun.status),
      action: "Mark reviewed",
      onClick: () => setRunStatus("Reviewed"),
      disabled: !payrollReady || runLocked,
    },
    {
      title: "Payroll approved",
      text: currentRun.approvedAt ? `Approved ${formatShortDate(currentRun.approvedAt.slice(0, 10))}.` : "Approve the payroll run once the totals look right.",
      done: ["Approved", "Paid"].includes(currentRun.status),
      action: "Approve",
      onClick: () => setRunStatus("Approved"),
      disabled: !payrollReady || runLocked,
    },
    {
      title: "Payslips uploaded",
      text: staffToPay.length ? `${payslipsUploaded}/${staffToPay.length} payslip${staffToPay.length === 1 ? "" : "s"} uploaded.` : "Payroll rows will appear once salary or hours exist.",
      done: staffToPay.length > 0 && payslipsUploaded >= staffToPay.length,
      action: "Upload below",
      onClick: () => document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      disabled: !staffToPay.length,
    },
    {
      title: "Payroll paid",
      text: currentRun.paidAt ? `Marked paid ${formatShortDate(currentRun.paidAt.slice(0, 10))}.` : "Only Superadmin can mark payroll as paid.",
      done: currentRun.status === "Paid",
      action: "Mark paid",
      onClick: () => setRunStatus("Paid"),
      disabled: !payrollReady || !canMarkPaid || currentRun.status !== "Approved" || runLocked,
    },
  ];
  const checklistComplete = checklistItems.filter((item) => item.done).length;
  const payrollCloseWarnings = [
    missingPayslipRows.length ? {
      type: "blocker",
      title: "Missing payslips",
      text: `${missingPayslipRows.length} staff member${missingPayslipRows.length === 1 ? "" : "s"} due pay still need a payslip uploaded.`,
      action: "View missing",
      onClick: () => {
        setPayrollFilter("missing-payslips");
        setPayrollQuery("");
        document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    } : null,
    unapprovedHourSites.length ? {
      type: "blocker",
      title: "Unapproved hours",
      text: `${unapprovedHourSites.length} site hour record${unapprovedHourSites.length === 1 ? "" : "s"} must be approved before payroll is paid.`,
      action: "Review Hours",
      onClick: () => onOpenTab?.("Hours"),
    } : null,
    adjustmentRows.length ? {
      type: "review",
      title: "Adjustments present",
      text: `${adjustmentRows.length} staff member${adjustmentRows.length === 1 ? " has" : "s have"} expenses, deductions or payroll notes. Net adjustment: ${formatCurrency(adjustmentNet)}.`,
      action: "View adjustments",
      onClick: () => {
        setPayrollFilter("adjustments");
        setPayrollQuery("");
        document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    } : null,
  ].filter(Boolean);
  const payrollCloseBlockers = payrollCloseWarnings.filter((warning) => warning.type === "blocker");
  const payrollSummaryCards = [
    {
      filter: "missing-payslips",
      label: "Missing payslips",
      value: missingPayslipRows.length,
      text: staffToPay.length ? `${payslipsUploaded}/${staffToPay.length} uploaded for staff due pay.` : "No payroll rows need payslips yet.",
    },
    {
      filter: "hours",
      label: "Hourly staff",
      value: hourlyRows.length,
      text: `${totalHours.toFixed(2)} additional hour${totalHours === 1 ? "" : "s"} entered this month.`,
    },
    {
      filter: "salary",
      label: "Salaried staff",
      value: salaryRows.length,
      text: `${formatCurrency(salaryRows.reduce((sum, row) => sum + row.monthlySalary, 0))} base salary this month.`,
    },
    {
      filter: "adjustments",
      label: "Adjustments",
      value: adjustmentRows.length,
      text: `${formatCurrency(adjustmentNet)} net adjustment from expenses and deductions.`,
    },
  ];
  const selectedHistoryStaff = data.staff.find((person) => person.id === historyStaffId) || data.staff[0] || null;
  const historyPeriods = Array.from(new Set([period, ...availablePeriods, currentPayrollPeriod()])).filter(Boolean).sort().reverse();
  const currentStaffMember = isStaff ? data.staff[0] || null : null;
  const staffMonthlyPayHistory = currentStaffMember ? historyPeriods.map((historyPeriod) => {
    const historyRun = runs[historyPeriod] || { status: "Draft", adjustments: {} };
    const historyPayslips = staffPayslips(hrFiles, currentStaffMember.id).filter((file) => payslipMatchesPeriod(file, historyPeriod));
    const historyPublished = payRunIsPublished(historyRun);
    if (!historyPublished && !historyPayslips.length) return null;
    const historyRecords = historyPublished ? (records[historyPeriod] || {}) : {};
    const payrollEntries = Object.entries(historyRecords).flatMap(([schoolName, record]) => (record.rows || [])
      .filter((row) => row.staffId === currentStaffMember.id || row.staffId === currentStaffMember.profileId)
      .map((row) => ({ ...row, schoolName, status: record.status || "Draft" })));
    const hours = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const hourlyGross = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0) * Number(row.rate ?? currentStaffMember.payRate ?? 0), 0);
    const monthlySalary = historyPublished ? monthlySalaryFromAnnual(currentStaffMember.annualSalary) : 0;
    const adjustment = historyPublished ? (historyRun.adjustments?.[currentStaffMember.id] || {}) : {};
    const expenses = Number(adjustment.expenses || 0);
    const deductions = Number(adjustment.deductions || 0);
    const payslipPay = payslipPayRecord(historyPayslips);
    const gross = payslipPay ? payslipPay.gross : monthlySalary + hourlyGross;
    const net = payslipPay ? payslipPay.net : gross + expenses - deductions;
    const schools = Array.from(new Set(payrollEntries.map((entry) => entry.schoolName).filter(Boolean)));
    return {
      period: historyPeriod,
      status: historyPublished ? historyRun.status || "Paid" : "Payslip issued",
      schools,
      hours,
      hourlyGross,
      monthlySalary,
      gross,
      expenses,
      deductions,
      net,
      payslips: historyPayslips,
      payslipPay,
      note: historyPublished ? adjustment.note || "" : "",
    };
  }).filter((row) => row && (row.hours > 0 || row.monthlySalary > 0 || row.expenses > 0 || row.deductions > 0 || row.note || row.payslips.length)) : [];
  const staffSelectedMonth = staffMonthlyPayHistory.find((row) => row.period === period) || {
    period,
    status: currentRun.status || "Draft",
    schools: [],
    hours: totalHours,
    hourlyGross: payrollRows.reduce((sum, row) => sum + row.hourlyGross, 0),
    monthlySalary: payrollRows.reduce((sum, row) => sum + row.monthlySalary, 0),
    gross: totalGross,
    expenses: totalExpenses,
    deductions: totalDeductions,
    net: totalNet,
    payslips: periodStaffPayslipFiles,
    payslipPay: payrollRows[0]?.payslipPay || null,
    note: "",
  };
  const selectedStaffPayrollHistory = selectedHistoryStaff ? historyPeriods.map((historyPeriod) => {
    const historyRecords = records[historyPeriod] || {};
    const historyRun = runs[historyPeriod] || { status: "Draft", adjustments: {} };
    const payrollEntries = Object.entries(historyRecords).flatMap(([schoolName, record]) => (record.rows || [])
      .filter((row) => row.staffId === selectedHistoryStaff.id || row.staffId === selectedHistoryStaff.profileId)
      .map((row) => ({ ...row, schoolName, status: record.status || "Draft" })));
    const hours = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const hourlyGross = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0) * Number(row.rate ?? selectedHistoryStaff.payRate ?? 0), 0);
    const monthlySalary = monthlySalaryFromAnnual(selectedHistoryStaff.annualSalary);
    const adjustment = historyRun.adjustments?.[selectedHistoryStaff.id] || {};
    const expenses = Number(adjustment.expenses || 0);
    const deductions = Number(adjustment.deductions || 0);
    const payslips = staffPayslips(hrFiles, selectedHistoryStaff.id).filter((file) => payslipMatchesPeriod(file, historyPeriod));
    const payslipPay = payslipPayRecord(payslips);
    const gross = payslipPay ? payslipPay.gross : monthlySalary + hourlyGross;
    const net = payslipPay ? payslipPay.net : gross + expenses - deductions;
    return {
      period: historyPeriod,
      status: historyRun.status || "Draft",
      schools: Array.from(new Set(payrollEntries.map((entry) => entry.schoolName).filter(Boolean))),
      hours,
      monthlySalary,
      gross,
      expenses,
      deductions,
      net,
      payslips,
      payslipPay,
      note: adjustment.note || "",
    };
  }).filter((row) => row.hours > 0 || row.monthlySalary > 0 || row.expenses > 0 || row.deductions > 0 || row.note || row.payslips.length) : [];

  useEffect(() => {
    if (availablePeriods.length && !availablePeriods.includes(period)) setPeriod(availablePeriods[0]);
  }, [availablePeriods, period]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!data.staff.length) return;
    if (!historyStaffId || !data.staff.some((person) => person.id === historyStaffId)) setHistoryStaffId(data.staff[0].id);
  }, [data.staff, historyStaffId, isAdmin]);

  useEffect(() => {
    if (usingSupabase) setRuns(data.payrollRuns || {});
  }, [data.payrollRuns, usingSupabase]);

  useEffect(() => {
    if (!targetStaffId) return;
    const person = data.staff.find((item) => item.id === targetStaffId || item.profileId === targetStaffId);
    if (!person) return;
    setHistoryStaffId(person.id);
    setPayrollQuery(person.email || person.name || "");
    setPayrollFilter("all");
    onTargetHandled?.();
  }, [data.staff, onTargetHandled, targetStaffId]);

  useEffect(() => {
    setHrFiles(data.hrFiles || []);
  }, [data.hrFiles]);

  useEffect(() => {
    if (!requestedPayslipId) return;
    if (staffPayslipFiles.some((file) => file.id === requestedPayslipId)) {
      setSelectedPayslipId(requestedPayslipId);
    }
  }, [requestedPayslipId, staffPayslipFiles]);

  function saveRun(nextRun, action = "Payroll run updated", detail = "") {
    const runToSave = {
      ...nextRun,
      updatedAt: new Date().toISOString(),
      updatedBy: access?.currentUser?.email || access?.currentUser?.name || "Admin",
    };
    const next = {
      ...runs,
      [period]: runToSave,
    };
    localStorage.setItem(payrollRunsStorageKey, JSON.stringify(next));
    setRuns(next);
    addAuditLog(action, [formatPayrollPeriod(period), detail].filter(Boolean).join(" · "));
    if (!usingSupabase) return;
    setSyncStatus("Saving payroll run to Supabase...");
    loadSupabaseModule()
      .then(({ savePayrollRun }) => savePayrollRun({ period, run: runToSave, action }))
      .then((savedRun) => {
        setRuns((current) => ({ ...current, [period]: savedRun }));
        setSyncStatus("Payroll run saved to Supabase");
      })
      .catch((error) => {
        setSyncStatus(`Supabase save failed: ${error.message || "check SQL permissions"}`);
      });
  }

  function updateAdjustment(staffId, patch) {
    if (runLocked) return;
    const person = data.staff.find((staff) => staff.id === staffId || staff.profileId === staffId);
    const nextAdjustment = {
      ...(currentRun.adjustments?.[staffId] || {}),
      ...patch,
    };
    saveRun({
      ...currentRun,
      adjustments: {
        ...(currentRun.adjustments || {}),
        [staffId]: nextAdjustment,
      },
    }, "Payroll adjustment updated", `${person?.name || staffId}: ${Object.keys(patch).join(", ")}${person?.email ? ` · ${person.email}` : ""}`);
  }

  function setRunStatus(status) {
    if (runLocked) return;
    const timestampKey = status === "Reviewed" ? "reviewedAt" : status === "Approved" ? "approvedAt" : "paidAt";
    saveRun({
      ...currentRun,
      status,
      [timestampKey]: new Date().toISOString(),
      [`${status.toLowerCase()}By`]: access?.currentUser?.email || access?.currentUser?.name || "Admin",
    }, `Payroll ${status.toLowerCase()}`);
  }

  function unlockPayrollRun() {
    if (!canMarkPaid || !runLocked) return;
    saveRun({
      ...currentRun,
      status: "Approved",
      unlockedAt: new Date().toISOString(),
      unlockedBy: access?.currentUser?.email || access?.currentUser?.name || "Superadmin",
    }, "Payroll run unlocked");
  }

  function payrollExportScopeLabel() {
    const filterLabel = payrollFilterOptions.find(([value]) => value === payrollFilter)?.[1] || "Filtered";
    return payrollQuery.trim() ? `${filterLabel} search` : filterLabel;
  }

  function safePayrollFilePart(value) {
    return String(value || "payroll").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "payroll";
  }

  function exportPayroll(rowsToExport = payrollRows, scopeLabel = "full payroll") {
    const rows = [
      ["Period", "Run status", "Export scope", "Staff", "Email", "Schools", "Additional hours", "Hourly rate", "Hourly gross", "Annual salary", "Monthly salary", "Gross", "Expenses", "Deductions", "Net", "Payslip status", "Payslip count", "Notes"],
      ...rowsToExport.map((row) => {
        const schools = Array.from(new Set(row.payrollEntries.map((entry) => entry.schoolName))).join("; ");
        const submittedEntries = row.payrollEntries.filter((entry) => ["Submitted", "Approved"].includes(entry.status));
        const net = row.net;
        const payslipStatus = row.payslips.length ? "Uploaded" : submittedEntries.length ? "Ready to upload" : "Pending hours";
        return [
          formatPayrollPeriod(period),
          currentRun.status || "Draft",
          scopeLabel,
          row.name,
          row.email || "",
          schools || "No hours submitted",
          row.hours.toFixed(2),
          Number(row.payRate || 0).toFixed(2),
          row.hourlyGross.toFixed(2),
          Number(row.annualSalary || 0).toFixed(2),
          row.monthlySalary.toFixed(2),
          row.gross.toFixed(2),
          row.expenses.toFixed(2),
          row.deductions.toFixed(2),
          net.toFixed(2),
          payslipStatus,
          row.payslips.length,
          row.payrollNote || "",
        ];
      }),
    ];
    downloadCsv(`apres-payroll-${period}-${safePayrollFilePart(scopeLabel)}.csv`, rows);
    addAuditLog(scopeLabel === "full payroll" ? "Payroll exported" : "Payroll filtered export", `${formatPayrollPeriod(period)} · ${scopeLabel} · ${rowsToExport.length} staff`);
  }

  async function exportPayrollPdf() {
    const { exportPayrollSummary } = await import("./pdfExports.js");
    exportPayrollSummary(payrollRows, period, currentRun);
    addAuditLog("Payroll PDF exported", formatPayrollPeriod(period));
  }

  async function uploadPayslip(person, file) {
    if (!isAdmin || !person?.id || !file) return;
    const payslipCategory = (data.hrFileCategories || []).find((category) => String(category.name || "").toLowerCase().includes("payslip"))
      || fallbackHrFileCategories.find((category) => category.name === "Payslip");
    const payload = {
      staffRecordId: person.id,
      categoryId: isUuid(payslipCategory?.id) ? payslipCategory.id : "",
      category: payslipCategory?.name || "Payslip",
      sensitivity: payslipCategory?.sensitivity || "restricted",
      title: `${formatPayrollPeriod(period)} payslip`,
      issueDate: `${period}-01`,
      expiryDate: "",
      notes: `Payslip for ${formatPayrollPeriod(period)} payroll run.`,
      status: "active",
    };
    const localRecord = {
      id: `payslip-${Date.now()}-${person.id}`,
      ...payload,
      staffName: person.name,
      staffEmail: person.email || "",
      uploadedAt: new Date().toISOString(),
      storagePath: "Pending upload",
    };
    setHrFiles((current) => [localRecord, ...current]);
    setPayslipStatus(`Uploading ${person.name}'s payslip...`);
    addAuditLog("Payslip upload started", `${person.name}: ${formatPayrollPeriod(period)}`);
    try {
      if (!hasSupabaseConfig) throw new Error("Supabase is not configured.");
      const { uploadHrFile } = await loadSupabaseModule();
      const saved = await uploadHrFile(payload, file);
      setHrFiles((current) => current.map((item) => item.id === localRecord.id ? saved : item));
      addAuditLog("Payslip uploaded", `${person.name}: ${formatPayrollPeriod(period)}`);
      const notification = saved.payslipNotification;
      if (notification?.emailed) {
        setPayslipStatus(notification.alreadyNotified
          ? `${person.name}'s payslip uploaded. Its availability email was already sent.`
          : `${person.name}'s payslip uploaded and availability email sent.`);
        addAuditLog("Payslip availability emailed", `${person.name}: ${formatPayrollPeriod(period)}`);
      } else {
        setPayslipStatus(`${person.name}'s payslip uploaded, but its availability email failed: ${notification?.emailError || "check email settings"}`);
        addAuditLog("Payslip availability email failed", `${person.name}: ${formatPayrollPeriod(period)} · ${notification?.emailError || "Email failed"}`);
      }
    } catch (error) {
      setHrFiles((current) => current.map((item) => item.id === localRecord.id ? { ...item, storagePath: "", syncError: error.message || "Upload failed" } : item));
      setPayslipStatus(`Payslip upload failed: ${error.message || "check Supabase Storage permissions"}`);
    }
  }

  function normalisePinInput(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 4);
  }

  function clearPayPrivacyDrafts() {
    setPayPinDraft("");
    setPayCurrentPinDraft("");
    setPayNewPinDraft("");
    setPayPasswordDraft("");
  }

  async function unlockPay(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(payPinDraft)) {
      setPayPrivacyStatus("Enter your four-digit PIN.");
      return;
    }
    setPayPrivacyBusy(true);
    setPayPrivacyStatus("Checking PIN...");
    try {
      const { verifyStaffPayPin } = await loadSupabaseModule();
      await verifyStaffPayPin(payPinDraft);
      setPayUnlocked(true);
      setPayPrivacyMode("");
      setPayPrivacyStatus("");
      clearPayPrivacyDrafts();
    } catch (error) {
      setPayPrivacyStatus(error.message || "That PIN could not be verified.");
      setPayPinDraft("");
    } finally {
      setPayPrivacyBusy(false);
    }
  }

  async function configurePayPin(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(payNewPinDraft)) {
      setPayPrivacyStatus("Choose a PIN containing exactly four digits.");
      return;
    }
    setPayPrivacyBusy(true);
    setPayPrivacyStatus("Protecting Pay...");
    try {
      const { setStaffPayPin } = await loadSupabaseModule();
      await setStaffPayPin(payNewPinDraft);
      setHasPayPin(true);
      setPayUnlocked(false);
      setPayPrivacyMode("");
      setPayPrivacyStatus("Pay is hidden. Enter your new PIN to open it.");
      clearPayPrivacyDrafts();
    } catch (error) {
      setPayPrivacyStatus(error.message || "The privacy PIN could not be set.");
    } finally {
      setPayPrivacyBusy(false);
    }
  }

  async function changePayPin(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(payCurrentPinDraft) || !/^\d{4}$/.test(payNewPinDraft)) {
      setPayPrivacyStatus("Enter the current PIN and a new four-digit PIN.");
      return;
    }
    setPayPrivacyBusy(true);
    setPayPrivacyStatus("Changing PIN...");
    try {
      const { changeStaffPayPin } = await loadSupabaseModule();
      await changeStaffPayPin(payCurrentPinDraft, payNewPinDraft);
      setPayPrivacyMode("");
      setPayPrivacyStatus("Your Pay privacy PIN has been changed.");
      clearPayPrivacyDrafts();
    } catch (error) {
      setPayPrivacyStatus(error.message || "The PIN could not be changed.");
    } finally {
      setPayPrivacyBusy(false);
    }
  }

  async function resetPayPin(event) {
    event.preventDefault();
    if (!payPasswordDraft || !/^\d{4}$/.test(payNewPinDraft)) {
      setPayPrivacyStatus("Enter your account password and a new four-digit PIN.");
      return;
    }
    setPayPrivacyBusy(true);
    setPayPrivacyStatus("Confirming your password...");
    try {
      const { resetStaffPayPin } = await loadSupabaseModule();
      await resetStaffPayPin(payPasswordDraft, payNewPinDraft);
      setHasPayPin(true);
      setPayUnlocked(true);
      setPayPrivacyMode("");
      setPayPrivacyStatus("Your PIN has been reset and Pay is unlocked.");
      clearPayPrivacyDrafts();
    } catch (error) {
      setPayPrivacyStatus(error.message || "The PIN could not be reset.");
      setPayPasswordDraft("");
    } finally {
      setPayPrivacyBusy(false);
    }
  }

  async function removePayPin(event) {
    event.preventDefault();
    if (!payPasswordDraft) {
      setPayPrivacyStatus("Enter your account password to remove the PIN.");
      return;
    }
    setPayPrivacyBusy(true);
    setPayPrivacyStatus("Confirming your password...");
    try {
      const { removeStaffPayPin } = await loadSupabaseModule();
      await removeStaffPayPin(payPasswordDraft);
      setHasPayPin(false);
      setPayUnlocked(true);
      setPayPrivacyMode("");
      setPayPrivacyStatus("The privacy PIN has been removed.");
      clearPayPrivacyDrafts();
    } catch (error) {
      setPayPrivacyStatus(error.message || "The PIN could not be removed.");
      setPayPasswordDraft("");
    } finally {
      setPayPrivacyBusy(false);
    }
  }

  function hidePayNow() {
    if (!hasPayPin) {
      setPayPrivacyMode("set");
      setPayPrivacyStatus("Set a four-digit PIN before hiding Pay.");
      return;
    }
    setPayUnlocked(false);
    setPayPrivacyMode("");
    setPayPrivacyStatus("Pay is hidden.");
    clearPayPrivacyDrafts();
  }

  const payPrivacyPanel = payPrivacyMode ? (
    <section className="pay-privacy-drawer" aria-label="Pay privacy settings">
      <div>
        <p className="eyebrow">Privacy controls</p>
        <h3>{payPrivacyMode === "set" ? "Set a four-digit PIN" : payPrivacyMode === "change" ? "Change your PIN" : payPrivacyMode === "remove" ? "Remove Pay PIN" : "Reset your PIN"}</h3>
        <p>{payPrivacyMode === "set"
          ? "Once set, Pay hides immediately and asks for this PIN whenever you return."
          : payPrivacyMode === "change"
            ? "Enter your current PIN, then choose a new four-digit PIN."
            : payPrivacyMode === "remove"
              ? "Confirm your account password to stop PIN-locking the Pay screen."
              : "Confirm your identity with your account password, then choose a new PIN."}</p>
      </div>
      <form onSubmit={payPrivacyMode === "set" ? configurePayPin : payPrivacyMode === "change" ? changePayPin : payPrivacyMode === "remove" ? removePayPin : resetPayPin}>
        {payPrivacyMode === "change" && (
          <label>Current PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength="4" value={payCurrentPinDraft} onChange={(event) => setPayCurrentPinDraft(normalisePinInput(event.target.value))} /></label>
        )}
        {["reset", "remove"].includes(payPrivacyMode) && (
          <label>Account password<input type="password" autoComplete="current-password" value={payPasswordDraft} onChange={(event) => setPayPasswordDraft(event.target.value)} /></label>
        )}
        {payPrivacyMode !== "remove" && (
          <label>New four-digit PIN<input type="password" inputMode="numeric" autoComplete="new-password" maxLength="4" value={payNewPinDraft} onChange={(event) => setPayNewPinDraft(normalisePinInput(event.target.value))} /></label>
        )}
        <div>
          <button className="button primary" type="submit" disabled={payPrivacyBusy}>{payPrivacyBusy ? "Please wait..." : payPrivacyMode === "remove" ? "Remove PIN" : payPrivacyMode === "set" ? "Set PIN & hide Pay" : payPrivacyMode === "change" ? "Change PIN" : "Reset PIN"}</button>
          <button className="button subtle" type="button" onClick={() => { setPayPrivacyMode(""); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }} disabled={payPrivacyBusy}>Cancel</button>
        </div>
      </form>
    </section>
  ) : null;

  if (!payPrivacyReady || (hasPayPin && !payUnlocked)) {
    return (
      <div className="pay-privacy-lock-screen">
        <section className="pay-lock-card">
          <div className="pay-lock-icon"><LockKeyhole size={30} /></div>
          <p className="eyebrow">Pay privacy</p>
          <h2>{payPrivacyReady ? "Pay is hidden" : "Securing Pay..."}</h2>
          <p>{payPrivacyReady ? "Enter your four-digit PIN before viewing pay details or payslips." : "Checking your privacy settings."}</p>
          {payPrivacyReady && (
            <form onSubmit={unlockPay}>
              <label>
                Four-digit PIN
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength="4"
                  value={payPinDraft}
                  onChange={(event) => setPayPinDraft(normalisePinInput(event.target.value))}
                  autoFocus
                />
              </label>
              <button className="button primary" type="submit" disabled={payPrivacyBusy || payPinDraft.length !== 4}>{payPrivacyBusy ? "Checking..." : "Unlock Pay"}</button>
            </form>
          )}
          {payPrivacyReady && (
            <button className="pay-reset-link" type="button" onClick={() => { setPayPrivacyMode(payPrivacyMode === "reset" ? "" : "reset"); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }}>
              Forgotten your PIN? Reset with your password
            </button>
          )}
          {payPrivacyStatus && <p className="pay-privacy-status" role="status">{payPrivacyStatus}</p>}
        </section>
        {payPrivacyMode === "reset" && payPrivacyPanel}
      </div>
    );
  }

  return (
    <div className="stack payroll-console">
      <section className="pay-engine-hero">
        <div className="pay-engine-heading">
          <p className="eyebrow">Pay engine room</p>
          <h2>{isStaff ? "Your pay, under your control" : "Payroll command centre"}</h2>
          <p>{isStaff ? "Payslips, monthly figures and pay history in one secure place." : "Run the month, inspect every payslip and close payroll from one control surface."}</p>
        </div>
        <div className="pay-engine-controls">
          <label>Viewing month<select value={period} onChange={(event) => setPeriod(event.target.value)}>{Array.from(new Set([...availablePeriods, currentPayrollPeriod()])).filter(validPayrollPeriod).map((item) => <option key={item} value={item}>{formatPayrollPeriod(item)}</option>)}</select></label>
          <div className="pay-engine-privacy-actions">
            {hasPayPin ? (
              <>
                <button className="button primary" type="button" onClick={hidePayNow}><LockKeyhole size={16} /> Hide pay</button>
                <button className="button subtle" type="button" onClick={() => { setPayPrivacyMode(payPrivacyMode === "change" ? "" : "change"); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }}>Change PIN</button>
                <button className="button subtle" type="button" onClick={() => { setPayPrivacyMode(payPrivacyMode === "reset" ? "" : "reset"); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }}>Reset PIN</button>
                <button className="button subtle" type="button" onClick={() => { setPayPrivacyMode(payPrivacyMode === "remove" ? "" : "remove"); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }}>Remove PIN</button>
              </>
            ) : (
              <button className="button primary" type="button" onClick={() => { setPayPrivacyMode("set"); setPayPrivacyStatus(""); clearPayPrivacyDrafts(); }}><LockKeyhole size={16} /> Set privacy PIN</button>
            )}
          </div>
        </div>
        <div className="pay-engine-status-strip">
          <span><i className={hasPayPin ? "online" : "attention"} /> Privacy {hasPayPin ? "armed" : "not set"}</span>
          <span><i className={monthlyPayslipFiles.length || periodStaffPayslipFiles.length ? "online" : "attention"} /> {isStaff ? `${periodStaffPayslipFiles.length} payslip${periodStaffPayslipFiles.length === 1 ? "" : "s"}` : `${monthlyPayslipFiles.length} payslips`} this month</span>
          <span><i className={currentRun.status === "Paid" ? "online" : "neutral"} /> {isStaff ? staffSelectedMonth.status || "Payslip record" : currentRun.status || "Draft"}</span>
        </div>
        {payPrivacyStatus && <p className="pay-privacy-status" role="status">{payPrivacyStatus}</p>}
      </section>
      {payPrivacyPanel}
      <section className="pay-engine-top-grid">
        <article className="pay-engine-payslip-vault">
          <div className="pay-engine-card-head">
            <div>
              <p className="eyebrow">Payslip vault</p>
              <h3>{isStaff ? "Your payslip is ready" : `${formatPayrollPeriod(period)} payslips`}</h3>
            </div>
            <Badge value={isStaff ? `${periodStaffPayslipFiles.length} this month` : `${monthlyPayslipFiles.length} uploaded`} />
          </div>
          {isStaff ? (
            staffPayslipFiles.length ? (
              <div className="pay-engine-payslip-focus">
                <label>
                  Choose payslip
                  <select value={selectedStaffPayslip?.id || ""} onChange={(event) => setSelectedPayslipId(event.target.value)}>
                    {staffPayslipFiles.map((file) => (
                      <option key={file.id} value={file.id}>{formatPayrollPeriod(payslipPeriod(file))} - {file.title || "Payslip"}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <span>{selectedStaffPayslip ? formatPayrollPeriod(payslipPeriod(selectedStaffPayslip)) : formatPayrollPeriod(period)}</span>
                  <strong>{selectedStaffPayslip?.title || "Payslip"}</strong>
                  <small>Stored privately. Sign-in and your Pay PIN protect access on shared devices.</small>
                </div>
                {selectedStaffPayslip?.fileUrl
                  ? <a className="button primary" href={selectedStaffPayslip.fileUrl} target="_blank" rel="noreferrer">Open payslip</a>
                  : <Badge value={selectedStaffPayslip?.storagePath ? "PDF uploaded" : "File pending"} />}
              </div>
            ) : <EmptyList title="No payslips yet" text="Your payslips will appear here as soon as payroll publishes them." />
          ) : (
            <>
              <div className="pay-engine-admin-payslips">
                {monthlyPayslipFiles.slice(0, 5).map((file) => (
                  <article key={file.id}>
                    <div><strong>{file.staffName}</strong><span>{formatCurrency(file.staffNetPay)} net</span></div>
                    {file.fileUrl ? <a href={file.fileUrl} target="_blank" rel="noreferrer">Open PDF</a> : <Badge value="Private file" />}
                  </article>
                ))}
                {!monthlyPayslipFiles.length && <EmptyList title="No payslips uploaded" text="Upload this month’s payslips from the payroll table below." />}
              </div>
              <div className="pay-engine-vault-actions">
                <span>{missingPayslipRows.length ? `${missingPayslipRows.length} still missing` : "All staff due pay have a payslip"}</span>
                <button className="button subtle" type="button" onClick={() => { setPayrollFilter(missingPayslipRows.length ? "missing-payslips" : "all"); setPayrollQuery(""); document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Open payslip controls</button>
              </div>
            </>
          )}
        </article>
        <article className="pay-engine-instruments">
          <div className="pay-engine-card-head">
            <div><p className="eyebrow">Live instruments</p><h3>{formatPayrollPeriod(period)}</h3></div>
            <span className="pay-engine-live"><i /> Live</span>
          </div>
          <div className="pay-engine-dials">
            <article><span>{isStaff ? "Gross pay" : "Gross payroll"}</span><strong>{formatCurrency(totalGross)}</strong><small>Payslip-backed total</small></article>
            <article><span>{isStaff ? "Net pay" : "Net payroll"}</span><strong>{formatCurrency(totalNet)}</strong><small>After recorded deductions</small></article>
            <article><span>Paid hours</span><strong>{totalHours.toFixed(2)}</strong><small>{isStaff ? "Approved hours" : `${submittedSites} submitted sites`}</small></article>
            <article><span>{isStaff ? "Pay status" : "Run status"}</span><strong>{isStaff ? staffSelectedMonth.status || "Recorded" : currentRun.status || "Draft"}</strong><small>{isStaff ? "For selected month" : `${approvedSites} approved sites`}</small></article>
          </div>
        </article>
      </section>
      {isAdmin && (
        <section className="payroll-review-grid payroll-summary-grid" aria-label="Payroll month summary">
          {payrollSummaryCards.map((card) => (
            <button
              className={`payroll-review-card${payrollFilter === card.filter ? " active" : ""}`}
              key={card.filter}
              type="button"
              onClick={() => {
                setPayrollFilter(card.filter);
                setPayrollQuery("");
                document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.text}</small>
            </button>
          ))}
        </section>
      )}
      {isAdmin && (
        <section className="payroll-checklist-panel">
          <div className="payroll-checklist-head">
            <div>
              <p className="eyebrow">Monthly payroll checklist</p>
              <h3>{checklistComplete}/{checklistItems.length} steps complete for {formatPayrollPeriod(period)}.</h3>
              <p>Use this to close the month cleanly: enter hours, review totals, upload payslips and mark the run paid.</p>
            </div>
            <Progress value={Math.round((checklistComplete / checklistItems.length) * 100)} label={`${checklistComplete}/${checklistItems.length} complete`} />
          </div>
          <div className="payroll-checklist-grid">
            {checklistItems.map((item) => (
              <article className={item.done ? "complete" : "open"} key={item.title}>
                <div>
                  <Badge value={item.done ? "Done" : "Open"} />
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
                <button className="button subtle" type="button" onClick={item.onClick} disabled={item.done || item.disabled}>{item.action}</button>
              </article>
            ))}
          </div>
        </section>
      )}
      {isAdmin && (
        <Panel title={`${formatPayrollPeriod(period)} Payroll Run`}>
          <div className="payroll-run-console">
            <div>
              <Badge value={currentRun.status || "Draft"} />
              <p>Net payroll is {formatCurrency(totalNet)} from base monthly salary, {totalHours.toFixed(2)} additional approved hours, {formatCurrency(totalExpenses)} expenses and {formatCurrency(totalDeductions)} deductions.</p>
              {runLocked && <p className="panel-note">This paid payroll run is locked. {canMarkPaid ? "Unlock it only if a correction is needed." : "A Superadmin must unlock it before changes can be made."}</p>}
              {syncStatus && <p>{syncStatus}</p>}
              {payslipStatus && <p>{payslipStatus}</p>}
            </div>
            <div className="payroll-run-actions">
              {canMarkPaid && runLocked && <button className="button subtle" type="button" onClick={unlockPayrollRun}>Unlock run</button>}
              <button className="button light" type="button" onClick={() => setRunStatus("Reviewed")} disabled={!payrollReady || runLocked}>Mark reviewed</button>
              <button className="button light" type="button" onClick={() => setRunStatus("Approved")} disabled={!payrollReady || runLocked}>Approve payroll</button>
              <button className="button primary" type="button" onClick={() => setRunStatus("Paid")} disabled={!payrollReady || !canMarkPaid || currentRun.status !== "Approved" || runLocked || payrollCloseBlockers.length > 0}>Mark paid</button>
              <button className="button subtle" type="button" onClick={() => exportPayroll(payrollRows, "full payroll")} disabled={!payrollReady}>Export full CSV</button>
              <button className="button subtle" type="button" onClick={exportPayrollPdf} disabled={!payrollReady}>Export PDF</button>
            </div>
          </div>
          <div className={`payroll-close-warnings${payrollCloseBlockers.length ? " has-blockers" : ""}`}>
            <div>
              <p>{payrollCloseBlockers.length ? "Payroll cannot be marked paid yet." : "Payroll close checks"}</p>
              <small>{payrollCloseWarnings.length ? "Resolve blockers before closing the run. Review notes are shown for awareness." : "No close warnings for this payroll run."}</small>
            </div>
            <div className="payroll-close-warning-list">
              {payrollCloseWarnings.map((warning) => (
                <article className={warning.type === "blocker" ? "blocker" : "review"} key={warning.title}>
                  <div>
                    <Badge value={warning.type === "blocker" ? "Blocker" : "Review"} />
                    <strong>{warning.title}</strong>
                    <span>{warning.text}</span>
                  </div>
                  <button className="button subtle" type="button" onClick={warning.onClick}>{warning.action}</button>
                </article>
              ))}
              {!payrollCloseWarnings.length && <Badge value="Clear to close" />}
            </div>
          </div>
          {!canMarkPaid && <p className="panel-note">Only Superadmin can mark a payroll run as paid.</p>}
        </Panel>
      )}
      {isAdmin && (
        <Panel title="Staff Payroll History">
          <div className="payroll-history-head">
            <div>
              <p>Open a staff member's month-by-month payroll record without leaving payroll.</p>
              <small>Shows saved periods with hours, salary, adjustments, payslip status and private payroll notes.</small>
            </div>
            <label>
              Staff member
              <select value={selectedHistoryStaff?.id || ""} onChange={(event) => setHistoryStaffId(event.target.value)}>
                {data.staff.map((person) => (
                  <option key={person.id} value={person.id}>{person.name} · {person.email || staffPrimaryLocation(person)}</option>
                ))}
              </select>
            </label>
          </div>
          <TableWrap>
            <table>
              <thead><tr><th>Month</th><th>Schools</th><th>Hours</th><th>Salary</th><th>Gross</th><th>Adjustments</th><th>Net</th><th>Payslip</th><th>Note</th></tr></thead>
              <tbody>
                {selectedStaffPayrollHistory.map((row) => (
                  <tr key={row.period}>
                    <td><strong>{formatPayrollPeriod(row.period)}</strong><br /><small>{row.status}</small></td>
                    <td>{row.schools.length ? row.schools.join(", ") : "Salary / no site hours"}</td>
                    <td>{row.hours.toFixed(2)}</td>
                    <td>{row.monthlySalary ? formatCurrency(row.monthlySalary) : "-"}</td>
                    <td>{formatCurrency(row.gross)}</td>
                    <td>{row.expenses || row.deductions ? `${formatCurrency(row.expenses)} expenses / ${formatCurrency(row.deductions)} deductions` : "-"}</td>
                    <td><strong>{formatCurrency(row.net)}</strong></td>
                    <td>{row.payslips.length ? row.payslips.slice(0, 2).map((file) => file.fileUrl ? <a className="payslip-view-link" href={file.fileUrl} key={file.id} target="_blank" rel="noreferrer">Open PDF</a> : <span key={file.id}>PDF uploaded</span>) : <Badge value="Missing" />}</td>
                    <td>{row.note || "-"}</td>
                  </tr>
                ))}
                {!selectedStaffPayrollHistory.length && (
                  <tr><td colSpan="9"><strong>No payroll history yet.</strong> This staff member does not have salary, hours, adjustments or payslips in the saved payroll periods.</td></tr>
                )}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
      {isAdmin && <PayrollAuditTrail events={data.payrollAudit} period={period} title={`${formatPayrollPeriod(period)} Payroll Audit`} />}
      {isStaff && (
        <section className="staff-pay-history-panel">
          <div className="staff-pay-history-head">
            <div>
              <p className="eyebrow">Pay history</p>
              <h3>Month-by-month pay records</h3>
              <p>Each month groups your submitted hours, salary, gross pay, adjustments, notes and payslips.</p>
            </div>
            <Badge value={`${staffMonthlyPayHistory.length} month${staffMonthlyPayHistory.length === 1 ? "" : "s"}`} />
          </div>
          <div className="staff-pay-month-grid">
            {staffMonthlyPayHistory.map((row) => (
              <article className={`staff-pay-month-card${row.period === period ? " active" : ""}`} key={row.period}>
                <button type="button" onClick={() => setPeriod(row.period)}>
                  <span>{formatPayrollPeriod(row.period)}</span>
                  <strong>{formatCurrency(row.gross)}</strong>
                  <small>{row.hours.toFixed(2)} hours · {row.payslips.length ? `${row.payslips.length} payslip${row.payslips.length === 1 ? "" : "s"}` : "No payslip yet"}</small>
                </button>
              </article>
            ))}
            {!staffMonthlyPayHistory.length && <EmptyList title="No pay history yet" text="Your pay history will appear once a month has been submitted or a payslip has been uploaded." />}
          </div>
        </section>
      )}
      {isStaff && (
        <Panel title={`${formatPayrollPeriod(period)} Pay Detail`}>
          <div className="staff-pay-detail-grid">
            <article>
              <span>Gross pay</span>
              <strong>{formatCurrency(staffSelectedMonth.gross)}</strong>
              <small>{staffSelectedMonth.payslipPay ? "Amount recorded on your payslip" : staffSelectedMonth.monthlySalary ? `${formatCurrency(staffSelectedMonth.monthlySalary)} salary` : "No salary recorded"}{!staffSelectedMonth.payslipPay && staffSelectedMonth.hourlyGross ? ` · ${formatCurrency(staffSelectedMonth.hourlyGross)} additional hours` : ""}</small>
            </article>
            <article>
              <span>Hours</span>
              <strong>{staffSelectedMonth.hours.toFixed(2)}</strong>
              <small>{staffSelectedMonth.schools.length ? staffSelectedMonth.schools.join(", ") : "No site hours submitted for this month"}</small>
            </article>
            <article>
              <span>Adjustments</span>
              <strong>{formatCurrency(staffSelectedMonth.expenses - staffSelectedMonth.deductions)}</strong>
              <small>{formatCurrency(staffSelectedMonth.expenses)} expenses · {formatCurrency(staffSelectedMonth.deductions)} deductions</small>
            </article>
            <article>
              <span>Net summary</span>
              <strong>{formatCurrency(staffSelectedMonth.net)}</strong>
              <small>{staffSelectedMonth.status || "Draft"} payroll status</small>
            </article>
          </div>
          <div className="staff-pay-notes">
            <div>
              <span>Notes</span>
              <p>{staffSelectedMonth.note || "No payroll note has been added for this month."}</p>
            </div>
            <Badge value={staffSelectedMonth.payslips.length ? `${staffSelectedMonth.payslips.length} payslip${staffSelectedMonth.payslips.length === 1 ? "" : "s"}` : "No payslip"} />
          </div>
        </Panel>
      )}
      {isAdmin && (
        <Panel title={`${formatPayrollPeriod(period)} Pay`}>
          <div className="payroll-table-controls" id="payroll-table">
            <div>
              <p>{visiblePayrollRows.length} of {payrollRows.length} staff shown.</p>
              <small>{payrollFilter === "missing-payslips" ? "Showing staff who need a payslip upload." : payrollFilter === "pay-due" ? "Showing staff with salary or hours this month." : "Use filters to focus this month’s payroll."}</small>
            </div>
            <div className="payroll-filter-controls">
              <label>Search<input value={payrollQuery} onChange={(event) => setPayrollQuery(event.target.value)} placeholder="Search staff, email or school" /></label>
              <label>View<select value={payrollFilter} onChange={(event) => setPayrollFilter(event.target.value)}>
                {payrollFilterOptions.map(([value, label]) => <option key={value} value={value}>{label} ({filterCounts[value] || 0})</option>)}
              </select></label>
              <button className="button light" type="button" disabled={!visiblePayrollRows.length} onClick={() => exportPayroll(visiblePayrollRows, payrollExportScopeLabel())}>Export shown</button>
              <button className="button subtle" type="button" disabled={!payrollQuery && payrollFilter === "pay-due"} onClick={() => { setPayrollQuery(""); setPayrollFilter("pay-due"); }}>Reset</button>
            </div>
          </div>
          <TableWrap>
            <table>
              <thead><tr><th>Staff</th><th>Submitted schools</th><th>Additional hours</th><th>Pay basis</th><th>Gross</th><th>Expenses</th><th>Deductions</th><th>Net</th><th>Payslip</th><th>Payroll note</th></tr></thead>
              <tbody>{visiblePayrollRows.map((row) => {
                const submittedEntries = row.payrollEntries.filter((entry) => ["Submitted", "Approved"].includes(entry.status));
                const schools = Array.from(new Set(row.payrollEntries.map((entry) => entry.schoolName)));
                const net = row.net;
                return (
                  <tr key={row.id}>
                    <td>
                      <button className="payroll-staff-link" type="button" onClick={() => onOpenStaffProfile?.(row.id)}>{row.name}</button>
                      <br /><small>{row.email || "No email"}</small>
                    </td>
                    <td>{schools.length ? schools.join(", ") : "No hours submitted"}</td>
                    <td><strong>{row.hours.toFixed(2)}</strong></td>
                    <td>
                      {row.payslipPay ? <><strong>Payslip record</strong><br /></> : null}
                      {row.annualSalary ? <><strong>{formatCurrency(row.monthlySalary)}/mo</strong><br /><small>{formatCurrency(row.annualSalary)} annual salary</small></> : null}
                      {row.payRate ? <><br /><small>{formatCurrency(row.payRate)}/hr extra hours</small></> : !row.annualSalary ? "No rate" : null}
                    </td>
                    <td>{formatCurrency(row.gross)}{row.hourlyGross ? <><br /><small>{formatCurrency(row.hourlyGross)} extra hours</small></> : null}</td>
                    <td><input type="number" min="0" step="0.01" value={row.expenses || ""} onChange={(event) => updateAdjustment(row.id, { expenses: event.target.value })} aria-label={`${row.name} expenses`} disabled={runLocked} /></td>
                    <td><input type="number" min="0" step="0.01" value={row.deductions || ""} onChange={(event) => updateAdjustment(row.id, { deductions: event.target.value })} aria-label={`${row.name} deductions`} disabled={runLocked} /></td>
                  <td><strong>{formatCurrency(net)}</strong></td>
                  <td>
                    <div className="payslip-cell">
                      {row.payslips.length ? (
                        row.payslips.slice(0, 2).map((file) => file.fileUrl
                          ? <a key={file.id} className="payslip-view-link" href={file.fileUrl} target="_blank" rel="noreferrer">{file.title}</a>
                          : <span key={file.id}>{file.title} · {file.storagePath === "Pending upload" ? "Uploading" : "Private file"}</span>)
                      ) : <Badge value={submittedEntries.length ? "Ready to upload" : "Pending hours"} />}
                      <label className="button subtle payslip-upload-button">
                        Upload
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          disabled={runLocked}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            uploadPayslip(row, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </td>
                  <td><input type="text" value={row.payrollNote} onChange={(event) => updateAdjustment(row.id, { note: event.target.value })} placeholder="Private payroll note" disabled={runLocked} /></td>
                </tr>
              );
            })}
            {!visiblePayrollRows.length && (
              <tr>
                <td colSpan="10"><strong>No payroll records for this month yet.</strong> Add salary details on staff profiles or use the Hours page to enter school hours.</td>
              </tr>
            )}</tbody>
            <tfoot>
              <tr>
                <td colSpan="2"><strong>Total</strong></td>
                <td><strong>{totalHours.toFixed(2)}</strong></td>
                <td />
                <td><strong>{formatCurrency(totalGross)}</strong></td>
                <td><strong>{formatCurrency(totalExpenses)}</strong></td>
                <td><strong>{formatCurrency(totalDeductions)}</strong></td>
                <td><strong>{formatCurrency(totalNet)}</strong></td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
        {!payrollRows.some((row) => staffIds.has(row.id) && (row.hours > 0 || row.monthlySalary > 0)) && <p className="panel-note">No salary or hourly payroll values are ready for this month yet.</p>}
      </Panel>
      )}
    </div>
  );
}

function PayrollAuditTrail({ events = [], period, school = "", title = "Payroll Audit" }) {
  const filtered = (events || [])
    .filter((event) => event.period === period)
    .filter((event) => !school || !event.school || event.school === school)
    .slice(0, 8);

  return (
    <Panel title={title}>
      <div className="payroll-audit-list">
        {filtered.length ? filtered.map((event) => (
          <article className="payroll-audit-item" key={event.id}>
            <div>
              <Badge value={event.school || "Run"} />
              <strong>{event.action}</strong>
              <p>{event.detail || "Payroll record updated."}</p>
            </div>
            <small>{event.actor} · {formatShortDate(event.createdAt?.slice(0, 10))}</small>
          </article>
        )) : (
          <article className="empty-row">
            <strong>No payroll audit events yet.</strong>
            <p>Edits, submissions, approvals and paid-status changes will appear here.</p>
          </article>
        )}
      </div>
    </Panel>
  );
}

function Rewards() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadRewards() {
    setLoading(true);
    setError("");
    try {
      setDashboard(await fetchAdminRewardsDashboard({ limit: 16 }));
    } catch (loadError) {
      setError(loadError?.message || "Rewards insights could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRewards();
  }, []);

  return (
    <Panel title="Rewards dashboard">
      <div className="rewards-dashboard">
        <header className="rewards-dashboard-intro">
          <div>
            <p className="eyebrow">Positive recognition</p>
            <h2>Celebrate brilliant moments across every club.</h2>
            <p>See which badges are being shared, who is recognising children and the latest achievements.</p>
          </div>
          <button type="button" onClick={loadRewards} disabled={loading}>{loading ? "Refreshing…" : "Refresh insights"}</button>
        </header>

        {error && <div className="register-report-message error" role="alert">{error}</div>}
        {!error && (
          <>
            <div className="rewards-dashboard-metrics" aria-label="Reward totals">
              {[
                ["Rewards issued today", dashboard?.today || 0, "✨"],
                ["This week", dashboard?.week || 0, "🏅"],
                ["This month", dashboard?.month || 0, "🎉"],
              ].map(([label, value, icon]) => (
                <article key={label}>
                  <span aria-hidden="true">{icon}</span>
                  <strong>{loading ? "—" : value}</strong>
                  <p>{label}</p>
                </article>
              ))}
            </div>

            <div className="rewards-dashboard-columns">
              <section>
                <div className="rewards-section-title">
                  <h3>Top badges awarded</h3>
                  <span>This month</span>
                </div>
                <div className="rewards-top-badges">
                  {dashboard?.topBadges?.length ? dashboard.topBadges.map((item) => {
                    const badge = rewardBadge(item.badgeType);
                    return (
                      <article key={item.badgeType}>
                        <span aria-hidden="true">{badge.icon}</span>
                        <div><strong>{badge.title}</strong><small>{badge.description}</small></div>
                        <b>{item.total}</b>
                      </article>
                    );
                  }) : <p className="rewards-empty">No badges have been awarded this month yet.</p>}
                </div>
              </section>

              <section>
                <div className="rewards-section-title">
                  <h3>Top staff recognising children</h3>
                  <span>This month</span>
                </div>
                <div className="rewards-top-staff">
                  {dashboard?.topStaff?.length ? dashboard.topStaff.map((item, index) => (
                    <article key={`${item.staffId || item.staffName}-${index}`}>
                      <span>{index + 1}</span>
                      <div><strong>{item.staffName || "Staff member"}</strong><small>{item.total} badge{item.total === 1 ? "" : "s"} awarded</small></div>
                    </article>
                  )) : <p className="rewards-empty">Staff reward activity will appear here.</p>}
                </div>
              </section>
            </div>

            <section className="rewards-recent">
              <div className="rewards-section-title">
                <h3>Recent achievements</h3>
                <span>Latest first</span>
              </div>
              <div className="rewards-recent-grid">
                {dashboard?.recent?.length ? dashboard.recent.map((item) => {
                  const badge = rewardBadge(item.badgeType);
                  return (
                    <article key={item.id}>
                      <span className="rewards-recent-icon" aria-hidden="true">{badge.icon}</span>
                      <div>
                        <strong>{item.childName}</strong>
                        <h4>{badge.title}</h4>
                        <p>{item.reason}</p>
                        <small>{item.staffName} · {item.clubName || item.siteName || "Après School"} · {registerReportDateTime(item.awardedAt)}</small>
                      </div>
                    </article>
                  );
                }) : <p className="rewards-empty">New badges will appear here as staff award them.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </Panel>
  );
}

function Sessions({ data }) {
  return <Panel title="Scheduling & Sessions"><SessionList data={data} detailed /></Panel>;
}

const registerReportTypeLabels = {
  incident: "Incident",
  first_aid: "First aid",
  safeguarding: "Safeguarding",
};

const standardRegisterReportStatuses = [
  ["new", "New"],
  ["under_review", "Under review"],
  ["parent_follow_up", "Parent follow-up"],
  ["closed", "Closed"],
];

const restrictedRegisterReportStatuses = [
  ["referred_to_dsl", "Referred to DSL"],
  ["dsl_reviewing", "DSL reviewing"],
  ["dsl_closed", "Closed by DSL"],
];

function registerReportStatusLabel(status) {
  return [...standardRegisterReportStatuses, ...restrictedRegisterReportStatuses]
    .find(([value]) => value === status)?.[1] || String(status || "New").replaceAll("_", " ");
}

function registerReportDateTime(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reportBooleanLabel(value) {
  if (value === true || value === "yes") return "Yes";
  if (value === false || value === "no") return "No";
  return value || "Not recorded";
}

function reportLocalIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const SAFEGUARDING_STATUSES = ["New", "DSL Reviewing", "Monitoring", "External Referral", "Closed", "Archived"];
const SAFEGUARDING_PRIORITIES = ["Low", "Standard", "High", "Urgent"];

function SafeguardingCases() {
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedCase, setSelectedCase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Open");
  const [siteFilter, setSiteFilter] = useState("All");
  const [draftStatus, setDraftStatus] = useState("New");
  const [draftPriority, setDraftPriority] = useState("Standard");
  const [chronologyType, setChronologyType] = useState("Case note");
  const [chronologyNote, setChronologyNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadCases({ keepSelection = true } = {}) {
    setLoading(true);
    setError("");
    try {
      const next = await fetchSafeguardingCases({ limit: 500 });
      setCases(next);
      setSelectedId((current) => keepSelection && next.some((item) => item.id === current) ? current : (next[0]?.id || ""));
    } catch (loadError) {
      setError(loadError?.message || "Safeguarding cases could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCases({ keepSelection: false });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedCase(null);
      return;
    }
    let active = true;
    fetchSafeguardingCase({ caseId: selectedId })
      .then((detail) => {
        if (!active) return;
        setSelectedCase(detail);
        setDraftStatus(detail?.status || "New");
        setDraftPriority(detail?.priority || "Standard");
      })
      .catch((loadError) => active && setError(loadError?.message || "The case could not be opened."));
    return () => { active = false; };
  }, [selectedId]);

  async function refreshSelected() {
    if (!selectedId) return;
    const [detail] = await Promise.all([
      fetchSafeguardingCase({ caseId: selectedId }),
      loadCases(),
    ]);
    setSelectedCase(detail);
    setDraftStatus(detail?.status || "New");
    setDraftPriority(detail?.priority || "Standard");
  }

  async function saveCaseSettings() {
    if (!selectedCase) return;
    setSaving(true);
    setMessage("");
    try {
      await updateSafeguardingCase({
        caseId: selectedCase.id,
        status: draftStatus,
        priority: draftPriority,
        assignedDslId: selectedCase.assignedDslId || null,
      });
      await refreshSelected();
      setMessage("Case updated and added to the chronology.");
    } catch (saveError) {
      setMessage(saveError?.message || "The case could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function addChronologyEntry(event) {
    event.preventDefault();
    if (!selectedCase || !chronologyNote.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await appendSafeguardingCaseEntry({
        caseId: selectedCase.id,
        entryType: chronologyType,
        content: chronologyNote,
      });
      setChronologyNote("");
      await refreshSelected();
      setMessage("Chronology entry added permanently.");
    } catch (saveError) {
      setMessage(saveError?.message || "The chronology entry could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function addTask(event) {
    event.preventDefault();
    if (!selectedCase || !taskTitle.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await createSafeguardingCaseTask({
        caseId: selectedCase.id,
        title: taskTitle,
        dueAt: taskDue ? new Date(`${taskDue}T17:00:00`).toISOString() : null,
      });
      setTaskTitle("");
      setTaskDue("");
      await refreshSelected();
      setMessage("Follow-up task added.");
    } catch (saveError) {
      setMessage(saveError?.message || "The task could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(taskId) {
    setSaving(true);
    setMessage("");
    try {
      await completeSafeguardingCaseTask({ taskId });
      await refreshSelected();
      setMessage("Task completed and recorded in the chronology.");
    } catch (saveError) {
      setMessage(saveError?.message || "The task could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  const sites = [...new Set(cases.map((item) => item.siteName).filter(Boolean))].sort();
  const queryText = query.trim().toLowerCase();
  const visibleCases = cases.filter((item) => {
    const closed = ["Closed", "Archived"].includes(item.status);
    if (statusFilter === "Open" && closed) return false;
    if (statusFilter === "Closed" && !closed) return false;
    if (siteFilter !== "All" && item.siteName !== siteFilter) return false;
    if (!queryText) return true;
    return [item.concernNumber, item.childName, item.siteName, item.status, ...(item.categories || [])]
      .join(" ").toLowerCase().includes(queryText);
  });
  const openCases = cases.filter((item) => !["Closed", "Archived"].includes(item.status)).length;
  const urgentCases = cases.filter((item) => item.priority === "Urgent").length;
  const openTasks = selectedCase?.tasks?.filter((task) => task.status === "Open") || [];

  return (
    <div className="safeguarding-page">
      <section className="safeguarding-heading">
        <div>
          <span className="eyebrow">Restricted · DSL access</span>
          <h2>Safeguarding cases</h2>
          <p>Protected case management built around permanent chronology, factual recording and professional oversight.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => loadCases()} disabled={loading}>{loading ? "Refreshing…" : "Refresh cases"}</button>
      </section>

      <div className="safeguarding-metrics">
        <article><span>Open cases</span><strong>{openCases}</strong></article>
        <article className={urgentCases ? "urgent" : ""}><span>Urgent priority</span><strong>{urgentCases}</strong></article>
        <article><span>All cases</span><strong>{cases.length}</strong></article>
        <article><span>Open tasks in case</span><strong>{openTasks.length}</strong></article>
      </div>

      <section className="safeguarding-filters">
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Concern number, child, category or site" /></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Open</option><option>Closed</option><option>All</option></select></label>
        <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option>All</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label>
      </section>

      {error && <div className="notice error">{error}</div>}

      <div className="safeguarding-layout">
        <section className="safeguarding-case-list">
          <header><strong>{visibleCases.length} case{visibleCases.length === 1 ? "" : "s"}</strong><span>Most recently updated</span></header>
          {!loading && !visibleCases.length ? <div className="report-review-empty"><strong>No matching cases</strong><p>Submitted concerns will appear here securely.</p></div> : visibleCases.map((item) => (
            <button type="button" key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}>
              <span>Concern #{item.concernNumber}</span>
              <strong>{item.childName}</strong>
              <small>{item.siteName || "Site not recorded"} · {registerReportDateTime(item.updatedAt)}</small>
              <div><em className={`priority-${String(item.priority).toLowerCase()}`}>{item.priority}</em><b>{item.status}</b></div>
            </button>
          ))}
        </section>

        <section className="safeguarding-case-detail">
          {!selectedCase ? <div className="report-review-empty"><strong>Select a safeguarding case</strong><p>The immutable original concern and chronology will appear here.</p></div> : (
            <>
              <header>
                <div><span>Concern #{selectedCase.concernNumber}</span><h3>{selectedCase.childName}</h3><p>{selectedCase.siteName || "Site not recorded"} · {selectedCase.clubName || "Club not recorded"} · {selectedCase.sessionLabel || "Session not recorded"}</p></div>
                <span className="restricted-access-badge">Confidential</span>
              </header>

              <section className="safeguarding-original">
                <div><span>Original concern · locked</span><small>Submitted {registerReportDateTime(selectedCase.createdAt)} by {selectedCase.reporterName}</small></div>
                <p>{selectedCase.factualAccount}</p>
                <dl>
                  <div><dt>Safe now</dt><dd>{selectedCase.childSafeNow ? "Yes" : "No — urgent escalation recorded"}</dd></div>
                  <div><dt>Source</dt><dd>{selectedCase.concernSource}</dd></div>
                  <div><dt>Categories</dt><dd>{selectedCase.categories?.join(" · ")}</dd></div>
                  <div><dt>Immediate action</dt><dd>{selectedCase.immediateAction}</dd></div>
                  <div><dt>DSL informed</dt><dd>{selectedCase.dslInformed ? `Yes · ${selectedCase.dslInformedWho || ""}` : "No"}</dd></div>
                  <div><dt>Witnesses</dt><dd>{[...(selectedCase.witnesses?.staff || []), ...(selectedCase.witnesses?.children || []), ...(selectedCase.witnesses?.otherAdults || [])].join(" · ") || "None recorded"}</dd></div>
                </dl>
              </section>

              <section className="safeguarding-case-controls">
                <h4>Case oversight</h4>
                <label>Status<select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>{SAFEGUARDING_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Priority<select value={draftPriority} onChange={(event) => setDraftPriority(event.target.value)}>{SAFEGUARDING_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
                <button className="button primary" type="button" onClick={saveCaseSettings} disabled={saving}>Save case update</button>
              </section>

              <section className="safeguarding-chronology">
                <header><div><h4>Chronology</h4><p>Permanent safeguarding history. Entries cannot be edited or deleted.</p></div><span>{selectedCase.chronology?.length || 0} entries</span></header>
                <div className="safeguarding-timeline">
                  {(selectedCase.chronology || []).map((entry) => (
                    <article key={entry.id}>
                      <i />
                      <div><span>{entry.entryType}</span><strong>{registerReportDateTime(entry.occurredAt)}</strong><p>{entry.content}</p><small>{entry.authorName}{entry.siteName ? ` · ${entry.siteName}` : ""}</small></div>
                    </article>
                  ))}
                </div>
                <form onSubmit={addChronologyEntry}>
                  <label>Entry type<select value={chronologyType} onChange={(event) => setChronologyType(event.target.value)}><option>Case note</option><option>Parent contact</option><option>Child meeting</option><option>External referral</option><option>Monitoring update</option></select></label>
                  <label>Factual chronology entry<textarea rows="4" value={chronologyNote} onChange={(event) => setChronologyNote(event.target.value)} placeholder="Record the factual action, contact or update." required /></label>
                  <button className="button primary" disabled={saving}>Add chronology entry</button>
                </form>
              </section>

              <section className="safeguarding-tasks">
                <header><h4>Follow-up actions</h4><span>{openTasks.length} open</span></header>
                {(selectedCase.tasks || []).map((task) => (
                  <article key={task.id} className={task.status === "Completed" ? "complete" : ""}>
                    <div><strong>{task.title}</strong><small>{task.dueAt ? `Due ${registerReportDateTime(task.dueAt)}` : "No due date"} · {task.status}</small></div>
                    {task.status === "Open" && <button type="button" onClick={() => completeTask(task.id)} disabled={saving}>Mark complete</button>}
                  </article>
                ))}
                <form onSubmit={addTask}>
                  <label>Action<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="For example: speak to parent" required /></label>
                  <label>Due date<input type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label>
                  <button className="button secondary" disabled={saving}>Add task</button>
                </form>
              </section>
              {message && <div className="register-report-message success" role="status">{message}</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Incidents() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [siteFilter, setSiteFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  async function loadReports({ preserveSelection = true } = {}) {
    setLoading(true);
    setLoadError("");
    try {
      const nextReports = await fetchRegisterPupilReports({ limit: 500 });
      setReports(nextReports);
      setSelectedId((current) => {
        if (preserveSelection && nextReports.some((report) => report.id === current)) return current;
        return nextReports[0]?.id || "";
      });
    } catch (error) {
      setLoadError(error?.message || "The report queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports({ preserveSelection: false });
  }, []);

  const availableSites = [...new Set(reports.map((report) => report.siteName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const rangeReports = reports.filter((report) => {
    if (siteFilter !== "all" && report.siteName !== siteFilter) return false;
    const occurredDate = reportLocalIsoDate(report.occurredAt || report.createdAt);
    if (dateFrom && occurredDate < dateFrom) return false;
    if (dateTo && occurredDate > dateTo) return false;
    return true;
  });
  const queryText = query.trim().toLowerCase();
  const filteredReports = rangeReports.filter((report) => {
    if (typeFilter !== "all" && report.type !== typeFilter) return false;
    const isClosed = ["closed", "dsl_closed"].includes(report.status);
    if (statusFilter === "open" && isClosed) return false;
    if (statusFilter === "closed" && !isClosed) return false;
    if (!queryText) return true;
    return [
      report.childName,
      report.siteName,
      report.programmeName,
      report.sessionLabel,
      report.summary,
      report.reporterName,
      report.status,
    ].filter(Boolean).join(" ").toLowerCase().includes(queryText);
  });
  const selectedReport = filteredReports.find((report) => report.id === selectedId)
    || filteredReports[0]
    || null;

  useEffect(() => {
    if (!selectedReport) {
      setDraftStatus("");
      setFollowUpNote("");
      return;
    }
    setDraftStatus(selectedReport.status || (selectedReport.sensitivity === "safeguarding_restricted" ? "referred_to_dsl" : "new"));
    setFollowUpNote(selectedReport.followUpNote || "");
    setSaveMessage("");
  }, [selectedReport?.id]);

  const firstAidCount = rangeReports.filter((report) => report.type === "first_aid").length;
  const incidentCount = rangeReports.filter((report) => report.type === "incident").length;
  const safeguardingCount = rangeReports.filter((report) => report.type === "safeguarding").length;
  const statusOptions = selectedReport?.sensitivity === "safeguarding_restricted"
    ? restrictedRegisterReportStatuses
    : standardRegisterReportStatuses;

  async function saveReview() {
    if (!selectedReport || !draftStatus) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await updateRegisterPupilReport({
        reportId: selectedReport.id,
        status: draftStatus,
        followUpNote,
      });
      setSaveMessage("Review saved.");
      await loadReports();
    } catch (error) {
      setSaveMessage(error?.message || "The review could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function exportReportSummary() {
    const rows = [
      ["Date", "Report type", "Site", "Child", "Programme", "Session", "Status", "Recorded by", "Affected areas", "Summary"],
      ...rangeReports.map((report) => [
        reportLocalIsoDate(report.occurredAt || report.createdAt),
        registerReportTypeLabels[report.type] || report.type,
        report.siteName || "",
        report.childName || "",
        report.programmeName || "",
        report.sessionLabel || "",
        registerReportStatusLabel(report.status),
        report.reporterName || "",
        report.type === "first_aid" ? registerBodyAreasLabel(report.details || {}) : "",
        report.summary || "",
      ]),
    ];
    downloadCsv(`apres-school-welfare-report-${dateFrom || "all"}-${dateTo || "all"}.csv`, rows);
  }

  const details = selectedReport?.details || {};
  const detailRows = selectedReport?.type === "first_aid"
    ? [
      ["Affected areas", registerBodyAreasLabel(details)],
      ["Treatment given", details.treatment || "Not recorded"],
      ["Action taken", details.actionTaken || "Not recorded"],
      ["Parent notified", reportBooleanLabel(details.parentNotified)],
    ]
    : selectedReport?.type === "safeguarding"
      ? [
        ["Concern route", details.concernRoute || "Not recorded"],
        ["Immediate action", details.actionTaken || "Not recorded"],
        ["DSL notified", reportBooleanLabel(details.dslNotified)],
      ]
      : [
        ["Category", details.category || "Not recorded"],
        ["Action taken", details.actionTaken || "Not recorded"],
        ["Parent notified", reportBooleanLabel(details.parentNotified)],
      ];

  return (
    <div className="report-review-page">
      <section className="report-review-heading">
        <div>
          <span className="eyebrow">Pupil welfare</span>
          <h2>Reports and follow-up</h2>
          <p>Review reports recorded from the register, filter by site and date, and keep a clear, secure follow-up trail.</p>
        </div>
        <div className="report-review-heading-actions">
          <button className="button light" type="button" onClick={exportReportSummary} disabled={!rangeReports.length}>Export report</button>
          <button className="button secondary" type="button" onClick={() => loadReports()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh reports"}
          </button>
        </div>
      </section>

      <div className="report-review-metrics">
        <article><span>Total in range</span><strong>{rangeReports.length}</strong></article>
        <article><span>First aid</span><strong>{firstAidCount}</strong></article>
        <article><span>Incidents</span><strong>{incidentCount}</strong></article>
        <article className={safeguardingCount ? "restricted" : ""}>
          <span>Safeguarding visible to you</span><strong>{safeguardingCount}</strong>
        </article>
      </div>

      <section className="report-review-filters" aria-label="Filter pupil reports">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Child, school, session or summary" />
        </label>
        <label>
          Site
          <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
            <option value="all">All sites</option>
            {availableSites.map((site) => <option key={site} value={site}>{site}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Report type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All report types</option>
            <option value="incident">Incidents</option>
            <option value="first_aid">First aid</option>
            <option value="safeguarding">Safeguarding</option>
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All statuses</option>
          </select>
        </label>
      </section>

      {loadError ? <div className="notice error">{loadError}</div> : null}

      <div className="report-review-layout">
        <section className="report-review-queue" aria-label="Pupil report queue">
          <div className="report-review-queue-title">
            <strong>{loading ? "Loading reports…" : `${filteredReports.length} report${filteredReports.length === 1 ? "" : "s"}`}</strong>
            <span>Newest first</span>
          </div>
          {!loading && !filteredReports.length ? (
            <div className="report-review-empty">
              <strong>No matching reports</strong>
              <p>New register reports will appear here as soon as staff submit them.</p>
            </div>
          ) : filteredReports.map((report) => (
            <button
              className={`report-review-row ${report.id === selectedReport?.id ? "active" : ""} ${report.sensitivity === "safeguarding_restricted" ? "restricted" : ""}`}
              type="button"
              key={report.id}
              onClick={() => setSelectedId(report.id)}
            >
              <span className={`report-type-badge report-${report.type}`}>{registerReportTypeLabels[report.type] || report.type}</span>
              <strong>{report.childName || "Child record"}</strong>
              <span>{report.siteName || "School not recorded"} · {report.sessionLabel || report.programmeName || "Session not recorded"}</span>
              <small>{registerReportDateTime(report.occurredAt || report.createdAt)}</small>
              <em>{registerReportStatusLabel(report.status)}</em>
            </button>
          ))}
        </section>

        <section className="report-review-detail" aria-label="Selected pupil report">
          {!selectedReport ? (
            <div className="report-review-empty">
              <strong>Select a report</strong>
              <p>The report details and review controls will appear here.</p>
            </div>
          ) : (
            <>
              <header>
                <div>
                  <span className={`report-type-badge report-${selectedReport.type}`}>
                    {registerReportTypeLabels[selectedReport.type] || selectedReport.type}
                  </span>
                  {selectedReport.sensitivity === "safeguarding_restricted" ? <span className="restricted-access-badge">Restricted · DSL access</span> : null}
                  <h3>{selectedReport.childName || "Child report"}</h3>
                  <p>{selectedReport.siteName || "School not recorded"} · {selectedReport.programmeName || "Programme not recorded"} · {selectedReport.sessionLabel || "Session not recorded"}</p>
                </div>
                <span className="report-status-pill">{registerReportStatusLabel(selectedReport.status)}</span>
              </header>

              <div className="report-review-summary">
                <span>What was recorded</span>
                <p>{selectedReport.summary || "No summary was provided."}</p>
              </div>

              <dl className="report-review-facts">
                <div><dt>Occurred</dt><dd>{registerReportDateTime(selectedReport.occurredAt || selectedReport.createdAt)}</dd></div>
                <div><dt>Recorded by</dt><dd>{selectedReport.reporterName || "Staff member"}</dd></div>
                {detailRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>

              <div className="report-review-controls">
                <h4>Review and follow-up</h4>
                <label>
                  Status
                  <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
                    {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  Follow-up note
                  <textarea
                    rows="5"
                    value={followUpNote}
                    onChange={(event) => setFollowUpNote(event.target.value)}
                    placeholder={selectedReport.sensitivity === "safeguarding_restricted"
                      ? "Record the DSL action or next secure step."
                      : "Record action taken, parent follow-up or the reason for closing."}
                  />
                </label>
                <div className="report-review-save">
                  <button className="button primary" type="button" onClick={saveReview} disabled={saving}>
                    {saving ? "Saving…" : "Save review"}
                  </button>
                  {saveMessage ? <span role="status">{saveMessage}</span> : null}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CRM({ data }) {
  const [updates, setUpdates] = useState(() => readCrmUpdates());
  const [fallbackOutreach, setFallbackOutreach] = useState([]);
  const [typeFilter, setTypeFilter] = useState("Website enquiries");
  const [query, setQuery] = useState("");
  const [rowLimit, setRowLimit] = useState("25");
  const [sort, setSort] = useState({ key: "created", direction: "desc" });
  const [selectedId, setSelectedId] = useState("");
  const [selectedRows, setSelectedRows] = useState([]);

  useEffect(() => {
    if (data.outreach?.length) return undefined;
    let active = true;
    import("./outreachProspects.js").then(({ outreachProspects }) => {
      if (active) setFallbackOutreach(outreachProspects);
    });
    return () => {
      active = false;
    };
  }, [data.outreach]);

  const outreachSource = data.outreach?.length ? data.outreach : fallbackOutreach;
  const outreach = outreachSource.map((record) => ({ ...record, ...updates[record.id] }));
  const enquiryRecords = mergeCrmRecords(data.enquiries, updates);
  const records = [...enquiryRecords, ...outreach];
  const websiteEnquiries = enquiryRecords.filter(isWebsiteEnquiryRecord);
  const newWebsiteEnquiries = websiteEnquiries.filter((record) => ["New", "Reviewing", "Follow up"].includes(record.status || "New"));
  const recentWebsiteEnquiries = [...websiteEnquiries]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 3);
  const queryText = query.trim().toLowerCase();
  const visibleRecords = records.filter((record) => {
    const isWebsite = isWebsiteEnquiryRecord(record);
    const matchesType = typeFilter === "All"
      || (typeFilter === "Website enquiries" && isWebsite)
      || (typeFilter === "Outreach" && record.type === "Outreach")
      || record.type === typeFilter
      || record.stage === typeFilter
      || record.status === typeFilter;
    if (!matchesType) return false;
    if (!queryText) return true;
    return [
      record.name,
      record.type,
      record.stage,
      record.status,
      record.area,
      record.location,
      record.contactType,
      record.contactEmail,
      record.organisation,
      record.subject,
      record.message,
      record.note,
      record.nextAction,
      record.createdAt,
      record.owner,
    ].filter(Boolean).join(" ").toLowerCase().includes(queryText);
  });
  const sortedRecords = sortCrmRecords(visibleRecords, sort);
  const rowsToShow = rowLimit === "All" ? sortedRecords : sortedRecords.slice(0, Number(rowLimit));
  const selectedRecord = records.find((record) => record.id === selectedId) || null;
  const visibleRowIds = rowsToShow.map((record) => record.id);
  const selectedVisibleCount = selectedRows.filter((id) => visibleRowIds.includes(id)).length;
  const allVisibleSelected = Boolean(visibleRowIds.length) && visibleRowIds.every((id) => selectedRows.includes(id));
  const outreachCount = outreach.length;
  const partnerCount = outreach.filter((record) => (record.status || record.stage) === "Partner school").length;
  const followUpCount = outreach.filter((record) => record.followUpDate || ["Follow up", "Responded", "Meeting", "Proposal"].includes(record.status)).length;

function updateRecord(id, patch) {
    const existing = records.find((record) => record.id === id) || {};
    const nextPatch = {
      status: existing.status || "New",
      owner: existing.owner || "Unassigned",
      note: existing.note || "",
      nextAction: existing.nextAction || "call/email follow-up",
      ...patch,
    };

    setUpdates((current) => {
      const next = {
        ...current,
        [id]: {
          ...current[id],
          ...nextPatch,
          syncState: isSupabaseCrmRecord(id, existing) ? "saving" : "local",
          updatedAt: new Date().toISOString(),
        },
      };
      saveCrmUpdates(next);
      return next;
    });

    addAuditLog("CRM updated", `${existing.name || existing.school || id}: ${Object.keys(patch).join(", ")}${existing.contactEmail || existing.email ? ` · ${existing.contactEmail || existing.email}` : ""}${existing.type || existing.status ? ` · ${existing.type || existing.status}` : ""}`);
    if (!isSupabaseCrmRecord(id, existing)) return;

    loadSupabaseModule()
      .then(({ updateCrmEnquiry }) => updateCrmEnquiry(id, nextPatch))
      .then(() => {
        setUpdates((current) => {
          const next = {
            ...current,
            [id]: {
              ...current[id],
              syncState: "saved",
              syncError: "",
              updatedAt: new Date().toISOString(),
            },
          };
          saveCrmUpdates(next);
          return next;
        });
      })
      .catch((error) => {
        setUpdates((current) => {
          const next = {
            ...current,
            [id]: {
              ...current[id],
              syncState: "error",
              syncError: error.message || "Unable to save to Supabase.",
              updatedAt: new Date().toISOString(),
            },
          };
          saveCrmUpdates(next);
          return next;
        });
      });
  }
  function changeSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }
  function toggleRow(id) {
    setSelectedRows((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function toggleVisibleRows() {
    setSelectedRows((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleRowIds.includes(id));
      return Array.from(new Set([...current, ...visibleRowIds]));
    });
  }
  function bulkUpdate(patch) {
    const ids = selectedRows.filter((id) => records.some((record) => record.id === id));
    if (!ids.length) return;
    setUpdates((current) => {
      const next = { ...current };
      ids.forEach((id) => {
        const existing = records.find((record) => record.id === id) || {};
        next[id] = {
          ...current[id],
          status: existing.status || "New",
          owner: existing.owner || "Unassigned",
          note: existing.note || "",
          nextAction: existing.nextAction || "call/email follow-up",
          ...patch,
          syncState: isSupabaseCrmRecord(id, existing) ? "saving" : "local",
          updatedAt: new Date().toISOString(),
        };
      });
      saveCrmUpdates(next);
      return next;
    });
    addAuditLog("CRM bulk update", `${ids.length} rows: ${Object.keys(patch).join(", ")}${patch.status ? ` · status ${patch.status}` : ""}${patch.owner ? ` · owner ${patch.owner}` : ""}`);
  }

  return (
    <div className="crm-workspace">
      <div className="toolbar">
        <div>
          <h2>Enquiries CRM</h2>
          <p className="panel-note">Website contact responses are shown first. Outreach is still available as a separate filter when you need it.</p>
        </div>
        <div className="crm-toolbar-controls">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contact responses, school, email..." /></label>
          <label>Filter<select aria-label="Filter enquiries" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {["Website enquiries", "All", "Parent", "School", "Staff", "Outreach", "Prospect", "Contacted", "Follow up", "Partner school", "Closed"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
          <label>Rows<select aria-label="Rows per page" value={rowLimit} onChange={(event) => setRowLimit(event.target.value)}>
            {["25", "50", "100", "All"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
        </div>
      </div>
      <div className="crm-summary">
        <Metric icon={<Mail />} label="Website responses" value={websiteEnquiries.length} tone={websiteEnquiries.length ? "amber" : "green"} />
        <Metric icon={<Bell />} label="New responses" value={newWebsiteEnquiries.length} tone={newWebsiteEnquiries.length ? "amber" : "green"} />
        <Metric icon={<Users />} label="Outreach prospects" value={outreachCount} tone="blue" />
        <Metric icon={<CalendarDays />} label="Follow-ups" value={followUpCount} tone="amber" />
        <Metric icon={<ShieldCheck />} label="Partner schools" value={partnerCount} tone="green" />
      </div>
      {recentWebsiteEnquiries.length > 0 && (
        <section className="crm-enquiry-strip" aria-label="Recent website contact responses">
          <div>
            <p className="eyebrow">Website contact responses</p>
            <h3>Latest messages from the public site</h3>
          </div>
          <div className="crm-enquiry-strip-grid">
            {recentWebsiteEnquiries.map((record) => (
              <button key={record.id} type="button" onClick={() => setSelectedId(record.id)}>
                <span>{record.type || "Enquiry"}</span>
                <strong>{record.name || "Unnamed contact"}</strong>
                <small>{record.email || "No email"}{record.createdAt ? ` · ${formatShortDate(record.createdAt)}` : ""}</small>
                <p>{record.subject || record.message || "No message preview"}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="panel-note">Showing {rowsToShow.length} of {visibleRecords.length} matching records.</p>
      <CrmBulkActions
        selectedCount={selectedRows.length}
        visibleCount={selectedVisibleCount}
        allVisibleSelected={allVisibleSelected}
        onSelectVisible={toggleVisibleRows}
        onClear={() => setSelectedRows([])}
        onBulkUpdate={bulkUpdate}
      />
      <TableWrap>
        <table className="crm-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleRows} aria-label="Select visible CRM rows" /></th>
              <th><button type="button" onClick={() => changeSort("name")}>Lead {sort.key === "name" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th><button type="button" onClick={() => changeSort("contact")}>Contact {sort.key === "contact" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th><button type="button" onClick={() => changeSort("created")}>Received {sort.key === "created" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th><button type="button" onClick={() => changeSort("status")}>Status {sort.key === "status" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th><button type="button" onClick={() => changeSort("owner")}>Owner {sort.key === "owner" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th><button type="button" onClick={() => changeSort("followUp")}>Follow-up {sort.key === "followUp" ? (sort.direction === "asc" ? "↑" : "↓") : ""}</button></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((record) => {
              const isOutreach = record.type === "Outreach";
              return (
                <tr key={record.id} className={selectedRecord?.id === record.id ? "selected" : ""}>
                  <td><input type="checkbox" checked={selectedRows.includes(record.id)} onChange={() => toggleRow(record.id)} aria-label={`Select ${record.name}`} /></td>
                  <td>
                    <strong>{record.name}</strong>
                    <small>{record.type}{record.stage ? ` · ${record.stage}` : ""}</small>
                    <small>{isOutreach ? [record.area, record.location, record.contactType].filter(Boolean).join(" · ") : record.organisation || "No organisation"}</small>
                  </td>
                  <td>
                    <span>{record.contactEmail || record.email || "No email"}</span>
                    <small>{record.subject || record.message || "No summary"}</small>
                    <small className={`crm-sync ${record.syncState || "local"}`}>{crmSyncText(record)}</small>
                  </td>
                  <td>
                    <strong>{record.createdAt ? formatShortDate(record.createdAt) : "Not recorded"}</strong>
                    <small>{record.createdAt ? new Date(record.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</small>
                  </td>
                  <td><select value={record.status || "New"} onChange={(event) => updateRecord(record.id, { status: event.target.value })}>{crmStatuses.map((item) => <option key={item}>{item}</option>)}</select></td>
                  <td><select value={record.owner || "Unassigned"} onChange={(event) => updateRecord(record.id, { owner: event.target.value })}>{crmOwners.map((item) => <option key={item}>{item}</option>)}</select></td>
                  <td>
                    <input type="date" value={record.followUpDate || ""} onChange={(event) => updateRecord(record.id, { followUpDate: event.target.value })} aria-label={`${record.name} follow-up date`} />
                    {isOutreach && <small>{record.dateContacted ? `Contacted ${record.dateContacted}` : "Not contacted"}</small>}
                  </td>
                  <td><button className="button light" type="button" onClick={() => setSelectedId(record.id)}>Details</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      {selectedRecord && <CrmDetailDrawer record={selectedRecord} onChange={updateRecord} />}
      {!visibleRecords.length && <EmptyList title="No matching enquiries" text="Change the filter or wait for new website enquiries." />}
    </div>
  );
}

function sortCrmRecords(records, sort) {
  const valueFor = (record) => {
    if (sort.key === "contact") return record.contactEmail || record.email || record.contactName || "";
    if (sort.key === "status") return record.status || record.stage || "New";
    if (sort.key === "owner") return record.owner || "Unassigned";
    if (sort.key === "followUp") return record.followUpDate || "9999-12-31";
    if (sort.key === "created") return record.createdAt || (record.type === "Outreach" ? "0000-00-00" : "");
    return record.name || "";
  };
  return [...records].sort((a, b) => {
    const left = String(valueFor(a)).toLowerCase();
    const right = String(valueFor(b)).toLowerCase();
    const result = left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function CrmBulkActions({ selectedCount, visibleCount, allVisibleSelected, onSelectVisible, onClear, onBulkUpdate }) {
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [dateContacted, setDateContacted] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  function applyBulk() {
    const patch = {};
    if (status) patch.status = status;
    if (owner) patch.owner = owner;
    if (dateContacted) patch.dateContacted = dateContacted;
    if (followUpDate) patch.followUpDate = followUpDate;
    if (!Object.keys(patch).length) return;
    onBulkUpdate(patch);
  }
  return (
    <section className="crm-bulk-bar">
      <div>
        <strong>{selectedCount} selected</strong>
        <span>{visibleCount} selected on this page</span>
      </div>
      <button className="button light" type="button" onClick={onSelectVisible}>{allVisibleSelected ? "Unselect visible" : "Select visible"}</button>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">No change</option>{crmStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Owner<select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">No change</option>{crmOwners.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Contacted<input type="date" value={dateContacted} onChange={(event) => setDateContacted(event.target.value)} /></label>
      <label>Follow-up<input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
      <button className="button book" type="button" disabled={!selectedCount} onClick={applyBulk}>Apply</button>
      <button className="button light" type="button" disabled={!selectedCount} onClick={onClear}>Clear</button>
    </section>
  );
}

function CrmDetailDrawer({ record, onChange }) {
  const isOutreach = record.type === "Outreach";
  return (
    <section className="crm-detail-drawer" aria-label="CRM lead details">
      <div className="crm-detail-heading">
        <div>
          <p className="eyebrow">Selected lead</p>
          <h3>{record.name}</h3>
          <p>{isOutreach ? [record.area, record.location, record.contactType].filter(Boolean).join(" · ") : record.organisation || "No organisation"}</p>
        </div>
        <Badge value={record.status || "New"} />
      </div>
      <div className="crm-detail-grid">
        <label>Status<select value={record.status || "New"} onChange={(event) => onChange(record.id, { status: event.target.value })}>{crmStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Owner<select value={record.owner || "Unassigned"} onChange={(event) => onChange(record.id, { owner: event.target.value })}>{crmOwners.map((item) => <option key={item}>{item}</option>)}</select></label>
        {isOutreach && <label>Date contacted<input type="date" value={record.dateContacted || ""} onChange={(event) => onChange(record.id, { dateContacted: event.target.value })} /></label>}
        <label>Follow-up date<input type="date" value={record.followUpDate || ""} onChange={(event) => onChange(record.id, { followUpDate: event.target.value })} /></label>
        <label className="full">Contact<input value={record.contactEmail || record.email || ""} onChange={(event) => onChange(record.id, { contactEmail: event.target.value })} placeholder="Email address" /></label>
        <label className="full">Next action<input value={record.nextAction || ""} onChange={(event) => onChange(record.id, { nextAction: event.target.value })} placeholder="Call, email, prepare proposal..." /></label>
        <label className="full">Notes<textarea rows="4" value={record.note || ""} onChange={(event) => onChange(record.id, { note: event.target.value })} placeholder="Call notes, context, objections or next steps." /></label>
      </div>
      <p className={`crm-sync ${record.syncState || "local"}`}>{crmSyncText(record)}</p>
    </section>
  );
}

function AuditLog({ data = {} }) {
  const [items, setItems] = useState(() => readAuditLog());
  const remoteItems = data.auditLog || [];
  const combinedItems = [
    ...remoteItems,
    ...items.filter((item) => !remoteItems.some((remote) => remote.action === item.action && remote.detail === item.detail && remote.createdAt === item.createdAt)),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const [filter, setFilter] = useState("All");
  const [quickFilter, setQuickFilter] = useState("All activity");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("All time");
  const [selectedAuditId, setSelectedAuditId] = useState("");
  function auditModule(item) {
    if (item.metadata?.module) return item.metadata.module;
    const action = String(item.action || "").toLowerCase();
    if (action.includes("pay") || action.includes("payslip") || action.includes("hours")) return "Payroll";
    if (action.includes("scr") || action.includes("evidence")) return "SCR";
    if (action.includes("hr") || action.includes("former staff") || action.includes("staff photo") || action.includes("profile notes")) return "HR";
    if (action.includes("user") || action.includes("password") || action.includes("account") || action.includes("invite")) return "Users";
    if (action.includes("rota") || action.includes("cover")) return "Rota";
    if (action.includes("crm") || action.includes("enquiry")) return "CRM";
    if (action.includes("ofsted")) return "Ofsted";
    if (action.includes("document") || action.includes("policy")) return "Documents";
    if (action.includes("settings") || action.includes("public")) return "Settings";
    return "General";
  }
  function auditMetadataTags(item) {
    const metadata = item.metadata || {};
    return [
      metadata.staffName && `Staff: ${metadata.staffName}`,
      metadata.email,
      metadata.site && `Site: ${metadata.site}`,
      metadata.documentName && `Document: ${metadata.documentName}`,
      metadata.payrollPeriod && `Period: ${metadata.payrollPeriod}`,
      metadata.crmRecord && `CRM: ${metadata.crmRecord}`,
      item.actor && `Actor: ${item.actor}`,
      item.tableName && `Table: ${item.tableName}`,
    ].filter(Boolean).slice(0, 5);
  }
  function inDateRange(item) {
    if (range === "All time") return true;
    const created = new Date(item.createdAt || 0).getTime();
    if (!created) return false;
    const now = Date.now();
    const days = range === "Today" ? 1 : range === "7 days" ? 7 : 30;
    return now - created <= days * 24 * 60 * 60 * 1000;
  }
  const enrichedItems = combinedItems.map((item) => ({ ...item, module: auditModule(item) }));
  const quickFilters = [
    {
      label: "All activity",
      description: "Everything",
      match: () => true,
    },
    {
      label: "Staff",
      description: "People changes",
      match: (item, haystack) => item.module === "HR" || item.module === "Users" || haystack.includes("staff") || haystack.includes("profile") || haystack.includes("former staff"),
    },
    {
      label: "Payroll",
      description: "Pay and payslips",
      match: (item, haystack) => item.module === "Payroll" || haystack.includes("payroll") || haystack.includes("payslip") || haystack.includes("hours"),
    },
    {
      label: "SCR",
      description: "Compliance evidence",
      match: (item, haystack) => item.module === "SCR" || haystack.includes("scr") || haystack.includes("evidence") || haystack.includes("safeguarding"),
    },
    {
      label: "Settings changes",
      description: "Public and platform switches",
      match: (item, haystack) => item.module === "Settings" || haystack.includes("setting") || haystack.includes("public settings") || haystack.includes("announcement"),
    },
    {
      label: "Exports",
      description: "Downloaded evidence",
      match: (item, haystack) => haystack.includes("export") || haystack.includes(".csv") || haystack.includes(".pdf"),
    },
  ];
  const selectedQuickFilter = quickFilters.find((item) => item.label === quickFilter) || quickFilters[0];
  const modules = ["All", ...Array.from(new Set(enrichedItems.map((item) => item.module))).sort()];
  const filteredItems = enrichedItems.filter((item) => {
    const haystack = `${item.action || ""} ${item.detail || ""} ${item.source || ""} ${item.module || ""} ${item.actor || ""} ${item.tableName || ""} ${JSON.stringify(item.metadata || {})}`.toLowerCase();
    if (!selectedQuickFilter.match(item, haystack)) return false;
    if (filter !== "All" && item.module !== filter) return false;
    if (query && !haystack.includes(query.toLowerCase())) return false;
    return inDateRange(item);
  });
  const selectedAudit = filteredItems.find((item) => item.id === selectedAuditId) || filteredItems[0] || null;
  const selectedAuditRows = selectedAudit ? [
    ["Action", selectedAudit.action],
    ["Module", selectedAudit.module],
    ["Detail", selectedAudit.detail || "No extra detail recorded."],
    ["Actor", selectedAudit.actor || "Not recorded"],
    ["Source", selectedAudit.source || "Local"],
    ["Created", selectedAudit.createdAt ? new Date(selectedAudit.createdAt).toLocaleString("en-GB") : "Not recorded"],
    ["Table", selectedAudit.tableName || selectedAudit.metadata?.tableName || "Not recorded"],
    ["Record ID", selectedAudit.recordId || "Not recorded"],
  ] : [];
  function safeAuditFilePart(value) {
    return String(value || "audit").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "audit";
  }
  function exportAuditLog() {
    const filename = `apres-audit-${safeAuditFilePart(filter)}-${safeAuditFilePart(range)}.csv`;
    const rows = [
      ["Created", "Action", "Module", "Detail", "Actor", "Source", "Staff", "Email", "Site", "Document", "Payroll period", "CRM record", "Table", "Record ID", "Metadata"],
      ...filteredItems.map((item) => {
        const metadata = item.metadata || {};
        return [
          item.createdAt || "",
          item.action || "",
          item.module || "",
          item.detail || "",
          item.actor || "",
          item.source || "",
          metadata.staffName || "",
          metadata.email || "",
          metadata.site || "",
          metadata.documentName || "",
          metadata.payrollPeriod || "",
          metadata.crmRecord || "",
          item.tableName || metadata.tableName || "",
          item.recordId || "",
          JSON.stringify(metadata),
        ];
      }),
    ];
    downloadCsv(filename, rows);
    addAuditLog("Audit log exported", `${filteredItems.length} rows · ${filter} · ${range} · ${filename}`);
    setItems(readAuditLog());
  }
  const recentCount = enrichedItems.filter((item) => inDateRange({ ...item, createdAt: item.createdAt }) && (range === "All time" ? true : true)).length;
  const exportHistory = enrichedItems
    .filter((item) => String(item.action || "").toLowerCase() === "audit log exported")
    .slice(0, 5);
  const moduleCounts = modules.filter((module) => module !== "All").map((module) => ({
    module,
    count: enrichedItems.filter((item) => item.module === module).length,
  })).sort((a, b) => b.count - a.count).slice(0, 4);
  function clearAudit() {
    localStorage.removeItem(auditStorageKey);
    setItems([]);
  }
  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Audit Log</h2>
          <p className="panel-note">Trace admin actions across staff, SCR, HR, payroll, rota, documents and settings.</p>
        </div>
        <div>
          <button className="button book" type="button" disabled={!filteredItems.length} onClick={exportAuditLog}>Export CSV</button>
          <button className="button light" type="button" onClick={clearAudit}>Clear Local Log</button>
        </div>
      </div>
      <section className="audit-command-grid">
        <article className="audit-command-card primary">
          <p className="eyebrow">Audit source</p>
          <h3>{combinedItems.length} actions recorded</h3>
          <p>{remoteItems.length ? `${remoteItems.length} rows are loaded from Supabase, with local browser entries shown as fallback context.` : "Current actions are retained in browser storage until Supabase audit rows are available."}</p>
          <Badge value={remoteItems.length ? "Supabase + local" : "Local audit"} />
        </article>
        <article className="audit-command-card">
          <span>Total visible</span>
          <strong>{filteredItems.length}</strong>
          <p>{range === "All time" ? "Across the full retained log." : `Within ${range.toLowerCase()}.`}</p>
        </article>
        <article className="audit-command-card">
          <span>Active modules</span>
          <strong>{modules.length - 1}</strong>
          <p>{moduleCounts.map((item) => `${item.module} ${item.count}`).join(" · ") || "No modules yet."}</p>
        </article>
        <article className="audit-command-card">
          <span>Recent activity</span>
          <strong>{recentCount}</strong>
          <p>Use filters below to trace a staff member, module or action.</p>
        </article>
      </section>
      <section className="audit-export-history">
        <div>
          <p className="eyebrow">Export history</p>
          <h3>Recent CSV downloads</h3>
          <p>Each export is recorded so audit evidence downloads remain visible to admins.</p>
        </div>
        <div className="audit-export-list">
          {exportHistory.map((item) => (
            <article key={item.id}>
              <strong>{item.detail || "Audit CSV exported"}</strong>
              <span>{item.createdAt ? new Date(item.createdAt).toLocaleString("en-GB") : "Date not recorded"} · {item.source || "Local"}</span>
            </article>
          ))}
          {!exportHistory.length && <p>No audit exports have been recorded yet.</p>}
        </div>
      </section>
      <section className="audit-quick-filters" aria-label="Audit quick filters">
        {quickFilters.map((item) => {
          const count = enrichedItems.filter((auditItem) => {
            const haystack = `${auditItem.action || ""} ${auditItem.detail || ""} ${auditItem.source || ""} ${auditItem.module || ""} ${auditItem.actor || ""} ${auditItem.tableName || ""} ${JSON.stringify(auditItem.metadata || {})}`.toLowerCase();
            return item.match(auditItem, haystack);
          }).length;
          return (
            <button className={quickFilter === item.label ? "active" : ""} type="button" key={item.label} onClick={() => setQuickFilter(item.label)}>
              <span>{item.label}</span>
              <small>{item.description}</small>
              <strong>{count}</strong>
            </button>
          );
        })}
      </section>
      <section className="audit-filters">
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, person, school or detail" /></label>
        <label>Module<select aria-label="Filter audit log" value={filter} onChange={(event) => setFilter(event.target.value)}>
          {modules.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label>Date range<select value={range} onChange={(event) => setRange(event.target.value)}>
          {["All time", "Today", "7 days", "30 days"].map((item) => <option key={item}>{item}</option>)}
        </select></label>
      </section>
      <div className="audit-workbench">
        <div className="audit-list">
          {filteredItems.map((item) => (
            <button className={`audit-item ${selectedAudit?.id === item.id ? "selected" : ""}`} type="button" key={item.id} onClick={() => setSelectedAuditId(item.id)}>
              <div className="audit-module-mark">{item.module.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{item.action}</strong>
                <span>{item.detail || "No extra detail recorded."}</span>
                <small>{new Date(item.createdAt).toLocaleString("en-GB")} · {item.source || "Local"}</small>
                {!!auditMetadataTags(item).length && (
                  <div className="audit-metadata-tags">
                    {auditMetadataTags(item).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
              </div>
              <Badge value={item.module} />
            </button>
          ))}
          {!filteredItems.length && <EmptyList title="No audit entries yet" text="User, CRM, rota, cover, HR and hours changes will appear here." />}
        </div>
        {selectedAudit && (
          <aside className="audit-detail-panel">
            <div className="audit-detail-head">
              <div>
                <p className="eyebrow">Audit detail</p>
                <h3>{selectedAudit.action}</h3>
              </div>
              <Badge value={selectedAudit.module} />
            </div>
            <div className="audit-detail-grid">
              {selectedAuditRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {!!auditMetadataTags(selectedAudit).length && (
              <div className="audit-detail-tags">
                <span>Matched context</span>
                <div className="audit-metadata-tags">
                  {auditMetadataTags(selectedAudit).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
              </div>
            )}
            <details className="audit-raw-metadata">
              <summary>Raw metadata</summary>
              <pre>{JSON.stringify(selectedAudit.metadata || {}, null, 2)}</pre>
            </details>
          </aside>
        )}
      </div>
    </div>
  );
}

function Settings() {
  const [settings, setSettings] = useState(() => readPublicSettings());
  const [settingsStatus, setSettingsStatus] = useState(hasSupabaseConfig ? "Loading live settings..." : "Local preview only. Supabase is not configured in this environment.");
  const documentLinks = readJson(documentLinksStorageKey, {});
  const auditItems = readAuditLog();
  const hrFileCount = auditItems.filter((item) => String(item.action || "").toLowerCase().includes("hr file")).length;
  const linkedPolicyCount = Object.keys(documentLinks).length;
  const settingsHealth = settingsStatus.toLowerCase().includes("saved live") || settingsStatus.toLowerCase().includes("loaded from supabase")
    ? "Live"
    : settingsStatus.toLowerCase().includes("saving")
      ? "Saving"
      : "Check";
  const controlCards = [
    ["Public site", settings.campAnnouncementEnabled ? "Announcement on" : "Announcement off", settings.campAnnouncementEnabled ? "Homepage pop-out is active." : "Homepage pop-out is hidden.", settings.campAnnouncementEnabled ? "Live" : "Off"],
    ["Data source", hasSupabaseConfig ? "Supabase connected" : "Local preview", hasSupabaseConfig ? "Settings can be saved for everyone." : "Changes only affect this browser.", hasSupabaseConfig ? "Connected" : "Local"],
    ["Policies", `${linkedPolicyCount} linked`, "Google Docs currently saved in the policy library.", `${linkedPolicyCount} links`],
    ["Audit", `${auditItems.length} local entries`, "Recent admin actions retained in this browser.", "Local audit"],
  ];
  const launchItems = [
    ["Public site live", "Domain, homepage and booking routes are published."],
    ["Staff login live", "Manual temporary passwords work while email setup is completed."],
    ["SCR data visible", "Admins can review staff compliance and evidence requests."],
    ["CRM usable", "School outreach and enquiries are available as rows with search and filters."],
  ];
  const resendItems = [
    ["Create Resend account", "Use an Après School-owned login."],
    ["Add apres-school.co.uk", "Verify the sending domain inside Resend."],
    ["Add DNS records", "Copy the DKIM/SPF records Resend provides into Squarespace DNS."],
    ["Retest staff invite", "Send one reset to Kelly, then move the platform out of manual invite mode."],
  ];

  useEffect(() => {
    let mounted = true;
    if (!hasSupabaseConfig) return undefined;
    loadSupabaseModule()
      .then(({ fetchPublicSettings }) => fetchPublicSettings())
      .then((remoteSettings) => {
        if (!mounted) return;
        const next = { ...readPublicSettings(), ...remoteSettings };
        setSettings(next);
        localStorage.setItem(publicSettingsStorageKey, JSON.stringify(next));
        setSettingsStatus("Live settings loaded from Supabase.");
      })
      .catch((error) => {
        if (!mounted) return;
        setSettingsStatus(`${error.message || "Unable to load live settings."} Run the platform settings SQL migration if this has not been added yet.`);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function updateSetting(patch) {
    const next = { ...settings, ...patch, updatedAt: new Date().toISOString() };
    setSettings(next);
    localStorage.setItem(publicSettingsStorageKey, JSON.stringify(next));
    addAuditLog("Public settings updated", `Camp announcement ${next.campAnnouncementEnabled ? "enabled" : "disabled"}`);
    if (!hasSupabaseConfig) {
      setSettingsStatus("Saved locally for this browser. Supabase is not configured in this environment.");
      return;
    }
    setSettingsStatus("Saving live setting...");
    try {
      const { updatePublicSettings } = await loadSupabaseModule();
      const saved = await updatePublicSettings(next);
      const savedSettings = { ...next, ...saved };
      setSettings(savedSettings);
      localStorage.setItem(publicSettingsStorageKey, JSON.stringify(savedSettings));
      setSettingsStatus(`Saved live. Camp announcement is now ${savedSettings.campAnnouncementEnabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setSettingsStatus(`${error.message || "Unable to save live setting."} Local browser setting was updated, but the public site may not change until Supabase settings are available.`);
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Settings</h2>
          <p className="panel-note">Control public-site features, platform setup and operational health from one place.</p>
        </div>
      </div>
      <section className="settings-control-centre">
        <article className="settings-hero">
          <div>
            <p className="eyebrow">Control centre</p>
            <h3>Live switches should be obvious, reversible and hard to miss.</h3>
            <p>{settingsStatus}</p>
          </div>
          <Badge value={settingsHealth} />
        </article>
        <div className="settings-status-grid">
          {controlCards.map(([label, value, text, badge]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <p>{text}</p>
              <Badge value={badge} />
            </article>
          ))}
        </div>
        <section className="settings-section-grid">
          <article className="setting-card setting-card-feature">
            <div>
              <p className="eyebrow">Public website</p>
              <h3>Camp announcement pop-out</h3>
              <p>Advertises {nextCamp.title} on the homepage with dates, sites, daily themes and a booking link. Turning this off hides the pop-out on the public homepage once the live setting is saved.</p>
            </div>
            <div className="settings-feature-row">
              <label className="toggle-row">
                <input aria-label="Camp announcement pop-out" type="checkbox" checked={settings.campAnnouncementEnabled} onChange={(event) => updateSetting({ campAnnouncementEnabled: event.target.checked })} />
                <span>{settings.campAnnouncementEnabled ? "Enabled" : "Disabled"}</span>
              </label>
              <Badge value={settings.campAnnouncementEnabled ? "Live on homepage" : "Hidden"} />
            </div>
          </article>
          <article className="setting-card">
            <div>
              <p className="eyebrow">Current campaign</p>
              <h3>{nextCamp.title}</h3>
              <p>{nextCamp.dates} · {nextCamp.sites.join(", ")}</p>
            </div>
            <Badge value={settings.campAnnouncementEnabled ? "Promoted" : "Not promoted"} />
          </article>
          <article className="setting-card">
            <div>
              <p className="eyebrow">Document library</p>
              <h3>Google policy links</h3>
              <p>{linkedPolicyCount} policy links are saved in this browser. Open Documents to add or update live Google Doc links and staff acknowledgements.</p>
            </div>
            <Badge value={`${linkedPolicyCount} linked`} />
          </article>
          <article className="setting-card">
            <div>
              <p className="eyebrow">HR files</p>
              <h3>Private storage</h3>
              <p>HR uploads use the private Supabase Storage bucket and signed file links in the admin platform.</p>
            </div>
            <Badge value="Supabase Storage" />
          </article>
          <article className="setting-card">
            <div>
              <p className="eyebrow">Audit</p>
              <h3>Recent admin changes</h3>
              <p>{hrFileCount} HR file actions have been logged locally. Production audit rows can be moved server-side as the platform matures.</p>
            </div>
            <Badge value="Local audit" />
          </article>
        </section>
        <section className="setting-card setting-card-wide">
          <div>
            <p className="eyebrow">Operational readiness</p>
            <h3>V1 checks for the live platform</h3>
            <p>A short operational checklist for the current rollout phase.</p>
          </div>
          <div className="settings-checklist">
            {launchItems.map(([title, text]) => (
              <span key={title}><CheckCircle2 size={18} /><strong>{title}</strong><small>{text}</small></span>
            ))}
          </div>
        </section>
        <section className="setting-card setting-card-wide">
          <div>
            <p className="eyebrow">Email setup</p>
            <h3>Resend setup for staff invites</h3>
            <p>Until this is complete, use the Users page to create accounts and hand temporary passwords to staff manually.</p>
          </div>
          <div className="settings-checklist pending">
            {resendItems.map(([title, text]) => (
              <span key={title}><Clock size={18} /><strong>{title}</strong><small>{text}</small></span>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

function StaffTable({ compact, data = mockPlatformData, targetStaffId, onTargetHandled, evidenceRequests = {}, onRequestEvidence, onClearEvidenceRequest, onMarkEvidenceChecked, access, onUpdateStaffPay, onOpenHrFiles, onOpenPay, siteScopeLabel = "" }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Action needed");
  const [siteFilter, setSiteFilter] = useState("All");
  const [priorityView, setPriorityView] = useState(false);
  const [selectedId, setSelectedId] = useState(data.staff[0]?.id || "");
  const isSiteScoped = Boolean(siteScopeLabel);
  const hierarchy = readHierarchyState();
  const staffUsers = data.staff.map((person, index) => ({
    id: person.profileId || person.id,
    name: person.name,
    role: person.role?.toLowerCase().includes("manager") ? "Manager" : "Staff",
    order: index,
  }));
  const siteOptions = Array.from(new Set(data.staff.flatMap((person) => staffSchoolNames(person)).filter(Boolean))).sort();
  function managerName(person) {
    const staffUser = staffUsers.find((item) => item.id === (person.profileId || person.id));
    const reportsTo = hierarchy[staffUser?.id]?.reportsTo ?? defaultReportsTo(staffUser, staffUsers);
    return staffUsers.find((item) => item.id === reportsTo)?.name || "Unassigned";
  }
  function checkStatus(person) {
    if (isFormerStaffRecord(person)) return "Archived";
    const status = String(person.compliance || "").toLowerCase();
    if (status.includes("compliant")) return "Compliant";
    if (status.includes("expiring")) return "Expiring soon";
    if (status.includes("rejected")) return "Rejected";
    if (status.includes("missing")) return "Missing";
    return "Review needed";
  }
  function actionText(person) {
    if (isFormerStaffRecord(person)) return "Retained record";
    const missing = actionItems(person);
    if (!missing.length) return checkStatus(person) === "Compliant" ? "No action" : "Check evidence";
    return `Check ${missing.slice(0, 2).join(" / ")}${missing.length > 2 ? ` +${missing.length - 2}` : ""}`;
  }
  function actionItems(person) {
    if (isFormerStaffRecord(person)) return [];
    return [
      !hasValidDate(person.dbsRenewal) && "DBS",
      !hasValidDate(person.safeguardingExpiry) && "Safeguarding",
      !hasValidDate(person.allergyAwarenessExpiry) && "Allergy",
      !person.scrChecklist?.approvedAt && person.compliance !== "Compliant" && "Admin review",
    ].filter(Boolean);
  }
  function priorityProfile(person) {
    if (isFormerStaffRecord(person)) return { score: 0, reason: "Archived staff record", tier: "Clear" };
    const personRequests = Object.entries(evidenceRequests)
      .filter(([id]) => id.startsWith(`${person.id}-`))
      .map(([, request]) => request);
    const rejected = personRequests.filter((request) => request.status === "Rejected").length;
    const submitted = personRequests.filter((request) => request.status === "Submitted").length;
    const requested = personRequests.filter((request) => request.status === "Requested").length;
    const missing = actionItems(person).filter((item) => item !== "Admin review").length;
    const expiring = [
      ["DBS", person.dbsRenewal],
      ["Safeguarding", person.safeguardingExpiry],
      ["Allergy", person.allergyAwarenessExpiry],
      ["First aid", person.firstAidExpiry],
    ].filter(([, value]) => evidenceExpiryStatus({ expiryDate: value }) === "Expiring soon").map(([label]) => label);
    const expired = [
      ["DBS", person.dbsRenewal],
      ["Safeguarding", person.safeguardingExpiry],
      ["Allergy", person.allergyAwarenessExpiry],
      ["First aid", person.firstAidExpiry],
    ].filter(([, value]) => evidenceExpiryStatus({ expiryDate: value }) === "Expired").map(([label]) => label);
    const adminReview = !person.scrChecklist?.approvedAt && person.compliance !== "Compliant";
    const score = (rejected * 120) + (expired.length * 95) + (missing * 70) + (submitted * 55) + (requested * 45) + (expiring.length * 35) + (adminReview ? 20 : 0);
    const reason = rejected
      ? `${rejected} evidence item${rejected === 1 ? "" : "s"} sent back`
      : expired.length
        ? `${expired[0]} expired`
        : missing
          ? `Missing ${actionItems(person).filter((item) => item !== "Admin review").slice(0, 2).join(" / ")}`
          : submitted
            ? `${submitted} submission${submitted === 1 ? "" : "s"} waiting`
            : requested
              ? `${requested} request${requested === 1 ? "" : "s"} open`
              : expiring.length
                ? `${expiring[0]} expiring soon`
                : adminReview
                  ? "Admin review needed"
                  : "No urgent SCR action";
    const tier = score >= 90 ? "High" : score >= 45 ? "Medium" : score > 0 ? "Low" : "Clear";
    return { score, reason, tier };
  }
  const search = query.trim().toLowerCase();
  const statusCounts = data.staff.reduce((acc, person) => {
    const status = checkStatus(person);
    acc.All += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (status !== "Compliant" && status !== "Archived") acc["Action needed"] += 1;
    return acc;
  }, { "Action needed": 0, All: 0, Compliant: 0, "Review needed": 0, Missing: 0, "Expiring soon": 0, Rejected: 0, Archived: 0 });
  const hasArchivedStaff = data.staff.some((person) => isFormerStaffRecord(person));
  const statusOptions = ["Action needed", "All", "Compliant", "Review needed", "Missing", "Expiring soon", "Rejected", ...(hasArchivedStaff ? ["Archived"] : [])];
  const visibleRows = data.staff.filter((person) => {
    const status = checkStatus(person);
    const matchesStatus = priorityView
      ? !isFormerStaffRecord(person) && priorityProfile(person).score > 0
      : statusFilter === "All" || (statusFilter === "Action needed" ? status !== "Compliant" && status !== "Archived" : status === statusFilter);
    const matchesSite = siteScopeLabel ? staffMatchesSchoolScope(person, siteScopeLabel) : siteFilter === "All" || staffSchoolNames(person).includes(siteFilter);
    const haystack = [person.name, person.email, person.role, person.location, person.compliance, managerName(person), staffPrimaryLocation(person)].filter(Boolean).join(" ").toLowerCase();
    return matchesStatus && matchesSite && (!search || haystack.includes(search));
  });
  const rows = [...visibleRows].sort((a, b) => {
    if (!priorityView) return data.staff.findIndex((person) => person.id === a.id) - data.staff.findIndex((person) => person.id === b.id);
    return priorityProfile(b).score - priorityProfile(a).score || a.name.localeCompare(b.name);
  });
  const priorityRows = data.staff
    .map((person) => ({ person, priority: priorityProfile(person) }))
    .filter((item) => item.priority.score > 0)
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 4);
  const activeStaff = data.staff.filter((person) => !isFormerStaffRecord(person));
  const actionCount = activeStaff.filter((person) => checkStatus(person) !== "Compliant").length;
  const compliantCount = activeStaff.length - actionCount;
  const selectedPerson = rows.find((person) => person.id === selectedId) || rows[0] || data.staff.find((person) => person.id === selectedId) || data.staff[0];
  const defaultStatusFilter = "Action needed";
  const registerViewMode = statusFilter === "All" && !priorityView ? "all" : "blockers";
  const filtersActive = query || statusFilter !== defaultStatusFilter || (!siteScopeLabel && siteFilter !== "All") || priorityView;
  useEffect(() => {
    if (!targetStaffId) return;
    setSelectedId(targetStaffId);
    onTargetHandled?.();
  }, [targetStaffId, onTargetHandled]);
  useEffect(() => {
    setStatusFilter("Action needed");
    setSiteFilter("All");
    setPriorityView(false);
  }, [siteScopeLabel]);
  return (
    <section className="staff-register" id="scr-staff-register">
      <div className="staff-register-head">
        <div>
          <p className="eyebrow">Live staff register</p>
          <h3>{isSiteScoped ? `${siteScopeLabel} staff SCR` : "Find the next compliance action quickly."}</h3>
          <p>{rows.length} of {data.staff.length} {siteScopeLabel ? `${siteScopeLabel} ` : ""}records shown · {actionCount} active staff need review · {compliantCount} currently compliant.</p>
          <div className="scr-register-mode" aria-label="SCR register view mode">
            <button className={registerViewMode === "blockers" ? "active" : ""} type="button" onClick={() => { setStatusFilter("Action needed"); setPriorityView(false); }}>
              Blockers first<span>{statusCounts["Action needed"] || 0}</span>
            </button>
            <button className={registerViewMode === "all" ? "active" : ""} type="button" onClick={() => { setStatusFilter("All"); setPriorityView(false); }}>
              Show all staff<span>{statusCounts.All || 0}</span>
            </button>
            {priorityRows.length > 0 && (
              <button className={priorityView ? "active" : ""} type="button" onClick={() => { setPriorityView(true); setStatusFilter("Action needed"); }}>
                Highest priority<span>{priorityRows.length}</span>
              </button>
            )}
          </div>
          {!!priorityRows.length && !isSiteScoped && (
            <div className="scr-priority-strip" aria-label="SCR priority view">
              {priorityRows.map(({ person, priority }) => (
                <button key={person.id} type="button" onClick={() => { setSelectedId(person.id); setPriorityView(true); }}>
                  <span>{priority.tier}</span>
                  <strong>{person.name}</strong>
                  <small>{priority.reason}</small>
                </button>
              ))}
            </div>
          )}
          <div className="scr-filter-chips" aria-label="SCR status filters">
            {statusOptions.map((status) => (
              <button key={status} className={statusFilter === status ? "active" : ""} type="button" onClick={() => setStatusFilter(status)}>
                {status}<span>{statusCounts[status] || 0}</span>
              </button>
            ))}
            <button className={priorityView ? "active" : ""} type="button" onClick={() => setPriorityView((value) => !value)}>
              Priority view<span>{priorityRows.length}</span>
            </button>
          </div>
        </div>
        <div className="staff-register-controls">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, role, site, manager" /></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {statusOptions.map((item) => <option key={item}>{item}</option>)}
          </select></label>
          {siteScopeLabel ? (
            <div className="staff-site-scope">
              <span>Site scope</span>
              <strong>{siteScopeLabel}</strong>
            </div>
          ) : (
            <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
              <option>All</option>
              {siteOptions.map((site) => <option key={site}>{site}</option>)}
            </select></label>
          )}
          <button className="button light" type="button" disabled={!filtersActive} onClick={() => { setQuery(""); setStatusFilter(defaultStatusFilter); setSiteFilter("All"); setPriorityView(false); }}>Clear</button>
        </div>
      </div>
      {selectedPerson && (
        <StaffProfilePanel
          person={selectedPerson}
          data={data}
          managerName={managerName(selectedPerson)}
          checkStatus={checkStatus(selectedPerson)}
          nextAction={actionText(selectedPerson)}
          actionItems={actionItems(selectedPerson)}
          evidenceRequests={buildStaffProfileEvidenceRequests(selectedPerson, evidenceRequests)}
          onRequestEvidence={onRequestEvidence}
          onClearEvidenceRequest={onClearEvidenceRequest}
          onMarkEvidenceChecked={onMarkEvidenceChecked}
          access={access}
          onUpdateStaffPay={onUpdateStaffPay}
          onOpenHrFiles={onOpenHrFiles}
          onOpenPay={onOpenPay}
        />
      )}
      <TableWrap>
        <table className={isSiteScoped ? "scr-staff-table scoped" : "scr-staff-table"}>
          <thead><tr><th>Staff</th><th>Role</th>{!isSiteScoped && <><th>Assigned sites</th><th>Reports to</th></>}<th>SCR</th><th>Priority</th><th>Next action</th>{!compact && !isSiteScoped && <><th>DBS renewal</th><th>Safeguarding</th><th>First aid</th></>}<th>Action</th></tr></thead>
          <tbody>
            {rows.map((person) => {
              const priority = priorityProfile(person);
              return (
              <tr
                key={person.id}
                className={`${selectedPerson?.id === person.id ? "selected-row" : ""} ${isFormerStaffRecord(person) ? "archived-row" : ""}`.trim()}
                onClick={() => setSelectedId(person.id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(person.id);
                  }
                }}
              >
                <td><strong>{person.name}</strong>{person.email && <><br /><small>{person.email}</small></>}</td>
                <td>{person.role}</td>
                {!isSiteScoped && <><td>{staffPrimaryLocation(person)}</td><td>{managerName(person)}</td></>}
                <td><Badge value={checkStatus(person)} /></td>
                <td><span className={`scr-priority-pill ${priority.tier.toLowerCase()}`}>{priority.tier}</span><br /><small>{priority.reason}</small></td>
                <td><strong>{actionText(person)}</strong></td>
                {!compact && !isSiteScoped && <><td>{person.dbsRenewal}</td><td>{person.safeguardingExpiry}</td><td>{person.firstAidExpiry}</td></>}
                <td><button className="button subtle scr-row-action" type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(person.id); }}>{isFormerStaffRecord(person) ? "Retained record" : selectedPerson?.id === person.id ? "Evidence open" : "View evidence"}</button></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      {!rows.length && <EmptyList title="No staff match these filters" text="Try all statuses or clear the search field." />}
    </section>
  );
}

function StaffProfilePanel({ person, data, managerName, checkStatus, nextAction, actionItems = [], evidenceRequests = [], onRequestEvidence, onClearEvidenceRequest, onMarkEvidenceChecked, access, onUpdateStaffPay, onOpenHrFiles, onOpenPay }) {
  const [notes, setNotes] = useState(() => readJson(staffProfileNotesStorageKey, {}));
  const [noteSaveStatus, setNoteSaveStatus] = useState("");
  const [accountState, setAccountState] = useState(() => readUserAdminState());
  const [photoUrl, setPhotoUrl] = useState(person.photoUrl || person.profilePhotoUrl || "");
  const [photoStatus, setPhotoStatus] = useState("");
  const [payForm, setPayForm] = useState(() => ({
    payRate: person.payRate || "",
    annualSalary: person.annualSalary || "",
    contractType: person.contractType || "",
  }));
  const [payStatus, setPayStatus] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [hrFileTab, setHrFileTab] = useState("All");
  const [profileTab, setProfileTab] = useState("SCR Evidence");
  const [requestEvidenceKey, setRequestEvidenceKey] = useState(() => scrEvidenceRequestOptions[0][0]);
  const [requestNote, setRequestNote] = useState("");
  const [showProfileEvidenceBlockersOnly, setShowProfileEvidenceBlockersOnly] = useState(false);
  const [suitabilityDeclarations, setSuitabilityDeclarations] = useState(() => normaliseSuitabilityDeclarations(person));
  const archivedRecord = person.formerRecord || {};
  const isArchivedProfile = isFormerStaffRecord(person);
  const suitabilityPerson = { ...person, suitabilityDeclarations };
  const suitabilityState = suitabilityDeclarationState(suitabilityPerson);
  const profileNotes = chooseLatestStaffProfileNotes(notes[person.id], data.staffProfileNotes?.[person.id]);
  const assignments = staffAssignments(person);
  const accountUser = mergeUserRecords(data.staff || [], accountState).find((user) => user.id === (person.profileId || person.id) || user.staffRecordId === person.id);
  const hrFiles = (data.hrFiles || []).filter((file) => file.staffRecordId === person.id);
  const hrFileTabs = buildStaffHrFileTabs(hrFiles);
  const visibleHrFiles = hrFileTab === "All" ? hrFiles : hrFiles.filter((file) => staffHrFileBucket(file) === hrFileTab);
  const sessions = (data.sessions || []).filter((session) => {
    const label = `${session.site || ""} ${session.programme || ""}`.toLowerCase();
    return staffSchoolNames(person).some((school) => label.includes(school.toLowerCase()));
  }).slice(0, 3);
  const avatar = photoUrl || person.photoUrl || person.profilePhotoUrl || defaultStaffAvatar;
  const canEditPay = ["Admin", "Superadmin"].includes(access?.role) && !isArchivedProfile;
  const monthlySalary = monthlySalaryFromAnnual(person.annualSalary);
  const contractFiles = hrFiles.filter((file) => staffHrFileBucket(file) === "Contracts");
  const payslipFiles = hrFiles.filter((file) => staffHrFileBucket(file) === "Payslips");
  const restrictedFiles = hrFiles.filter((file) => staffHrFileBucket(file) === "Restricted");
  const pendingEvidenceRequests = evidenceRequests.filter((request) => ["Requested", "Submitted", "Rejected"].includes(request.status));
  const profileTimeline = buildStaffProfileTimeline({ data, person, evidenceRequests, hrFiles });
  const profileSite = staffPrimaryLocation(person);
  const payBasis = person.annualSalary
    ? `${formatCurrency(monthlySalaryFromAnnual(person.annualSalary))}/mo salary`
    : person.payRate
      ? `${formatCurrency(person.payRate)}/hr`
      : "Pay basis missing";
  const profileTabs = ["Overview", "SCR Evidence", "Annual Suitability Declaration", "HR Files", "Pay", "Sites", "Notes"];
  const staffCanCompleteSuitability = !isArchivedProfile && access?.role === "Staff" && [
    access?.currentUser?.staffRecordId,
    access?.currentUser?.id,
  ].filter(Boolean).some((id) => id === person.id || id === person.profileId);
  function scrollToProfileSection(section) {
    if (typeof document === "undefined") return;
    document.getElementById(`staff-profile-${section}-${person.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleTimelineAction(event) {
    if (event.actionType === "evidence") {
      scrollToProfileSection("evidence");
      return;
    }
    if (event.actionType === "hrFiles") {
      onOpenHrFiles?.(person.id);
      return;
    }
    if (event.actionType === "pay") {
      onOpenPay?.(person.id);
    }
  }
  const operationalRecordCards = [
    {
      label: "People",
      title: managerName || "Line manager missing",
      detail: `${profileSite} · ${person.role || "Role not recorded"}`,
      status: managerName && managerName !== "Unassigned" ? "Assigned" : "Needs manager",
      actionLabel: "People details",
      action: () => scrollToProfileSection("people"),
    },
    {
      label: "Compliance",
      title: checkStatus,
      detail: pendingEvidenceRequests.length ? `${pendingEvidenceRequests.length} evidence request${pendingEvidenceRequests.length === 1 ? "" : "s"} active` : nextAction,
      status: actionItems.length ? "Action needed" : "Ready",
      actionLabel: "SCR evidence",
      action: () => scrollToProfileSection("evidence"),
    },
    {
      label: "HR files",
      title: `${hrFiles.length} file${hrFiles.length === 1 ? "" : "s"}`,
      detail: `${contractFiles.length} contract · ${payslipFiles.length} payslip · ${restrictedFiles.length} restricted`,
      status: hrFiles.length ? "On file" : "Missing files",
      actionLabel: "Open HR files",
      action: () => onOpenHrFiles?.(person.id),
    },
    {
      label: "Pay",
      title: payBasis,
      detail: person.contractType || "Contract type not recorded",
      status: person.annualSalary || person.payRate ? "Set" : "Needs setup",
      actionLabel: "Open pay",
      action: () => onOpenPay?.(person.id),
    },
  ];
  const profileStats = [
    ["Record", isArchivedProfile ? "Archived" : "Active"],
    ["SCR", checkStatus],
    ["Suitability", suitabilityState.label],
    ["Next action", nextAction],
    ["Manager", managerName || "Unassigned"],
  ];
  const requestByEvidenceKey = Object.fromEntries(evidenceRequests.map((request) => [request.evidenceKey, request]));
  const evidenceDateFields = {
    dbs: "dbsRenewal",
    safeguarding: "safeguardingExpiry",
    allergy: "allergyAwarenessExpiry",
    firstAid: "firstAidExpiry",
  };
  const evidenceTextFields = {
    eyfsLevel: ["eyfsLevel"],
    rightToWork: ["rightToWork", "rightToWorkType"],
    identity: ["identityVerified", "proofOfAddressVerified"],
    barredList: ["barredListResult", "barredListCheck"],
    references: ["referencesStatus", "references"],
    declarations: ["annualDeclarationDate", "declarationsStatus"],
  };
  const evidenceChecklistRows = scrEvidenceRequestOptions.map(([key, label]) => {
    const request = requestByEvidenceKey[key];
    const evidence = person.scrChecklist?.evidence?.[key] || {};
    const dateValue = evidence.expiryDate || person[evidenceDateFields[key]];
    const fieldValue = evidence.reference || evidence.status || (evidenceTextFields[key] || []).map((field) => person[field]).find(Boolean);
    const file = findScrEvidenceFile(person, evidence, label, hrFiles);
    const expiryStatus = evidenceExpiryStatus({ expiryDate: dateValue });
    const firstAidNotRequired = key === "firstAid" && String(person.firstAidExpiry || "").toLowerCase() === "not required";
    const eyfsLevel3Recorded = key === "eyfsLevel" && String(fieldValue || "").toLowerCase().includes("level 3");
    const status = request?.status === "Rejected"
      ? "Sent back"
      : request?.status === "Submitted"
        ? "Awaiting review"
        : request?.status === "Requested"
          ? "Requested"
          : request?.status === "Approved" || evidence.status === "Approved"
          ? "Approved"
          : firstAidNotRequired
            ? "Not required"
            : eyfsLevel3Recorded
              ? "Recorded"
              : expiryStatus || (fieldValue || file ? "Recorded" : "Missing");
    const tone = ["Approved", "Recorded", "In date", "Not required"].includes(status)
      ? "ready"
      : ["Awaiting review", "Requested", "Expiring soon"].includes(status)
        ? "pending"
        : "alert";
    const referenceSummary = key === "references" ? referenceAnswerSummary(evidence).join(" · ") : "";
    const detail = request?.note
      || request?.rejectionReason
      || request?.submissionNote
      || evidence.note
      || referenceSummary
      || file?.title
      || (dateValue ? `Review date ${formatShortDate(dateValue)}` : fieldValue || "No evidence recorded yet.");
    const canMarkChecked = !isArchivedProfile && ["Recorded", "In date", "Awaiting review", "Requested", "Sent back"].includes(status);
    const nextStep = status === "Missing"
      ? "Request update"
      : status === "Awaiting review"
        ? "Review and mark checked"
        : status === "Requested"
          ? "Waiting for staff"
          : status === "Sent back"
            ? "Needs resubmission"
            : status === "Not required"
              ? "No action"
              : "Keep checked";
    const dbsHistory = key === "dbs" ? buildDbsEvidenceHistory(person, evidence) : null;
    return { key, label, status, tone, detail, file, request, canMarkChecked, nextStep, dbsHistory };
  });
  const profileEvidenceBlockers = evidenceChecklistRows.filter((row) => row.tone !== "ready");
  const firstProfileEvidenceBlocker = profileEvidenceBlockers[0] || null;
  const visibleEvidenceChecklistRows = showProfileEvidenceBlockersOnly ? profileEvidenceBlockers : evidenceChecklistRows;
  const inspectionPriorityRows = ["dbs", "barredList", "rightToWork", "identity", "safeguarding", "allergy", "firstAid", "eyfsLevel"]
    .map((key) => evidenceChecklistRows.find((row) => row.key === key))
    .filter(Boolean);
  const inspectionReadyRows = inspectionPriorityRows.filter((row) => row.tone === "ready");
  const inspectionBlockerRows = inspectionPriorityRows.filter((row) => row.tone !== "ready");
  const staffDbs = staffDbsNumber(person);
  const staffChecked = staffScrCheckedDate(person);
  const evidenceGroups = [
    {
      title: "Required for inspection",
      text: "Core safer recruitment checks Ofsted are most likely to ask for first.",
      keys: ["dbs", "barredList", "rightToWork", "identity"],
    },
    {
      title: "Training",
      text: "Training and qualification records that support the rota and site requirements.",
      keys: ["safeguarding", "allergy", "firstAid", "eyfsLevel"],
    },
    {
      title: "Recruitment",
      text: "Recruitment evidence and annual declarations retained against the SCR.",
      keys: ["references", "declarations"],
    },
  ].map((group) => ({
    ...group,
    rows: group.keys
      .map((key) => visibleEvidenceChecklistRows.find((row) => row.key === key))
      .filter(Boolean),
  })).filter((group) => group.rows.length);
  const evidenceGroupStats = evidenceGroups.map((group) => {
    const blockers = group.rows.filter((row) => row.tone !== "ready").length;
    return {
      title: group.title,
      ready: group.rows.length - blockers,
      total: group.rows.length,
      blockers,
      tone: blockers ? "pending" : "ready",
    };
  });
  const adminReviewRow = {
    key: "adminReview",
    label: "Admin review",
    status: person.scrChecklist?.approvedAt ? "Approved" : "Awaiting review",
    tone: person.scrChecklist?.approvedAt ? "ready" : "pending",
    detail: person.scrChecklist?.approvedAt ? `Approved ${formatShortDate(person.scrChecklist.approvedAt.slice(0, 10))}` : "Final admin sign-off has not been recorded.",
    nextStep: person.scrChecklist?.approvedAt ? "Keep checked" : "Review profile",
    canMarkChecked: false,
  };

  useEffect(() => {
    setPhotoUrl(person.photoUrl || person.profilePhotoUrl || "");
    setPhotoStatus("");
    setPayForm({
      payRate: person.payRate || "",
      annualSalary: person.annualSalary || "",
      contractType: person.contractType || "",
    });
    setPayStatus("");
    setHrFileTab("All");
    setProfileTab("SCR Evidence");
    setNoteSaveStatus("");
    setShowProfileEvidenceBlockersOnly(false);
    const missingKey = actionItems.map((item) => String(item).toLowerCase()).includes("dbs")
      ? "dbs"
      : actionItems.map((item) => String(item).toLowerCase()).includes("safeguarding")
        ? "safeguarding"
        : actionItems.map((item) => String(item).toLowerCase()).includes("allergy")
          ? "allergy"
          : scrEvidenceRequestOptions[0][0];
    setRequestEvidenceKey(missingKey);
    setRequestNote("");
    setSuitabilityDeclarations(normaliseSuitabilityDeclarations(person));
  }, [person.id, person.photoUrl, person.profilePhotoUrl, person.payRate, person.annualSalary, person.contractType, person.suitabilityDeclarations]);

  function handleSuitabilityDeclarationSaved(declaration) {
    setSuitabilityDeclarations((current) => normaliseSuitabilityDeclarations({
      suitabilityDeclarations: [declaration, ...current],
    }));
  }

  async function savePayDetails(event) {
    event.preventDefault();
    if (!canEditPay) return;
    const patch = {
      payRate: Number(payForm.payRate || 0),
      annualSalary: Number(payForm.annualSalary || 0),
      contractType: payForm.contractType || "Not recorded",
    };
    onUpdateStaffPay?.(person.id, patch);
    setPayStatus("Saving pay details...");
    try {
      if (hasSupabaseConfig) {
        const { updateStaffPayDetails } = await loadSupabaseModule();
        await updateStaffPayDetails(person.id, patch);
      }
      setPayStatus("Pay details saved.");
      addAuditLog("Staff pay details updated", `${person.name}: ${patch.annualSalary ? `${formatCurrency(patch.annualSalary)} annual` : "no annual salary"} · ${patch.payRate ? `${formatCurrency(patch.payRate)}/hr` : "no hourly rate"}`);
    } catch (error) {
      setPayStatus(`Saved locally, but live database update failed: ${error.message}`);
    }
  }

  async function resetProfileAccountPassword() {
    if (isArchivedProfile) {
      setAccountStatus("Archived staff records are retained read-only. Restore the staff member before changing account access.");
      return;
    }
    const email = accountUser?.email || person.email || "";
    if (!isRealStaffEmail(email)) {
      setAccountStatus("Add a real email before generating account access.");
      return;
    }
    const temporaryPassword = generateTemporaryPassword();
    const now = new Date().toISOString();
    setAccountBusy(true);
    setAccountStatus("Generating temporary password...");
    const nextAccount = {
      ...(accountUser || {}),
      id: accountUser?.id || person.profileId || person.id,
      staffRecordId: person.id,
      name: person.name,
      email,
      role: accountUser?.role || person.accessRole || (person.role?.toLowerCase().includes("manager") ? "Manager" : "Staff"),
      status: accountUser?.status === "Deactivated" ? "Invited" : (accountUser?.status || "Active"),
      temporaryPassword,
      temporaryPasswordUpdatedAt: now,
      lastPasswordResetAt: now,
      accountAction: "Password reset from profile",
      emailStatus: hasSupabaseConfig ? "Sending reset email" : "Local preview",
    };
    try {
      let result = null;
      if (hasSupabaseConfig) {
        const { resetStaffAccountPassword, getStaffLoginUrl } = await loadSupabaseModule();
        result = await resetStaffAccountPassword({
          staffRecordId: person.id,
          name: person.name,
          email,
          role: nextAccount.role,
          temporaryPassword,
          loginUrl: getStaffLoginUrl(),
        });
      }
      const updated = {
        ...nextAccount,
        supabaseUserId: result?.userId || nextAccount.supabaseUserId || "",
        emailStatus: result?.emailed
          ? "Reset email sent"
          : (result?.emailError || (hasSupabaseConfig ? "Password reset, email not sent" : "Local preview only")),
      };
      const nextState = {
        ...accountState,
        [updated.id]: updated,
      };
      setAccountState(nextState);
      localStorage.setItem(userStorageKey, JSON.stringify(nextState));
      setAccountStatus(result?.emailed ? "Password reset and email sent." : "Password reset. Use the visible password for manual handover.");
      addAuditLog("Staff password reset", `${email} password reset from profile${result?.emailed ? " and emailed" : " for manual handover"}`);
    } catch (error) {
      const updated = { ...nextAccount, emailStatus: error.message || "Reset failed" };
      const nextState = {
        ...accountState,
        [updated.id]: updated,
      };
      setAccountState(nextState);
      localStorage.setItem(userStorageKey, JSON.stringify(nextState));
      setAccountStatus(`Temporary password saved locally, but live reset failed: ${error.message}`);
    } finally {
      setAccountBusy(false);
    }
  }

  function updateNote(field, value) {
    const nextStaffNotes = {
      ...profileNotes,
      [field]: value,
      updatedAt: new Date().toISOString(),
      source: "local",
    };
    const next = {
      ...notes,
      [person.id]: nextStaffNotes,
    };
    setNotes(next);
    localStorage.setItem(staffProfileNotesStorageKey, JSON.stringify(next));
    setNoteSaveStatus(hasSupabaseConfig && isUuid(person.id) ? "Unsaved changes" : "Saved locally");
  }

  async function saveProfileNotes(field, value) {
    if (isArchivedProfile) return;
    const nextStaffNotes = {
      ...profileNotes,
      [field]: value,
      updatedAt: new Date().toISOString(),
      source: "local",
    };
    const next = {
      ...notes,
      [person.id]: nextStaffNotes,
    };
    setNotes(next);
    localStorage.setItem(staffProfileNotesStorageKey, JSON.stringify(next));
    if (!hasSupabaseConfig || !isUuid(person.id)) {
      setNoteSaveStatus("Saved locally");
      return;
    }
    setNoteSaveStatus("Saving...");
    try {
      const { saveStaffProfileNotes } = await loadSupabaseModule();
      const saved = await saveStaffProfileNotes(person.id, nextStaffNotes);
      const merged = {
        ...next,
        [person.id]: saved,
      };
      setNotes(merged);
      localStorage.setItem(staffProfileNotesStorageKey, JSON.stringify(merged));
      setNoteSaveStatus("Saved to Supabase");
      addAuditLog("Staff profile notes updated", `${person.name}: ${field} notes`);
    } catch (error) {
      setNoteSaveStatus(`Saved locally · live save failed: ${error.message || "Supabase rejected the update"}`);
    }
  }

  async function uploadProfilePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isArchivedProfile) {
      setPhotoStatus("Archived profile photos are retained read-only.");
      event.target.value = "";
      return;
    }
    if (!hasSupabaseConfig) {
      setPhotoStatus("Photo upload needs Supabase on the live platform.");
      return;
    }
    setPhotoStatus("Uploading photo...");
    try {
      const { uploadStaffProfilePhoto } = await loadSupabaseModule();
      const result = await uploadStaffProfilePhoto(person.id, file);
      setPhotoUrl(result.photoUrl);
      setPhotoStatus("Photo saved.");
      addAuditLog("Staff photo uploaded", person.name);
    } catch (error) {
      setPhotoStatus(error.message || "Unable to upload staff photo.");
    } finally {
      event.target.value = "";
    }
  }

  function submitEvidenceRequest(event) {
    event.preventDefault();
    if (isArchivedProfile) return;
    onRequestEvidence?.(person, requestEvidenceKey, requestNote);
    setRequestNote("");
  }

  function requestEvidenceFromRow(row) {
    if (isArchivedProfile) return;
    onRequestEvidence?.(person, row.key, row.status === "Missing"
      ? `${row.label} evidence is missing. Please upload or provide the latest evidence.`
      : `Please provide an updated ${row.label} evidence item.`);
    setRequestEvidenceKey(row.key);
    setRequestNote("");
  }

  function markEvidenceRowChecked(row) {
    if (isArchivedProfile || !row.canMarkChecked) return;
    onMarkEvidenceChecked?.(person, row.key, row.label);
  }

  function focusEvidenceRow(row) {
    if (!row) return;
    setProfileTab("SCR Evidence");
    setShowProfileEvidenceBlockersOnly(false);
    window.setTimeout(() => {
      document.getElementById(`scr-profile-evidence-${person.id}-${row.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  return (
    <article className={`staff-profile-panel ${isArchivedProfile ? "archived" : ""}`}>
      <div className="staff-profile-identity">
        <div className="staff-photo-control">
          <img src={avatar} alt={`${person.name} profile`} />
          {!isArchivedProfile ? (
            <label className="button light">
              <Upload size={16} /> Upload photo
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProfilePhoto} />
            </label>
          ) : <small>Photo retained with archived record.</small>}
          {photoStatus && <small>{photoStatus}</small>}
        </div>
        <div>
          <p className="eyebrow">Staff profile</p>
          <h3>{person.name}</h3>
          <p>{person.role} · {staffPrimaryLocation(person)}</p>
          <div className="staff-profile-badges">
            <Badge value={checkStatus} />
            <Badge value={`Suitability: ${suitabilityState.label}`} />
            <Badge value={person.contractType || "Contract not recorded"} />
            <Badge value={accountUser?.role ? `${accountUser.role} access` : "Access not set"} />
          </div>
        </div>
      </div>
      {isArchivedProfile && (
        <section className="archived-scr-banner">
          <div>
            <p className="eyebrow">Archived staff record</p>
            <h4>Retained for SCR, HR and payroll evidence.</h4>
            <p>{person.name} is no longer included in live staffing or compliance actions. Evidence is available here for review, but active controls are locked until the staff member is restored.</p>
          </div>
          <dl>
            <div><dt>Left</dt><dd>{person.leftAt ? formatShortDate(person.leftAt.slice(0, 10)) : archivedRecord.archivedAt ? formatShortDate(archivedRecord.archivedAt.slice(0, 10)) : "Date not recorded"}</dd></div>
            <div><dt>Reason</dt><dd>{person.leavingReason || archivedRecord.reason || "Not recorded"}</dd></div>
            <div><dt>Last site</dt><dd>{staffPrimaryLocation(person)}</dd></div>
          </dl>
        </section>
      )}
      {suitabilityState.tone !== "ready" && (
        <section className={`suitability-warning ${suitabilityState.tone}`}>
          <div>
            <p className="eyebrow">Annual suitability declaration</p>
            <h4>{suitabilityState.label}</h4>
            <p>{suitabilityState.detail} Staff must confirm ongoing suitability every 12 months.</p>
          </div>
          <button className="button light" type="button" onClick={() => setProfileTab("Annual Suitability Declaration")}>Open declaration</button>
        </section>
      )}
      <section className={`staff-profile-inspection-snapshot ${inspectionBlockerRows.length ? "needs-action" : "ready"}`}>
        <div className="staff-profile-inspection-summary">
          <p className="eyebrow">Inspection snapshot</p>
          <h4>{inspectionBlockerRows.length ? `${inspectionBlockerRows.length} evidence item${inspectionBlockerRows.length === 1 ? "" : "s"} to check` : "Core SCR evidence ready"}</h4>
          <p>
            {person.name} · {staffPrimaryLocation(person)} · DBS {staffDbs || "not recorded"} · SCR checked {staffChecked ? formatShortDate(staffChecked) : "not recorded"}
          </p>
        </div>
        <div className="staff-profile-inspection-score">
          <strong>{inspectionReadyRows.length}/{inspectionPriorityRows.length || 0}</strong>
          <span>core items ready</span>
        </div>
        <div className="staff-profile-inspection-checks">
          {inspectionPriorityRows.slice(0, 8).map((row) => (
            <button
              className={row.tone}
              key={row.key}
              type="button"
              onClick={() => setProfileTab("SCR Evidence")}
              title={row.detail}
            >
              <span>{row.label}</span>
              <strong>{row.status}</strong>
            </button>
          ))}
        </div>
      </section>
      <div className="staff-profile-tabs" role="tablist" aria-label={`${person.name} staff profile sections`}>
        {profileTabs.map((tabName) => (
          <button key={tabName} className={profileTab === tabName ? "active" : ""} type="button" onClick={() => setProfileTab(tabName)}>{tabName}</button>
        ))}
      </div>
      <div className="staff-profile-tab-panel">
        {profileTab === "Overview" && (
          <div className="staff-profile-tab-stack">
            <section className="staff-profile-account-card">
              <div>
                <p className="eyebrow">Account access</p>
                <h4>{accountUser?.status || "Not invited"}</h4>
                <p>{accountUser?.email || person.email || "Email not recorded"} · {accountUser?.role || "Staff"} access{isArchivedProfile ? " · archived record" : ""}</p>
              </div>
              <div className="staff-profile-account-actions">
                {accountUser?.temporaryPassword ? (
                  <>
                    <code>{accountUser.temporaryPassword}</code>
                    <button className="button light" type="button" onClick={() => copyLoginDetails(accountUser)}>Copy login details</button>
                  </>
                ) : (
                  <small>No temporary password is currently visible.</small>
                )}
                <button className="button light" type="button" disabled={accountBusy || isArchivedProfile} onClick={resetProfileAccountPassword}>{accountBusy ? "Working..." : "Reset password"}</button>
              </div>
              {accountStatus && <p className="account-message">{accountStatus}</p>}
            </section>
            <div className="staff-profile-stat-strip">
              {profileStats.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <section className="staff-record-command">
              <div className="staff-record-command-head">
                <div>
                  <p className="eyebrow">Operational record</p>
                  <h4>Single source of truth for {person.name}</h4>
                </div>
                <Badge value={isArchivedProfile ? "Retained" : "Live record"} />
              </div>
              <div className="staff-record-command-grid">
                {operationalRecordCards.map((card) => (
                  <article key={card.label}>
                    <span>{card.label}</span>
                    <strong>{card.title}</strong>
                    <small>{card.detail}</small>
                    <Badge value={card.status} />
                    <button type="button" onClick={card.action}>{card.actionLabel}</button>
                  </article>
                ))}
              </div>
            </section>
            <section className="staff-profile-timeline">
              <div className="staff-profile-timeline-head">
                <div>
                  <p className="eyebrow">Recent activity</p>
                  <h4>Operational trail for {person.name}</h4>
                </div>
                <Badge value={`${profileTimeline.length} shown`} />
              </div>
              <div className="staff-profile-timeline-list">
                {profileTimeline.length ? profileTimeline.map((event) => (
                  <article key={event.id}>
                    <span className={`staff-profile-timeline-dot ${event.tone}`} aria-hidden="true" />
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                    </div>
                    <small>{event.date ? formatShortDate(event.date) : "Date pending"}</small>
                    {event.href ? (
                      <a className="staff-profile-timeline-action" href={event.href} target="_blank" rel="noreferrer">{event.actionLabel || "Open"}</a>
                    ) : event.actionType ? (
                      <button className="staff-profile-timeline-action" type="button" onClick={() => handleTimelineAction(event)}>{event.actionLabel || "Open"}</button>
                    ) : null}
                  </article>
                )) : (
                  <article className="staff-profile-timeline-empty">
                    <span className="staff-profile-timeline-dot neutral" aria-hidden="true" />
                    <div>
                      <strong>No recent activity yet</strong>
                      <p>HR files, SCR requests, payroll edits and policy acknowledgements will appear here once recorded.</p>
                    </div>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}
        {profileTab === "SCR Evidence" && (
          <div className="staff-profile-tab-stack">
            <section className={`scr-next-action-card ${actionItems.length ? "needs-action" : "ready"}`}>
              <div>
                <p className="eyebrow">Next action</p>
                <h4>{nextAction}</h4>
                <p>{isArchivedProfile ? "This is a retained evidence record and is excluded from live SCR actions." : actionItems.length ? "Work through these items before issuing assurance or marking the profile ready." : "No immediate SCR action is flagged for this staff member."}</p>
              </div>
              <div className="scr-action-tags">
                {(actionItems.length ? actionItems : ["No action"]).map((item) => <span key={item}>{item}</span>)}
              </div>
              {firstProfileEvidenceBlocker && !isArchivedProfile && (
                <div className="scr-next-action-workflow">
                  <div>
                    <span>First blocker</span>
                    <strong>{firstProfileEvidenceBlocker.label}</strong>
                    <small>{firstProfileEvidenceBlocker.status} · {firstProfileEvidenceBlocker.nextStep}</small>
                  </div>
                  <div>
                    <button className="button light" type="button" onClick={() => focusEvidenceRow(firstProfileEvidenceBlocker)}>Open blocker</button>
                    <button className="button light" type="button" onClick={() => requestEvidenceFromRow(firstProfileEvidenceBlocker)} disabled={!onRequestEvidence}>Request update</button>
                    <button className="button dark" type="button" onClick={() => markEvidenceRowChecked(firstProfileEvidenceBlocker)} disabled={!onMarkEvidenceChecked || !firstProfileEvidenceBlocker.canMarkChecked}>Mark checked</button>
                  </div>
                </div>
              )}
            </section>
            <section className="staff-profile-scr-checklist">
              <div className="scr-profile-checklist-head">
                <div>
                  <p className="eyebrow">Staff SCR evidence</p>
                  <h4>Grouped evidence for inspection review.</h4>
                </div>
                <div className="scr-profile-checklist-tools">
                  <Badge value={`${profileEvidenceBlockers.length} blocker${profileEvidenceBlockers.length === 1 ? "" : "s"}`} />
                  <button className={showProfileEvidenceBlockersOnly ? "scr-filter-toggle active" : "scr-filter-toggle"} type="button" onClick={() => setShowProfileEvidenceBlockersOnly((value) => !value)}>
                    {showProfileEvidenceBlockersOnly ? "Showing blockers" : "Show blockers only"}
                  </button>
                </div>
              </div>
              <div className="scr-profile-review-strip" aria-label="SCR evidence group readiness">
                {evidenceGroupStats.map((item) => (
                  <div className={item.tone} key={item.title}>
                    <span>{item.title}</span>
                    <strong>{item.ready}/{item.total}</strong>
                    <small>{item.blockers ? `${item.blockers} to check` : "Ready"}</small>
                  </div>
                ))}
                <div className={adminReviewRow.tone}>
                  <span>Admin review</span>
                  <strong>{adminReviewRow.status}</strong>
                  <small>{adminReviewRow.nextStep}</small>
                </div>
              </div>
              <p className="panel-note">Open the group you need. Every evidence row has the file route, request update and mark checked workflow.</p>
              <div className="scr-profile-group-list">
                {evidenceGroups.map((group, index) => {
                  const blockers = group.rows.filter((row) => row.tone !== "ready").length;
                  return (
                    <details className="scr-profile-evidence-group" key={group.title} open={index === 0 || blockers > 0}>
                      <summary>
                        <div>
                          <strong>{group.title}</strong>
                          <span>{group.text}</span>
                        </div>
                        <Badge value={blockers ? `${blockers} action${blockers === 1 ? "" : "s"}` : "Ready"} />
                      </summary>
                      <div className="scr-profile-action-list">
                        {group.rows.map((row) => (
                          <article className={`scr-profile-action-row ${row.tone}`} id={`scr-profile-evidence-${person.id}-${row.key}`} key={row.key}>
                            <div>
                              <span>{row.label}</span>
                              <strong>{row.status}</strong>
                              <small>{row.detail}</small>
                              {row.dbsHistory && <DbsEvidenceHistory history={row.dbsHistory} />}
                              {row.request?.history?.length ? <EvidenceHistoryTimeline events={row.request.history} /> : null}
                            </div>
                            <div className="scr-profile-action-meta">
                              <em>{row.nextStep}</em>
                              <div>
                                {row.file?.fileUrl ? (
                                  <a className="button light" href={row.file.fileUrl} target="_blank" rel="noreferrer">View file</a>
                                ) : row.file?.storagePath ? (
                                  <span className="scr-private-file">Private file</span>
                                ) : null}
                                <button className="button light" type="button" onClick={() => requestEvidenceFromRow(row)} disabled={!onRequestEvidence || isArchivedProfile}>
                                  Request update
                                </button>
                                <button className="button dark" type="button" onClick={() => markEvidenceRowChecked(row)} disabled={!onMarkEvidenceChecked || !row.canMarkChecked || isArchivedProfile}>
                                  Mark checked
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </details>
                  );
                })}
                {evidenceChecklistRows.length > 0 && !visibleEvidenceChecklistRows.length && (
                  <EmptyList title="No blockers on this profile" text="All evidence items are either checked, recorded or not required." />
                )}
                <details className="scr-profile-evidence-group admin-review" open>
                  <summary>
                    <div>
                      <strong>Admin notes</strong>
                      <span>Final SCR review status and internal notes.</span>
                    </div>
                    <Badge value={adminReviewRow.status} />
                  </summary>
                  <div className="scr-profile-action-list">
                    <article className={`scr-profile-action-row ${adminReviewRow.tone}`}>
                      <div>
                        <span>{adminReviewRow.label}</span>
                        <strong>{adminReviewRow.status}</strong>
                        <small>{adminReviewRow.detail}</small>
                      </div>
                      <div className="scr-profile-action-meta">
                        <em>{adminReviewRow.nextStep}</em>
                      </div>
                    </article>
                  </div>
                </details>
              </div>
            </section>
            <details className="scr-profile-follow-up" id={`staff-profile-evidence-${person.id}`}>
              <summary>
                <div>
                  <p className="eyebrow">Evidence requests</p>
                  <strong>Request missing or updated SCR evidence</strong>
                  <span>{evidenceRequests.length ? `${evidenceRequests.length} active request${evidenceRequests.length === 1 ? "" : "s"}` : "No active requests"}</span>
                </div>
                <Badge value={evidenceRequests.length ? "Follow-up" : "Clear"} />
              </summary>
              <div className="scr-profile-request-panel compact">
                <div>
                  <h4>Staff evidence follow-up</h4>
                  <p>{isArchivedProfile ? "Evidence requests are locked because this staff member has left. Restore the record before requesting new evidence." : "Requests logged here appear in the staff member’s evidence request area and can be tracked by admin until submitted, approved or cleared."}</p>
                </div>
                <form className="scr-profile-request-form" onSubmit={submitEvidenceRequest}>
                  <label>
                    Evidence type
                    <select value={requestEvidenceKey} onChange={(event) => setRequestEvidenceKey(event.target.value)} disabled={isArchivedProfile}>
                      {scrEvidenceRequestOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    Note to staff
                    <textarea rows="2" value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Please upload your renewed certificate or reference." disabled={isArchivedProfile} />
                  </label>
                  <button className="button dark" type="submit" disabled={!onRequestEvidence || isArchivedProfile}><Upload size={16} /> Request Evidence</button>
                </form>
                <div className="scr-profile-request-list">
                  {evidenceRequests.length ? evidenceRequests.map((request) => (
                    <article key={request.id}>
                      <div>
                        <strong>{request.check}</strong>
                        <span>{request.status} · {request.requestedAt ? formatShortDate(request.requestedAt.slice(0, 10)) : "date pending"}{request.requestedBy ? ` · ${request.requestedBy}` : ""}</span>
                        {request.note && <p>{request.note}</p>}
                        {!!request.history.length && <EvidenceHistoryTimeline events={request.history} />}
                      </div>
                      {request.status !== "Submitted" && (
                        <button className="button light" type="button" onClick={() => onClearEvidenceRequest?.(request)} disabled={!onClearEvidenceRequest || isArchivedProfile}>Clear</button>
                      )}
                    </article>
                  )) : <span className="muted-inline">No active evidence requests for this staff member.</span>}
                </div>
              </div>
            </details>
          </div>
        )}
        {profileTab === "Annual Suitability Declaration" && (
          <SuitabilityDeclarationPanel
            person={suitabilityPerson}
            canComplete={staffCanCompleteSuitability}
            showHistory
            onSaved={handleSuitabilityDeclarationSaved}
          />
        )}
        {profileTab === "HR Files" && (
          <section className="staff-profile-files" id={`staff-profile-files-${person.id}`}>
            <h4>HR files</h4>
            <div className="staff-hr-file-tabs" role="tablist" aria-label={`${person.name} HR file categories`}>
              {hrFileTabs.map((tab) => (
                <button
                  key={tab.name}
                  className={hrFileTab === tab.name ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={hrFileTab === tab.name}
                  onClick={() => setHrFileTab(tab.name)}
                >
                  {tab.name}<span>{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="staff-profile-list">
              {visibleHrFiles.slice(0, 6).map((file) => (
                <div className="staff-profile-file-row" key={file.id}>
                  <div>
                    <strong>{file.title}</strong>
                    <span>{file.category}{file.expiryDate ? ` · expires ${formatShortDate(file.expiryDate)}` : ""}</span>
                  </div>
                  {file.fileUrl && <a className="button light" href={file.fileUrl} target="_blank" rel="noreferrer">Open</a>}
                </div>
              ))}
              {!visibleHrFiles.length && <span className="muted-inline">No {hrFileTab === "All" ? "" : `${hrFileTab.toLowerCase()} `}HR files logged yet.</span>}
              {visibleHrFiles.length > 6 && <span className="muted-inline">Showing latest 6 of {visibleHrFiles.length}. Open HR Files for the full document history.</span>}
            </div>
          </section>
        )}
        {profileTab === "Pay" && (
          <section id={`staff-profile-pay-${person.id}`}>
            <h4>Pay & contract</h4>
            {canEditPay ? (
              <form className="staff-pay-form" onSubmit={savePayDetails}>
                <label>Hourly rate<input type="number" min="0" step="0.01" value={payForm.payRate} onChange={(event) => setPayForm((current) => ({ ...current, payRate: event.target.value }))} /></label>
                <label>Annual salary<input type="number" min="0" step="0.01" value={payForm.annualSalary} onChange={(event) => setPayForm((current) => ({ ...current, annualSalary: event.target.value }))} /></label>
                <label>Contract type<input type="text" value={payForm.contractType} onChange={(event) => setPayForm((current) => ({ ...current, contractType: event.target.value }))} placeholder="ZH, TTO, salaried..." /></label>
                <div className="staff-pay-summary">
                  <span>Monthly salary</span>
                  <strong>{formatCurrency(monthlySalaryFromAnnual(payForm.annualSalary))}</strong>
                  <small>Annual salary divided by 12. Extra approved hours are added in Payroll.</small>
                </div>
                <button className="button light" type="submit">Save pay details</button>
                {payStatus && <small>{payStatus}</small>}
              </form>
            ) : (
              <dl className="staff-profile-dl">
                <div><dt>Hourly rate</dt><dd>{person.payRate ? `${formatCurrency(person.payRate)}/hr` : "Not recorded"}</dd></div>
                <div><dt>Annual salary</dt><dd>{person.annualSalary ? formatCurrency(person.annualSalary) : "Not recorded"}</dd></div>
                <div><dt>Monthly salary</dt><dd>{monthlySalary ? formatCurrency(monthlySalary) : "Not recorded"}</dd></div>
                <div><dt>Contract</dt><dd>{person.contractType || "Not recorded"}</dd></div>
                <div><dt>Start date</dt><dd>{person.startDate || "Not recorded"}</dd></div>
              </dl>
            )}
          </section>
        )}
        {profileTab === "Sites" && (
          <div className="staff-profile-grid compact">
            <section id={`staff-profile-people-${person.id}`}>
              <h4>Contact & line management</h4>
              <dl>
                <div><dt>Email</dt><dd>{person.email || "Not recorded"}</dd></div>
                <div><dt>Phone</dt><dd>{person.phone || "Not recorded"}</dd></div>
                <div><dt>Reports to</dt><dd>{managerName || "Unassigned"}</dd></div>
                <div><dt>Next action</dt><dd>{nextAction}</dd></div>
              </dl>
            </section>
            <section>
              <h4>Assigned sites</h4>
              <div className="staff-profile-list">
                {assignments.map((assignment, index) => (
                  <div key={`${assignment.school}-${index}`}>
                    <strong>{assignment.school}</strong>
                    <span>{assignment.role || person.role} · {assignment.status || "Active"}</span>
                  </div>
                ))}
                {!assignments.length && <span className="muted-inline">No active site assignment.</span>}
              </div>
            </section>
            <section>
              <h4>Upcoming rota context</h4>
              <div className="staff-profile-list">
                {sessions.map((session) => (
                  <div key={session.id || `${session.site}-${session.date}`}>
                    <strong>{session.programme}</strong>
                    <span>{session.site} · {session.date} · {session.time}</span>
                  </div>
                ))}
                {!sessions.length && <span className="muted-inline">No matching upcoming sessions loaded.</span>}
              </div>
            </section>
          </div>
        )}
        {profileTab === "Notes" && (
          <section className="staff-profile-notes">
            <div className="staff-profile-notes-head">
              <div>
                <p className="eyebrow">Internal notes</p>
                <h4>Structured notes for this staff record</h4>
              </div>
              <Badge value={noteSaveStatus || (profileNotes.updatedAt ? `${profileNotes.source === "supabase" ? "Live" : "Local"} · ${formatShortDate(profileNotes.updatedAt)}` : "Local notes")} />
            </div>
            <div className="staff-profile-notes-grid">
              <label>Manager notes<textarea value={profileNotes.manager} onChange={(event) => updateNote("manager", event.target.value)} onBlur={(event) => saveProfileNotes("manager", event.target.value)} rows="3" placeholder={isArchivedProfile ? "Archived record notes are read-only." : "Day-to-day context, line management, check-ins..."} disabled={isArchivedProfile} /></label>
              <label>Contract notes<textarea value={profileNotes.contract} onChange={(event) => updateNote("contract", event.target.value)} onBlur={(event) => saveProfileNotes("contract", event.target.value)} rows="3" placeholder={isArchivedProfile ? "Archived record notes are read-only." : "Contract type, agreed changes, hours pattern, review dates..."} disabled={isArchivedProfile} /></label>
              <label>Safeguarding / compliance notes<textarea value={profileNotes.compliance} onChange={(event) => updateNote("compliance", event.target.value)} onBlur={(event) => saveProfileNotes("compliance", event.target.value)} rows="3" placeholder={isArchivedProfile ? "Archived record notes are read-only." : "SCR follow-up, evidence context, training notes..."} disabled={isArchivedProfile} /></label>
              <label>Payroll notes<textarea value={profileNotes.payroll} onChange={(event) => updateNote("payroll", event.target.value)} onBlur={(event) => saveProfileNotes("payroll", event.target.value)} rows="3" placeholder={isArchivedProfile ? "Archived record notes are read-only." : "Pay agreements, extra hours context, payroll reminders..."} disabled={isArchivedProfile} /></label>
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function SuitabilityDeclarationPanel({ person, canComplete = false, showHistory = false, onSaved }) {
  const declarations = normaliseSuitabilityDeclarations(person);
  const state = suitabilityDeclarationState({ ...person, suitabilityDeclarations: declarations });
  const [confirmations, setConfirmations] = useState(() => Object.fromEntries(suitabilityDeclarationStatements.map(([key]) => [key, false])));
  const [finalConfirmation, setFinalConfirmation] = useState(false);
  const [status, setStatus] = useState("");
  const confirmedCount = suitabilityDeclarationStatements.filter(([key]) => confirmations[key]).length;
  const allStatementsConfirmed = suitabilityDeclarationStatements.every(([key]) => confirmations[key]);
  const canSubmit = canComplete && allStatementsConfirmed && finalConfirmation && !status.toLowerCase().includes("saving");
  const latest = state.latest;

  function toggleStatement(key, checked) {
    setConfirmations((current) => ({ ...current, [key]: checked }));
  }

  async function submitDeclaration(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const payload = makeSuitabilityDeclarationPayload(person, confirmations, finalConfirmation);
    setStatus("Saving declaration...");
    try {
      let saved = {
        ...payload,
        id: `local-${Date.now()}`,
        staffRecordId: person.id,
        createdAt: new Date().toISOString(),
        source: "local",
      };
      if (hasSupabaseConfig && isUuid(person.id)) {
        const { saveStaffSuitabilityDeclaration } = await loadSupabaseModule();
        saved = await saveStaffSuitabilityDeclaration(person.id, payload);
      }
      onSaved?.(saved);
      setConfirmations(Object.fromEntries(suitabilityDeclarationStatements.map(([key]) => [key, false])));
      setFinalConfirmation(false);
      setStatus(hasSupabaseConfig ? "Declaration saved." : "Declaration saved locally. Supabase is not configured.");
      addAuditLog("Annual suitability declaration completed", `${person.name}: ${payload.declarationYear}`);
    } catch (error) {
      setStatus(`Could not save declaration: ${error.message || "Supabase rejected the declaration."}`);
    }
  }

  return (
    <section className="suitability-declaration-panel" id={`staff-profile-suitability-${person.id}`}>
      <div className={`suitability-status-card ${state.tone}`}>
        <div>
          <p className="eyebrow">Annual suitability declaration</p>
          <h4>{state.label}</h4>
          <p>{state.detail}</p>
        </div>
        <dl>
          <div><dt>Declaration year</dt><dd>{latest?.declarationYear || new Date().getFullYear()}</dd></div>
          <div><dt>Date completed</dt><dd>{latest?.dateCompleted ? formatShortDate(latest.dateCompleted) : "Not completed"}</dd></div>
          <div><dt>Staff member</dt><dd>{latest?.staffMemberName || person.name}</dd></div>
          <div><dt>Completed by / signed by</dt><dd>{latest?.signedBy || "Not signed"}</dd></div>
          <div><dt>Status</dt><dd>{state.status}</dd></div>
          <div><dt>Next due date</dt><dd>{state.nextDueDate ? formatShortDate(state.nextDueDate) : "Not set"}</dd></div>
        </dl>
      </div>
      {canComplete ? (
        <form className="suitability-declaration-form" onSubmit={submitDeclaration}>
          <div>
            <p className="eyebrow">Staff confirmation</p>
            <h4>Confirm ongoing suitability to work with children.</h4>
            <p>Work through the three sections, then submit the final declaration. Each submission is stored historically and does not overwrite previous records.</p>
          </div>
          <div className="suitability-progress-row">
            <strong>{confirmedCount}/{suitabilityDeclarationStatements.length} confirmed</strong>
            <span>{allStatementsConfirmed ? "Ready for final confirmation" : "Complete every statement before submitting"}</span>
          </div>
          <div className="suitability-checklist">
            {suitabilityDeclarationGroups.map((group) => {
              const groupConfirmed = group.keys.filter((key) => confirmations[key]).length;
              return (
                <fieldset key={group.title} className="suitability-check-group">
                  <legend>
                    <span>{group.title}</span>
                    <small>{groupConfirmed}/{group.keys.length}</small>
                  </legend>
                  <p>{group.detail}</p>
                  <div>
                    {group.keys.map((key) => (
                      <label key={key}>
                        <input type="checkbox" checked={Boolean(confirmations[key])} onChange={(event) => toggleStatement(key, event.target.checked)} />
                        <span>{suitabilityDeclarationStatementMap[key]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <label className="suitability-final-check">
            <input type="checkbox" checked={finalConfirmation} onChange={(event) => setFinalConfirmation(event.target.checked)} />
            <span>{suitabilityFinalDeclarationText}</span>
          </label>
          <div className="suitability-form-actions">
            <button className="button dark" type="submit" disabled={!canSubmit}>Submit annual declaration</button>
            <small>{status || (canSubmit ? "Ready to submit" : "Waiting for all confirmations")}</small>
          </div>
        </form>
      ) : (
        <div className="suitability-readonly-note">
          <strong>{showHistory ? "Admin view" : "Read only"}</strong>
          <span>{showHistory ? "Staff complete this themselves when logged in. Admin can view the full declaration history here." : "This declaration can be completed from the staff member’s own logged-in workspace."}</span>
        </div>
      )}
      {showHistory && (
        <div className="suitability-history">
          <div className="suitability-history-head">
            <h4>Previous declarations</h4>
            <Badge value={`${declarations.length} record${declarations.length === 1 ? "" : "s"}`} />
          </div>
          {declarations.length ? declarations.map((declaration) => {
            const declarationState = suitabilityDeclarationState({ suitabilityDeclarations: [declaration] });
            const confirmedCount = suitabilityDeclarationStatements.filter(([key]) => declaration.confirmations?.[key]).length;
            return (
              <article key={declaration.id || `${declaration.dateCompleted}-${declaration.signedBy}`}>
                <div>
                  <strong>{declaration.declarationYear || declaration.dateCompleted?.slice(0, 4) || "Year not recorded"} declaration</strong>
                  <span>Completed {declaration.dateCompleted ? formatShortDate(declaration.dateCompleted) : "date not recorded"} · signed by {declaration.signedBy || "not recorded"}</span>
                  <small>{confirmedCount}/{suitabilityDeclarationStatements.length} statements confirmed · next due {declaration.nextDueDate ? formatShortDate(declaration.nextDueDate) : "not set"}</small>
                </div>
                <Badge value={declarationState.label} />
              </article>
            );
          }) : <EmptyList title="No declarations yet" text="The staff member has not completed an annual suitability declaration." />}
        </div>
      )}
    </section>
  );
}

function normalizeStaffProfileNotes(note) {
  if (!note) return { manager: "", contract: "", compliance: "", payroll: "", updatedAt: "", source: "local" };
  if (typeof note === "string") return { manager: note, contract: "", compliance: "", payroll: "", updatedAt: "", source: "local" };
  return {
    manager: note.manager || "",
    contract: note.contract || "",
    compliance: note.compliance || "",
    payroll: note.payroll || "",
    updatedAt: note.updatedAt || "",
    source: note.source || "local",
  };
}

function chooseLatestStaffProfileNotes(localNote, liveNote) {
  const local = normalizeStaffProfileNotes(localNote);
  const live = normalizeStaffProfileNotes(liveNote);
  if (!liveNote) return local;
  if (!localNote) return live;
  const localTime = Date.parse(local.updatedAt || "") || 0;
  const liveTime = Date.parse(live.updatedAt || "") || 0;
  return liveTime > localTime ? live : local;
}

function staffHrFileBucket(file) {
  const category = `${file.category || ""} ${file.sensitivity || ""} ${file.title || ""}`.toLowerCase();
  if (category.includes("payslip") || category.includes("payroll")) return "Payslips";
  if (category.includes("contract")) return "Contracts";
  if (category.includes("training") || category.includes("certificate") || category.includes("qualification") || category.includes("safeguarding") || category.includes("first aid") || category.includes("allergy")) return "Training";
  if (category.includes("letter") || category.includes("communication")) return "Letters";
  if (category.includes("disciplinary") || category.includes("dbs") || category.includes("right to work") || category.includes("restricted")) return "Restricted";
  return "Other";
}

function staffPayslips(files = [], staffId) {
  return (files || [])
    .filter((file) => file.staffRecordId === staffId && staffHrFileBucket(file) === "Payslips" && file.status !== "archived")
    .sort((a, b) => String(b.issueDate || b.uploadedAt || "").localeCompare(String(a.issueDate || a.uploadedAt || "")));
}

function payslipPayRecord(payslips = []) {
  const candidates = (payslips || [])
    .filter((file) => file.payslipGrossPay != null && file.payslipNetPay != null)
    .sort((left, right) => {
      const leftSummary = /payment summary/i.test(String(left.title || "")) ? 1 : 0;
      const rightSummary = /payment summary/i.test(String(right.title || "")) ? 1 : 0;
      return leftSummary - rightSummary;
    });
  const file = candidates[0];
  if (!file) return null;
  return {
    gross: Number(file.payslipGrossPay),
    net: Number(file.payslipNetPay),
    processDate: file.payslipProcessDate || file.issueDate || "",
    fileId: file.id,
  };
}

function buildStaffProfileTimeline({ data = {}, person = {}, evidenceRequests = [], hrFiles = [] }) {
  const staffIds = new Set([person.id, person.profileId].filter(Boolean).map(String));
  const staffTokens = [person.name, person.fullName, person.email, person.id, person.profileId].filter(Boolean).map((item) => String(item).toLowerCase());
  const events = [];
  const pushEvent = (event) => {
    if (!event?.title) return;
    events.push({
      id: event.id || `${event.title}-${event.date || events.length}`,
      date: event.date || "",
      tone: event.tone || "neutral",
      detail: event.detail || "Activity recorded.",
      ...event,
    });
  };

  evidenceRequests.forEach((request) => {
    const history = request.history?.length ? request.history : [{
      id: `${request.id}-current`,
      type: request.status || "Requested",
      at: request.requestedAt,
      by: request.requestedBy || "Admin",
      note: request.note || "Evidence request active.",
    }];
    history.forEach((item) => pushEvent({
      id: `scr-${request.id}-${item.id || item.type}`,
      title: `${request.check} ${String(item.type || "updated").toLowerCase()}`,
      detail: [item.note, item.by ? `By ${item.by}` : ""].filter(Boolean).join(" · "),
      date: item.at || request.requestedAt,
      tone: request.status === "Rejected" || item.type === "Sent back" ? "alert" : request.status === "Approved" || item.type === "Approved" ? "ready" : "pending",
      actionType: "evidence",
      actionLabel: "Open evidence",
    }));
  });

  hrFiles.forEach((file) => pushEvent({
    id: `hr-file-${file.id}`,
    title: `${staffHrFileBucket(file)} file added`,
    detail: `${file.title}${file.category ? ` · ${file.category}` : ""}`,
    date: file.uploadedAt || file.issueDate,
    tone: staffHrFileBucket(file) === "Payslips" ? "pay" : staffHrFileBucket(file) === "Restricted" ? "alert" : "file",
    href: file.fileUrl || "",
    actionType: file.fileUrl ? "" : "hrFiles",
    actionLabel: file.fileUrl ? "Open file" : "Open files",
  }));

  Object.entries(data.payrollHours || {}).forEach(([period, schools]) => {
    Object.entries(schools || {}).forEach(([schoolName, record]) => {
      (record.rows || [])
        .filter((row) => staffIds.has(String(row.staffId)))
        .forEach((row) => pushEvent({
          id: `pay-hours-${period}-${schoolName}-${row.id || row.staffId}`,
          title: "Hours recorded",
          detail: `${formatPayrollPeriod(period)} · ${schoolName} · ${Number(row.hours || 0).toFixed(2)} hours`,
          date: record.updatedAt || record.submittedAt || `${period}-01`,
          tone: "pay",
          actionType: "pay",
          actionLabel: "Open pay",
        }));
    });
  });

  Object.entries(data.payrollRuns || {}).forEach(([period, run]) => {
    const adjustment = run.adjustments?.[person.id] || run.adjustments?.[person.profileId];
    if (!adjustment) return;
    pushEvent({
      id: `pay-adjustment-${period}-${person.id}`,
      title: "Payroll adjustment recorded",
      detail: `${formatPayrollPeriod(period)} · expenses ${formatCurrency(adjustment.expenses)} · deductions ${formatCurrency(adjustment.deductions)}${adjustment.note ? ` · ${adjustment.note}` : ""}`,
      date: run.updatedAt || `${period}-01`,
      tone: "pay",
      actionType: "pay",
      actionLabel: "Open pay",
    });
  });

  (data.documents || []).forEach((doc) => {
    (doc.assignments || [])
      .filter((assignment) => staffIds.has(String(assignment.staffRecordId)))
      .forEach((assignment) => {
        if (assignment.acknowledgedAt) {
          pushEvent({
            id: `doc-ack-${doc.id}-${assignment.id || person.id}`,
            title: "Policy acknowledged",
            detail: `${doc.name} · version ${doc.version || "current"}`,
            date: assignment.acknowledgedAt,
            tone: "ready",
          });
        } else if (assignment.dueAt) {
          pushEvent({
            id: `doc-due-${doc.id}-${assignment.id || person.id}`,
            title: "Policy assigned",
            detail: `${doc.name} · due ${formatShortDate(assignment.dueAt)}`,
            date: assignment.dueAt,
            tone: "pending",
          });
        }
      });
    (doc.chaseLog || [])
      .filter((event) => (event.recipientStaffRecordIds || []).map(String).some((id) => staffIds.has(id)))
      .forEach((event) => pushEvent({
        id: `doc-chase-${event.id}`,
        title: "Policy reminder sent",
        detail: `${doc.name} · ${event.channel || "manual"} chase`,
        date: event.createdAt,
        tone: "pending",
      }));
  });

  (data.payrollAudit || [])
    .filter((event) => {
      const metadataStaffIds = [event.metadata?.staffId, event.metadata?.staffRecordId].filter(Boolean).map(String);
      if (metadataStaffIds.some((id) => staffIds.has(id))) return true;
      const haystack = `${event.detail || ""} ${event.action || ""}`.toLowerCase();
      return staffTokens.some((token) => token && haystack.includes(token));
    })
    .forEach((event) => pushEvent({
      id: `pay-audit-${event.id}`,
      title: event.action || "Payroll updated",
      detail: `${event.period ? formatPayrollPeriod(event.period) : "Payroll"}${event.school ? ` · ${event.school}` : ""}${event.detail ? ` · ${event.detail}` : ""}`,
      date: event.createdAt,
      tone: "pay",
      actionType: "pay",
      actionLabel: "Open pay",
    }));

  readAuditLog()
    .filter((event) => {
      const haystack = `${event.action || ""} ${event.detail || ""}`.toLowerCase();
      return staffTokens.some((token) => token && haystack.includes(token));
    })
    .forEach((event) => pushEvent({
      id: `audit-${event.id}`,
      title: event.action || "Admin action",
      detail: event.detail || "Local admin action recorded.",
      date: event.createdAt,
      tone: "neutral",
    }));

  return events
    .filter((event) => event.date || event.title)
    .sort((a, b) => {
      const left = a.date ? new Date(a.date).getTime() : 0;
      const right = b.date ? new Date(b.date).getTime() : 0;
      return right - left;
    })
    .slice(0, 8);
}

function payslipPeriod(file) {
  const issuePeriod = String(file?.issueDate || "").match(/^(\d{4}-\d{2})/)?.[1];
  if (issuePeriod) return issuePeriod;
  const text = `${file?.title || ""} ${file?.notes || ""}`.toLowerCase();
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  const monthIndex = monthNames.findIndex((month) => text.includes(month));
  if (!year || monthIndex < 0) return "";
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function payslipMatchesPeriod(file, period) {
  return payslipPeriod(file) === period;
}

function staffScrOperationalSummary(person = {}) {
  const status = String(person.compliance || "").toLowerCase();
  const missing = [
    !hasValidDate(person.dbsRenewal) && "DBS",
    !hasValidDate(person.safeguardingExpiry) && "Safeguarding",
    !hasValidDate(person.allergyAwarenessExpiry) && "Allergy",
    !person.scrChecklist?.approvedAt && person.compliance !== "Compliant" && "Admin review",
  ].filter(Boolean);
  const label = status.includes("compliant")
    ? "Compliant"
    : status.includes("expiring")
      ? "Expiring soon"
      : status.includes("rejected")
        ? "Rejected"
        : status.includes("missing")
          ? "Missing"
          : "Review needed";
  return {
    status: label,
    nextAction: missing.length ? `Check ${missing.slice(0, 2).join(" / ")}${missing.length > 2 ? ` +${missing.length - 2}` : ""}` : "No immediate SCR action",
  };
}

function staffPayrollOperationalSummary(data = {}, person = {}) {
  const periods = Array.from(new Set([
    ...Object.keys(data.payrollHours || {}),
    ...Object.keys(data.payrollRuns || {}),
    ...(data.hrFiles || []).filter((file) => file.staffRecordId === person.id).map((file) => payslipPeriod(file)).filter(Boolean),
  ])).filter(Boolean).sort().reverse();
  const latestPeriod = periods.find((period) => {
    const periodRecords = data.payrollHours?.[period] || {};
    const hasHours = Object.values(periodRecords).some((record) => (record.rows || []).some((row) => row.staffId === person.id || row.staffId === person.profileId));
    const hasAdjustment = Boolean(data.payrollRuns?.[period]?.adjustments?.[person.id]);
    const hasPayslip = (data.hrFiles || []).some((file) => file.staffRecordId === person.id && payslipMatchesPeriod(file, period));
    return hasHours || hasAdjustment || hasPayslip || Number(person.annualSalary || 0) > 0;
  }) || "";
  const periodRecords = latestPeriod ? (data.payrollHours?.[latestPeriod] || {}) : {};
  const payrollEntries = Object.entries(periodRecords).flatMap(([schoolName, record]) => (record.rows || [])
    .filter((row) => row.staffId === person.id || row.staffId === person.profileId)
    .map((row) => ({ ...row, schoolName })));
  const hours = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const hourlyGross = payrollEntries.reduce((sum, row) => sum + Number(row.hours || 0) * Number(row.rate ?? person.payRate ?? 0), 0);
  const monthlySalary = monthlySalaryFromAnnual(person.annualSalary);
  const latestPayslips = (data.hrFiles || []).filter((file) => file.staffRecordId === person.id && payslipMatchesPeriod(file, latestPeriod));
  const latestPayslipPay = payslipPayRecord(latestPayslips);
  const latestGross = latestPayslipPay ? latestPayslipPay.gross : latestPeriod ? monthlySalary + hourlyGross : monthlySalary;
  const basis = person.annualSalary
    ? `${formatCurrency(monthlySalary)}/mo salary`
    : person.payRate
      ? `${formatCurrency(person.payRate)}/hr`
      : latestPayslipPay
        ? "Payslip record"
        : "Not recorded";
  return { latestPeriod, hours, latestGross, basis };
}

function buildStaffHrFileTabs(files) {
  const baseTabs = ["All", "Contracts", "Training", "Payslips", "Letters", "Restricted", "Other"];
  const counts = files.reduce((acc, file) => {
    const bucket = staffHrFileBucket(file);
    acc.All += 1;
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, { All: 0, Contracts: 0, Payslips: 0, Letters: 0, Restricted: 0, Other: 0 });
  return baseTabs
    .filter((name) => name === "All" || counts[name] > 0)
    .map((name) => ({ name, count: counts[name] || 0 }));
}

function SessionList({ personal, detailed, data = mockPlatformData }) {
  return <div className="list">{data.sessions.slice(0, personal ? 2 : 3).map((session) => (
    <article key={session.id || session.site + session.time} className="list-item">
      <div><strong>{session.programme}</strong><span>{session.site} · {session.date} · {session.time}</span>{detailed && <small>Required: safeguarding policy read, site induction complete, first aider on rota.</small>}</div>
      <Badge value={session.status} />
    </article>
  ))}</div>;
}

function EnquiryList({ detailed, data = mockPlatformData }) {
  const local = getLocalEnquiries();
  const combined = mergeCrmRecords(data.enquiries, readCrmUpdates(), local);
  if (!combined.length) return <EmptyList title="No enquiries yet" text="New website enquiries will appear here for follow-up." />;
  return <div className="list">{combined.map((enquiry, index) => (
    <article key={enquiry.id || `${enquiry.name}-${index}`} className="list-item">
      <div><strong>{enquiry.name}</strong><span>{enquiry.type} · {enquiry.organisation || "No organisation"} · {enquiry.subject || enquiry.message}</span>{detailed && <small>Owner: {enquiry.owner || "Unassigned"} · Next action: {enquiry.nextAction || "call/email follow-up"}</small>}</div>
      <Badge value={enquiry.status || "New"} />
    </article>
  ))}</div>;
}

function CrmCard({ record, onChange }) {
  const isOutreach = record.type === "Outreach";
  return (
    <article className="crm-card">
      <div className="crm-card-head">
        <div>
          <span>{record.type}</span>
          <h3>{record.name}</h3>
          <p>{isOutreach ? [record.area, record.location, record.contactType].filter(Boolean).join(" · ") : record.organisation || "No organisation"}</p>
        </div>
        <Badge value={record.status || "New"} />
      </div>
      {isOutreach && <p><strong>{record.contactEmail || "No email recorded"}</strong>{record.dateContacted ? ` · Contacted ${record.dateContacted}` : ""}{record.followUpDate ? ` · Follow up ${record.followUpDate}` : ""}</p>}
      <p>{record.subject || record.message || "No message summary provided."}</p>
      <small className={`crm-sync ${record.syncState || "local"}`}>{crmSyncText(record)}</small>
      <div className="crm-controls">
        <label>Status<select value={record.status || "New"} onChange={(event) => onChange(record.id, { status: event.target.value })}>{crmStatuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Owner<select value={record.owner || "Unassigned"} onChange={(event) => onChange(record.id, { owner: event.target.value })}>{crmOwners.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      {isOutreach && (
        <div className="crm-controls">
          <label>Date contacted<input type="date" value={record.dateContacted || ""} onChange={(event) => onChange(record.id, { dateContacted: event.target.value })} /></label>
          <label>Follow-up date<input type="date" value={record.followUpDate || ""} onChange={(event) => onChange(record.id, { followUpDate: event.target.value })} /></label>
        </div>
      )}
      <label>Follow-up note<textarea rows="3" value={record.note || ""} onChange={(event) => onChange(record.id, { note: event.target.value })} placeholder="Add call notes, next steps or context." /></label>
      <label>Next action<input value={record.nextAction || ""} onChange={(event) => onChange(record.id, { nextAction: event.target.value })} placeholder="Call parent, email school, review CV..." /></label>
    </article>
  );
}

function RewardList({ admin, data = mockPlatformData }) {
  return <div className="reward-grid">{data.rewards.map((reward) => (
    <article key={reward.title}>
      <Star />
      <h3>{reward.title}</h3>
      <p>{reward.note}</p>
      <span>{reward.awarded}{admin ? " · Awarded by Admin" : ""}</span>
    </article>
  ))}</div>;
}

function ActionList({ items }) {
  return <div className="list">{items.map((item) => <article key={item} className="list-item"><div><strong>{item}</strong><span>Due soon</span></div><ChevronRight /></article>)}</div>;
}

function Progress({ value, label }) {
  return <div className="progress"><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /><small>{label}</small></div>;
}

function EmptyList({ title, text }) {
  return <article className="empty-list"><strong>{title}</strong><span>{text}</span></article>;
}

function mergeCrmRecords(demoRecords, updates, localRecords = getLocalEnquiries()) {
  const taggedLocal = localRecords.map((record) => ({ ...record, source: record.source || "local" }));
  const taggedDemo = demoRecords.map((record) => ({ ...record, source: record.source || "demo" }));
  const records = [...taggedLocal, ...taggedDemo].map((record, index) => {
    const id = record.id || record.createdAt || `${record.name || "enquiry"}-${record.email || "unknown"}-${index}`;
    return {
      ...record,
      id,
      status: record.status || "New",
      owner: "Unassigned",
      nextAction: "call/email follow-up",
      ...updates[id],
    };
  });
  return records;
}

function isWebsiteEnquiryRecord(record) {
  return record?.type !== "Outreach" && ["supabase", "local", "demo"].includes(record?.source || "demo");
}

function isSupabaseCrmRecord(id, record) {
  return hasSupabaseConfig && record?.source === "supabase" && /^[0-9a-f-]{36}$/i.test(String(id));
}

function crmSyncText(record) {
  if (record.syncState === "saving") return "Saving to Supabase...";
  if (record.syncState === "saved") return "Saved to Supabase";
  if (record.syncState === "error") return record.syncError || "Supabase save failed";
  if (record.source === "supabase") return "Live Supabase record";
  return "Local demo workflow";
}

function readCrmUpdates() {
  try {
    return JSON.parse(localStorage.getItem(crmStorageKey) || "{}");
  } catch {
    return {};
  }
}

function saveCrmUpdates(updates) {
  localStorage.setItem(crmStorageKey, JSON.stringify(updates));
}

function readOnboardedStaffProfiles() {
  return readJson(onboardedStaffStorageKey, []);
}

function saveOnboardedStaffProfile(profile) {
  const existing = readOnboardedStaffProfiles();
  const next = [profile, ...existing.filter((person) => person.id !== profile.id)];
  localStorage.setItem(onboardedStaffStorageKey, JSON.stringify(next));
}

function approveOnboardedStaffProfile(staffId) {
  const next = readOnboardedStaffProfiles().map((person) => (
    person.id === staffId
      ? {
          ...person,
          compliance: "Compliant",
          onboardingStatus: "SCR approved",
          dbsRenewal: person.dbsRenewal === "Pending" ? "Verified" : person.dbsRenewal,
          safeguardingExpiry: person.safeguardingExpiry === "Pending" ? "Verified" : person.safeguardingExpiry,
          allergyAwarenessExpiry: person.allergyAwarenessExpiry === "Pending" ? "Verified" : person.allergyAwarenessExpiry,
          approvedAt: new Date().toISOString(),
        }
      : person
  ));
  localStorage.setItem(onboardedStaffStorageKey, JSON.stringify(next));
}

function readScrChecklistState() {
  return readJson(scrChecklistStorageKey, {});
}

function saveScrChecklistState(next) {
  localStorage.setItem(scrChecklistStorageKey, JSON.stringify(next));
}

function persistScrChecklistRecord(staffId, checklist, action = "SCR checklist synced") {
  if (!hasSupabaseConfig || !isUuid(staffId)) return;
  loadSupabaseModule()
    .then(({ saveScrChecklist }) => saveScrChecklist(staffId, checklist))
    .then(() => addAuditLog(action, `${staffId}: saved to Supabase`))
    .catch((error) => {
      console.warn("Unable to save SCR checklist", error);
      addAuditLog("SCR checklist Supabase save failed", `${staffId}: ${error.message || "Supabase rejected the update"}`);
    });
}

function persistScrEvidenceRequestRecord(id, staffId, evidenceKey, request, action = "SCR evidence request synced") {
  if (!hasSupabaseConfig || !isUuid(staffId)) return;
  loadSupabaseModule()
    .then(({ saveScrEvidenceRequest }) => saveScrEvidenceRequest({ id, staffRecordId: staffId, evidenceKey, request }))
    .then(() => addAuditLog(action, `${id}: saved to Supabase`))
    .catch((error) => {
      console.warn("Unable to save SCR evidence request", error);
      addAuditLog("SCR evidence request Supabase save failed", `${id}: ${error.message || "Supabase rejected the update"}`);
    });
}

function buildPreviewUsers(data, viewRole) {
  const users = mergeUserRecords(data.staff, readUserAdminState());
  const seen = new Set();
  return users
    .filter((user) => {
      if (!user?.id || seen.has(user.id)) return false;
      seen.add(user.id);
      if (viewRole === "Manager") return user.role === "Manager" || /manager|director/i.test(user.staffRole || "");
      if (viewRole === "Staff") return user.source === "staff record";
      return true;
    })
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function buildAccessContext(role, userEmail, data, previewUserId = "") {
  const users = mergeUserRecords(data.staff, readUserAdminState());
  const hierarchy = readHierarchyState();
  const currentUser = users.find((user) => user.id === previewUserId) || users.find((user) => user.email === userEmail) || users.find((user) => user.role === role) || users[0];
  const isScoped = role === "Manager";
  const isStaffScoped = role === "Staff";
  const directReports = isScoped
    ? users.filter((user) => (hierarchy[user.id]?.reportsTo ?? defaultReportsTo(user, users)) === currentUser?.id)
    : isStaffScoped
      ? [currentUser].filter(Boolean)
    : users;
  const directIds = new Set(directReports.map((user) => user.id));
  const directNames = new Set(directReports.map((user) => user.name));
  const scopedStaff = isScoped || isStaffScoped ? data.staff.filter((person) => directIds.has(person.profileId || person.id)) : data.staff;
  const scopedSessions = isScoped || isStaffScoped
    ? data.sessions.filter((session) => directNames.has(session.staff) || scopedStaff.some((person) => staffAssignedToSchool(person, session.site)))
    : data.sessions;
  return {
    role,
    currentUser,
    isScoped,
    isStaffScoped,
    directReports,
    directIds,
    directNames,
    data: {
      ...data,
      staff: scopedStaff,
      sessions: scopedSessions,
    },
  };
}

function mergeUserRecords(staffRecords, state) {
  const base = staffRecords.map((person, index) => {
    const email = person.email || `${String(person.name || `staff-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")}@apres-school.local`;
    const defaultRole = person.accessRole || (person.role?.toLowerCase().includes("manager") ? "Manager" : "Staff");
    const id = person.profileId || person.id;
    const saved = state[id] || {};
    return {
      id,
      staffRecordId: person.id,
      name: person.name,
      staffRole: person.role || person.jobRole || "",
      status: "Active",
      source: "staff record",
      ...saved,
      email: isRealStaffEmail(person.email) ? person.email : (saved.email || email),
      role: defaultRole || saved.role || "Staff",
    };
  });
  const invited = Object.values(state).filter((user) => user.source === "local invite" || user.source === "approved onboarding");
  return [...invited, ...base];
}

function buildAccountRolloutRows(staffOptions, users) {
  return staffOptions.map((person) => {
    const user = users.find((item) => item.id === person.id) || {};
    const email = user.email || person.email || "";
    return {
      ...person,
      ...user,
      id: person.id,
      staffRecordId: person.staffRecordId || user.staffRecordId || person.id,
      email,
      role: user.role || person.role || "Staff",
      status: user.status || person.status || "Active",
      readiness: isRealStaffEmail(email) ? "Ready" : "Missing email",
      emailStatus: user.emailStatus || "",
      temporaryPassword: user.temporaryPassword || "",
    };
  });
}

function isRealStaffEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  return value.includes("@") && !value.endsWith("@apres-school.local");
}

async function copyTemporaryPassword(password, staffName) {
  if (!password || typeof navigator === "undefined" || !navigator.clipboard) return;
  await navigator.clipboard.writeText(password);
  addAuditLog("Temporary password copied", `${staffName || "Staff"} temporary password copied by admin`);
}

async function copyLoginDetails(user) {
  if (!user?.temporaryPassword || typeof navigator === "undefined" || !navigator.clipboard) return;
  const message = [
    `Après School staff login`,
    `Link: ${window.location.origin}/staff-login`,
    `Email: ${user.email}`,
    `Temporary password: ${user.temporaryPassword}`,
    "",
    "Please log in and change your password when prompted.",
  ].join("\n");
  await navigator.clipboard.writeText(message);
  addAuditLog("Staff login details copied", `${user.name || user.email || "Staff"} login details copied by admin`);
}

function readUserAdminState() {
  try {
    return JSON.parse(localStorage.getItem(userStorageKey) || "{}");
  } catch {
    return {};
  }
}

function readHierarchyState() {
  return readJson(hierarchyStorageKey, {});
}

function readPublicSettings() {
  return { campAnnouncementEnabled: true, ...readJson(publicSettingsStorageKey, {}) };
}

function addMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return dateInputValue(date);
}

function addYears(dateString, years) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setFullYear(date.getFullYear() + years);
  return dateInputValue(date);
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * alphabet.length);
  }
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${body}!7Aa`;
}

function daysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function normaliseSuitabilityDeclarations(person = {}) {
  return (person.suitabilityDeclarations || [])
    .filter(Boolean)
    .sort((a, b) => String(b.dateCompleted || b.createdAt || "").localeCompare(String(a.dateCompleted || a.createdAt || "")));
}

function latestSuitabilityDeclaration(person = {}) {
  return normaliseSuitabilityDeclarations(person)[0] || null;
}

function suitabilityDeclarationState(person = {}) {
  const latest = latestSuitabilityDeclaration(person);
  if (!latest) {
    return {
      label: "Missing",
      status: "Not Started",
      tone: "alert",
      nextDueDate: "",
      daysUntilDue: null,
      detail: "No annual suitability declaration has been completed.",
    };
  }
  const nextDueDate = latest.nextDueDate || (latest.dateCompleted ? addMonths(latest.dateCompleted, 12) : "");
  const remaining = nextDueDate ? daysUntil(nextDueDate) : null;
  if (remaining !== null && remaining < 0) {
    return {
      label: "Expired",
      status: "Expired",
      tone: "alert",
      nextDueDate,
      daysUntilDue: remaining,
      detail: `Expired ${formatShortDate(nextDueDate)}.`,
      latest,
    };
  }
  if (remaining !== null && remaining <= 30) {
    return {
      label: "Due within 30 days",
      status: "Completed",
      tone: "pending",
      nextDueDate,
      daysUntilDue: remaining,
      detail: `Due ${formatShortDate(nextDueDate)}.`,
      latest,
    };
  }
  return {
    label: "Current",
    status: "Completed",
    tone: "ready",
    nextDueDate,
    daysUntilDue: remaining,
    detail: nextDueDate ? `Next due ${formatShortDate(nextDueDate)}.` : "Current declaration recorded.",
    latest,
  };
}

function buildSuitabilityDeclarationCounts(staff = []) {
  return staff.reduce((counts, person) => {
    const state = suitabilityDeclarationState(person);
    if (state.label === "Current") counts.current += 1;
    else if (state.label === "Due within 30 days") counts.dueSoon += 1;
    else if (state.label === "Expired") counts.expired += 1;
    else counts.missing += 1;
    return counts;
  }, { current: 0, dueSoon: 0, expired: 0, missing: 0 });
}

function makeSuitabilityDeclarationPayload(person, confirmations, finalConfirmation) {
  const today = dateInputValue(new Date());
  return {
    declarationYear: Number(today.slice(0, 4)),
    dateCompleted: today,
    staffMemberName: person.name || person.fullName || "Staff member",
    signedBy: person.name || person.fullName || "Staff member",
    status: "Completed",
    nextDueDate: addMonths(today, 12),
    confirmations,
    finalConfirmation,
  };
}

function scheduledInspectionForSite(site) {
  const scheduledInspections = {};
  const inspection = scheduledInspections[site.id];
  if (!inspection) return null;
  return {
    ...inspection,
    daysUntil: Math.max(0, daysUntil(inspection.date)),
  };
}

function calculateOfstedInspectionWindow(site) {
  const inspected = Boolean(site.lastInspectionDate);
  const dueBy = inspected ? addYears(site.lastInspectionDate, 6) : addMonths(site.registrationDate, 30);
  const prepWindowOpen = addMonths(dueBy, -12);
  const daysToPrep = daysUntil(prepWindowOpen);
  const daysToDue = daysUntil(dueBy);
  if (daysToDue < 0) {
    return {
      dueBy,
      prepWindowOpen,
      status: "Overdue",
      tone: "bad",
      primaryNumber: Math.abs(daysToDue),
      primaryLabel: "days overdue",
      summary: `${site.school} is past the expected Ofsted inspection deadline. Prepare the site pack immediately.`,
    };
  }
  if (daysToPrep <= 0) {
    return {
      dueBy,
      prepWindowOpen,
      status: "In window",
      tone: "warn",
      primaryNumber: daysToDue,
      primaryLabel: "days until due-by date",
      summary: inspected
        ? `${site.school} is in the 12-month preparation window. Keep site evidence inspection-ready.`
        : `${site.school} is in the first-inspection preparation window. Keep site evidence inspection-ready before the expected due-by date.`,
    };
  }
  return {
    dueBy,
    prepWindowOpen,
    status: inspected ? "Monitored" : "Awaiting first inspection",
    tone: "good",
    primaryNumber: daysToPrep,
    primaryLabel: "days until prep window",
    summary: inspected
      ? `Next expected inspection is calculated from the last inspection date, with a 12-month preparation window before the due-by date.`
      : `First inspection timing is calculated from registration, with a 12-month preparation window before the expected due-by date.`,
  };
}

function buildOfstedReadinessRows(site, staff, documents, timing, siteRota, siteLogs = []) {
  const hasFirstAider = staff.some((person) => staffMeetsRequirement(person, "firstAid"));
  const hasEyfs = staff.some((person) => staffMeetsRequirement(person, "eyfs"));
  const hasSafeguarding = staff.some((person) => staffMeetsRequirement(person, "safeguarding"));
  const hasAllergy = staff.some((person) => staffMeetsRequirement(person, "allergy"));
  const policyCount = documents.length;
  const openLogCount = siteLogs.filter((log) => log.status !== "Closed").length;
  const nilReturnCount = siteLogs.filter((log) => log.type === "Nil return").length;
  return [
    {
      area: "Registration and inspection window",
      status: timing.status === "Overdue" ? "Missing" : "Ready",
      evidence: `${site.urn} · registered ${formatShortDate(site.registrationDate)} · due by ${formatShortDate(timing.dueBy)}`,
      nextAction: timing.status === "Overdue" ? "Escalate site readiness review." : "Keep dates under review.",
    },
    {
      area: "Site staff assigned",
      status: staff.length ? "Ready" : "Missing",
      evidence: staff.length ? staff.map((person) => person.name).join(", ") : "No staff assigned to this site in SCR.",
      nextAction: staff.length ? "Check each staff member remains current." : "Assign site staff before inspection pack is complete.",
    },
    {
      area: "First aid and EYFS cover",
      status: hasFirstAider && hasEyfs ? "Ready" : "Missing",
      evidence: `First aider: ${hasFirstAider ? "covered" : "gap"} · EYFS Level 3+: ${hasEyfs ? "covered" : "gap"}`,
      nextAction: hasFirstAider && hasEyfs ? "Confirm rota cover for inspection day." : "Assign qualified staff and update training evidence.",
    },
    {
      area: "Safeguarding and allergy training",
      status: hasSafeguarding && hasAllergy ? "Ready" : "Missing",
      evidence: `Safeguarding: ${hasSafeguarding ? "covered" : "gap"} · Allergy: ${hasAllergy ? "covered" : "gap"}`,
      nextAction: hasSafeguarding && hasAllergy ? "Keep certificates current." : "Request missing training evidence from assigned staff.",
    },
    {
      area: "Policies and acknowledgements",
      status: policyCount ? "Ready" : "Missing",
      evidence: `${policyCount} documents in library`,
      nextAction: policyCount ? "Check safeguarding, complaints, behaviour and health/safety are current." : "Upload required policy documents.",
    },
    {
      area: "Site rota and sessions",
      status: siteRota.length ? "Ready" : "Missing",
      evidence: siteRota.length ? siteRota.map((item) => `${item.type} ${item.sessionStart}-${item.sessionEnd}`).join("; ") : "No rota site configured.",
      nextAction: siteRota.length ? "Confirm staffing, timings and handover routines." : "Add site rota details.",
    },
    {
      area: "Logs: complaints, accidents, safeguarding",
      status: openLogCount ? "Pending" : "Ready",
      evidence: siteLogs.length ? `${siteLogs.length} site log entries · ${nilReturnCount} nil return${nilReturnCount === 1 ? "" : "s"} · ${openLogCount} open` : "No site log entries recorded",
      nextAction: openLogCount ? "Review open site log entries before inspection pack is marked ready." : "Keep log current and record nil returns where appropriate.",
    },
  ];
}

function suggestOfstedOwner(area) {
  if (area.includes("Registration")) return "Operations lead";
  if (area.includes("staff") || area.includes("First aid") || area.includes("Safeguarding")) return "HR / compliance";
  if (area.includes("Policies")) return "Admin / DSL";
  if (area.includes("rota") || area.includes("sessions")) return "Rota lead";
  if (area.includes("Logs")) return "DSL / site lead";
  return "Admin";
}

function buildOfstedOwnerOptions(staff) {
  const staffOptions = staff.map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role || "Staff",
    rank: person.role?.toLowerCase().includes("manager") || person.role?.toLowerCase().includes("lead") ? 0 : 1,
  }));
  const adminOptions = [
    { id: "ops-lead", name: "Operations Lead", role: "Admin", rank: 0 },
    { id: "dsl", name: "Designated Safeguarding Lead", role: "DSL", rank: 0 },
  ];
  return [...adminOptions, ...staffOptions]
    .filter((person, index, items) => items.findIndex((item) => item.name === person.name) === index)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

function defaultReportsTo(user, users) {
  if (!user) return "";
  if (["Manager", "Admin", "Superadmin"].includes(user.role)) return "";
  const defaultManager = users.find((person) => person.id !== user.id && ["Manager", "Admin", "Superadmin"].includes(person.role));
  return defaultManager?.id || "";
}

function emailForName(name) {
  return `${String(name || "staff").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")}@apres-school.local`;
}

function updateCoverMove(id, patch, setMoves) {
  const current = readJson(coverMoveStorageKey, []);
  const next = current.map((move) => (move.id === id ? { ...move, ...patch } : move));
  localStorage.setItem(coverMoveStorageKey, JSON.stringify(next));
  setMoves(next);
}

function inferAuditMetadata(action, detail = "") {
  const text = `${action || ""} ${detail || ""}`;
  const lower = text.toLowerCase();
  const metadata = {};
  if (lower.includes("invoice") || lower.includes("credit note") || lower.includes("finance customer") || lower.includes("bacs payment")) {
    metadata.module = "Finance";
    metadata.tableName = "finance_invoices";
  } else if (lower.includes("pay") || lower.includes("payslip") || lower.includes("hours")) {
    metadata.module = "Payroll";
    metadata.tableName = "payroll_runs";
  } else if (lower.includes("scr") || lower.includes("evidence")) {
    metadata.module = "SCR";
    metadata.tableName = "scr_checks";
  } else if (lower.includes("hr") || lower.includes("former staff") || lower.includes("staff photo") || lower.includes("profile notes")) {
    metadata.module = "HR";
    metadata.tableName = "staff_records";
  } else if (lower.includes("user") || lower.includes("password") || lower.includes("account") || lower.includes("invite")) {
    metadata.module = "Users";
    metadata.tableName = "profiles";
  } else if (lower.includes("rota") || lower.includes("cover")) {
    metadata.module = "Rota";
    metadata.tableName = lower.includes("cover") ? "cover_moves" : "rota_requirements";
  } else if (lower.includes("crm") || lower.includes("enquiry")) {
    metadata.module = "CRM";
    metadata.tableName = "enquiries";
  } else if (lower.includes("ofsted")) {
    metadata.module = "Ofsted";
    metadata.tableName = "ofsted_logs";
  } else if (lower.includes("document") || lower.includes("policy")) {
    metadata.module = "Documents";
    metadata.tableName = "document_versions";
  } else if (lower.includes("settings") || lower.includes("public")) {
    metadata.module = "Settings";
    metadata.tableName = "platform_settings";
  } else {
    metadata.module = "General";
  }

  const periodMatch = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b|\b20\d{2}-\d{2}\b/i);
  if (periodMatch) metadata.payrollPeriod = periodMatch[0];
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) metadata.email = emailMatch[0].toLowerCase();

  const rawSubject = String(detail || "").split(":")[0]?.trim();
  const subject = rawSubject?.includes("·") ? rawSubject.split("·").map((part) => part.trim()).filter(Boolean).at(-1) : rawSubject;
  if (subject && subject.length <= 80 && /[A-Za-z]/.test(subject)) metadata.subject = subject;

  const siteNames = ["Willington Prep", "King's House School", "Shrewsbury House School", "Ripley Court", "The Rowans"];
  const site = siteNames.find((name) => lower.includes(name.toLowerCase()));
  if (site) metadata.site = site;
  if (/staff|hr|scr|user|password|invite|payslip/i.test(action || "") && metadata.subject) metadata.staffName = metadata.subject;
  if (/document|policy/i.test(action || "") && metadata.subject) metadata.documentName = metadata.subject;
  if (/crm|enquiry/i.test(action || "") && metadata.subject) metadata.crmRecord = metadata.subject;
  return metadata;
}

function addAuditLog(action, detail) {
  const items = readAuditLog();
  const metadata = inferAuditMetadata(action, detail);
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    detail,
    metadata,
    tableName: metadata.tableName || "",
    source: "Local",
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(auditStorageKey, JSON.stringify([entry, ...items].slice(0, 80)));
  if (!hasSupabaseConfig) return;
  loadSupabaseModule()
    .then(({ createAuditLogEntry }) => createAuditLogEntry({
      action,
      detail,
      tableName: metadata.tableName || null,
      metadata: {
        ...metadata,
        localAuditId: entry.id,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      },
    }))
    .catch(() => {
      // Local audit is the fallback; avoid recursive audit logging on audit-write failures.
    });
}

function readAuditLog() {
  const items = readJson(auditStorageKey, []);
  return Array.isArray(items) ? items : [];
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function durationMinutes(start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const normalised = (total + 1440) % 1440;
  const nextHour = Math.floor(normalised / 60);
  const nextMinute = normalised % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function Metric({ icon, label, value, tone }) {
  return <article className={`metric ${tone}`}><div>{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function TableWrap({ children }) {
  return <div className="table-wrap">{children}</div>;
}

function DashboardGrid({ children, className = "" }) {
  return <div className={`dashboard-grid ${className}`.trim()}>{children}</div>;
}


function Badge({ value }) {
  const className = value.toLowerCase().includes("gap") || value.toLowerCase().includes("missing") || value.toLowerCase().includes("alert") || value.toLowerCase().includes("rejected") || value.toLowerCase().includes("overdue") || value.toLowerCase().includes("failed") ? "bad" : value.toLowerCase().includes("soon") || value.toLowerCase().includes("chase") || value.toLowerCase().includes("pending") ? "warn" : "good";
  return <span className={`badge ${className}`}>{value}</span>;
}


function iconFor(item) {
  const map = {
    Staff: <LayoutDashboard />,
    Admin: <LockKeyhole />,
    SCR: <ShieldCheck />,
    Ofsted: <ShieldCheck />,
    Documents: <FileText />,
    Pay: <PoundSterling />,
    Finance: <PoundSterling />,
    "Booking Payments": <PoundSterling />,
    Rewards: <Award />,
    Sessions: <Clock />,
    Rota: <CalendarDays />,
    Hours: <Clock />,
    Bookings: <BookOpen />,
    Registers: <ClipboardCheck />,
    Incidents: <Bell />,
    CRM: <Mail />,
    "Customer Profiles": <Users />,
    Users: <Users />,
    HR: <Users />,
    "HR Files": <FileText />,
    Schools: <LayoutDashboard />,
    Audit: <FileText />,
    Settings: <ShieldCheck />,
  };
  return map[item];
}

const scrCopy = {
  "Personal Info": "Name, preferred name, DOB, address, contact details, emergency contact, role, employment type, start date and NI number.",
  "Right to Work": "Document type, expiry, evidence upload, confirmation and admin verification status.",
  "Identity Checks": "Identity and proof-of-address verification, date checked and checked-by audit trail.",
  DBS: "Enhanced DBS number, date, result, update service, barred list, original certificate seen, renewal and uploaded evidence.",
  Safeguarding: "Required for all staff: course provider, completion date, expiry where applicable, KCSIE Part One, company policy acknowledgement and certificate upload.",
  "Allergy Awareness": "Required for all staff: completion date, provider, certificate evidence and expiry tracking where the certificate or provider specifies one.",
  "First Aid": "Qualification type, provider, dates and certificate, tracked by role or location requirement rather than globally mandatory.",
  "Annual Declarations": "Medical fitness, criminal declaration, reconfirmation due dates, digital confirmation and automatic timer reset.",
  "Recruitment Checks": "CV review, employment gaps, references, overseas checks, qualifications, disqualification and prohibition checks.",
  "Admin Review": "Compliant, expiring, missing or rejected status, internal notes, evidence requests, PDF exports and assurance letters.",
};


export default Platform;
