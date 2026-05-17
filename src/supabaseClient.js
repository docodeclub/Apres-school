import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const enquiryFunctionName = import.meta.env.VITE_ENQUIRY_FUNCTION_NAME || "notify-public-enquiry";
const coverMoveFunctionName = import.meta.env.VITE_COVER_MOVE_FUNCTION_NAME || "notify-cover-move";
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
      contract_type,
      primary_site,
      pay_rate,
      annual_salary,
      photo_storage_path,
      photo_url,
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
      uploaded_at,
      hr_file_categories(id, name, sensitivity),
      staff_records(preferred_name, profiles(full_name, email))
    `)
    .is("archived_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(isStaff ? 40 : 160);

  const hrCategoriesQuery = supabase
    .from("hr_file_categories")
    .select("id, name, sensitivity")
    .eq("active", true)
    .order("name", { ascending: true });

  const [staffResult, sessionsResult, documentsResult, enquiriesResult, hrFilesResult, hrCategoriesResult] = await Promise.all([
    staffQuery,
    sessionsQuery,
    documentsQuery,
    enquiriesQuery,
    hrFilesQuery,
    hrCategoriesQuery,
  ]);

  const firstError = [staffResult.error, sessionsResult.error, documentsResult.error, enquiriesResult.error].find(Boolean);
  if (firstError) throw firstError;

  const staff = mapStaffRecords(staffResult.data || []);
  await attachStaffPhotoUrls(staff);
  const hrFiles = hrFilesResult.error ? [] : mapHrFiles(hrFilesResult.data || []);
  await attachHrFileUrls(hrFiles);

  return {
    staff,
    sessions: mapSessions(sessionsResult.data || []),
    documents: mapDocuments(documentsResult.data || []),
    enquiries: mapEnquiries(enquiriesResult.data || []),
    hrFiles,
    hrFileCategories: hrCategoriesResult.error ? [] : hrCategoriesResult.data || [],
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
      email: profile?.email || "",
      role: record.job_role || profile?.role || "Staff",
      location: record.primary_site || record.employment_type || "Assigned sites",
      compliance: scr?.admin_review?.status || "Review needed",
      dbsRenewal: scr?.dbs?.renewalDate || scr?.dbs?.renewal_date || "Not recorded",
      safeguardingExpiry: scr?.safeguarding?.expiryDate || scr?.safeguarding?.expiry_date || "Not recorded",
      firstAidExpiry: scr?.first_aid?.expiryDate || scr?.first_aid?.expiry_date || "Not required",
      payRate: Number(record.pay_rate || 0),
      annualSalary: Number(record.annual_salary || 0),
      contractType: record.contract_type || record.employment_type || "Not recorded",
      photoStoragePath: record.photo_storage_path || "",
      photoUrl: record.photo_url || "",
    };
  });
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
      uploaded_at,
      hr_file_categories(id, name, sensitivity),
      staff_records(preferred_name, profiles(full_name, email))
    `)
    .single();

  if (error) throw error;
  const [file] = mapHrFiles([data]);
  await attachHrFileUrls([file]);
  return file;
}

export async function uploadHrFile(payload, file) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!payload?.staffRecordId || !file) throw new Error("Choose a staff member and file.");

  const extension = file.name?.split(".").pop()?.toLowerCase() || "pdf";
  const safeExtension = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "webp"].includes(extension) ? extension : "pdf";
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

  try {
    return await createHrFile({
      ...payload,
      storagePath,
      fileUrl: "",
    });
  } catch (error) {
    await supabase.storage.from(staffHrFilesBucket).remove([storagePath]);
    throw error;
  }
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
