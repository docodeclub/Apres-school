import { useEffect, useMemo, useState } from "react";

const todayIso = () => new Date().toISOString().slice(0, 10);
const moneylessNumber = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, "");
const addDaysIso = (value, days) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };

function displayDate(value) {
  if (!value) return "Date not set";
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dateRangeLabel(start, end) {
  if (!start) return "Dates not set";
  return start === end ? displayDate(start) : `${displayDate(start)} – ${displayDate(end)}`;
}

function workingDaysBetween(start, end) {
  if (!start || !end || end < start) return 0;
  let total = 0;
  const cursor = new Date(`${start}T12:00:00`);
  const finish = new Date(`${end}T12:00:00`);
  while (cursor <= finish) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) total += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function dateRangeFitsHolidayWindows(start, end, windows = []) {
  if (!start || !end || end < start) return false;
  const cursor = new Date(`${start}T12:00:00`);
  const finish = new Date(`${end}T12:00:00`);
  let workingDays = 0;
  while (cursor <= finish) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      workingDays += 1;
      const value = cursor.toISOString().slice(0, 10);
      if (!windows.some((window) => window.startsOn <= value && window.endsOn >= value)) return false;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return workingDays > 0;
}

function leaveYearBounds(settings, reference = todayIso()) {
  const month = Number(settings?.leaveYearStartMonth || 1);
  const day = Number(settings?.leaveYearStartDay || 1);
  const referenceDate = new Date(`${reference}T12:00:00`);
  let year = referenceDate.getFullYear();
  const candidate = new Date(year, month - 1, day, 12);
  if (referenceDate < candidate) year -= 1;
  const start = new Date(year, month - 1, day, 12);
  const end = new Date(year + 1, month - 1, day, 12);
  end.setDate(end.getDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function statusTone(status) {
  if (status === "approved") return "approved";
  if (status === "declined" || status === "cancelled") return "closed";
  return "pending";
}

function HolidayStatus({ value }) {
  return <span className={`holiday-status ${statusTone(value)}`}>{String(value || "requested").replace(/_/g, " ")}</span>;
}

function EmptyHoliday({ title, text }) {
  return <div className="holiday-empty"><strong>{title}</strong><p>{text}</p></div>;
}

const absenceCategories = [
  ["sickness", "Sickness"],
  ["medical", "Medical appointment or treatment"],
  ["dependent_emergency", "Dependent or family emergency"],
  ["bereavement", "Bereavement"],
  ["unpaid_leave", "Unpaid leave"],
  ["other", "Other absence"],
];
const absenceCategoryLabel = (value) => absenceCategories.find(([key]) => key === value)?.[1] || "Other absence";

export default function HolidayModule({ access }) {
  const [workspace, setWorkspace] = useState({ staff: [], requests: [], entitlements: [], settings: {}, currentStaffId: "", role: access?.role || "Staff", requestPolicy: "school_holidays_only", policySite: "", allowedWindows: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [view, setView] = useState("mine");
  const [request, setRequest] = useState({ startDate: "", endDate: "", dayPortion: "full_day", requestedHours: "", note: "" });
  const [decisionNotes, setDecisionNotes] = useState({});
  const [settingsDraft, setSettingsDraft] = useState({});
  const [entitlementDrafts, setEntitlementDrafts] = useState({});
  const [absenceDraft, setAbsenceDraft] = useState({ staffRecordId: "", startDate: todayIso(), endDate: todayIso(), category: "sickness", note: "" });
  const [absenceCloseDrafts, setAbsenceCloseDrafts] = useState({});

  const canReview = ["Manager", "Admin", "Superadmin"].includes(access?.role);
  const isAdmin = ["Admin", "Superadmin"].includes(access?.role);

  async function loadWorkspace(message = "") {
    setLoading(true);
    try {
      const { fetchHolidayWorkspace, fetchAbsenceWorkspace } = await import("./supabaseClient.js");
      const [holidayWorkspace, absenceWorkspace] = await Promise.all([fetchHolidayWorkspace(), fetchAbsenceWorkspace()]);
      const next = { ...holidayWorkspace, absences: absenceWorkspace.absences || [] };
      setWorkspace(next);
      setAbsenceDraft((current) => ({ ...current, staffRecordId: current.staffRecordId || next.currentStaffId || "" }));
      setSettingsDraft(next.settings || {});
      setEntitlementDrafts(Object.fromEntries((next.staff || []).map((person) => {
        const bounds = leaveYearBounds(next.settings);
        const saved = (next.entitlements || []).find((item) => item.staffRecordId === person.id && todayIso() >= item.leaveYearStart && todayIso() <= item.leaveYearEnd)
          || (next.entitlements || []).find((item) => item.staffRecordId === person.id);
        return [person.id, saved || {
          staffRecordId: person.id,
          leaveYearStart: bounds.start,
          leaveYearEnd: bounds.end,
          allowanceHours: next.settings?.defaultAllowanceHours || 0,
          carriedForwardHours: 0,
          adjustmentHours: 0,
          note: "",
        }];
      })));
      if (message) setStatus(message);
    } catch (error) {
      setStatus(error.message || "Holiday records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadWorkspace(); }, [access?.currentUser?.id, access?.role]);

  const ownStaff = workspace.currentStaffId ? workspace.staff.find((person) => person.id === workspace.currentStaffId) || null : null;
  const ownRequests = workspace.requests.filter((item) => item.staffRecordId === workspace.currentStaffId);
  const currentEntitlement = workspace.entitlements.find((item) => item.staffRecordId === workspace.currentStaffId && todayIso() >= item.leaveYearStart && todayIso() <= item.leaveYearEnd)
    || workspace.entitlements.find((item) => item.staffRecordId === workspace.currentStaffId) || null;
  const allowance = currentEntitlement ? currentEntitlement.allowanceHours + currentEntitlement.carriedForwardHours + currentEntitlement.adjustmentHours : 0;
  const approvedHours = ownRequests.filter((item) => item.status === "approved" && (!currentEntitlement || (item.startDate >= currentEntitlement.leaveYearStart && item.startDate <= currentEntitlement.leaveYearEnd))).reduce((sum, item) => sum + item.requestedHours, 0);
  const pendingHours = ownRequests.filter((item) => item.status === "requested" && (!currentEntitlement || (item.startDate >= currentEntitlement.leaveYearStart && item.startDate <= currentEntitlement.leaveYearEnd))).reduce((sum, item) => sum + item.requestedHours, 0);
  const remainingHours = allowance - approvedHours - pendingHours;
  const pendingApprovals = workspace.requests.filter((item) => item.status === "requested" && item.staffRecordId !== workspace.currentStaffId);
  const teamCalendar = workspace.requests.filter((item) => ["requested", "approved"].includes(item.status)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const standardDayHours = Number(workspace.settings?.standardDayHours || 6);
  const siteHolidayRule = workspace.requestPolicy === "school_holidays_only";
  const datesAllowed = !siteHolidayRule || !request.startDate || !request.endDate || dateRangeFitsHolidayWindows(request.startDate, request.endDate, workspace.allowedWindows);
  const suggestedHours = useMemo(() => {
    if (!request.startDate || !request.endDate) return 0;
    if (request.dayPortion === "morning" || request.dayPortion === "afternoon") return standardDayHours / 2;
    if (request.dayPortion === "custom") return Number(request.requestedHours || 0);
    return workingDaysBetween(request.startDate, request.endDate) * standardDayHours;
  }, [request.dayPortion, request.endDate, request.requestedHours, request.startDate, standardDayHours]);

  function updateRequest(patch) {
    setRequest((current) => {
      const next = { ...current, ...patch };
      if (["morning", "afternoon"].includes(next.dayPortion) && next.startDate) next.endDate = next.startDate;
      return next;
    });
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!currentEntitlement) {
      setStatus("Your holiday allowance has not been configured. Ask Admin to add it before requesting leave.");
      return;
    }
    setBusy(true);
    setStatus("Submitting holiday request...");
    try {
      const { submitHolidayRequest, notifyHolidayRequest } = await import("./supabaseClient.js");
      const saved = await submitHolidayRequest({ ...request, requestedHours: suggestedHours });
      setRequest({ startDate: "", endDate: "", dayPortion: "full_day", requestedHours: "", note: "" });
      let message = "Holiday request submitted for approval.";
      try { await notifyHolidayRequest(saved.id, "submitted"); } catch { message += " The request is saved, but the email notification could not be sent."; }
      await loadWorkspace(message);
    } catch (error) {
      setStatus(error.message || "Holiday request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(item, decision) {
    setBusy(true);
    setStatus(`${decision === "approved" ? "Approving" : "Declining"} ${item.staffName}'s request...`);
    try {
      const { reviewHolidayRequest, notifyHolidayRequest } = await import("./supabaseClient.js");
      await reviewHolidayRequest(item.id, decision, decisionNotes[item.id] || "");
      let message = `Holiday request ${decision}.`;
      try { await notifyHolidayRequest(item.id, decision); } catch { message += " The decision is saved, but the employee email could not be sent."; }
      await loadWorkspace(message);
    } catch (error) {
      setStatus(error.message || "Holiday request could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(item) {
    setBusy(true);
    setStatus("Cancelling holiday request...");
    try {
      const { cancelHolidayRequest } = await import("./supabaseClient.js");
      await cancelHolidayRequest(item.id);
      await loadWorkspace("Holiday request cancelled and any affected rota shifts restored for review.");
    } catch (error) {
      setStatus(error.message || "Holiday request could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving holiday settings...");
    try {
      const { saveHolidaySettings } = await import("./supabaseClient.js");
      await saveHolidaySettings(settingsDraft);
      await loadWorkspace("Holiday settings saved.");
    } catch (error) {
      setStatus(error.message || "Holiday settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntitlement(staffRecordId) {
    const draft = entitlementDrafts[staffRecordId];
    if (!draft) return;
    setBusy(true);
    setStatus("Saving employee allowance...");
    try {
      const { saveHolidayEntitlement } = await import("./supabaseClient.js");
      await saveHolidayEntitlement({ ...draft, staffRecordId });
      await loadWorkspace("Employee holiday allowance saved.");
    } catch (error) {
      setStatus(error.message || "Holiday allowance could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAbsence(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Recording staff absence...");
    try {
      const { saveStaffAbsence, notifyStaffAbsence } = await import("./supabaseClient.js");
      const saved = await saveStaffAbsence(absenceDraft);
      setAbsenceDraft((current) => ({ ...current, startDate: todayIso(), endDate: todayIso(), category: "sickness", note: "" }));
      let message = "Absence recorded. Any affected rota assignments now require cover.";
      try { await notifyStaffAbsence(saved.id); } catch { message += " The record is saved, but the manager email could not be sent."; }
      await loadWorkspace(message);
    } catch (error) {
      setStatus(error.message || "Absence could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function closeAbsence(item) {
    const draft = absenceCloseDrafts[item.id] || {};
    setBusy(true);
    setStatus(`Closing ${item.staffName}'s absence record...`);
    try {
      const { closeStaffAbsence } = await import("./supabaseClient.js");
      await closeStaffAbsence(item.id, draft.returnDate || todayIso(), draft.note || "");
      await loadWorkspace("Return to work recorded and the absence closed.");
    } catch (error) {
      setStatus(error.message || "Absence could not be closed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAbsence(item) {
    setBusy(true);
    setStatus("Cancelling absence record...");
    try {
      const { cancelStaffAbsence } = await import("./supabaseClient.js");
      await cancelStaffAbsence(item.id);
      await loadWorkspace("Absence cancelled and linked rota assignments restored for review.");
    } catch (error) {
      setStatus(error.message || "Absence could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  const visibleAbsences = (workspace.absences || []).filter((item) => canReview || item.staffRecordId === workspace.currentStaffId);
  const activeAbsences = visibleAbsences.filter((item) => item.status !== "cancelled" && !item.closedAt && item.endDate >= todayIso());
  const rollingStart = new Date();
  rollingStart.setFullYear(rollingStart.getFullYear() - 1);
  const rollingAbsences = visibleAbsences.filter((item) => item.status !== "cancelled" && item.startDate >= rollingStart.toISOString().slice(0, 10));
  const rollingDays = rollingAbsences.reduce((sum, item) => sum + workingDaysBetween(item.startDate, item.endDate), 0);

  const views = [
    ["mine", "My holiday"],
    ["absences", `Absences${activeAbsences.length ? ` (${activeAbsences.length})` : ""}`],
    ...(canReview ? [["approvals", `Approvals${pendingApprovals.length ? ` (${pendingApprovals.length})` : ""}`], ["calendar", "Team calendar"]] : []),
    ...(isAdmin ? [["settings", "Settings"]] : []),
  ];

  return (
    <div className="holiday-workspace">
      <section className="holiday-hero">
        <div><p className="eyebrow">Employee leave</p><h1>Holiday</h1><p>Request time off, protect staffing cover and keep paid holiday separate in payroll.</p></div>
        <div className="holiday-hero-balance"><span>Remaining</span><strong>{currentEntitlement ? `${moneylessNumber(remainingHours)} hrs` : "Not set"}</strong><small>{currentEntitlement ? `${displayDate(currentEntitlement.leaveYearStart)} – ${displayDate(currentEntitlement.leaveYearEnd)}` : "Admin needs to add your allowance"}</small></div>
      </section>

      <nav className="holiday-tabs" aria-label="Holiday sections">{views.map(([value, label]) => <button className={view === value ? "active" : ""} type="button" key={value} onClick={() => setView(value)}>{label}</button>)}</nav>
      {status && <p className="holiday-system-status" role="status">{status}</p>}

      {view === "mine" && (
        <div className="holiday-two-column">
          <section className="holiday-panel request-panel">
            <div className="holiday-panel-head"><div><p className="eyebrow">New request</p><h2>Book time off</h2></div><span>{ownStaff?.name || "Your account"}</span></div>
            <div className={`holiday-booking-rule ${siteHolidayRule ? "site-rule" : "admin-rule"}`}>
              <strong>{siteHolidayRule ? "Rule 2 · Site staff" : "Rule 1 · Admin staff"}</strong>
              <p>{siteHolidayRule ? `Holiday must be taken during the published school holidays for ${workspace.policySite || "your usual school"}.` : "You can request holiday at any time, subject to your allowance and approval."}</p>
            </div>
            {siteHolidayRule && <div className="holiday-window-list"><span>Available school-holiday windows</span>{workspace.allowedWindows.slice(0, 6).map((window) => <button type="button" key={window.id} onClick={() => updateRequest({ startDate: window.startsOn < todayIso() ? todayIso() : window.startsOn, endDate: window.endsOn })}><strong>{window.label}</strong><small>{dateRangeLabel(window.startsOn, window.endsOn)}</small></button>)}{!workspace.allowedWindows.length && <p>No future calendar windows are linked to this staff record. Ask Admin to check the usual school.</p>}</div>}
            <form className="holiday-request-form" onSubmit={submitRequest}>
              <label>First day<input type="date" required min={todayIso()} value={request.startDate} onChange={(event) => updateRequest({ startDate: event.target.value, endDate: request.endDate && request.endDate >= event.target.value ? request.endDate : event.target.value })} /></label>
              <label>Last day<input type="date" required min={request.startDate || todayIso()} value={request.endDate} disabled={["morning", "afternoon"].includes(request.dayPortion)} onChange={(event) => updateRequest({ endDate: event.target.value })} /></label>
              <label>Day type<select value={request.dayPortion} onChange={(event) => updateRequest({ dayPortion: event.target.value })}><option value="full_day">Full day(s)</option><option value="morning">Morning / half day</option><option value="afternoon">Afternoon / half day</option><option value="custom">Specific hours</option></select></label>
              {request.dayPortion === "custom" && <label>Hours requested<input type="number" required min="0.25" step="0.25" value={request.requestedHours} onChange={(event) => updateRequest({ requestedHours: event.target.value })} /></label>}
              <label className="wide">Note <span>optional</span><textarea rows="3" value={request.note} onChange={(event) => updateRequest({ note: event.target.value })} placeholder="Anything your manager should know" /></label>
              <div className="holiday-request-preview"><div><span>Working days</span><strong>{workingDaysBetween(request.startDate, request.endDate)}</strong></div><div><span>Allowance used</span><strong>{moneylessNumber(suggestedHours)} hrs</strong></div><div><span>Remaining after request</span><strong>{currentEntitlement ? `${moneylessNumber(remainingHours - suggestedHours)} hrs` : "Not set"}</strong></div></div>
              {!datesAllowed && <p className="holiday-date-error">Those dates include term time. Choose one of the published school-holiday windows above.</p>}
              <button className="button primary" type="submit" disabled={busy || !currentEntitlement || suggestedHours <= 0 || suggestedHours > remainingHours || !datesAllowed}>{busy ? "Please wait..." : "Submit holiday request"}</button>
            </form>
          </section>

          <section className="holiday-panel">
            <div className="holiday-panel-head"><div><p className="eyebrow">Allowance</p><h2>This leave year</h2></div></div>
            <div className="holiday-balance-grid"><article><span>Total allowance</span><strong>{moneylessNumber(allowance)} hrs</strong></article><article><span>Approved</span><strong>{moneylessNumber(approvedHours)} hrs</strong></article><article><span>Pending</span><strong>{moneylessNumber(pendingHours)} hrs</strong></article><article className="remaining"><span>Remaining</span><strong>{moneylessNumber(remainingHours)} hrs</strong></article></div>
            {!currentEntitlement && <div className="holiday-warning"><strong>Allowance not configured</strong><p>Requests stay unavailable until Admin records your entitlement for this leave year.</p></div>}
          </section>

          <section className="holiday-panel full-width">
            <div className="holiday-panel-head"><div><p className="eyebrow">Your record</p><h2>Requests and decisions</h2></div><span>{ownRequests.length} total</span></div>
            <div className="holiday-request-list">{ownRequests.map((item) => <article key={item.id}><div className="holiday-request-main"><HolidayStatus value={item.status} /><h3>{dateRangeLabel(item.startDate, item.endDate)}</h3><p>{moneylessNumber(item.requestedHours)} hours · {item.dayPortion.replace(/_/g, " ")}</p>{item.note && <small>Your note: {item.note}</small>}{item.decisionNote && <small>Decision note: {item.decisionNote}</small>}</div><div className="holiday-request-side">{item.affectedShifts > 0 && <span>{item.affectedShifts} rota shift{item.affectedShifts === 1 ? "" : "s"} affected</span>}{["requested", "approved"].includes(item.status) && item.startDate >= todayIso() && <button className="button subtle" type="button" disabled={busy} onClick={() => cancelRequest(item)}>Cancel request</button>}</div></article>)}{!ownRequests.length && <EmptyHoliday title="No holiday requests yet" text="Your submitted requests and manager decisions will appear here." />}</div>
          </section>
        </div>
      )}

      {view === "absences" && (
        <div className="absence-workspace">
          <section className="holiday-panel absence-report-panel">
            <div className="holiday-panel-head"><div><p className="eyebrow">Unplanned time away</p><h2>{canReview ? "Record an absence" : "Report an absence"}</h2></div><span>Kept separate from holiday</span></div>
            <p className="absence-guidance">Record the dates and broad reason only. Detailed medical information should not be entered here.</p>
            <form className="absence-report-form" onSubmit={submitAbsence}>
              {canReview && <label>Employee<select required value={absenceDraft.staffRecordId} onChange={(event) => setAbsenceDraft((current) => ({ ...current, staffRecordId: event.target.value }))}><option value="">Choose employee</option>{workspace.staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.site || person.role || "No site"}</option>)}</select></label>}
              <label>First day<input required type="date" value={absenceDraft.startDate} onChange={(event) => setAbsenceDraft((current) => ({ ...current, startDate: event.target.value, endDate: current.endDate < event.target.value ? event.target.value : current.endDate }))} /></label>
              <label>Last expected day<input required type="date" min={absenceDraft.startDate} value={absenceDraft.endDate} onChange={(event) => setAbsenceDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
              <label>Reason<select value={absenceDraft.category} onChange={(event) => setAbsenceDraft((current) => ({ ...current, category: event.target.value }))}>{absenceCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="wide">Brief note <span>optional</span><textarea rows="3" maxLength="500" value={absenceDraft.note} onChange={(event) => setAbsenceDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Operational information only — do not include a diagnosis or detailed medical history" /></label>
              <div className="absence-report-preview"><span>Working days recorded</span><strong>{workingDaysBetween(absenceDraft.startDate, absenceDraft.endDate)}</strong><small>Affected rota shifts will be marked as requiring cover.</small></div>
              <button className="button primary" type="submit" disabled={busy || !absenceDraft.staffRecordId}>{busy ? "Please wait..." : canReview ? "Record absence" : "Report absence"}</button>
            </form>
          </section>

          <section className="holiday-panel absence-summary-panel">
            <div className="holiday-panel-head"><div><p className="eyebrow">Attendance overview</p><h2>{canReview ? "Visible team records" : "Your record"}</h2></div></div>
            <div className="absence-metrics"><article><span>Active now</span><strong>{activeAbsences.length}</strong></article><article><span>Events · 12 months</span><strong>{rollingAbsences.length}</strong></article><article><span>Working days · 12 months</span><strong>{rollingDays}</strong></article></div>
            <p className="absence-summary-note">Holiday is excluded from these figures. Cancelled records are also excluded.</p>
          </section>

          <section className="holiday-panel full-width absence-history-panel">
            <div className="holiday-panel-head"><div><p className="eyebrow">Absence history</p><h2>{canReview ? "Staff absence register" : "Your reported absences"}</h2></div><span>{visibleAbsences.length} records</span></div>
            <div className="absence-list">
              {visibleAbsences.map((item) => {
                const closed = Boolean(item.closedAt);
                const cancelled = item.status === "cancelled";
                const draft = absenceCloseDrafts[item.id] || { returnDate: item.endDate < todayIso() ? addDaysIso(item.endDate, 1) : item.startDate >= todayIso() ? addDaysIso(item.startDate, 1) : todayIso(), note: "" };
                return <article className={`${closed ? "closed" : ""} ${cancelled ? "cancelled" : ""}`} key={item.id}>
                  <div className="absence-card-main"><div><span className={`absence-state ${cancelled ? "cancelled" : closed ? "closed" : "active"}`}>{cancelled ? "Cancelled" : closed ? "Closed" : item.endDate >= todayIso() ? "Active" : "Return review due"}</span><h3>{item.staffName}</h3><p>{absenceCategoryLabel(item.category)} · {dateRangeLabel(item.startDate, item.endDate)}</p><small>{item.site || "Site not recorded"} · {workingDaysBetween(item.startDate, item.endDate)} working day{workingDaysBetween(item.startDate, item.endDate) === 1 ? "" : "s"}</small>{item.note && <small>Operational note: {item.note}</small>}{item.returnToWorkNote && <small>Return-to-work note: {item.returnToWorkNote}</small>}</div><div>{item.affectedShifts > 0 && <strong>{item.affectedShifts} rota shift{item.affectedShifts === 1 ? "" : "s"} affected</strong>}{item.actualReturnDate && <span>Returned {displayDate(item.actualReturnDate)}</span>}</div></div>
                  {!closed && !cancelled && canReview && <div className="absence-close-form"><label>First day back at work<input type="date" min={addDaysIso(item.startDate, 1)} value={draft.returnDate} onChange={(event) => setAbsenceCloseDrafts((current) => ({ ...current, [item.id]: { ...draft, returnDate: event.target.value } }))} /></label><label>Return-to-work note <span>optional</span><textarea rows="2" maxLength="1000" value={draft.note} onChange={(event) => setAbsenceCloseDrafts((current) => ({ ...current, [item.id]: { ...draft, note: event.target.value } }))} placeholder="Outcome of return-to-work conversation" /></label><button className="button success" type="button" disabled={busy || !draft.returnDate} onClick={() => closeAbsence(item)}>Mark returned</button></div>}
                  {!closed && !cancelled && item.startDate >= todayIso() && <button className="button subtle absence-cancel" type="button" disabled={busy} onClick={() => cancelAbsence(item)}>Cancel incorrect record</button>}
                </article>;
              })}
              {!visibleAbsences.length && <EmptyHoliday title="No absences recorded" text={canReview ? "Reported staff absence will appear here with rota impact and return-to-work status." : "Your reported sickness or other absence will appear here."} />}
            </div>
          </section>
        </div>
      )}

      {view === "approvals" && canReview && <section className="holiday-panel"><div className="holiday-panel-head"><div><p className="eyebrow">Manager queue</p><h2>Holiday approvals</h2></div><span>{pendingApprovals.length} awaiting decision</span></div><div className="holiday-approval-list">{pendingApprovals.map((item) => { const person = workspace.staff.find((staff) => staff.id === item.staffRecordId); const entitlement = workspace.entitlements.find((entry) => entry.staffRecordId === item.staffRecordId && item.startDate >= entry.leaveYearStart && item.startDate <= entry.leaveYearEnd); const reserved = workspace.requests.filter((entry) => entry.staffRecordId === item.staffRecordId && ["requested", "approved"].includes(entry.status) && (!entitlement || (entry.startDate >= entitlement.leaveYearStart && entry.startDate <= entitlement.leaveYearEnd))).reduce((sum, entry) => sum + entry.requestedHours, 0); const total = entitlement ? entitlement.allowanceHours + entitlement.carriedForwardHours + entitlement.adjustmentHours : 0; return <article key={item.id}><div className="holiday-approval-summary"><div><HolidayStatus value={item.status} /><h3>{item.staffName}</h3><p>{person?.site || person?.role || "Site not recorded"}</p></div><div><span>{dateRangeLabel(item.startDate, item.endDate)}</span><strong>{moneylessNumber(item.requestedHours)} hours</strong><small>{entitlement ? `${moneylessNumber(total - reserved)} hours remaining after reserved leave` : "Allowance not configured"}</small></div></div>{item.note && <p className="holiday-employee-note">“{item.note}”</p>}<label>Response note <span>optional</span><textarea rows="2" value={decisionNotes[item.id] || ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Reason or useful context for the employee" /></label><div className="holiday-approval-actions"><button className="button subtle" type="button" disabled={busy} onClick={() => reviewRequest(item, "declined")}>Decline</button><button className="button success" type="button" disabled={busy || !entitlement} onClick={() => reviewRequest(item, "approved")}>Approve holiday</button></div></article>; })}{!pendingApprovals.length && <EmptyHoliday title="No requests awaiting approval" text="New requests from your team will appear here." />}</div></section>}

      {view === "calendar" && canReview && <section className="holiday-panel"><div className="holiday-panel-head"><div><p className="eyebrow">Staffing visibility</p><h2>Team leave calendar</h2></div><span>Pending and approved leave</span></div><div className="holiday-calendar-list">{teamCalendar.map((item) => { const person = workspace.staff.find((staff) => staff.id === item.staffRecordId); return <article key={item.id}><time>{displayDate(item.startDate)}</time><div><strong>{item.staffName}</strong><span>{dateRangeLabel(item.startDate, item.endDate)} · {moneylessNumber(item.requestedHours)} hrs</span><small>{person?.site || person?.role || "Site not recorded"}{item.affectedShifts ? ` · ${item.affectedShifts} rota shift${item.affectedShifts === 1 ? "" : "s"} needs review` : ""}</small></div><HolidayStatus value={item.status} /></article>; })}{!teamCalendar.length && <EmptyHoliday title="No team leave recorded" text="Approved and pending holiday will appear here in date order." />}</div></section>}

      {view === "settings" && isAdmin && <div className="holiday-settings-stack"><section className="holiday-panel"><div className="holiday-panel-head"><div><p className="eyebrow">Company rules</p><h2>Holiday settings</h2></div></div><form className="holiday-settings-form" onSubmit={saveSettings}><label>Leave year starts<select value={settingsDraft.leaveYearStartMonth || 1} onChange={(event) => setSettingsDraft((current) => ({ ...current, leaveYearStartMonth: event.target.value }))}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{new Date(2026, index, 1).toLocaleDateString("en-GB", { month: "long" })}</option>)}</select></label><label>Day of month<input type="number" min="1" max="28" value={settingsDraft.leaveYearStartDay || 1} onChange={(event) => setSettingsDraft((current) => ({ ...current, leaveYearStartDay: event.target.value }))} /></label><label>Standard paid day<input type="number" min="0.25" max="24" step="0.25" value={settingsDraft.standardDayHours || 6} onChange={(event) => setSettingsDraft((current) => ({ ...current, standardDayHours: event.target.value }))} /></label><label>Default allowance hours<input type="number" min="0" step="0.25" value={settingsDraft.defaultAllowanceHours || 0} onChange={(event) => setSettingsDraft((current) => ({ ...current, defaultAllowanceHours: event.target.value }))} /></label><label>Carry-forward limit hours<input type="number" min="0" step="0.25" value={settingsDraft.carryForwardLimitHours || 0} onChange={(event) => setSettingsDraft((current) => ({ ...current, carryForwardLimitHours: event.target.value }))} /></label><button className="button primary" type="submit" disabled={busy}>Save settings</button></form></section><section className="holiday-panel"><div className="holiday-panel-head"><div><p className="eyebrow">Employee records</p><h2>Allowances</h2></div><span>{workspace.staff.length} active staff</span></div><div className="holiday-entitlement-list">{workspace.staff.map((person) => { const draft = entitlementDrafts[person.id] || {}; const used = workspace.requests.filter((item) => item.staffRecordId === person.id && item.status === "approved" && (!draft.leaveYearStart || (item.startDate >= draft.leaveYearStart && item.startDate <= draft.leaveYearEnd))).reduce((sum, item) => sum + item.requestedHours, 0); return <article key={person.id}><div className="holiday-entitlement-person"><strong>{person.name}</strong><span>{person.site || person.role || "Site not recorded"}</span><small>{moneylessNumber(used)} approved hours</small></div><label>Year starts<input type="date" value={draft.leaveYearStart || ""} onChange={(event) => setEntitlementDrafts((current) => ({ ...current, [person.id]: { ...draft, leaveYearStart: event.target.value } }))} /></label><label>Year ends<input type="date" value={draft.leaveYearEnd || ""} onChange={(event) => setEntitlementDrafts((current) => ({ ...current, [person.id]: { ...draft, leaveYearEnd: event.target.value } }))} /></label><label>Allowance<input type="number" min="0" step="0.25" value={draft.allowanceHours ?? ""} onChange={(event) => setEntitlementDrafts((current) => ({ ...current, [person.id]: { ...draft, allowanceHours: event.target.value } }))} /></label><label>Carried forward<input type="number" min="0" step="0.25" value={draft.carriedForwardHours ?? ""} onChange={(event) => setEntitlementDrafts((current) => ({ ...current, [person.id]: { ...draft, carriedForwardHours: event.target.value } }))} /></label><label>Adjustment<input type="number" step="0.25" value={draft.adjustmentHours ?? ""} onChange={(event) => setEntitlementDrafts((current) => ({ ...current, [person.id]: { ...draft, adjustmentHours: event.target.value } }))} /></label><button className="button light" type="button" disabled={busy || !draft.leaveYearStart || !draft.leaveYearEnd} onClick={() => saveEntitlement(person.id)}>Save</button></article>; })}</div></section></div>}

      {loading && <div className="holiday-loading">Loading holiday records...</div>}
    </div>
  );
}
