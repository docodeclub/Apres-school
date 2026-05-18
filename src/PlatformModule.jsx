import { useEffect, useState } from "react";

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


const platformTabs = ["Staff", "Admin", "Users", "HR", "HR Files", "Rota", "Hours", "SCR", "Ofsted", "Documents", "Pay", "Rewards", "Sessions", "CRM", "Audit", "Settings"];
const platformGroups = [
  ["Overview", ["Admin", "Staff"]],
  ["People", ["Users", "HR", "HR Files", "SCR", "Ofsted", "Documents"]],
  ["Operations", ["Rota", "Hours", "Sessions", "CRM"]],
  ["Finance & culture", ["Pay", "Rewards"]],
  ["System", ["Audit", "Settings"]],
];

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
  const localStaff = readOnboardedStaffProfiles();
  const canPreviewRoles = ["Admin", "Superadmin"].includes(role);
  const effectiveRole = canPreviewRoles ? viewRole : role;
  const enrichedData = {
    ...data,
    staff: mergeStaffProfiles(data.staff, localStaff),
    source: localStaff.length ? `${data.source} + onboarding` : data.source,
  };
  const previewUsers = canPreviewRoles ? buildPreviewUsers(enrichedData, viewRole) : [];
  const selectedPreviewUser = previewUsers.find((user) => user.id === previewUserId) || null;
  const access = buildAccessContext(effectiveRole, userEmail, enrichedData, canPreviewRoles ? previewUserId : "");
  const scopedData = access.data;
  const visibleTabs = effectiveRole === "Staff"
    ? ["Staff", "Documents", "Pay", "Rewards", "Sessions"]
    : effectiveRole === "Manager"
      ? ["Staff", "Rota", "Hours", "SCR", "Ofsted", "Documents", "Sessions"]
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
                <button key={item} type="button" aria-current={tab === item ? "page" : undefined} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
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
        {tab === "Staff" && <StaffDashboard data={scopedData} />}
        {tab === "Admin" && <AdminDashboard data={scopedData} access={access} onOpenTab={setTab} onOpenStaffProfile={(staffId) => { setStaffProfileTargetId(staffId); setTab("SCR"); }} />}
        {tab === "Users" && <UserManagement data={enrichedData} />}
        {tab === "HR" && <HRHierarchy data={enrichedData} access={access} />}
        {tab === "HR Files" && <HRFiles data={enrichedData} />}
        {tab === "Rota" && <Rota data={scopedData} allData={enrichedData} access={access} />}
        {tab === "Hours" && <HoursTracker data={scopedData} access={access} />}
        {tab === "SCR" && <SCR data={scopedData} access={access} targetStaffId={staffProfileTargetId} onTargetHandled={() => setStaffProfileTargetId("")} />}
        {tab === "Ofsted" && <OfstedReadiness data={scopedData} />}
        {tab === "Documents" && <Documents data={scopedData} />}
        {tab === "Pay" && <Pay data={scopedData} />}
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
        <p className="platform-source">{data.loading ? "Loading live records..." : `${data.source}${data.error ? " · using demo fallback" : ""}`}</p>
        {access?.isScoped && <p className="platform-source">Manager scope: {access.directReports.length} direct reports · own team records only</p>}
        {access?.isStaffScoped && <p className="platform-source">Staff scope: personal records only</p>}
        {data.error && <p className="platform-warning">{data.error}</p>}
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

function StaffDashboard({ data }) {
  const pendingDocs = data.documents.reduce((total, doc) => total + Math.max(0, Number(doc.assigned || 0) - Number(doc.read || 0)), 0);
  const ownStaff = data.staff[0];
  const [renewalRequests, setRenewalRequests] = useState(() => readJson(scrRenewalRequestsStorageKey, {}));
  const ownStaffWithScr = ownStaff ? applyScrChecklistState([ownStaff])[0] : null;
  const staffRenewalItems = ownStaffWithScr ? buildScrRenewalItems([ownStaffWithScr]) : [];
  const staffEvidenceRequests = ownStaffWithScr ? buildStaffEvidenceRequests(ownStaffWithScr, staffRenewalItems, renewalRequests) : [];
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
      <Metric icon={<PoundSterling />} label="Pay data" value={ownStaff?.payRate ? `£${ownStaff.payRate}/hr` : "Pending"} tone="green" />
      <Panel title="My Evidence Requests"><StaffEvidenceRequestList items={staffEvidenceRequests} onSubmit={saveEvidenceSubmission} /></Panel>
      <Panel title="My Upcoming Sessions"><SessionList data={data} personal /></Panel>
      <Panel title="My Trophy Cabinet"><RewardList data={data} /></Panel>
      <Panel title="Outstanding Actions"><ActionList items={["Read Staff Handbook v2026.2", "Confirm annual medical declaration", "Upload renewed proof of address"]} /></Panel>
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
  const users = mergeUserRecords(data.staff, state);

  function saveState(next) {
    setState(next);
    localStorage.setItem(userStorageKey, JSON.stringify(next));
  }

  function inviteUser(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = `invite-${Date.now()}`;
    const next = {
      ...state,
      [id]: {
        id,
        name: form.get("name"),
        email: form.get("email"),
        role: form.get("role"),
        status: "Invited",
        source: "local invite",
        invitedAt: new Date().toISOString(),
      },
    };
    saveState(next);
    addAuditLog("User invited", `${form.get("email")} invited as ${form.get("role")}`);
    event.currentTarget.reset();
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
          <h2>Invite staff and control platform access.</h2>
          <p>Local demo workflow for role assignment and account deactivation. Production invites should run through a secure Supabase Edge Function.</p>
        </div>
        <form className="compact-form" onSubmit={inviteUser}>
          <label>Name<input required name="name" placeholder="Staff member name" /></label>
          <label>Email<input required type="email" name="email" placeholder="name@apres-school.co.uk" /></label>
          <label>Role<select name="role" defaultValue="Staff">{userRoles.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="button book" type="submit">Create Invite</button>
        </form>
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
            <small>{user.source === "local invite" ? "Local invite" : "Mapped from staff record"} · {user.updatedAt ? "Updated locally" : "Ready"}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function HRHierarchy({ data }) {
  const [state, setState] = useState(() => readHierarchyState());
  const [selectedManager, setSelectedManager] = useState("");
  const users = mergeUserRecords(data.staff, readUserAdminState());
  const rows = users.map((user) => {
    const staffProfile = data.staff.find((person) => (person.profileId || person.id) === user.id) || {};
    const reportsTo = state[user.id]?.reportsTo ?? defaultReportsTo(user, users);
    const scope = state[user.id]?.scope || staffPrimaryLocation(staffProfile) || "Organisation-wide";
    return {
      ...user,
      reportsTo,
      scope,
      updatedAt: state[user.id]?.updatedAt,
      managerName: users.find((person) => person.id === reportsTo)?.name || "No manager assigned",
    };
  });
  const managerOptions = rows.filter((person) => ["Manager", "Admin", "Superadmin"].includes(person.role));
  const activeManager = selectedManager || managerOptions[0]?.id || "";
  const directReports = rows.filter((person) => person.reportsTo === activeManager);

  function save(next) {
    setState(next);
    localStorage.setItem(hierarchyStorageKey, JSON.stringify(next));
  }

  function updatePerson(id, patch) {
    const person = rows.find((item) => item.id === id);
    const next = {
      ...state,
      [id]: {
        ...state[id],
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    save(next);
    addAuditLog("HR hierarchy updated", `${person?.name || id}: ${Object.keys(patch).join(", ")}`);
  }

  function childrenOf(managerId) {
    return rows.filter((person) => person.reportsTo === managerId);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>HR Hierarchy</h2>
          <p className="panel-note">Map line management, site responsibility and escalation routes for staff operations.</p>
        </div>
      </div>
      <div className="hr-summary">
        <Metric icon={<Users />} label="People mapped" value={rows.length} tone="blue" />
        <Metric icon={<ShieldCheck />} label="Managers" value={managerOptions.length} tone="green" />
        <Metric icon={<ClipboardCheck />} label="Unassigned reports" value={rows.filter((person) => person.role === "Staff" && !person.reportsTo).length} tone="amber" />
      </div>
      <section className="hr-org">
        <div className="crm-card-head">
          <div>
            <span>Org chart</span>
            <h3>Reporting structure</h3>
            <p>Top-level leads show first, with direct reports nested underneath.</p>
          </div>
        </div>
        <div className="org-tree">
          {rows.filter((person) => !person.reportsTo || person.role === "Superadmin").map((person) => (
            <article className="org-node" key={person.id}>
              <strong>{person.name}</strong>
              <span>{person.role} · {person.scope}</span>
              <div>
                {childrenOf(person.id).map((child) => (
                  <small key={child.id}>{child.name} · {child.role}</small>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="hr-manager-panel">
        <div>
          <h3>Manager Scope Preview</h3>
          <p className="panel-note">Useful later for manager dashboards filtered to direct reports.</p>
        </div>
        <label>Manager<select value={activeManager} onChange={(event) => setSelectedManager(event.target.value)}>{managerOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <div className="list">
          {directReports.map((person) => (
            <article className="list-item" key={person.id}>
              <div><strong>{person.name}</strong><span>{person.role} · {person.scope}</span></div>
              <Badge value="Direct report" />
            </article>
          ))}
          {!directReports.length && <EmptyList title="No direct reports" text="Assign staff to this manager in the table below." />}
        </div>
      </section>
      <TableWrap>
        <table>
          <thead><tr><th>Staff</th><th>Role</th><th>Reports to</th><th>Scope/site</th><th>Direct reports</th><th>Status</th></tr></thead>
          <tbody>{rows.map((person) => (
            <tr key={person.id}>
              <td><strong>{person.name}</strong><br /><small>{person.email}</small></td>
              <td><Badge value={person.role} /></td>
              <td>
                <select value={person.reportsTo || ""} onChange={(event) => updatePerson(person.id, { reportsTo: event.target.value })}>
                  <option value="">No manager</option>
                  {rows.filter((option) => option.id !== person.id).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </td>
              <td><input value={person.scope} onChange={(event) => updatePerson(person.id, { scope: event.target.value })} aria-label={`${person.name} scope`} /></td>
              <td>{childrenOf(person.id).length}</td>
              <td><Badge value={person.updatedAt ? "Updated" : "Default"} /></td>
            </tr>
          ))}</tbody>
        </table>
      </TableWrap>
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

function HRFiles({ data }) {
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

function HoursTracker({ data }) {
  const [entries, setEntries] = useState(() => readJson("apres-hours-entries", {}));
  const staffOptions = data.staff.map((person) => person.name);
  const totals = rotaSites.reduce((summary, site) => {
    const entry = entries[site.id] || {};
    const breakMinutes = Number(entry.breakMinutes ?? (durationMinutes(site.sessionStart, site.sessionEnd) > 360 ? 30 : 0));
    const paidMinutes = site.setupMinutes + durationMinutes(site.sessionStart, site.sessionEnd) + site.cleanupMinutes - breakMinutes;
    return {
      assigned: summary.assigned + (entry.staff ? 1 : 0),
      hours: summary.hours + (entry.staff ? paidMinutes / 60 : 0),
    };
  }, { assigned: 0, hours: 0 });

  function update(siteId, patch) {
    const next = { ...entries, [siteId]: { ...entries[siteId], ...patch } };
    localStorage.setItem("apres-hours-entries", JSON.stringify(next));
    setEntries(next);
    addAuditLog("Hours updated", `${siteId} hours entry changed`);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2>Hours Tracker</h2>
          <p className="panel-note">Company default shown here: 15 min setup, 5 min cleanup, 30 min unpaid camp break. UK statutory rest break is 20 minutes when working over 6 hours.</p>
        </div>
      </div>
      <div className="hr-summary">
        <Metric icon={<Clock />} label="Assigned entries" value={`${totals.assigned}/${rotaSites.length}`} tone={totals.assigned ? "blue" : "amber"} />
        <Metric icon={<PoundSterling />} label="Projected paid hours" value={totals.hours.toFixed(2)} tone="green" />
        <Metric icon={<Users />} label="Staff in scope" value={staffOptions.length} tone="blue" />
      </div>
      <TableWrap>
        <table>
          <thead><tr><th>Site</th><th>Staff</th><th>Paid window</th><th>Break</th><th>Paid hours</th><th>Status</th></tr></thead>
          <tbody>{rotaSites.map((site) => {
            const entry = entries[site.id] || {};
            const breakMinutes = Number(entry.breakMinutes ?? (durationMinutes(site.sessionStart, site.sessionEnd) > 360 ? 30 : 0));
            const paidMinutes = site.setupMinutes + durationMinutes(site.sessionStart, site.sessionEnd) + site.cleanupMinutes - breakMinutes;
            return (
              <tr key={site.id}>
                <td><strong>{site.site}</strong><br /><small>{site.type}</small></td>
                <td><select value={entry.staff || ""} onChange={(event) => update(site.id, { staff: event.target.value })}><option value="">Choose staff</option>{staffOptions.map((staffName) => <option key={staffName}>{staffName}</option>)}</select></td>
                <td>{addMinutes(site.sessionStart, -site.setupMinutes)}-{addMinutes(site.sessionEnd, site.cleanupMinutes)}</td>
                <td><input type="number" min="0" step="5" value={breakMinutes} onChange={(event) => update(site.id, { breakMinutes: event.target.value })} aria-label={`${site.site} unpaid break minutes`} /></td>
                <td><strong>{(paidMinutes / 60).toFixed(2)}</strong></td>
                <td><Badge value={entry.staff ? "Ready" : "Unassigned"} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function SCR({ data, access, targetStaffId, onTargetHandled }) {
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
    scrChecklist: checklistState[person.id] || person.scrChecklist || {},
    ...(checklistState[person.id]?.approvedAt
      ? { compliance: "Compliant", onboardingStatus: "SCR approved" }
      : {}),
  }));
  const scrData = { ...data, staff: staffWithAssignments };
  const totalStaff = scrData.staff.length;
  const compliantStaff = scrData.staff.filter((person) => person.compliance === "Compliant").length;
  const reviewStaff = Math.max(totalStaff - compliantStaff, 0);
  const completion = totalStaff ? Math.round((compliantStaff / totalStaff) * 100) : 100;
  const issueDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const [summaryStaffId, setSummaryStaffId] = useState(data.staff[0]?.id || "");
  const samplePerson = scrData.staff.find((person) => person.id === summaryStaffId) || scrData.staff[0] || {};
  const schoolOptions = assignmentSchools;
  const [assuranceSchool, setAssuranceSchool] = useState(schoolOptions[0] || "Partner School");
  const [includeEvidenceAppendix, setIncludeEvidenceAppendix] = useState(false);
  const assuranceStaff = scrData.staff.filter((person) => staffAssignedToSchool(person, assuranceSchool));
  const selectedAssuranceStaff = assuranceStaff.length ? assuranceStaff : scrData.staff;
  const assuranceStatements = [
    "Enhanced DBS details, barred list checks and update-service status are recorded against each staff member.",
    "Right to work, identity checks and proof-of-address evidence can be tracked with verifier and review dates.",
    "Safeguarding, KCSIE, company policy and allergy-awareness training are monitored with completion evidence.",
    "First aid is tracked by qualification, role and site requirement, with expiry dates where applicable.",
    "References, employment gaps, overseas checks and qualification evidence are captured for safer recruitment.",
    "Annual medical, criminal and childcare disqualification declarations are prompted and reconfirmed digitally.",
  ];
  const onboardingProfiles = scrData.staff.filter((person) => person.onboardingStatus);
  const renewalItems = buildScrRenewalItems(scrData.staff);
  const evidenceWorkflowItems = buildEvidenceWorkflowItems(scrData.staff, renewalItems, renewalRequests);
  const submittedEvidence = buildSubmittedEvidenceReviews(scrData.staff, renewalRequests);
  function updateAssignment(staffId, index, patch) {
    setAssignmentState((current) => {
      const assignments = [...(current[staffId] || [])];
      assignments[index] = { ...assignments[index], ...patch };
      return { ...current, [staffId]: assignments };
    });
  }
  function addAssignment(staffId) {
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
    setAssignmentState((current) => ({
      ...current,
      [staffId]: (current[staffId] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }
  function updateChecklist(staffId, patch) {
    setChecklistState((current) => {
      const next = {
        ...current,
        [staffId]: {
          ...current[staffId],
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
      saveScrChecklistState(next);
      return next;
    });
    addAuditLog("SCR checklist updated", `${staffId}: ${Object.keys(patch).join(", ")}`);
  }
  function approveScrProfile(staffId) {
    const person = scrData.staff.find((item) => item.id === staffId);
    setChecklistState((current) => {
      const next = {
        ...current,
        [staffId]: {
          ...current[staffId],
          approvedAt: new Date().toISOString(),
          approvedBy: "Admin",
          updatedAt: new Date().toISOString(),
        },
      };
      saveScrChecklistState(next);
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
    addAuditLog("SCR evidence requested", `${person.name}: ${check}`);
  }
  function clearProfileEvidenceRequest(request) {
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
    addAuditLog("SCR evidence request cleared", `${request.check}: ${request.staffId}`);
  }
  function reviewSubmittedEvidence(item, decision, note = "") {
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
    addAuditLog(decision === "approve" ? "SCR evidence approved" : "SCR evidence rejected", `${item.staffName}: ${item.check}`);
  }
  async function downloadStaffSummary() {
    const { exportStaffScrSummary } = await import("./pdfExports.js");
    exportStaffScrSummary(samplePerson, scrData.staff);
  }
  async function downloadAssuranceLetter() {
    const { exportSchoolAssuranceLetter } = await import("./pdfExports.js");
    exportSchoolAssuranceLetter(selectedAssuranceStaff, assuranceSchool, { includeEvidenceAppendix });
  }
  const requirementRows = schoolOptions.map((school) => {
    const assigned = scrData.staff.filter((person) => staffAssignedToSchool(person, school));
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
              {scrData.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
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
        staff={scrData.staff}
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

function Pay({ data }) {
  const rows = data.staff.map((person) => ({ ...person, gross: person.payRate * 18, expenses: person.id === "sample-002" ? 24 : 0, deductions: person.id === "sample-001" ? 18 : 0 }));
  return (
    <Panel title="Payroll Summary">
      <p className="panel-note">Demo calculation: approved hours x rate, plus approved expenses, minus separate deductions.</p>
      <TableWrap>
        <table>
          <thead><tr><th>Staff</th><th>Rate</th><th>Gross</th><th>Expenses</th><th>Deductions</th><th>Net</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>£{row.payRate}/hr</td><td>£{row.gross}</td><td>£{row.expenses}</td><td>£{row.deductions}</td><td><strong>£{row.gross + row.expenses - row.deductions}</strong></td></tr>)}</tbody>
        </table>
      </TableWrap>
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
  const hrFileCount = readJson(auditStorageKey, []).filter((item) => String(item.action || "").toLowerCase().includes("hr file")).length;

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
      </section>
    </div>
  );
}

function StaffTable({ compact, data = mockPlatformData, targetStaffId, onTargetHandled, evidenceRequests = {}, onRequestEvidence, onClearEvidenceRequest }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Action needed");
  const [siteFilter, setSiteFilter] = useState("All");
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
    const status = String(person.compliance || "").toLowerCase();
    if (status.includes("compliant")) return "Compliant";
    if (status.includes("expiring")) return "Expiring soon";
    if (status.includes("rejected")) return "Rejected";
    if (status.includes("missing")) return "Missing";
    return "Review needed";
  }
  function actionText(person) {
    const missing = actionItems(person);
    if (!missing.length) return checkStatus(person) === "Compliant" ? "No action" : "Check evidence";
    return `Check ${missing.slice(0, 2).join(" / ")}${missing.length > 2 ? ` +${missing.length - 2}` : ""}`;
  }
  function actionItems(person) {
    return [
      !hasValidDate(person.dbsRenewal) && "DBS",
      !hasValidDate(person.safeguardingExpiry) && "Safeguarding",
      !hasValidDate(person.allergyAwarenessExpiry) && "Allergy",
      !person.scrChecklist?.approvedAt && person.compliance !== "Compliant" && "Admin review",
    ].filter(Boolean);
  }
  const search = query.trim().toLowerCase();
  const statusCounts = data.staff.reduce((acc, person) => {
    const status = checkStatus(person);
    acc.All += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (status !== "Compliant") acc["Action needed"] += 1;
    return acc;
  }, { "Action needed": 0, All: 0, Compliant: 0, "Review needed": 0, Missing: 0, "Expiring soon": 0, Rejected: 0 });
  const statusOptions = ["Action needed", "All", "Compliant", "Review needed", "Missing", "Expiring soon", "Rejected"];
  const rows = data.staff.filter((person) => {
    const status = checkStatus(person);
    const matchesStatus = statusFilter === "All" || (statusFilter === "Action needed" ? status !== "Compliant" : status === statusFilter);
    const matchesSite = siteFilter === "All" || staffSchoolNames(person).includes(siteFilter);
    const haystack = [person.name, person.email, person.role, person.location, person.compliance, managerName(person), staffPrimaryLocation(person)].filter(Boolean).join(" ").toLowerCase();
    return matchesStatus && matchesSite && (!search || haystack.includes(search));
  });
  const actionCount = data.staff.filter((person) => checkStatus(person) !== "Compliant").length;
  const compliantCount = data.staff.length - actionCount;
  const selectedPerson = data.staff.find((person) => person.id === selectedId) || rows[0] || data.staff[0];
  const filtersActive = query || statusFilter !== "Action needed" || siteFilter !== "All";
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
          <p>{rows.length} of {data.staff.length} staff shown · {actionCount} need review · {compliantCount} currently compliant.</p>
          <div className="scr-filter-chips" aria-label="SCR status filters">
            {statusOptions.map((status) => (
              <button key={status} className={statusFilter === status ? "active" : ""} type="button" onClick={() => setStatusFilter(status)}>
                {status}<span>{statusCounts[status] || 0}</span>
              </button>
            ))}
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
          <button className="button light" type="button" disabled={!filtersActive} onClick={() => { setQuery(""); setStatusFilter("Action needed"); setSiteFilter("All"); }}>Clear</button>
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
        />
      )}
      <TableWrap>
        <table>
          <thead><tr><th>Staff</th><th>Role</th><th>Assigned sites</th><th>Reports to</th><th>SCR</th><th>Next action</th>{!compact && <><th>DBS renewal</th><th>Safeguarding</th><th>First aid</th></>}<th>Profile</th></tr></thead>
          <tbody>
            {rows.map((person) => (
              <tr
                key={person.id}
                className={selectedPerson?.id === person.id ? "selected-row" : ""}
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
                <td><strong>{actionText(person)}</strong></td>
                {!compact && <><td>{person.dbsRenewal}</td><td>{person.safeguardingExpiry}</td><td>{person.firstAidExpiry}</td></>}
                <td><button className="button subtle" type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(person.id); }}>{selectedPerson?.id === person.id ? "Open" : "View"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!rows.length && <EmptyList title="No staff match these filters" text="Try all statuses or clear the search field." />}
    </section>
  );
}

function StaffProfilePanel({ person, data, managerName, checkStatus, nextAction, actionItems = [], evidenceRequests = [], onRequestEvidence, onClearEvidenceRequest }) {
  const [notes, setNotes] = useState(() => readJson(staffProfileNotesStorageKey, {}));
  const [photoUrl, setPhotoUrl] = useState(person.photoUrl || person.profilePhotoUrl || "");
  const [photoStatus, setPhotoStatus] = useState("");
  const [hrFileTab, setHrFileTab] = useState("All");
  const [requestEvidenceKey, setRequestEvidenceKey] = useState(() => scrEvidenceRequestOptions[0][0]);
  const [requestNote, setRequestNote] = useState("");
  const note = notes[person.id] || "";
  const assignments = staffAssignments(person);
  const hrFiles = (data.hrFiles || []).filter((file) => file.staffRecordId === person.id);
  const hrFileTabs = buildStaffHrFileTabs(hrFiles);
  const visibleHrFiles = hrFileTab === "All" ? hrFiles : hrFiles.filter((file) => staffHrFileBucket(file) === hrFileTab);
  const sessions = (data.sessions || []).filter((session) => {
    const label = `${session.site || ""} ${session.programme || ""}`.toLowerCase();
    return staffSchoolNames(person).some((school) => label.includes(school.toLowerCase()));
  }).slice(0, 3);
  const avatar = photoUrl || person.photoUrl || person.profilePhotoUrl || defaultStaffAvatar;
  const profileStats = [
    ["SCR", checkStatus],
    ["Next action", nextAction],
    ["Manager", managerName || "Unassigned"],
    ["Sites", assignments.length ? String(assignments.length) : "None"],
  ];
  const complianceChecks = [
    ["Right to work", person.rightToWork || person.rightToWorkType || "Not recorded"],
    ["Enhanced DBS", person.dbsRenewal || "Not recorded"],
    ["Safeguarding", person.safeguardingExpiry || "Not recorded"],
    ["Allergy awareness", person.allergyAwarenessExpiry || "Not recorded"],
    ["First aid", person.firstAidExpiry || "Not required"],
    ["Admin review", person.scrChecklist?.approvedAt ? `Approved ${formatShortDate(person.scrChecklist.approvedAt.slice(0, 10))}` : "Awaiting review"],
  ];

  useEffect(() => {
    setPhotoUrl(person.photoUrl || person.profilePhotoUrl || "");
    setPhotoStatus("");
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
  }, [person.id, person.photoUrl, person.profilePhotoUrl]);

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
    onRequestEvidence?.(person, requestEvidenceKey, requestNote);
    setRequestNote("");
  }

  return (
    <article className="staff-profile-panel">
      <div className="staff-profile-identity">
        <div className="staff-photo-control">
          <img src={avatar} alt={`${person.name} profile`} />
          <label className="button light">
            <Upload size={16} /> Upload photo
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProfilePhoto} />
          </label>
          {photoStatus && <small>{photoStatus}</small>}
        </div>
        <div>
          <p className="eyebrow">Staff profile</p>
          <h3>{person.name}</h3>
          <p>{person.role} · {staffPrimaryLocation(person)}</p>
          <div className="staff-profile-badges">
            <Badge value={checkStatus} />
            <Badge value={person.contractType || "Contract not recorded"} />
          </div>
        </div>
      </div>
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
          <p>{actionItems.length ? "Work through these items before issuing assurance or marking the profile ready." : "No immediate SCR action is flagged for this staff member."}</p>
        </div>
        <div className="scr-action-tags">
          {(actionItems.length ? actionItems : ["No action"]).map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>
      <section className="scr-profile-request-panel">
        <div>
          <p className="eyebrow">Evidence requests</p>
          <h4>Request missing or updated SCR evidence.</h4>
          <p>Requests logged here appear in the staff member’s evidence request area and can be tracked by admin until submitted, approved or cleared.</p>
        </div>
        <form className="scr-profile-request-form" onSubmit={submitEvidenceRequest}>
          <label>
            Evidence type
            <select value={requestEvidenceKey} onChange={(event) => setRequestEvidenceKey(event.target.value)}>
              {scrEvidenceRequestOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>
            Note to staff
            <textarea rows="2" value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Please upload your renewed certificate or reference." />
          </label>
          <button className="button dark" type="submit" disabled={!onRequestEvidence}><Upload size={16} /> Request Evidence</button>
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
                <button className="button light" type="button" onClick={() => onClearEvidenceRequest?.(request)} disabled={!onClearEvidenceRequest}>Clear</button>
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
        <section>
          <h4>SCR snapshot</h4>
          <div className="compliance-check-grid">
            {complianceChecks.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h4>Pay & contract</h4>
          <dl>
            <div><dt>Hourly rate</dt><dd>{person.payRate ? `£${person.payRate}/hr` : "Not recorded"}</dd></div>
            <div><dt>Annual salary</dt><dd>{person.annualSalary ? `£${person.annualSalary}` : "Not recorded"}</dd></div>
            <div><dt>Contract</dt><dd>{person.contractType || "Not recorded"}</dd></div>
            <div><dt>Start date</dt><dd>{person.startDate || "Not recorded"}</dd></div>
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
      <label className="staff-profile-notes">Internal notes<textarea value={note} onChange={(event) => updateNote(event.target.value)} rows="3" placeholder="Manager notes, HR follow-up, contract reminders..." /></label>
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
    const email = `${String(person.name || `staff-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")}@apres-school.local`;
    const defaultRole = person.role?.toLowerCase().includes("manager") ? "Manager" : "Staff";
    const id = person.profileId || person.id;
    return {
      id,
      name: person.name,
      email,
      role: defaultRole,
      status: "Active",
      source: "staff record",
      ...state[id],
    };
  });
  const invited = Object.values(state).filter((user) => user.source === "local invite" || user.source === "approved onboarding");
  return [...invited, ...base];
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
  return readJson(auditStorageKey, []);
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
