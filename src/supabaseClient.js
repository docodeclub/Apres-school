import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const enquiryFunctionName = import.meta.env.VITE_ENQUIRY_FUNCTION_NAME || "notify-public-enquiry";
const coverMoveFunctionName = import.meta.env.VITE_COVER_MOVE_FUNCTION_NAME || "notify-cover-move";

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

export async function updateStaffPassword(password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
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

export function normalizeRole(role) {
  const value = String(role || "staff").toLowerCase();
  if (value === "superadmin") return "Superadmin";
  if (value === "admin") return "Admin";
  if (value === "manager") return "Manager";
  return "Staff";
}

export async function fetchPlatformData({ userId, role }) {
  if (!supabase || !userId) throw new Error("Supabase is not configured.");

  const isStaff = normalizeRole(role) === "Staff";
  const staffQuery = supabase
    .from("staff_records")
    .select(`
      id,
      profile_id,
      preferred_name,
      job_role,
      employment_type,
      start_date,
      profiles(full_name, email, role),
      scr_checks(admin_review, dbs, safeguarding, first_aid)
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
      archived_at,
      document_assignments(acknowledged_at, due_at, staff_record_id)
    `)
    .is("archived_at", null)
    .limit(30);

  const enquiriesQuery = isStaff
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("enquiries")
        .select("id, name, email, organisation, type, subject, message, status, owner_id, internal_notes, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

  const [staffResult, sessionsResult, documentsResult, enquiriesResult] = await Promise.all([
    staffQuery,
    sessionsQuery,
    documentsQuery,
    enquiriesQuery,
  ]);

  const firstError = [staffResult.error, sessionsResult.error, documentsResult.error, enquiriesResult.error].find(Boolean);
  if (firstError) throw firstError;

  return {
    staff: mapStaffRecords(staffResult.data || []),
    sessions: mapSessions(sessionsResult.data || []),
    documents: mapDocuments(documentsResult.data || []),
    enquiries: mapEnquiries(enquiriesResult.data || []),
  };
}

function mapStaffRecords(records) {
  return records.map((record) => {
    const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
    const scr = Array.isArray(record.scr_checks) ? record.scr_checks[0] : record.scr_checks;
    return {
      id: record.id,
      profileId: record.profile_id,
      name: record.preferred_name || profile?.full_name || "Staff member",
      role: record.job_role || profile?.role || "Staff",
      location: record.employment_type || "Assigned sites",
      compliance: scr?.admin_review?.status || "Review needed",
      dbsRenewal: scr?.dbs?.renewalDate || scr?.dbs?.renewal_date || "Not recorded",
      safeguardingExpiry: scr?.safeguarding?.expiryDate || scr?.safeguarding?.expiry_date || "Not recorded",
      firstAidExpiry: scr?.first_aid?.expiryDate || scr?.first_aid?.expiry_date || "Not required",
      payRate: Number(record.pay_rate || 0),
    };
  });
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

function mapDocuments(records) {
  return records.map((record) => {
    const assignments = record.document_assignments || [];
    const read = assignments.filter((assignment) => assignment.acknowledged_at).length;
    const assigned = assignments.length;
    return {
      id: record.id,
      name: record.title,
      version: record.version,
      assigned,
      read,
      status: assigned && read < assigned ? `Chase ${assigned - read}` : "Complete",
    };
  });
}

function mapEnquiries(records) {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    type: record.type,
    organisation: record.organisation,
    subject: record.subject || record.message,
    status: formatCrmStatus(record.status),
    owner: parseInternalNotes(record.internal_notes).owner || (record.owner_id ? "Assigned" : "Unassigned"),
    note: parseInternalNotes(record.internal_notes).note || "",
    nextAction: parseInternalNotes(record.internal_notes).nextAction || "call/email follow-up",
    source: "supabase",
  }));
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

export async function sendCoverMoveNotifications(payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(coverMoveFunctionName, {
    body: payload,
  });
  if (error) throw error;
  return data;
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
