import React, { useEffect, useMemo, useRef, useState } from "react";

const employeeDocumentApi = () => import("./supabaseClient.js");
const STATUS_LABELS = {
  draft: "Draft",
  awaiting_signature: "Awaiting Signature",
  signed: "Signed",
  declined: "Declined",
  superseded: "Superseded",
  expired: "Expired",
  archived: "Archived",
};
const STATUS_TONES = { draft: "neutral", awaiting_signature: "warn", signed: "good", declined: "bad", superseded: "neutral", expired: "bad", archived: "neutral" };
const TERM_OPTIONS = [
  ["salary", "Salary"], ["hourly_rate", "Hourly rate"], ["contract_hours", "Contract hours"],
  ["job_title", "Job title"], ["workplace", "Place of work"], ["line_manager", "Line manager"],
  ["holiday_entitlement", "Holiday entitlement"], ["notice_period", "Notice period"], ["other", "Other"],
];

function shortDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
}

function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusFor(document) {
  if (document.status !== "archived" && document.expiryDate && document.expiryDate < new Date().toISOString().slice(0, 10)) return "expired";
  return document.status;
}

function DocumentStatus({ status }) {
  const value = statusFor({ status });
  return <span className={`employee-doc-status ${STATUS_TONES[value] || "neutral"}`}>{STATUS_LABELS[value] || value}</span>;
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#17388f";
  }, []);

  function point(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event) {
    drawing.current = true;
    const context = canvasRef.current.getContext("2d");
    const next = point(event);
    context.beginPath();
    context.moveTo(next.x, next.y);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event) {
    if (!drawing.current) return;
    const context = canvasRef.current.getContext("2d");
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return <div className="employee-signature-pad"><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="Draw your signature" /><button type="button" onClick={clear}>Clear signature</button></div>;
}

export function EmployeeDocumentsPanel({ person, access, legacyFiles = [], compact = false }) {
  const isAdmin = ["Admin", "Superadmin"].includes(access?.role);
  const isEmployee = access?.role === "Staff";
  const [payload, setPayload] = useState({ documents: [], types: [], templates: [], terms: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [builderMode, setBuilderMode] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [previewDocument, setPreviewDocument] = useState(null);
  const [busyId, setBusyId] = useState("");

  async function load(showLoader = true) {
    if (!person?.id) return;
    if (showLoader) setLoading(true);
    try {
      const { fetchEmployeeDocuments } = await employeeDocumentApi();
      setPayload(await fetchEmployeeDocuments(person.id));
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Employee documents could not be loaded." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [person?.id]);

  const categories = ["All categories", ...new Set(payload.types.map((type) => type.category))];
  const visible = useMemo(() => payload.documents.filter((document) => {
    const status = statusFor(document);
    const text = `${document.title} ${document.type?.name || ""} ${document.type?.category || ""} ${document.renderedBody || ""}`.toLowerCase();
    return (statusFilter === "All statuses" || status === statusFilter)
      && (categoryFilter === "All categories" || document.type?.category === categoryFilter)
      && (!query.trim() || text.includes(query.trim().toLowerCase()));
  }), [payload.documents, statusFilter, categoryFilter, query]);

  const awaiting = payload.documents.filter((document) => statusFor(document) === "awaiting_signature").length;
  const expiring = payload.documents.filter((document) => document.expiryDate && document.expiryDate >= new Date().toISOString().slice(0, 10) && document.expiryDate <= new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)).length;
  const expired = payload.documents.filter((document) => statusFor(document) === "expired").length;
  const selectedType = payload.types.find((type) => type.id === selectedTypeId);
  const templates = payload.templates.filter((template) => template.document_type_id === selectedTypeId);

  function openBuilder(mode) {
    const preferredType = mode === "variation" ? payload.types.find((type) => type.key === "contract_variation") : payload.types[0];
    const preferredTemplate = payload.templates.find((template) => template.document_type_id === preferredType?.id);
    setBuilderMode(mode);
    setSelectedTypeId(preferredType?.id || "");
    setSelectedTemplateId(preferredTemplate?.id || "");
    setDraftBody(preferredTemplate?.body_template || "");
  }

  function chooseType(typeId) {
    setSelectedTypeId(typeId);
    const template = payload.templates.find((item) => item.document_type_id === typeId);
    setSelectedTemplateId(template?.id || "");
    setDraftBody(template?.body_template || "");
  }

  function chooseTemplate(templateId) {
    setSelectedTemplateId(templateId);
    setDraftBody(payload.templates.find((template) => template.id === templateId)?.body_template || "");
  }

  async function createDraft(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const termKey = String(form.get("termKey") || "");
    const currentValue = String(form.get("currentValue") || "");
    const newValue = String(form.get("newValue") || "");
    const reason = String(form.get("reason") || "");
    const effectiveDate = String(form.get("effectiveDate") || "");
    const variationLabel = TERM_OPTIONS.find(([key]) => key === termKey)?.[1] || "Employment terms";
    setMessage({ tone: "info", text: "Creating secure document draft…" });
    try {
      const { createEmployeeDocument } = await employeeDocumentApi();
      await createEmployeeDocument({
        staffRecordId: person.id,
        documentTypeId: selectedTypeId,
        templateId: selectedTemplateId || null,
        title: String(form.get("title") || selectedType?.name || "Employee document"),
        effectiveDate,
        expiryDate: String(form.get("expiryDate") || ""),
        requiresSignature: form.get("requiresSignature") === "on",
        body: draftBody,
        mergeData: builderMode === "variation" ? { variation_type: variationLabel, current_value: currentValue, new_value: newValue, effective_date: shortDate(effectiveDate), reason } : { letter_body: String(form.get("letterBody") || "") },
        changes: builderMode === "variation" && form.get("updateRecord") === "on" ? [{ termKey, currentValue, newValue, reason }] : [],
      });
      setBuilderMode("");
      setMessage({ tone: "good", text: "Draft created. Review it before generating and sending." });
      await load(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Draft could not be created." });
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return setMessage({ tone: "bad", text: "Choose a file to upload." });
    setMessage({ tone: "info", text: "Uploading to the private HR document vault…" });
    try {
      const { uploadEmployeeDocument } = await employeeDocumentApi();
      await uploadEmployeeDocument({ staffRecordId: person.id, documentTypeId: selectedTypeId, title: String(form.get("title") || file.name), issueDate: String(form.get("issueDate") || ""), expiryDate: String(form.get("expiryDate") || ""), requiresSignature: form.get("requiresSignature") === "on" }, file);
      setBuilderMode("");
      setMessage({ tone: "good", text: "Document uploaded securely." });
      await load(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Upload failed." });
    }
  }

  async function documentAction(document, action) {
    setBusyId(document.id);
    try {
      const api = await employeeDocumentApi();
      if (action === "generate") await api.generateEmployeeDocument(document.id);
      if (action === "send") await api.sendEmployeeDocument(document.id);
      if (action === "archive") {
        if (!window.confirm(`Archive ${document.title}? It will remain in the audit history.`)) return;
        await api.archiveEmployeeDocument(document.id, "Archived from employee document timeline");
      }
      if (action === "view" || action === "download") {
        const result = await api.getEmployeeDocumentUrl(document.id, { signed: true, download: action === "download" });
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
      setMessage({ tone: "good", text: action === "send" ? "Document sent to the employee." : action === "generate" ? "PDF generated." : action === "archive" ? "Document archived." : "Secure document link opened." });
      await load(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Document action failed." });
    } finally {
      setBusyId("");
    }
  }

  async function sign(document, data) {
    setBusyId(document.id);
    try {
      const api = await employeeDocumentApi();
      if (data.action === "decline") await api.declineEmployeeDocument(document.id, data.reason);
      else await api.signEmployeeDocument({ documentId: document.id, legalName: data.legalName, method: data.method, signatureData: data.signatureData, confirmed: data.confirmed });
      setMessage({ tone: data.action === "decline" ? "warn" : "good", text: data.action === "decline" ? "Document declined and HR notified." : "Document signed. Your signed PDF is now stored in your history." });
      setPreviewDocument(null);
      await load(false);
    } catch (error) {
      setMessage({ tone: "bad", text: error.message || "Signature could not be recorded." });
    } finally {
      setBusyId("");
    }
  }

  const legacy = legacyFiles.filter((file) => file.staffRecordId === person.id);
  return <section className={`employee-documents ${compact ? "compact" : ""}`}>
    <header className="employee-documents-head"><div><p className="eyebrow">Employment record</p><h3>Documents</h3><p>Contracts, variations, signed letters and retained HR evidence in one permanent timeline.</p></div>{isAdmin && <div><button type="button" onClick={() => openBuilder("document")}>Create document</button><button type="button" onClick={() => openBuilder("variation")}>New contract variation</button><button type="button" onClick={() => openBuilder("upload")}>Upload</button></div>}</header>
    {message?.text && <div className={`employee-doc-message ${message.tone || "info"}`} role={message.tone === "bad" ? "alert" : "status"}>{message.text}</div>}
    <div className="employee-doc-metrics"><article><span>Total records</span><strong>{payload.documents.length + legacy.length}</strong></article><article><span>Awaiting signature</span><strong>{awaiting}</strong></article><article><span>Expiring within 90 days</span><strong>{expiring}</strong></article><article><span>Expired</span><strong>{expired}</strong></article></div>
    <div className="employee-doc-filters"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, type or wording" aria-label="Search employee documents" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></div>
    {loading ? <div className="employee-doc-loading">Loading secure document history…</div> : <div className="employee-doc-timeline">
      {visible.map((document) => <article className={`employee-doc-card ${statusFor(document)}`} key={document.id}><div className="employee-doc-dot" aria-hidden="true" /><div className="employee-doc-card-main"><header><div><span>{document.type?.category || "Employee document"}</span><h4>{document.title}</h4><p>{document.type?.name || "Document"} · Version {document.version}</p></div><DocumentStatus status={statusFor(document)} /></header><div className="employee-doc-dates"><span><b>Created</b>{shortDate(document.createdAt)}</span>{document.effectiveDate && <span><b>Effective</b>{shortDate(document.effectiveDate)}</span>}{document.signedAt && <span><b>Signed</b>{shortDate(document.signedAt)}</span>}{document.expiryDate && <span><b>Expires</b>{shortDate(document.expiryDate)}</span>}</div>{document.signature && <p className="employee-doc-signer">Signed by {document.signature.legalName} · {document.signature.method} signature · evidence {document.signature.evidenceHash.slice(0, 12)}</p>}<div className="employee-doc-actions">{document.storagePath && <button type="button" onClick={() => documentAction(document, "view")}>View</button>}{document.storagePath && <button type="button" onClick={() => documentAction(document, "download")}>Download PDF</button>}{isAdmin && document.status === "draft" && !document.storagePath && <button type="button" onClick={() => documentAction(document, "generate")} disabled={busyId === document.id}>Generate PDF</button>}{isAdmin && document.status === "draft" && <button className="primary" type="button" onClick={() => documentAction(document, "send")} disabled={busyId === document.id}>Generate & send</button>}{isEmployee && document.status === "awaiting_signature" && <button className="primary" type="button" onClick={() => setPreviewDocument(document)}>Review & sign</button>}{isAdmin && !["archived","superseded"].includes(document.status) && <button type="button" onClick={() => documentAction(document, "archive")}>Archive</button>}<details><summary>Audit history</summary><div>{document.events.length ? document.events.map((event) => <p key={event.id}><b>{event.action.replaceAll("_", " ")}</b><span>{event.actor} · {dateTime(event.createdAt)}</span>{event.notes && <small>{event.notes}</small>}</p>) : <p>No events recorded.</p>}</div></details></div></div></article>)}
      {legacy.map((file) => <article className="employee-doc-card legacy" key={`legacy-${file.id}`}><div className="employee-doc-dot" aria-hidden="true" /><div className="employee-doc-card-main"><header><div><span>Existing HR file</span><h4>{file.title}</h4><p>{file.category || "Uploaded document"} · retained record</p></div><span className="employee-doc-status good">Stored</span></header><div className="employee-doc-dates"><span><b>Uploaded</b>{shortDate(file.uploadedAt)}</span>{file.issueDate && <span><b>Issue date</b>{shortDate(file.issueDate)}</span>}{file.expiryDate && <span><b>Expires</b>{shortDate(file.expiryDate)}</span>}</div>{file.fileUrl && <div className="employee-doc-actions"><a href={file.fileUrl} target="_blank" rel="noreferrer">View existing file</a></div>}</div></article>)}
      {!visible.length && !legacy.length && <div className="employee-doc-empty"><strong>No employee documents yet</strong><span>{isAdmin ? "Create a document or upload an existing employment record." : "Your contracts and employment documents will appear here."}</span></div>}
    </div>}
    {!!payload.terms.length && <details className="employment-history"><summary>Employment terms history</summary><div>{payload.terms.map((term) => <article key={term.id}><span>{TERM_OPTIONS.find(([key]) => key === term.termKey)?.[1] || term.termKey}</span><strong>{String(term.currentValue || "Not recorded")} → {String(term.newValue)}</strong><small>Effective {shortDate(term.effectiveDate)} · {term.status}{term.reason ? ` · ${term.reason}` : ""}</small></article>)}</div></details>}
    {builderMode && <div className="employee-doc-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setBuilderMode("")}><section className="employee-doc-builder" role="dialog" aria-modal="true" aria-labelledby="employee-doc-builder-title"><header><div><span>{builderMode === "variation" ? "Guided employment change" : builderMode === "upload" ? "Private document upload" : "Template document builder"}</span><h3 id="employee-doc-builder-title">{builderMode === "variation" ? "New Contract Variation" : builderMode === "upload" ? "Upload employee document" : "Create New"}</h3></div><button type="button" onClick={() => setBuilderMode("")} aria-label="Close document builder">×</button></header><form onSubmit={builderMode === "upload" ? uploadDocument : createDraft}><div className="employee-doc-builder-grid"><label>Document type<select value={selectedTypeId} onChange={(event) => chooseType(event.target.value)} required><option value="">Choose type</option>{payload.types.map((type) => <option key={type.id} value={type.id}>{type.category} · {type.name}</option>)}</select></label>{builderMode !== "upload" && <label>Template<select value={selectedTemplateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Blank document</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select></label>}<label>Title<input name="title" defaultValue={selectedType?.name || ""} required /></label><label>Effective date<input name="effectiveDate" type="date" required={builderMode === "variation"} /></label>{selectedType?.supports_expiry && <label>Expiry date<input name="expiryDate" type="date" /></label>}{builderMode === "upload" && <><label>Issue date<input name="issueDate" type="date" /></label><label className="wide">File<input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" required /></label></>}{builderMode === "variation" && <><label>Variation type<select name="termKey" defaultValue="salary">{TERM_OPTIONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Current value<input name="currentValue" placeholder="Current contractual value" required /></label><label>New value<input name="newValue" placeholder="New contractual value" required /></label><label className="wide">Reason<textarea name="reason" rows="2" placeholder="Annual review, agreed role change…" required /></label><label className="check wide"><input name="updateRecord" type="checkbox" defaultChecked />Add this change to employment history</label></>}{builderMode === "document" && <label className="wide">Letter-specific wording<textarea name="letterBody" rows="3" placeholder="Additional wording used by templates containing {{letter_body}}" /></label>}<label className="check wide"><input name="requiresSignature" type="checkbox" defaultChecked={selectedType?.requires_signature} />Send for employee signature</label></div>{builderMode !== "upload" && <label className="employee-doc-wording">Document wording<textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows="14" placeholder="Use merge fields such as {{employee_name}}, {{job_title}} and {{effective_date}}" /><small>Supported examples: {"{{employee_name}}, {{job_title}}, {{salary}}, {{workplace}}, {{manager_name}}, {{effective_date}}, {{current_date}}"}</small></label>}<div className="employee-doc-builder-actions"><button type="button" onClick={() => setBuilderMode("")}>Cancel</button><button className="primary" type="submit">{builderMode === "upload" ? "Upload securely" : "Create draft"}</button></div></form></section></div>}
    {previewDocument && <EmployeeDocumentSigning document={previewDocument} person={person} busy={busyId === previewDocument.id} onClose={() => setPreviewDocument(null)} onSubmit={(data) => sign(previewDocument, data)} />}
  </section>;
}

function EmployeeDocumentSigning({ document, person, busy, onClose, onSubmit }) {
  const [method, setMethod] = useState("typed");
  const [legalName, setLegalName] = useState(person?.name || "");
  const [signatureData, setSignatureData] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  return <div className="employee-doc-modal-layer"><section className="employee-doc-signing" role="dialog" aria-modal="true" aria-labelledby="sign-document-title"><header><div><span>Secure employee signature</span><h3 id="sign-document-title">{document.title}</h3></div><button type="button" onClick={onClose} aria-label="Close signature view">×</button></header><div className="employee-doc-preview"><p>{document.renderedBody}</p></div>{declining ? <div className="employee-doc-decline"><label>Why are you declining this document?<textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} required /></label><div><button type="button" onClick={() => setDeclining(false)}>Back</button><button type="button" className="danger" disabled={!reason.trim() || busy} onClick={() => onSubmit({ action: "decline", reason })}>Confirm decline</button></div></div> : <div className="employee-doc-sign-form"><div className="employee-sign-method"><button className={method === "typed" ? "active" : ""} type="button" onClick={() => setMethod("typed")}>Type full legal name</button><button className={method === "drawn" ? "active" : ""} type="button" onClick={() => setMethod("drawn")}>Draw signature</button></div><label>Full legal name<input value={legalName} onChange={(event) => setLegalName(event.target.value)} /></label>{method === "drawn" && <SignaturePad onChange={setSignatureData} />}<label className="employee-sign-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I confirm I have read and understood this document.</label><p>Signing records your account, email, time, IP address, browser and device as part of the permanent audit evidence.</p><div className="employee-doc-sign-actions"><button type="button" onClick={() => setDeclining(true)}>Decline</button><button className="primary" type="button" disabled={busy || !confirmed || legalName.trim().length < 2 || (method === "drawn" && !signatureData)} onClick={() => onSubmit({ action: "sign", legalName, method, signatureData, confirmed })}>{busy ? "Signing…" : "Sign Document"}</button></div></div>}</section></div>;
}
