import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  faqs,
  services,
} from "./data.js";

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

let mockPlatformDataPromise;
async function loadMockPlatformData() {
  mockPlatformDataPromise ||= import("./internalData.js").then(({ documents, enquiries, rewards, sessions, staff }) => ({
    staff,
    sessions,
    documents,
    enquiries,
    rewards,
    source: "Demo data",
    loading: false,
    error: "",
  }));
  return mockPlatformDataPromise;
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
const Platform = lazy(() => import("./PlatformModule.jsx"));

const MAGICBOOKING_URL = "https://apres-school.magicbooking.co.uk/Identity/Account/Login";
const PEBBLE_KINGS_ROWANS_URL = "https://activities.bookpebble.co.uk/";
const PEBBLE_SHREWSBURY_URL = "https://activities.bookpebble.co.uk/";
const APRES_IMG = {
  groupTable: "/assets/apres-highlights/real-img_0014.jpg",
  outdoorBall: "/assets/apres-highlights/real-img_0030.jpg",
  colouring: "/assets/apres-highlights/real-img_0038.jpg",
  brandedDance: "/assets/apres-highlights/real-img_0041.jpg",
  parachute: "/assets/apres-highlights/real-img_0043.jpg",
  outdoorFootball: "/assets/apres-highlights/real-img_0063-1-.jpg",
  magnetBuild: "/assets/apres-highlights/real-img_0104.jpg",
  magnetTower: "/assets/apres-highlights/real-img_0106.jpg",
  dodgeball: "/assets/apres-highlights/real-img_0109.jpg",
  bubbleExperience: "/assets/apres-highlights/home-bubble-experience.jpg",
  scienceActivity: "/assets/apres-highlights/home-science-activity.jpg",
  campMoveFootball: "/assets/apres-highlights/camp-move-football.jpg",
  campResetTennis: "/assets/apres-highlights/camp-reset-tennis.jpg",
  wraparoundMaskTable: "/assets/apres-highlights/wraparound-mask-table.jpg",
  wraparoundSnackSpread: "/assets/apres-highlights/wraparound-snack-spread.jpg",
  wraparoundColouringTable: "/assets/apres-highlights/wraparound-colouring-table.jpg",
  wraparoundSchoolRun: "/assets/apres-highlights/wraparound-school-run.jpg",
  schoolPartnershipHero: "/assets/apres-highlights/school-partnership-hero.jpg",
  schoolCreativeTable: "/assets/apres-highlights/school-creative-table.jpg",
  planetActivity: "/assets/apres-highlights/real-img_0113-1-.jpg",
  shavingFoam: "/assets/apres-highlights/real-img_0124.jpg",
  homeWraparoundPrivacy: "/assets/apres-highlights/home-wraparound-img-0452.jpg",
  homeSchoolPrivacy: "/assets/apres-highlights/home-school-partnerships-balloon.jpg",
  willingtonTile: "/assets/school-tiles/willington-booking-tile.jpg",
  kingsHouseTile: "/assets/school-tiles/kings-house-booking-tile.jpg",
  shrewsburyHouseTile: "/assets/school-tiles/shrewsbury-house-booking-tile.jpg",
  ripleyCourtTile: "/assets/school-tiles/ripley-court-booking-tile.jpg",
  rowansTile: "/assets/school-tiles/rowans-booking-tile.jpg",
};

const nav = ["Home", "Bookings", "Holiday Clubs", "Wraparound", "Schools", "Contact"];
const platformTabs = ["Staff", "Admin", "Users", "HR", "Rota", "Hours", "SCR", "Ofsted", "Documents", "Pay", "Rewards", "Sessions", "CRM", "Audit", "Settings"];
const platformGroups = [
  ["Overview", ["Admin", "Staff"]],
  ["People", ["Users", "HR", "SCR", "Ofsted", "Documents"]],
  ["Operations", ["Rota", "Hours", "Sessions", "CRM"]],
  ["Finance & culture", ["Pay", "Rewards"]],
  ["System", ["Audit", "Settings"]],
];
const pagePaths = {
  Home: "/",
  Bookings: "/bookings",
  "Holiday Clubs": "/holiday-clubs",
  Wraparound: "/wraparound",
  Schools: "/schools",
  Contact: "/contact",
  "Staff Application": "/staff-application",
  Magicbooking: "/magicbooking",
  "Book Pebble": "/book-pebble",
  Payments: "/payments",
  Cancellations: "/cancellations",
  Policies: "/policies",
};
const pathPages = Object.fromEntries(Object.entries(pagePaths).map(([page, path]) => [path, page]));
function isPlatformPath() {
  return window.location.pathname === "/staff-login";
}

function hasRecoveryHash() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("type") === "recovery" || hash.has("access_token");
}

const pageMeta = {
  Home: ["Après School | Holiday Clubs, Wraparound Care and School Partnerships", "Warm, reliable holiday clubs, wraparound care and trusted school partnerships for families and schools."],
  Bookings: ["Bookings | Après School", "Find your Après School site and continue to the correct booking platform."],
  "Holiday Clubs": ["Holiday Clubs | Après School", "Active, creative and well-run holiday care for primary-age children."],
  Wraparound: ["Wraparound Care | Après School", "Breakfast and after-school care that fits calmly around the school day."],
  Schools: ["For Schools | Après School", "Reliable wraparound care and enrichment partnerships for schools."],
  Contact: ["Contact | Après School", "Contact Après School about clubs, school partnerships and staffing."],
  "Staff Application": ["Staff Application | Après School", "Apply to work with Après School through the staff onboarding form."],
  Magicbooking: ["Magicbooking Guide | Après School", "How parents can book Après School provision through Magicbooking."],
  "Book Pebble": ["Book Pebble Guide | Après School", "How parents can book selected Après holiday camps through Book Pebble."],
  Payments: ["Payments & Vouchers | Après School", "Payment options, childcare vouchers and booking-platform guidance."],
  Cancellations: ["Cancellations & Amendments | Après School", "Guidance for amending or cancelling Après School bookings."],
  Policies: ["Policies | Après School", "Safeguarding, behaviour, health and safety, privacy and complaints policy summaries."],
};

function staffAssignments(person) {
  if (Array.isArray(person?.siteAssignments) && person.siteAssignments.length) return person.siteAssignments;
  if (person?.location) return [{ school: person.location, role: person.role, startDate: "", endDate: "", status: "Active" }];
  return [];
}

function staffSchoolNames(person) {
  return staffAssignments(person).map((assignment) => assignment.school).filter(Boolean);
}

function staffPrimaryLocation(person) {
  const assignments = staffAssignments(person);
  if (!assignments.length) return "Unassigned";
  if (assignments.length === 1) return assignments[0].school;
  return `${assignments[0].school} +${assignments.length - 1}`;
}

function staffAssignedToSchool(person, school) {
  return staffSchoolNames(person).includes(school);
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
  const parsed = new Date(`${value}T00:00:00`);
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

const mockPlatformData = {
  staff: [],
  sessions: [],
  documents: [],
  enquiries: [],
  rewards: [],
  source: "Loading",
  loading: false,
  error: "",
};
const demoLoginEnabled = import.meta.env.DEV && !hasSupabaseConfig;
const demoLogins = [
  { label: "Staff Demo", email: "staff.demo@apres-school.local", role: "Staff" },
  { label: "Manager Demo", email: "sample.staff.a@apres-school.local", role: "Manager" },
  { label: "Admin Demo", email: "admin.demo@apres-school.local", role: "Admin" },
];
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
const staffApplicationsStorageKey = "apres-staff-applications";
const onboardedStaffStorageKey = "apres-onboarded-staff";
const scrChecklistStorageKey = "apres-scr-checklists";
const scrRenewalRequestsStorageKey = "apres-scr-renewal-requests";
const ofstedLogsStorageKey = "apres-ofsted-site-logs";
const ofstedInspectionDayStorageKey = "apres-ofsted-inspection-day";
const ofstedGapOwnersStorageKey = "apres-ofsted-gap-owners";
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
const nextCamp = {
  title: "May Half Term Camp",
  dates: "26-29 May",
  bookingUrl: pagePaths.Bookings,
  sites: ["Willington Prep", "The Rowans", "King's House School"],
  note: "Choose your site on the bookings page for timings and live availability.",
  dailyThemes: [
    ["Tuesday", "Adventure Quest", "Treasure hunts, obstacle courses, outdoor missions and team challenges."],
    ["Wednesday", "Creative Makers Studio", "Arts, crafts, messy play and imaginative building activities."],
    ["Thursday", "Ultimate Games Arena", "Dodgeball, football, relay races, capture the flag and team competitions."],
    ["Friday", "Festival Finale", "Music, dancing, party games, talent challenges and end-of-week surprises."],
  ],
};

const bookingSites = [
  {
    title: "Willington Prep",
    type: "After-school care",
    category: "Wraparound",
    area: "Wimbledon",
    description: "After-school care from the end of the school day to 18:00.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.willingtonTile,
    imagePosition: "center",
    schedule: "After-school care, 15:30-18:00.",
    ages: "Willington Prep families.",
    bookingNote: "Use Magicbooking and select the Willington Prep centre.",
    beforeBooking: "Check that Willington Prep is selected before choosing dates.",
  },
  {
    title: "King's House School",
    type: "After-school care",
    category: "Wraparound",
    area: "Richmond",
    description: "After-school care with a friendly team and calm collection routines.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.kingsHouseTile,
    imagePosition: "center",
    schedule: "After-school care, 15:15-18:00.",
    ages: "King's House School families.",
    bookingNote: "Use Magicbooking and select the King's House School centre.",
    beforeBooking: "Check that King's House School is selected before choosing dates.",
  },
  {
    title: "Shrewsbury House School",
    type: "Breakfast & after-school care",
    category: "Wraparound",
    area: "Surbiton",
    description: "Breakfast club and after-school care at the same school location.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.shrewsburyHouseTile,
    imagePosition: "center",
    schedule: "Breakfast 07:30-08:00 and after-school 15:00-18:00.",
    ages: "Shrewsbury House School families.",
    bookingNote: "Use Magicbooking and select the Shrewsbury House School centre.",
    beforeBooking: "Breakfast and after-school sessions sit under the same school route.",
  },
  {
    title: "Ripley Court School",
    type: "After-school care",
    category: "Wraparound",
    area: "Surrey",
    description: "After-school care shaped around the school day and family collection times.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.ripleyCourtTile,
    imagePosition: "center",
    schedule: "After-school care, 15:00-18:00.",
    ages: "Ripley Court School families.",
    bookingNote: "Use Magicbooking and select the Ripley Court School centre.",
    beforeBooking: "Check that Ripley Court School is selected before choosing dates.",
  },
  {
    title: "Holiday Camp at King's House School",
    type: "Holiday camp",
    category: "Holiday Camps",
    area: "Richmond",
    description: "Open-access holiday camp for children from all schools.",
    provider: "Book Pebble",
    url: PEBBLE_KINGS_ROWANS_URL,
    image: APRES_IMG.kingsHouseTile,
    imagePosition: "center",
    schedule: "School holiday dates published by camp.",
    ages: "Open to children from all schools.",
    bookingNote: "Use Book Pebble for this camp and check published dates before booking.",
    beforeBooking: "Confirm the camp location, date range and age guidance on the Book Pebble listing.",
  },
  {
    title: "Holiday Enrichment at Willington Prep",
    type: "Holiday enrichment",
    category: "Holiday Camps",
    area: "Wimbledon",
    description: "Creative holiday enrichment at Willington Prep.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.willingtonTile,
    imagePosition: "center",
    schedule: "Holiday enrichment dates published by programme.",
    ages: "Primary-age children.",
    bookingNote: "Use Magicbooking and select the Willington Prep centre/activity.",
    beforeBooking: "Confirm the correct Willington Prep activity and dates inside Magicbooking.",
  },
  {
    title: "Holiday Camp at Ripley Court School",
    type: "Holiday camp",
    category: "Holiday Camps",
    area: "Surrey",
    description: "Holiday camp provision for Ripley Court School pupils.",
    provider: "Magicbooking",
    url: MAGICBOOKING_URL,
    image: APRES_IMG.ripleyCourtTile,
    imagePosition: "center",
    schedule: "Holiday camp dates published by school arrangement.",
    ages: "Exclusive to Ripley Court School pupils.",
    bookingNote: "Use Magicbooking and select the Ripley Court activity.",
    beforeBooking: "This provision is school-specific, so check eligibility before booking.",
  },
  {
    title: "Holiday Camp at The Rowans School",
    type: "Holiday camp",
    category: "Holiday Camps",
    area: "Wimbledon",
    description: "Open-access holiday camp at The Rowans School.",
    provider: "Book Pebble",
    url: PEBBLE_KINGS_ROWANS_URL,
    image: APRES_IMG.rowansTile,
    imagePosition: "center",
    schedule: "Holiday dates published by camp.",
    ages: "Open to children from all schools.",
    bookingNote: "Use Book Pebble for this camp and check the activity listing.",
    beforeBooking: "Review the Book Pebble listing for dates, age range and drop-off information.",
  },
  {
    title: "Holiday Camp at Shrewsbury House School",
    type: "Holiday camp",
    category: "Holiday Camps",
    area: "Surbiton",
    description: "Open-access holiday camp at Shrewsbury House School.",
    provider: "Book Pebble",
    url: PEBBLE_SHREWSBURY_URL,
    image: APRES_IMG.shrewsburyHouseTile,
    imagePosition: "center",
    schedule: "Holiday dates published by camp.",
    ages: "Open to children from all schools.",
    bookingNote: "Use Book Pebble for this camp and check the activity listing.",
    beforeBooking: "Review the Book Pebble listing for dates, age range and drop-off information.",
  },
];

const activityZones = [
  ["Creative Studio", "Art, construction, drama and imagination-led projects."],
  ["Active Games", "Outdoor play, team challenges and movement for every confidence level."],
  ["Discovery Time", "STEM, problem solving, themed projects and hands-on learning."],
  ["Calm Corner", "Reading, drawing, homework space and decompression after a busy day."],
];

const parentFaqs = [
  ["How do I book?", "Choose your school or camp on the Bookings page. Most wraparound care uses Magicbooking, while some holiday camps use Book Pebble."],
  ["Do I need a Magicbooking account?", "Yes for Magicbooking sites. Create or log into your account, add your child, select your centre, then book the relevant activity."],
  ["Can I amend or cancel bookings?", "Magicbooking allows parents to view bookings, payments and permitted amendments from their account. Cancellation rules depend on the activity."],
  ["Can I pay with childcare vouchers?", "Yes, where supported by the booking platform and your chosen site. The full payment options should be confirmed during booking."],
  ["What ages do you support?", "Age ranges vary by site and programme. The relevant booking page will show which children can attend each club or camp."],
  ["Are staff checked?", "Staff are recruited through safer recruitment processes, DBS checks and training expectations appropriate to their role."],
  ["What should children bring?", "Comfortable clothes, a water bottle, weather-appropriate layers and any required packed lunch or medication for the session."],
  ["Who do I contact about collection?", "Use your booking platform details for routine booking questions, or contact Après School directly for site-specific support."],
];

const bookingRoutes = [
  ["Magicbooking", "Wraparound care and selected school-specific holiday programmes.", "Best for parents booking regular or ad-hoc school provision.", MAGICBOOKING_URL],
  ["Book Pebble", "Selected holiday camps where the camp listing, dates and checkout are handled separately.", "Best for open-access holiday camp places at listed sites.", PEBBLE_KINGS_ROWANS_URL],
  ["Need help choosing?", "Use the site cards below first. If your school or camp is not obvious, contact the team before booking.", "Best when you are unsure which platform applies.", null],
];

function getInitialPage() {
  return pathPages[window.location.pathname] || "Home";
}

export default function App() {
  const [page, setPage] = useState(getInitialPage);
  const [platform, setPlatform] = useState(isPlatformPath);
  const [passwordRecovery, setPasswordRecovery] = useState(hasRecoveryHash);
  const [platformUnlocked, setPlatformUnlocked] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [role, setRole] = useState("Admin");
  const [tab, setTab] = useState("Admin");
  const [menu, setMenu] = useState(false);
  const [platformData, setPlatformData] = useState(mockPlatformData);
  const authUserIdRef = useRef(null);

  useEffect(() => {
    const meta = pageMeta[page] || pageMeta.Home;
    if (passwordRecovery) {
      document.title = "Reset Password | Après School";
      return;
    }
    if (platform) {
      document.title = "Staff Login | Après School";
      if (window.location.pathname !== "/staff-login") window.history.pushState({ page: "Staff Login" }, "", "/staff-login");
      return;
    }
    document.title = meta[0];
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", meta[1]);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    const canonical = document.querySelector('link[rel="canonical"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogTitle) ogTitle.setAttribute("content", meta[0]);
    if (ogDescription) ogDescription.setAttribute("content", meta[1]);
    if (twitterTitle) twitterTitle.setAttribute("content", meta[0]);
    if (twitterDescription) twitterDescription.setAttribute("content", meta[1]);
    const nextPath = pagePaths[page] || "/";
    const canonicalUrl = `https://www.apres-school.co.uk${nextPath}`;
    if (canonical) canonical.setAttribute("href", canonicalUrl);
    if (ogUrl) ogUrl.setAttribute("content", canonicalUrl);
    if (window.location.pathname !== nextPath) window.history.pushState({ page }, "", nextPath);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page, platform, passwordRecovery]);

  useEffect(() => {
    function handlePopState() {
      setPasswordRecovery(hasRecoveryHash());
      setPlatform(isPlatformPath());
      setPage(getInitialPage());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!platform) return undefined;

    if (!hasSupabaseConfig) {
      setAuthLoading(false);
      setPlatformUnlocked(false);
      setRole("Staff");
      setTab("Staff");
      return undefined;
    }

    let active = true;
    let listener;
    setAuthLoading(true);

    async function loadSession() {
      const { supabase } = await loadSupabaseModule();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      await applySession(data.session);
      listener = supabase.auth.onAuthStateChange((_event, session) => {
        applySession(session);
      }).data.subscription;
      if (active) setAuthLoading(false);
    }

    loadSession().catch(() => {
      if (!active) return;
      setAuthLoading(false);
      setPlatformUnlocked(false);
    });

    return () => {
      active = false;
      listener?.unsubscribe();
    };
  }, [platform]);

  async function applySession(session) {
    const user = session?.user || null;
    const sameSignedInUser = user?.id && authUserIdRef.current === user.id;

    if (!user) {
      authUserIdRef.current = null;
      setAuthUser(null);
      setPlatformUnlocked(false);
      setRole("Staff");
      setTab("Staff");
      return;
    }

    if (sameSignedInUser) {
      setPlatformUnlocked(true);
      return;
    }

    authUserIdRef.current = user.id;
    setAuthUser(user);
    setPlatformUnlocked(true);

    try {
      const { getProfileRole } = await loadSupabaseModule();
      const nextRole = await getProfileRole(user.id);
      setRole(nextRole);
      setTab(nextRole === "Staff" ? "Staff" : "Admin");
    } catch {
      setRole("Staff");
      setTab("Staff");
    }
  }

  async function handleAuthenticated(user) {
    await applySession({ user });
    setPlatformUnlocked(true);
    setPasswordRecovery(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDemoAuthenticated(demoUser) {
    const demoData = await loadMockPlatformData();
    setAuthUser({ id: `demo-${demoUser.role.toLowerCase()}`, email: demoUser.email, app_metadata: { demo: true } });
    setRole(demoUser.role);
    setTab(demoUser.role === "Staff" ? "Staff" : "Admin");
    setPlatformData({
      ...demoData,
      source: "Local demo data",
      error: "",
    });
    setPlatformUnlocked(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSignOut() {
    if (hasSupabaseConfig) {
      const { signOutStaff } = await loadSupabaseModule();
      await signOutStaff();
    }
    setAuthUser(null);
    setPlatformUnlocked(false);
    setRole("Staff");
    setTab("Staff");
    setPlatformData(mockPlatformData);
    setPlatform(false);
  }

  useEffect(() => {
    if (!platformUnlocked || !authUser) {
      setPlatformData(mockPlatformData);
      return undefined;
    }

    if (authUser.app_metadata?.demo) {
      loadMockPlatformData().then((demoData) => {
        setPlatformData({
          ...demoData,
          source: "Local demo data",
          loading: false,
          error: "",
        });
      });
      return undefined;
    }

    let active = true;
    setPlatformData((current) => ({ ...current, loading: true, error: "" }));

    Promise.all([
      loadSupabaseModule().then(({ fetchPlatformData }) => fetchPlatformData({ userId: authUser.id, role })),
      loadMockPlatformData(),
    ])
      .then(([nextData, demoData]) => {
        if (!active) return;
        setPlatformData({
          ...demoData,
          ...nextData,
          rewards: nextData.rewards?.length ? nextData.rewards : demoData.rewards,
          source: "Supabase",
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        loadMockPlatformData().then((demoData) => {
          if (!active) return;
          setPlatformData({
            ...demoData,
            loading: false,
            error: error.message || "Unable to load live platform data.",
          });
        });
      });

    return () => {
      active = false;
    };
  }, [platformUnlocked, authUser, role]);

  return (
    <div>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header
        page={page}
        setPage={setPage}
        platform={platform}
        setPlatform={setPlatform}
        platformUnlocked={platformUnlocked}
        menu={menu}
        setMenu={setMenu}
      />
      {platform
        ? platformUnlocked
          ? (
            <Suspense fallback={<main className="login-page" id="main-content"><section className="login-card"><p className="eyebrow">Internal platform</p><h1>Loading workspace...</h1></section></main>}>
              <Platform role={role} tab={tab} setTab={setTab} userEmail={authUser?.email} onSignOut={handleSignOut} data={platformData} />
            </Suspense>
          )
          : <PlatformLogin authLoading={authLoading} setPlatform={setPlatform} onAuthenticated={handleAuthenticated} onDemoAuthenticated={handleDemoAuthenticated} />
        : passwordRecovery
          ? <PasswordReset onAuthenticated={handleAuthenticated} setPlatformMode={setPlatform} setPasswordRecovery={setPasswordRecovery} />
          : <PublicSite page={page} setPage={setPage} />}
    </div>
  );
}

function Header({ page, setPage, platform, setPlatform, platformUnlocked, menu, setMenu }) {
  return (
    <header className="site-header">
      <a className="brand" href="#home" onClick={() => { setPlatform(false); setPage("Home"); }}>
        <img src="/assets/apres-school-text.png" alt="Après School" />
        <strong>Après School</strong>
        <span>Let's Learn and Play</span>
      </a>
      <button className="icon-button mobile-only" type="button" onClick={() => setMenu(!menu)} aria-label="Toggle navigation" aria-expanded={menu}>
        {menu ? "Close" : "Menu"}
      </button>
      <nav className={menu ? "nav open" : "nav"}>
        {!platform && nav.map((item) => (
          <button key={item} type="button" aria-current={page === item ? "page" : undefined} className={page === item ? "active" : ""} onClick={() => { setPage(item); setMenu(false); }}>
            {item}
          </button>
        ))}
        {!platform && <button className="nav-staff-login" type="button" onClick={() => { setPlatform(true); setMenu(false); }}>Staff Login</button>}
        {platform && platformUnlocked && <span className="secure-label">Signed in</span>}
      </nav>
      <button className="button book" type="button" onClick={() => platform ? setPlatform(false) : setPage("Bookings")}>
        {platform ? "Public Website" : "Book Now"}
      </button>
      {!platform && <button className="button staff-login" type="button" onClick={() => setPlatform(true)}>Staff Login</button>}
    </header>
  );
}

function PublicSite({ page, setPage, setPlatform }) {
  return (
    <main id="main-content">
      {page === "Home" && <CampAnnouncement setPage={setPage} />}
      {page === "Home" && <Home setPage={setPage} setPlatform={setPlatform} />}
      {page === "Bookings" && <Bookings setPage={setPage} />}
      {page === "Holiday Clubs" && <HolidayClubs setPage={setPage} />}
      {page === "Wraparound" && <Wraparound setPage={setPage} />}
      {page === "About" && <About />}
      {page === "Services" && <Services />}
      {page === "Parents" && <Parents />}
      {page === "Schools" && <Schools setPage={setPage} />}
      {page === "Magicbooking" && <MagicbookingGuide setPage={setPage} />}
      {page === "Book Pebble" && <BookPebbleGuide setPage={setPage} />}
      {page === "Payments" && <Payments setPage={setPage} />}
      {page === "Cancellations" && <Cancellations setPage={setPage} />}
      {page === "Policies" && <Policies setPage={setPage} />}
      {page === "Contact" && <Contact setPage={setPage} />}
      {page === "Staff Application" && <StaffApplication />}
      <Footer setPage={setPage} />
      <MobileCTA page={page} setPage={setPage} />
    </main>
  );
}

function CampAnnouncement({ setPage }) {
  const settings = readPublicSettings();
  const [closed, setClosed] = useState(() => sessionStorage.getItem("apres-camp-announcement-closed") === "true");
  if (!settings.campAnnouncementEnabled || closed) return null;

  function close() {
    sessionStorage.setItem("apres-camp-announcement-closed", "true");
    setClosed(true);
  }

  return (
    <aside className="camp-announcement" role="dialog" aria-modal="true" aria-label={`${nextCamp.title} announcement`}>
      <div className="camp-announcement-card">
        <button className="announcement-close" type="button" onClick={close} aria-label="Close camp announcement">×</button>
        <div className="announcement-copy">
          <div className="announcement-pills">
            <span>Next camp</span>
            <span>{nextCamp.dates}</span>
          </div>
          <h2>{nextCamp.title}</h2>
          <p className="announcement-lede">Four lively days of games, making, outdoor challenges and festival-style fun.</p>
          <div className="announcement-sites">
            {nextCamp.sites.map((site) => <span key={site}>{site}</span>)}
          </div>
          <p>{nextCamp.note}</p>
          <div className="hero-actions">
            <button className="button book" type="button" onClick={() => setPage("Bookings")}>Book Camp</button>
            <button className="button light" type="button" onClick={() => setPage("Holiday Clubs")}>View Schedule</button>
          </div>
        </div>
        <div className="announcement-theme-panel">
          <p className="eyebrow">Daily themes</p>
          <div className="announcement-themes">
            {nextCamp.dailyThemes.map(([day, title]) => (
              <article key={day}>
                <strong>{day}</strong>
                <span>{title}</span>
              </article>
            ))}
          </div>
          <p>Timings vary by site. Select your venue on the bookings page for the live details.</p>
        </div>
      </div>
    </aside>
  );
}

function Home({ setPage, setPlatform }) {
  const [homeType, setHomeType] = useState("Wraparound");
  const homeServices = [
    {
      title: "Holiday Clubs",
      text: "School-holiday days with active games, creative workshops, visiting activities and calmer moments built into the rhythm.",
      detail: "Open camps at selected schools",
      target: "Holiday Clubs",
      image: APRES_IMG.scienceActivity,
      imagePosition: "48% 48%",
      action: "Explore holiday clubs",
      Icon: CalendarDays,
    },
    {
      title: "Wraparound Care",
      text: "Before and after school care with familiar adults, flexible play, a calm routine and a simple route to book.",
      detail: "Breakfast and after-school care",
      target: "Wraparound",
      image: APRES_IMG.homeWraparoundPrivacy,
      imagePosition: "50% 50%",
      action: "View wraparound care",
      Icon: Clock,
    },
    {
      title: "School Partnerships",
      text: "Warm delivery for families, dependable operations for schools and clear systems behind every session.",
      detail: "Provision designed with your school",
      target: "Schools",
      image: APRES_IMG.homeSchoolPrivacy,
      imagePosition: "50% 50%",
      action: "Partner with us",
      Icon: ShieldCheck,
    },
  ];
  const homeBookingRoutes = [
    { category: "Wraparound", title: "Willington Prep", area: "Wimbledon", ages: "15:30-18:00", provider: "Magicbooking", url: MAGICBOOKING_URL },
    { category: "Wraparound", title: "King's House School", area: "Richmond", ages: "15:15-18:00", provider: "Magicbooking", url: MAGICBOOKING_URL },
    { category: "Wraparound", title: "Shrewsbury House School", area: "Surbiton", ages: "Breakfast 07:30-08:00 · After-school 15:00-18:00", provider: "Magicbooking", url: MAGICBOOKING_URL },
    { category: "Wraparound", title: "Ripley Court School", area: "Surrey", ages: "15:00-18:00", provider: "Magicbooking", url: MAGICBOOKING_URL },
    ...bookingSites
      .filter((site) => site.category === "Holiday Camps")
      .map((site) => ({ category: site.category, title: site.title, area: site.area, ages: site.ages, provider: site.provider, url: site.url })),
  ];
  const [homeSiteTitle, setHomeSiteTitle] = useState(homeBookingRoutes[0].title);
  const homeSites = homeBookingRoutes.filter((site) => site.category === homeType);
  const selectedHomeSite = homeSites.find((site) => site.title === homeSiteTitle) || homeSites[0];
  function chooseHomeType(nextType) {
    const nextSites = homeBookingRoutes.filter((site) => site.category === nextType);
    setHomeType(nextType);
    setHomeSiteTitle(nextSites[0]?.title || "");
  }

  return (
    <>
      <section className="hero">
        <div className="hero-media">
          <div className="hero-copy">
            <h1>Out of school care children look forward to.</h1>
            <p>
              Breakfast clubs, after-school care and holiday camps with friendly teams, active days and simple booking routes.
            </p>
            <div className="hero-actions">
              <button className="button book large" type="button" onClick={() => setPage("Bookings")}>Book Now</button>
              <button className="button white" type="button" onClick={() => setPage("Holiday Clubs")}>Holiday Clubs</button>
              <button className="button ghost" type="button" onClick={() => setPage("Schools")}>For Schools</button>
            </div>
            <div className="hero-highlights">
              <span>Ofsted registered settings</span>
              <span>Partner school provision</span>
              <span>Easy booking routes</span>
            </div>
          </div>
        </div>
      </section>
      <section className="club-finder">
        <div>
          <h2>Find your club</h2>
          <p>Choose term-time care or holiday clubs, then pick your school or camp.</p>
        </div>
        <form className="route-picker">
          <select aria-label="Care type" value={homeType} onChange={(event) => chooseHomeType(event.target.value)}>
            <option value="Wraparound">Wraparound care</option>
            <option value="Holiday Camps">Holiday clubs</option>
          </select>
          <select aria-label="School or camp" value={selectedHomeSite?.title || ""} onChange={(event) => setHomeSiteTitle(event.target.value)}>
            {homeSites.map((site) => <option key={site.title} value={site.title}>{site.title}</option>)}
          </select>
          {selectedHomeSite
            ? <a className="button book" href={selectedHomeSite.url} target="_blank" rel="noreferrer">Open {selectedHomeSite.provider === "Book Pebble" ? "Pebble" : selectedHomeSite.provider}</a>
            : <button className="button book" type="button" onClick={() => setPage("Bookings")}>View Sites</button>}
        </form>
      </section>
      <section className="club-tabs">
        {homeServices.map(({ title, text, detail, target, image, imagePosition, action, Icon }) => (
          <article key={title} style={{ backgroundImage: `url("${image}")`, backgroundPosition: imagePosition }}>
            <span><Icon /></span>
            <h3>{title}</h3>
            <p>{text}</p>
            <small>{detail}</small>
            <button className="text-link" type="button" onClick={() => setPage(target)}>{action}</button>
          </article>
        ))}
      </section>
      <section className="welcome-band">
        <div className="welcome-inner">
          <p className="eyebrow">Trusted by families and schools</p>
          <h2>Playful for children. Reassuring for parents. Easy for schools to stand behind.</h2>
          <p>The club experience feels warm and relaxed. Behind it are clear routines, safer recruitment expectations and a team that understands school sites.</p>
          <div className="proof-row">
            <span><ShieldCheck /> Safer recruitment</span>
            <span><Clock /> School-day reliability</span>
            <span><Sparkles /> Excellent school relationships</span>
          </div>
        </div>
      </section>
      <section className="home-experience-band">
        <div className="home-experience-inner">
          <div className="home-experience-copy">
            <p className="eyebrow">A better end to the school day</p>
            <h2>Children can move, make, reset and belong.</h2>
            <p>After a busy day at school, some children need space to run. Others need a quieter corner, a snack, a familiar adult or a creative project. Good provision makes room for all of it.</p>
            <button className="button light" type="button" onClick={() => setPage("Wraparound")}>See the daily rhythm</button>
          </div>
          <div className="home-photo-stack" aria-hidden="true">
            <div style={{ backgroundImage: `url("${APRES_IMG.bubbleExperience}")`, backgroundPosition: "45% 50%" }} />
            <div style={{ backgroundImage: `url("${APRES_IMG.shavingFoam}")`, backgroundPosition: "52% 50%" }} />
            <div style={{ backgroundImage: `url("${APRES_IMG.scienceActivity}")`, backgroundPosition: "48% 48%" }} />
          </div>
        </div>
      </section>
      <section className="home-school-band">
        <div className="home-school-inner">
          <div>
            <p className="eyebrow">For schools</p>
            <h2>A childcare partner that protects your day and strengthens your parent offer.</h2>
            <p>We build provision around your timetable, spaces and families, then support it with staffing discipline, compliance records and practical communication.</p>
            <button className="button book" type="button" onClick={() => setPage("Schools")}>Explore School Partnerships</button>
          </div>
          <div className="home-school-features">
            {[
              ["Operational calm", "Clear routines, handovers and cover thinking for busy school weeks."],
              ["Safeguarding confidence", "Safer recruitment records, policy acknowledgement and training expectations."],
              ["Family-friendly delivery", "Warm staff, engaging activities and communication parents can understand quickly."],
            ].map(([title, text]) => (
              <article key={title}>
                <ShieldCheck />
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function PasswordReset({ onAuthenticated, setPlatformMode, setPasswordRecovery }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ tone: "info", message: "Checking your password reset link..." });
  const [ready, setReady] = useState(false);
  const updating = status?.tone === "info" && status.message === "Updating your password...";

  useEffect(() => {
    let active = true;

    async function prepareRecovery() {
      if (!hasSupabaseConfig) {
        setStatus({ tone: "warn", message: "Supabase Auth is not configured for this deployment yet." });
        return;
      }

      try {
        const { supabase } = await loadSupabaseModule();
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) throw error;
        if (!data.session) {
          setStatus({ tone: "bad", message: "This password reset link has expired or has already been used. Please request a fresh reset email." });
          return;
        }
        setReady(true);
        setStatus({ tone: "info", message: "Choose a new password for your staff account." });
      } catch (error) {
        if (!active) return;
        setStatus({ tone: "bad", message: error.message || "Unable to read this password reset link. Please request a fresh reset email." });
      }
    }

    prepareRecovery();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event) {
    event.preventDefault();

    if (password.length < 8) {
      setStatus({ tone: "bad", message: "Please use at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ tone: "bad", message: "Those passwords do not match." });
      return;
    }

    setStatus({ tone: "info", message: "Updating your password..." });

    try {
      const { supabase, updateStaffPassword } = await loadSupabaseModule();
      await updateStaffPassword(password);
      const { data } = await supabase.auth.getSession();
      window.history.replaceState({ page: "Staff Login" }, "", "/staff-login");
      setPasswordRecovery(false);
      setPlatformMode(true);
      if (data.session?.user) await onAuthenticated(data.session.user);
      setStatus({ tone: "good", message: "Password updated. Opening your staff workspace..." });
    } catch (error) {
      setStatus({ tone: "bad", message: error.message || "Unable to update your password. Please request a fresh reset email." });
    }
  }

  return (
    <main className="login-page" id="main-content">
      <section className="login-card">
        <p className="eyebrow">Password Reset</p>
        <h1>Set a new staff password</h1>
        <p>Use this page to finish your secure Après School staff account reset.</p>
        <form className="compact-form" onSubmit={submit}>
          <label>New password<input required disabled={!ready} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
          <label>Confirm password<input required disabled={!ready} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat new password" /></label>
          <button className="button book" type="submit" disabled={!ready || updating}>{updating ? "Updating..." : "Update Password"}</button>
        </form>
        {status && <p className={`login-status ${status.tone}`}>{status.message}</p>}
        <p className="security-note">If this link has expired, request another password reset from Supabase Auth.</p>
      </section>
    </main>
  );
}

function PlatformLogin({ authLoading, setPlatform, onAuthenticated, onDemoAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(null);

  async function submit(event) {
    event.preventDefault();

    if (!hasSupabaseConfig) {
      setStatus({ tone: "warn", message: "Supabase Auth is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable staff login." });
      return;
    }

    setStatus({ tone: "info", message: "Checking your staff account..." });

    try {
      const { signInStaff } = await loadSupabaseModule();
      const { user } = await signInStaff(email, password);
      await onAuthenticated(user);
      setStatus(null);
    } catch (error) {
      setStatus({ tone: "bad", message: error.message || "Unable to sign in. Check your email and password." });
    }
  }

  return (
    <main className="login-page" id="main-content">
      <section className="login-card">
        <p className="eyebrow">Staff Login</p>
        <h1>Secure staff and admin access</h1>
        <p>
          Internal dashboards, compliance records and operational tools stay protected behind staff accounts.
        </p>
        <form className="compact-form" onSubmit={submit}>
          <label>Email<input required type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@apres-school.co.uk" /></label>
          <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" /></label>
          <button className="button book" type="submit" disabled={authLoading || status?.tone === "info"}>{authLoading || status?.tone === "info" ? "Checking..." : "Log In"}</button>
        </form>
        {status && <p className={`login-status ${status.tone}`}>{status.message}</p>}
        {!hasSupabaseConfig && <p className="login-status warn">Real staff access is locked until Supabase environment variables are configured.</p>}
        {demoLoginEnabled && (
          <div className="demo-login">
            <strong>Local preview access</strong>
            <p>Available only in local development while Supabase Auth is not connected.</p>
            <div>
              {demoLogins.map((demoUser) => (
                <button className="button light" key={demoUser.email} type="button" onClick={() => onDemoAuthenticated(demoUser)}>
                  {demoUser.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="security-note">Use your staff account only. Shared devices should be signed out after use.</p>
        <div className="login-actions">
          <button className="button light" type="button" onClick={() => setPlatform(false)}>Back to Website</button>
        </div>
      </section>
    </main>
  );
}

function TrustStrip() {
  return (
    <section className="trust-strip">
      <div><strong>Care</strong><span>Friendly provision built around each school community.</span></div>
      <div><strong>6pm</strong><span>After-school provision at selected schools.</span></div>
      <div><strong>4</strong><span>Registered current school sites.</span></div>
      <div><strong>Easy</strong><span>Choose your site, then book in the right place.</span></div>
    </section>
  );
}

function Bookings({ setPage }) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const wraparoundCount = bookingSites.filter((site) => site.category === "Wraparound").length;
  const campCount = bookingSites.filter((site) => site.category === "Holiday Camps").length;
  const filteredSites = bookingSites.filter((site) => {
    const matchesFilter = filter === "All" || site.category === filter || site.provider === filter;
    const text = `${site.title} ${site.type} ${site.area} ${site.description}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });
  const bookingSteps = [
    ["1", "Choose the care type", "Term-time care and holiday camps can use different systems."],
    ["2", "Select your school", "Each card below shows the exact school or camp location."],
    ["3", "Use that card's button", "The button opens the correct platform for that site."],
  ];

  return (
    <PageShell eyebrow="Bookings" title="Find your school or camp. Then book in the right place.">
      <section className="booking-intro">
        <div>
          <h2>Start with the location, not the platform.</h2>
          <p>
            Pick the school or camp first. We will then point you to Magicbooking or Pebble,
            depending on how that site is currently managed.
          </p>
          <div className="booking-quick-actions">
            <button className="button book large" type="button" onClick={() => setFilter("Wraparound")}>Term-Time Care</button>
            <button className="button white" type="button" onClick={() => setFilter("Holiday Camps")}>Holiday Camps</button>
          </div>
        </div>
        <div className="booking-platform-card">
          <span>Current booking route</span>
          <strong>One directory. Two booking systems.</strong>
          <p>Use the site card below and you will land in the right place.</p>
          <div className="booking-route-mini">
            <span>{wraparoundCount} wraparound sites</span>
            <span>{campCount} camp routes</span>
          </div>
        </div>
      </section>
      <section className="booking-route-strip" aria-label="How bookings work">
        {bookingSteps.map(([number, title, text]) => (
          <article key={title}>
            <strong>{number}</strong>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="booking-directory-heading">
        <div>
          <p className="eyebrow">Site directory</p>
          <h2>Choose the card for your school or camp.</h2>
        </div>
        <p>Filter by care type or platform. Each card shows who it is for, when it runs and which booking system to open.</p>
        <span className="booking-count">Showing {filteredSites.length} of {bookingSites.length}</span>
      </section>
      <section className="booking-filters">
        <div className="filter-pills">
          {["All", "Wraparound", "Holiday Camps", "Magicbooking", "Book Pebble"].map((item) => (
            <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by school, area or programme" />
      </section>
      <div className="booking-grid">
        {filteredSites.map((site) => (
          <article className="booking-card" key={site.title}>
            <div className="booking-image" style={{ backgroundImage: `url("${site.image}")`, backgroundPosition: site.imagePosition }} />
            <div className="booking-card-top">
              <span>{site.type}</span>
              <strong className={site.provider === "Magicbooking" ? "magicbooking" : "pebble"}>Book via {site.provider === "Book Pebble" ? "Pebble" : site.provider}</strong>
            </div>
            <div className="booking-card-body">
              <h3>{site.title}</h3>
              <p>{site.description}</p>
            </div>
            <div className="booking-facts">
              <span>{site.area}</span>
              <span>{site.ages}</span>
            </div>
            <div className="booking-card-actions">
              <a className="button book" href={site.url} target="_blank" rel="noreferrer" aria-label={`Open ${site.provider === "Book Pebble" ? "Pebble" : site.provider} booking route for ${site.title}`}>Open {site.provider === "Book Pebble" ? "Pebble" : site.provider}</a>
            </div>
            <details className="site-detail">
              <summary>Before you book</summary>
              <p><strong>Schedule:</strong> {site.schedule}</p>
              <p><strong>Booking note:</strong> {site.bookingNote}</p>
              <p>{site.beforeBooking}</p>
            </details>
          </article>
        ))}
      </div>
      {!filteredSites.length && (
        <section className="empty-state">
          <h2>No matching sites found.</h2>
          <p>Try clearing the filter or contact Après School and we will point you to the right booking route.</p>
          <button className="button book" type="button" onClick={() => setPage("Contact")}>Ask for Help</button>
        </section>
      )}
      <section className="booking-help-grid">
        <InfoPanel title="Need Magicbooking help?" text="Create or log into your account, add your child, choose your centre and select the activity you need." action="Magicbooking guide" onClick={() => setPage("Magicbooking")} />
        <InfoPanel title="Need Book Pebble help?" text="Some holiday camps use Book Pebble. Check the camp listing, dates, age range and booking conditions before paying." action="Book Pebble guide" onClick={() => setPage("Book Pebble")} />
        <InfoPanel title="Payments and vouchers" text="Payment methods and childcare voucher handling depend on the booking platform and activity selected." action="Payment options" onClick={() => setPage("Payments")} />
      </section>
    </PageShell>
  );
}

function InfoPanel({ title, text, action, onClick }) {
  return <article className="info-panel"><h3>{title}</h3><p>{text}</p><button className="text-link" type="button" onClick={onClick}>{action}</button></article>;
}

function Notice({ title, text }) {
  return <section className="notice"><ShieldCheck /><div><h2>{title}</h2><p>{text}</p></div></section>;
}

function HolidayClubs({ setPage }) {
  const holidaySites = bookingSites.filter((site) => site.category === "Holiday Camps");

  return (
    <PageShell eyebrow="Holiday Clubs" title="Holiday clubs children are excited to come back to.">
      <section className="image-copy-band holiday" style={{ backgroundImage: `linear-gradient(90deg, rgba(23, 23, 47, 0.82), rgba(23, 23, 47, 0.24)), url("${APRES_IMG.parachute}")` }}>
        <div>
          <h2>Active, creative days with calm routines underneath.</h2>
          <p>
            Children can move, make, reset and belong through themed activities run by friendly staff at familiar school sites.
          </p>
          <div className="camp-hero-pills">
            <span>Primary-age children</span>
            <span>Selected partner schools</span>
            <span>Simple online booking</span>
          </div>
          <div className="hero-actions">
            <button className="button book large" type="button" onClick={() => setPage("Bookings")}>View Holiday Camps</button>
            <button className="button white" type="button" onClick={() => setPage("Contact")}>Ask a Question</button>
          </div>
        </div>
      </section>
      <NextCampCard setPage={setPage} />
      <section className="camp-site-directory">
        <div className="section-kicker">
          <p className="eyebrow">Where to book</p>
          <h2>Choose your camp location first.</h2>
          <p>Camp booking depends on the school site. Pick the location card below and use the button shown there; it will take you to the correct platform.</p>
        </div>
        <div className="camp-booking-note">
          <article>
            <span>Magicbooking</span>
            <strong>For selected school-linked holiday provision</strong>
            <p>Used for Willington Prep and Ripley Court holiday provision.</p>
          </article>
          <article>
            <span>Pebble</span>
            <strong>For selected open-access holiday camps</strong>
            <p>Used for King's House, The Rowans and Shrewsbury House camps.</p>
          </article>
        </div>
        <div className="camp-site-grid">
          {holidaySites.map((site) => (
            <article className="camp-site-card" key={site.title}>
              <div className="camp-site-image" style={{ backgroundImage: `url("${site.image}")`, backgroundPosition: site.imagePosition }} />
              <div className="camp-site-copy">
                <span className={site.provider === "Magicbooking" ? "platform-badge magicbooking" : "platform-badge pebble"}>
                  Book via {site.provider}
                </span>
                <h3>{site.title}</h3>
                <p>{site.description}</p>
                <div className="camp-site-facts">
                  <span>{site.area}</span>
                  <span>{site.ages}</span>
                </div>
                <a className="button book" href={site.url} target="_blank" rel="noreferrer">Open {site.provider === "Book Pebble" ? "Pebble" : site.provider}</a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="camp-promise">
        {[
          ["Move", "Active time", "Outdoor games, team challenges and sport-led play give children a proper chance to burn energy and build confidence.", "Football, tennis, relay games, obstacle missions and group challenges."],
          ["Make", "Creative choice", "Hands-on projects give children something to focus on, finish and feel proud of, without the day becoming too formal.", "Arts, construction, messy science, themed making and imagination-led play."],
          ["Reset", "Calmer rhythm", "Holiday days are busy, so we build in gentler moments where children can eat, chat, draw, read or simply take a breather.", "Quiet tables, lunch routines, drawing, stories and softer small-group activities."],
        ].map(([title, label, text, detail]) => (
          <article className="camp-promise-card" key={title}>
            <span>{label}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            <small>{detail}</small>
          </article>
        ))}
      </section>
      <section className="camp-gallery">
        {[
          [APRES_IMG.campMoveFootball, "50% 48%"],
          [APRES_IMG.parachute, "50% 50%"],
          [APRES_IMG.campResetTennis, "50% 50%"],
        ].map(([src, position]) => <div key={src} style={{ backgroundImage: `url("${src}")`, backgroundPosition: position }} />)}
      </section>
    </PageShell>
  );
}

function NextCampCard({ setPage }) {
  return (
    <section className="next-camp-card">
      <div>
        <p className="eyebrow">Next camp</p>
        <h2>{nextCamp.title}</h2>
        <p>{nextCamp.dates} at {nextCamp.sites.join(", ")}. Four themed days with active games, creative making and a festival finish. Choose the location below to book on the right platform.</p>
        <div className="announcement-sites">
          {nextCamp.sites.map((site) => <span key={site}>{site}</span>)}
        </div>
        <button className="button book large" type="button" onClick={() => setPage("Bookings")}>Choose Camp Location</button>
      </div>
      <div className="camp-schedule">
        {nextCamp.dailyThemes.map(([day, title, text]) => (
          <article key={day}>
            <strong>{day}</strong>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Wraparound({ setPage }) {
  const wraparoundSites = bookingSites.filter((site) => site.category === "Wraparound");
  return (
    <PageShell eyebrow="Wraparound Care" title="Care around the school day, without the school-day rush.">
      <section className="wraparound-hero">
        <div className="wraparound-hero-copy">
          <p className="eyebrow">Breakfast and after-school care</p>
          <h2>A calm club at the edges of the school day.</h2>
          <p>Children get a warm welcome, a proper snack, space to play, quieter choices and a clear collection routine. Schools get provision that feels organised, familiar and easy for families to trust.</p>
          <div className="wraparound-hero-actions">
            <button className="button book large" type="button" onClick={() => setPage("Bookings")}>Book Wraparound Care</button>
            <button className="button light" type="button" onClick={() => setPage("Schools")}>For Schools</button>
          </div>
          <div className="wraparound-hero-proof">
            <span><strong>Breakfast</strong> where offered</span>
            <span><strong>After school</strong> to 18:00</span>
            <span><strong>Bookings</strong> via Magicbooking</span>
          </div>
        </div>
        <div className="wraparound-hero-media" aria-hidden="true">
          <div className="wraparound-hero-main-image" style={{ backgroundImage: `url("${APRES_IMG.wraparoundSchoolRun}")` }} />
          <div className="wraparound-hero-inset" style={{ backgroundImage: `url("${APRES_IMG.wraparoundSnackSpread}")` }} />
          <div className="wraparound-hero-note">
            <strong>Built around the school day</strong>
            <span>Snack, play, quieter choices and clear collection routines.</span>
          </div>
        </div>
      </section>

      <section className="wraparound-rhythm">
        <div>
          <p className="eyebrow">Daily rhythm</p>
          <h2>Simple, calm and easy for children to understand.</h2>
          <p>Wraparound care works best when the shape of the session feels predictable. Children know what happens first, what choices they have and how the day finishes.</p>
        </div>
        <div className="wraparound-rhythm-cards">
          {[
            ["01", "Arrive and settle", "Register, reconnect with staff, have a snack and decompress from the school day."],
            ["02", "Choose the pace", "Active games, construction, art, social play and quieter tables are available across the session."],
            ["03", "Finish well", "Children pack down calmly and collection is handled through clear site routines."],
          ].map(([step, title, text]) => (
            <article key={title}>
              <strong>{step}</strong>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wraparound-image-story">
        <article>
          <p className="eyebrow">What children experience</p>
          <h2>Enough structure to feel safe. Enough choice to feel like their time.</h2>
          <p>Some children need to move. Some want a table activity. Some need five quiet minutes before joining in. The session is built to make space for all of that without feeling over-programmed.</p>
          <ul>
            <li>Fresh snack and water routines children can rely on.</li>
            <li>Table activities, construction and creative choices for quieter moments.</li>
            <li>Active play and group games when children need to move.</li>
          </ul>
        </article>
        <div style={{ backgroundImage: `url("${APRES_IMG.wraparoundSchoolRun}")`, backgroundPosition: "50% 50%" }} />
      </section>

      <section className="wraparound-audience">
        {[
          ["For parents", "Reliable care without losing the warmth.", "A clear booking route, familiar adults and routines that help children finish the day well.", ["Simple booking by school", "Snack, play and calmer choices", "Clear collection routines"]],
          ["For schools", "Provision that supports the school office.", "We work around your timetable, spaces, collection points and parent communication so the club feels part of the school site.", ["Site-specific operating model", "Safeguarding-led staffing", "Responsive parent communication"]],
        ].map(([eyebrow, title, text, points]) => (
          <article key={eyebrow}>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p>{text}</p>
            <ul>
              {points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </article>
        ))}
      </section>

      <section className="wraparound-flow">
        <div>
          <p className="eyebrow">How a session feels</p>
          <h2>A predictable rhythm, with room for children to choose.</h2>
        </div>
        <div className="wraparound-flow-steps">
          {[
            ["Arrive", "Children are registered and welcomed by the team."],
            ["Snack", "A familiar food and water routine helps everyone reset."],
            ["Play", "Active games, table activities and quieter choices are available."],
            ["Collect", "The session winds down with a clear dismissal routine."],
          ].map(([title, text]) => (
            <article key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="wraparound-booking-panel">
        <div>
          <p className="eyebrow">Current booking route</p>
          <h2>Choose your school before you book.</h2>
          <p>Wraparound care currently books through Magicbooking. Start on the Bookings page so you can select the correct school centre first.</p>
          <button className="button book" type="button" onClick={() => setPage("Bookings")}>View Booking Sites</button>
        </div>
        <div className="wraparound-booking-list">
          {wraparoundSites.map((site) => (
            <article key={site.title}>
              <div>
                <strong>{site.title}</strong>
                <span>{site.type}</span>
              </div>
              <p>{site.schedule}</p>
              <small>{site.provider}</small>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function MagicbookingGuide({ setPage }) {
  return (
    <GuidePage
      eyebrow="Magicbooking"
      title="Magicbooking is used for most term-time care."
      intro="Use this route for breakfast club, after-school care and selected school-linked holiday provision."
      heroTitle="Book regular care without guessing the centre."
      platform="Magicbooking"
      routeLabel="Regular care"
      summary={[
        ["Used for", "Breakfast club, after-school care and selected school-specific holiday programmes."],
        ["Before you click", "Know your school centre and the sessions you want to book."],
        ["Good to check", "Child details, collection contacts, medical notes and payment method."],
      ]}
      steps={[
        ["Create or log in", "Use the Après School Magicbooking link and sign in or create a parent account."],
        ["Add your child", "Complete child details, emergency contacts and any required medical or collection information."],
        ["Choose your centre", "Select the relevant school or activity centre, then choose the sessions you need."],
        ["Review and pay", "Check dates, fees, terms and payment options before confirming your booking."],
      ]}
      checklist={["Willington Prep", "King's House School", "Shrewsbury House School", "Ripley Court School"]}
      cta="Open Magicbooking"
      href={MAGICBOOKING_URL}
      secondary="View Booking Sites"
      onSecondary={() => setPage("Bookings")}
      setPage={setPage}
    />
  );
}

function BookPebbleGuide({ setPage }) {
  return (
    <GuidePage
      eyebrow="Book Pebble"
      title="Pebble is used for selected holiday camps."
      intro="Some open-access holiday camps are listed through Pebble. Start with the site card so you open the correct camp listing."
      heroTitle="Find the right camp listing before checkout."
      platform="Pebble"
      routeLabel="Selected camps"
      summary={[
        ["Used for", "Selected open-access holiday camps at listed school sites."],
        ["Before you click", "Choose the camp location first, because some sites use different links."],
        ["Good to check", "Dates, age guidance, location notes, timings and cancellation terms."],
      ]}
      steps={[
        ["Choose the site card", "Start from the Bookings page and select the relevant holiday camp location."],
        ["Open the camp listing", "Follow the Pebble button on that location card."],
        ["Check dates and eligibility", "Review the camp dates, age range, location notes and any school-specific restrictions."],
        ["Confirm payment", "Review the cancellation terms and payment details before completing checkout."],
      ]}
      checklist={["King's House School", "The Rowans School", "Shrewsbury House School"]}
      cta="View booking sites"
      onClick={() => setPage("Bookings")}
      secondary="Contact Us"
      onSecondary={() => setPage("Contact")}
      setPage={setPage}
    />
  );
}

function GuidePage({ eyebrow, title, intro, heroTitle, platform, routeLabel, summary, steps, checklist, cta, href, onClick, secondary, onSecondary, setPage }) {
  return (
    <PageShell eyebrow={eyebrow} title={title}>
      <section className="guide-hero">
        <div>
          <span>{routeLabel}</span>
          <h2>{heroTitle}</h2>
          <p>{intro}</p>
          <div className="guide-actions">
            {href ? <a className="button book large" href={href} target="_blank" rel="noreferrer">{cta}</a> : <button className="button book large" type="button" onClick={onClick}>{cta}</button>}
            {secondary && <button className="button light" type="button" onClick={onSecondary}>{secondary}</button>}
          </div>
        </div>
        <aside className="guide-platform-card">
          <strong>{platform}</strong>
          <p>The booking platform opens in a new tab. Return here if you need to check which site route applies.</p>
          <button className="text-link" type="button" onClick={() => setPage("Bookings")}>Back to all sites</button>
        </aside>
      </section>
      <section className="guide-summary">
        {summary.map(([heading, text]) => (
          <article key={heading}>
            <span>{heading}</span>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <div className="guide-steps">
        {steps.map(([heading, text], index) => (
          <article key={heading}><strong>{index + 1}</strong><h3>{heading}</h3><p>{text}</p></article>
        ))}
      </div>
      <section className="guide-note refined">
        <div>
          <h2>Quick site check</h2>
          <p>If your school or camp is listed here, this guide applies. If you are unsure, use the booking directory first.</p>
        </div>
        <div className="guide-site-pills">
          {checklist.map((item) => <span key={item}>{item}</span>)}
        </div>
        <div className="guide-note-actions">
          <button className="button light" type="button" onClick={() => setPage("Bookings")}>View Booking Sites</button>
          <button className="text-link" type="button" onClick={() => setPage("Contact")}>Ask for Help</button>
        </div>
      </section>
    </PageShell>
  );
}

function Payments({ setPage }) {
  return (
    <PageShell eyebrow="Payments" title="Payments happen inside the booking platform.">
      <SupportHero
        label="Parent payments"
        title="Check payment options before confirming your place."
        text="Magicbooking and Pebble show the live payment options during checkout. Voucher support, receipts and payment records depend on the platform and activity selected."
        primary="Find Your Booking Route"
        secondary="Ask a Question"
        onPrimary={() => setPage("Bookings")}
        onSecondary={() => setPage("Contact")}
      />
      <SupportRouteCards
        cards={[
          ["Magicbooking", "Term-time care and selected school-linked holiday provision.", "Payments, receipts and booking records sit inside your Magicbooking account."],
          ["Pebble", "Selected open-access holiday camps.", "Pebble shows the camp fee, checkout options and confirmation details before you pay."],
          ["Childcare vouchers", "Where supported by the activity.", "Check the payment section during checkout and contact us if your provider is not shown."],
        ]}
      />
      <section className="support-process">
        <div>
          <p className="eyebrow">Before paying</p>
          <h2>Do one final check at checkout.</h2>
          <p>Before you confirm, check the school or camp name, dates, child details, fee, voucher options and any platform-specific terms.</p>
        </div>
        <ul>
          <li>Correct school, camp or activity selected.</li>
          <li>Dates and sessions match what you need.</li>
          <li>Child details and collection contacts are up to date.</li>
          <li>Payment method, receipt and voucher handling are clear.</li>
        </ul>
      </section>
    </PageShell>
  );
}

function Cancellations({ setPage }) {
  return (
    <PageShell eyebrow="Cancellations" title="Change requests start where you booked.">
      <SupportHero
        label="Changes and cancellations"
        title="Your booking platform shows the live options."
        text="Cancellation windows, credits and amendments vary by programme. Start where you booked so the rules match the specific session, camp or school centre."
        primary="View Booking Sites"
        secondary="Contact Après School"
        onPrimary={() => setPage("Bookings")}
        onSecondary={() => setPage("Contact")}
      />
      <SupportRouteCards
        cards={[
          ["Magicbooking", "Breakfast club, after-school care and selected school-linked provision.", "Log into Magicbooking to view permitted amendments and cancellation options for your centre."],
          ["Pebble", "Selected holiday camps.", "Use your Pebble booking confirmation or account area to review camp change and cancellation rules."],
          ["Site-specific terms", "Some rules vary by activity.", "Cut-off times, refunds and credits can differ, so always check the booking terms shown for that place."],
        ]}
      />
      <section className="support-process warning">
        <div>
          <p className="eyebrow">Best route</p>
          <h2>Use the same platform you booked with.</h2>
          <p>If you are unsure where a booking was made, use the Bookings page to identify the school or camp route first.</p>
        </div>
        <ul>
          <li>Find the original confirmation email or platform account.</li>
          <li>Check the session, camp and date you want to change.</li>
          <li>Read the cancellation or amendment terms shown there.</li>
          <li>Contact us if the platform does not answer your question.</li>
        </ul>
      </section>
    </PageShell>
  );
}

function SupportHero({ label, title, text, primary, secondary, onPrimary, onSecondary }) {
  return (
    <section className="support-hero">
      <div>
        <span>{label}</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className="support-hero-actions">
        <button className="button book large" type="button" onClick={onPrimary}>{primary}</button>
        <button className="button light" type="button" onClick={onSecondary}>{secondary}</button>
      </div>
    </section>
  );
}

function SupportRouteCards({ cards }) {
  return (
    <section className="support-route-cards">
      {cards.map(([title, label, text]) => (
        <article key={title}>
          <span>{label}</span>
          <h3>{title}</h3>
          <p>{text}</p>
        </article>
      ))}
    </section>
  );
}

function About() {
  return (
    <PageShell eyebrow="About Après School" title="Childcare that feels warm, organised and school-ready.">
      <section className="simple-band">
        <h2>We make the hours around school easier for everyone.</h2>
        <p>Children get space to play, make friends and reset. Parents get dependable childcare. Schools get provision delivered with calm operational discipline.</p>
      </section>
      <div className="content-grid tight">
        <TextBlock title="Warm with children" text="Sessions are friendly, active and choice-led, with space for quieter children as well as energetic play." />
        <TextBlock title="Clear with parents" text="Booking routes, collection routines and practical communication are kept simple." />
        <TextBlock title="Serious with schools" text="Safer recruitment, policy expectations, staffing and follow-up sit behind the cheerful club experience." />
      </div>
      <Values />
    </PageShell>
  );
}

function Services() {
  return (
    <PageShell eyebrow="Services" title="Flexible provision for schools, families and communities.">
      <div className="service-grid">{services.map((service) => <ServiceCard key={service.title} {...service} />)}</div>
    </PageShell>
  );
}

function Parents() {
  return (
    <PageShell eyebrow="For Parents" title="A friendly place for children before, after and during school holidays.">
      <section className="simple-band">
        <h2>Start by finding your school or camp.</h2>
        <p>Each booking card tells you whether to use Magicbooking or Book Pebble, so you can get to the right checkout quickly.</p>
      </section>
      <div className="split-content">
        <div className="parent-points">
          <TextBlock title="What children do" text="Creative activities, active games, homework space, outdoor play and calmer options for children who need to decompress." />
          <TextBlock title="How booking works" text="Use the Bookings page first, then complete the booking through the platform shown on your site card." />
        </div>
        <FAQ />
      </div>
    </PageShell>
  );
}

function Schools({ setPage }) {
  const [schoolStatus, setSchoolStatus] = useState(null);
  const partnershipModels = [
    [Clock, "Wraparound care", "Breakfast and after-school provision that feels part of the school day, not bolted on.", "Term-time rhythm"],
    [Sparkles, "Holiday clubs", "Active, creative camp days with clear booking routes and site-specific arrangements.", "School-holiday support"],
    [Users, "Enrichment and staffing", "Bespoke clubs, cover support and programme design for schools that need extra capacity.", "Flexible partnership"],
  ];
  const assurancePoints = [
    ["Safeguarding-led", "Safer recruitment records, training expectations and escalation routes built into the operating model."],
    ["Parent-ready", "Clear communication, calm handovers and booking guidance that reduces pressure on the school office."],
    ["Operationally steady", "Staffing plans, cover thinking and routines designed for busy school weeks."],
    ["School-friendly", "We work around your site, timetable, culture and existing family communication channels."],
  ];
  const launchSteps = [
    ["Listen", "We understand your timetable, spaces, family demand and current pressure points."],
    ["Shape", "We design the right model, staffing pattern, communication plan and booking route."],
    ["Launch", "We prepare parents, staff and site routines so the first sessions feel calm."],
    ["Improve", "We review feedback, attendance, staffing and operational notes as provision grows."],
  ];
  const schoolProof = [
    ["Site-first delivery", "Provision designed around your actual spaces, timings, handovers and parent expectations."],
    ["Clear parent routes", "Families are pointed to the right booking journey without adding avoidable work for your office."],
    ["Compliance discipline", "Staff records, policy expectations and training evidence are treated as core operations."],
  ];
  const schoolOperatingPoints = [
    ["People", "Named managers, trained staff, cover thinking and clear escalation routes."],
    ["Paperwork", "Single Central Register thinking, policy acknowledgements and assurance outputs."],
    ["Parents", "Simple booking guidance, calm collections and responsive communication."],
  ];
  async function submitSchool(event) {
    event.preventDefault();
    setSchoolStatus({ state: "sending", message: "Sending your school enquiry..." });
    const form = new FormData(event.currentTarget);
    const entry = Object.fromEntries(form.entries());
    const { submitPublicEnquiry } = await loadSupabaseModule();
    const result = await submitPublicEnquiry({
      ...entry,
      name: entry.organisation,
      type: "School",
    });
    setSchoolStatus({
      state: "sent",
      message: "Thanks. Your school enquiry has been received and the Après School team will follow up.",
    });
    event.currentTarget.reset();
  }
  return (
    <PageShell eyebrow="For Schools" title="Reliable childcare, built around your school day.">
      <section className="school-hero">
        <div>
          <p className="eyebrow">School partnerships</p>
          <h2>Extend your provision without stretching your school team.</h2>
          <p>
            Après School runs warm, organised childcare and enrichment with the safeguarding mindset,
            parent communication and operational discipline schools need behind the scenes.
          </p>
          <div className="school-hero-actions">
            <button className="button book large" type="button" onClick={() => document.querySelector(".school-enquiry")?.scrollIntoView({ behavior: "smooth" })}>Start a Partnership</button>
            <button className="button white" type="button" onClick={() => setPage("Bookings")}>View Current Sites</button>
          </div>
        </div>
        <div className="school-hero-card">
          <span>What schools get</span>
          <strong>Calm clubs, clear communication and serious operating systems.</strong>
          <p>Provision that parents enjoy using and school leaders can feel confident standing behind.</p>
          <div className="school-hero-mini">
            <span>Safeguarding-led</span>
            <span>Parent-ready</span>
            <span>Site-aware</span>
          </div>
        </div>
      </section>

      <section className="school-proof-strip">
        {schoolProof.map(([title, text]) => (
          <article key={title}>
            <strong>{title}</strong>
            <span>{text}</span>
          </article>
        ))}
      </section>

      <section className="school-models">
        <div className="school-models-intro">
          <p className="eyebrow">Partnership models</p>
          <h2>Choose the support your school actually needs.</h2>
          <p>Start with one provision, or combine term-time care, holiday provision and enrichment support as demand grows.</p>
        </div>
        {partnershipModels.map(([Icon, title, text, tag]) => (
          <article key={title}>
            <span className="school-model-icon"><Icon /></span>
            <span className="school-model-tag">{tag}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="school-assurance">
        <div>
          <p className="eyebrow">Why schools trust us</p>
          <h2>Friendly for families. Reassuring for school leaders.</h2>
          <p>
            The visible experience is active, creative and child-centred. Behind it sits a practical operating
            structure for staffing, compliance, policies, scheduling and follow-up.
          </p>
        </div>
        <div className="assurance-list">
          {assurancePoints.map(([title, text]) => (
            <article key={title}>
              <ShieldCheck />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="school-launch">
        <div className="section-kicker">
          <p className="eyebrow">Partnership process</p>
          <h2>A clear path from first conversation to live provision.</h2>
        </div>
        <div className="school-steps compact">
          {launchSteps.map(([step, text], index) => (
            <div key={step}>
              <span>{index + 1}</span>
              <h3>{step}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="school-system-band refined">
        <div className="image-card" style={{ backgroundImage: `url("${APRES_IMG.schoolCreativeTable}")` }} />
        <div>
          <p className="eyebrow">Operational confidence</p>
          <h2>Cheerful clubs, serious systems.</h2>
          <p>Behind the play is a practical operating system for staff records, compliance, documents, scheduling, pay, recognition and school assurance.</p>
          <div className="school-operating-grid">
            {schoolOperatingPoints.map(([title, text]) => (
              <article key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </article>
            ))}
          </div>
          <div className="proof-row blue">
            <span><ClipboardCheck /> SCR-ready records</span>
            <span><BookOpen /> Controlled policies</span>
            <span><Users /> Staffing workflows</span>
          </div>
        </div>
      </section>

      <section className="school-enquiry">
        <div>
          <p className="eyebrow">Launch Après at your school</p>
          <h2>Start with a practical conversation.</h2>
          <p>Tell us what your school needs. We will come back with sensible next steps, not a generic sales pack.</p>
          <div className="school-enquiry-points">
            <span>Timetables and spaces</span>
            <span>Likely numbers and demand</span>
            <span>Current provision challenges</span>
          </div>
        </div>
        <form className="compact-form" onSubmit={submitSchool}>
          <label>School name<input required name="organisation" placeholder="School or trust name" /></label>
          <label>Email<input required type="email" inputMode="email" name="email" autoComplete="email" placeholder="name@school.org" /></label>
          <label>Your role<input required name="role" placeholder="Headteacher, SBM, operations lead..." /></label>
          <label>Provision needed<select name="subject"><option>Wraparound care</option><option>Holiday clubs</option><option>Enrichment clubs</option><option>Staffing support</option></select></label>
          <label>Message<textarea required name="message" rows="4" placeholder="Tell us about timings, numbers, site needs or current challenges." /></label>
          <button className="button book" type="submit" disabled={schoolStatus?.state === "sending"}>{schoolStatus?.state === "sending" ? "Sending..." : "Send School Enquiry"}</button>
          {schoolStatus && <p className="success">{schoolStatus.message}</p>}
        </form>
      </section>
    </PageShell>
  );
}

function FAQs({ setPage }) {
  const bookingFaqs = parentFaqs.slice(0, 5);
  const careFaqs = parentFaqs.slice(5);
  const supportRoutes = [
    ["Find your site", "Pick the school or camp first. The card then sends you to Magicbooking or Pebble.", "View Sites", () => setPage("Bookings")],
    ["Payment help", "Voucher and payment options are confirmed on the booking platform before checkout.", "Payment Options", () => setPage("Payments")],
    ["Ask the team", "For collection, site or partnership questions, send us the details and we will route it.", "Contact Après", () => setPage("Contact")],
  ];
  return (
    <PageShell eyebrow="FAQs" title="Quick answers for parents and schools.">
      <section className="faq-hero">
        <div>
          <h2>Start with your school or camp.</h2>
          <p>The fastest route is usually to choose the site first. We will show the correct booking platform before you leave the Après School website.</p>
        </div>
        <div className="faq-actions">
          <button className="button book" type="button" onClick={() => setPage("Bookings")}>Find My Site</button>
          <button className="button light" type="button" onClick={() => setPage("Contact")}>Ask a Question</button>
        </div>
      </section>
      <section className="faq-support-grid">
        {supportRoutes.map(([title, text, action, onClick]) => (
          <article key={title}>
            <span><BookOpen /></span>
            <h2>{title}</h2>
            <p>{text}</p>
            <button className="text-link" type="button" onClick={onClick}>{action}</button>
          </article>
        ))}
      </section>
      <div className="faq-columns">
        <section>
          <h2>Booking and payments</h2>
          <p className="faq-intro">The practical stuff: platforms, accounts, amendments, vouchers and age guidance.</p>
          <div className="faq">
            {bookingFaqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>
        <section>
          <h2>Children and clubs</h2>
          <p className="faq-intro">What to expect on the day, how staff are checked and what children should bring.</p>
          <div className="faq">
            {careFaqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>
      </div>
      <section className="faq-contact-band">
        <div>
          <p className="eyebrow">Still unsure?</p>
          <h2>Tell us your school, camp or booking question.</h2>
          <p>We can point you towards the correct site, platform or team member.</p>
        </div>
        <button className="button book" type="button" onClick={() => setPage("Contact")}>Contact the Team</button>
      </section>
    </PageShell>
  );
}

function Policies({ setPage }) {
  const policySummaries = {
    Safeguarding: "Our safeguarding approach is built around safer recruitment, training expectations, clear escalation routes and a child-first culture.",
    Behaviour: "We use calm, consistent routines that help children feel safe, respected and able to enjoy the session.",
    "Health and Safety": "Site routines, risk awareness, collection arrangements and activity planning are managed with school-friendly discipline.",
    Complaints: "Families and schools can raise concerns clearly, with follow-up recorded and handled by the appropriate lead.",
    Privacy: "Personal information is handled only for legitimate childcare, staffing and operational purposes, with GDPR-ready workflows planned.",
    Terms: "Booking terms depend on the activity and booking platform. Parents should review the terms shown before confirming payment.",
    "First Aid": "First aid provision is planned by programme, site and staffing model, with qualifications tracked where required.",
    "Code of Conduct": "Staff are expected to model warm, professional behaviour and follow clear boundaries in every setting.",
  };
  return (
    <PageShell eyebrow="Policies" title="Safeguarding, policies and school assurance.">
      <section className="assurance-band">
        <div>
          <p className="eyebrow">For partner schools</p>
          <h2>Assurance without the admin chase.</h2>
          <p>School partners can request concise policy summaries, insurance details, safer recruitment assurances and safeguarding documentation.</p>
        </div>
        <button className="button book" type="button" onClick={() => setPage("Contact")}>Request Assurance Pack</button>
      </section>
      <section className="policy-trust-row">
        {[
          ["Safeguarding-led", "Child-first expectations, safer recruitment and clear escalation routes."],
          ["Version controlled", "Policies are prepared for staff acknowledgement, review cycles and archive history."],
          ["School-ready", "Short summaries help schools and families understand the approach quickly."],
        ].map(([title, text]) => <TextBlock key={title} title={title} text={text} />)}
      </section>
      <div className="policy-list">
        {Object.entries(policySummaries).map(([policy, summary]) => (
          <article key={policy}>
            <FileText />
            <div>
              <h3>{policy}</h3>
              <p>{summary}</p>
            </div>
          </article>
        ))}
      </div>
    </PageShell>
  );
}

function Contact({ setPage }) {
  const [status, setStatus] = useState(null);
  function applyTemplate(type, text) {
    const form = document.querySelector(".contact-form");
    if (!form) return;
    form.elements.type.value = type;
    form.elements.message.value = text;
    setStatus(null);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function setTemplate(event, type, text) {
    const form = event.currentTarget.form;
    if (!form) return;
    form.elements.type.value = type;
    form.elements.message.value = text;
    setStatus(null);
  }
  async function submit(event) {
    event.preventDefault();
    setStatus({ state: "sending", message: "Sending your enquiry..." });
    const form = new FormData(event.currentTarget);
    const entry = Object.fromEntries(form.entries());
    const { submitPublicEnquiry } = await loadSupabaseModule();
    const result = await submitPublicEnquiry(entry);
    setStatus({
      state: "sent",
      message: "Thanks. Your enquiry has been received and the Après School team will follow up.",
    });
    event.currentTarget.reset();
  }
  return (
    <PageShell eyebrow="Contact" title="Speak to the right Après School team.">
      <section className="contact-hero">
        <div>
          <span>How can we help?</span>
          <h2>Tell us what you need and we’ll route it properly.</h2>
          <p>Parents, schools and staff often need different answers. Choose the route below first and the form will shape itself around the kind of enquiry you are sending.</p>
        </div>
        <aside>
          <Mail />
          <strong>hello@apres-school.co.uk</strong>
          <p>For urgent booking changes, check the platform you booked through first so you see the live options for that booking.</p>
        </aside>
      </section>
      <section className="contact-route-grid">
        {[
          [CalendarDays, "Parent booking help", "Booking routes, payments, collection or finding the correct school/camp.", "Parent", "I have a question about booking for:"],
          [ShieldCheck, "School partnerships", "Wraparound care, holiday provision, enrichment clubs or staffing support.", "School", "We would like to discuss provision for:"],
          [Users, "Staff and recruitment", "Staff login, vacancies, onboarding, training or work with Après School.", "Staff", "I would like to ask about staff opportunities or onboarding:"],
        ].map(([Icon, title, text, type, template]) => (
          <button className="contact-route-card" key={title} type="button" onClick={() => applyTemplate(type, template)}>
            <Icon />
            <span>{type}</span>
            <strong>{title}</strong>
            <small>{text}</small>
          </button>
        ))}
      </section>
      <section className="contact-layout">
        <div className="contact-card">
          <h2>We’ll route your message to the right person.</h2>
          <p>For live booking changes, start with your booking platform. For site questions, partnerships or staff enquiries, send us the details here.</p>
          <div className="contact-response-list">
            <span>Booking platform questions</span>
            <span>School partnership conversations</span>
            <span>Staff applications and onboarding</span>
          </div>
          <div className="contact-methods">
            <a href="mailto:hello@apres-school.co.uk">hello@apres-school.co.uk</a>
            <button className="text-link" type="button" onClick={() => setPage("Staff Application")}>Staff application form</button>
            <button className="text-link" type="button" onClick={() => applyTemplate("School", "We would like to discuss provision for:")}>School partnership enquiry</button>
          </div>
        </div>
        <form className="contact-form" onSubmit={submit}>
          <div className="contact-form-head full">
            <span>Send an enquiry</span>
            <p>Add the school, site, booking platform or staff context if you have it. That helps us respond with less back-and-forth.</p>
          </div>
          <label>Name<input required name="name" autoComplete="name" placeholder="Your name" /></label>
          <label>Email<input required type="email" inputMode="email" name="email" autoComplete="email" placeholder="you@example.com" /></label>
          <label>Organisation or school<input name="organisation" placeholder="Optional" /></label>
          <label>Enquiry type<select name="type"><option>Parent</option><option>School</option><option>Staff</option><option>Other</option></select></label>
          <label className="full">Message<textarea required name="message" rows="6" placeholder="Tell us the school, camp, booking route or question..." /></label>
          <div className="contact-shortcuts full">
            <button type="button" onClick={(event) => setTemplate(event, "Parent", "I have a question about booking for:")}>Parent booking question</button>
            <button type="button" onClick={(event) => setTemplate(event, "School", "We would like to discuss wraparound care or holiday provision for:")}>School partnership enquiry</button>
            <button type="button" onClick={(event) => setTemplate(event, "Staff", "I would like to ask about staff opportunities or onboarding:")}>Staff or recruitment enquiry</button>
          </div>
          <button className="button primary" type="submit" disabled={status?.state === "sending"}>{status?.state === "sending" ? "Sending..." : "Send Enquiry"}</button>
          {status && <p className="success">{status.message}</p>}
        </form>
      </section>
    </PageShell>
  );
}

function StaffApplication() {
  const [submitted, setSubmitted] = useState(false);
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const application = {
      id: `application-${Date.now()}`,
      status: "Pending approval",
      submittedAt: new Date().toISOString(),
      name: form.get("name"),
      email: form.get("email"),
      phone: form.get("phone"),
      address: form.get("address"),
      dateOfBirth: form.get("dateOfBirth"),
      preferredRole: form.get("preferredRole"),
      preferredSchool: form.get("preferredSchool"),
      availability: form.get("availability"),
      qualifications: form.get("qualifications"),
      hasQualification: form.get("hasQualification") || "No",
      references: form.get("references"),
      employmentHistory: form.get("employmentHistory"),
      employmentGaps: form.get("employmentGaps") || "No",
      criminalDisclosure: form.get("criminalDisclosure") || "No",
      barredListDisclosure: form.get("barredListDisclosure") || "No",
      firstAidDetails: form.get("firstAidDetails"),
      dbsUpdateService: form.get("dbsUpdateService") || "No",
      medicalFitness: form.get("medicalFitness") || "Confirmed",
      livedAbroad: form.get("livedAbroad") || "No",
      overseasDetails: form.get("overseasDetails"),
      rightToWork: form.get("rightToWork") || "No",
      rightToWorkType: form.get("rightToWorkType") || "Permanent",
      personalStatement: form.get("personalStatement"),
      safeguardingStatement: form.get("safeguardingStatement") || "No",
    };
    const existing = readJson(staffApplicationsStorageKey, []);
    localStorage.setItem(staffApplicationsStorageKey, JSON.stringify([application, ...existing]));
    addAuditLog("Staff application submitted", `${application.name} submitted onboarding form`);
    event.currentTarget.reset();
    setSubmitted(true);
  }
  return (
    <PageShell eyebrow="Staff onboarding" title="Apply to work with Après School">
      <section className="application-layout">
        <div className="application-intro">
          <h2>Start your staff onboarding here.</h2>
          <p>Tell us about your experience, availability and training. Applications are reviewed before any staff account or site assignment is created.</p>
          <div className="proof-row blue"><span>Admin approval required</span><span>SCR ready</span><span>Account after approval</span></div>
        </div>
        <form className="contact-form staff-application-form" onSubmit={submit}>
          {submitted && <div className="form-status success">Application received. An admin will review it before account creation.</div>}
          <label>Name<input required name="name" placeholder="First and last name" /></label>
          <label>Email<input required type="email" name="email" /></label>
          <label>Phone<input required name="phone" /></label>
          <label>Date of birth<input required type="date" name="dateOfBirth" /></label>
          <label className="full">Address<textarea required name="address" rows="3" /></label>
          <label>Preferred role<select name="preferredRole"><option>Playworker</option><option>Club Manager</option><option>Camp Lead</option><option>Enrichment Lead</option><option>Cover Staff</option></select></label>
          <label>Preferred school/site<input name="preferredSchool" placeholder="School or area preference" /></label>
          <label>Teaching or childcare qualifications?<select name="hasQualification"><option>No</option><option>Yes</option></select></label>
          <label>Right to work confirmed?<select name="rightToWork"><option>No</option><option>Yes</option></select></label>
          <label className="full">Qualifications / training<textarea name="qualifications" rows="3" placeholder="List qualifications, first aid, safeguarding or relevant training." /></label>
          <label className="full">Availability<textarea name="availability" rows="3" placeholder="Which days, breakfast club, after-school care or holiday camps?" /></label>
          <label className="full">Two referees<textarea required name="references" rows="4" placeholder="Names, relationship, email/phone and organisation." /></label>
          <label className="full">Employment history<textarea name="employmentHistory" rows="4" placeholder="Include dates and any gaps if you do not have a CV ready." /></label>
          <label>Any employment gaps?<select name="employmentGaps"><option>No</option><option>Yes</option></select></label>
          <label>Criminal disclosure?<select name="criminalDisclosure"><option>No</option><option>Yes</option></select></label>
          <label>Barred from working with children?<select name="barredListDisclosure"><option>No</option><option>Yes</option></select></label>
          <label>DBS update service?<select name="dbsUpdateService"><option>No</option><option>Yes</option></select></label>
          <label className="full">First aid details<textarea name="firstAidDetails" rows="3" placeholder="Qualification level, awarding organisation and expiry date." /></label>
          <label>Medical fitness declaration<select name="medicalFitness"><option>Confirmed</option><option>Needs discussion</option></select></label>
          <label>Lived outside the UK for 3+ months?<select name="livedAbroad"><option>No</option><option>Yes</option></select></label>
          <label className="full">Overseas check details<textarea name="overseasDetails" rows="3" placeholder="Countries and dates lived abroad." /></label>
          <label>Right to work type<select name="rightToWorkType"><option>Permanent</option><option>Time limited</option></select></label>
          <label className="full">Personal statement<textarea name="personalStatement" rows="4" placeholder="Why do you want to work with Après School?" /></label>
          <label className="full checkbox-line"><input required type="checkbox" name="safeguardingStatement" value="Confirmed" /> I understand the role is subject to safer recruitment checks and safeguarding requirements.</label>
          <button className="button book" type="submit">Submit Application</button>
        </form>
      </section>
    </PageShell>
  );
}

function readPublicSettings() {
  return { campAnnouncementEnabled: true, ...readJson(publicSettingsStorageKey, {}) };
}

function addAuditLog(action, detail) {
  const items = readJson(auditStorageKey, []);
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    detail,
    source: "Local",
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(auditStorageKey, JSON.stringify([entry, ...items].slice(0, 80)));
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function MobileCTA({ page, setPage }) {
  const hiddenPages = ["Home", "Bookings", "Holiday Clubs", "Schools", "Contact"];
  return (
    <div className={hiddenPages.includes(page) ? "mobile-cta home-hidden" : "mobile-cta"}>
      <button className="button book" type="button" onClick={() => setPage("Bookings")}>Book Now</button>
      <button className="button light" type="button" onClick={() => setPage("Contact")}>Contact</button>
    </div>
  );
}

function PageShell({ eyebrow, title, children }) {
  return (
    <section className="page-shell">
      <div className="section-heading narrow"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
      {children}
    </section>
  );
}

function TextBlock({ title, text }) {
  return <article className="text-block"><h3>{title}</h3><p>{text}</p></article>;
}

function ServiceCard({ title, text, tag }) {
  return <article className="service-card"><span>{tag}</span><h3>{title}</h3><p>{text}</p><ChevronRight /></article>;
}

function Values() {
  return <div className="values">{["Safeguarding first", "Warm relationships", "Reliable routines", "Curious enrichment"].map((value) => <span key={value}><CheckCircle2 />{value}</span>)}</div>;
}

function FAQ() {
  return <div className="faq">{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>;
}

function StatusLine({ icon, label, value }) {
  return <div className="status-line">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function Badge({ value }) {
  const className = value.toLowerCase().includes("gap") || value.toLowerCase().includes("missing") || value.toLowerCase().includes("alert") || value.toLowerCase().includes("rejected") ? "bad" : value.toLowerCase().includes("soon") || value.toLowerCase().includes("chase") || value.toLowerCase().includes("pending") ? "warn" : "good";
  return <span className={`badge ${className}`}>{value}</span>;
}

function Footer({ setPage }) {
  const columns = [
    ["Clubs", ["Bookings", "Holiday Clubs", "Wraparound"]],
    ["Parents", ["Magicbooking", "Book Pebble", "Payments", "Cancellations"]],
    ["Schools", ["Schools", "Policies", "Contact"]],
    ["Staff", ["Staff Application", "Contact"]],
  ];
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <strong>Après School</strong>
        <span>Let's Learn and Play</span>
        <p>Holiday clubs, wraparound care and school partnerships for families and schools.</p>
        <div className="footer-badges">
          <span>Safer recruitment</span>
          <span>School partnerships</span>
          <span>Clear booking routes</span>
        </div>
      </div>
      {columns.map(([heading, links]) => (
        <div className="footer-column" key={heading}>
          <h3>{heading}</h3>
          {links.map((link) => <button key={link} type="button" onClick={() => setPage(link)}>{link}</button>)}
        </div>
      ))}
      <div className="footer-contact">
        <h3>Get in touch</h3>
        <a href="mailto:hello@apres-school.co.uk">hello@apres-school.co.uk</a>
        <small>Bookings currently open through Magicbooking or Book Pebble.</small>
        <div className="footer-actions">
          <button className="button book" type="button" onClick={() => setPage("Bookings")}>Book Now</button>
          <button className="button light" type="button" onClick={() => setPage("Contact")}>Contact</button>
        </div>
      </div>
    </footer>
  );
}
