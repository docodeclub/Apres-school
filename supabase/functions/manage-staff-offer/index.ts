import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildStaffEmailHtml } from "../_shared/staff-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("APRES_SERVICE_ROLE_KEY") ?? "";
const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const resendFrom = Deno.env.get("APRES_STAFF_EMAIL_FROM") ?? Deno.env.get("RESEND_FROM") ?? "Après School Team <staff@apres-school.co.uk>";
const resendReplyTo = Deno.env.get("APRES_REPLY_TO") ?? Deno.env.get("RESEND_REPLY_TO") ?? "hello@apres-school.co.uk";
const operationsTo = Deno.env.get("OPERATIONS_NOTIFICATION_TO") ?? "hello@apres-school.co.uk";
const publicOfferUrl = Deno.env.get("APRES_STAFF_OFFER_URL") ?? "https://www.apres-school.co.uk/staff-offer";
const staffPortalUrl = Deno.env.get("APRES_STAFF_PORTAL_URL") ?? "https://www.apres-school.co.uk/staff-login";
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const payload = await request.json().catch(() => ({}));
    const action = text(payload.action, 40);
    if (action === "view") return json(await viewOffer(text(payload.token, 500)));
    if (action === "respond") return json(await respondToOffer(text(payload.token, 500), text(payload.decision, 20), request));

    const actor = await getActor(request.headers.get("Authorization") || "");
    if (!actor || !["admin", "superadmin"].includes(actor.role)) return json({ error: "Only Admin can manage job offers." }, 403);
    if (action === "send") return json(await sendOffer(actor, text(payload.offerId, 60)));
    if (action === "activate") return json(await activateOnboarding(actor, text(payload.offerId, 60)));
    return json({ error: "Unknown staff offer action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unable to manage the staff offer." }, 400);
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

async function loadOfferById(id: string) {
  if (!id) throw new Error("Choose an offer.");
  const { data, error } = await supabase.from("staff_offers").select("*,staff_applications(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Offer not found.");
  return { ...data, application: relation(data.staff_applications) };
}

async function loadOfferByToken(token: string) {
  if (!token) throw new Error("This offer link is incomplete.");
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("staff_offers").select("*,staff_applications(*)").eq("response_token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This offer link is not valid.");
  return { ...data, application: relation(data.staff_applications) };
}

async function viewOffer(token: string) {
  const offer = await loadOfferByToken(token);
  const expired = offer.offer_expires_at && new Date(offer.offer_expires_at).getTime() < Date.now() && offer.status === "sent";
  if (expired) await supabase.from("staff_offers").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", offer.id);
  return { offer: publicOffer(offer, expired ? "expired" : offer.status) };
}

async function sendOffer(actor: any, offerId: string) {
  const offer = await loadOfferById(offerId);
  if (["accepted", "onboarding"].includes(offer.status)) throw new Error("This offer has already been accepted.");
  if (!offer.start_date || !offer.pay_amount || !offer.offer_expires_at) throw new Error("Complete the start date, pay and response deadline before sending.");
  const token = secureToken();
  const responseUrl = `${publicOfferUrl}?token=${encodeURIComponent(token)}`;
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase.from("staff_offers").update({
    status: "sent", response_token_hash: await sha256(token), sent_at: now, updated_by: actor.id, updated_at: now,
  }).eq("id", offer.id).select("*").single();
  if (updateError) throw updateError;
  await supabase.from("staff_applications").update({ status: "shortlisted", reviewed_at: now, reviewed_by: actor.id, updated_at: now }).eq("id", offer.application_id);
  await supabase.from("staff_candidate_onboarding").update({ status: "offered", section_status: mergeJson(await onboardingSections(offer.id), { offer: "sent" }), updated_by: actor.id, updated_at: now }).eq("offer_id", offer.id);

  const candidateName = offer.application?.name || "Candidate";
  const subject = `Your job offer from Après School – ${offer.job_title}`;
  const html = buildStaffEmailHtml({
    preheader: `We are delighted to offer you the role of ${offer.job_title}.`,
    eyebrow: "Your Après School offer",
    title: "We would love you to join us",
    greeting: `Hi ${firstName(candidateName)},`,
    paragraphs: [
      `Following your application, we are delighted to offer you the role of ${offer.job_title}${offer.school_name ? ` at ${offer.school_name}` : " with Après School"}.`,
      offer.personal_message || "We were impressed by your application and would be delighted to welcome you to the team.",
      "Open your secure offer to review the terms and tell us whether you would like to accept. Any information carried into onboarding remains subject to our safer-recruitment checks.",
    ],
    details: offerDetails(offer),
    action: { label: "Review and respond to offer", url: responseUrl },
    notice: `Please respond by ${displayDateTime(offer.offer_expires_at)}. This link is personal to you and should not be forwarded.`,
    portalLabel: "Staff offer",
    footerText: "Safer recruitment and secure employee onboarding.",
  });
  const email = await safeSendEmail(offer.account_email, subject, html);
  await logEmail({ offer, actorId: actor.id, recipient: offer.account_email, subject, status: email.sent ? "sent" : "queued_without_provider", providerMessageId: email.id });
  await audit(actor.id, "staff_offer_sent", offer.id, { applicationId: offer.application_id, recipient: offer.account_email, emailSent: email.sent });
  return { offer: updated, emailed: email.sent, emailError: email.sent ? "" : "Email provider is not configured." };
}

async function respondToOffer(token: string, decision: string, request: Request) {
  if (!["accept", "decline"].includes(decision)) throw new Error("Choose whether to accept or decline the offer.");
  const offer = await loadOfferByToken(token);
  if (offer.status === "sent" && offer.offer_expires_at && new Date(offer.offer_expires_at).getTime() < Date.now()) throw new Error("This offer has expired. Please contact Après School.");
  if (!["sent", decision === "accept" ? "accepted" : "declined"].includes(offer.status)) throw new Error("This offer has already been responded to.");
  const status = decision === "accept" ? "accepted" : "declined";
  if (offer.status === status) {
    return { status, message: status === "accepted" ? "Your offer acceptance is already securely recorded." : "Your response is already securely recorded.", notificationsSent: true };
  }
  const now = new Date().toISOString();
  const patch = decision === "accept" ? { status, accepted_at: now } : { status, declined_at: now };
  const { error } = await supabase.from("staff_offers").update({ ...patch, updated_at: now }).eq("id", offer.id);
  if (error) throw error;
  await supabase.from("staff_applications").update({ status: decision === "accept" ? "hired" : "withdrawn", updated_at: now }).eq("id", offer.application_id);
  await supabase.from("staff_candidate_onboarding").update({
    status: decision === "accept" ? "accepted" : "declined",
    accepted_at: decision === "accept" ? now : null,
    section_status: mergeJson(await onboardingSections(offer.id), { offer: decision === "accept" ? "accepted" : "declined" }),
    updated_at: now,
  }).eq("offer_id", offer.id);
  const candidateName = offer.application?.name || "Candidate";
  const candidateSubject = decision === "accept" ? "We have received your offer acceptance" : "We have received your response";
  const candidateEmail = await safeSendEmail(offer.account_email, candidateSubject, buildStaffEmailHtml({
    preheader: candidateSubject,
    eyebrow: "Après School recruitment",
    title: decision === "accept" ? "Welcome to the next step" : "Thank you for letting us know",
    greeting: `Hi ${firstName(candidateName)},`,
    paragraphs: decision === "accept"
      ? ["Thank you for accepting our offer. We are delighted that you would like to join Après School.", "Our team will now open your secure onboarding record and contact you about the evidence and documents needed before your start date."]
      : ["Thank you for considering the role and for letting us know your decision.", "We appreciate the time you invested in your application and wish you every success."],
    details: [{ label: "Role", value: offer.job_title }, { label: "Response", value: decision === "accept" ? "Accepted" : "Declined" }],
    notice: decision === "accept" ? "Application answers are carried into onboarding as unverified declarations. Identity, right-to-work, DBS and other checks still require evidence." : undefined,
    portalLabel: "Recruitment",
  }));
  const adminUrl = `${staffPortalUrl}?section=users`;
  const operationsEmail = await safeSendEmail(operationsTo, `${candidateName} has ${status} the job offer`, buildStaffEmailHtml({
    preheader: `${candidateName} has ${status} the offer for ${offer.job_title}.`, eyebrow: "Recruitment update", title: `Offer ${status}`, greeting: "Hi team,",
    paragraphs: [`${candidateName} has ${status} the offer for ${offer.job_title}.`, decision === "accept" ? "Open Staff Onboarding to create their secure staff account and continue the evidence checks." : "The application and response remain in the audit trail."],
    details: offerDetails(offer), action: { label: "Open Staff Onboarding", url: adminUrl }, portalLabel: "Staff onboarding",
  }));
  await supabase.from("audit_log").insert({ actor_id: null, action: `staff_offer_${status}`, table_name: "staff_offers", record_id: offer.id, metadata: { applicationId: offer.application_id, sourceIpHash: await sha256(clientIp(request)) } });
  return {
    status,
    message: decision === "accept" ? "Your offer has been accepted. Welcome to the next stage of onboarding." : "Your response has been recorded.",
    notificationsSent: candidateEmail.sent && operationsEmail.sent,
  };
}

async function activateOnboarding(actor: any, offerId: string) {
  const offer = await loadOfferById(offerId);
  if (offer.status !== "accepted") throw new Error("The candidate must accept the offer before an account is created.");
  if (offer.staff_record_id) return { staffRecordId: offer.staff_record_id, alreadyCreated: true };
  const application = offer.application;
  const existingProfile = await findProfile(offer.account_email);
  if (existingProfile && !["staff", "manager", "admin", "superadmin"].includes(existingProfile.role)) {
    throw new Error("This email belongs to a family account. Edit the offer and use a separate staff account email.");
  }
  const temporaryPassword = createTemporaryPassword();
  let userId = existingProfile?.id || "";
  if (userId) {
    const { error } = await supabase.auth.admin.updateUserById(userId, { password: temporaryPassword, email_confirm: true, user_metadata: { full_name: application.name, role: offer.access_role } });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({ email: offer.account_email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: application.name, role: offer.access_role } });
    if (error || !data.user) throw error || new Error("Unable to create the staff login.");
    userId = data.user.id;
  }
  const { error: profileError } = await supabase.from("profiles").upsert({ id: userId, email: offer.account_email, full_name: application.name, phone: application.phone || null, role: offer.access_role, active: true, must_change_password: true, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (profileError) throw profileError;
  let { data: staffRecord, error: staffReadError } = await supabase.from("staff_records").select("id").eq("profile_id", userId).maybeSingle();
  if (staffReadError) throw staffReadError;
  if (!staffRecord) {
    const result = await supabase.from("staff_records").insert({ profile_id: userId, preferred_name: firstName(application.name), date_of_birth: application.date_of_birth || null, address: application.address || null, job_role: offer.job_title, employment_type: offer.employment_type || null, start_date: offer.start_date || null, pay_rate: offer.pay_basis === "hourly" ? offer.pay_amount : null, annual_salary: offer.pay_basis === "salary" ? offer.pay_amount : null, contract_hours: offer.contract_hours || null, contract_type: offer.contract_type || null, primary_site: offer.school_name || null }).select("id").single();
    if (result.error) throw result.error;
    staffRecord = result.data;
  }
  const details = application.application_data || {};
  const { data: existingScr } = await supabase.from("scr_checks").select("id").eq("staff_record_id", staffRecord.id).maybeSingle();
  if (!existingScr) {
    const { error } = await supabase.from("scr_checks").insert({
      staff_record_id: staffRecord.id,
      right_to_work: { status: "unverified", declared: details.rightToWork || "Not recorded", type: details.rightToWorkType || "", source: "application" },
      identity_checks: { status: "incomplete", source: "application" },
      dbs: { status: "incomplete", updateServiceDeclared: details.dbsUpdateService || "Not recorded", source: "application" },
      safeguarding: { status: "incomplete", declaration: details.safeguardingStatement || "Not recorded", source: "application" },
      first_aid: { status: "unverified", details: details.firstAidDetails || "", source: "application" },
      annual_declarations: { status: "unverified", medicalFitness: details.medicalFitness || "Not recorded", source: "application" },
      recruitment_checks: { status: "incomplete", references: details.references || "", employmentHistory: details.employmentHistory || "", employmentGaps: details.employmentGaps || "", livedAbroad: details.livedAbroad || "", overseasDetails: details.overseasDetails || "", qualifications: details.qualifications || "", criminalDisclosure: details.criminalDisclosure || "", barredListDisclosure: details.barredListDisclosure || "", source: "application", verified: false },
      admin_review: { status: "incomplete", note: "Imported from accepted application. All declarations require verification." },
    });
    if (error) throw error;
  }
  await createOfferDocument(actor, offer, application, staffRecord.id);
  const now = new Date().toISOString();
  await supabase.from("staff_offers").update({ status: "onboarding", staff_record_id: staffRecord.id, account_created_at: now, response_token_hash: null, updated_by: actor.id, updated_at: now }).eq("id", offer.id);
  await supabase.from("staff_candidate_onboarding").update({ staff_record_id: staffRecord.id, status: "in_progress", section_status: mergeJson(await onboardingSections(offer.id), { offer: "accepted", personal: "imported_unverified", documents: "offer_sent_for_signature" }), updated_by: actor.id, updated_at: now }).eq("offer_id", offer.id);
  const email = await safeSendEmail(offer.account_email, "Welcome to the Après School staff platform", buildStaffEmailHtml({
    preheader: "Your secure staff onboarding account is ready.", eyebrow: "Après School Staff", title: "Your onboarding account is ready", greeting: `Hi ${firstName(application.name)},`,
    paragraphs: ["Your staff account has been created so you can continue your onboarding securely.", "Your application answers have been carried across as unverified declarations. Please use the platform to review documents and complete the evidence requested by our team."],
    details: [{ label: "Login email", value: offer.account_email }, { label: "Temporary password", value: temporaryPassword, monospace: true }, { label: "Role", value: offer.job_title }],
    action: { label: "Open staff onboarding", url: staffPortalUrl }, notice: "Change your temporary password when prompted. Do not send identity, DBS or right-to-work evidence by ordinary email.", portalLabel: "Staff onboarding", footerText: "Secure employee records and safer recruitment.",
  }));
  await logEmail({ offer, actorId: actor.id, recipient: offer.account_email, subject: "Welcome to the Après School staff platform", status: email.sent ? "sent" : "queued_without_provider", providerMessageId: email.id, staffRecordId: staffRecord.id });
  await audit(actor.id, "staff_onboarding_activated", offer.id, { staffRecordId: staffRecord.id, userId, emailSent: email.sent });
  return { staffRecordId: staffRecord.id, userId, emailed: email.sent, emailError: email.sent ? "" : "Email provider is not configured." };
}

async function createOfferDocument(actor: any, offer: any, application: any, staffRecordId: string) {
  const { data: type } = await supabase.from("employee_document_types").select("id").eq("key", "offer_letter").maybeSingle();
  if (!type) return;
  const { data: existing } = await supabase.from("employee_documents").select("id").eq("staff_record_id", staffRecordId).eq("document_type_id", type.id).contains("merge_data", { offer_id: offer.id }).maybeSingle();
  if (existing) return;
  const { data: document, error } = await supabase.from("employee_documents").insert({ staff_record_id: staffRecordId, document_type_id: type.id, title: `Offer of employment – ${offer.job_title}`, status: "awaiting_signature", source_kind: "generated", effective_date: offer.start_date, issue_date: new Date().toISOString().slice(0, 10), rendered_body: offer.rendered_offer, merge_data: { offer_id: offer.id, employee_name: application.name, job_title: offer.job_title, workplace: offer.school_name, start_date: offer.start_date, pay_basis: offer.pay_basis, pay_amount: offer.pay_amount, contract_hours: offer.contract_hours, manager_name: offer.manager_name }, requires_signature: true, sent_by: actor.id, sent_at: new Date().toISOString(), created_by: actor.id }).select("id").single();
  if (error) throw error;
  await supabase.from("employee_document_events").insert({ document_id: document.id, actor_id: actor.id, actor_email: actor.email, action: "sent", notes: "Offer accepted through secure recruitment link; formal signature requested in staff platform.", metadata: { offerId: offer.id } });
}

async function onboardingSections(offerId: string) {
  const { data } = await supabase.from("staff_candidate_onboarding").select("section_status").eq("offer_id", offerId).maybeSingle();
  return data?.section_status || {};
}

async function findProfile(email: string) {
  const { data, error } = await supabase.from("profiles").select("id,email,role,active").ilike("email", email).maybeSingle();
  if (error) throw error;
  return data;
}

function publicOffer(offer: any, status: string) {
  return { id: offer.id, candidateName: offer.application?.name || "Candidate", status, jobTitle: offer.job_title, schoolName: offer.school_name || "", managerName: offer.manager_name || "", employmentType: offer.employment_type || "", contractType: offer.contract_type || "", payBasis: offer.pay_basis, payAmount: Number(offer.pay_amount || 0), contractHours: offer.contract_hours == null ? null : Number(offer.contract_hours), startDate: offer.start_date || "", expiresAt: offer.offer_expires_at || "", personalMessage: offer.personal_message || "", renderedOffer: offer.rendered_offer || "" };
}

function offerDetails(offer: any) {
  return [
    { label: "Role", value: offer.job_title },
    ...(offer.school_name ? [{ label: "Primary workplace", value: offer.school_name }] : []),
    { label: "Start date", value: displayDate(offer.start_date) },
    { label: offer.pay_basis === "salary" ? "Annual salary" : "Hourly rate", value: money(offer.pay_amount, offer.pay_basis) },
    ...(offer.contract_hours ? [{ label: "Contracted hours", value: `${offer.contract_hours} hours` }] : []),
    ...(offer.contract_type ? [{ label: "Contract", value: offer.contract_type }] : []),
  ];
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!resendApiKey) return { sent: false, id: "" };
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: resendFrom, to: [to], reply_to: resendReplyTo, subject, html }) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
  const result = await response.json().catch(() => ({}));
  return { sent: true, id: result.id || "" };
}

async function safeSendEmail(to: string, subject: string, html: string) {
  try {
    return await sendEmail(to, subject, html);
  } catch (error) {
    console.error("Staff offer email failed", error);
    return { sent: false, id: "" };
  }
}

async function logEmail({ offer, actorId, recipient, subject, status, providerMessageId = "", staffRecordId = null }: any) {
  await supabase.from("email_logs").insert({ recipient_email: recipient, recipient_name: offer.application?.name || null, email_type: "staff_offer", subject, status, provider: "resend", provider_message_id: providerMessageId || null, sent_by: actorId, staff_record_id: staffRecordId, metadata: { offerId: offer.id, applicationId: offer.application_id }, sent_at: status === "sent" ? new Date().toISOString() : null });
}

async function audit(actorId: string | null, action: string, recordId: string, metadata: Record<string, unknown>) {
  const { error } = await supabase.from("audit_log").insert({ actor_id: actorId, action, table_name: "staff_offers", record_id: recordId, metadata });
  if (error) console.error(error.message);
}

function relation(value: any) { return Array.isArray(value) ? value[0] : value; }
function text(value: unknown, max = 5000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function firstName(value: string) { return text(value, 120).split(/\s+/)[0] || "there"; }
function displayDate(value: string) { if (!value) return "To be agreed"; return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }); }
function displayDateTime(value: string) { if (!value) return "the stated deadline"; return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }); }
function money(value: number, basis: string) { return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0))}${basis === "hourly" ? " per hour" : " per year"}`; }
function mergeJson(current: Record<string, unknown>, patch: Record<string, unknown>) { return { ...(current || {}), ...patch }; }
function secureToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function createTemporaryPassword() { return `Apres-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}!`; }
function clientIp(request: Request) { return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim(); }
async function sha256(value: string) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
