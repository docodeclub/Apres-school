import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const enquiryFunctionName = import.meta.env.VITE_ENQUIRY_FUNCTION_NAME || "notify-public-enquiry";
const coverMoveFunctionName = import.meta.env.VITE_COVER_MOVE_FUNCTION_NAME || "notify-cover-move";
const staffAccountFunctionName = import.meta.env.VITE_STAFF_ACCOUNT_FUNCTION_NAME || "manage-staff-account";
const payslipNotificationFunctionName = import.meta.env.VITE_PAYSLIP_NOTIFICATION_FUNCTION_NAME || "notify-payslip-available";
const staffPayPinFunctionName = import.meta.env.VITE_STAFF_PAY_PIN_FUNCTION_NAME || "manage-staff-pay-pin";
const financeInvoiceFunctionName = import.meta.env.VITE_FINANCE_INVOICE_FUNCTION_NAME || "send-finance-invoice";
const adminParentCreditFunctionName = import.meta.env.VITE_ADMIN_PARENT_CREDIT_FUNCTION_NAME || "admin-adjust-parent-credit";
const staffingNotificationFunctionName = import.meta.env.VITE_STAFFING_NOTIFICATION_FUNCTION_NAME || "notify-staffing-publication";
const staffPhotoBucket = "staff-profile-photos";
const staffHrFilesBucket = "staff-hr-files";

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export async function signInStaff(email, password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutStaff() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function fetchStaffingPlanner(dateFrom, dateTo) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_planner_for_range", {
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw error;
  const payload = data || {};
  return {
    sessions: payload.sessions || [],
    staff: payload.staff || [],
    availability: (payload.availability || []).map((row) => ({
      id: row.id,
      staffRecordId: row.staff_record_id,
      weekday: row.weekday,
      availableFrom: row.available_from,
      availableUntil: row.available_until,
      specificDate: row.specific_date,
      status: row.availability_status,
      preferredLocationIds: row.preferred_location_ids || [],
      maximumWeeklyMinutes: row.maximum_weekly_minutes,
      note: row.note || "",
      approvedAt: row.approved_at || "",
    })),
    absences: (payload.absences || []).map((row) => ({
      id: row.id,
      staffRecordId: row.staff_record_id,
      type: row.absence_type,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      note: row.note || "",
    })),
    publications: (payload.publications || []).map((row) => ({
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      version: row.version,
      status: row.status,
      warnings: row.warning_snapshot || [],
      overrideReason: row.override_reason || "",
      publishedAt: row.published_at || "",
      publishedBy: row.published_by || "",
    })),
    coverRequests: (payload.coverRequests || []).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      assignmentId: row.assignment_id,
      vacancies: Number(row.vacancies || 1),
      requiredRole: row.required_role || "assistant",
      requiredQualifications: row.required_qualifications || [],
      reason: row.reason || "Cover required",
      notes: row.notes || "",
      status: row.status || "open",
      requestedStaffIds: row.requested_staff_ids || [],
      viewedStaffIds: row.viewed_staff_ids || [],
      declinedStaffIds: row.declined_staff_ids || [],
      acceptedByStaffId: row.accepted_by_staff_id || "",
      createdAt: row.created_at || "",
    })),
    role: normalizeRole(payload.role),
    currentStaffId: payload.currentStaffId || "",
  };
}

export async function saveStaffingAssignment({
  sessionId,
  staffRecordId,
  sessionRole = "assistant",
  actingManager = false,
  actingDsl = false,
  actingSendco = false,
  overrideReason = "",
}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_save_assignment", {
    p_session_id: sessionId,
    p_staff_record_id: staffRecordId,
    p_session_role: sessionRole,
    p_acting_manager: actingManager,
    p_acting_dsl: actingDsl,
    p_acting_sendco: actingSendco,
    p_override_reason: overrideReason || null,
  });
  if (error) throw error;
  return data;
}

export async function removeStaffingAssignment(assignmentId, reason = "") {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_remove_assignment", {
    p_assignment_id: assignmentId,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data;
}

export async function publishStaffingRota({ dateFrom, dateTo, warnings = [], overrideReason = "" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_publish_rota", {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_warnings: warnings,
    p_override_reason: overrideReason || null,
  });
  if (error) throw error;
  return data;
}

export async function notifyStaffingPublication(publicationId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(staffingNotificationFunctionName, {
    body: { publicationId },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Rota published, but staff notifications could not be sent.");
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export async function acknowledgeStaffingAssignment(assignmentId, status = "acknowledged") {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_acknowledge_assignment", {
    p_assignment_id: assignmentId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

export async function saveOwnStaffingAvailability({ weekday, status, availableFrom = "", availableUntil = "", note = "" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("staffing_save_own_availability", {
    p_weekday: Number(weekday),
    p_status: status,
    p_available_from: availableFrom || null,
    p_available_until: availableUntil || null,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function saveStaffingSiteSettings(settings) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload = {
    location_id: settings.locationId,
    default_manager_staff_id: settings.defaultManagerStaffId || null,
    default_dsl_staff_id: settings.defaultDslStaffId || null,
    default_sendco_staff_id: settings.defaultSendcoStaffId || null,
    setup_minutes: Number(settings.setupMinutes ?? 15),
    closing_minutes: Number(settings.closingMinutes ?? 15),
    minimum_staff: Number(settings.minimumStaff ?? 2),
    children_per_staff: Number(settings.childrenPerStaff ?? 8),
    first_aider_required: settings.firstAiderRequired !== false,
    level3_required: settings.level3Required !== false,
    sendco_required: Boolean(settings.sendcoRequired),
    operational_notes: settings.operationalNotes || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("staffing_site_settings").upsert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function createStaffingCoverRequest(request) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    session_id: request.sessionId,
    assignment_id: request.assignmentId || null,
    vacancies: Number(request.vacancies || 1),
    required_role: request.requiredRole || "assistant",
    required_qualifications: request.requiredQualifications || [],
    reason: request.reason || "Cover required",
    notes: request.notes || null,
    status: request.requestedStaffIds?.length ? "requested" : "open",
    requested_staff_ids: request.requestedStaffIds || [],
    created_by: userData?.user?.id || null,
  };
  const { data, error } = await supabase.from("staffing_cover_requests").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function manageStaffPayPin(body) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(staffPayPinFunctionName, { body });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Unable to manage Pay privacy");
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export function getStaffPayPinStatus() {
  return manageStaffPayPin({ action: "status" });
}

export function setStaffPayPin(pin) {
  return manageStaffPayPin({ action: "set", pin });
}

export function verifyStaffPayPin(pin) {
  return manageStaffPayPin({ action: "verify", pin });
}

export function changeStaffPayPin(currentPin, newPin) {
  return manageStaffPayPin({ action: "change", currentPin, newPin });
}

export function resetStaffPayPin(password, newPin) {
  return manageStaffPayPin({ action: "reset", password, newPin });
}

export function removeStaffPayPin(password) {
  return manageStaffPayPin({ action: "remove", password });
}

export async function updateStaffPassword(password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  const userId = data?.user?.id || (await supabase.auth.getUser()).data?.user?.id;
  if (userId) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (profileError) throw profileError;
  }

  return data;
}

export async function getProfileRole(userId) {
  if (!supabase || !userId) return "Staff";
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeRole(data?.role);
}

export async function getProfileAccess(userId) {
  if (!supabase || !userId) return { role: "Staff", mustChangePassword: false, active: false, staffAccess: false };
  const { data, error } = await supabase
    .from("profiles")
    .select("role, active, must_change_password")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.active) return { role: "Staff", mustChangePassword: false, active: false, staffAccess: false };

  const storedRole = String(data.role || "").toLowerCase();
  const staffAccess = ["staff", "manager", "admin", "superadmin"].includes(storedRole);

  return {
    role: storedRole === "parent" ? "Parent" : normalizeRole(data.role),
    mustChangePassword: Boolean(data.must_change_password),
    active: true,
    staffAccess,
  };
}

export function normalizeRole(role) {
  const value = String(role || "staff").toLowerCase();
  if (value === "superadmin") return "Superadmin";
  if (value === "admin") return "Admin";
  if (value === "manager") return "Manager";
  return "Staff";
}

export async function fetchMigrationReviewFamilies() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("parent_accounts")
    .select(`
      id,
      profile_id,
      full_name,
      email,
      phone,
      billing_address,
      emergency_contact,
      marketing_preferences,
      portal_status,
      external_source,
      external_id,
      registered_centres,
      migration_metadata,
      created_at,
      updated_at,
      parent_account_credit_entries(
        id,
        entry_type,
        amount,
        currency,
        status,
        description,
        metadata,
        created_at,
        updated_at
      ),
      child_profiles(
        id,
        full_name,
        preferred_name,
        date_of_birth,
        school_name,
        year_group,
        medical_notes,
        allergy_notes,
        dietary_notes,
        authorised_collectors,
        consents,
        flags,
        active,
        external_source,
        external_id,
        migration_metadata,
        created_at,
        updated_at
      )
    `)
    .is("archived_at", null)
    .order("full_name", { ascending: true });

  if (error) throw error;
  return (data || []).map((family) => ({
    ...family,
    parent_account_credit_entries: [...(family.parent_account_credit_entries || [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    child_profiles: [...(family.child_profiles || [])].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
  }));
}

export async function adjustParentAccountCredit({ parentAccountId, amount, reason, note }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(adminParentCreditFunctionName, {
    body: { parentAccountId, amount, reason, note },
  });
  if (error) {
    let message = error.message || "The credit adjustment could not be saved.";
    try {
      const detail = await error.context?.json?.();
      if (detail?.error) message = detail.error;
    } catch {
      // Keep the function error when its response body is unavailable.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchMigrationHealthReviewItems() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("migration_health_review_items")
    .select("id,external_parent_id,external_child_id,parent_name,parent_email,child_name,item_type,item_name,expiry_date,status,detail,recommended_action,imported_child_profile_id,updated_at")
    .order("expiry_date", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function resolveMigrationHealthReviewItem({ itemId, itemName, expiryDate, confirmationMethod, notes = "" }) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("resolve_migration_health_review", {
    p_item_id: itemId,
    p_item_name: itemName,
    p_expiry_date: expiryDate,
    p_confirmation_method: confirmationMethod,
    p_notes: notes || null,
  });

  if (error) throw error;
  return data;
}

export async function fetchPlatformData({ userId, role }) {
  if (!supabase || !userId) throw new Error("Supabase is not configured.");

  const isStaff = normalizeRole(role) === "Staff";
  const canReadStaffProfileNotes = ["Admin", "Superadmin"].includes(normalizeRole(role));
  const staffQuery = supabase
    .from("staff_records")
    .select(`
      id,
      profile_id,
      preferred_name,
      date_of_birth,
      job_role,
      employment_type,
      start_date,
      contract_type,
      primary_site,
      pay_rate,
      annual_salary,
      photo_storage_path,
      photo_url,
      archived_at,
      leaving_reason,
      left_at,
      profiles!staff_records_profile_id_fkey(full_name, email, role),
      scr_checks(
        right_to_work,
        identity_checks,
        dbs,
        safeguarding,
        first_aid,
        annual_declarations,
        recruitment_checks,
        admin_review,
        updated_at
      )
    `)
    .order("created_at", { ascending: false });

  if (isStaff) staffQuery.eq("profile_id", userId);

  const sessionsQuery = supabase
    .from("sessions")
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      notes,
      programmes(name, locations(name)),
      session_assignments(staff_record_id, approved_hours)
    `)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(isStaff ? 12 : 30);

  const documentsQuery = supabase
    .from("document_versions")
    .select(`
      id,
      title,
      version,
      category,
      source_url,
      archived_at,
      document_assignments(id, acknowledged_at, due_at, staff_record_id)
    `)
    .is("archived_at", null)
    .limit(30);

  const documentChaseEventsQuery = normalizeRole(role) === "Staff"
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("document_chase_events")
        .select("id, document_version_id, actor_id, recipient_staff_record_ids, recipient_count, channel, message, metadata, created_at, profiles!document_chase_events_actor_id_fkey(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(120);

  const enquiriesQuery = isStaff
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("enquiries")
        .select("id, name, email, organisation, type, subject, message, status, owner_id, internal_notes, created_at")
        .order("created_at", { ascending: false })
        .limit(250);

  const hrFilesQuery = supabase
    .from("staff_hr_files")
    .select(`
      id,
      staff_record_id,
      title,
      storage_path,
      file_url,
      issue_date,
      expiry_date,
      status,
      notes,
      payslip_gross_pay,
      payslip_net_pay,
      payslip_process_date,
      payslip_pay_source,
      payslip_pay_verified_at,
      uploaded_at,
      hr_file_categories(id, name, sensitivity),
      staff_records!staff_hr_files_staff_record_id_fkey(preferred_name, profiles!staff_records_profile_id_fkey(full_name, email))
    `)
    .is("archived_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(isStaff ? 40 : 160);

  const hrCategoriesQuery = supabase
    .from("hr_file_categories")
    .select("id, name, sensitivity")
    .eq("active", true)
    .order("name", { ascending: true });

  const payrollHoursQuery = supabase
    .from("payroll_hour_records")
    .select(`
      id,
      payroll_period,
      school_name,
      status,
      submitted_at,
      updated_at,
      payroll_hour_rows(id, staff_record_id, staff_name, paid_hours, rate, notes)
    `)
    .order("payroll_period", { ascending: false });

  const payrollRunsQuery = supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_period,
      status,
      reviewed_at,
      approved_at,
      paid_at,
      updated_at,
      payroll_run_adjustments(id, staff_record_id, expenses, deductions, note)
    `)
    .order("payroll_period", { ascending: false });

  const payrollAuditQuery = normalizeRole(role) === "Staff"
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("payroll_audit_events")
        .select("id, payroll_period, school_name, action, detail, actor_id, metadata, created_at, profiles!payroll_audit_events_actor_id_fkey(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(120);

  const hrReportingQuery = isStaff
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("hr_reporting_lines")
        .select("id, staff_record_id, manager_staff_record_id, scope, effective_from, effective_to, changed_by, created_at")
        .is("effective_to", null);
  const staffProfileNotesQuery = canReadStaffProfileNotes
    ? supabase
        .from("staff_profile_notes")
        .select("staff_record_id, manager_notes, contract_notes, compliance_notes, payroll_notes, updated_at")
    : Promise.resolve({ data: [], error: null });
  const scrEvidenceRequestsQuery = supabase
    .from("scr_evidence_requests")
    .select(`
      id,
      staff_record_id,
      evidence_key,
      status,
      note,
      evidence_reference,
      evidence_expiry_date,
      submission_note,
      rejection_reason,
      requested_at,
      requested_by_name,
      submitted_at,
      submitted_by_name,
      resubmitted_at,
      reviewed_at,
      reviewed_by_name,
      cleared_at,
      cleared_by_name,
      history,
      updated_at
    `)
    .order("updated_at", { ascending: false });
  const suitabilityDeclarationsQuery = supabase
    .from("staff_suitability_declarations")
    .select(`
      id,
      staff_record_id,
      declaration_year,
      date_completed,
      staff_member_name,
      signed_by,
      status,
      next_due_date,
      confirmations,
      final_confirmation,
      completed_by,
      created_at,
      updated_at
    `)
    .order("date_completed", { ascending: false });
  const auditLogQuery = normalizeRole(role) === "Staff"
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("audit_log")
        .select("id, actor_id, action, table_name, record_id, metadata, created_at, profiles!audit_log_actor_id_fkey(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(200);

  const [staffResult, sessionsResult, documentsResult, documentChaseEventsResult, enquiriesResult, hrFilesResult, hrCategoriesResult, payrollHoursResult, payrollRunsResult, payrollAuditResult, hrReportingResult, staffProfileNotesResult, scrEvidenceRequestsResult, suitabilityDeclarationsResult, auditLogResult] = await Promise.all([
    staffQuery,
    sessionsQuery,
    documentsQuery,
    documentChaseEventsQuery,
    enquiriesQuery,
    hrFilesQuery,
    hrCategoriesQuery,
    payrollHoursQuery,
    payrollRunsQuery,
    payrollAuditQuery,
    hrReportingQuery,
    staffProfileNotesQuery,
    scrEvidenceRequestsQuery,
    suitabilityDeclarationsQuery,
    auditLogQuery,
  ]);

  if (staffResult.error) throw staffResult.error;

  const warnings = [
    ["Sessions", sessionsResult.error],
    ["Documents", documentsResult.error],
    ["Enquiries", enquiriesResult.error],
    ["HR files", hrFilesResult.error],
    ["HR file categories", hrCategoriesResult.error],
    ["Payroll hours", payrollHoursResult.error],
    ["Payroll runs", payrollRunsResult.error],
    ["Payroll audit", payrollAuditResult.error],
    ["HR hierarchy", hrReportingResult.error],
    ["Staff profile notes", staffProfileNotesResult.error?.code === "42P01" ? null : staffProfileNotesResult.error],
    ["SCR evidence requests", scrEvidenceRequestsResult.error],
    ["Annual suitability declarations", suitabilityDeclarationsResult.error?.code === "42P01" ? null : suitabilityDeclarationsResult.error],
    ["Audit log", auditLogResult.error],
  ]
    .filter(([, error]) => Boolean(error))
    .map(([label, error]) => `${label}: ${error.message || "Unable to load"}`);

  const staff = mapStaffRecords(staffResult.data || []);
  const declarationsByStaff = suitabilityDeclarationsResult.error ? {} : mapSuitabilityDeclarations(suitabilityDeclarationsResult.data || []);
  staff.forEach((person) => {
    person.suitabilityDeclarations = declarationsByStaff[person.id] || [];
  });
  await attachStaffPhotoUrls(staff);
  const hrFiles = hrFilesResult.error ? [] : mapHrFiles(hrFilesResult.data || []);
  await attachHrFileUrls(hrFiles);

  return {
    staff,
    sessions: mapSessions(sessionsResult.data || []),
    documents: mapDocuments(documentsResult.data || [], documentChaseEventsResult.error ? [] : documentChaseEventsResult.data || []),
    enquiries: mapEnquiries(enquiriesResult.data || []),
    hrFiles,
    hrFileCategories: hrCategoriesResult.error ? [] : hrCategoriesResult.data || [],
    payrollHours: payrollHoursResult.error ? {} : mapPayrollHours(payrollHoursResult.data || []),
    payrollRuns: payrollRunsResult.error ? {} : mapPayrollRuns(payrollRunsResult.data || []),
    payrollAudit: payrollAuditResult.error ? [] : mapPayrollAudit(payrollAuditResult.data || []),
    hrReportingLines: hrReportingResult.error ? {} : mapHrReportingLines(hrReportingResult.data || []),
    staffProfileNotes: staffProfileNotesResult.error ? {} : mapStaffProfileNotes(staffProfileNotesResult.data || []),
    scrRenewalRequests: scrEvidenceRequestsResult.error ? {} : mapScrEvidenceRequests(scrEvidenceRequestsResult.data || []),
    suitabilityDeclarations: suitabilityDeclarationsResult.error ? {} : declarationsByStaff,
    auditLog: auditLogResult.error ? [] : mapAuditLog(auditLogResult.data || []),
    warnings,
  };
}

export async function saveStaffSuitabilityDeclaration(staffRecordId, declaration) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member before saving the declaration.");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const completedDate = declaration.dateCompleted || new Date().toISOString().slice(0, 10);
  const payload = {
    staff_record_id: staffRecordId,
    declaration_year: Number(declaration.declarationYear || completedDate.slice(0, 4)),
    date_completed: completedDate,
    staff_member_name: declaration.staffMemberName || "",
    signed_by: declaration.signedBy || declaration.staffMemberName || "",
    status: declaration.status || "Completed",
    next_due_date: declaration.nextDueDate || addMonthsIso(completedDate, 12),
    confirmations: declaration.confirmations || {},
    final_confirmation: Boolean(declaration.finalConfirmation),
    completed_by: userData?.user?.id || null,
  };
  const { data, error } = await supabase
    .from("staff_suitability_declarations")
    .insert(payload)
    .select(`
      id,
      staff_record_id,
      declaration_year,
      date_completed,
      staff_member_name,
      signed_by,
      status,
      next_due_date,
      confirmations,
      final_confirmation,
      completed_by,
      created_at,
      updated_at
    `)
    .single();
  if (error) throw error;
  return mapSuitabilityDeclaration(data);
}

export async function createAuditLogEntry({ action, detail = "", metadata = {}, tableName = null, recordId = null }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const { data, error } = await supabase
    .from("audit_log")
    .insert({
      actor_id: userData?.user?.id || null,
      action,
      table_name: tableName,
      record_id: recordId,
      metadata: {
        ...metadata,
        detail,
        source: "Supabase",
      },
    })
    .select("id, actor_id, action, table_name, record_id, metadata, created_at, profiles!audit_log_actor_id_fkey(full_name, email)")
    .single();
  if (error) throw error;
  return mapAuditLog([data])[0];
}

export async function fetchPublicSettings() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "public_site")
    .maybeSingle();
  if (error) throw error;
  return data?.value || {};
}

export async function updatePublicSettings(settings) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const { data, error } = await supabase
    .from("platform_settings")
    .upsert({
      key: "public_site",
      value: settings,
      is_public: true,
      updated_by: userData?.user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" })
    .select("value")
    .single();
  if (error) throw error;
  return data?.value || settings;
}

function mapStaffRecords(records) {
  return records.map((record) => {
    const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
    const scr = Array.isArray(record.scr_checks) ? record.scr_checks[0] : record.scr_checks;
    return {
      id: record.id,
      profileId: record.profile_id,
      fullName: profile?.full_name || record.preferred_name || "Staff member",
      name: record.preferred_name || profile?.full_name || "Staff member",
      email: profile?.email || "",
      dateOfBirth: record.date_of_birth || "",
      accessRole: normalizeRole(profile?.role),
      role: record.job_role || profile?.role || "Staff",
      location: record.primary_site || record.employment_type || "Assigned sites",
      compliance: scr?.admin_review?.status || "Review needed",
      dbsNumber: scr?.dbs?.number || scr?.dbs?.dbsNumber || scr?.dbs?.dbs_number || scr?.dbs?.certificateNo || scr?.dbs?.certificate_no || "",
      dbsRenewal: scr?.dbs?.renewalDate || scr?.dbs?.renewal_date || "Not recorded",
      safeguardingExpiry: scr?.safeguarding?.expiryDate || scr?.safeguarding?.expiry_date || "Not recorded",
      allergyAwarenessExpiry: scr?.admin_review?.allergy?.expiryDate || scr?.admin_review?.allergy?.expiry_date || "Not recorded",
      firstAidExpiry: scr?.first_aid?.expiryDate || scr?.first_aid?.expiry_date || "Not required",
      eyfsLevel: scr?.recruitment_checks?.eyfsLevel || scr?.recruitment_checks?.eyfs_level || scr?.admin_review?.qualifications?.eyfsLevel || "",
      scrChecklist: mapScrChecklist(scr),
      payRate: Number(record.pay_rate || 0),
      annualSalary: Number(record.annual_salary || 0),
      contractType: record.contract_type || record.employment_type || "Not recorded",
      photoStoragePath: record.photo_storage_path || "",
      photoUrl: record.photo_url || "",
      archivedAt: record.archived_at || "",
      leavingReason: record.leaving_reason || "",
      leftAt: record.left_at || "",
      formerRecord: record.archived_at || record.left_at ? {
        id: record.id,
        staffRecordId: record.id,
        userId: record.profile_id,
        name: record.preferred_name || profile?.full_name || "Staff member",
        email: profile?.email || "",
        role: record.job_role || profile?.role || "Staff",
        scope: record.primary_site || record.employment_type || "Assigned sites",
        reason: record.leaving_reason || "Not recorded",
        dismissedAt: record.left_at || record.archived_at,
      } : null,
    };
  });
}

function mapScrChecklist(scr = {}) {
  const adminReview = scr?.admin_review || {};
  const checklist = adminReview.checklist || {};
  const evidence = {
    ...(checklist.evidence || {}),
    ...(adminReview.evidence || {}),
  };
  const dbsEvidence = {
    ...(scr?.dbs || {}),
    ...(evidence.dbs || {}),
  };
  evidence.dbs = dbsEvidence;
  const safeguardingEvidence = evidence.safeguarding || {};
  const firstAidEvidence = evidence.firstAid || {};
  const dbsNumber = dbsEvidence.number
    || dbsEvidence.dbsNumber
    || dbsEvidence.dbs_number
    || dbsEvidence.certificateNo
    || dbsEvidence.certificate_no
    || scr?.dbs?.number
    || scr?.dbs?.dbsNumber
    || scr?.dbs?.dbs_number
    || scr?.dbs?.certificateNo
    || scr?.dbs?.certificate_no
    || "";
  return {
    ...checklist,
    evidence,
    note: checklist.note || adminReview.note || "",
    approvedAt: checklist.approvedAt || adminReview.approvedAt || adminReview.approved_at || "",
    approvedBy: checklist.approvedBy || adminReview.approvedBy || adminReview.approved_by || "",
    rightToWork: checklist.rightToWork ?? Boolean(Object.keys(scr?.right_to_work || {}).length),
    identity: checklist.identity ?? Boolean(Object.keys(scr?.identity_checks || {}).length),
    dbs: checklist.dbs ?? Boolean(dbsEvidence.reference || dbsNumber || scr?.dbs?.status),
    dbsNumber,
    barredList: checklist.barredList ?? Boolean(scr?.dbs?.barredList || scr?.dbs?.barred_list),
    safeguarding: checklist.safeguarding ?? Boolean(safeguardingEvidence.reference || scr?.safeguarding?.completedAt || scr?.safeguarding?.completed_at),
    allergy: checklist.allergy ?? Boolean(evidence.allergy?.reference || adminReview.allergy?.completedAt || adminReview.allergy?.completed_at),
    firstAid: checklist.firstAid ?? Boolean(firstAidEvidence.reference || scr?.first_aid?.qualification),
    references: checklist.references ?? Boolean(scr?.recruitment_checks?.references || scr?.recruitment_checks?.referencesStatus),
    declarations: checklist.declarations ?? Boolean(scr?.annual_declarations?.annualDeclarationDate || scr?.annual_declarations?.status),
    updatedAt: checklist.updatedAt || scr?.updated_at || "",
  };
}

function mapScrEvidenceRequests(records) {
  return records.reduce((requests, record) => {
    if (!record.id) return requests;
    requests[record.id] = {
      status: record.status || "Requested",
      staffRecordId: record.staff_record_id,
      evidenceKey: record.evidence_key,
      note: record.note || "",
      evidenceReference: record.evidence_reference || "",
      evidenceExpiryDate: record.evidence_expiry_date || "",
      submissionNote: record.submission_note || "",
      rejectionReason: record.rejection_reason || "",
      requestedAt: record.requested_at || "",
      requestedBy: record.requested_by_name || "Admin",
      submittedAt: record.submitted_at || "",
      submittedBy: record.submitted_by_name || "",
      resubmittedAt: record.resubmitted_at || "",
      reviewedAt: record.reviewed_at || "",
      reviewedBy: record.reviewed_by_name || "",
      clearedAt: record.cleared_at || "",
      clearedBy: record.cleared_by_name || "",
      history: Array.isArray(record.history) ? record.history : [],
      source: "supabase",
      updatedAt: record.updated_at || "",
    };
    return requests;
  }, {});
}

function mapAuditLog(records) {
  return records.map((record) => {
    const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
    return {
      id: `supabase-${record.id}`,
      action: record.action || "Admin action",
      detail: record.metadata?.detail || record.metadata?.summary || record.table_name || "No extra detail recorded.",
      source: "Supabase",
      actor: profile?.full_name || profile?.email || "Admin",
      tableName: record.table_name || "",
      recordId: record.record_id || "",
      metadata: record.metadata || {},
      createdAt: record.created_at || "",
    };
  });
}

function mapStaffProfileNotes(records) {
  return records.reduce((notes, record) => {
    if (!record.staff_record_id) return notes;
    notes[record.staff_record_id] = {
      manager: record.manager_notes || "",
      contract: record.contract_notes || "",
      compliance: record.compliance_notes || "",
      payroll: record.payroll_notes || "",
      updatedAt: record.updated_at || "",
      source: "supabase",
    };
    return notes;
  }, {});
}

function mapSuitabilityDeclaration(record = {}) {
  return {
    id: record.id,
    staffRecordId: record.staff_record_id,
    declarationYear: Number(record.declaration_year || 0),
    dateCompleted: record.date_completed || "",
    staffMemberName: record.staff_member_name || "",
    signedBy: record.signed_by || "",
    status: record.status || "Completed",
    nextDueDate: record.next_due_date || "",
    confirmations: record.confirmations || {},
    finalConfirmation: Boolean(record.final_confirmation),
    completedBy: record.completed_by || "",
    createdAt: record.created_at || "",
    updatedAt: record.updated_at || "",
    source: "supabase",
  };
}

function mapSuitabilityDeclarations(records) {
  return records.reduce((groups, record) => {
    if (!record.staff_record_id) return groups;
    groups[record.staff_record_id] ||= [];
    groups[record.staff_record_id].push(mapSuitabilityDeclaration(record));
    return groups;
  }, {});
}

function addMonthsIso(dateString, months) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function attachStaffPhotoUrls(staff) {
  if (!supabase) return staff;
  await Promise.all(staff.map(async (person) => {
    if (!person.photoStoragePath || person.photoUrl) return;
    const { data, error } = await supabase
      .storage
      .from(staffPhotoBucket)
      .createSignedUrl(person.photoStoragePath, 60 * 60);
    if (!error && data?.signedUrl) person.photoUrl = data.signedUrl;
  }));
}

function mapHrFiles(records) {
  return records.map((record) => {
    const category = Array.isArray(record.hr_file_categories) ? record.hr_file_categories[0] : record.hr_file_categories;
    const staffRecord = Array.isArray(record.staff_records) ? record.staff_records[0] : record.staff_records;
    const profile = Array.isArray(staffRecord?.profiles) ? staffRecord.profiles[0] : staffRecord?.profiles;
    return {
      id: record.id,
      staffRecordId: record.staff_record_id,
      staffName: staffRecord?.preferred_name || profile?.full_name || "Staff member",
      staffEmail: profile?.email || "",
      categoryId: category?.id || "",
      category: category?.name || "HR file",
      sensitivity: category?.sensitivity || "confidential",
      title: record.title,
      fileUrl: record.file_url || "",
      storagePath: record.storage_path || "",
      issueDate: record.issue_date || "",
      expiryDate: record.expiry_date || "",
      status: record.status || "active",
      notes: record.notes || "",
      payslipGrossPay: record.payslip_gross_pay == null ? null : Number(record.payslip_gross_pay),
      payslipNetPay: record.payslip_net_pay == null ? null : Number(record.payslip_net_pay),
      payslipProcessDate: record.payslip_process_date || "",
      payslipPaySource: record.payslip_pay_source || "",
      payslipPayVerifiedAt: record.payslip_pay_verified_at || "",
      uploadedAt: record.uploaded_at || "",
    };
  });
}

async function attachHrFileUrls(files) {
  if (!supabase) return files;
  await Promise.all(files.map(async (file) => {
    if (!file.storagePath || file.fileUrl) return;
    const { data, error } = await supabase
      .storage
      .from(staffHrFilesBucket)
      .createSignedUrl(file.storagePath, 60 * 60);
    if (!error && data?.signedUrl) file.fileUrl = data.signedUrl;
  }));
  return files;
}

function mapSessions(records) {
  return records.map((record) => {
    const programme = Array.isArray(record.programmes) ? record.programmes[0] : record.programmes;
    const location = Array.isArray(programme?.locations) ? programme.locations[0] : programme?.locations;
    return {
      id: record.id,
      site: location?.name || "Site TBC",
      programme: programme?.name || "Session",
      date: formatSessionDate(record.starts_at),
      time: formatSessionTime(record.starts_at, record.ends_at),
      staff: `${record.session_assignments?.length || 0} assigned`,
      status: record.status || "Planning",
    };
  });
}

function mapDocuments(records, chaseEvents = []) {
  const chasesByDocument = chaseEvents.reduce((groups, event) => {
    const documentId = event.document_version_id;
    if (!documentId) return groups;
    groups[documentId] ||= [];
    groups[documentId].push(event);
    return groups;
  }, {});
  return records.map((record) => {
    const assignments = record.document_assignments || [];
    const chaseLog = (chasesByDocument[record.id] || []).map((event) => {
      const profile = Array.isArray(event.profiles) ? event.profiles[0] : event.profiles;
      return {
        id: event.id,
        documentVersionId: event.document_version_id,
        actorId: event.actor_id || "",
        actor: profile?.full_name || profile?.email || "Admin",
        actorEmail: profile?.email || "",
        recipientStaffRecordIds: event.recipient_staff_record_ids || [],
        recipientCount: Number(event.recipient_count || 0),
        channel: event.channel || "manual",
        message: event.message || "",
        metadata: event.metadata || {},
        createdAt: event.created_at || "",
      };
    });
    const read = assignments.filter((assignment) => assignment.acknowledged_at).length;
    const assigned = assignments.length;
    return {
      id: record.id,
      name: record.title,
      category: record.category || "Policy",
      version: record.version,
      url: record.source_url || "",
      assigned,
      read,
      missing: Math.max(0, assigned - read),
      linked: Boolean(record.source_url),
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        staffRecordId: assignment.staff_record_id,
        acknowledgedAt: assignment.acknowledged_at || "",
        dueAt: assignment.due_at || "",
      })),
      chaseLog,
      status: assigned && read < assigned ? `Chase ${assigned - read}` : "Complete",
    };
  });
}

function mapEnquiries(records) {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    email: record.email,
    type: record.type,
    organisation: record.organisation,
    subject: record.subject || "",
    message: record.message || "",
    status: formatCrmStatus(record.status),
    owner: parseInternalNotes(record.internal_notes).owner || (record.owner_id ? "Assigned" : "Unassigned"),
    note: parseInternalNotes(record.internal_notes).note || "",
    nextAction: parseInternalNotes(record.internal_notes).nextAction || "call/email follow-up",
    createdAt: record.created_at || "",
    source: "supabase",
  }));
}

function mapPayrollHours(records) {
  return records.reduce((periods, record) => {
    const period = record.payroll_period;
    const school = record.school_name;
    if (!period || !school) return periods;
    periods[period] ||= {};
    periods[period][school] = {
      id: record.id,
      status: record.status || "Draft",
      submittedAt: record.submitted_at || "",
      updatedAt: record.updated_at || "",
      source: "supabase",
      rows: (record.payroll_hour_rows || []).map((row) => ({
        id: row.id,
        staffId: row.staff_record_id,
        staffName: row.staff_name || "",
        hours: Number(row.paid_hours || 0),
        rate: Number(row.rate || 0),
        notes: row.notes || "",
      })),
    };
    return periods;
  }, {});
}

function mapPayrollRuns(records) {
  return records.reduce((runs, record) => {
    runs[record.payroll_period] = {
      id: record.id,
      status: record.status || "Draft",
      reviewedAt: record.reviewed_at || "",
      approvedAt: record.approved_at || "",
      paidAt: record.paid_at || "",
      updatedAt: record.updated_at || "",
      source: "supabase",
      adjustments: (record.payroll_run_adjustments || []).reduce((items, adjustment) => {
        items[adjustment.staff_record_id] = {
          id: adjustment.id,
          expenses: Number(adjustment.expenses || 0),
          deductions: Number(adjustment.deductions || 0),
          note: adjustment.note || "",
        };
        return items;
      }, {}),
    };
    return runs;
  }, {});
}

function mapHrReportingLines(records) {
  return records.reduce((lines, record) => {
    if (!record.staff_record_id) return lines;
    lines[record.staff_record_id] = {
      id: record.id,
      staffRecordId: record.staff_record_id,
      managerStaffRecordId: record.manager_staff_record_id || "",
      scope: record.scope || "",
      effectiveFrom: record.effective_from || "",
      effectiveTo: record.effective_to || "",
      changedBy: record.changed_by || "",
      createdAt: record.created_at || "",
    };
    return lines;
  }, {});
}

function mapPayrollAudit(records) {
  return records.map((record) => {
    const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
    return {
      id: record.id,
      period: record.payroll_period,
      school: record.school_name || "",
      action: record.action,
      detail: record.detail || "",
      actor: profile?.full_name || profile?.email || "Admin",
      actorEmail: profile?.email || "",
      createdAt: record.created_at,
      metadata: record.metadata || {},
    };
  });
}

function isUuid(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ""));
}

async function recordPayrollAudit({ period, school = null, action, detail = "", metadata = {}, actorId = null }) {
  if (!supabase || !period || !action) return;
  const { error } = await supabase
    .from("payroll_audit_events")
    .insert({
      payroll_period: period,
      school_name: school,
      action,
      detail,
      actor_id: actorId,
      metadata,
    });
  if (error) {
    console.warn("Payroll audit event failed", error);
  }
}

export async function savePayrollHourRecord({ period, school, record, action = "Payroll hours updated" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!period || !school) throw new Error("Choose a payroll month and school.");

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData?.user?.id || null;
  const status = record?.status || "Draft";
  const isSubmitted = status === "Submitted";

  const { data: savedRecord, error: recordError } = await supabase
    .from("payroll_hour_records")
    .upsert({
      payroll_period: period,
      school_name: school,
      status,
      submitted_at: isSubmitted ? (record.submittedAt || new Date().toISOString()) : null,
      submitted_by: isSubmitted ? userId : null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "payroll_period,school_name" })
    .select("id, payroll_period, school_name, status, submitted_at, updated_at")
    .single();

  if (recordError) throw recordError;

  const rows = (record?.rows || []).filter((row) => isUuid(row.staffId));
  const { error: deleteError } = await supabase
    .from("payroll_hour_rows")
    .delete()
    .eq("payroll_hour_record_id", savedRecord.id);
  if (deleteError) throw deleteError;

  if (rows.length) {
    const { error: rowsError } = await supabase
      .from("payroll_hour_rows")
      .insert(rows.map((row) => ({
        payroll_hour_record_id: savedRecord.id,
        staff_record_id: row.staffId,
        staff_name: row.staffName || null,
        paid_hours: Number(row.hours || 0),
        rate: Number(row.rate || 0),
        notes: row.notes || null,
      })));
    if (rowsError) throw rowsError;
  }

  await recordPayrollAudit({
    period,
    school,
    action,
    detail: `${school} · ${rows.length} staff · ${rows.reduce((sum, row) => sum + Number(row.hours || 0), 0).toFixed(2)} hours`,
    actorId: userId,
    metadata: {
      status,
      staffCount: rows.length,
      totalHours: rows.reduce((sum, row) => sum + Number(row.hours || 0), 0),
    },
  });

  return {
    id: savedRecord.id,
    status: savedRecord.status,
    submittedAt: savedRecord.submitted_at || "",
    updatedAt: savedRecord.updated_at || "",
    source: "supabase",
    rows: rows.map((row) => ({ ...row, hours: Number(row.hours || 0), rate: Number(row.rate || 0) })),
  };
}

export async function savePayrollRun({ period, run, action = "Payroll run updated" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!period) throw new Error("Choose a payroll month.");

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData?.user?.id || null;
  const now = new Date().toISOString();
  const status = run?.status || "Draft";

  const { data: savedRun, error: runError } = await supabase
    .from("payroll_runs")
    .upsert({
      payroll_period: period,
      status,
      reviewed_at: run.reviewedAt || run.reviewed_at || (status === "Reviewed" ? now : null),
      reviewed_by: status === "Reviewed" ? userId : null,
      approved_at: run.approvedAt || run.approved_at || (status === "Approved" ? now : null),
      approved_by: status === "Approved" ? userId : null,
      paid_at: run.paidAt || run.paid_at || (status === "Paid" ? now : null),
      paid_by: status === "Paid" ? userId : null,
      updated_by: userId,
      updated_at: now,
    }, { onConflict: "payroll_period" })
    .select("id, payroll_period, status, reviewed_at, approved_at, paid_at, updated_at")
    .single();

  if (runError) throw runError;

  const adjustmentEntries = Object.entries(run?.adjustments || {}).filter(([staffId]) => isUuid(staffId));
  const { error: deleteError } = await supabase
    .from("payroll_run_adjustments")
    .delete()
    .eq("payroll_run_id", savedRun.id);
  if (deleteError) throw deleteError;

  if (adjustmentEntries.length) {
    const { error: adjustmentsError } = await supabase
      .from("payroll_run_adjustments")
      .insert(adjustmentEntries.map(([staffId, adjustment]) => ({
        payroll_run_id: savedRun.id,
        staff_record_id: staffId,
        expenses: Number(adjustment.expenses || 0),
        deductions: Number(adjustment.deductions || 0),
        note: adjustment.note || null,
      })));
    if (adjustmentsError) throw adjustmentsError;
  }

  await recordPayrollAudit({
    period,
    action,
    detail: `${status} · ${adjustmentEntries.length} adjustment${adjustmentEntries.length === 1 ? "" : "s"}`,
    actorId: userId,
    metadata: {
      status,
      adjustmentCount: adjustmentEntries.length,
    },
  });

  return {
    id: savedRun.id,
    status: savedRun.status,
    reviewedAt: savedRun.reviewed_at || "",
    approvedAt: savedRun.approved_at || "",
    paidAt: savedRun.paid_at || "",
    updatedAt: savedRun.updated_at || "",
    source: "supabase",
    adjustments: run?.adjustments || {},
  };
}

export async function updateCrmEnquiry(id, patch) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const payload = {};

  if (patch.status) payload.status = normalizeCrmStatus(patch.status);
  if ("owner" in patch || "note" in patch || "nextAction" in patch) {
    payload.internal_notes = JSON.stringify({
      owner: patch.owner,
      note: patch.note,
      nextAction: patch.nextAction,
      updatedAt: new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from("enquiries")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
  return { id, ...patch };
}

export async function updateDocumentSourceUrl(id, sourceUrl) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("document_versions")
    .update({ source_url: sourceUrl || null })
    .eq("id", id);
  if (error) throw error;
  return { id, sourceUrl };
}

export async function acknowledgeDocumentAssignment({ documentVersionId, staffRecordId }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!documentVersionId || !staffRecordId) throw new Error("Document assignment not found.");
  const acknowledgedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("document_assignments")
    .update({ acknowledged_at: acknowledgedAt })
    .eq("document_version_id", documentVersionId)
    .eq("staff_record_id", staffRecordId)
    .select("id, document_version_id, staff_record_id, acknowledged_at")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    documentVersionId: data.document_version_id,
    staffRecordId: data.staff_record_id,
    acknowledgedAt: data.acknowledged_at || acknowledgedAt,
  };
}

export async function recordDocumentChase({ documentVersionId, recipientStaffRecordIds = [], channel = "manual", message = "", metadata = {} }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!documentVersionId) throw new Error("Choose a policy to chase.");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const actorId = userData?.user?.id || null;
  const recipientIds = Array.from(new Set((recipientStaffRecordIds || []).filter(Boolean)));
  const { data, error } = await supabase
    .from("document_chase_events")
    .insert({
      document_version_id: documentVersionId,
      actor_id: actorId,
      recipient_staff_record_ids: recipientIds,
      recipient_count: recipientIds.length,
      channel,
      message,
      metadata,
    })
    .select("id, document_version_id, actor_id, recipient_staff_record_ids, recipient_count, channel, message, metadata, created_at")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    documentVersionId: data.document_version_id,
    actorId: data.actor_id || actorId,
    actor: "You",
    actorEmail: "",
    recipientStaffRecordIds: data.recipient_staff_record_ids || recipientIds,
    recipientCount: Number(data.recipient_count || recipientIds.length),
    channel: data.channel || channel,
    message: data.message || message,
    metadata: data.metadata || metadata,
    createdAt: data.created_at || new Date().toISOString(),
  };
}

export async function createHrFile(payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("staff_hr_files")
    .insert({
      staff_record_id: payload.staffRecordId,
      category_id: payload.categoryId || null,
      title: payload.title,
      file_url: payload.fileUrl || null,
      storage_path: payload.storagePath || null,
      issue_date: payload.issueDate || null,
      expiry_date: payload.expiryDate || null,
      status: payload.status || "active",
      notes: payload.notes || null,
      payslip_gross_pay: payload.payslipGrossPay ?? null,
      payslip_net_pay: payload.payslipNetPay ?? null,
      payslip_process_date: payload.payslipProcessDate || null,
      payslip_pay_source: payload.payslipPaySource || null,
      payslip_pay_verified_at: payload.payslipPayVerifiedAt || null,
    })
    .select(`
      id,
      staff_record_id,
      title,
      storage_path,
      file_url,
      issue_date,
      expiry_date,
      status,
      notes,
      payslip_gross_pay,
      payslip_net_pay,
      payslip_process_date,
      payslip_pay_source,
      payslip_pay_verified_at,
      uploaded_at,
      hr_file_categories(id, name, sensitivity),
      staff_records!staff_hr_files_staff_record_id_fkey(preferred_name, profiles!staff_records_profile_id_fkey(full_name, email))
    `)
    .single();

  if (error) throw error;
  const [file] = mapHrFiles([data]);
  await attachHrFileUrls([file]);
  return file;
}

async function extractPayslipPayData(file) {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items || []) {
      const text = String(item.str || "").trim();
      if (!text) continue;
      const y = Math.round(Number(item.transform?.[5] || 0));
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    }
    for (const [, items] of Array.from(rows.entries()).sort((left, right) => right[0] - left[0])) {
      lines.push(items
        .sort((left, right) => Number(left.transform?.[4] || 0) - Number(right.transform?.[4] || 0))
        .map((item) => String(item.str || "").trim())
        .filter(Boolean)
        .join(" "));
    }
  }

  const text = lines.join("\n");
  const grossMatch = text.match(/Total\s+Gross\s+Pay\s+(-?[\d,]+\.\d{2})/i);
  let netMatch = text.match(/Net\s+Pay\s+(-?[\d,]+\.\d{2})/i);
  if (!netMatch) {
    const netLineIndex = lines.findIndex((line) => /Net\s+Pay/i.test(line));
    const nearbyValues = netLineIndex >= 0
      ? [lines[netLineIndex], lines[netLineIndex - 1], lines[netLineIndex + 1]]
          .filter(Boolean)
          .join(" ")
          .match(/-?[\d,]+\.\d{2}/g) || []
      : [];
    if (nearbyValues.length) netMatch = [nearbyValues.at(-1), nearbyValues.at(-1)];
  }
  const processDateMatch = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  if (!grossMatch || !netMatch) {
    throw new Error("The payslip was not uploaded because its Total Gross Pay and Net Pay could not be read. Check that this is a standard payroll payslip PDF.");
  }

  return {
    payslipGrossPay: Number(grossMatch[1].replace(/,/g, "")),
    payslipNetPay: Number(netMatch[1].replace(/,/g, "")),
    payslipProcessDate: processDateMatch
      ? `${processDateMatch[3]}-${processDateMatch[2]}-${processDateMatch[1]}`
      : "",
    payslipPaySource: "pdf_text",
    payslipPayVerifiedAt: new Date().toISOString(),
  };
}

export async function uploadHrFile(payload, file) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!payload?.staffRecordId || !file) throw new Error("Choose a staff member and file.");

  const extension = file.name?.split(".").pop()?.toLowerCase() || "pdf";
  const safeExtension = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "webp"].includes(extension) ? extension : "pdf";
  const isPayslip = /payslip/i.test(String(payload.category || ""));
  const payslipPayData = isPayslip ? await extractPayslipPayData(file) : {};
  const expectedPeriod = String(payload.issueDate || "").slice(0, 7);
  const processPeriod = String(payslipPayData.payslipProcessDate || "").slice(0, 7);
  if (isPayslip && expectedPeriod && processPeriod && expectedPeriod !== processPeriod) {
    throw new Error(`This payslip is dated ${processPeriod}, not ${expectedPeriod}. Choose the matching payroll month before uploading it.`);
  }
  const contentTypes = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const storagePath = `${payload.staffRecordId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`;
  const { error: uploadError } = await supabase
    .storage
    .from(staffHrFilesBucket)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || contentTypes[safeExtension] || "application/pdf",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  let saved;
  try {
    saved = await createHrFile({
      ...payload,
      ...payslipPayData,
      storagePath,
      fileUrl: "",
    });
  } catch (error) {
    await supabase.storage.from(staffHrFilesBucket).remove([storagePath]);
    throw error;
  }

  if (isPayslip) {
    try {
      saved.payslipNotification = await notifyPayslipAvailable(saved.id);
    } catch (error) {
      saved.payslipNotification = {
        emailed: false,
        emailError: error.message || "Payslip notification failed.",
      };
    }
  }
  return saved;
}

export async function notifyPayslipAvailable(hrFileId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!hrFileId) throw new Error("Choose a payslip.");

  const { data, error } = await supabase.functions.invoke(payslipNotificationFunctionName, {
    body: { hrFileId },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Payslip notification failed.");
  }
  return data;
}

export async function checkHrFileStorageHealth() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error: categoryError } = await supabase
    .from("hr_file_categories")
    .select("id")
    .limit(1);
  if (categoryError) throw categoryError;

  const { error: listError } = await supabase
    .storage
    .from(staffHrFilesBucket)
    .list("", { limit: 1 });
  if (listError) throw listError;

  return { ok: true, bucket: staffHrFilesBucket };
}

export async function archiveHrFile(id) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("staff_hr_files")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
  return { id };
}

export async function uploadStaffProfilePhoto(staffRecordId, file) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId || !file) throw new Error("Choose a staff member and image file.");

  const extension = file.name?.split(".").pop()?.toLowerCase() || "jpg";
  const safeExtension = ["jpg", "jpeg", "png", "webp"].includes(extension) ? extension : "jpg";
  const storagePath = `${staffRecordId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`;
  const { error: uploadError } = await supabase
    .storage
    .from(staffPhotoBucket)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("staff_records")
    .update({ photo_storage_path: storagePath, photo_url: null })
    .eq("id", staffRecordId);
  if (updateError) throw updateError;

  const { data, error: signedUrlError } = await supabase
    .storage
    .from(staffPhotoBucket)
    .createSignedUrl(storagePath, 60 * 60);
  if (signedUrlError) throw signedUrlError;

  return {
    staffRecordId,
    photoStoragePath: storagePath,
    photoUrl: data?.signedUrl || "",
  };
}

export async function updateStaffPayDetails(staffRecordId, details = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const payRate = Number(details.payRate || 0);
  const annualSalary = Number(details.annualSalary || 0);
  const contractType = details.contractType || null;

  const { data, error } = await supabase
    .from("staff_records")
    .update({
      pay_rate: payRate || null,
      annual_salary: annualSalary || null,
      contract_type: contractType,
    })
    .eq("id", staffRecordId)
    .select("id, pay_rate, annual_salary, contract_type")
    .single();

  if (error) throw error;

  const { error: payDetailError } = await supabase
    .from("staff_pay_details")
    .upsert({
      staff_record_id: staffRecordId,
      hourly_rate: payRate || null,
      annual_salary: annualSalary || null,
      contract_type: contractType,
      updated_at: new Date().toISOString(),
    }, { onConflict: "staff_record_id" });

  if (payDetailError) {
    console.warn("Unable to mirror staff pay details", payDetailError);
  }

  return {
    staffRecordId: data.id,
    payRate: Number(data.pay_rate || 0),
    annualSalary: Number(data.annual_salary || 0),
    contractType: data.contract_type || "",
  };
}

export async function updateStaffSiteDetails(staffRecordId, location) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");
  const primarySite = String(location || "").trim() || null;

  const { data, error } = await supabase
    .from("staff_records")
    .update({ primary_site: primarySite })
    .eq("id", staffRecordId)
    .select("id, primary_site")
    .single();

  if (error) throw error;

  return {
    staffRecordId: data.id,
    location: data.primary_site || "",
  };
}

export async function updateHrReportingLine({ staffRecordId, managerStaffRecordId = "", scope = "" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const { data: authData } = await supabase.auth.getUser();
  const payload = {
    staff_record_id: staffRecordId,
    manager_staff_record_id: managerStaffRecordId || null,
    scope: String(scope || "").trim() || "Organisation-wide",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: null,
    changed_by: authData?.user?.id || null,
  };

  const { data: existing, error: lookupError } = await supabase
    .from("hr_reporting_lines")
    .select("id")
    .eq("staff_record_id", staffRecordId)
    .is("effective_to", null)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const query = existing?.id
    ? supabase.from("hr_reporting_lines").update(payload).eq("id", existing.id).select("id, staff_record_id, manager_staff_record_id, scope").single()
    : supabase.from("hr_reporting_lines").insert(payload).select("id, staff_record_id, manager_staff_record_id, scope").single();

  const { data, error } = await query;
  if (error) throw error;

  return {
    id: data.id,
    staffRecordId: data.staff_record_id,
    managerStaffRecordId: data.manager_staff_record_id || "",
    scope: data.scope || "",
  };
}

export async function saveStaffProfileNotes(staffRecordId, notes = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const { data: authData } = await supabase.auth.getUser();
  const payload = {
    staff_record_id: staffRecordId,
    manager_notes: notes.manager || null,
    contract_notes: notes.contract || null,
    compliance_notes: notes.compliance || null,
    payroll_notes: notes.payroll || null,
    updated_by: authData?.user?.id || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("staff_profile_notes")
    .upsert(payload, { onConflict: "staff_record_id" })
    .select("staff_record_id, manager_notes, contract_notes, compliance_notes, payroll_notes, updated_at")
    .single();

  if (error) throw error;

  return {
    staffRecordId: data.staff_record_id,
    manager: data.manager_notes || "",
    contract: data.contract_notes || "",
    compliance: data.compliance_notes || "",
    payroll: data.payroll_notes || "",
    updatedAt: data.updated_at || payload.updated_at,
    source: "supabase",
  };
}

export async function dismissStaffRecord({ staffRecordId, reason = "" }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const dismissedAt = new Date().toISOString();
  const { data: authData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("staff_records")
    .update({
      archived_at: dismissedAt,
      left_at: dismissedAt,
      leaving_reason: String(reason || "").trim() || "Not recorded",
      archived_by: authData?.user?.id || null,
    })
    .eq("id", staffRecordId)
    .select("id, archived_at, left_at, leaving_reason")
    .single();

  if (error) throw error;

  const { error: reportingError } = await supabase
    .from("hr_reporting_lines")
    .update({ archived_at: dismissedAt, effective_to: dismissedAt.slice(0, 10) })
    .eq("staff_record_id", staffRecordId)
    .is("effective_to", null);

  if (reportingError) console.warn("Unable to archive HR reporting line", reportingError);

  return {
    staffRecordId: data.id,
    reason: data.leaving_reason || "",
    dismissedAt: data.left_at || data.archived_at || dismissedAt,
  };
}

export async function restoreStaffRecord(staffRecordId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const { data, error } = await supabase
    .from("staff_records")
    .update({
      archived_at: null,
      left_at: null,
      leaving_reason: null,
      archived_by: null,
    })
    .eq("id", staffRecordId)
    .select("id")
    .single();

  if (error) throw error;
  return { staffRecordId: data.id };
}

function scrChecklistPayload(checklist = {}) {
  const evidence = checklist.evidence || {};
  return {
    right_to_work: {
      checked: Boolean(checklist.rightToWork),
      ...(evidence.rightToWork || {}),
    },
    identity_checks: {
      checked: Boolean(checklist.identity),
      ...(evidence.identity || {}),
    },
    dbs: {
      checked: Boolean(checklist.dbs),
      renewalDate: evidence.dbs?.expiryDate || "",
      ...(evidence.dbs || {}),
      barredList: Boolean(checklist.barredList),
    },
    safeguarding: {
      checked: Boolean(checklist.safeguarding),
      expiryDate: evidence.safeguarding?.expiryDate || "",
      ...(evidence.safeguarding || {}),
    },
    first_aid: {
      checked: Boolean(checklist.firstAid),
      expiryDate: evidence.firstAid?.expiryDate || "",
      ...(evidence.firstAid || {}),
    },
    annual_declarations: {
      checked: Boolean(checklist.declarations),
      ...(evidence.declarations || {}),
    },
    recruitment_checks: {
      references: Boolean(checklist.references),
      ...(evidence.references || {}),
    },
    admin_review: {
      status: checklist.approvedAt ? "Compliant" : "Review needed",
      checklist,
      evidence,
      allergy: {
        checked: Boolean(checklist.allergy),
        expiryDate: evidence.allergy?.expiryDate || "",
        ...(evidence.allergy || {}),
      },
      note: checklist.note || "",
      approvedAt: checklist.approvedAt || "",
      approvedBy: checklist.approvedBy || "",
      updatedAt: checklist.updatedAt || new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
}

export async function saveScrChecklist(staffRecordId, checklist = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!staffRecordId) throw new Error("Choose a staff member.");

  const { data, error } = await supabase
    .from("scr_checks")
    .upsert({
      staff_record_id: staffRecordId,
      ...scrChecklistPayload(checklist),
    }, { onConflict: "staff_record_id" })
    .select("staff_record_id, admin_review, updated_at")
    .single();

  if (error) throw error;
  return {
    staffRecordId: data.staff_record_id,
    scrChecklist: mapScrChecklist({ admin_review: data.admin_review, updated_at: data.updated_at }),
  };
}

export async function saveScrEvidenceRequest({ id, staffRecordId, evidenceKey, request = {} }) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!id || !staffRecordId || !evidenceKey) throw new Error("Evidence request is missing required details.");

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id || null;
  const status = request.status || "Requested";
  const payload = {
    id,
    staff_record_id: staffRecordId,
    evidence_key: evidenceKey,
    status,
    note: request.note || null,
    evidence_reference: request.evidenceReference || null,
    evidence_expiry_date: request.evidenceExpiryDate || null,
    submission_note: request.submissionNote || null,
    rejection_reason: request.rejectionReason || null,
    requested_at: request.requestedAt || null,
    requested_by: status === "Requested" ? userId : null,
    requested_by_name: request.requestedBy || null,
    submitted_at: request.submittedAt || null,
    submitted_by_name: request.submittedBy || null,
    resubmitted_at: request.resubmittedAt || null,
    reviewed_at: request.reviewedAt || null,
    reviewed_by: ["Approved", "Rejected"].includes(status) ? userId : null,
    reviewed_by_name: request.reviewedBy || null,
    cleared_at: request.clearedAt || null,
    cleared_by: status === "Cleared" ? userId : null,
    cleared_by_name: request.clearedBy || null,
    history: request.history || [],
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("scr_evidence_requests")
    .upsert(payload, { onConflict: "id" })
    .select("id, staff_record_id, evidence_key, status, updated_at")
    .single();

  if (error) throw error;
  return {
    id: data.id,
    staffRecordId: data.staff_record_id,
    evidenceKey: data.evidence_key,
    status: data.status,
    updatedAt: data.updated_at,
  };
}

export async function sendCoverMoveNotifications(payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(coverMoveFunctionName, {
    body: payload,
  });
  if (error) throw error;
  return data;
}

async function sendStaffAccountAction(action, payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(staffAccountFunctionName, {
    body: { action, ...payload },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Staff account action failed.");
  }
  return data;
}

async function readFunctionError(error) {
  const context = error?.context;
  if (!context || typeof context.json !== "function") return "";
  try {
    const body = await context.json();
    return body?.error || body?.message || "";
  } catch {
    return "";
  }
}

export function getStaffLoginUrl() {
  if (typeof window === "undefined") return "https://www.apres-school.co.uk/staff-login";
  return `${window.location.origin}/staff-login`;
}

export async function createStaffAccountInvite(payload) {
  return sendStaffAccountAction("invite", payload);
}

export async function resetStaffAccountPassword(payload) {
  return sendStaffAccountAction("reset-password", payload);
}

function normalizeCrmStatus(status) {
  const value = String(status || "New").toLowerCase().replace(/\s+/g, "_");
  if (value === "follow_up") return "follow_up";
  if (value === "reviewing") return "reviewing";
  if (value === "closed") return "closed";
  return "new";
}

function formatCrmStatus(status) {
  const value = String(status || "new").toLowerCase();
  if (value === "follow_up") return "Follow up";
  if (value === "reviewing") return "Reviewing";
  if (value === "closed") return "Closed";
  return "New";
}

function parseInternalNotes(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : { note: value };
  } catch {
    return { note: value };
  }
}

function formatSessionDate(value) {
  if (!value) return "Date TBC";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}

function formatSessionTime(start, end) {
  if (!start || !end) return "Time TBC";
  const formatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(new Date(start))}-${formatter.format(new Date(end))}`;
}

export async function submitPublicEnquiry(payload) {
  const record = {
    ...payload,
    status: "New",
    createdAt: new Date().toISOString(),
    source: "website",
  };

  if (!supabase) {
    saveLocalEnquiry(record);
    return { mode: "local", record };
  }

  const { data, error } = await supabase.functions.invoke(enquiryFunctionName, {
    body: record,
  });

  if (error) {
    saveLocalEnquiry({ ...record, syncStatus: "pending", syncError: error.message });
    return { mode: "local-fallback", record, error };
  }

  return { mode: "supabase", record: data?.enquiry || record };
}

export function getLocalEnquiries() {
  try {
    return JSON.parse(localStorage.getItem("apres-enquiries") || "[]");
  } catch {
    return [];
  }
}

function saveLocalEnquiry(record) {
  const existing = getLocalEnquiries();
  localStorage.setItem("apres-enquiries", JSON.stringify([record, ...existing]));
}

export async function fetchSchoolFinanceData() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const [
    customersResult,
    invoicesResult,
    settingsResult,
    locationsResult,
    permissionsResult,
    auditResult,
  ] = await Promise.all([
    supabase
      .from("finance_customers")
      .select("id, linked_location_id, customer_name, accounts_contact, accounts_email, telephone, billing_address, payment_terms_days, default_purchase_order, notes, active, created_at, updated_at")
      .order("customer_name", { ascending: true }),
    supabase
      .from("finance_invoices")
      .select(`
        id,
        customer_id,
        linked_location_id,
        invoice_number,
        draft_reference,
        invoice_date,
        due_date,
        payment_terms_days,
        purchase_order,
        reference,
        notes,
        internal_notes,
        service_period_start,
        service_period_end,
        status,
        subtotal,
        vat_total,
        total,
        amount_paid,
        balance_due,
        created_by,
        approved_by,
        sent_by,
        created_at,
        updated_at,
        submitted_at,
        approved_at,
        sent_at,
        finance_invoice_lines(*),
        finance_payments(*),
        finance_invoice_emails(*),
        finance_credit_notes(*),
        finance_customers(customer_name, accounts_contact, accounts_email, billing_address, payment_terms_days),
        locations(name, area)
      `)
      .order("invoice_date", { ascending: false })
      .limit(300),
    supabase
      .from("finance_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("locations")
      .select("id, name, area, active")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("finance_permissions")
      .select("id, profile_id, permission, granted_at, profiles!finance_permissions_profile_id_fkey(full_name, email, role)")
      .order("granted_at", { ascending: false }),
    supabase
      .from("finance_audit_events")
      .select("id, invoice_id, customer_id, credit_note_id, actor_id, action, detail, metadata, created_at, profiles!finance_audit_events_actor_id_fkey(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const warnings = [
    ["Finance customers", customersResult.error],
    ["Finance invoices", invoicesResult.error],
    ["Finance settings", settingsResult.error],
    ["Schools", locationsResult.error],
    ["Finance permissions", permissionsResult.error],
    ["Finance audit", auditResult.error],
  ]
    .filter(([, error]) => Boolean(error))
    .map(([label, error]) => `${label}: ${error.message || "Unable to load"}`);

  if (customersResult.error && customersResult.error.code !== "42P01") throw customersResult.error;
  if (invoicesResult.error && invoicesResult.error.code !== "42P01") throw invoicesResult.error;

  return {
    customers: (customersResult.data || []).map(mapFinanceCustomer),
    invoices: (invoicesResult.data || []).map(mapFinanceInvoice),
    settings: mapFinanceSettings(settingsResult.data || {}),
    locations: (locationsResult.data || []).map((location) => ({
      id: location.id,
      name: location.name,
      area: location.area || "",
      active: Boolean(location.active),
    })),
    permissions: (permissionsResult.data || []).map(mapFinancePermission),
    audit: (auditResult.data || []).map(mapFinanceAudit),
    warnings,
  };
}

export async function saveFinanceCustomer(customer) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const userId = await getCurrentUserId();
  const payload = {
    linked_location_id: customer.linkedLocationId || null,
    customer_name: customer.customerName || customer.name || "",
    accounts_contact: customer.accountsContact || "",
    accounts_email: customer.accountsEmail || "",
    telephone: customer.telephone || "",
    billing_address: customer.billingAddress || "",
    payment_terms_days: Number(customer.paymentTermsDays || 14),
    default_purchase_order: customer.defaultPurchaseOrder || "",
    notes: serialiseFinanceCustomerNotes(customer),
    active: customer.active !== false,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (!payload.customer_name) throw new Error("Customer name is required.");
  if (!customer.id) payload.created_by = userId;

  const { data, error } = await supabase
    .from("finance_customers")
    .upsert(customer.id ? { ...payload, id: customer.id } : payload)
    .select("*")
    .single();
  if (error) throw error;
  await recordFinanceAudit({
    action: customer.id ? "Customer updated" : "Customer created",
    detail: payload.customer_name,
    customerId: data.id,
    metadata: { accountsEmail: payload.accounts_email },
  });
  return mapFinanceCustomer(data);
}

export async function saveFinanceInvoice(invoice) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const userId = await getCurrentUserId();
  const lines = normaliseFinanceLines(invoice.lines || []);
  const totals = calculateFinanceTotals(lines);
  const payload = {
    customer_id: invoice.customerId,
    linked_location_id: invoice.linkedLocationId || invoice.locationId || null,
    invoice_date: invoice.invoiceDate || new Date().toISOString().slice(0, 10),
    due_date: invoice.dueDate || addDaysIso(invoice.invoiceDate || new Date().toISOString().slice(0, 10), Number(invoice.paymentTermsDays || 14)),
    payment_terms_days: Number(invoice.paymentTermsDays || 14),
    purchase_order: invoice.purchaseOrder || "",
    reference: invoice.reference || "",
    notes: invoice.notes || "",
    internal_notes: invoice.internalNotes || "",
    service_period_start: invoice.servicePeriodStart || null,
    service_period_end: invoice.servicePeriodEnd || null,
    status: financeStatusToDb(invoice.status || "draft"),
    subtotal: totals.subtotal,
    vat_total: totals.vatTotal,
    total: totals.total,
    balance_due: Math.max(totals.total - Number(invoice.amountPaid || 0), 0),
    updated_at: new Date().toISOString(),
  };
  if (!payload.customer_id) throw new Error("Choose a customer before saving the invoice.");
  if (!lines.length) throw new Error("Add at least one invoice line.");
  if (!invoice.id) payload.created_by = userId;

  const { data: savedInvoice, error: invoiceError } = await supabase
    .from("finance_invoices")
    .upsert(invoice.id ? { ...payload, id: invoice.id } : payload)
    .select("id, invoice_number, draft_reference")
    .single();
  if (invoiceError) throw invoiceError;

  const { error: deleteError } = await supabase
    .from("finance_invoice_lines")
    .delete()
    .eq("invoice_id", savedInvoice.id);
  if (deleteError) throw deleteError;

  const { error: linesError } = await supabase
    .from("finance_invoice_lines")
    .insert(lines.map((line, index) => ({
      invoice_id: savedInvoice.id,
      line_order: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unitPrice,
      vat_rate: line.vatRate,
      vat_percent: line.vatPercent,
      net_total: line.netTotal,
      vat_total: line.vatTotal,
      gross_total: line.grossTotal,
    })));
  if (linesError) throw linesError;

  await supabase.rpc("finance_recalculate_invoice", { p_invoice_id: savedInvoice.id });
  await recordFinanceAudit({
    action: invoice.id ? "Invoice edited" : "Invoice created",
    detail: savedInvoice.invoice_number || savedInvoice.draft_reference,
    invoiceId: savedInvoice.id,
    metadata: { total: totals.total, lineCount: lines.length },
  });
  return {
    id: savedInvoice.id,
    invoiceNumber: savedInvoice.invoice_number || "",
    draftReference: savedInvoice.draft_reference || "",
  };
}

export async function approveFinanceInvoice(invoiceId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!invoiceId) throw new Error("Choose an invoice to approve.");
  const userId = await getCurrentUserId();
  const { data: existing, error: loadError } = await supabase
    .from("finance_invoices")
    .select("id, invoice_number, status")
    .eq("id", invoiceId)
    .single();
  if (loadError) throw loadError;

  let invoiceNumber = existing.invoice_number;
  if (!invoiceNumber) {
    const { data: numberData, error: numberError } = await supabase.rpc("finance_next_invoice_number");
    if (numberError) throw numberError;
    invoiceNumber = numberData;
  }

  const { data, error } = await supabase
    .from("finance_invoices")
    .update({
      invoice_number: invoiceNumber,
      status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select("id, invoice_number")
    .single();
  if (error) throw error;
  await recordFinanceAudit({
    action: "Invoice approved",
    detail: data.invoice_number,
    invoiceId,
    metadata: { previousStatus: existing.status },
  });
  return data;
}

export async function markFinanceInvoiceSent(invoiceId, email = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!invoiceId) throw new Error("Choose an invoice before sending.");
  const userId = await getCurrentUserId();
  const sentAt = new Date().toISOString();
  const { data: invoice, error: invoiceError } = await supabase
    .from("finance_invoices")
    .update({
      status: "sent",
      sent_by: userId,
      sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq("id", invoiceId)
    .select("id, invoice_number")
    .single();
  if (invoiceError) throw invoiceError;

  const { error: emailError } = await supabase
    .from("finance_invoice_emails")
    .insert({
      invoice_id: invoiceId,
      recipient: email.to || email.toEmail || "",
      cc: email.cc || "",
      bcc: email.bcc || "",
      subject: email.subject || `Invoice ${invoice.invoice_number} from Après School`,
      body: email.body || "",
      sent_by: userId,
      sent_at: sentAt,
      status: "recorded",
      metadata: { mode: "manual_email_record" },
    });
  if (emailError) throw emailError;
  await recordFinanceAudit({
    action: "Invoice emailed",
    detail: `${invoice.invoice_number} to ${email.to || email.toEmail || "recipient not recorded"}`,
    invoiceId,
    metadata: { to: email.to || email.toEmail, cc: email.cc, bcc: email.bcc },
  });
  return invoice;
}

export async function sendFinanceInvoiceEmail(payload = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!payload.invoiceId) throw new Error("Choose an invoice before sending.");
  if (!payload.pdfBase64) throw new Error("Invoice PDF attachment could not be generated.");

  const { data, error } = await supabase.functions.invoke(financeInvoiceFunctionName, {
    body: {
      invoiceId: payload.invoiceId,
      emailKind: payload.emailKind || "invoice",
      to: payload.to || payload.toEmail || "",
      cc: payload.cc || "",
      bcc: payload.bcc || "",
      subject: payload.subject || "",
      body: payload.body || "",
      pdfBase64: payload.pdfBase64,
      pdfFilename: payload.pdfFilename || "",
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function recordFinancePayment(invoiceId, payment) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const userId = await getCurrentUserId();
  const amount = Number(payment.amount || 0);
  if (!invoiceId) throw new Error("Choose an invoice before recording payment.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount.");

  const { data, error } = await supabase
    .from("finance_payments")
    .insert({
      invoice_id: invoiceId,
      payment_date: payment.paymentDate || payment.paidAt || new Date().toISOString().slice(0, 10),
      amount,
      reference: payment.reference || "",
      notes: payment.notes || "",
      recorded_by: userId,
    })
    .select("id, amount")
    .single();
  if (error) throw error;
  await supabase.rpc("finance_recalculate_invoice", { p_invoice_id: invoiceId });
  await recordFinanceAudit({
    action: "Payment recorded",
    detail: `£${amount.toFixed(2)}${payment.reference ? ` · ${payment.reference}` : ""}`,
    invoiceId,
    metadata: { paymentId: data.id, reference: payment.reference },
  });
  return data;
}

export async function saveFinanceSettings(settings) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const userId = await getCurrentUserId();
  const payload = {
    id: true,
    company_name: settings.companyName || "APRÈS SCHOOL LIMITED",
    registered_address: settings.registeredAddress || "",
    company_number: settings.companyNumber || "",
    vat_status: settings.vatStatus || "not_registered",
    vat_number: settings.vatNumber || "",
    default_payment_terms_days: Number(settings.defaultPaymentTermsDays || 14),
    invoice_prefix: settings.invoicePrefix || "AS-INV-",
    credit_note_prefix: settings.creditNotePrefix || "AS-CN-",
    finance_email: settings.financeEmail || "hello@apres-school.co.uk",
    finance_telephone: settings.financeTelephone || "",
    default_invoice_footer: settings.defaultInvoiceFooter || "",
    default_email_subject: settings.defaultEmailSubject || "Invoice {InvoiceNumber} from Après School",
    default_email_body: settings.defaultEmailBody || "",
    bank_account_name: settings.bankAccountName || "Après School Limited",
    bank_sort_code: settings.bankSortCode || "04-00-03",
    bank_account_number: settings.bankAccountNumber || "21773814",
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("finance_settings")
    .upsert(payload)
    .select("*")
    .single();
  if (error) throw error;
  await recordFinanceAudit({
    action: "Finance settings changed",
    detail: "Invoice settings updated",
    metadata: { vatStatus: payload.vat_status, paymentTerms: payload.default_payment_terms_days },
  });
  return mapFinanceSettings(data);
}

async function recordFinanceAudit({ action, detail = "", invoiceId = null, customerId = null, creditNoteId = null, metadata = {} }) {
  if (!supabase) return;
  const userId = await getCurrentUserId();
  const event = {
    invoice_id: invoiceId,
    customer_id: customerId,
    credit_note_id: creditNoteId,
    actor_id: userId,
    action,
    detail,
    metadata,
  };
  const { error } = await supabase.from("finance_audit_events").insert(event);
  if (error) console.warn("Finance audit event failed", error);
  await createAuditLogEntry({
    action,
    detail,
    tableName: invoiceId ? "finance_invoices" : customerId ? "finance_customers" : "finance",
    recordId: invoiceId || customerId || creditNoteId,
    metadata: { ...metadata, module: "School Finance" },
  }).catch((error) => console.warn("Global finance audit event failed", error));
}

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.id || null;
}

function mapFinanceCustomer(record = {}) {
  const noteData = parseFinanceCustomerNotes(record.notes);
  const isWillingtonPrep = /willington\s+prep/i.test(record.customer_name || "");
  return {
    id: record.id,
    linkedLocationId: record.linked_location_id || "",
    locationId: record.linked_location_id || "",
    customerName: record.customer_name || "",
    accountsContact: isWillingtonPrep ? "" : record.accounts_contact || "",
    accountsEmail: isWillingtonPrep ? "accounts@willingtonschool.co.uk" : record.accounts_email || "",
    telephone: record.telephone || "",
    billingAddress: record.billing_address || "",
    paymentTermsDays: Number(record.payment_terms_days || 14),
    defaultPurchaseOrder: record.default_purchase_order || "",
    notes: noteData.internalNotes || "",
    internalNotes: noteData.internalNotes || "",
    financeChaseStatus: noteData.financeChaseStatus || "Not started",
    financeChaseNotes: noteData.financeChaseNotes || "",
    financeChaseActivity: noteData.financeChaseActivity || [],
    active: record.active !== false,
    createdAt: record.created_at || "",
    updatedAt: record.updated_at || "",
  };
}

function parseFinanceCustomerNotes(value = "") {
  if (!value) return { internalNotes: "", financeChaseStatus: "Not started", financeChaseNotes: "", financeChaseActivity: [] };
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.kind === "finance_customer_notes") {
      return {
        internalNotes: parsed.internalNotes || "",
        financeChaseStatus: parsed.financeChaseStatus || "Not started",
        financeChaseNotes: parsed.financeChaseNotes || "",
        financeChaseActivity: Array.isArray(parsed.financeChaseActivity) ? parsed.financeChaseActivity : [],
      };
    }
  } catch {
    // Plain-text customer notes existed before debtor chase fields.
  }
  return { internalNotes: value, financeChaseStatus: "Not started", financeChaseNotes: "", financeChaseActivity: [] };
}

function serialiseFinanceCustomerNotes(customer = {}) {
  return JSON.stringify({
    kind: "finance_customer_notes",
    internalNotes: customer.internalNotes || customer.notes || "",
    financeChaseStatus: customer.financeChaseStatus || "Not started",
    financeChaseNotes: customer.financeChaseNotes || "",
    financeChaseActivity: Array.isArray(customer.financeChaseActivity) ? customer.financeChaseActivity.slice(0, 50) : [],
  });
}

function mapFinanceInvoice(record = {}) {
  const customer = Array.isArray(record.finance_customers) ? record.finance_customers[0] : record.finance_customers;
  const location = Array.isArray(record.locations) ? record.locations[0] : record.locations;
  const isWillingtonPrep = /willington\s+prep/i.test(customer?.customer_name || "");
  return {
    id: record.id,
    customerId: record.customer_id || "",
    customerName: customer?.customer_name || "",
    accountsContact: isWillingtonPrep ? "" : customer?.accounts_contact || "",
    accountsEmail: isWillingtonPrep ? "accounts@willingtonschool.co.uk" : customer?.accounts_email || "",
    billingAddress: customer?.billing_address || "",
    linkedLocationId: record.linked_location_id || "",
    linkedSchool: location?.name || "",
    invoiceNumber: record.invoice_number || "",
    draftReference: record.draft_reference || "",
    invoiceDate: record.invoice_date || "",
    dueDate: record.due_date || "",
    paymentTermsDays: Number(record.payment_terms_days || 14),
    purchaseOrder: record.purchase_order || "",
    reference: record.reference || "",
    notes: record.notes || "",
    internalNotes: record.internal_notes || "",
    servicePeriodStart: record.service_period_start || "",
    servicePeriodEnd: record.service_period_end || "",
    status: financeStatusToLabel(record.status || "draft"),
    subtotal: Number(record.subtotal || 0),
    vatTotal: Number(record.vat_total || 0),
    total: Number(record.total || 0),
    amountPaid: Number(record.amount_paid || 0),
    balanceDue: Number(record.balance_due || 0),
    createdAt: record.created_at || "",
    updatedAt: record.updated_at || "",
    submittedAt: record.submitted_at || "",
    approvedAt: record.approved_at || "",
    sentAt: record.sent_at || "",
    lines: (record.finance_invoice_lines || []).sort((a, b) => Number(a.line_order || 0) - Number(b.line_order || 0)).map(mapFinanceLine),
    payments: (record.finance_payments || []).map(mapFinancePayment),
    emails: (record.finance_invoice_emails || []).map(mapFinanceEmail),
    creditNotes: (record.finance_credit_notes || []).map((credit) => ({
      id: credit.id,
      creditNoteNumber: credit.credit_note_number || "",
      creditDate: credit.credit_date || "",
      reason: credit.reason || "",
      total: Number(credit.total || 0),
      status: credit.status || "draft",
    })),
  };
}

function mapFinanceLine(record = {}) {
  return {
    id: record.id,
    description: record.description || "",
    quantity: Number(record.quantity || 0),
    unit: record.unit || "Fixed Fee",
    unitPrice: Number(record.unit_price || 0),
    vatRate: record.vat_rate || "No VAT",
    vatPercent: Number(record.vat_percent || 0),
    netTotal: Number(record.net_total || 0),
    vatTotal: Number(record.vat_total || 0),
    grossTotal: Number(record.gross_total || 0),
  };
}

function mapFinancePayment(record = {}) {
  return {
    id: record.id,
    paymentDate: record.payment_date || "",
    paidAt: record.payment_date || "",
    amount: Number(record.amount || 0),
    reference: record.reference || "",
    notes: record.notes || "",
    recordedAt: record.recorded_at || "",
    reversedAt: record.reversed_at || "",
  };
}

function mapFinanceEmail(record = {}) {
  const metadata = record.metadata || {};
  return {
    id: record.id,
    to: record.recipient || "",
    cc: record.cc || "",
    bcc: record.bcc || "",
    subject: record.subject || "",
    body: record.body || "",
    emailKind: metadata.emailKind || metadata.type || "invoice",
    status: record.status || "",
    sentAt: record.sent_at || "",
    sentBy: record.sent_by || "",
    providerMessageId: record.provider_message_id || "",
    attachmentFilename: metadata.attachmentFilename || "",
    attachmentBase64: metadata.attachmentBase64 || "",
    attachmentBytes: metadata.attachmentBase64 ? Math.ceil((metadata.attachmentBase64.length * 3) / 4) : 0,
    errorMessage: metadata.error || "",
    provider: metadata.provider || "resend",
  };
}

function mapFinanceSettings(record = {}) {
  return {
    companyName: record.company_name || "APRÈS SCHOOL LIMITED",
    registeredAddress: record.registered_address || "",
    companyNumber: record.company_number || "",
    vatStatus: record.vat_status || "not_registered",
    vatNumber: record.vat_number || "",
    defaultPaymentTermsDays: Number(record.default_payment_terms_days || 14),
    invoicePrefix: record.invoice_prefix || "AS-INV-",
    creditNotePrefix: record.credit_note_prefix || "AS-CN-",
    financeEmail: record.finance_email || "hello@apres-school.co.uk",
    financeTelephone: record.finance_telephone || "",
    defaultInvoiceFooter: record.default_invoice_footer || "",
    defaultEmailSubject: record.default_email_subject || "Invoice {InvoiceNumber} from Après School",
    defaultEmailBody: record.default_email_body || "",
    bankAccountName: record.bank_account_name || "Après School Limited",
    bankSortCode: record.bank_sort_code || "04-00-03",
    bankAccountNumber: record.bank_account_number || "21773814",
  };
}

function mapFinancePermission(record = {}) {
  const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
  return {
    id: record.id,
    profileId: record.profile_id || "",
    permission: record.permission || "",
    name: profile?.full_name || profile?.email || "User",
    email: profile?.email || "",
    role: normalizeRole(profile?.role),
    grantedAt: record.granted_at || "",
  };
}

function mapFinanceAudit(record = {}) {
  const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
  return {
    id: record.id,
    invoiceId: record.invoice_id || "",
    customerId: record.customer_id || "",
    creditNoteId: record.credit_note_id || "",
    action: record.action || "",
    detail: record.detail || "",
    actor: profile?.full_name || profile?.email || "System",
    createdAt: record.created_at || "",
    metadata: record.metadata || {},
  };
}

function normaliseFinanceLines(lines = []) {
  return lines
    .filter((line) => String(line.description || "").trim())
    .map((line) => {
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.unitPrice || 0);
      const vatPercent = vatPercentForRate(line.vatRate);
      const netTotal = roundMoney(quantity * unitPrice);
      const vatTotal = roundMoney(netTotal * (vatPercent / 100));
      return {
        description: String(line.description || "").trim(),
        quantity,
        unit: line.unit || "Fixed Fee",
        unitPrice,
        vatRate: line.vatRate || "No VAT",
        vatPercent,
        netTotal,
        vatTotal,
        grossTotal: roundMoney(netTotal + vatTotal),
      };
    });
}

function calculateFinanceTotals(lines = []) {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + Number(line.netTotal || 0), 0));
  const vatTotal = roundMoney(lines.reduce((sum, line) => sum + Number(line.vatTotal || 0), 0));
  return { subtotal, vatTotal, total: roundMoney(subtotal + vatTotal) };
}

function vatPercentForRate(vatRate) {
  if (vatRate === "Standard Rated") return 20;
  return 0;
}

function financeStatusToDb(status) {
  return String(status || "draft").trim().toLowerCase().replace(/\s+/g, "_");
}

function financeStatusToLabel(status) {
  return String(status || "draft")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function addDaysIso(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
