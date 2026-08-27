import { useEffect, useMemo, useState } from "react";

const primaryDocuments = [
  "UK Passport", "Republic of Ireland Passport or Passport Card", "Home Office document issued to family member with Indefinite Leave",
  "Biometric Residence Permit with Indefinite Leave", "Online Evidence of Immigration Status", "Biometric Residence Permit with Time-Limited Leave",
  "Endorsed Passport with Indefinite Leave", "Endorsed Passport with Time-Limited Leave", "Application Registration Card",
  "Current Endorsed Immigration Status Document with Time-Limited Leave", "Current Endorsed Immigration Status Document with Indefinite Leave",
];

const supportingDocuments = [
  "Republic of Ireland Passport or Passport Card", "Current Valid Passport", "Current Biometric Residence Permit, UK issued",
  "Current UK Driving Licence Photocard, full or provisional", "Birth Certificate issued at birth", "Adoption Certificate, UK or Channel Islands issued",
  "Non-UK Current Driving Licence Photocard", "Current paper Driving Licence, if issued before 1998", "Birth Certificate issued after time of birth",
  "Marriage or Civil Partnership Certificate", "HM Forces ID Card, UK issued", "Firearms Licence", "Immigration Document, Visa or Work Permit",
  "Mortgage Statement, UK issued", "Bank or Building Society Statement, UK or Channel Islands issued", "Bank or Building Society Statement, outside UK",
  "Bank or Building Society Account Opening Confirmation Letter, UK issued", "Credit Card Statement, UK issued",
  "Financial Statement, for example pension or endowment, UK issued", "P45 or P60 Statement, UK or Channel Islands issued",
  "Council Tax Statement, UK or Channel Islands issued", "Letter of Sponsorship from Future Employment Provider", "Utility Bill",
  "Benefit Statement, for example Child Benefit or Pension", "Central or Local Government document giving entitlement", "EEA National ID Card",
  "Card carrying the PASS accreditation logo", "Letter from Head Teacher or College Principal", "Irish Passport Card",
];

const steps = [
  ["personal", "Personal details"], ["identity", "Identity & right to work"], ["dbs", "DBS details"],
  ["safeguarding", "Safeguarding training"], ["professional", "Professional details"], ["references", "References"],
  ["declarations", "Declarations"], ["overseas", "Overseas check"],
];

const emptyReference = { name: "", email: "", phone: "", type: "", organisation: "", relationship: "", knownFor: "", notes: "" };
const defaultPayload = {
  personalDetails: { legalName: "", preferredName: "", dateOfBirth: "", email: "", phone: "", nationalInsuranceNumber: "", address: "", nationality: "", emergencyContactName: "", emergencyContactPhone: "", startDate: "" },
  identityDocuments: { documents: [{ kind: "primary", type: "", path: "", name: "", expiryDate: "" }, { kind: "supporting", type: "", path: "", name: "", expiryDate: "" }, { kind: "supporting", type: "", path: "", name: "", expiryDate: "" }], confirmed: false },
  dbsDetails: { certificateNumber: "", certificateDate: "", renewalDate: "", updateService: "", updateServiceNotes: "", certificatePath: "", certificateName: "" },
  safeguardingTraining: { trainingLevel: "", provider: "", passDate: "", certificatePath: "", certificateName: "", kcsieConfirmed: false, kcsieConfirmedAt: "", inductionConfirmed: false, inductionConfirmedAt: "" },
  professionalDetails: { hasQts: "", teacherReferenceNumber: "", qualification: "", qualificationPath: "", qualificationName: "", firstAid: { qualification: "", provider: "", passDate: "", expiryDate: "", certificatePath: "", certificateName: "" } },
  referencesDetails: [{ ...emptyReference }, { ...emptyReference }],
  annualDeclarations: { medicalFitness: false, criminal: false, childcareDisqualification: false, signature: "" },
  overseasCheck: { hasLivedOverseas: "", details: "" },
};

function mergePayload(record) {
  if (!record) return structuredClone(defaultPayload);
  const merged = structuredClone(defaultPayload);
  Object.keys(merged).forEach((key) => {
    if (record[key] != null) merged[key] = Array.isArray(merged[key]) ? record[key] : { ...merged[key], ...record[key] };
  });
  merged.identityDocuments.documents = [0, 1, 2].map((index) => ({ ...defaultPayload.identityDocuments.documents[index], ...(record.identityDocuments?.documents?.[index] || {}) }));
  merged.referencesDetails = [0, 1].map((index) => ({ ...emptyReference, ...(record.referencesDetails?.[index] || {}) }));
  merged.professionalDetails.firstAid = { ...defaultPayload.professionalDetails.firstAid, ...(record.professionalDetails?.firstAid || {}) };
  return merged;
}

function Input({ label, required, multiline, children, ...props }) {
  return <label className={`onboarding-field${multiline ? " wide" : ""}`}><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{children || (multiline ? <textarea {...props} /> : <input {...props} />)}</label>;
}

function YesNo({ label, value, onChange, required = true }) {
  return <Input label={label} required={required}><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose yes or no</option><option value="yes">Yes</option><option value="no">No</option></select></Input>;
}

function UploadField({ label, name, onUpload, required, busy }) {
  return <label className="onboarding-upload"><span>{label}{required && <b aria-hidden="true"> *</b>}</span><input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" disabled={busy} onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />{name && <small>Attached: {name}</small>}</label>;
}

function StaffIntake({ onApproved }) {
  const [record, setRecord] = useState(null);
  const [payload, setPayload] = useState(() => structuredClone(defaultPayload));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    import("./supabaseClient.js").then(({ fetchMyStaffOnboarding }) => fetchMyStaffOnboarding()).then((next) => {
      if (!active) return;
      setRecord(next); setPayload(mergePayload(next)); setBusy(false);
    }).catch((error) => { if (active) { setMessage(error.message); setBusy(false); } });
    return () => { active = false; };
  }, []);

  const completeCount = useMemo(() => Object.values(record?.sectionStatus || {}).filter(Boolean).length, [record]);
  const locked = ["submitted", "approved"].includes(record?.status);
  const change = (section, key, value) => setPayload((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  const stampCheck = (key, value) => setPayload((current) => ({ ...current, safeguardingTraining: { ...current.safeguardingTraining, [key]: value, [`${key}At`]: value ? new Date().toISOString() : "" } }));

  async function save(submit = false) {
    setBusy(true); setMessage("");
    try {
      const { saveMyStaffOnboarding } = await import("./supabaseClient.js");
      const next = await saveMyStaffOnboarding(payload, submit);
      setRecord(next); setPayload(mergePayload(next));
      setMessage(submit ? "Your onboarding has been submitted securely for review." : "Progress saved securely.");
      if (next.status === "approved") onApproved?.();
      return true;
    } catch (error) { setMessage(error.message || "Unable to save your onboarding."); return false; }
    finally { setBusy(false); }
  }

  async function upload(file, section, apply) {
    setBusy(true); setMessage(`Uploading ${file.name}…`);
    try {
      const { uploadStaffOnboardingEvidence } = await import("./supabaseClient.js");
      const uploaded = await uploadStaffOnboardingEvidence(file, section);
      setPayload((current) => apply(current, uploaded)); setMessage(`${file.name} uploaded securely. Save this section to keep your progress.`);
    } catch (error) { setMessage(error.message || "Upload failed."); }
    finally { setBusy(false); }
  }

  async function nextStep() { if (await save(false)) setStep((value) => Math.min(steps.length - 1, value + 1)); }
  const p = payload.personalDetails;
  const identity = payload.identityDocuments;
  const dbs = payload.dbsDetails;
  const safe = payload.safeguardingTraining;
  const pro = payload.professionalDetails;
  const declarations = payload.annualDeclarations;
  const overseas = payload.overseasCheck;

  if (busy && !record) return <section className="onboarding-shell"><p>Loading your secure onboarding checklist…</p></section>;
  if (record?.status === "submitted") return <section className="onboarding-shell onboarding-complete"><p className="eyebrow">Secure onboarding</p><h1>Thank you — your details are with us</h1><p>An Admin will review the information and evidence you supplied. Your access will remain limited to onboarding until that review is complete.</p><span className="status-chip">Submitted for review</span></section>;
  if (record?.status === "approved") return <section className="onboarding-shell onboarding-complete"><p className="eyebrow">Secure onboarding</p><h1>Your onboarding has been approved</h1><p>Your normal staff workspace is now available. Refresh the page if the menu has not updated yet.</p><button className="button book" onClick={() => window.location.reload()}>Open staff workspace</button></section>;

  return <section className="onboarding-shell">
    <header className="onboarding-hero"><div><p className="eyebrow">Secure employee onboarding</p><h1>Complete your Après School onboarding</h1><p>Save at any point and return using your staff login. Required fields are marked with an asterisk.</p></div><div className="onboarding-progress"><strong>{completeCount} of {steps.length}</strong><span>sections complete</span></div></header>
    {record?.status === "changes_requested" && <div className="onboarding-alert"><strong>Changes requested</strong><p>{record.adminReview?.note || "Please review your details and submit again."}</p></div>}
    <div className="onboarding-layout">
      <nav className="onboarding-steps" aria-label="Onboarding sections">{steps.map(([key, label], index) => <button key={key} type="button" className={index === step ? "active" : ""} onClick={() => setStep(index)}><span>{record?.sectionStatus?.[key] ? "✓" : index + 1}</span>{label}</button>)}</nav>
      <div className="onboarding-card">
        <div className="onboarding-card-head"><div><span>Section {step + 1} of {steps.length}</span><h2>{steps[step][1]}</h2></div><span className={record?.sectionStatus?.[steps[step][0]] ? "status-chip complete" : "status-chip"}>{record?.sectionStatus?.[steps[step][0]] ? "Complete" : "Incomplete"}</span></div>

        {step === 0 && <div className="onboarding-grid">
          <Input label="Full legal name" required value={p.legalName} onChange={(e) => change("personalDetails", "legalName", e.target.value)} />
          <Input label="Preferred name" value={p.preferredName} onChange={(e) => change("personalDetails", "preferredName", e.target.value)} />
          <Input label="Date of birth" required type="date" value={p.dateOfBirth} onChange={(e) => change("personalDetails", "dateOfBirth", e.target.value)} />
          <Input label="Email address" required type="email" value={p.email} onChange={(e) => change("personalDetails", "email", e.target.value)} />
          <Input label="Phone number" required value={p.phone} onChange={(e) => change("personalDetails", "phone", e.target.value)} />
          <Input label="National Insurance number (if available)" value={p.nationalInsuranceNumber} onChange={(e) => change("personalDetails", "nationalInsuranceNumber", e.target.value)} />
          <Input label="Home address" required multiline value={p.address} onChange={(e) => change("personalDetails", "address", e.target.value)} />
          <Input label="Nationality" required value={p.nationality} onChange={(e) => change("personalDetails", "nationality", e.target.value)} />
          <Input label="Emergency contact name" required value={p.emergencyContactName} onChange={(e) => change("personalDetails", "emergencyContactName", e.target.value)} />
          <Input label="Emergency contact phone" required value={p.emergencyContactPhone} onChange={(e) => change("personalDetails", "emergencyContactPhone", e.target.value)} />
          <Input label="Start date (admin confirmed)" type="date" value={p.startDate} readOnly />
        </div>}

        {step === 1 && <div className="onboarding-stack"><p className="onboarding-guidance">Upload one primary document and two supporting documents. Each document type must be different.</p>{identity.documents.map((doc, index) => <fieldset className="onboarding-document" key={index}><legend>{index === 0 ? "Primary identity/right-to-work document" : `Supporting identity document ${index}`}</legend><div className="onboarding-grid"><Input label="Document type" required><select value={doc.type} onChange={(e) => setPayload((current) => ({ ...current, identityDocuments: { ...current.identityDocuments, documents: current.identityDocuments.documents.map((item, i) => i === index ? { ...item, type: e.target.value } : item) } }))}><option value="">Choose document type</option>{(index === 0 ? primaryDocuments : supportingDocuments).map((option) => <option key={option}>{option}</option>)}</select></Input><Input label="Expiry date (if relevant)" type="date" value={doc.expiryDate} onChange={(e) => setPayload((current) => ({ ...current, identityDocuments: { ...current.identityDocuments, documents: current.identityDocuments.documents.map((item, i) => i === index ? { ...item, expiryDate: e.target.value } : item) } }))} /><UploadField label="File" required name={doc.name} busy={busy} onUpload={(file) => upload(file, `identity-${index + 1}`, (current, uploaded) => ({ ...current, identityDocuments: { ...current.identityDocuments, documents: current.identityDocuments.documents.map((item, i) => i === index ? { ...item, ...uploaded } : item) } }))} /></div></fieldset>)}<label className="onboarding-check"><input type="checkbox" checked={identity.confirmed} onChange={(e) => change("identityDocuments", "confirmed", e.target.checked)} /><span>I confirm these documents are accurate and belong to me.</span></label></div>}

        {step === 2 && <div className="onboarding-grid"><Input label="Enhanced DBS certificate number" required value={dbs.certificateNumber} onChange={(e) => change("dbsDetails", "certificateNumber", e.target.value)} /><Input label="Date of DBS certificate" required type="date" value={dbs.certificateDate} onChange={(e) => change("dbsDetails", "certificateDate", e.target.value)} /><Input label="DBS review/renewal date" type="date" value={dbs.renewalDate} onChange={(e) => change("dbsDetails", "renewalDate", e.target.value)} /><YesNo label="Are you part of the DBS Update Service?" value={dbs.updateService} onChange={(value) => change("dbsDetails", "updateService", value)} /><Input label="Update Service notes/status" multiline value={dbs.updateServiceNotes} onChange={(e) => change("dbsDetails", "updateServiceNotes", e.target.value)} /><UploadField label="DBS certificate (if available)" name={dbs.certificateName} busy={busy} onUpload={(file) => upload(file, "dbs", (current, uploaded) => ({ ...current, dbsDetails: { ...current.dbsDetails, certificatePath: uploaded.path, certificateName: uploaded.name } }))} /></div>}

        {step === 3 && <div className="onboarding-grid"><Input label="Safeguarding training completed" required><select value={safe.trainingLevel} onChange={(e) => change("safeguardingTraining", "trainingLevel", e.target.value)}><option value="">Choose training</option><option>Level 2</option><option>Level 3</option><option>Safeguarding for Tutors</option></select></Input><Input label="Training provider" required value={safe.provider} onChange={(e) => change("safeguardingTraining", "provider", e.target.value)} /><Input label="Course pass date" required type="date" value={safe.passDate} onChange={(e) => change("safeguardingTraining", "passDate", e.target.value)} /><UploadField label="Safeguarding certificate" required name={safe.certificateName} busy={busy} onUpload={(file) => upload(file, "safeguarding", (current, uploaded) => ({ ...current, safeguardingTraining: { ...current.safeguardingTraining, certificatePath: uploaded.path, certificateName: uploaded.name } }))} /><label className="onboarding-check wide"><input type="checkbox" checked={safe.kcsieConfirmed} onChange={(e) => stampCheck("kcsieConfirmed", e.target.checked)} /><span>I have read Keeping Children Safe in Education Part One.</span></label><label className="onboarding-check wide"><input type="checkbox" checked={safe.inductionConfirmed} onChange={(e) => stampCheck("inductionConfirmed", e.target.checked)} /><span>I have completed Après School safeguarding induction.</span></label></div>}

        {step === 4 && <div className="onboarding-grid"><YesNo label="Do you hold Qualified Teacher Status?" value={pro.hasQts} onChange={(value) => change("professionalDetails", "hasQts", value)} /><Input label="Teacher Reference Number, if held" value={pro.teacherReferenceNumber} onChange={(e) => change("professionalDetails", "teacherReferenceNumber", e.target.value)} /><Input label="Relevant teaching/tutor qualification" value={pro.qualification} onChange={(e) => change("professionalDetails", "qualification", e.target.value)} /><UploadField label="Qualification certificate" name={pro.qualificationName} busy={busy} onUpload={(file) => upload(file, "qualification", (current, uploaded) => ({ ...current, professionalDetails: { ...current.professionalDetails, qualificationPath: uploaded.path, qualificationName: uploaded.name } }))} /><div className="onboarding-subheading wide"><h3>First aid (optional)</h3><p>This does not block onboarding.</p></div>{[["qualification","First aid qualification"],["provider","First aid provider"]].map(([key,label]) => <Input key={key} label={label} value={pro.firstAid[key]} onChange={(e) => setPayload((current) => ({ ...current, professionalDetails: { ...current.professionalDetails, firstAid: { ...current.professionalDetails.firstAid, [key]: e.target.value } } }))} />)}<Input label="First aid pass date" type="date" value={pro.firstAid.passDate} onChange={(e) => setPayload((current) => ({ ...current, professionalDetails: { ...current.professionalDetails, firstAid: { ...current.professionalDetails.firstAid, passDate: e.target.value } } }))} /><Input label="First aid expiry date" type="date" value={pro.firstAid.expiryDate} onChange={(e) => setPayload((current) => ({ ...current, professionalDetails: { ...current.professionalDetails, firstAid: { ...current.professionalDetails.firstAid, expiryDate: e.target.value } } }))} /><UploadField label="First aid certificate" name={pro.firstAid.certificateName} busy={busy} onUpload={(file) => upload(file, "first-aid", (current, uploaded) => ({ ...current, professionalDetails: { ...current.professionalDetails, firstAid: { ...current.professionalDetails.firstAid, certificatePath: uploaded.path, certificateName: uploaded.name } } }))} /></div>}

        {step === 5 && <div className="onboarding-stack"><p className="onboarding-guidance">Provide two people we can contact securely for references.</p>{payload.referencesDetails.map((reference, index) => <fieldset className="onboarding-document" key={index}><legend>Reference {index + 1}</legend><div className="onboarding-grid">{[["name","Reference name","text",true],["email","Email address","email",true],["phone","Phone number","text",false],["organisation","Company/organisation","text",false],["relationship","Relationship/context","text",true],["knownFor","How long have they known you?","text",true]].map(([key,label,type,required]) => <Input key={key} label={label} type={type} required={required} value={reference[key]} onChange={(e) => setPayload((current) => ({ ...current, referencesDetails: current.referencesDetails.map((item, i) => i === index ? { ...item, [key]: e.target.value } : item) }))} />)}<Input label="Reference type" required><select value={reference.type} onChange={(e) => setPayload((current) => ({ ...current, referencesDetails: current.referencesDetails.map((item, i) => i === index ? { ...item, type: e.target.value } : item) }))}><option value="">Choose type</option><option>Employer</option><option>Personal</option></select></Input><Input label="Notes" multiline value={reference.notes} onChange={(e) => setPayload((current) => ({ ...current, referencesDetails: current.referencesDetails.map((item, i) => i === index ? { ...item, notes: e.target.value } : item) }))} /></div></fieldset>)}</div>}

        {step === 6 && <div className="onboarding-stack"><p className="onboarding-guidance">These declarations are required. Your signature and submission time will be recorded.</p>{[["medicalFitness","I confirm I am medically fit to work with children and will tell Après School immediately if this changes."],["criminal","I confirm I have no new criminal convictions, cautions, disqualifications or information relevant to my suitability to work with children."],["childcareDisqualification","I confirm I am not disqualified from childcare work where childcare disqualification rules apply."]].map(([key,label]) => <label className="onboarding-check" key={key}><input type="checkbox" checked={declarations[key]} onChange={(e) => change("annualDeclarations", key, e.target.checked)} /><span>{label}</span></label>)}<Input label="Digital signature (type your full legal name)" required value={declarations.signature} onChange={(e) => change("annualDeclarations", "signature", e.target.value)} /></div>}

        {step === 7 && <div className="onboarding-grid"><YesNo label="Have you lived or worked overseas for a significant period?" value={overseas.hasLivedOverseas} onChange={(value) => change("overseasCheck", "hasLivedOverseas", value)} /><Input label="If yes, provide countries, dates and details" required={overseas.hasLivedOverseas === "yes"} multiline value={overseas.details} onChange={(e) => change("overseasCheck", "details", e.target.value)} /></div>}

        {message && <p className="onboarding-message" role="status">{message}</p>}
        <footer className="onboarding-actions"><button type="button" className="button" disabled={busy || locked} onClick={() => save(false)}>{busy ? "Saving…" : "Save progress"}</button><div>{step > 0 && <button type="button" className="button" onClick={() => setStep((value) => value - 1)}>Back</button>}{step < steps.length - 1 ? <button type="button" className="button book" disabled={busy} onClick={nextStep}>Save & continue</button> : <button type="button" className="button book" disabled={busy || completeCount < steps.length} onClick={() => save(true)}>Submit for review</button>}</div></footer>
      </div>
    </div>
  </section>;
}

function AdminReview() {
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  async function load() { setBusy(true); try { const { fetchAdminStaffOnboarding } = await import("./supabaseClient.js"); const rows = await fetchAdminStaffOnboarding(); setRecords(rows); setSelected((current) => rows.find((row) => row.id === current?.id) || rows[0] || null); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  useEffect(() => { load(); }, []);
  async function decide(decision) { if (!selected) return; setBusy(true); setMessage(""); try { const { reviewStaffOnboarding } = await import("./supabaseClient.js"); await reviewStaffOnboarding(selected.id, decision, note); setMessage(decision === "approved" ? "Onboarding approved and normal staff access enabled." : "Changes requested; onboarding-only access remains in place."); setNote(""); await load(); } catch (error) { setMessage(error.message); setBusy(false); } }
  async function openEvidence(path) { try { const { createStaffOnboardingEvidenceUrl } = await import("./supabaseClient.js"); const url = await createStaffOnboardingEvidenceUrl(path); window.open(url, "_blank", "noopener,noreferrer"); } catch (error) { setMessage(error.message); } }
  const evidence = selected ? [...(selected.identityDocuments?.documents || []), { name: selected.dbsDetails?.certificateName, path: selected.dbsDetails?.certificatePath }, { name: selected.safeguardingTraining?.certificateName, path: selected.safeguardingTraining?.certificatePath }, { name: selected.professionalDetails?.qualificationName, path: selected.professionalDetails?.qualificationPath }, { name: selected.professionalDetails?.firstAid?.certificateName, path: selected.professionalDetails?.firstAid?.certificatePath }].filter((file) => file.path) : [];
  return <section className="onboarding-shell"><header className="onboarding-hero"><div><p className="eyebrow">Safer recruitment</p><h1>Staff onboarding review</h1><p>Only Admin and Superadmin can inspect evidence or approve access.</p></div></header><div className="onboarding-admin-layout"><aside className="onboarding-review-list">{busy && !records.length ? <p>Loading…</p> : records.map((row) => <button key={row.id} className={selected?.id === row.id ? "active" : ""} onClick={() => { setSelected(row); setNote(""); }}><strong>{row.staffName}</strong><span>{row.staffEmail}</span><small>{row.status.replace(/_/g," ")}</small></button>)}</aside>{selected ? <article className="onboarding-card"><div className="onboarding-card-head"><div><span>{selected.staffEmail}</span><h2>{selected.staffName}</h2></div><span className="status-chip">{selected.status.replace(/_/g," ")}</span></div><div className="onboarding-review-summary">{steps.map(([key,label]) => <div key={key}><span>{label}</span><strong>{selected.sectionStatus?.[key] ? "Complete" : "Incomplete"}</strong></div>)}</div><details open><summary>Personal details and declarations</summary><pre>{JSON.stringify({ personal: selected.personalDetails, declarations: selected.annualDeclarations, overseas: selected.overseasCheck }, null, 2)}</pre></details><details><summary>DBS, training and professional details</summary><pre>{JSON.stringify({ dbs: selected.dbsDetails, safeguarding: selected.safeguardingTraining, professional: selected.professionalDetails }, null, 2)}</pre></details><details><summary>References</summary><pre>{JSON.stringify(selected.referencesDetails, null, 2)}</pre></details><div className="onboarding-evidence"><h3>Evidence files</h3>{evidence.length ? evidence.map((file) => <button type="button" className="button" key={file.path} onClick={() => openEvidence(file.path)}>View {file.name || "evidence"}</button>) : <p>No evidence uploaded.</p>}</div>{selected.status === "submitted" && <><Input label="Review note" multiline value={note} onChange={(e) => setNote(e.target.value)} /><div className="onboarding-actions"><button className="button" disabled={busy} onClick={() => decide("changes_requested")}>Request changes</button><button className="button book" disabled={busy} onClick={() => decide("approved")}>Approve onboarding</button></div></>}{message && <p className="onboarding-message">{message}</p>}</article> : <article className="onboarding-card"><h2>No onboarding records yet</h2></article>}</div></section>;
}

export default function StaffOnboardingModule({ role, onboardingOnly, onApproved }) {
  return ["Admin", "Superadmin"].includes(role) && !onboardingOnly ? <AdminReview /> : <StaffIntake onApproved={onApproved} />;
}
