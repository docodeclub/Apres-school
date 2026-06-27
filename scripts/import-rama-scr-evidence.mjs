#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const BUCKET = "staff-hr-files";
const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const replace = args.has("--replace");

const envFiles = [
  ".env",
  ".env.local",
  "/Users/lukecurrie/Documents/New project 3/.env.staging",
].filter((file) => existsSync(file));

for (const file of envFiles) {
  const contents = readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const serviceKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const adminEmail = process.env.APRES_ADMIN_EMAIL;
const adminPassword = process.env.APRES_ADMIN_PASSWORD;

const files = [
  {
    sourcePath: "/Users/lukecurrie/Downloads/IMG_1148.JPG",
    title: "Advanced Designated Safeguarding Lead (DSL) Refresher",
    issueDate: "2024-03-12",
    expiryDate: null,
    evidenceKey: "safeguarding",
    notes: "Lambeth School Services certificate of attendance for Advanced DSL Refresher Online, completed 12 March 2024. Certificate does not show an expiry date.",
    scrEvidence: {
      status: "Approved",
      reference: "Advanced Designated Safeguarding Lead (DSL) Refresher",
      course: "Advanced Designated Safeguarding Lead (DSL) Refresher",
      provider: "Lambeth School Services",
      completionDate: "2024-03-12",
      issueDate: "2024-03-12",
      expiryDate: "",
      noExpiryShown: true,
      verifiedAt: new Date().toISOString(),
    },
  },
  {
    sourcePath: "/Users/lukecurrie/Downloads/IMG_1967.JPG",
    title: "Level 3 Award in Paediatric First Aid",
    issueDate: "2024-03-28",
    expiryDate: "2027-03-28",
    evidenceKey: "firstAid",
    notes: "London Training Association Level 3 Award in Paediatric First Aid. Issue date 28 March 2024. Certificate states valid for 3 years.",
    scrEvidence: {
      status: "Approved",
      reference: "Level 3 Award in Paediatric First Aid",
      qualification: "Level 3 Award in Paediatric First Aid",
      qualificationType: "Level 3 Award in Paediatric First Aid",
      provider: "London Training Association",
      issueDate: "2024-03-28",
      expiryDate: "2027-03-28",
      validForYears: 3,
      unitNumber: "2459087",
      qualificationNumber: "600/9366/1",
      verifiedAt: new Date().toISOString(),
    },
  },
  {
    sourcePath: "/Users/lukecurrie/Downloads/IMG_9684.JPG",
    title: "Leading SEND Inclusion in Early Years",
    issueDate: "2021-04-30",
    expiryDate: null,
    evidenceKey: "eyfsLevel",
    notes: "Wandsworth eight-part programme certificate for Leading SEND Inclusion in Early Years, dated March-April 2021. Certificate does not show an expiry date.",
    scrEvidence: {
      status: "Approved",
      reference: "Leading SEND Inclusion in Early Years",
      course: "Leading SEND Inclusion in Early Years",
      provider: "Wandsworth",
      issueDate: "2021-04-30",
      expiryDate: "",
      noExpiryShown: true,
      verifiedAt: new Date().toISOString(),
    },
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function slug(value) {
  return normalise(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "evidence";
}

function profileOf(staff) {
  return Array.isArray(staff.profiles) ? staff.profiles[0] : staff.profiles;
}

function displayStaff(staff) {
  const profile = profileOf(staff);
  const name = profile?.full_name || staff.preferred_name || "Unknown staff";
  const email = profile?.email ? ` · ${profile.email}` : "";
  const site = staff.primary_site ? ` · ${staff.primary_site}` : "";
  return `${name}${email}${site}`;
}

function mergeEvidence(existingScr = {}, uploadedFiles = []) {
  const currentAdminReview = existingScr.admin_review || {};
  const currentChecklist = currentAdminReview.checklist || {};
  const currentEvidence = currentChecklist.evidence || currentAdminReview.evidence || {};
  const evidenceUpdates = {};

  for (const file of uploadedFiles) {
    evidenceUpdates[file.evidenceKey] = {
      ...(currentEvidence[file.evidenceKey] || {}),
      ...file.scrEvidence,
      title: file.title,
      storagePath: file.storagePath,
      fileType: "image/jpeg",
    };
  }

  const nextEvidence = {
    ...currentEvidence,
    ...evidenceUpdates,
  };

  return {
    safeguarding: {
      ...(existingScr.safeguarding || {}),
      checked: true,
      ...(evidenceUpdates.safeguarding || {}),
    },
    first_aid: {
      ...(existingScr.first_aid || {}),
      checked: true,
      qualification: "Level 3 Award in Paediatric First Aid",
      qualificationType: "Level 3 Award in Paediatric First Aid",
      provider: "London Training Association",
      issueDate: "2024-03-28",
      expiryDate: "2027-03-28",
      ...(evidenceUpdates.firstAid || {}),
    },
    admin_review: {
      ...currentAdminReview,
      status: currentAdminReview.status || "Review needed",
      checklist: {
        ...currentChecklist,
        safeguarding: true,
        firstAid: true,
        eyfsLevel: true,
        evidence: nextEvidence,
        updatedAt: new Date().toISOString(),
      },
      evidence: nextEvidence,
      updatedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
}

if (!serviceKey && (!anonKey || !adminEmail || !adminPassword)) {
  fail("Missing credentials. Set APRES_SERVICE_ROLE_KEY, or set VITE_SUPABASE_ANON_KEY plus APRES_ADMIN_EMAIL and APRES_ADMIN_PASSWORD.");
}

for (const file of files) {
  if (!existsSync(file.sourcePath)) fail(`Missing source file: ${file.sourcePath}`);
}

const supabase = createClient(supabaseUrl, serviceKey || anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (!serviceKey) {
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (signInError) fail(`Could not sign in admin user: ${signInError.message}`);
}

const { data: staffRecords, error: staffError } = await supabase
  .from("staff_records")
  .select("id, preferred_name, primary_site, job_role, archived_at, profiles!staff_records_profile_id_fkey(full_name, email), scr_checks(safeguarding, first_aid, admin_review, updated_at)")
  .is("archived_at", null)
  .order("preferred_name", { ascending: true });
if (staffError) fail(`Could not load staff records: ${staffError.message}`);

const matches = (staffRecords || []).filter((staff) => {
  const profile = profileOf(staff);
  const haystack = normalise([staff.preferred_name, staff.job_role, staff.primary_site, profile?.full_name, profile?.email].filter(Boolean).join(" "));
  return haystack.includes("rama") && haystack.includes("singh");
});

if (matches.length !== 1) {
  console.log("Rama match check failed.");
  for (const match of matches) console.log(`- ${displayStaff(match)}`);
  fail(`Expected exactly one active Rama Singh staff record, found ${matches.length}.`);
}

const staff = matches[0];
const { data: categories, error: categoryError } = await supabase
  .from("hr_file_categories")
  .select("id, name, sensitivity")
  .ilike("name", "%training%")
  .limit(1);
if (categoryError) fail(`Could not load HR file categories: ${categoryError.message}`);
const trainingCategory = categories?.[0];
if (!trainingCategory?.id) fail("Could not find the Training Certificate HR file category.");

console.log(`Rama evidence import ${confirm ? "CONFIRM" : "dry-run"}`);
console.log(`Matched staff: ${displayStaff(staff)}`);
for (const file of files) {
  console.log(`- ${file.title} · issue ${file.issueDate}${file.expiryDate ? ` · expires ${file.expiryDate}` : " · no expiry shown"}`);
}

if (!confirm) {
  console.log("\nDry-run only. Re-run with --confirm to upload these private evidence files.");
  process.exit(0);
}

const uploadedFiles = [];
for (const file of files) {
  const { data: existing, error: existingError } = await supabase
    .from("staff_hr_files")
    .select("id, storage_path")
    .eq("staff_record_id", staff.id)
    .eq("category_id", trainingCategory.id)
    .eq("title", file.title)
    .eq("issue_date", file.issueDate)
    .neq("status", "archived");
  if (existingError) fail(`Could not check existing evidence for ${file.title}: ${existingError.message}`);

  if (existing?.length && !replace) {
    console.log(`SKIP ${file.title}: already attached.`);
    uploadedFiles.push({ ...file, storagePath: existing[0].storage_path });
    continue;
  }

  if (existing?.length && replace) {
    await supabase.from("staff_hr_files").update({ status: "archived", archived_at: new Date().toISOString() }).in("id", existing.map((item) => item.id));
    const paths = existing.map((item) => item.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  }

  const bytes = await readFile(file.sourcePath);
  const storagePath = `${staff.id}/rama-scr-${file.issueDate}-${slug(file.title)}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    cacheControl: "3600",
    contentType: "image/jpeg",
    upsert: false,
  });
  if (uploadError) fail(`Upload failed for ${file.title}: ${uploadError.message}`);

  const { error: insertError } = await supabase.from("staff_hr_files").insert({
    staff_record_id: staff.id,
    category_id: trainingCategory.id,
    title: file.title,
    storage_path: storagePath,
    file_url: null,
    issue_date: file.issueDate,
    expiry_date: file.expiryDate,
    status: "active",
    notes: file.notes,
  });
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    fail(`Metadata insert failed for ${file.title}: ${insertError.message}`);
  }
  uploadedFiles.push({ ...file, storagePath });
  console.log(`DONE ${file.title}`);
}

const existingScr = Array.isArray(staff.scr_checks) ? staff.scr_checks[0] : staff.scr_checks;
const merged = mergeEvidence(existingScr || {}, uploadedFiles);
const { error: scrError } = await supabase
  .from("scr_checks")
  .upsert({
    staff_record_id: staff.id,
    ...merged,
  }, { onConflict: "staff_record_id" });
if (scrError) fail(`SCR update failed for Rama: ${scrError.message}`);

console.log("\nRama SCR evidence import complete.");
