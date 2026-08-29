import { useEffect, useState } from "react";

let apiPromise;
const api = () => (apiPromise ||= import("./supabaseClient.js"));

export default function SchoolRegisterSharingModule() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      setSchools(await (await api()).fetchSchoolRegisterShareSettings());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Daily register settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateSchool(locationId, changes) {
    setSchools((items) => items.map((item) => item.locationId === locationId ? { ...item, ...changes } : item));
  }

  function updateRecipient(locationId, index, changes) {
    const school = schools.find((item) => item.locationId === locationId);
    updateSchool(locationId, { recipients: school.recipients.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) });
  }

  async function save(school) {
    setSaving(school.locationId);
    setMessage("");
    try {
      await (await api()).saveSchoolRegisterShareSettings(school);
      setMessage(`${school.schoolName} register sharing has been saved.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "These settings could not be saved.");
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="school-register-sharing">
      <div className="toolbar">
        <div>
          <p className="eyebrow">School communications</p>
          <h2>Daily register sharing</h2>
          <p className="panel-note">Email each school a private, read-only list of names, year groups and classes. Links expire after 24 hours.</p>
        </div>
        <button className="button light" type="button" onClick={load} disabled={loading}>Refresh</button>
      </div>
      {message && <p className="account-message" role="status">{message}</p>}
      {loading ? <p>Loading school register settings…</p> : (
        <div className="school-register-sharing-list">
          {schools.map((school) => (
            <article key={school.locationId} className={school.enabled ? "enabled" : ""}>
              <header>
                <div><span>{school.area || "Partner school"}</span><h3>{school.schoolName}</h3></div>
                <label className="school-register-toggle"><input type="checkbox" checked={school.enabled} onChange={(event) => updateSchool(school.locationId, { enabled: event.target.checked })} /> Send automatically</label>
              </header>
              <div className="school-register-sharing-options">
                <label>Send time<input type="time" value={school.sendTime || "08:00"} onChange={(event) => updateSchool(school.locationId, { sendTime: event.target.value })} /></label>
                <fieldset><legend>Include</legend>
                  {school.hasBreakfast && <label><input type="checkbox" checked={school.includeBreakfast} onChange={(event) => updateSchool(school.locationId, { includeBreakfast: event.target.checked })} /> Breakfast Club</label>}
                  {school.hasAfterSchool && <label><input type="checkbox" checked={school.includeAfterSchool} onChange={(event) => updateSchool(school.locationId, { includeAfterSchool: event.target.checked })} /> After-school Club</label>}
                </fieldset>
              </div>
              <div className="school-register-recipients">
                <div><strong>Recipients</strong><small>Add as many authorised school contacts as needed.</small></div>
                {(school.recipients || []).map((recipient, index) => (
                  <div className="school-register-recipient" key={recipient.id || `new-${index}`}>
                    <input aria-label="Recipient name" placeholder="Name or role (optional)" value={recipient.name || ""} onChange={(event) => updateRecipient(school.locationId, index, { name: event.target.value })} />
                    <input aria-label="Recipient email" type="email" placeholder="name@school.co.uk" value={recipient.email || ""} onChange={(event) => updateRecipient(school.locationId, index, { email: event.target.value })} />
                    <button type="button" aria-label={`Remove ${recipient.email || "recipient"}`} onClick={() => updateSchool(school.locationId, { recipients: school.recipients.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                  </div>
                ))}
                <button className="button light" type="button" onClick={() => updateSchool(school.locationId, { recipients: [...(school.recipients || []), { name: "", email: "" }] })}>+ Add recipient</button>
              </div>
              <footer>
                <small>{school.lastDelivery?.date ? `Last attempt: ${school.lastDelivery.date} · ${school.lastDelivery.status}` : "No register emails sent yet"}</small>
                <button className="button" type="button" disabled={saving === school.locationId} onClick={() => save(school)}>{saving === school.locationId ? "Saving…" : "Save settings"}</button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
