import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const resendFrom = Deno.env.get("APRES_STAFF_EMAIL_FROM") ?? Deno.env.get("RESEND_FROM") ?? "Après School Team <staff@apres-school.co.uk>";
const resendReplyTo = Deno.env.get("APRES_REPLY_TO") ?? Deno.env.get("RESEND_REPLY_TO") ?? "hello@apres-school.co.uk";
const operationsTo = Deno.env.get("OPERATIONS_NOTIFICATION_TO") ?? "hello@apres-school.co.uk";
const portalUrl = Deno.env.get("APRES_STAFF_PORTAL_URL") ?? "https://www.apres-school.co.uk/staff-login";
const bucket = "staff-hr-files";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor) return json({ error: "Authentication required" }, 401);
    const payload = await request.json().catch(() => ({}));
    const action = stringValue(payload.action);
    if (action === "create") return json(await createDocument(actor, payload));
    if (action === "register_upload") return json(await registerUpload(actor, payload));
    if (action === "generate") return json(await generateDocument(actor, stringValue(payload.documentId)));
    if (action === "new_version") return json(await createNewVersion(actor, payload));
    if (action === "send") return json(await sendDocument(actor, stringValue(payload.documentId)));
    if (action === "sign") return json(await signDocument(actor, payload, request));
    if (action === "decline") return json(await declineDocument(actor, payload, request));
    if (action === "archive") return json(await archiveDocument(actor, payload));
    if (action === "url") return json(await documentUrl(actor, payload));
    return json({ error: "Unknown employee document action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Employee document request failed";
    const status = /not authorised|access denied|own document/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});

async function getActor(authHeader: string) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return null;
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,role,active").eq("id", authData.user.id).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

function requireAdmin(actor: any) {
  if (!["admin", "superadmin"].includes(actor.role)) throw new Error("You are not authorised to manage employee documents.");
}

async function createDocument(actor: any, payload: any) {
  requireAdmin(actor);
  const staffRecordId = stringValue(payload.staffRecordId);
  const documentTypeId = stringValue(payload.documentTypeId);
  if (!staffRecordId || !documentTypeId) throw new Error("Choose an employee and document type.");
  const [{ data: staff, error: staffError }, { data: type, error: typeError }] = await Promise.all([
    supabase.from("staff_records").select("id,preferred_name,job_role,start_date,address,primary_site,annual_salary,pay_rate,contract_hours,contract_type,profiles!inner(full_name,email,active)").eq("id", staffRecordId).maybeSingle(),
    supabase.from("employee_document_types").select("id,key,name,category,sensitivity,requires_signature").eq("id", documentTypeId).eq("active", true).maybeSingle(),
  ]);
  if (staffError) throw staffError;
  if (typeError) throw typeError;
  if (!staff || !type) throw new Error("Employee or document type was not found.");
  const profile = relation(staff.profiles);
  let template: any = null;
  if (payload.templateId) {
    const result = await supabase.from("employee_document_templates").select("id,name,subject,body_template,version").eq("id", payload.templateId).eq("active", true).maybeSingle();
    if (result.error) throw result.error;
    template = result.data;
  }
  const managerName = await managerForStaff(staffRecordId);
  const mergeData = {
    employee_name: staff.preferred_name || profile?.full_name || "Employee",
    employee_email: profile?.email || "",
    job_title: staff.job_role || "",
    address: staff.address || "",
    salary: staff.annual_salary ? money(staff.annual_salary) : "",
    hourly_rate: staff.pay_rate ? `${money(staff.pay_rate)} per hour` : "",
    contract_hours: staff.contract_hours == null ? "" : String(staff.contract_hours),
    start_date: displayDate(staff.start_date),
    effective_date: displayDate(payload.effectiveDate),
    manager_name: managerName || actor.full_name || "Après School management",
    company_name: "Après School",
    current_date: displayDate(new Date().toISOString().slice(0, 10)),
    workplace: staff.primary_site || "",
    contract_type: staff.contract_type || "",
    document_title: stringValue(payload.title) || type.name,
    ...(isObject(payload.mergeData) ? payload.mergeData : {}),
  };
  const sourceBody = stringValue(payload.body) || template?.body_template || "{{letter_body}}";
  const renderedBody = renderTemplate(sourceBody, mergeData);
  const title = stringValue(payload.title) || renderTemplate(template?.subject || type.name, mergeData);
  const documentInsert = {
    staff_record_id: staffRecordId,
    document_type_id: type.id,
    template_id: template?.id || null,
    title,
    status: "draft",
    source_kind: "generated",
    effective_date: nullValue(payload.effectiveDate),
    issue_date: new Date().toISOString().slice(0, 10),
    expiry_date: nullValue(payload.expiryDate),
    rendered_body: renderedBody,
    merge_data: mergeData,
    requires_signature: payload.requiresSignature == null ? type.requires_signature : Boolean(payload.requiresSignature),
    created_by: actor.id,
  };
  const { data: document, error } = await supabase.from("employee_documents").insert(documentInsert).select("*").single();
  if (error) throw error;
  await addEvent(document.id, actor, "created", `Created from ${template?.name || type.name}.`, { templateVersion: template?.version || null });
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  for (const change of changes) {
    if (!change?.termKey || change.newValue == null || !document.effective_date) continue;
    const { error: termError } = await supabase.from("employment_terms_history").insert({
      staff_record_id: staffRecordId,
      source_document_id: document.id,
      term_key: change.termKey,
      current_value: change.currentValue == null ? null : { value: change.currentValue },
      new_value: { value: change.newValue },
      effective_date: document.effective_date,
      reason: stringValue(change.reason) || null,
      status: "pending",
      created_by: actor.id,
    });
    if (termError) throw termError;
  }
  return { document };
}

async function registerUpload(actor: any, payload: any) {
  requireAdmin(actor);
  if (!payload.staffRecordId || !payload.documentTypeId || !payload.storagePath) throw new Error("Upload metadata is incomplete.");
  const { data: type, error: typeError } = await supabase.from("employee_document_types").select("requires_signature").eq("id", payload.documentTypeId).single();
  if (typeError) throw typeError;
  const { data: document, error } = await supabase.from("employee_documents").insert({
    staff_record_id: payload.staffRecordId,
    document_type_id: payload.documentTypeId,
    title: stringValue(payload.title) || stringValue(payload.originalFilename) || "Uploaded document",
    status: payload.requiresSignature || type.requires_signature ? "draft" : "signed",
    source_kind: "uploaded",
    effective_date: nullValue(payload.effectiveDate), issue_date: nullValue(payload.issueDate), expiry_date: nullValue(payload.expiryDate),
    storage_path: payload.storagePath, original_filename: stringValue(payload.originalFilename) || null,
    mime_type: stringValue(payload.mimeType) || null, file_size: Number(payload.fileSize || 0) || null,
    requires_signature: payload.requiresSignature == null ? type.requires_signature : Boolean(payload.requiresSignature),
    created_by: actor.id,
  }).select("*").single();
  if (error) throw error;
  await addEvent(document.id, actor, "uploaded", "External employee document uploaded.", { filename: payload.originalFilename });
  return { document };
}

async function generateDocument(actor: any, documentId: string) {
  requireAdmin(actor);
  const document = await fullDocument(documentId);
  if (!document) throw new Error("Document not found.");
  const bytes = await buildPdf(document);
  const path = `${document.staff_record_id}/employee-documents/${document.lineage_id}/v${document.version}/generated.pdf`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from("employee_documents").update({ storage_path: path, mime_type: "application/pdf", file_size: bytes.length, updated_at: new Date().toISOString() }).eq("id", documentId).select("*").single();
  if (error) throw error;
  await addEvent(documentId, actor, "generated", "PDF generated from the approved wording.");
  return { document: data };
}

async function createNewVersion(actor: any, payload: any) {
  requireAdmin(actor);
  const document = await fullDocument(stringValue(payload.documentId));
  if (!document) throw new Error("Document not found.");
  if (document.status === "archived") throw new Error("Archived documents cannot be versioned.");

  const { data: versions, error: versionsError } = await supabase
    .from("employee_documents")
    .select("id,version,is_active_version,status")
    .eq("staff_record_id", document.staff_record_id)
    .eq("lineage_id", document.lineage_id)
    .is("deleted_at", null)
    .order("version", { ascending: false });
  if (versionsError) throw versionsError;
  const nextVersion = Number(versions?.[0]?.version || document.version || 0) + 1;
  const now = new Date().toISOString();
  const activeIds = (versions || []).filter((item) => item.is_active_version).map((item) => item.id);

  const { data: next, error: insertError } = await supabase.from("employee_documents").insert({
    staff_record_id: document.staff_record_id,
    document_type_id: document.document_type_id,
    template_id: document.template_id,
    lineage_id: document.lineage_id,
    version: nextVersion,
    title: stringValue(payload.title) || document.title,
    status: "draft",
    source_kind: "generated",
    effective_date: nullValue(payload.effectiveDate) || document.effective_date,
    issue_date: new Date().toISOString().slice(0, 10),
    expiry_date: nullValue(payload.expiryDate) || document.expiry_date,
    reminder_days: document.reminder_days,
    rendered_body: stringValue(payload.body) || document.rendered_body,
    merge_data: document.merge_data || {},
    requires_signature: document.requires_signature,
    is_active_version: false,
    created_by: actor.id,
  }).select("*").single();
  if (insertError) throw insertError;

  if (activeIds.length) {
    const { error: supersedeError } = await supabase
      .from("employee_documents")
      .update({ is_active_version: false, status: "superseded", updated_at: now })
      .in("id", activeIds);
    if (supersedeError) throw supersedeError;
    for (const id of activeIds) await addEvent(id, actor, "superseded", `Superseded by version ${nextVersion}.`);
  }
  const { error: activateError } = await supabase.from("employee_documents").update({ is_active_version: true }).eq("id", next.id);
  if (activateError) throw activateError;

  const { data: pendingTerms, error: termsError } = await supabase
    .from("employment_terms_history")
    .select("staff_record_id,term_key,current_value,new_value,effective_date,reason")
    .eq("source_document_id", document.id)
    .eq("status", "pending");
  if (termsError) throw termsError;
  if (pendingTerms?.length) {
    const { error: cancelTermsError } = await supabase.from("employment_terms_history").update({ status: "cancelled" }).eq("source_document_id", document.id).eq("status", "pending");
    if (cancelTermsError) throw cancelTermsError;
    const { error: copyTermsError } = await supabase.from("employment_terms_history").insert(pendingTerms.map((term) => ({
      ...term,
      source_document_id: next.id,
      created_by: actor.id,
      status: "pending",
    })));
    if (copyTermsError) throw copyTermsError;
  }

  await addEvent(next.id, actor, "created", `Created as version ${nextVersion} from version ${document.version}.`, { previousDocumentId: document.id });
  return { document: next };
}

async function sendDocument(actor: any, documentId: string) {
  requireAdmin(actor);
  let document = await fullDocument(documentId);
  if (!document) throw new Error("Document not found.");
  if (!document.storage_path) {
    await generateDocument(actor, documentId);
    document = await fullDocument(documentId);
  }
  const status = document.requires_signature ? "awaiting_signature" : "signed";
  const { data, error } = await supabase.from("employee_documents").update({ status, sent_by: actor.id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", documentId).select("*").single();
  if (error) throw error;
  await addEvent(documentId, actor, "sent", document.requires_signature ? "Sent to employee for signature." : "Published to employee documents.");
  const staff = document.staff_records;
  const profile = relation(staff?.profiles);
  if (profile?.email) {
    const subject = document.requires_signature ? `Please review and sign: ${document.title}` : `New employee document: ${document.title}`;
    const text = [`Hi ${staff?.preferred_name || profile.full_name || "there"},`, "", document.requires_signature ? "A document is ready for you to review and sign." : "A new document has been added to your employee record.", `Document: ${document.title}`, document.effective_date ? `Effective: ${displayDate(document.effective_date)}` : "", "", `Sign in to view it: ${portalUrl}`, "", "Thank you,", "Après School"].filter(Boolean).join("\n");
    await sendEmail(profile.email, staff?.preferred_name || profile.full_name, subject, text, actor.id, documentId, "employee_document_ready");
  }
  return { document: data, emailed: Boolean(profile?.email && resendApiKey) };
}

async function signDocument(actor: any, payload: any, request: Request) {
  const document = await fullDocument(stringValue(payload.documentId));
  if (!document || document.status !== "awaiting_signature") throw new Error("This document is not awaiting signature.");
  const staff = document.staff_records;
  if (staff?.profile_id !== actor.id) throw new Error("You can only sign your own document.");
  const legalName = stringValue(payload.legalName);
  const method = payload.method === "drawn" ? "drawn" : "typed";
  const confirmation = stringValue(payload.confirmationText) || "I confirm I have read and understood this document.";
  if (!payload.confirmed || legalName.length < 2) throw new Error("Confirm that you have read the document and enter your full legal name.");
  const signedAt = new Date().toISOString();
  const evidence = `${document.id}|${actor.id}|${actor.email}|${legalName}|${method}|${signedAt}`;
  const evidenceHash = await sha256(evidence);
  const signature = { legalName, method, signatureData: method === "drawn" ? stringValue(payload.signatureData).slice(0, 250000) : "", signedAt, email: actor.email, ip: clientIp(request), userAgent: request.headers.get("user-agent") || "", evidenceHash };
  const bytes = await buildPdf(document, signature);
  const path = `${document.staff_record_id}/employee-documents/${document.lineage_id}/v${document.version}/signed-${evidenceHash.slice(0, 12)}.pdf`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;
  const { error: signatureError } = await supabase.from("employee_document_signatures").insert({
    document_id: document.id, signer_staff_record_id: staff.id, signer_profile_id: actor.id, signature_method: method,
    legal_name: legalName, signature_data: signature.signatureData || null, confirmation_text: confirmation,
    signer_email: actor.email, ip_address: signature.ip, user_agent: signature.userAgent, device_summary: deviceSummary(signature.userAgent), evidence_hash: evidenceHash, signed_at: signedAt,
  });
  if (signatureError) throw signatureError;
  const { data, error } = await supabase.from("employee_documents").update({ status: "signed", signed_storage_path: path, signed_at: signedAt, updated_at: signedAt }).eq("id", document.id).select("*").single();
  if (error) throw error;
  await addEvent(document.id, actor, "signed", confirmation, { method, evidenceHash }, request);
  await applyDueTerms(document, actor);
  await notifyOperations(`Document signed: ${document.title}`, `${legalName} signed ${document.title} at ${signedAt}.`, actor.id, document.id, "employee_document_signed");
  return { document: data };
}

async function declineDocument(actor: any, payload: any, request: Request) {
  const document = await fullDocument(stringValue(payload.documentId));
  if (!document || document.status !== "awaiting_signature" || document.staff_records?.profile_id !== actor.id) throw new Error("You can only decline your own pending document.");
  const reason = stringValue(payload.reason);
  if (!reason) throw new Error("Add a reason for declining this document.");
  const declinedAt = new Date().toISOString();
  const { data, error } = await supabase.from("employee_documents").update({ status: "declined", declined_at: declinedAt, updated_at: declinedAt }).eq("id", document.id).select("*").single();
  if (error) throw error;
  await addEvent(document.id, actor, "declined", reason, {}, request);
  await notifyOperations(`Document declined: ${document.title}`, `${actor.full_name || actor.email} declined ${document.title}. Reason: ${reason}`, actor.id, document.id, "employee_document_declined");
  return { document: data };
}

async function archiveDocument(actor: any, payload: any) {
  requireAdmin(actor);
  const documentId = stringValue(payload.documentId);
  const archivedAt = new Date().toISOString();
  const { data, error } = await supabase.from("employee_documents").update({ status: "archived", archived_at: archivedAt, updated_at: archivedAt }).eq("id", documentId).select("*").single();
  if (error) throw error;
  await addEvent(documentId, actor, "archived", stringValue(payload.reason) || "Archived by administrator.");
  return { document: data };
}

async function documentUrl(actor: any, payload: any) {
  const document = await fullDocument(stringValue(payload.documentId));
  if (!document || !(await actorCanRead(actor, document))) throw new Error("Document access denied.");
  const signed = payload.signed !== false && document.signed_storage_path;
  const path = signed || document.storage_path;
  if (!path) throw new Error("This document has not been generated yet.");
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 900);
  if (error) throw error;
  await addEvent(document.id, actor, payload.download ? "downloaded" : "viewed", payload.download ? "Signed download link issued." : "Secure preview link issued.", { signedCopy: Boolean(signed) });
  return { url: data.signedUrl, expiresIn: 900 };
}

async function fullDocument(id: string) {
  if (!id) return null;
  const { data, error } = await supabase.from("employee_documents").select("*,employee_document_types(id,key,name,category,sensitivity),staff_records!inner(id,profile_id,preferred_name,profiles!inner(full_name,email,active))").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data;
}

async function actorCanRead(actor: any, document: any) {
  if (["admin", "superadmin"].includes(actor.role)) return true;
  if (document.staff_records?.profile_id === actor.id) {
    return ["awaiting_signature", "signed", "declined", "superseded", "expired"].includes(document.status);
  }
  if (actor.role !== "manager" || ["restricted_hr", "confidential_payroll"].includes(document.employee_document_types?.sensitivity)) return false;
  const { data: managerStaff } = await supabase.from("staff_records").select("id").eq("profile_id", actor.id).maybeSingle();
  if (!managerStaff) return false;
  const { count } = await supabase.from("hr_reporting_lines").select("id", { count: "exact", head: true }).eq("manager_staff_record_id", managerStaff.id).eq("staff_record_id", document.staff_record_id).is("archived_at", null);
  return Number(count || 0) > 0;
}

async function managerForStaff(staffRecordId: string) {
  const { data } = await supabase.from("hr_reporting_lines").select("staff_records!hr_reporting_lines_manager_staff_record_id_fkey(preferred_name,profiles!inner(full_name))").eq("staff_record_id", staffRecordId).is("archived_at", null).maybeSingle();
  const manager = relation(data?.staff_records);
  return manager?.preferred_name || relation(manager?.profiles)?.full_name || "";
}

async function applyDueTerms(document: any, actor: any) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: terms, error } = await supabase.from("employment_terms_history").select("*").eq("source_document_id", document.id).eq("status", "pending").lte("effective_date", today);
  if (error) throw error;
  for (const term of terms || []) {
    const value = normalizedTermValue(term.term_key, term.new_value?.value);
    const field = term.term_key === "salary" ? "annual_salary" : term.term_key === "hourly_rate" ? "pay_rate" : term.term_key === "contract_hours" ? "contract_hours" : term.term_key === "job_title" ? "job_role" : term.term_key === "workplace" ? "primary_site" : null;
    if (field) {
      const { error: updateError } = await supabase.from("staff_records").update({ [field]: value }).eq("id", term.staff_record_id);
      if (updateError) throw updateError;
    }
    await supabase.from("employment_terms_history").update({ status: "applied", applied_by: actor.id, applied_at: new Date().toISOString() }).eq("id", term.id);
  }
}

function normalizedTermValue(termKey: string, value: unknown) {
  if (!["salary", "hourly_rate", "contract_hours"].includes(termKey)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`The ${termKey.replaceAll("_", " ")} value must be numeric.`);
  return parsed;
}

async function buildPdf(document: any, signature: any = null) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 54;
  let page = pdf.addPage(pageSize);
  let y = 780;
  const drawHeader = () => {
    page.drawText("APRÈS SCHOOL", { x: margin, y: 802, size: 11, font: bold, color: rgb(0.11,0.22,0.55) });
    page.drawLine({ start: { x: margin, y: 792 }, end: { x: 541, y: 792 }, thickness: 1, color: rgb(0.88,0.58,0.18) });
  };
  const newPage = () => { page = pdf.addPage(pageSize); y = 780; drawHeader(); };
  drawHeader();
  page.drawText(document.title || "Employee document", { x: margin, y, size: 18, font: bold, color: rgb(0.08,0.18,0.42) });
  y -= 24;
  const staff = document.staff_records;
  const profile = relation(staff?.profiles);
  page.drawText(`${staff?.preferred_name || profile?.full_name || "Employee"} · Version ${document.version}`, { x: margin, y, size: 9, font: regular, color: rgb(0.38,0.43,0.52) });
  y -= 30;
  for (const paragraph of String(document.rendered_body || "").split(/\n/)) {
    if (!paragraph.trim()) { y -= 10; continue; }
    const lines = wrapText(paragraph, regular, 10.5, 487);
    for (const line of lines) {
      if (y < 72) newPage();
      page.drawText(line, { x: margin, y, size: 10.5, font: regular, color: rgb(0.12,0.15,0.22) });
      y -= 15;
    }
  }
  if (signature) {
    if (y < 190) newPage();
    y -= 22;
    page.drawLine({ start: { x: margin, y }, end: { x: 541, y }, thickness: 1, color: rgb(0.82,0.84,0.88) });
    y -= 24;
    page.drawText("DIGITAL SIGNATURE", { x: margin, y, size: 9, font: bold, color: rgb(0.11,0.22,0.55) });
    y -= 22;
    if (signature.method === "drawn" && signature.signatureData?.startsWith("data:image/png;base64,")) {
      const signatureBytes = Uint8Array.from(atob(signature.signatureData.split(",")[1]), (character) => character.charCodeAt(0));
      const signatureImage = await pdf.embedPng(signatureBytes);
      const dimensions = signatureImage.scale(Math.min(1, 180 / signatureImage.width, 55 / signatureImage.height));
      page.drawImage(signatureImage, { x: margin, y: y - dimensions.height + 5, width: dimensions.width, height: dimensions.height });
      y -= Math.max(52, dimensions.height);
      page.drawText(signature.legalName, { x: margin, y, size: 9, font: bold, color: rgb(0.08,0.18,0.42) });
    } else {
      page.drawText(signature.legalName, { x: margin, y, size: 16, font: bold, color: rgb(0.08,0.18,0.42) });
    }
    y -= 18;
    page.drawText(`Signed ${new Date(signature.signedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} · ${signature.method} signature`, { x: margin, y, size: 8.5, font: regular, color: rgb(0.38,0.43,0.52) });
    y -= 14;
    page.drawText(`Signer: ${signature.email} · Evidence ${signature.evidenceHash.slice(0,24)}`, { x: margin, y, size: 8.5, font: regular, color: rgb(0.38,0.43,0.52) });
  }
  for (const [index, pdfPage] of pdf.getPages().entries()) pdfPage.drawText(`Après School employee document · ${index + 1}/${pdf.getPageCount()}`, { x: margin, y: 32, size: 7.5, font: regular, color: rgb(0.55,0.58,0.64) });
  return await pdf.save();
}

async function addEvent(documentId: string, actor: any, action: string, notes = "", metadata: any = {}, request?: Request) {
  const { error } = await supabase.from("employee_document_events").insert({ document_id: documentId, actor_id: actor.id, actor_email: actor.email, action, notes: notes || null, ip_address: request ? clientIp(request) : null, user_agent: request?.headers.get("user-agent") || null, metadata });
  if (error) throw error;
}

async function sendEmail(to: string, name: string, subject: string, text: string, actorId: string, documentId: string, emailType: string) {
  let status = "queued_without_provider";
  let providerMessageId = "";
  let errorMessage = "";
  if (resendApiKey) {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: resendFrom, to: [to], reply_to: resendReplyTo, subject, text }) });
    if (response.ok) { status = "sent"; providerMessageId = (await response.json().catch(() => ({})))?.id || ""; }
    else { status = "failed"; errorMessage = `Email provider returned ${response.status}`; }
  }
  await supabase.from("email_logs").insert({ recipient_email: to, recipient_name: name || null, email_type: emailType, subject, status, provider: "resend", provider_message_id: providerMessageId || null, error_message: errorMessage || null, sent_by: actorId, metadata: { employeeDocumentId: documentId }, sent_at: status === "sent" ? new Date().toISOString() : null });
  if (status === "failed") throw new Error(errorMessage);
}

async function notifyOperations(subject: string, text: string, actorId: string, documentId: string, emailType: string) {
  await sendEmail(operationsTo, "Après School HR", subject, text, actorId, documentId, emailType).catch((error) => console.error(error));
}

function renderTemplate(template: string, values: Record<string, unknown>) { return String(template || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => values[key] == null ? "" : String(values[key])); }
function wrapText(text: string, font: any, size: number, width: number) { const words = text.split(/\s+/); const lines: string[] = []; let line = ""; for (const word of words) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next,size) > width && line) { lines.push(line); line = word; } else line = next; } if (line) lines.push(line); return lines; }
function relation(value: any) { return Array.isArray(value) ? value[0] : value; }
function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function nullValue(value: unknown) { const text = stringValue(value); return text || null; }
function isObject(value: unknown): value is Record<string,unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function money(value: unknown) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0)); }
function displayDate(value: unknown) { const text = stringValue(value); if (!text) return ""; return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(`${text.slice(0,10)}T12:00:00Z`)); }
function clientIp(request: Request) { return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || ""; }
function deviceSummary(userAgent: string) { if (/mobile/i.test(userAgent)) return "Mobile browser"; if (/tablet|ipad/i.test(userAgent)) return "Tablet browser"; return "Desktop browser"; }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2,"0")).join(""); }
function json(body: Record<string,unknown>, status=200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
