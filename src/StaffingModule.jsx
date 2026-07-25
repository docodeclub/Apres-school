import React, { useEffect, useMemo, useState } from "react";
import { calculatePaidShift, requiredStaffCount, shiftsOverlap } from "./staffingRules.js";

const staffingApi = () => import("./supabaseClient.js");
const DAY_MS = 86400000;
const ACTIVE_ASSIGNMENT_STATUSES = new Set(["assigned", "cover_required"]);
const ROLE_LABELS = { manager: "Manager", dsl: "DSL", sendco: "SENDCO", assistant: "Assistant" };

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(value, amount) {
  const date = typeof value === "string" ? fromIsoDate(value) : new Date(value);
  date.setDate(date.getDate() + amount);
  return localIsoDate(date);
}

function weekStart(value = new Date()) {
  const date = typeof value === "string" ? fromIsoDate(value) : new Date(value);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return localIsoDate(date);
}

function formatDay(value, detailed = false) {
  return new Intl.DateTimeFormat("en-GB", detailed
    ? { weekday: "long", day: "numeric", month: "long" }
    : { weekday: "short", day: "numeric", month: "short" }).format(fromIsoDate(value));
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
}

function minutesBetween(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function shiftWindow(session) {
  const paidShift = calculatePaidShift(session.startsAt, session.endsAt, session.settings);
  return {
    start: paidShift.start,
    end: paidShift.end,
    setup: paidShift.setupMinutes,
    closing: paidShift.closingMinutes,
  };
}

function assignmentIsActive(assignment) {
  return ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status || "assigned");
}

function staffForAssignment(assignment, staff) {
  return staff.find((person) => person.id === assignment.staffRecordId) || {
    id: assignment.staffRecordId,
    name: assignment.staffName || "Staff member",
    qualifications: {},
  };
}

function roleLabels(session, assignment) {
  const labels = new Set();
  if (assignment.sessionRole && assignment.sessionRole !== "assistant") labels.add(ROLE_LABELS[assignment.sessionRole] || assignment.sessionRole);
  if (assignment.actingManager || session.settings?.defaultManagerStaffId === assignment.staffRecordId) labels.add("Manager");
  if (assignment.actingDsl || session.settings?.defaultDslStaffId === assignment.staffRecordId) labels.add("DSL");
  if (assignment.actingSendco || session.settings?.defaultSendcoStaffId === assignment.staffRecordId) labels.add("SENDCO");
  if (!labels.size) labels.add("Assistant");
  return [...labels];
}

function requiredStaff(session) {
  return requiredStaffCount(session.bookingCount, session.settings);
}

function sessionWarnings(session, staff, allSessions) {
  const active = (session.assignments || []).filter(assignmentIsActive);
  const people = active.map((assignment) => ({ assignment, person: staffForAssignment(assignment, staff) }));
  const warnings = [];
  const needed = requiredStaff(session);
  if (active.length < needed) warnings.push({ code: "understaffed", serious: true, text: `${session.bookingCount || 0} children require ${needed} staff; ${active.length} assigned.` });
  if (!people.some(({ assignment }) => roleLabels(session, assignment).includes("Manager"))) warnings.push({ code: "manager", serious: true, text: "No Manager is assigned." });
  if (!people.some(({ assignment }) => roleLabels(session, assignment).includes("DSL"))) warnings.push({ code: "dsl", serious: true, text: "No DSL is assigned." });
  if (session.settings?.sendcoRequired && !people.some(({ assignment }) => roleLabels(session, assignment).includes("SENDCO"))) warnings.push({ code: "sendco", serious: false, text: "SENDCO cover is required." });
  if (session.settings?.firstAiderRequired !== false && !people.some(({ person }) => person.qualifications?.firstAid)) warnings.push({ code: "firstAid", serious: true, text: "No qualified first aider is assigned." });
  if (session.settings?.level3Required !== false && !people.some(({ person }) => person.qualifications?.level3)) warnings.push({ code: "level3", serious: true, text: "No Level 3-qualified member of staff is assigned." });
  const currentWindow = shiftWindow(session);
  for (const { assignment, person } of people) {
    const conflict = allSessions.some((other) => other.id !== session.id && (other.assignments || []).some((otherAssignment) => {
      if (otherAssignment.staffRecordId !== assignment.staffRecordId || !assignmentIsActive(otherAssignment)) return false;
      const otherWindow = shiftWindow(other);
      return shiftsOverlap(currentWindow, otherWindow);
    }));
    if (conflict && !warnings.some((warning) => warning.code === `conflict-${person.id}`)) warnings.push({ code: `conflict-${person.id}`, serious: true, text: `${person.name} has an overlapping shift.` });
  }
  return warnings;
}

function readiness(session, staff, allSessions, published) {
  const warnings = sessionWarnings(session, staff, allSessions);
  if (warnings.some((warning) => warning.code.startsWith("conflict"))) return { label: "Conflict", tone: "bad", warnings };
  if (warnings.some((warning) => warning.code === "understaffed")) return { label: "Understaffed", tone: "bad", warnings };
  if (warnings.length) return { label: "Needs attention", tone: "warn", warnings };
  if (!published) return { label: "Unpublished", tone: "neutral", warnings };
  return { label: "Ready", tone: "good", warnings };
}

function absenceForStaff(personId, session, absences) {
  const window = shiftWindow(session);
  return absences.find((absence) => absence.staffRecordId === personId
    && ["requested", "approved"].includes(absence.status)
    && new Date(absence.startsAt) < new Date(window.end)
    && new Date(absence.endsAt) > new Date(window.start));
}

function availabilityForStaff(personId, session, availability) {
  const date = new Date(session.startsAt);
  const day = date.getDay() || 7;
  const iso = localIsoDate(date);
  return availability.find((entry) => entry.staffRecordId === personId && entry.specificDate === iso)
    || availability.find((entry) => entry.staffRecordId === personId && !entry.specificDate && Number(entry.weekday) === day)
    || null;
}

function qualificationBadges(person) {
  const values = [];
  if (person.qualifications?.manager) values.push("Manager");
  if (person.qualifications?.dsl) values.push("DSL");
  if (person.qualifications?.sendco) values.push("SENDCO");
  if (person.qualifications?.firstAid) values.push("First Aid");
  if (person.qualifications?.level3) values.push("Level 3");
  if (person.qualifications?.eyfs) values.push("EYFS");
  return values;
}

function StatusPill({ value, tone = "neutral" }) {
  return <span className={`staffing-status ${tone}`}>{value}</span>;
}

function StaffAvatar({ person }) {
  if (person.photoUrl) return <img className="staffing-avatar" src={person.photoUrl} alt="" />;
  const initials = String(person.name || "Staff").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className="staffing-avatar initials" aria-hidden="true">{initials}</span>;
}

function InlineNotice({ message }) {
  if (!message?.text) return null;
  return <div className={`staffing-notice ${message.tone || "info"}`} role={message.tone === "bad" ? "alert" : "status"}>{message.text}</div>;
}

export function Staffing({ access, legacyHours = null }) {
  const canEdit = ["Manager", "Admin", "Superadmin"].includes(access?.role);
  const canOverride = ["Admin", "Superadmin"].includes(access?.role);
  const [activeTab, setActiveTab] = useState("Today");
  const [anchorDate, setAnchorDate] = useState(localIsoDate(new Date()));
  const [plannerStart, setPlannerStart] = useState(weekStart());
  const [payload, setPayload] = useState({ sessions: [], staff: [], availability: [], absences: [], publications: [], coverRequests: [], currentStaffId: "" });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [schoolFilter, setSchoolFilter] = useState("All schools");
  const [serviceFilter, setServiceFilter] = useState("All services");
  const [staffFilter, setStaffFilter] = useState("All staff");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [query, setQuery] = useState("");
  const [staffPanelOpen, setStaffPanelOpen] = useState(true);
  const [staffSearch, setStaffSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("All availability");
  const [qualificationFilter, setQualificationFilter] = useState("All qualifications");
  const [employmentFilter, setEmploymentFilter] = useState("All employment");
  const [addStaffSessionId, setAddStaffSessionId] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [draggedStaffId, setDraggedStaffId] = useState("");
  const [draggedAssignment, setDraggedAssignment] = useState(null);
  const [warningSessionId, setWarningSessionId] = useState("");
  const [settingsSessionId, setSettingsSessionId] = useState("");
  const [publishing, setPublishing] = useState(false);

  const plannerEnd = addDays(plannerStart, 6);
  const loadFrom = activeTab === "Today" ? anchorDate : plannerStart;
  const loadTo = activeTab === "Today" ? anchorDate : plannerEnd;

  async function loadStaffing(showLoader = true) {
    if (showLoader) setLoading(true);
    try {
      const { fetchStaffingPlanner } = await staffingApi();
      const result = await fetchStaffingPlanner(loadFrom, loadTo);
      setPayload(result);
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Staffing data could not be loaded." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStaffing();
  }, [loadFrom, loadTo]);

  const sessions = payload.sessions || [];
  const staff = payload.staff || [];
  const schools = ["All schools", ...new Set(sessions.map((session) => session.siteName).filter(Boolean))];
  const services = ["All services", ...new Set(sessions.map((session) => session.programmeName).filter(Boolean))];
  const employmentTypes = ["All employment", ...new Set(staff.map((person) => person.employmentType).filter(Boolean))];
  const latestPublication = payload.publications?.find((publication) => publication.status === "published");
  const isPublished = (session) => Boolean(session.assignments?.some((assignment) => assignment.publicationVersion));
  const weekMinutes = useMemo(() => staff.reduce((totals, person) => {
    totals[person.id] = sessions.reduce((sum, session) => sum + (session.assignments || []).filter((assignment) => assignment.staffRecordId === person.id && assignmentIsActive(assignment)).reduce((minutes) => minutes + minutesBetween(shiftWindow(session).start, shiftWindow(session).end), 0), 0);
    return totals;
  }, {}), [sessions, staff]);

  const visibleSessions = sessions.filter((session) => {
    const state = readiness(session, staff, sessions, isPublished(session));
    const haystack = [session.siteName, session.programmeName, ...(session.assignments || []).map((assignment) => assignment.staffName)].join(" ").toLowerCase();
    return (schoolFilter === "All schools" || session.siteName === schoolFilter)
      && (serviceFilter === "All services" || session.programmeName === serviceFilter)
      && (staffFilter === "All staff" || session.assignments?.some((assignment) => assignment.staffRecordId === staffFilter))
      && (statusFilter === "All statuses" || state.label === statusFilter)
      && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  });

  const filteredStaff = staff.filter((person) => {
    const text = [person.name, person.jobRole, person.primarySite, person.employmentType, ...qualificationBadges(person)].join(" ").toLowerCase();
    const hasUnavailable = sessions.some((session) => absenceForStaff(person.id, session, payload.absences || []) || availabilityForStaff(person.id, session, payload.availability || [])?.status === "unavailable");
    return (!staffSearch.trim() || text.includes(staffSearch.trim().toLowerCase()))
      && (employmentFilter === "All employment" || person.employmentType === employmentFilter)
      && (qualificationFilter === "All qualifications" || qualificationBadges(person).includes(qualificationFilter))
      && (availabilityFilter === "All availability" || (availabilityFilter === "Available" ? !hasUnavailable : hasUnavailable));
  });

  async function assignStaff(session, staffId, options = {}) {
    if (!canEdit || !staffId) return;
    setMessage({ tone: "info", text: "Saving assignment…" });
    try {
      const { saveStaffingAssignment, removeStaffingAssignment } = await staffingApi();
      await saveStaffingAssignment({ sessionId: session.id, staffRecordId: staffId, ...options });
      if (draggedAssignment && draggedAssignment.sessionId !== session.id) await removeStaffingAssignment(draggedAssignment.assignmentId, `Moved to ${session.siteName} · ${session.programmeName}`);
      setMessage({ tone: "good", text: `${staff.find((person) => person.id === staffId)?.name || "Staff member"} assigned to ${session.siteName}.` });
      setAddStaffSessionId("");
      setSelectedStaffId("");
      await loadStaffing(false);
    } catch (error) {
      const conflict = String(error.message || "").includes("STAFF_CONFLICT") || String(error.message || "").includes("STAFF_UNAVAILABLE");
      if (conflict && canOverride) {
        const reason = window.prompt(`${String(error.message).split("|").pop()}\n\nEnter the authorised override reason to continue:`);
        if (reason?.trim()) return assignStaff(session, staffId, { ...options, overrideReason: reason.trim() });
      }
      setMessage({ tone: "bad", text: String(error.message || "Assignment could not be saved.").split("|").pop() });
    } finally {
      setDraggedStaffId("");
      setDraggedAssignment(null);
    }
  }

  async function removeAssignment(assignment) {
    if (!canEdit || !window.confirm(`Remove ${assignment.staffName} from this shift?`)) return;
    try {
      const { removeStaffingAssignment } = await staffingApi();
      await removeStaffingAssignment(assignment.id, "Removed in Staffing planner");
      setMessage({ tone: "good", text: `${assignment.staffName} removed from the shift.` });
      await loadStaffing(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Assignment could not be removed." });
    }
  }

  async function updateAssignmentRole(session, assignment, role) {
    await assignStaff(session, assignment.staffRecordId, {
      sessionRole: role,
      actingManager: role === "manager",
      actingDsl: role === "dsl",
      actingSendco: role === "sendco",
    });
  }

  function beginStaffDrag(event, person) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/staff-id", person.id);
    setDraggedStaffId(person.id);
    setDraggedAssignment(null);
  }

  function beginAssignmentDrag(event, session, assignment) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/staff-id", assignment.staffRecordId);
    setDraggedStaffId(assignment.staffRecordId);
    setDraggedAssignment({ assignmentId: assignment.id, sessionId: session.id });
  }

  function dropStaff(event, session) {
    event.preventDefault();
    const staffId = event.dataTransfer.getData("text/staff-id") || draggedStaffId;
    assignStaff(session, staffId);
  }

  async function publishWeek() {
    const warnings = sessions.flatMap((session) => sessionWarnings(session, staff, sessions).map((warning) => ({ ...warning, sessionId: session.id, siteName: session.siteName, programmeName: session.programmeName })));
    let overrideReason = "";
    if (warnings.length) {
      overrideReason = window.prompt(`${warnings.length} staffing warning${warnings.length === 1 ? " remains" : "s remain"}. Enter an authorised override reason to publish, or Cancel to return to the planner:`) || "";
      if (!overrideReason.trim()) {
        setMessage({ tone: "warn", text: "Publication cancelled. Resolve the highlighted warnings or enter an override reason." });
        return;
      }
    }
    setPublishing(true);
    try {
      const { publishStaffingRota } = await staffingApi();
      const publication = await publishStaffingRota({ dateFrom: plannerStart, dateTo: plannerEnd, warnings, overrideReason });
      setMessage({ tone: "good", text: `Rota version ${publication.version} published. Assigned staff can now view and acknowledge their shifts.` });
      await loadStaffing(false);
    } catch (error) {
      setMessage({ tone: "bad", text: String(error.message || "Rota could not be published.").split("|").pop() });
    } finally {
      setPublishing(false);
    }
  }

  async function copyPreviousWeek() {
    if (!canEdit) return;
    setMessage({ tone: "info", text: "Checking the previous week against current sessions and availability…" });
    try {
      const { fetchStaffingPlanner, saveStaffingAssignment } = await staffingApi();
      const previousStart = addDays(plannerStart, -7);
      const previous = await fetchStaffingPlanner(previousStart, addDays(previousStart, 6));
      let copied = 0;
      let skipped = 0;
      for (const target of sessions) {
        const targetDate = new Date(target.startsAt);
        const source = previous.sessions.find((candidate) => candidate.siteId === target.siteId
          && candidate.programmeId === target.programmeId
          && new Date(candidate.startsAt).getDay() === targetDate.getDay()
          && formatTime(candidate.startsAt) === formatTime(target.startsAt));
        if (!source) continue;
        for (const assignment of source.assignments || []) {
          try {
            await saveStaffingAssignment({
              sessionId: target.id,
              staffRecordId: assignment.staffRecordId,
              sessionRole: assignment.sessionRole,
              actingManager: assignment.actingManager,
              actingDsl: assignment.actingDsl,
              actingSendco: assignment.actingSendco,
            });
            copied += 1;
          } catch {
            skipped += 1;
          }
        }
      }
      setMessage({ tone: skipped ? "warn" : "good", text: `${copied} assignment${copied === 1 ? "" : "s"} copied. ${skipped ? `${skipped} skipped because of absence, conflict or inactive staff.` : "No conflicts found."}` });
      await loadStaffing(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "The previous week could not be copied." });
    }
  }

  async function createCover(session, assignment = null) {
    const reason = window.prompt("Reason for cover", assignment?.status === "sick" ? "Sickness" : "Cover required");
    if (reason === null) return;
    try {
      const { createStaffingCoverRequest } = await staffingApi();
      await createStaffingCoverRequest({ sessionId: session.id, assignmentId: assignment?.id, reason: reason || "Cover required" });
      setMessage({ tone: "good", text: `Cover request opened for ${session.siteName}.` });
      await loadStaffing(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Cover request could not be opened." });
    }
  }

  async function saveSiteSettings(event, session) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { saveStaffingSiteSettings } = await staffingApi();
      await saveStaffingSiteSettings({
        locationId: session.siteId,
        defaultManagerStaffId: form.get("manager"),
        defaultDslStaffId: form.get("dsl"),
        defaultSendcoStaffId: form.get("sendco"),
        setupMinutes: form.get("setup"),
        closingMinutes: form.get("closing"),
        minimumStaff: form.get("minimum"),
        childrenPerStaff: form.get("ratio"),
        firstAiderRequired: form.get("firstAid") === "on",
        level3Required: form.get("level3") === "on",
        sendcoRequired: form.get("sendcoRequired") === "on",
        operationalNotes: form.get("notes"),
      });
      setSettingsSessionId("");
      setMessage({ tone: "good", text: `${session.siteName} staffing rules saved.` });
      await loadStaffing(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Site staffing rules could not be saved." });
    }
  }

  const sessionCard = (session, compact = false) => {
    const window = shiftWindow(session);
    const state = readiness(session, staff, sessions, isPublished(session));
    const activeAssignments = (session.assignments || []).filter((assignment) => assignment.status !== "cancelled");
    const needed = requiredStaff(session);
    const addOpen = addStaffSessionId === session.id;
    return (
      <article className={`staffing-session-card ${state.tone} ${compact ? "compact" : ""}`} key={session.id} onDragOver={(event) => canEdit && event.preventDefault()} onDrop={(event) => dropStaff(event, session)}>
        <header>
          <div>
            <span className="staffing-service">{session.programmeName}</span>
            <h3>{session.siteName}</h3>
            <small>{formatDay(localIsoDate(new Date(session.startsAt)), true)}</small>
          </div>
          <button type="button" className={`staffing-status-button ${state.tone}`} onClick={() => setWarningSessionId(warningSessionId === session.id ? "" : session.id)} aria-expanded={warningSessionId === session.id}>{state.label}</button>
        </header>
        <div className="staffing-time-grid">
          <div><span>Staff shift</span><strong>{formatTime(window.start)}–{formatTime(window.end)}</strong><small>{(minutesBetween(window.start, window.end) / 60).toFixed(2).replace(/\.00$/, "")} paid hours</small></div>
          <div><span>Childcare session</span><strong>{formatTime(session.startsAt)}–{formatTime(session.endsAt)}</strong><small>{window.setup} min setup · {window.closing} min close</small></div>
        </div>
        <div className="staffing-demand">
          <span><b>{session.bookingCount || 0}</b> booked</span>
          <span><b>{session.expectedCount || 0}</b> expected</span>
          <span><b>{session.presentCount || 0}</b> present</span>
          <span><b>{needed}</b> required</span>
          <span><b>{activeAssignments.filter(assignmentIsActive).length}</b> assigned</span>
        </div>
        {warningSessionId === session.id && (
          <div className="staffing-warning-list">
            {state.warnings.length ? state.warnings.map((warning) => <p key={warning.code}><span aria-hidden="true">{warning.serious ? "⚠" : "ⓘ"}</span>{warning.text}</p>) : <p><span aria-hidden="true">✓</span>All configured staffing and qualification checks pass.</p>}
          </div>
        )}
        <div className="staffing-assignment-list">
          {activeAssignments.map((assignment) => {
            const person = staffForAssignment(assignment, staff);
            const labels = roleLabels(session, assignment);
            return (
              <div className={`staffing-assignment ${assignment.status !== "assigned" ? "attention" : ""}`} key={assignment.id} draggable={canEdit} onDragStart={(event) => beginAssignmentDrag(event, session, assignment)}>
                <StaffAvatar person={person} />
                <div><strong>{person.name}</strong><span>{labels.join(" · ")}</span><small>{assignment.acknowledgementStatus === "draft" ? "Draft" : String(assignment.acknowledgementStatus || "draft").replaceAll("_", " ")}</small></div>
                {canEdit && <select aria-label={`Shift role for ${person.name}`} value={assignment.sessionRole || "assistant"} onChange={(event) => updateAssignmentRole(session, assignment, event.target.value)}><option value="assistant">Assistant</option><option value="manager">Acting Manager</option><option value="dsl">Acting DSL</option><option value="sendco">Acting SENDCO</option></select>}
                {canEdit && <button type="button" className="staffing-remove" onClick={() => removeAssignment(assignment)} aria-label={`Remove ${person.name}`}>×</button>}
              </div>
            );
          })}
          {!activeAssignments.length && <div className="staffing-drop-empty">Drop staff here or use Add staff</div>}
        </div>
        {canEdit && (
          <div className="staffing-card-actions">
            <button type="button" onClick={() => setAddStaffSessionId(addOpen ? "" : session.id)}>+ Add staff</button>
            <button type="button" onClick={() => createCover(session)}>Request cover</button>
            <button type="button" onClick={() => setSettingsSessionId(session.id)}>Rules</button>
          </div>
        )}
        {addOpen && (
          <div className="staffing-add-row">
            <select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} aria-label={`Add staff to ${session.siteName}`}>
              <option value="">Choose staff member</option>
              {staff.map((person) => {
                const absence = absenceForStaff(person.id, session, payload.absences || []);
                return <option key={person.id} value={person.id} disabled={Boolean(absence)}>{person.name}{absence ? ` · ${absence.type.replaceAll("_", " ")}` : person.primarySite ? ` · ${person.primarySite}` : ""}</option>;
              })}
            </select>
            <button type="button" onClick={() => assignStaff(session, selectedStaffId)} disabled={!selectedStaffId}>Assign</button>
          </div>
        )}
      </article>
    );
  };

  const todayStates = visibleSessions.map((session) => readiness(session, staff, sessions, isPublished(session)));
  const todayStaffIds = new Set(visibleSessions.flatMap((session) => (session.assignments || []).filter(assignmentIsActive).map((assignment) => assignment.staffRecordId)));
  const totalMinutes = visibleSessions.reduce((total, session) => total + (session.assignments || []).filter(assignmentIsActive).length * minutesBetween(shiftWindow(session).start, shiftWindow(session).end), 0);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(plannerStart, index)).filter((date) => sessions.some((session) => localIsoDate(new Date(session.startsAt)) === date));

  return (
    <div className="staffing-workspace stack">
      <div className="staffing-hero">
        <div><p className="eyebrow">Live workforce planning</p><h2>Staffing</h2><p>Plan every operating session, prove role and qualification cover, publish shifts and generate paid hours.</p></div>
        {latestPublication && <div className="staffing-published"><span>Latest publication</span><strong>Version {latestPublication.version}</strong><small>{latestPublication.publishedAt ? new Date(latestPublication.publishedAt).toLocaleString("en-GB") : "Published"}</small></div>}
      </div>
      <nav className="staffing-tabs" aria-label="Staffing sections">
        {["Today", "Planner", "Cover", "Hours"].map((item) => <button type="button" key={item} className={activeTab === item ? "active" : ""} aria-current={activeTab === item ? "page" : undefined} onClick={() => setActiveTab(item)}>{item}{item === "Cover" && payload.coverRequests?.filter((request) => !["filled", "cancelled"].includes(request.status)).length ? <span>{payload.coverRequests.filter((request) => !["filled", "cancelled"].includes(request.status)).length}</span> : null}</button>)}
      </nav>
      <InlineNotice message={message} />

      {activeTab === "Today" && (
        <>
          <div className="staffing-toolbar">
            <div className="staffing-date-control"><button type="button" onClick={() => setAnchorDate(addDays(anchorDate, -1))} aria-label="Previous day">‹</button><label><span>Date</span><input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} /></label><button type="button" onClick={() => setAnchorDate(addDays(anchorDate, 1))} aria-label="Next day">›</button><button type="button" onClick={() => setAnchorDate(localIsoDate(new Date()))}>Today</button></div>
            <StaffingFilters schools={schools} services={services} staff={staff} school={schoolFilter} setSchool={setSchoolFilter} service={serviceFilter} setService={setServiceFilter} staffValue={staffFilter} setStaffValue={setStaffFilter} status={statusFilter} setStatus={setStatusFilter} query={query} setQuery={setQuery} />
          </div>
          <div className="staffing-metrics">
            <article><span>Sessions operating</span><strong>{visibleSessions.length}</strong></article>
            <article><span>Fully staffed</span><strong>{todayStates.filter((state) => state.label === "Ready").length}</strong></article>
            <article className={todayStates.some((state) => state.warnings.length) ? "warn" : ""}><span>Needs attention</span><strong>{todayStates.filter((state) => state.warnings.length).length}</strong></article>
            <article><span>Open cover requests</span><strong>{payload.coverRequests?.filter((request) => !["filled", "cancelled"].includes(request.status)).length || 0}</strong></article>
            <article><span>Staff working</span><strong>{todayStaffIds.size}</strong></article>
            <article><span>Scheduled hours</span><strong>{(totalMinutes / 60).toFixed(1)}</strong></article>
          </div>
          <div className="staffing-today-list">{visibleSessions.map((session) => sessionCard(session, true))}</div>
          {!loading && !visibleSessions.length && <div className="staffing-empty"><strong>No operating sessions</strong><span>No active sessions match this date and filter.</span></div>}
        </>
      )}

      {activeTab === "Planner" && (
        <>
          <div className="staffing-toolbar planner">
            <div className="staffing-date-control"><button type="button" onClick={() => setPlannerStart(addDays(plannerStart, -7))}>Previous week</button><button type="button" onClick={() => setPlannerStart(weekStart())}>Current week</button><button type="button" onClick={() => setPlannerStart(addDays(plannerStart, 7))}>Next week</button><label><span>Week of</span><input type="date" value={plannerStart} onChange={(event) => setPlannerStart(weekStart(event.target.value))} /></label></div>
            <div className="staffing-publish-actions">{canEdit && <button type="button" onClick={copyPreviousWeek}>Copy previous week</button>}{canEdit && <button type="button" className="primary" onClick={publishWeek} disabled={publishing || loading}>{publishing ? "Publishing…" : "Publish rota"}</button>}</div>
          </div>
          <StaffingFilters schools={schools} services={services} staff={staff} school={schoolFilter} setSchool={setSchoolFilter} service={serviceFilter} setService={setServiceFilter} staffValue={staffFilter} setStaffValue={setStaffFilter} status={statusFilter} setStatus={setStatusFilter} query={query} setQuery={setQuery} />
          <div className={`staffing-planner ${staffPanelOpen ? "" : "staff-closed"}`}>
            <aside className="staffing-staff-panel">
              <header><div><strong>Staff</strong><span>{filteredStaff.length} available to plan</span></div><button type="button" onClick={() => setStaffPanelOpen(false)} aria-label="Collapse staff panel">‹</button></header>
              <input type="search" value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="Search staff or role" aria-label="Search staff" />
              <div className="staffing-staff-filters"><select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option>All availability</option><option>Available</option><option>Unavailable</option></select><select value={qualificationFilter} onChange={(event) => setQualificationFilter(event.target.value)}><option>All qualifications</option><option>Manager</option><option>DSL</option><option>SENDCO</option><option>First Aid</option><option>Level 3</option><option>EYFS</option></select><select value={employmentFilter} onChange={(event) => setEmploymentFilter(event.target.value)}>{employmentTypes.map((value) => <option key={value}>{value}</option>)}</select></div>
              <div className="staffing-staff-list">
                {filteredStaff.map((person) => {
                  const badges = qualificationBadges(person);
                  const unavailable = sessions.some((session) => absenceForStaff(person.id, session, payload.absences || []));
                  return <article className={`staffing-staff-card ${unavailable ? "unavailable" : ""}`} key={person.id} draggable={canEdit && !unavailable} onDragStart={(event) => beginStaffDrag(event, person)}><StaffAvatar person={person} /><div><strong>{person.name}</strong><span>{person.jobRole || "Staff"} · {person.employmentType || "Employment not recorded"}</span><small>{person.primarySite || "No home site"}</small></div><b>{(Number(weekMinutes[person.id] || 0) / 60).toFixed(1)}h</b><div className="staffing-qualification-row">{badges.slice(0, 4).map((badge) => <span key={badge}>{badge}</span>)}{unavailable && <span className="unavailable">Unavailable</span>}</div></article>;
                })}
              </div>
            </aside>
            {!staffPanelOpen && <button className="staffing-open-staff" type="button" onClick={() => setStaffPanelOpen(true)}>Show staff</button>}
            <section className="staffing-board" aria-label={`Staffing planner ${formatDay(plannerStart)} to ${formatDay(plannerEnd)}`}>
              <div className="staffing-week-grid" style={{ "--staffing-days": Math.max(1, dates.length) }}>
                {dates.map((date) => (
                  <section className="staffing-day-column" key={date}>
                    <header><span>{formatDay(date)}</span><strong>{visibleSessions.filter((session) => localIsoDate(new Date(session.startsAt)) === date).length} sessions</strong></header>
                    <div>{visibleSessions.filter((session) => localIsoDate(new Date(session.startsAt)) === date).map((session) => sessionCard(session))}</div>
                  </section>
                ))}
              </div>
              {!loading && !dates.length && <div className="staffing-empty"><strong>No sessions configured</strong><span>The planner only shows sessions that actually operate in the selected week.</span></div>}
            </section>
          </div>
        </>
      )}

      {activeTab === "Cover" && <CoverView sessions={sessions} staff={staff} absences={payload.absences || []} requests={payload.coverRequests || []} canEdit={canEdit} assignStaff={assignStaff} createCover={createCover} />}
      {activeTab === "Hours" && <HoursView sessions={sessions} staff={staff} legacyHours={legacyHours} canSeeCosts={["Admin", "Superadmin"].includes(access?.role)} />}
      {loading && <div className="staffing-loading" role="status"><span />Loading live sessions and staffing…</div>}

      {settingsSessionId && (() => {
        const session = sessions.find((item) => item.id === settingsSessionId);
        if (!session) return null;
        return <div className="staffing-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSettingsSessionId("")}><section className="staffing-settings-modal" role="dialog" aria-modal="true" aria-labelledby="staffing-rules-title"><header><div><span>School staffing defaults</span><h3 id="staffing-rules-title">{session.siteName}</h3></div><button type="button" onClick={() => setSettingsSessionId("")} aria-label="Close rules">×</button></header><form onSubmit={(event) => saveSiteSettings(event, session)}><div className="staffing-settings-grid"><label>Default Manager<select name="manager" defaultValue={session.settings?.defaultManagerStaffId || ""}><option value="">Not selected</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Default DSL<select name="dsl" defaultValue={session.settings?.defaultDslStaffId || ""}><option value="">Not selected</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Default SENDCO<select name="sendco" defaultValue={session.settings?.defaultSendcoStaffId || ""}><option value="">Not selected</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Setup minutes<input name="setup" type="number" min="0" max="180" defaultValue={session.settings?.setupMinutes ?? 15} /></label><label>Closing minutes<input name="closing" type="number" min="0" max="180" defaultValue={session.settings?.closingMinutes ?? 15} /></label><label>Minimum staff<input name="minimum" type="number" min="1" max="50" defaultValue={session.settings?.minimumStaff ?? 2} /></label><label>Children per staff member<input name="ratio" type="number" min="1" max="50" defaultValue={session.settings?.childrenPerStaff ?? 8} /></label></div><div className="staffing-rule-checks"><label><input type="checkbox" name="firstAid" defaultChecked={session.settings?.firstAiderRequired !== false} />First aider required</label><label><input type="checkbox" name="level3" defaultChecked={session.settings?.level3Required !== false} />Level 3 required</label><label><input type="checkbox" name="sendcoRequired" defaultChecked={Boolean(session.settings?.sendcoRequired)} />SENDCO required</label></div><label>Operational notes<textarea name="notes" rows="3" defaultValue={session.settings?.operationalNotes || ""} placeholder="Site-specific staffing or handover notes" /></label><div className="staffing-modal-actions"><button type="button" onClick={() => setSettingsSessionId("")}>Cancel</button><button type="submit">Save staffing rules</button></div></form></section></div>;
      })()}
    </div>
  );
}

function StaffingFilters({ schools, services, staff, school, setSchool, service, setService, staffValue, setStaffValue, status, setStatus, query, setQuery }) {
  return <div className="staffing-filters"><label><span>School</span><select value={school} onChange={(event) => setSchool(event.target.value)}>{schools.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Service</span><select value={service} onChange={(event) => setService(event.target.value)}>{services.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Staff member</span><select value={staffValue} onChange={(event) => setStaffValue(event.target.value)}><option>All staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All statuses</option><option>Ready</option><option>Needs attention</option><option>Understaffed</option><option>Conflict</option><option>Unpublished</option></select></label><label className="search"><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Site, session or person" /></label></div>;
}

function CoverView({ sessions, staff, absences, requests, canEdit, assignStaff, createCover }) {
  const open = requests.filter((request) => !["filled", "cancelled"].includes(request.status));
  const uncovered = sessions.filter((session) => (session.assignments || []).filter(assignmentIsActive).length < requiredStaff(session));
  return <div className="staffing-cover-view"><div className="staffing-section-heading"><div><p className="eyebrow">Absence and replacement workflow</p><h3>Cover</h3><p>Unfilled shifts, sickness and suitable available replacements in one place.</p></div><StatusPill value={`${open.length} open`} tone={open.length ? "warn" : "good"} /></div><div className="staffing-cover-grid">{open.map((request) => { const session = sessions.find((item) => item.id === request.sessionId); if (!session) return null; const suitable = staff.filter((person) => !absenceForStaff(person.id, session, absences) && !(session.assignments || []).some((assignment) => assignment.staffRecordId === person.id && assignmentIsActive(assignment))).sort((a, b) => Number(b.primarySite === session.siteName) - Number(a.primarySite === session.siteName) || Number(Boolean(b.qualifications?.firstAid)) - Number(Boolean(a.qualifications?.firstAid))); return <article key={request.id}><header><div><span>{request.reason}</span><h3>{session.siteName}</h3><p>{formatDay(localIsoDate(new Date(session.startsAt)), true)} · {formatTime(shiftWindow(session).start)}–{formatTime(shiftWindow(session).end)}</p></div><StatusPill value={request.status} tone="warn" /></header><strong>{request.vacancies} {request.vacancies === 1 ? "person" : "people"} needed · {ROLE_LABELS[request.requiredRole] || request.requiredRole}</strong><div className="staffing-cover-suggestions">{suitable.slice(0, 5).map((person, index) => <div key={person.id}><StaffAvatar person={person} /><span><b>{person.name}</b><small>{index === 0 ? "Best match · " : ""}{person.primarySite || "No home site"}{person.qualifications?.firstAid ? " · First Aid" : ""}</small></span>{canEdit && <button type="button" onClick={() => assignStaff(session, person.id)}>Assign</button>}</div>)}</div></article>; })}{uncovered.filter((session) => !open.some((request) => request.sessionId === session.id)).map((session) => <article className="unopened" key={session.id}><header><div><span>Unfilled shift</span><h3>{session.siteName}</h3><p>{formatDay(localIsoDate(new Date(session.startsAt)), true)} · {session.programmeName}</p></div><StatusPill value="Needs cover" tone="bad" /></header><p>{requiredStaff(session)} staff required; {(session.assignments || []).filter(assignmentIsActive).length} assigned.</p>{canEdit && <button type="button" onClick={() => createCover(session)}>Open cover request</button>}</article>)}</div>{!open.length && !uncovered.length && <div className="staffing-empty"><strong>No cover gaps</strong><span>All loaded sessions currently meet their staffing number.</span></div>}</div>;
}

function HoursView({ sessions, staff, legacyHours, canSeeCosts }) {
  const [group, setGroup] = useState("Staff member");
  const rows = sessions.flatMap((session) => (session.assignments || []).filter(assignmentIsActive).map((assignment) => {
    const person = staffForAssignment(assignment, staff);
    const window = shiftWindow(session);
    const scheduledMinutes = minutesBetween(assignment.scheduledStart || window.start, assignment.scheduledEnd || window.end);
    return { id: assignment.id, person, session, window, scheduledMinutes, actualMinutes: assignment.actualMinutes ?? null, varianceMinutes: assignment.varianceMinutes ?? null, approvalStatus: assignment.hoursApprovalStatus || "Draft" };
  }));
  const totalMinutes = rows.reduce((sum, row) => sum + row.scheduledMinutes, 0);
  const totalCost = rows.reduce((sum, row) => sum + (row.scheduledMinutes / 60) * Number(row.person.payRate || 0), 0);
  return <div className="staffing-hours-view"><div className="staffing-section-heading"><div><p className="eyebrow">Scheduled from published shifts</p><h3>Hours</h3><p>Setup and closing time are included once. Payroll approval remains a separate control.</p></div><label>Group by<select value={group} onChange={(event) => setGroup(event.target.value)}><option>Staff member</option><option>School</option><option>Date</option><option>Service type</option></select></label></div><div className="staffing-metrics"><article><span>Assignments</span><strong>{rows.length}</strong></article><article><span>Scheduled hours</span><strong>{(totalMinutes / 60).toFixed(2)}</strong></article><article><span>Actual hours entered</span><strong>{(rows.reduce((sum, row) => sum + Number(row.actualMinutes || 0), 0) / 60).toFixed(2)}</strong></article>{canSeeCosts && <article><span>Estimated cost</span><strong>£{totalCost.toFixed(2)}</strong></article>}</div><div className="table-wrap staffing-hours-table"><table><thead><tr><th>Staff member</th><th>Date</th><th>School / service</th><th>Paid window</th><th>Scheduled</th><th>Actual</th><th>Variance</th><th>Status</th>{canSeeCosts && <th>Estimated cost</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.person.name}</strong><small>{row.person.employmentType || row.person.jobRole || "Staff"}</small></td><td>{formatDay(localIsoDate(new Date(row.session.startsAt)))}</td><td><strong>{row.session.siteName}</strong><small>{row.session.programmeName}</small></td><td>{formatTime(row.window.start)}–{formatTime(row.window.end)}</td><td>{(row.scheduledMinutes / 60).toFixed(2)}h</td><td>{row.actualMinutes == null ? "—" : `${(row.actualMinutes / 60).toFixed(2)}h`}</td><td>{row.varianceMinutes == null ? "—" : `${row.varianceMinutes > 0 ? "+" : ""}${row.varianceMinutes}m`}</td><td><StatusPill value={row.approvalStatus} tone={String(row.approvalStatus).toLowerCase() === "approved" ? "good" : "neutral"} /></td>{canSeeCosts && <td>£{((row.scheduledMinutes / 60) * Number(row.person.payRate || 0)).toFixed(2)}</td>}</tr>)}</tbody></table></div>{!rows.length && <div className="staffing-empty"><strong>No scheduled hours</strong><span>Hours appear automatically when staff are assigned to operating sessions.</span></div>}{legacyHours && <details className="staffing-payroll-reconciliation"><summary>Monthly payroll reconciliation</summary>{legacyHours}</details>}</div>;
}

export function MyShifts({ access }) {
  const [payload, setPayload] = useState({ sessions: [], currentStaffId: "" });
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const start = localIsoDate(new Date());
  const end = addDays(start, 42);

  async function load() {
    try {
      const { fetchStaffingPlanner } = await staffingApi();
      setPayload(await fetchStaffingPlanner(start, end));
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Upcoming shifts could not be loaded." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  const shifts = (payload.sessions || []).flatMap((session) => (session.assignments || []).filter((assignment) => assignment.staffRecordId === payload.currentStaffId && assignment.status !== "cancelled").map((assignment) => ({ session, assignment }))).sort((a, b) => new Date(a.session.startsAt) - new Date(b.session.startsAt));

  async function acknowledge(assignment, status) {
    try {
      const { acknowledgeStaffingAssignment } = await staffingApi();
      await acknowledgeStaffingAssignment(assignment.id, status);
      setMessage({ tone: status === "acknowledged" ? "good" : "warn", text: status === "acknowledged" ? "Shift acknowledged." : "Your manager has been told that you cannot attend." });
      await load();
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "The shift could not be updated." });
    }
  }

  return <section className="my-shifts-panel"><div className="staffing-section-heading"><div><p className="eyebrow">Published rota</p><h2>My Shifts</h2><p>Arrival and finish times include paid setup, handover and closing duties.</p></div><StatusPill value={`${shifts.length} upcoming`} tone={shifts.length ? "good" : "neutral"} /></div><InlineNotice message={message} />{loading ? <div className="staffing-loading"><span />Loading shifts…</div> : <div className="my-shifts-list">{shifts.map(({ session, assignment }) => { const window = shiftWindow(session); const manager = (session.assignments || []).find((item) => roleLabels(session, item).includes("Manager")); return <article key={assignment.id}><header><div><span>{formatDay(localIsoDate(new Date(session.startsAt)), true)}</span><h3>{session.siteName}</h3><p>{session.programmeName}</p></div><StatusPill value={String(assignment.acknowledgementStatus || "draft").replaceAll("_", " ")} tone={assignment.acknowledgementStatus === "acknowledged" ? "good" : assignment.acknowledgementStatus === "unable_to_attend" ? "bad" : "warn"} /></header><div className="my-shift-times"><span><b>Arrive</b>{formatTime(window.start)}</span><span><b>Children attend</b>{formatTime(session.startsAt)}–{formatTime(session.endsAt)}</span><span><b>Finish</b>{formatTime(window.end)}</span><span><b>Paid hours</b>{(minutesBetween(window.start, window.end) / 60).toFixed(2)}</span></div><p><b>Role:</b> {roleLabels(session, assignment).join(" · ")} · <b>Manager:</b> {manager?.staffName || "To be confirmed"}</p>{assignment.operationalNotes && <p>{assignment.operationalNotes}</p>}{assignment.publicationVersion && assignment.acknowledgementStatus !== "acknowledged" && <div className="my-shift-actions"><button type="button" onClick={() => acknowledge(assignment, "unable_to_attend")}>Unable to attend</button><button type="button" onClick={() => acknowledge(assignment, "acknowledged")}>Acknowledge shift</button></div>}</article>; })}</div>}{!loading && !shifts.length && <div className="staffing-empty"><strong>No published shifts yet</strong><span>Your next confirmed shifts will appear here after the rota is published.</span></div>}</section>;
}
