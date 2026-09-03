import { useEffect, useMemo, useState } from "react";

export default function SharedSchoolRegister() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [programme, setProgramme] = useState("All");
  const [session, setSession] = useState("All");
  const [year, setYear] = useState("All");
  const [className, setClassName] = useState("All");

  async function load() {
    if (!token) {
      setError("This register link is incomplete.");
      setLoading(false);
      return;
    }
    try {
      const { fetchSharedSchoolRegister } = await import("./supabaseClient.js");
      const data = await fetchSharedSchoolRegister(token);
      if (!data?.valid) throw new Error("This register link has expired or is no longer valid.");
      setRegister(data);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The register could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = "Private school register | Après School";
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "robots"; document.head.appendChild(meta); }
    meta.content = "noindex,nofollow,noarchive";
    let referrer = document.querySelector('meta[name="referrer"]');
    if (!referrer) { referrer = document.createElement("meta"); referrer.name = "referrer"; document.head.appendChild(referrer); }
    referrer.content = "no-referrer";
    load();
    const interval = window.setInterval(load, 60_000);
    return () => window.clearInterval(interval);
  }, [token]);

  const rows = Array.isArray(register?.rows) ? register.rows : [];
  const options = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visibleRows = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    return (!query || String(row.childName).toLowerCase().includes(query))
      && (programme === "All" || row.programmeName === programme)
      && (session === "All" || sessionKey(row) === session)
      && (year === "All" || row.yearGroup === year)
      && (className === "All" || row.className === className);
  }), [rows, search, programme, session, year, className]);
  const sessionOptions = useMemo(() => {
    const unique = new Map();
    rows.forEach((row) => unique.set(sessionKey(row), sessionHeading(row)));
    return [...unique.entries()];
  }, [rows]);
  const sessionGroups = useMemo(() => {
    const groups = new Map();
    visibleRows.forEach((row) => {
      const key = sessionKey(row);
      if (!groups.has(key)) groups.set(key, { key, heading: sessionHeading(row), rows: [] });
      groups.get(key).rows.push(row);
    });
    return [...groups.values()];
  }, [visibleRows]);

  if (loading) return <section className="shared-register-shell"><div className="shared-register-state"><strong>Opening today’s register…</strong><p>Checking the private link.</p></div></section>;
  if (error) return <section className="shared-register-shell"><div className="shared-register-state expired"><strong>Register unavailable</strong><p>{error}</p><p>Ask Après School for today’s new register email.</p></div></section>;

  return (
    <section className="shared-register-shell">
      <div className="shared-register-card">
        <header>
          <div><p className="eyebrow">Private school register</p><h1>{register.schoolName}</h1><p>{formatDate(register.registerDate)} · Read only</p></div>
          <div className="shared-register-live"><span /> Live list<small>Refreshes every minute</small></div>
        </header>
        <div className="shared-register-notice">This view contains names, year groups and classes only. The private link expires {formatDateTime(register.expiresAt)}.</div>
        <div className="shared-register-filters">
          <label>Find a child<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name" /></label>
          <label>Club<select value={programme} onChange={(event) => setProgramme(event.target.value)}><option>All</option>{options("programmeName").map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Session<select value={session} onChange={(event) => setSession(event.target.value)}><option value="All">All sessions</option>{sessionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Year group<select value={year} onChange={(event) => setYear(event.target.value)}><option>All</option>{options("yearGroup").map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Class / form<select value={className} onChange={(event) => setClassName(event.target.value)}><option>All</option>{options("className").map((value) => <option key={value}>{value}</option>)}</select></label>
          <button className="button light" type="button" onClick={load}>Refresh now</button>
        </div>
        <div className="shared-register-count"><strong>{visibleRows.length}</strong> {visibleRows.length === 1 ? "session booking" : "session bookings"} across <strong>{sessionGroups.length}</strong> {sessionGroups.length === 1 ? "session" : "sessions"}</div>
        <div className="shared-register-sessions">
          {sessionGroups.map((group) => (
            <section className="shared-register-session" key={group.key}>
              <header><div><p>Session</p><h2>{group.heading}</h2></div><span>{group.rows.length} {group.rows.length === 1 ? "child" : "children"}</span></header>
              <div className="shared-register-table-wrap">
                <table><thead><tr><th>Child</th><th>Year group</th><th>Class / form</th></tr></thead>
                  <tbody>{group.rows.map((row, index) => <tr key={`${row.childName}-${group.key}-${index}`}><td>{row.childName}</td><td>{row.yearGroup}</td><td>{row.className}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          ))}
          {!visibleRows.length && <p className="shared-register-empty">No children match these filters.</p>}
        </div>
      </div>
    </section>
  );
}

function formatDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function formatDateTime(value) {
  return new Date(value).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function sessionKey(row) {
  return String(row.sessionKey || `${row.programmeName}|${row.sessionLabel}|${row.startsAt}|${row.endsAt}`);
}
function sessionHeading(row) {
  const programme = String(row.programmeName || "Club session");
  const label = String(row.sessionLabel || "");
  const times = row.startsAt && row.endsAt ? `${formatTime(row.startsAt)}–${formatTime(row.endsAt)}` : "";
  const distinctLabel = label && label.toLowerCase() !== programme.toLowerCase() ? label : "";
  return [programme, distinctLabel, times].filter(Boolean).join(" · ");
}
function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" });
}
