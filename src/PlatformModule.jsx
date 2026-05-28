import { useEffect, useRef, useState } from "react";

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
const X = makeIcon("X");


const platformTabs = ["Staff", "Admin", "Users", "HR", "HR Files", "Schools", "Rota", "Hours", "SCR", "Ofsted", "Documents", "Pay", "Rewards", "Sessions", "CRM", "Audit", "Settings"];
const platformGroups = [
  ["Today", ["Admin", "Staff"]],
  ["People", ["Users", "SCR", "HR", "HR Files"]],
  ["Sites", ["Schools", "Rota", "Hours", "Sessions", "Ofsted"]],
  ["Comms", ["Documents", "CRM"]],
  ["Finance", ["Pay", "Rewards"]],
  ["System", ["Audit", "Settings"]],
];
const platformTabHints = {
  Staff: "Personal shifts, documents, pay and rewards",
  Admin: "Key actions across staffing, compliance and bookings",
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

function currentPayrollPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function formatPayrollPeriod(period) {
  if (!period) return "Current month";
  const [year, month] = String(period).split("-");
  if (!year || !month) return period;
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
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
  if (Array.isArray(person?.siteAssignments) && person.siteAssignments.length) return person.siteAssignments;
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
  if (!value || ["pending", "not required"].includes(String(value).toLowerCase())) return false;
  return true;
}

function staffMeetsRequirement(person, requirement) {
  if (requirement === "firstAid") return hasValidDate(person.firstAidExpiry);
  if (requirement === "eyfs") return String(person.eyfsLevel || person.role || "").toLowerCase().includes("level 3") || String(person.role || "").toLowerCase().includes("manager");
  if (requirement === "safeguarding") return hasValidDate(person.safeguardingExpiry);
  if (requirement === "allergy") return hasValidDate(person.allergyAwarenessExpiry);
  return false;
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
  ["rightToWork", "Right to work"],
  ["identity", "Identity / address"],
  ["barredList", "Barred list"],
  ["references", "References"],
  ["declarations", "Annual declarations"],
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
  const [viewRole, setViewRole] = useState(role);
  const [previewUserId, setPreviewUserId] = useState("");
  const [staffPayOverrides, setStaffPayOverrides] = useState(() => readJson(staffPayOverridesStorageKey, {}));
  const [staffSiteOverrides, setStaffSiteOverrides] = useState(() => readJson(staffSiteOverridesStorageKey, {}));
  const [formerStaffRecords, setFormerStaffRecords] = useState(() => readJson(formerStaffStorageKey, {}));
  const localStaff = readOnboardedStaffProfiles();
  const canPreviewRoles = ["Admin", "Superadmin"].includes(role);
  const effectiveRole = canPreviewRoles ? viewRole : role;
  const mergedStaff = mergeStaffProfiles(data.staff, localStaff).map((person) => {
    const localFormerRecord = formerStaffRecords[person.id] || formerStaffRecords[person.profileId];
    return {
      ...person,
      ...(staffPayOverrides[person.id] || {}),
      ...(staffSiteOverrides[person.id]
        ? {
            location: staffSiteOverrides[person.id].location,
            siteAssignments: [{ school: staffSiteOverrides[person.id].location, role: person.role, startDate: person.startDate || "", endDate: "", status: "Active" }],
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
    ? ["Staff", "Documents", "Pay", "Rewards", "Sessions"]
    : effectiveRole === "Manager"
      ? ["Staff", "Rota", "SCR", "Ofsted", "Documents", "Sessions"]
      : platformTabs;
  const visibleGroups = platformGroups
    .map(([group, items]) => [group, items.filter((item) => visibleTabs.includes(item))])
    .filter(([, items]) => items.length);

  useEffect(() => {
    setViewRole(role);
    setPreviewUserId("");
  }, [role]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] || "Staff");
  }, [setTab, tab, visibleTabs]);

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
    const next = {
      ...staffSiteOverrides,
      [staffId]: {
        location,
        updatedAt: new Date().toISOString(),
      },
    };
    setStaffSiteOverrides(next);
    localStorage.setItem(staffSiteOverridesStorageKey, JSON.stringify(next));
    if (!hasSupabaseConfig || !isUuid(staffId)) return;
    loadSupabaseModule()
      .then(({ updateStaffSiteDetails }) => updateStaffSiteDetails(staffId, location))
      .catch((error) => {
        console.warn("Unable to save staff usual site", error);
        addAuditLog("Staff site save failed", `${staffId}: ${error.message || "Supabase rejected the update"}`);
      });
  }

  function updateHrReportingOverride({ staffRecordId, managerStaffRecordId = "", scope = "" }) {
    if (!staffRecordId || !hasSupabaseConfig || !isUuid(staffRecordId)) return;
    loadSupabaseModule()
      .then(({ updateHrReportingLine }) => updateHrReportingLine({ staffRecordId, managerStaffRecordId, scope }))
      .then((savedLine) => {
        addAuditLog("HR reporting line saved", `${savedLine.staffRecordId}: ${savedLine.scope || "Organisation-wide"}`);
      })
      .catch((error) => {
        console.warn("Unable to save HR reporting line", error);
        addAuditLog("HR reporting line save failed", `${staffRecordId}: ${error.message || "Supabase rejected the update"}`);
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
            <div className="platform-nav-group" key={group}>
              <strong>{group}</strong>
              {items.map((item) => (
                <button key={item} type="button" aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : ""} title={platformTabHints[item] || item} onClick={() => setTab(item)}>
                  {iconFor(item)} <span>{item}</span>
                </button>
              ))}
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
        {tab === "Admin" && <AdminDashboard data={scopedData} access={access} onOpenTab={setTab} onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }} />}
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
        {tab === "SCR" && <SCR data={targetedScopedData} access={access} targetStaffId={staffProfileTargetId} onTargetHandled={() => setStaffProfileTargetId("")} onUpdateStaffPay={updateStaffPayOverride} />}
        {tab === "Ofsted" && <OfstedReadiness data={scopedData} />}
        {tab === "Documents" && <Documents data={scopedData} />}
        {tab === "Pay" && <Pay data={targetedScopedData} access={access} targetStaffId={staffProfileTargetId} onTargetHandled={() => setStaffProfileTargetId("")} onOpenTab={setTab} onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }} />}
        {tab === "Rewards" && <Rewards data={scopedData} />}
        {tab === "Sessions" && <Sessions data={scopedData} />}
        {tab === "Incidents" && <Incidents />}
        {tab === "CRM" && <CRM data={enrichedData} />}
        {tab === "Audit" && <AuditLog />}
        {tab === "Settings" && <Settings />}
      </section>
    </main>
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

function StaffDashboard({ data, access, userEmail }) {
  const pendingDocs = data.documents.reduce((total, doc) => total + Math.max(0, Number(doc.assigned || 0) - Number(doc.read || 0)), 0);
  const ownStaff = resolveOwnStaffRecord(data, access, userEmail);
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const ownStaffWithScr = ownStaff ? applyScrChecklistState([ownStaff])[0] : null;
  const staffRenewalItems = ownStaffWithScr ? buildScrRenewalItems([ownStaffWithScr]) : [];
  const staffEvidenceRequests = ownStaffWithScr ? buildStaffEvidenceRequests(ownStaffWithScr, staffRenewalItems, renewalRequests) : [];
  const payslips = ownStaff ? staffPayslips(data.hrFiles, ownStaff.id).slice(0, 6) : [];
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

function AdminDashboard({ data, access, onOpenTab, onOpenStaffProfile }) {
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
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
  const attentionCount = submittedEvidence.length + expiredRenewals + pendingCoverMoves + pendingDocs;
  const priorityItems = [
    [submittedEvidence.length, "Review submitted evidence", "Approve or send back staff evidence waiting for admin review.", "SCR"],
    [expiredRenewals, "Expired SCR evidence", "Request updated evidence and keep assurance records current.", "SCR"],
    [pendingCoverMoves, "Cover notices pending", "Confirm rota cover emails when staff are moved between sites.", "Rota"],
    [pendingDocs, "Unread policy acknowledgements", "Chase missing reads from the document library.", "Documents"],
  ];
  const staffActionRows = staffWithScrState
    .filter((person) => !String(person.compliance).toLowerCase().includes("compliant"))
    .slice(0, 5);
  const quickActions = [
    ["Rota", "Cover, first aid and EYFS cover", "Rota"],
    ["Ofsted", "Site readiness and inspection window", "Ofsted"],
    ["CRM", "New enquiries and school outreach", "CRM"],
    ["Hours", "Paid windows and approvals", "Hours"],
  ];
  useEffect(() => {
    if (!data.scrRenewalRequests || !Object.keys(data.scrRenewalRequests).length) return;
    setRenewalRequests((current) => ({ ...current, ...data.scrRenewalRequests }));
  }, [data.scrRenewalRequests]);
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
      <section className="ops-briefing">
        <div>
          <p className="eyebrow">Today’s priorities</p>
          <h2>{access?.isScoped ? "Your team’s action list." : "What needs attention first."}</h2>
          <p>{attentionCount ? `${attentionCount} items need attention across compliance, rota and documents.` : "No urgent admin actions are waiting. Use quick actions for planned work."}</p>
          <div className="admin-quick-actions">
            {quickActions.map(([label, text, target]) => (
              <button key={label} type="button" onClick={() => onOpenTab(target)}>
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
    addAuditLog("HR hierarchy updated", `${person?.name || id}: ${Object.keys(patch).join(", ")}`);
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
          <h2>People Ops</h2>
          <p className="panel-note">A working HR view for line management, usual sites, staff records and people actions.</p>
        </div>
        <Badge value="Private HR workspace" />
      </div>
      <div className="hr-summary">
        <Metric icon={<Users />} label="Active people" value={activeRows.length} tone="blue" />
        <Metric icon={<ShieldCheck />} label="Managers" value={managerOptions.length} tone="green" />
        <Metric icon={<ClipboardCheck />} label="No line manager" value={unmappedStaff} tone={unmappedStaff ? "amber" : "green"} />
        <Metric icon={<FileText />} label="No HR files" value={staffWithNoFiles} tone={staffWithNoFiles ? "amber" : "green"} />
      </div>
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
              <div className="hr-action-grid" aria-label={`${selectedStaff.name} operational actions`}>
                <button type="button" onClick={() => selectedStaffProfile && onOpenStaffProfile?.(selectedStaffProfile.id)}>
                  <ShieldCheck size={18} />
                  <span><strong>Open staff profile</strong><small>SCR, pay details and staff record</small></span>
                </button>
                <button type="button" onClick={() => selectedStaffProfile && onOpenHrFiles?.(selectedStaffProfile.id)}>
                  <FileText size={18} />
                  <span><strong>HR files</strong><small>{selectedStaffFiles.length} files · {selectedStaffRestrictedFiles.length} restricted</small></span>
                </button>
                <button type="button" onClick={() => selectedStaffProfile && onOpenScr?.(selectedStaffProfile.id)}>
                  <ClipboardCheck size={18} />
                  <span><strong>SCR</strong><small>{selectedStaffScr?.status || "Review"} · {selectedStaffScr?.nextAction || "Check profile"}</small></span>
                </button>
                <button type="button" onClick={() => selectedStaffProfile && onOpenPay?.(selectedStaffProfile.id)}>
                  <PoundSterling size={18} />
                  <span><strong>Pay</strong><small>{selectedStaffPay?.latestPeriod ? `${formatPayrollPeriod(selectedStaffPay.latestPeriod)} · ${formatCurrency(selectedStaffPay.latestGross)}` : "Open payroll history"}</small></span>
                </button>
                <button className="hr-danger-action" type="button" onClick={() => openDismissModal(selectedStaff)}>
                  <X size={18} />
                  <span><strong>Dismiss</strong><small>Move to Former Staff and retain records</small></span>
                </button>
              </div>
              <div className="hr-operational-snapshot">
                <article>
                  <span>SCR readiness</span>
                  <strong>{selectedStaffScr?.status || "Review needed"}</strong>
                  <small>{selectedStaffScr?.nextAction || "Open SCR profile to review evidence."}</small>
                </article>
                <article>
                  <span>Documents</span>
                  <strong>{selectedStaffFiles.length} HR file{selectedStaffFiles.length === 1 ? "" : "s"}</strong>
                  <small>{selectedStaffPayslips.length} payslip{selectedStaffPayslips.length === 1 ? "" : "s"} · {selectedStaffRestrictedFiles.length} restricted</small>
                </article>
                <article>
                  <span>Pay basis</span>
                  <strong>{selectedStaffPay?.basis || "Not recorded"}</strong>
                  <small>{selectedStaffPay?.latestPeriod ? `${formatPayrollPeriod(selectedStaffPay.latestPeriod)} payroll: ${formatCurrency(selectedStaffPay.latestGross)}` : "No submitted payroll period found."}</small>
                </article>
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
            </>
          ) : (
            <EmptyList title="No staff records" text="Staff records will appear here once added." />
          )}
        </aside>
        <div className="hr-directory-panel">
          <div className="hr-directory-controls">
            <div>
              <h3>Staff Directory</h3>
              <p className="panel-note">Search, select and update the core HR routing fields.</p>
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
                <Badge value={person.updatedAt ? "Updated" : childrenOf(person.id).length ? `${childrenOf(person.id).length} reports` : "Profile"} />
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
  const [status, setStatus] = useState("");
  const [storageHealth, setStorageHealth] = useState({ state: hasSupabaseConfig ? "checking" : "local", message: hasSupabaseConfig ? "Checking Supabase Storage..." : "Supabase is not configured for this environment." });
  const categories = data.hrFileCategories?.length ? data.hrFileCategories : fallbackHrFileCategories;
  const staff = data.staff || [];
  const search = query.trim().toLowerCase();
  const visibleFiles = files.filter((file) => {
    const matchesStaff = staffFilter === "All" || file.staffRecordId === staffFilter;
    const matchesCategory = categoryFilter === "All" || file.category === categoryFilter;
    const haystack = [file.staffName, file.staffEmail, file.title, file.category, file.notes, file.status].filter(Boolean).join(" ").toLowerCase();
    return matchesStaff && matchesCategory && (!search || haystack.includes(search));
  });
  const activeCount = files.filter((file) => file.status !== "archived").length;
  const restrictedCount = files.filter((file) => file.sensitivity === "restricted").length;
  const staffWithFiles = new Set(files.map((file) => file.staffRecordId).filter(Boolean)).size;

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
      const { createHrFile, uploadHrFile } = await loadSupabaseModule();
      const saved = hasUploadFile ? await uploadHrFile(payload, uploadFile) : await createHrFile(payload);
      setFiles((current) => current.map((file) => file.id === localRecord.id ? saved : file));
      setStatus(hasUploadFile ? "HR file uploaded and saved." : "HR file saved.");
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
      </div>
      <section className={`storage-health ${storageHealth.state}`}>
        <div>
          <strong>{storageHealth.state === "ready" ? "Storage ready" : storageHealth.state === "failed" ? "Storage needs attention" : storageHealth.state === "local" ? "Local mode" : "Checking storage"}</strong>
          <span>{storageHealth.message}</span>
        </div>
        <Badge value={storageHealth.state === "ready" ? "Uploaded files private" : storageHealth.state === "failed" ? "Check Supabase" : "Pending"} />
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
            {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <label>Category<select name="category" defaultValue={categories[0]?.name}>{categories.map((category) => <option key={category.id || category.name}>{category.name}</option>)}</select></label>
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
              {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select></label>
            <label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option>All</option>
              {categories.map((category) => <option key={category.id || category.name}>{category.name}</option>)}
            </select></label>
          </div>
          <div className="hr-file-list">
            {visibleFiles.map((file) => (
              <article className="hr-file-row" key={file.id}>
                <div className="hr-file-icon"><FileText size={20} /></div>
                <div>
                  <strong>{file.title}</strong>
                  <span>{file.staffName}{file.staffEmail ? ` · ${file.staffEmail}` : ""}</span>
                  <small>{file.issueDate ? `Issued ${formatShortDate(file.issueDate)}` : "Issue date not recorded"}{file.expiryDate ? ` · Expires ${formatShortDate(file.expiryDate)}` : ""}</small>
                  {file.storagePath && <small className="storage-note">{file.storagePath === "Pending upload" ? "Upload pending" : "Private storage file"}</small>}
                  {file.notes && <p>{file.notes}</p>}
                  {file.syncError && <small className="sync-error">{file.syncError}</small>}
                </div>
                <div className="hr-file-actions">
                  <Badge value={hrFileStorageStatus(file)} />
                  <span className={`hr-file-category ${file.sensitivity === "restricted" ? "restricted" : ""}`}>{file.category}</span>
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
    const next = {
      ...assignments,
      [siteId]: {
        ...assignments[siteId],
        [field]: value,
      },
    };
    localStorage.setItem(rotaStorageKey, JSON.stringify(next));
    setAssignments(next);
    addAuditLog("Rota updated", `${siteId}: ${field} set to ${value || "unassigned"}`);
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

function SCR({ data, access, targetStaffId, onTargetHandled, onUpdateStaffPay }) {
  const [checklistState, setChecklistState] = useState(() => readScrChecklistState());
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const [evidenceFilter, setEvidenceFilter] = useState("Action needed");
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
  const totalStaff = activeScrStaff.length;
  const compliantStaff = activeScrStaff.filter((person) => person.compliance === "Compliant").length;
  const reviewStaff = Math.max(totalStaff - compliantStaff, 0);
  const completion = totalStaff ? Math.round((compliantStaff / totalStaff) * 100) : 100;
  const issueDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const [summaryStaffId, setSummaryStaffId] = useState(data.staff[0]?.id || "");
  const samplePerson = activeScrStaff.find((person) => person.id === summaryStaffId) || activeScrStaff[0] || {};
  const schoolOptions = assignmentSchools;
  const [assuranceSchool, setAssuranceSchool] = useState(schoolOptions[0] || "Partner School");
  const [includeEvidenceAppendix, setIncludeEvidenceAppendix] = useState(false);
  const assuranceStaff = activeScrStaff.filter((person) => staffAssignedToSchool(person, assuranceSchool));
  const selectedAssuranceStaff = assuranceStaff.length ? assuranceStaff : activeScrStaff;
  const assuranceStatements = [
    "Enhanced DBS details, barred list checks and update-service status are recorded against each staff member.",
    "Right to work, identity checks and proof-of-address evidence can be tracked with verifier and review dates.",
    "Safeguarding, KCSIE, company policy and allergy-awareness training are monitored with completion evidence.",
    "First aid is tracked by qualification, role and site requirement, with expiry dates where applicable.",
    "References, employment gaps, overseas checks and qualification evidence are captured for safer recruitment.",
    "Annual medical, criminal and childcare disqualification declarations are prompted and reconfirmed digitally.",
  ];
  const onboardingProfiles = activeScrStaff.filter((person) => person.onboardingStatus);
  const renewalItems = buildScrRenewalItems(activeScrStaff);
  const evidenceWorkflowItems = buildEvidenceWorkflowItems(activeScrStaff, renewalItems, renewalRequests);
  const submittedEvidence = buildSubmittedEvidenceReviews(activeScrStaff, renewalRequests);
  useEffect(() => {
    if (!data.scrRenewalRequests || !Object.keys(data.scrRenewalRequests).length) return;
    setRenewalRequests((current) => ({ ...current, ...data.scrRenewalRequests }));
  }, [data.scrRenewalRequests]);
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
    if (isFormerStaffRecord(scrData.staff.find((person) => person.id === staffId))) return;
    setChecklistState((current) => {
      const remoteChecklist = scrData.staff.find((person) => person.id === staffId)?.scrChecklist || {};
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
    addAuditLog("SCR checklist updated", `${staffId}: ${Object.keys(patch).join(", ")}`);
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
    addAuditLog("SCR evidence request cleared", `${request.check}: ${request.staffId}`);
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
  const requirementRows = schoolOptions.map((school) => {
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
  const scrFocusItems = [
    [reviewStaff, "Staff to review", reviewStaff ? "Check missing or incomplete SCR records." : "All staff currently marked compliant."],
    [renewalItems.length, "Renewal prompts", renewalItems.length ? "Expiry or review dates need follow-up." : "No renewals due in the next 60 days."],
    [requirementGapCount, "Site cover gaps", requirementGapCount ? "Check first aid, EYFS, safeguarding or allergy cover." : "Site requirements are covered."],
    [onboardingProfiles.length, "Onboarding queue", onboardingProfiles.length ? "Approve new staff only when evidence is complete." : "No onboarding records waiting."],
  ];

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Single Central Register</h2>
          {access?.isScoped && <p className="panel-note">Manager view: compliance table is limited to direct reports.</p>}
        </div>
        <div>
          <button className="button light" type="button" onClick={downloadStaffSummary}><Download size={16} /> Staff Summary</button>
          <button className="button light" type="button" onClick={downloadAssuranceLetter}><FileText size={16} /> Assurance Letter</button>
          <button className="button dark" type="button"><Upload size={16} /> Request Evidence</button>
        </div>
      </div>
      <section className="scr-focus-strip" aria-label="SCR action summary">
        {scrFocusItems.map(([count, title, text]) => (
          <article className={count ? "needs-action" : "clear"} key={title}>
            <strong>{count || "OK"}</strong>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="scr-assurance-hero">
        <div>
          <p className="eyebrow">School assurance ready</p>
          <h3>Evidence packs for safer recruitment, staff checks and school confidence.</h3>
          <p>
            Built around the same useful outputs as the Docode SCR: an individual staff SCR summary for internal review,
            and a school-facing assurance letter that can be generated when the underlying records are complete.
          </p>
        </div>
        <div className="scr-metrics" aria-label="SCR export readiness">
          <Metric icon={<ShieldCheck />} label="Completion" value={`${completion}%`} tone="green" />
          <Metric icon={<CheckCircle2 />} label="Complete records" value={compliantStaff} tone="blue" />
          <Metric icon={<Bell />} label="Require review" value={reviewStaff} tone="amber" />
          <Metric icon={<FileText />} label="Issue date" value={issueDate} tone="blue" />
        </div>
      </section>
      <section className="scr-output-grid">
        <article className="scr-output-card">
          <div>
            <p className="eyebrow">Staff SCR summary</p>
            <h3>{samplePerson.name || "Staff member"} record pack</h3>
            <p>Designed for a downloadable staff record with personal information, recruitment checks, training, DBS, right to work and admin review status.</p>
          </div>
          <label>
            Staff member
            <select value={samplePerson.id || ""} onChange={(event) => setSummaryStaffId(event.target.value)}>
              {activeScrStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
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
            <p>Summarises assigned staff, SCR status, DBS, barred list, safeguarding, first aid, right to work, references and assurance statements for a school or site.</p>
          </div>
          <label className="scr-school-select">
            School / site
            <select value={assuranceSchool} onChange={(event) => setAssuranceSchool(event.target.value)}>
              {schoolOptions.map((school) => <option key={school} value={school}>{school}</option>)}
            </select>
          </label>
          <label className="scr-evidence-toggle">
            <input type="checkbox" checked={includeEvidenceAppendix} onChange={(event) => setIncludeEvidenceAppendix(event.target.checked)} />
            <span>{includeEvidenceAppendix ? "Include evidence appendix" : "Summary only"}</span>
          </label>
          <div className="assurance-mini-table">
            {selectedAssuranceStaff.map((person) => (
              <div key={person.id}>
                <strong>{person.name}</strong>
                <span>{person.role}</span>
                <Badge value={person.compliance} />
              </div>
            ))}
          </div>
        </article>
      </section>
      <StaffTable
        data={scrData}
        targetStaffId={targetStaffId}
        onTargetHandled={onTargetHandled}
        evidenceRequests={renewalRequests}
        onRequestEvidence={requestProfileEvidence}
        onClearEvidenceRequest={clearProfileEvidenceRequest}
      />
      <section className="scr-evidence-console">
        <div className="scr-assignments-heading">
          <div>
            <p className="eyebrow">Evidence inbox</p>
            <h3>Track every SCR evidence request without leaving the register.</h3>
            <p>Requested, submitted, rejected and approved evidence all sits here, with the newest activity and audit history visible to admins.</p>
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
      {!!onboardingProfiles.length && <SCROnboardingQueue staff={onboardingProfiles} onUpdate={updateChecklist} onApprove={approveScrProfile} />}
      <SCRAssignmentsPanel
        staff={activeScrStaff}
        schools={assignmentSchools}
        onAdd={addAssignment}
        onRemove={removeAssignment}
        onUpdate={updateAssignment}
      />
      <SCRRequirementPanel rows={requirementRows} />
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
          {assignedStaff.length ? (
            <table><thead><tr><th>Name</th><th>Role</th><th>SCR</th><th>DBS renewal</th><th>Safeguarding</th><th>Allergy</th><th>First aid</th><th>EYFS</th></tr></thead><tbody>
              {assignedStaff.map((person) => <tr key={person.id}><td>{person.name}</td><td>{person.role}</td><td>{person.compliance}</td><td>{person.dbsRenewal || "Not recorded"}</td><td>{person.safeguardingExpiry || "Not recorded"}</td><td>{person.allergyAwarenessExpiry || "Not recorded"}</td><td>{person.firstAidExpiry || "Not recorded"}</td><td>{person.eyfsLevel || "Not recorded"}</td></tr>)}
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
    references: "References",
    declarations: "Annual declarations",
    firstAid: "First aid",
  };
  return labels[key] || key;
}

function splitScrRequestId(id) {
  const keys = ["rightToWork", "identity", "dbs", "barredList", "safeguarding", "allergy", "references", "declarations", "firstAid"];
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
                  <EvidenceFields evidence={person.scrChecklist?.evidence?.[key] || {}} onChange={(patch) => updateEvidence(person, key, patch)} />
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

function EvidenceFields({ evidence, onChange }) {
  return (
    <div className="evidence-fields">
      <label>Evidence / document ref<input value={evidence.reference || ""} onChange={(event) => onChange({ reference: event.target.value })} placeholder="Certificate, DBS ref, file name..." /></label>
      <label>Date seen<input type="date" value={evidence.dateSeen || ""} onChange={(event) => onChange({ dateSeen: event.target.value })} /></label>
      <label>Expiry / review date<input type="date" value={evidence.expiryDate || ""} onChange={(event) => onChange({ expiryDate: event.target.value })} /></label>
      <label>Verified by<input value={evidence.verifiedBy || ""} onChange={(event) => onChange({ verifiedBy: event.target.value })} placeholder="Admin name" /></label>
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

function SCRRequirementPanel({ rows }) {
  return (
    <section className="scr-requirements">
      <div className="scr-assignments-heading">
        <div>
          <p className="eyebrow">Site requirement checks</p>
          <h3>Flag rota and SCR gaps before a school assurance letter goes out.</h3>
          <p>Each site checks for at least one first aider, one EYFS Level 3+ lead, safeguarding training and allergy awareness among assigned staff.</p>
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

function Documents({ data }) {
  const [links, setLinks] = useState(() => readJson(documentLinksStorageKey, {}));
  const [linkStatus, setLinkStatus] = useState("");
  function updateDocumentLink(name, value) {
    const next = { ...links, [name]: value.trim() };
    if (!next[name]) delete next[name];
    setLinks(next);
    localStorage.setItem(documentLinksStorageKey, JSON.stringify(next));
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
  return (
    <Panel title="Document & Policy Library">
      <p className="panel-note">Add the Google Doc link for each live policy so staff and admins can open the source document from the library.</p>
      {linkStatus && <p className="panel-note">{linkStatus}</p>}
      <TableWrap>
        <table>
          <thead><tr><th>Document</th><th>Version</th><th>Google Doc link</th><th>Progress</th><th>Status</th></tr></thead>
          <tbody>{data.documents.map((doc) => {
            const assigned = Number(doc.assigned || 0);
            const read = Number(doc.read || 0);
            const percent = assigned ? Math.round((read / assigned) * 100) : 100;
            const link = links[doc.name] || doc.url || "";
            return (
              <tr key={doc.id || doc.name}>
                <td>{doc.name}</td>
                <td>{doc.version}</td>
                <td>
                  <div className="document-link-cell">
                    <input value={link} onChange={(event) => updateDocumentLink(doc.name, event.target.value)} onBlur={() => saveDocumentLink(doc)} placeholder="Paste Google Doc link" />
                    {link && <a className="button light" href={link} target="_blank" rel="noreferrer">Open</a>}
                  </div>
                </td>
                <td><Progress value={percent} label={`${read}/${assigned} read`} /></td>
                <td><Badge value={doc.status} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </TableWrap>
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
  const [selectedPayslipId, setSelectedPayslipId] = useState("");
  const payslipPeriods = Array.from(new Set((hrFiles || []).map((file) => payslipPeriod(file)).filter(Boolean))).sort().reverse();
  const availablePeriods = Array.from(new Set([...Object.keys(records), ...payslipPeriods])).sort().reverse();
  const [period, setPeriod] = useState(availablePeriods[0] || currentPayrollPeriod());
  const isStaff = access?.role === "Staff";
  const isAdmin = ["Admin", "Superadmin"].includes(access?.role);
  const canMarkPaid = access?.role === "Superadmin";
  const currentRun = runs[period] || { status: "Draft", adjustments: {} };
  const payRunIsPublished = (run) => run?.status === "Paid";
  const showStaffPayCalculation = !isStaff || payRunIsPublished(currentRun);
  const periodRecords = showStaffPayCalculation ? (records[period] || {}) : {};
  const runLocked = currentRun.status === "Paid";
  const staffIds = new Set(data.staff.map((person) => person.id));
  const payrollRows = data.staff.map((person) => {
    const schoolRows = Object.entries(periodRecords).flatMap(([schoolName, record]) => (record.rows || [])
      .filter((row) => row.staffId === person.id || row.staffId === person.profileId)
      .map((row) => ({ ...row, schoolName, status: record.status || "Draft" })));
    const hours = schoolRows.reduce((sum, row) => sum + Number(row.hours || 0), 0);
    const hourlyGross = schoolRows.reduce((sum, row) => sum + Number(row.hours || 0) * Number(row.rate ?? person.payRate ?? 0), 0);
    const monthlySalary = showStaffPayCalculation ? monthlySalaryFromAnnual(person.annualSalary) : 0;
    const gross = monthlySalary + hourlyGross;
    const adjustment = showStaffPayCalculation ? (currentRun.adjustments?.[person.id] || {}) : {};
    const expenses = Number(adjustment.expenses || 0);
    const deductions = Number(adjustment.deductions || 0);
    const allPayslips = staffPayslips(hrFiles, person.id);
    const payslips = allPayslips.filter((file) => payslipMatchesPeriod(file, period));
    return { ...person, payrollEntries: schoolRows, hours, monthlySalary, hourlyGross, gross, expenses, deductions, payrollNote: adjustment.note || "", payslips, allPayslips };
  });
  const totalHours = payrollRows.reduce((sum, row) => sum + row.hours, 0);
  const totalGross = payrollRows.reduce((sum, row) => sum + row.gross, 0);
  const totalExpenses = payrollRows.reduce((sum, row) => sum + row.expenses, 0);
  const totalDeductions = payrollRows.reduce((sum, row) => sum + row.deductions, 0);
  const totalNet = totalGross + totalExpenses - totalDeductions;
  const periodRecordList = Object.values(periodRecords);
  const submittedSites = periodRecordList.filter((record) => ["Submitted", "Approved"].includes(record.status)).length;
  const approvedSites = periodRecordList.filter((record) => record.status === "Approved").length;
  const unapprovedHourSites = periodRecordList.filter((record) => (record.rows || []).some((row) => Number(row.hours || 0) > 0) && record.status !== "Approved");
  const payrollReady = payrollRows.some((row) => row.hours > 0 || row.monthlySalary > 0);
  const staffToPay = payrollRows.filter((row) => row.hours > 0 || row.monthlySalary > 0);
  const staffPayslipFiles = isStaff ? payrollRows.flatMap((row) => row.allPayslips || []) : [];
  const periodStaffPayslipFiles = staffPayslipFiles.filter((file) => payslipMatchesPeriod(file, period));
  const selectedStaffPayslip = staffPayslipFiles.find((file) => file.id === selectedPayslipId) || periodStaffPayslipFiles[0] || staffPayslipFiles[0] || null;
  const monthlyPayslipFiles = payrollRows.flatMap((row) => row.payslips.map((file) => ({
    ...file,
    staffName: row.name,
    staffEmail: row.email || "",
    staffNetPay: row.gross + row.expenses - row.deductions,
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
      || (payrollFilter === "pay-due" && (row.hours > 0 || row.monthlySalary > 0))
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
    const gross = monthlySalary + hourlyGross;
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
      net: gross + expenses - deductions,
      payslips: historyPayslips,
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
    const gross = monthlySalary + hourlyGross;
    const payslips = staffPayslips(hrFiles, selectedHistoryStaff.id).filter((file) => payslipMatchesPeriod(file, historyPeriod));
    return {
      period: historyPeriod,
      status: historyRun.status || "Draft",
      schools: Array.from(new Set(payrollEntries.map((entry) => entry.schoolName).filter(Boolean))),
      hours,
      monthlySalary,
      gross,
      expenses,
      deductions,
      net: gross + expenses - deductions,
      payslips,
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

  function saveRun(nextRun, action = "Payroll run updated") {
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
    addAuditLog(action, formatPayrollPeriod(period));
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
    }, "Payroll adjustment updated");
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
        const net = row.gross + row.expenses - row.deductions;
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
      setPayslipStatus(`${person.name}'s payslip uploaded.`);
      addAuditLog("Payslip uploaded", `${person.name}: ${formatPayrollPeriod(period)}`);
    } catch (error) {
      setHrFiles((current) => current.map((item) => item.id === localRecord.id ? { ...item, storagePath: "", syncError: error.message || "Upload failed" } : item));
      setPayslipStatus(`Payslip upload failed: ${error.message || "check Supabase Storage permissions"}`);
    }
  }

  return (
    <div className="stack payroll-console">
      <div className="toolbar">
        <div>
          <h2>{isStaff ? "My Pay Summary" : "Payroll Summary"}</h2>
          <p className="panel-note">{isStaff ? "Your approved hours, gross pay and payslip records appear here once admin has submitted the month." : "Monthly pay is calculated from submitted school hours: paid hours x rate, plus approved expenses, minus separate deductions."}</p>
        </div>
        <div className="payroll-toolbar">
          <label>Month<select value={period} onChange={(event) => setPeriod(event.target.value)}>{Array.from(new Set([period, ...availablePeriods, currentPayrollPeriod()])).filter(Boolean).map((item) => <option key={item} value={item}>{formatPayrollPeriod(item)}</option>)}</select></label>
        </div>
      </div>
      <div className="hr-summary">
        <Metric icon={<Clock />} label={isStaff ? "My paid hours" : "Paid hours"} value={totalHours.toFixed(2)} tone={totalHours ? "green" : "amber"} />
        <Metric icon={<PoundSterling />} label={isStaff ? "My gross pay" : "Gross payroll"} value={formatCurrency(totalGross)} tone="green" />
        <Metric icon={<ClipboardCheck />} label="Submitted sites" value={isAdmin ? submittedSites : payrollRows.flatMap((row) => row.payrollEntries).filter((entry) => ["Submitted", "Approved"].includes(entry.status)).length} tone={submittedSites ? "blue" : "amber"} />
        {isAdmin && <Metric icon={<CheckCircle2 />} label="Run status" value={currentRun.status || "Draft"} tone={currentRun.status === "Paid" ? "green" : currentRun.status === "Draft" ? "amber" : "blue"} />}
      </div>
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
        <Panel title={`${formatPayrollPeriod(period)} Payslips Uploaded`}>
          <div className="payslip-admin-panel">
            <div>
              <p>{monthlyPayslipFiles.length} payslip{monthlyPayslipFiles.length === 1 ? "" : "s"} uploaded for this payroll month.</p>
              <small>{missingPayslipRows.length ? `${missingPayslipRows.length} staff member${missingPayslipRows.length === 1 ? "" : "s"} still need a payslip.` : "Every staff member due pay has a payslip recorded."}</small>
            </div>
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                setPayrollFilter("missing-payslips");
                setPayrollQuery("");
                document.getElementById("payroll-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              disabled={!missingPayslipRows.length}
            >
              View missing
            </button>
          </div>
          <div className="payslip-admin-list">
            {monthlyPayslipFiles.map((file) => (
              <article className="payslip-admin-item" key={file.id}>
                <div>
                  <strong>{file.staffName}</strong>
                  <span>{file.staffEmail || "No email"} · {formatCurrency(file.staffNetPay)}</span>
                </div>
                <div>
                  <small>{file.issueDate ? formatShortDate(file.issueDate) : file.uploadedAt ? formatShortDate(file.uploadedAt.slice(0, 10)) : "Date pending"}</small>
                  {file.fileUrl
                    ? <a className="button light" href={file.fileUrl} target="_blank" rel="noreferrer">Open PDF</a>
                    : <Badge value={file.storagePath ? "Private file" : "File pending"} />}
                </div>
              </article>
            ))}
            {!monthlyPayslipFiles.length && <EmptyList title="No payslips uploaded for this month" text="Upload payslips from the payroll table once the month has been reviewed." />}
          </div>
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
              <small>{staffSelectedMonth.monthlySalary ? `${formatCurrency(staffSelectedMonth.monthlySalary)} salary` : "No salary recorded"}{staffSelectedMonth.hourlyGross ? ` · ${formatCurrency(staffSelectedMonth.hourlyGross)} additional hours` : ""}</small>
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
      {isStaff && (
        <Panel title="My Payslip">
          {staffPayslipFiles.length ? (
            <div className="staff-payslip-picker">
              <label>
                Payslip
                <select value={selectedStaffPayslip?.id || ""} onChange={(event) => setSelectedPayslipId(event.target.value)}>
                  {staffPayslipFiles.map((file) => (
                    <option key={file.id} value={file.id}>
                      {formatPayrollPeriod(payslipPeriod(file))} - {file.title || "Payslip"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="staff-payslip-preview">
                <div>
                  <Badge value={selectedStaffPayslip?.issueDate ? formatShortDate(selectedStaffPayslip.issueDate) : selectedStaffPayslip?.uploadedAt ? formatShortDate(selectedStaffPayslip.uploadedAt.slice(0, 10)) : "Payslip"} />
                  <strong>{selectedStaffPayslip?.title || "Payslip"}</strong>
                  {selectedStaffPayslip?.notes && <span>{selectedStaffPayslip.notes}</span>}
                </div>
                {selectedStaffPayslip?.fileUrl
                  ? <a className="button primary" href={selectedStaffPayslip.fileUrl} target="_blank" rel="noreferrer">View payslip</a>
                  : <Badge value={selectedStaffPayslip?.storagePath ? "PDF uploaded" : "File pending"} />}
              </div>
            </div>
          ) : (
            <EmptyList title="No payslips yet" text="Payslips will appear here after admin uploads them." />
          )}
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
                const net = row.gross + row.expenses - row.deductions;
                return (
                  <tr key={row.id}>
                    <td>
                      <button className="payroll-staff-link" type="button" onClick={() => onOpenStaffProfile?.(row.id)}>{row.name}</button>
                      <br /><small>{row.email || "No email"}</small>
                    </td>
                    <td>{schools.length ? schools.join(", ") : "No hours submitted"}</td>
                    <td><strong>{row.hours.toFixed(2)}</strong></td>
                    <td>
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

function Rewards({ data }) {
  return <Panel title="Staff Recognition"><RewardList data={data} admin /></Panel>;
}

function Sessions({ data }) {
  return <Panel title="Scheduling & Sessions"><SessionList data={data} detailed /></Panel>;
}

function Incidents() {
  const incidentTypes = ["Behaviour issue", "Safeguarding concern", "First aid issue", "Accident/incident", "Parent concern", "Site issue", "Staffing issue", "Equipment issue"];
  return (
    <div className="incident-layout">
      <Panel title="Report an Issue">
        <form className="compact-form">
          <label>Type<select>{incidentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Sensitivity<select><option>Standard</option><option>Safeguarding restricted</option></select></label>
          <label>Summary<textarea rows="5" /></label>
          <button className="button primary" type="button">Submit Secure Report</button>
        </form>
      </Panel>
      <Panel title="Open Issues">
        <ActionList items={["Restricted report: visible to authorised leads only", "First aid follow-up: awaiting parent confirmation", "Site issue: storage cupboard lock"]} />
      </Panel>
    </div>
  );
}

function CRM({ data }) {
  const [updates, setUpdates] = useState(() => readCrmUpdates());
  const [fallbackOutreach, setFallbackOutreach] = useState([]);
  const [typeFilter, setTypeFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [rowLimit, setRowLimit] = useState("25");
  const [sort, setSort] = useState({ key: "name", direction: "asc" });
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
  const records = [...mergeCrmRecords(data.enquiries, updates), ...outreach];
  const queryText = query.trim().toLowerCase();
  const visibleRecords = records.filter((record) => {
    const matchesType = typeFilter === "All" || record.type === typeFilter || record.stage === typeFilter || record.status === typeFilter;
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

    addAuditLog("CRM updated", `${existing.name || id}: ${Object.keys(patch).join(", ")}`);
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
    addAuditLog("CRM bulk update", `${ids.length} rows: ${Object.keys(patch).join(", ")}`);
  }

  return (
    <div className="crm-workspace">
      <div className="toolbar">
        <div>
          <h2>Enquiries CRM</h2>
          <p className="panel-note">Track website enquiries and school outreach as rows. Email still happens manually; this keeps stage, notes and follow-up visible.</p>
        </div>
        <div className="crm-toolbar-controls">
          <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search school, contact, note..." /></label>
          <label>Filter<select aria-label="Filter enquiries" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {["All", "Parent", "School", "Staff", "Outreach", "Prospect", "Contacted", "Follow up", "Partner school", "Closed"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
          <label>Rows<select aria-label="Rows per page" value={rowLimit} onChange={(event) => setRowLimit(event.target.value)}>
            {["25", "50", "100", "All"].map((item) => <option key={item}>{item}</option>)}
          </select></label>
        </div>
      </div>
      <div className="crm-summary">
        <Metric icon={<Mail />} label="Outreach prospects" value={outreachCount} tone="blue" />
        <Metric icon={<CalendarDays />} label="Follow-ups" value={followUpCount} tone="amber" />
        <Metric icon={<ShieldCheck />} label="Partner schools" value={partnerCount} tone="green" />
      </div>
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

function AuditLog() {
  const [items, setItems] = useState(() => readAuditLog());
  const [filter, setFilter] = useState("All");
  const filteredItems = items.filter((item) => filter === "All" || item.action.toLowerCase().includes(filter.toLowerCase()));
  function clearAudit() {
    localStorage.removeItem(auditStorageKey);
    setItems([]);
  }
  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Audit Log</h2>
          <p className="panel-note">Local demo trail for admin actions. Production should write immutable audit rows server-side.</p>
        </div>
        <div>
          <select aria-label="Filter audit log" value={filter} onChange={(event) => setFilter(event.target.value)}>
            {["All", "Cover", "Rota", "Hours", "HR", "CRM", "User"].map((item) => <option key={item}>{item}</option>)}
          </select>
          <button className="button light" type="button" onClick={clearAudit}>Clear Local Log</button>
        </div>
      </div>
      <div className="list">
        {filteredItems.map((item) => (
          <article className="list-item" key={item.id}>
            <div><strong>{item.action}</strong><span>{item.detail}</span><small>{new Date(item.createdAt).toLocaleString("en-GB")}</small></div>
            <Badge value={item.source || "Local"} />
          </article>
        ))}
        {!filteredItems.length && <EmptyList title="No audit entries yet" text="User, CRM, rota, cover, HR and hours changes will appear here." />}
      </div>
    </div>
  );
}

function Settings() {
  const [settings, setSettings] = useState(() => readPublicSettings());
  const documentLinks = readJson(documentLinksStorageKey, {});
  const auditItems = readAuditLog();
  const hrFileCount = auditItems.filter((item) => String(item.action || "").toLowerCase().includes("hr file")).length;
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

  function updateSetting(patch) {
    const next = { ...settings, ...patch, updatedAt: new Date().toISOString() };
    setSettings(next);
    localStorage.setItem(publicSettingsStorageKey, JSON.stringify(next));
    addAuditLog("Public settings updated", `Camp announcement ${next.campAnnouncementEnabled ? "enabled" : "disabled"}`);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Settings</h2>
          <p className="panel-note">Control public-site features that can be switched on or off without changing page content.</p>
        </div>
      </div>
      <section className="settings-grid">
        <article className="setting-card">
          <div>
            <p className="eyebrow">Homepage</p>
            <h3>Camp announcement pop-out</h3>
            <p>Advertises {nextCamp.title} on the homepage with dates, sites, daily themes and a booking link.</p>
          </div>
          <label className="toggle-row">
            <input aria-label="Camp announcement pop-out" type="checkbox" checked={settings.campAnnouncementEnabled} onChange={(event) => updateSetting({ campAnnouncementEnabled: event.target.checked })} />
            <span>{settings.campAnnouncementEnabled ? "Enabled" : "Disabled"}</span>
          </label>
        </article>
        <article className="setting-card">
          <div>
            <p className="eyebrow">Preview</p>
            <h3>{nextCamp.title}</h3>
            <p>{nextCamp.dates} · {nextCamp.sites.join(", ")}</p>
          </div>
          <Badge value={settings.campAnnouncementEnabled ? "Live" : "Off"} />
        </article>
        <article className="setting-card">
          <div>
            <p className="eyebrow">Document library</p>
            <h3>Google policy links</h3>
            <p>{Object.keys(documentLinks).length} policy links are saved on this browser. Open Documents to add or update live Google Doc links.</p>
          </div>
          <Badge value={`${Object.keys(documentLinks).length} linked`} />
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
        <article className="setting-card setting-card-wide">
          <div>
            <p className="eyebrow">Launch readiness</p>
            <h3>V1 checks before wider rollout</h3>
            <p>A short operational checklist for the current launch phase.</p>
          </div>
          <div className="settings-checklist">
            {launchItems.map(([title, text]) => (
              <span key={title}><CheckCircle2 size={18} /><strong>{title}</strong><small>{text}</small></span>
            ))}
          </div>
        </article>
        <article className="setting-card setting-card-wide">
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
        </article>
      </section>
    </div>
  );
}

function StaffTable({ compact, data = mockPlatformData, targetStaffId, onTargetHandled, evidenceRequests = {}, onRequestEvidence, onClearEvidenceRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Action needed");
  const [siteFilter, setSiteFilter] = useState("All");
  const [priorityView, setPriorityView] = useState(false);
  const [selectedId, setSelectedId] = useState(data.staff[0]?.id || "");
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
    const matchesSite = siteFilter === "All" || staffSchoolNames(person).includes(siteFilter);
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
  const selectedPerson = data.staff.find((person) => person.id === selectedId) || rows[0] || data.staff[0];
  const filtersActive = query || statusFilter !== "Action needed" || siteFilter !== "All" || priorityView;
  useEffect(() => {
    if (!targetStaffId) return;
    setSelectedId(targetStaffId);
    onTargetHandled?.();
  }, [targetStaffId, onTargetHandled]);
  return (
    <section className="staff-register">
      <div className="staff-register-head">
        <div>
          <p className="eyebrow">Live staff register</p>
          <h3>Find the next compliance action quickly.</h3>
          <p>{rows.length} of {data.staff.length} records shown · {actionCount} active staff need review · {compliantCount} currently compliant.</p>
          {!!priorityRows.length && (
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
          <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
            <option>All</option>
            {siteOptions.map((site) => <option key={site}>{site}</option>)}
          </select></label>
          <button className="button light" type="button" disabled={!filtersActive} onClick={() => { setQuery(""); setStatusFilter("Action needed"); setSiteFilter("All"); setPriorityView(false); }}>Clear</button>
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
          access={access}
          onUpdateStaffPay={onUpdateStaffPay}
        />
      )}
      <TableWrap>
        <table>
          <thead><tr><th>Staff</th><th>Role</th><th>Assigned sites</th><th>Reports to</th><th>SCR</th><th>Priority</th><th>Next action</th>{!compact && <><th>DBS renewal</th><th>Safeguarding</th><th>First aid</th></>}<th>Profile</th></tr></thead>
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
                <td>{staffPrimaryLocation(person)}</td>
                <td>{managerName(person)}</td>
                <td><Badge value={checkStatus(person)} /></td>
                <td><span className={`scr-priority-pill ${priority.tier.toLowerCase()}`}>{priority.tier}</span><br /><small>{priority.reason}</small></td>
                <td><strong>{actionText(person)}</strong></td>
                {!compact && <><td>{person.dbsRenewal}</td><td>{person.safeguardingExpiry}</td><td>{person.firstAidExpiry}</td></>}
                <td><button className="button subtle" type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(person.id); }}>{isFormerStaffRecord(person) ? "View retained" : selectedPerson?.id === person.id ? "Open" : "View"}</button></td>
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

function StaffProfilePanel({ person, data, managerName, checkStatus, nextAction, actionItems = [], evidenceRequests = [], onRequestEvidence, onClearEvidenceRequest, access, onUpdateStaffPay }) {
  const [notes, setNotes] = useState(() => readJson(staffProfileNotesStorageKey, {}));
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
  const [requestEvidenceKey, setRequestEvidenceKey] = useState(() => scrEvidenceRequestOptions[0][0]);
  const [requestNote, setRequestNote] = useState("");
  const archivedRecord = person.formerRecord || {};
  const isArchivedProfile = isFormerStaffRecord(person);
  const note = notes[person.id] || "";
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
  const profileStats = [
    ["Record", isArchivedProfile ? "Archived" : "Active"],
    ["SCR", checkStatus],
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
    const expiryStatus = evidenceExpiryStatus({ expiryDate: dateValue });
    const firstAidNotRequired = key === "firstAid" && String(person.firstAidExpiry || "").toLowerCase() === "not required";
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
              : expiryStatus || (fieldValue ? "Recorded" : "Missing");
    const tone = ["Approved", "Recorded", "In date", "Not required"].includes(status)
      ? "ready"
      : ["Awaiting review", "Requested", "Expiring soon"].includes(status)
        ? "pending"
        : "alert";
    const detail = request?.note || request?.rejectionReason || request?.submissionNote || evidence.note || (dateValue ? `Review date ${formatShortDate(dateValue)}` : fieldValue || "No evidence recorded yet.");
    return { key, label, status, tone, detail };
  });

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
    const missingKey = actionItems.map((item) => String(item).toLowerCase()).includes("dbs")
      ? "dbs"
      : actionItems.map((item) => String(item).toLowerCase()).includes("safeguarding")
        ? "safeguarding"
        : actionItems.map((item) => String(item).toLowerCase()).includes("allergy")
          ? "allergy"
          : scrEvidenceRequestOptions[0][0];
    setRequestEvidenceKey(missingKey);
    setRequestNote("");
  }, [person.id, person.photoUrl, person.profilePhotoUrl, person.payRate, person.annualSalary, person.contractType]);

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

  function updateNote(value) {
    const next = {
      ...notes,
      [person.id]: value,
    };
    setNotes(next);
    localStorage.setItem(staffProfileNotesStorageKey, JSON.stringify(next));
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
      <section className={`scr-next-action-card ${actionItems.length ? "needs-action" : "ready"}`}>
        <div>
          <p className="eyebrow">Next action</p>
          <h4>{nextAction}</h4>
          <p>{isArchivedProfile ? "This is a retained evidence record and is excluded from live SCR actions." : actionItems.length ? "Work through these items before issuing assurance or marking the profile ready." : "No immediate SCR action is flagged for this staff member."}</p>
        </div>
        <div className="scr-action-tags">
          {(actionItems.length ? actionItems : ["No action"]).map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>
      <section className="scr-profile-request-panel">
        <div>
          <p className="eyebrow">Evidence requests</p>
          <h4>Request missing or updated SCR evidence.</h4>
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
      </section>
      <div className="staff-profile-grid">
        <section>
          <h4>Contact & line management</h4>
          <dl>
            <div><dt>Email</dt><dd>{person.email || "Not recorded"}</dd></div>
            <div><dt>Phone</dt><dd>{person.phone || "Not recorded"}</dd></div>
            <div><dt>Reports to</dt><dd>{managerName || "Unassigned"}</dd></div>
            <div><dt>Next action</dt><dd>{nextAction}</dd></div>
          </dl>
        </section>
        <section className="staff-profile-scr-checklist">
          <h4>SCR evidence checklist</h4>
          <p className="panel-note">Each item shows what admin should do next for this staff record.</p>
          <div className="scr-profile-checklist">
            {evidenceChecklistRows.map((row) => (
              <div className={`scr-profile-check ${row.tone}`} key={row.key}>
                <span>{row.label}</span>
                <strong>{row.status}</strong>
                <small>{row.detail}</small>
              </div>
            ))}
          </div>
          <div className="scr-profile-admin-review">
            <span>Admin review</span>
            <strong>{person.scrChecklist?.approvedAt ? `Approved ${formatShortDate(person.scrChecklist.approvedAt.slice(0, 10))}` : "Awaiting review"}</strong>
          </div>
        </section>
        <section>
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
            <dl>
              <div><dt>Hourly rate</dt><dd>{person.payRate ? `${formatCurrency(person.payRate)}/hr` : "Not recorded"}</dd></div>
              <div><dt>Annual salary</dt><dd>{person.annualSalary ? formatCurrency(person.annualSalary) : "Not recorded"}</dd></div>
              <div><dt>Monthly salary</dt><dd>{monthlySalary ? formatCurrency(monthlySalary) : "Not recorded"}</dd></div>
              <div><dt>Contract</dt><dd>{person.contractType || "Not recorded"}</dd></div>
              <div><dt>Start date</dt><dd>{person.startDate || "Not recorded"}</dd></div>
            </dl>
          )}
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
        <section className="staff-profile-files">
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
      <label className="staff-profile-notes">Internal notes<textarea value={note} onChange={(event) => updateNote(event.target.value)} rows="3" placeholder={isArchivedProfile ? "Archived record notes are read-only in SCR." : "Manager notes, HR follow-up, contract reminders..."} disabled={isArchivedProfile} /></label>
    </article>
  );
}

function staffHrFileBucket(file) {
  const category = `${file.category || ""} ${file.sensitivity || ""} ${file.title || ""}`.toLowerCase();
  if (category.includes("payslip") || category.includes("payroll")) return "Payslips";
  if (category.includes("contract")) return "Contracts";
  if (category.includes("letter") || category.includes("communication")) return "Letters";
  if (category.includes("disciplinary") || category.includes("dbs") || category.includes("right to work") || category.includes("restricted")) return "Restricted";
  return "Other";
}

function staffPayslips(files = [], staffId) {
  return (files || [])
    .filter((file) => file.staffRecordId === staffId && staffHrFileBucket(file) === "Payslips" && file.status !== "archived")
    .sort((a, b) => String(b.issueDate || b.uploadedAt || "").localeCompare(String(a.issueDate || a.uploadedAt || "")));
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
  const latestGross = latestPeriod ? monthlySalary + hourlyGross : monthlySalary;
  const basis = person.annualSalary
    ? `${formatCurrency(monthlySalary)}/mo salary`
    : person.payRate
      ? `${formatCurrency(person.payRate)}/hr`
      : "Not recorded";
  return { latestPeriod, hours, latestGross, basis };
}

function buildStaffHrFileTabs(files) {
  const baseTabs = ["All", "Contracts", "Payslips", "Letters", "Restricted", "Other"];
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
      if (viewRole === "Manager") return user.role === "Manager";
      if (viewRole === "Staff") return user.role !== "Superadmin" && user.role !== "Admin";
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

function addAuditLog(action, detail) {
  const items = readAuditLog();
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    detail,
    source: "Local",
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(auditStorageKey, JSON.stringify([entry, ...items].slice(0, 80)));
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
  const className = value.toLowerCase().includes("gap") || value.toLowerCase().includes("missing") || value.toLowerCase().includes("alert") || value.toLowerCase().includes("rejected") ? "bad" : value.toLowerCase().includes("soon") || value.toLowerCase().includes("chase") || value.toLowerCase().includes("pending") ? "warn" : "good";
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
    Rewards: <Award />,
    Sessions: <Clock />,
    Rota: <CalendarDays />,
    Hours: <Clock />,
    Incidents: <Bell />,
    CRM: <Mail />,
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
