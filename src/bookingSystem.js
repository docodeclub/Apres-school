import { hasSupabaseConfig, supabase } from "./supabaseClient.js";

export function bookingSystemConfigured() {
  return Boolean(hasSupabaseConfig && supabase);
}

export async function getParentAuthSession() {
  assertSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function fetchCurrentProfile() {
  assertSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, must_change_password")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchStaffRegister({ registerDate, siteName = null, programmeName = null } = {}) {
  assertSupabase();
  if (!registerDate) throw new Error("Choose a register date.");
  const [registerResult, rewardResult, reportResult] = await Promise.allSettled([
    supabase.rpc("staff_register_for_day", {
      p_register_date: registerDate,
      p_site_name: siteName || null,
      p_programme_name: programmeName || null,
    }),
    supabase.rpc("staff_register_rewards_for_day", {
      p_register_date: registerDate,
    }),
    supabase.rpc("staff_register_report_markers_for_day", {
      p_register_date: registerDate,
    }),
  ]);
  if (registerResult.status === "rejected") throw registerResult.reason;
  const { data, error } = registerResult.value;
  if (error) throw error;
  const rewardRows = rewardResult.status === "fulfilled" && !rewardResult.value.error
    ? rewardResult.value.data || []
    : [];
  const rewardsByChild = rewardRows.reduce((map, reward) => {
    const childId = reward.child_id;
    if (!childId) return map;
    if (!map.has(childId)) map.set(childId, []);
    map.get(childId).push({
      id: reward.reward_id,
      badgeType: reward.badge_type,
      reason: reward.reason,
      staffName: reward.awarded_by_name,
      clubName: reward.club_name,
      siteName: reward.site_name,
      sessionLabel: reward.session_label,
      awardedAt: reward.awarded_at,
    });
    return map;
  }, new Map());
  const reportRows = reportResult.status === "fulfilled" && !reportResult.value.error
    ? reportResult.value.data || []
    : [];
  const reportsByChild = reportRows.reduce((map, report) => {
    const childId = report.child_id;
    if (!childId) return map;
    if (!map.has(childId)) map.set(childId, []);
    map.get(childId).push({
      id: report.report_id,
      reportType: report.report_type,
      category: report.incident_category || "",
      severity: report.incident_severity || "",
      occurredAt: report.occurred_at,
    });
    return map;
  }, new Map());
  return (data || []).map((row) => ({
    bookingItemId: row.booking_item_id,
    bookingId: row.booking_id,
    bookingReference: row.booking_reference,
    bookingSource: row.booking_source || "",
    bookingMetadata: row.booking_metadata || {},
    staffAdHoc: row.booking_source === "staff_adhoc"
      || row.booking_metadata?.staffAdHoc === true,
    sessionId: row.session_id,
    sessionBlockId: row.session_block_id,
    childId: row.child_id,
    childName: row.child_name,
    childDateOfBirth: row.child_date_of_birth,
    childSchoolName: row.child_school_name,
    childYearGroup: row.child_year_group,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    emergencyContact: row.emergency_contact || {},
    siteName: row.site_name,
    programmeName: row.programme_name,
    sessionLabel: row.session_label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    attendanceStatus: row.attendance_status,
    attendanceNote: row.attendance_note,
    attendanceTime: row.attendance_time,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    medicalNotes: row.medical_notes,
    allergyNotes: row.allergy_notes,
    dietaryNotes: row.dietary_notes,
    flags: Array.isArray(row.care_flags) ? row.care_flags : [],
    authorisedCollectors: Array.isArray(row.authorised_collectors) ? row.authorised_collectors : [],
    consents: row.consents || {},
    rewardsToday: rewardsByChild.get(row.child_id) || [],
    reportsToday: reportsByChild.get(row.child_id) || [],
  }));
}

export async function fetchStaffChildActivityTimeline({ childId, limit = 50 } = {}) {
  assertSupabase();
  if (!childId) return [];
  const { data, error } = await supabase.rpc("staff_child_activity_timeline", {
    p_child_id: childId,
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchStaffRegisterTimetable({ from = new Date(), limit = 500 } = {}) {
  assertSupabase();
  const fromIso = from instanceof Date ? from.toISOString() : new Date(from).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select(`
      id,
      booking_label,
      starts_at,
      status,
      parent_bookable,
      programmes!inner(
        id,
        name,
        active,
        locations!inner(id, name, active)
      ),
      session_blocks(
        id,
        label,
        starts_at,
        ends_at,
        parent_bookable,
        sort_order
      )
    `)
    .eq("parent_bookable", true)
    .eq("programmes.active", true)
    .eq("programmes.locations.active", true)
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const options = [];
  (data || []).forEach((row) => {
    if (["cancelled", "closed"].includes(String(row.status || "").toLowerCase())) return;
    const programme = row.programmes || {};
    const location = programme.locations || {};
    const blocks = (row.session_blocks || [])
      .filter((block) => block.parent_bookable !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    if (!blocks.length) {
      options.push({
        siteName: location.name || "",
        programmeName: programme.name || row.booking_label || "Activity",
        sessionLabel: row.booking_label || programme.name || "Session",
      });
      return;
    }

    blocks.forEach((block) => {
      options.push({
        siteName: location.name || "",
        programmeName: programme.name || row.booking_label || "Activity",
        sessionLabel: block.label || row.booking_label || "Session",
      });
    });
  });

  return [...new Map(options
    .filter((option) => option.siteName && option.programmeName && option.sessionLabel)
    .map((option) => [`${option.siteName}\u0000${option.programmeName}\u0000${option.sessionLabel}`, option]))
    .values()];
}

export async function updateStaffRegisterEntry({ bookingItemId, status, note = "" } = {}) {
  assertSupabase();
  if (!bookingItemId) throw new Error("Choose a child on the register.");
  const { data, error } = await supabase.rpc("update_staff_register_entry", {
    p_booking_item_id: bookingItemId,
    p_attendance_status: status,
    p_note: note || "",
  });
  if (error) throw error;
  return data;
}

export async function createStaffRegisterReport({
  bookingItemId,
  reportType,
  summary,
  details = {},
  emailPrimaryContact = false,
} = {}) {
  assertSupabase();
  if (!bookingItemId) throw new Error("Choose a pupil on the register.");
  if (!["incident", "first_aid", "safeguarding"].includes(reportType)) {
    throw new Error("Choose a report type.");
  }
  if (!String(summary || "").trim()) throw new Error("Add a clear factual account.");
  const { data, error } = await supabase.rpc("create_register_pupil_report", {
    p_booking_item_id: bookingItemId,
    p_report_type: reportType,
    p_summary: String(summary).trim(),
    p_details: details || {},
  });
  if (error) throw error;
  if (!emailPrimaryContact) return data;
  try {
    const notification = await notifyRegisterParent({
      kind: "report",
      recordId: data?.reportId,
    });
    return { ...data, ...notification };
  } catch (notificationError) {
    return {
      ...data,
      emailSent: false,
      emailError: notificationError?.message || "The parent email could not be sent.",
    };
  }
}

export async function createSafeguardingConcern({
  bookingItemId,
  childSafeNow,
  concernSource,
  categories = [],
  factualAccount,
  immediateAction,
  witnesses = {},
  dslInformed = false,
  dslInformedWho = "",
  dslInformedAt = null,
  occurredAt = null,
} = {}) {
  assertSupabase();
  if (!bookingItemId) throw new Error("Choose a pupil on the register.");
  const { data, error } = await supabase.rpc("create_safeguarding_concern", {
    p_booking_item_id: bookingItemId,
    p_child_safe_now: childSafeNow,
    p_concern_source: concernSource,
    p_categories: categories,
    p_factual_account: String(factualAccount || "").trim(),
    p_immediate_action: String(immediateAction || "").trim(),
    p_witnesses: witnesses || {},
    p_dsl_informed: Boolean(dslInformed),
    p_dsl_informed_who: String(dslInformedWho || "").trim() || null,
    p_dsl_informed_at: dslInformedAt || null,
    p_occurred_at: occurredAt || new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

export async function saveSafeguardingDraft({ bookingItemId, content } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("save_safeguarding_draft", {
    p_booking_item_id: bookingItemId,
    p_content: content || {},
  });
  if (error) throw error;
  return data;
}

export async function readSafeguardingDraft({ bookingItemId } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("read_safeguarding_draft", {
    p_booking_item_id: bookingItemId,
  });
  if (error) throw error;
  return data || {};
}

export async function fetchSafeguardingCases({ limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("list_safeguarding_cases", { p_limit: limit });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function fetchSafeguardingCase({ caseId } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("get_safeguarding_case", { p_case_id: caseId });
  if (error) throw error;
  return data || null;
}

export async function appendSafeguardingCaseEntry({
  caseId,
  entryType = "Case note",
  content,
  occurredAt = null,
} = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("append_safeguarding_case_entry", {
    p_case_id: caseId,
    p_entry_type: entryType,
    p_content: String(content || "").trim(),
    p_occurred_at: occurredAt || new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

export async function updateSafeguardingCase({
  caseId,
  status,
  priority,
  assignedDslId = null,
} = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("update_safeguarding_case", {
    p_case_id: caseId,
    p_status: status,
    p_priority: priority,
    p_assigned_dsl_id: assignedDslId || null,
  });
  if (error) throw error;
  return data;
}

export async function createSafeguardingCaseTask({
  caseId,
  title,
  details = "",
  assignedTo = null,
  dueAt = null,
} = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("create_safeguarding_case_task", {
    p_case_id: caseId,
    p_title: String(title || "").trim(),
    p_details: String(details || "").trim(),
    p_assigned_to: assignedTo || null,
    p_due_at: dueAt || null,
  });
  if (error) throw error;
  return data;
}

export async function completeSafeguardingCaseTask({ taskId } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("complete_safeguarding_case_task", {
    p_task_id: taskId,
  });
  if (error) throw error;
  return data;
}

export async function uploadSafeguardingAttachments({ caseId, files = [] } = {}) {
  assertSupabase();
  const uploaded = [];
  for (const file of files) {
    const safeName = String(file.name || "attachment")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || "attachment";
    const path = `${caseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("safeguarding-private")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.rpc("record_safeguarding_attachment", {
      p_case_id: caseId,
      p_storage_path: path,
      p_file_name: file.name || safeName,
      p_media_type: file.type || null,
      p_byte_size: file.size || null,
    });
    if (error) throw error;
    uploaded.push(data);
  }
  return uploaded;
}

export async function createStaffRegisterReward({
  bookingItemId,
  badgeType,
  reason,
  emailPrimaryContact = false,
} = {}) {
  assertSupabase();
  if (!bookingItemId) throw new Error("Choose a pupil on the register.");
  if (!badgeType) throw new Error("Choose a reward badge.");
  if (!String(reason || "").trim()) throw new Error("Add a short reason for the reward.");
  const { data, error } = await supabase.rpc("create_register_child_reward", {
    p_booking_item_id: bookingItemId,
    p_badge_type: badgeType,
    p_reason: String(reason).trim(),
  });
  if (error) throw error;
  if (!emailPrimaryContact) return data;
  try {
    const notification = await notifyRegisterParent({
      kind: "reward",
      recordId: data?.rewardId,
    });
    return { ...data, ...notification };
  } catch (notificationError) {
    return {
      ...data,
      emailSent: false,
      emailError: notificationError?.message || "The parent email could not be sent.",
    };
  }
}

export async function fetchParentBadgeBook() {
  assertSupabase();
  await currentUser();
  const { data, error } = await supabase.rpc("parent_badge_book");
  if (error) throw error;
  return {
    rewards: Array.isArray(data?.rewards) ? data.rewards : [],
    total: Number(data?.total || 0),
    fetchedAt: data?.fetchedAt || new Date().toISOString(),
  };
}

export async function fetchAdminRewardsDashboard({ limit = 12 } = {}) {
  assertSupabase();
  await currentUser();
  const { data, error } = await supabase.rpc("admin_rewards_dashboard", {
    p_limit: limit,
  });
  if (error) throw error;
  return {
    today: Number(data?.today || 0),
    week: Number(data?.week || 0),
    month: Number(data?.month || 0),
    topBadges: (Array.isArray(data?.topBadges) ? data.topBadges : []).map((item) => ({
      ...item,
      total: Number(item.total ?? item.count ?? 0),
    })),
    topStaff: (Array.isArray(data?.topStaff) ? data.topStaff : []).map((item) => ({
      ...item,
      total: Number(item.total ?? item.count ?? 0),
    })),
    recent: Array.isArray(data?.recent) ? data.recent : [],
    fetchedAt: data?.fetchedAt || new Date().toISOString(),
  };
}

async function notifyRegisterParent({ kind, recordId } = {}) {
  if (!recordId) throw new Error("The record was saved, but its parent email could not be prepared.");
  const { data, error } = await supabase.functions.invoke("notify-register-parent", {
    body: { kind, recordId },
  });
  if (error) throw new Error(error.message || "The parent email could not be sent.");
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export async function fetchRegisterPupilReports({ limit = 200 } = {}) {
  assertSupabase();
  const { data, error } = await supabase.rpc("list_register_pupil_reports", {
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function updateRegisterPupilReport({
  reportId,
  status,
  followUpNote = "",
} = {}) {
  assertSupabase();
  if (!reportId) throw new Error("Choose a report.");
  if (!status) throw new Error("Choose a review status.");
  const { data, error } = await supabase.rpc("update_register_pupil_report", {
    p_report_id: reportId,
    p_status: status,
    p_follow_up_note: String(followUpNote || "").trim(),
  });
  if (error) throw error;
  return data;
}

export async function fetchStaffAdHocBookingOptions({
  registerDate,
  siteName = null,
  programmeName = null,
  childQuery = "",
  limit = 20,
} = {}) {
  assertSupabase();
  if (!registerDate) throw new Error("Choose a register date.");
  const { data, error } = await supabase.rpc("staff_adhoc_booking_options", {
    p_register_date: registerDate,
    p_site_name: siteName || null,
    p_programme_name: programmeName || null,
    p_child_query: String(childQuery || "").trim(),
    p_limit: limit,
  });
  if (error) throw error;
  return {
    children: (data?.children || []).map((child) => ({
      id: child.child_id,
      name: child.child_name,
      schoolName: child.school_name || "",
      yearGroup: child.year_group || "",
      parentAccountId: child.parent_account_id,
      parentName: child.parent_name || "",
      parentEmail: child.parent_email || "",
    })),
    sessions: (data?.sessions || []).map((session) => ({
      id: session.session_block_id,
      sessionId: session.session_id,
      siteName: session.site_name || "",
      programmeName: session.programme_name || "",
      label: session.session_label || "Session",
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      price: Number(session.price || 0),
      capacity: Number(session.capacity || 0),
      placesLeft: Number(session.places_left || 0),
    })),
  };
}

export async function createStaffAdHocBooking({
  childId,
  registerDate,
  sessionBlockIds = [],
  applyNonBookingFee = false,
} = {}) {
  assertSupabase();
  if (!childId) throw new Error("Choose a pupil.");
  if (!registerDate) throw new Error("Choose a register date.");
  if (!sessionBlockIds.length) throw new Error("Choose at least one session.");
  const { data, error } = await supabase.functions.invoke("create-staff-adhoc-booking", {
    body: {
      childId,
      registerDate,
      sessionBlockIds: [...new Set(sessionBlockIds)],
      applyNonBookingFee: Boolean(applyNonBookingFee),
    },
  });
  if (error) throw new Error(data?.error || error.message || "The ad-hoc booking could not be created.");
  if (!data?.ok) throw new Error(data?.message || "The ad-hoc booking could not be created.");
  return data;
}

export async function cancelStaffAdHocBooking({ bookingId, reason = "" } = {}) {
  assertSupabase();
  if (!bookingId) throw new Error("Choose an ad-hoc booking to cancel.");
  const { data, error } = await supabase.functions.invoke("cancel-staff-adhoc-booking", {
    body: {
      bookingId,
      reason: String(reason || "").trim(),
    },
  });
  if (error) throw new Error(data?.error || error.message || "The ad-hoc booking could not be cancelled.");
  if (!data?.ok) throw new Error(data?.message || "The ad-hoc booking could not be cancelled.");
  return data;
}

export async function signInParentAccount({ email, password } = {}) {
  assertSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Parent email is required.");
  if (!password) throw new Error("Password is required.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) throw error;
  return data;
}

export async function activateSignedInParentAccount() {
  assertSupabase();
  const { data, error } = await supabase.rpc("activate_current_parent_account");
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || "The parent account could not be activated.");
  return data;
}

export async function signOutParentAccount() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function graduateParentChild(childId) {
  assertSupabase();
  if (!childId) throw new Error("Choose a child to graduate.");
  const { data, error } = await supabase.rpc("graduate_parent_child", { p_child_id: childId });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || "The child record could not be archived.");
  return data;
}

export async function archiveOwnParentAccount() {
  assertSupabase();
  const { data, error } = await supabase.rpc("archive_own_parent_account");
  if (error) throw error;
  return data || { ok: false, message: "The account could not be archived." };
}

export async function manageParentAccountAccess(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: payload,
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Parent account action failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function registerParentAccount(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("register-parent-account", {
    body: payload,
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Parent registration failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function requestParentPasswordReset(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("parent-password-reset", {
    body: {
      ...payload,
      action: "request-code",
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Password reset request failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function confirmParentPasswordReset(payload = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("parent-password-reset", {
    body: {
      ...payload,
      action: "confirm-code",
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Password reset failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function inviteParentAccountHolder({ parentAccountId, email, fullName } = {}) {
  assertSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!parentAccountId) throw new Error("Parent account is required.");
  if (!normalizedEmail) throw new Error("Second account holder email is required.");

  const loginUrl = typeof window !== "undefined"
    ? `${window.location.origin}/launch-booking`
    : undefined;
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "invite-holder",
      parentAccountId,
      email: normalizedEmail,
      fullName: fullName || "",
      loginUrl,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Second account holder invite failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data?.holder || data;
}

export async function removeParentAccountHolder(holderId) {
  assertSupabase();
  if (!holderId) throw new Error("Second account holder is required.");
  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "remove-holder",
      holderId,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Second account holder removal failed.");
  }
  if (data?.error) throw new Error(data.error);
  return data?.holder || data;
}

export async function updateOwnParentContact({ fullName, email, phone, currentPassword = "" } = {}) {
  assertSupabase();
  const user = await currentUser();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email address is required.");
  if (normalizedEmail !== String(user.email || "").trim().toLowerCase()) {
    if (!currentPassword) throw new Error("Enter your current password to change your login email.");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(user.email || "").trim().toLowerCase(),
      password: currentPassword,
    });
    if (signInError) throw new Error("Your current password is not correct.");
  }

  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "update-own-contact",
      fullName: String(fullName || "").trim(),
      email: normalizedEmail,
      phone: String(phone || "").trim(),
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Contact details could not be updated.");
  }
  if (data?.error) throw new Error(data.error);
  if (normalizedEmail !== String(user.email || "").trim().toLowerCase()) {
    await supabase.auth.refreshSession();
  }
  return data;
}

export async function updateOwnParentPassword({ currentPassword, newPassword } = {}) {
  assertSupabase();
  const user = await currentUser();
  if (!currentPassword) throw new Error("Enter your current password.");
  if (!newPassword) throw new Error("Enter a new password.");
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: String(user.email || "").trim().toLowerCase(),
    password: currentPassword,
  });
  if (signInError) throw new Error("Your current password is not correct.");

  const { data, error } = await supabase.functions.invoke("manage-parent-account", {
    body: {
      action: "update-own-password",
      newPassword,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Password could not be updated.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchBookableSessions({ from = new Date(), limit = 120 } = {}) {
  assertSupabase();
  const fromIso = from instanceof Date ? from.toISOString() : new Date(from).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select(`
      id,
      starts_at,
      ends_at,
      capacity,
      status,
      booking_label,
      parent_bookable,
      price,
      payment_route,
      cancellation_hours,
      amendment_hours,
      booking_cutoff_hours,
      eligibility,
      programmes(
        id,
        name,
        category,
        locations(id, name, area)
      ),
      session_blocks(
        id,
        label,
        starts_at,
        ends_at,
        price,
        capacity,
        parent_bookable,
        sort_order
      )
    `)
    .eq("parent_bookable", true)
    .gte("starts_at", fromIso)
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(mapBookableSession);
}

export async function fetchParentAccount() {
  assertSupabase();
  const user = await currentUser();
  const missingLinkedHolderTableCodes = ["42P01", "42703", "PGRST200", "PGRST205"];
  const parentAccountBaseSelect = `
    id,
    profile_id,
    full_name,
    email,
    phone,
    billing_address,
    emergency_contact,
    marketing_preferences,
    portal_status,
    archived_at,
    archive_reason,
    external_source,
    external_id,
    registered_centres,
    migration_metadata,
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
      archived_at,
      archive_reason,
      external_source,
      external_id,
      migration_metadata
    )
  `;
  const parentAccountSelect = `
    ${parentAccountBaseSelect},
    parent_account_holders(
      id,
      email,
      full_name,
      role,
      status,
      invited_at,
      accepted_at,
      permissions
    )
  `;
  let { data, error } = await supabase
    .from("parent_accounts")
    .select(parentAccountSelect)
    .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
    .is("archived_at", null)
    .maybeSingle();

  if (error && missingLinkedHolderTableCodes.includes(error.code)) {
    const fallback = await supabase
      .from("parent_accounts")
      .select(parentAccountBaseSelect)
      .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
      .is("archived_at", null)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  if (data) return mapParentAccount({ ...data, account_holder_role: "primary" });

  const { data: holder, error: holderError } = await supabase
    .from("parent_account_holders")
    .select(`
      id,
      role,
      status,
      parent_accounts(${parentAccountBaseSelect})
    `)
    .or(`profile_id.eq.${user.id},email.eq.${user.email}`)
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();

  if (holderError) {
    if (missingLinkedHolderTableCodes.includes(holderError.code)) return null;
    throw holderError;
  }

  return holder?.parent_accounts
    ? mapParentAccount({
      ...holder.parent_accounts,
      account_holder_role: holder.role || "secondary",
      account_holder_status: holder.status || "active",
    })
    : null;
}

export async function fetchParentBookingLedger({ limit = 80 } = {}) {
  assertSupabase();
  await currentUser();

  const { data: ledger, error } = await supabase
    .rpc("parent_booking_ledger", { p_limit: limit });

  if (error) throw error;
  const mappedCreditEntries = (Array.isArray(ledger?.creditEntries) ? ledger.creditEntries : [])
    .map(mapParentCreditEntry);

  return {
    invoices: (Array.isArray(ledger?.invoices) ? ledger.invoices : []).map(mapParentInvoice),
    bookings: (Array.isArray(ledger?.bookings) ? ledger.bookings : []).map(mapParentLedgerBooking),
    creditEntries: mappedCreditEntries,
    creditBalance: Number(ledger?.creditBalance ?? mappedCreditEntries
      .filter((entry) => entry.status === "posted")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)),
    fetchedAt: ledger?.fetchedAt || new Date().toISOString(),
  };
}

export async function fetchAdminBookingLedger({ limit = 120 } = {}) {
  assertSupabase();
  await currentUser();

  const { data, error } = await supabase.rpc("admin_booking_ledger", {
    p_limit: limit,
  });
  if (error) throw error;

  const mappedCreditEntries = (Array.isArray(data?.creditEntries) ? data.creditEntries : [])
    .map(mapParentCreditEntry);

  return {
    invoices: (Array.isArray(data?.invoices) ? data.invoices : []).map(mapParentInvoice),
    bookings: (Array.isArray(data?.bookings) ? data.bookings : []).map(mapParentLedgerBooking),
    creditEntries: mappedCreditEntries,
    creditBalance: mappedCreditEntries
      .filter((entry) => entry.status === "posted")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    fetchedAt: data?.fetchedAt || new Date().toISOString(),
  };
}

export async function upsertParentAccount(parent) {
  assertSupabase();
  const user = await currentUser();
  const email = String(parent?.email || user.email || "").trim().toLowerCase();
  if (!email) throw new Error("Parent email is required.");

  const payload = {
    profile_id: user.id,
    full_name: parent?.fullName || parent?.full_name || user.user_metadata?.full_name || email,
    email,
    phone: parent?.phone || null,
    billing_address: parent?.billingAddress || parent?.billing_address || {},
    emergency_contact: parent?.emergencyContact || parent?.emergency_contact || {},
    marketing_preferences: parent?.marketingPreferences || parent?.marketing_preferences || {},
  };
  if (parent?.migrationMetadata || parent?.migration_metadata) payload.migration_metadata = parent.migrationMetadata || parent.migration_metadata;

  const { data, error } = await supabase
    .from("parent_accounts")
    .upsert(payload, { onConflict: "email" })
    .select("id, profile_id, full_name, email, phone, billing_address, emergency_contact, marketing_preferences, portal_status, external_source, external_id, registered_centres, migration_metadata")
    .single();

  if (error) throw error;
  return mapParentAccount(data);
}

export async function createChildProfile(child = {}) {
  assertSupabase();
  const parentAccount = await fetchParentAccount();
  if (!parentAccount?.id) throw new Error("Create or sign in to a parent account before adding a child.");

  const payload = {
    parent_account_id: parentAccount.id,
    full_name: child.fullName || child.full_name || child.name || "Child",
    preferred_name: child.preferredName || child.preferred_name || child.firstName || null,
    date_of_birth: child.dateOfBirth || child.date_of_birth || child.dob || null,
    school_name: child.schoolName || child.school_name || child.school || null,
    year_group: child.yearGroup || child.year_group || child.classroom || child.year || null,
    medical_notes: child.medicalNotes || child.medical_notes || "",
    allergy_notes: child.allergyNotes || child.allergy_notes || "",
    dietary_notes: child.dietaryNotes || child.dietary_notes || "",
    authorised_collectors: child.authorisedCollectors || child.authorised_collectors || [],
    consents: child.consents || {},
    flags: child.flags || [],
    active: child.active !== false,
  };
  if (child.migrationMetadata || child.migration_metadata) payload.migration_metadata = child.migrationMetadata || child.migration_metadata;

  const { data, error } = await supabase
    .from("child_profiles")
    .insert(payload)
    .select(`
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
      migration_metadata
    `)
    .single();

  if (error) throw error;
  return mapChildProfile(data);
}

export async function updateChildProfile(childId, child = {}) {
  assertSupabase();
  if (!childId) throw new Error("Choose a child profile to update.");
  const payload = {
    full_name: child.fullName || child.full_name || child.name || "Child",
    preferred_name: child.preferredName || child.preferred_name || child.firstName || null,
    date_of_birth: child.dateOfBirth || child.date_of_birth || child.dob || null,
    school_name: child.schoolName || child.school_name || child.school || null,
    year_group: child.yearGroup || child.year_group || child.classroom || child.year || null,
    medical_notes: child.medicalNotes || child.medical_notes || "",
    allergy_notes: child.allergyNotes || child.allergy_notes || "",
    dietary_notes: child.dietaryNotes || child.dietary_notes || "",
    authorised_collectors: child.authorisedCollectors || child.authorised_collectors || [],
    consents: child.consents || {},
    flags: child.flags || [],
    active: child.active !== false,
  };
  if (child.migrationMetadata || child.migration_metadata) payload.migration_metadata = child.migrationMetadata || child.migration_metadata;
  const { data, error } = await supabase
    .from("child_profiles")
    .update(payload)
    .eq("id", childId)
    .select(`
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
      migration_metadata
    `)
    .single();
  if (error) throw error;
  return mapChildProfile(data);
}

export async function createParentBooking(request) {
  assertSupabase();
  const items = normaliseBookingItems(request.items || []);
  if (!items.length) throw new Error("Choose at least one session before booking.");
  const clientRequestId = request.clientRequestId || request.metadata?.clientRequestId || request.metadata?.localDraftId || "";

  const { data, error } = await supabase.functions.invoke("create-parent-booking", {
    body: {
      parent: request.parent || {},
      booking: request.booking || {},
      clientRequestId,
      paymentMethod: request.paymentMethod || "card",
      paymentPlan: request.paymentPlan || "pay_now",
      paymentRoute: request.paymentRoute || items[0]?.paymentRoute || "ponchopay_card_voucher",
      applyAccountCredit: request.applyAccountCredit === true,
      depositAmount: request.depositAmount || 0,
      cancellationHours: request.cancellationHours ?? 24,
      amendmentHours: request.amendmentHours ?? 24,
      source: request.source || "parent_portal",
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
      metadata: {
        ...(request.metadata || {}),
        clientRequestId,
      },
      items: items.map((item) => ({
        childId: item.childId,
        childName: item.childName,
        sessionBlockId: item.sessionBlockId,
        labSessionId: item.labSessionId,
        sessionDate: item.sessionDate,
        sessionLabel: item.sessionLabel,
        quantity: item.quantity,
        metadata: item.metadata || {},
      })),
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createPonchoPayCheckout(payload) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("ponchopay-create-checkout", {
    body: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createParentCreditTopUp({ amount, siteName } = {}) {
  assertSupabase();
  const { data, error } = await supabase.functions.invoke("create-parent-credit-topup", {
    body: { amount, siteName },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Unable to start credit top-up.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function cancelParentBooking({ bookingId, reason = "" } = {}) {
  assertSupabase();
  if (!bookingId) throw new Error("Choose a booking to cancel.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "cancel",
      bookingId,
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function cancelParentStaffAdHocBooking({ bookingId, reason = "" } = {}) {
  assertSupabase();
  if (!bookingId) throw new Error("Choose an ad-hoc booking to cancel.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "cancel_staff_adhoc",
      bookingId,
      reason,
    },
  });
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail || error.message || "Unable to cancel the ad-hoc booking.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function removeParentBookingItems({ bookingId, bookingItemIds = [], reason = "" } = {}) {
  assertSupabase();
  const ids = Array.isArray(bookingItemIds) ? bookingItemIds.filter(Boolean) : [];
  if (!bookingId) throw new Error("Choose a booking to amend.");
  if (!ids.length) throw new Error("Choose at least one session to remove.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "remove_items",
      bookingId,
      bookingItemIds: ids,
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function addParentBookingItems({ bookingId, items = [], reason = "" } = {}) {
  assertSupabase();
  const normalisedItems = normaliseBookingItems(items);
  if (!bookingId) throw new Error("Choose a booking to amend.");
  if (!normalisedItems.length) throw new Error("Choose at least one session to add.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action: "add_items",
      bookingId,
      items: normalisedItems.map((item) => ({
        childId: item.childId,
        childName: item.childName,
        sessionBlockId: item.sessionBlockId,
        labSessionId: item.labSessionId,
        sessionDate: item.sessionDate,
        sessionLabel: item.sessionLabel,
        quantity: item.quantity,
        metadata: item.metadata || {},
      })),
      reason,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateLivePaymentAdminAction({ invoiceId, action, note = "", amount = null, reason = "", metadata = {} } = {}) {
  assertSupabase();
  if (!invoiceId) throw new Error("Choose an invoice first.");
  if (!action) throw new Error("Choose a payment action.");
  const { data, error } = await supabase.functions.invoke("update-parent-booking", {
    body: {
      action,
      invoiceId,
      note,
      amount,
      reason,
      metadata,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function upsertLiveBookingSessionSetup(setup = {}) {
  assertSupabase();
  const payload = {
    school: String(setup.school || "").trim(),
    dateFrom: setup.dateFrom,
    dateTo: setup.dateTo,
    sessionLabel: String(setup.sessionLabel || "").trim(),
    timeWindow: String(setup.timeWindow || "").trim(),
    price: setup.price,
    capacity: setup.capacity,
    eligibility: String(setup.eligibility || "").trim(),
    paymentRoute: String(setup.paymentRoute || "").trim(),
    cancellationHours: setup.cancellationHours,
    applySimilar: setup.applySimilar !== false,
    applyScope: setup.applySimilar === false ? "single_session_range" : "matching_session_name",
  };
  if (!payload.school) throw new Error("School is required.");
  if (!payload.dateFrom || !payload.dateTo) throw new Error("Choose a date range.");
  const { data, error } = await supabase.rpc("admin_upsert_booking_session_setup", {
    p_setup: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function upsertLiveBookingSessionOverride(override = {}) {
  assertSupabase();
  const status = String(override.status || "").trim();
  const payload = {
    school: String(override.school || "").trim(),
    sessionDate: override.sessionDate,
    sessionLabel: String(override.sessionLabel || "").trim(),
    timeWindow: String(override.timeWindow || "").trim(),
    price: override.price,
    capacity: override.capacity,
    status,
    parentBookable: override.parentBookable !== false && !["closed", "cancelled", "full"].includes(status),
    eligibility: String(override.eligibility || "").trim(),
    paymentRoute: String(override.paymentRoute || "").trim(),
    cancellationHours: override.cancellationHours,
    notes: String(override.notes || "").trim(),
  };
  if (!payload.school) throw new Error("School is required.");
  if (!payload.sessionDate) throw new Error("Choose the day to override.");
  const { data, error } = await supabase.rpc("admin_upsert_booking_session_override", {
    p_override: payload,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function mapBookableSession(row) {
  const programme = row.programmes || {};
  const location = programme.locations || {};
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    status: row.status,
    label: row.booking_label || programme.name || "Session",
    price: Number(row.price || 0),
    paymentRoute: row.payment_route,
    cancellationHours: row.cancellation_hours,
    amendmentHours: row.amendment_hours,
    eligibility: row.eligibility || {},
    programme: {
      id: programme.id,
      name: programme.name,
      category: programme.category,
    },
    site: {
      id: location.id,
      name: location.name,
      area: location.area,
    },
    blocks: (row.session_blocks || [])
      .filter((block) => block.parent_bookable !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((block) => ({
        id: block.id,
        label: block.label,
        startsAt: block.starts_at,
        endsAt: block.ends_at,
        price: Number(block.price || row.price || 0),
        capacity: block.capacity ?? row.capacity,
      })),
  };
}

function mapParentAccount(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountHolderRole: row.account_holder_role || "primary",
    accountHolderStatus: row.account_holder_status || "active",
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    billingAddress: row.billing_address || {},
    emergencyContact: row.emergency_contact || {},
    marketingPreferences: row.marketing_preferences || {},
    portalStatus: row.portal_status || "",
    archivedAt: row.archived_at || "",
    archiveReason: row.archive_reason || "",
    externalSource: row.external_source || "",
    externalId: row.external_id || "",
    registeredCentres: row.registered_centres || [],
    migrationMetadata: row.migration_metadata || {},
    linkedAccountHolders: (row.parent_account_holders || []).map((holder) => ({
      id: holder.id,
      email: holder.email,
      fullName: holder.full_name,
      role: holder.role || "secondary",
      status: holder.status || "invited",
      invitedAt: holder.invited_at,
      acceptedAt: holder.accepted_at,
      permissions: holder.permissions || {},
    })),
    children: (row.child_profiles || []).filter((child) => child.active !== false && !child.archived_at).map(mapChildProfile),
  };
}

function mapChildProfile(child) {
  return {
    id: child.id,
    fullName: child.full_name,
    preferredName: child.preferred_name,
    dateOfBirth: child.date_of_birth,
    schoolName: child.school_name,
    yearGroup: child.year_group,
    medicalNotes: child.medical_notes,
    allergyNotes: child.allergy_notes,
    dietaryNotes: child.dietary_notes,
    authorisedCollectors: child.authorised_collectors || [],
    consents: child.consents || {},
    flags: child.flags || [],
    active: child.active,
    archivedAt: child.archived_at || "",
    archiveReason: child.archive_reason || "",
    externalSource: child.external_source || "",
    externalId: child.external_id || "",
    migrationMetadata: child.migration_metadata || child.consents?.registration?.migration || {},
  };
}

function mapParentInvoice(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    parentId: row.parent_id,
    parentEmail: row.parent_email,
    providerPaymentId: row.provider_payment_id,
    providerReference: row.provider_reference,
    totalAmount: Number(row.total_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    refundedAmount: Number(row.refunded_amount || 0),
    balance: Number(row.balance || 0),
    currency: row.currency || "GBP",
    paymentStatus: row.payment_status,
    parentPortalStatus: row.parent_portal_status,
    receiptStatus: row.receipt_status,
    financeStatus: row.finance_status,
    lastProviderEventId: row.last_provider_event_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    receipts: asArray(row.booking_receipts).map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receipt_number,
      amount: Number(receipt.amount || 0),
      currency: receipt.currency || "GBP",
      deliveryStatus: receipt.delivery_status,
      issuedAt: receipt.issued_at,
      paymentId: receipt.payment_id,
      providerReference: receipt.provider_reference,
      providerEventId: receipt.provider_event_id,
      metadata: receipt.metadata || {},
    })),
    adminActions: asArray(row.booking_payment_admin_actions).map((action) => ({
      id: action.id,
      action: action.action,
      status: action.status,
      actorEmail: action.actor_email,
      actorRole: action.actor_role,
      parentEmail: action.parent_email,
      providerReference: action.provider_reference,
      messageLogId: action.message_log_id,
      note: action.note,
      metadata: action.metadata || {},
      createdAt: action.created_at,
    })),
    checkoutSessions: asArray(row.ponchopay_checkout_sessions).map((session) => ({
      id: session.id,
      providerPaymentId: session.provider_payment_id,
      checkoutUrl: session.provider_checkout_url,
      providerReference: session.provider_reference,
      amount: Number(session.amount || 0),
      currency: session.currency || "GBP",
      paymentMethod: session.payment_method,
      paymentPlan: session.payment_plan,
      status: session.status,
      errorMessage: session.error_message,
      expiresAt: session.expires_at,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    })),
  };
}

function mapParentCreditEntry(row) {
  return {
    id: row.id,
    parentAccountId: row.parent_account_id,
    parentId: row.parent_id,
    bookingId: row.booking_id,
    invoiceId: row.invoice_id,
    entryType: row.entry_type,
    amount: Number(row.amount || 0),
    currency: row.currency || "GBP",
    status: row.status || "posted",
    description: row.description || "Account credit adjustment",
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParentLedgerBooking(row) {
  return {
    id: row.id,
    bookingReference: row.booking_reference,
    invoiceId: row.invoice_id,
    parentEmail: row.parent_email,
    parentName: row.parent_name,
    status: row.status,
    source: row.source || "",
    paymentMethod: row.payment_method,
    paymentPlan: row.payment_plan,
    paymentRoute: row.payment_route,
    totalAmount: Number(row.total_amount || 0),
    dueToday: Number(row.due_today || 0),
    outstandingBalance: Number(row.outstanding_balance || 0),
    cancellationDeadline: row.cancellation_deadline,
    amendmentDeadline: row.amendment_deadline,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: asArray(row.booking_items).map((item) => ({
      id: item.id,
      childId: item.child_id,
      sessionId: item.session_id,
      sessionBlockId: item.session_block_id,
      childName: item.child_name,
      siteName: item.site_name,
      programmeName: item.programme_name,
      sessionLabel: item.session_label,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      quantity: Number(item.quantity || 0),
      unitAmount: Number(item.unit_amount || 0),
      lineTotal: Number(item.line_total || 0),
      status: item.status,
      metadata: item.metadata || {},
    })),
  };
}

function normaliseBookingItems(items) {
  return items.map((item) => ({
    childId: item.childId || item.child_id || null,
    childName: item.childName || item.child_name || "",
    sessionId: item.sessionId || item.session_id || "",
    sessionBlockId: item.sessionBlockId || item.session_block_id || null,
    labSessionId: item.labSessionId || item.lab_session_id || item.metadata?.labSessionId || "",
    sessionDate: item.sessionDate || item.session_date || item.metadata?.sessionDate || "",
    siteName: item.siteName || item.site_name || "",
    programmeName: item.programmeName || item.programme_name || "",
    sessionLabel: required(item.sessionLabel || item.session_label || item.metadata?.labBlockLabel, "Session label"),
    startsAt: item.startsAt || item.starts_at || "",
    endsAt: item.endsAt || item.ends_at || "",
    quantity: Math.max(1, Number(item.quantity || 1)),
    unitAmount: roundMoney(Number(item.unitAmount ?? item.unit_amount ?? 0)),
    paymentRoute: item.paymentRoute || item.payment_route || "ponchopay_card_voucher",
    capacitySnapshot: item.capacitySnapshot || item.capacity_snapshot || {},
    metadata: item.metadata || {},
    status: item.status || "reserved",
  }));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
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

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("Sign in before booking.");
  return data.user;
}

function assertSupabase() {
  if (!bookingSystemConfigured()) throw new Error("Supabase is not configured.");
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
