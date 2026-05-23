#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const BUCKET = "staff-hr-files";
const PERIOD = process.env.PAYSLIP_PERIOD || "2026-03";
const ISSUE_DATE = `${PERIOD}-01`;
const PERIOD_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${PERIOD}-01T00:00:00Z`));
const DEFAULT_DIR = `/Users/lukecurrie/Downloads/Payslips/${PERIOD_LABEL}`;

const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const replace = args.has("--replace");
const payslipDir = process.env.PAYSLIP_DIR || DEFAULT_DIR;
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const serviceKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const adminEmail = process.env.APRES_ADMIN_EMAIL;
const adminPassword = process.env.APRES_ADMIN_PASSWORD;

const expectedFilesFromEnv = process.env.PAYSLIP_FILES
  ? process.env.PAYSLIP_FILES.split(",").map((file) => file.trim()).filter(Boolean)
  : [];

const fileHints = {
  "A Alekes.pdf": ["angel", "elekes", "alekes"],
  "A Nicholson.pdf": ["amanda", "nicholson"],
  "A Sewell.pdf": ["sewell"],
  "B Harrison.pdf": ["brenda", "harrison"],
  "C Hastoy.pdf": ["catherine", "hastoy"],
  "I Bailey.pdf": ["imogen", "bailey"],
  "J Azebaze-Ayanam.pdf": ["joelle", "azebaze", "ayanam"],
  "J Dixon.pdf": ["jeremy", "dixon"],
  "J Jackson.pdf": ["jackson"],
  "J Marsden.pdf": ["marsden"],
  "J Rose.pdf": ["julie", "rose"],
  "J watts.pdf": ["jack", "watts"],
  "K Foley.pdf": ["kelly", "foley"],
  "Lindsay.pdf": ["lindsay"],
  "R Singh.pdf": ["rama", "singh"],
  "S Fung Au.pdf": ["siu", "fung", "au", "idy"],
  "W Pheiffer.pdf": ["wendy", "pheiffer"],
  "Abigail.pdf": ["abi", "abigail", "sewell"],
  "Amanda.pdf": ["amanda", "nicholson"],
  "Angel.pdf": ["angel", "elekes"],
  "Brenda.pdf": ["brenda", "harrison"],
  "Cath.pdf": ["catherine", "cath", "hastoy"],
  "Imogen.pdf": ["imogen", "bailey"],
  "Jack.pdf": ["jack", "watts"],
  "Jeremy.pdf": ["jeremy", "dixon"],
  "Joelle.pdf": ["joelle", "azebaze", "ayanam"],
  "Josephine.pdf": ["maisie", "marsden"],
  "Josie.pdf": ["josie", "jackson"],
  "Julie.pdf": ["julie", "rose"],
  "Kelly.pdf": ["kelly", "foley"],
  "Rama.pdf": ["rama", "singh"],
  "Sadie.pdf": ["sadie", "woodley"],
  "Sadie(1).pdf": ["sadie", "woodley"],
  "Siu.pdf": ["siu", "fung", "au", "idy"],
  "Wendy.pdf": ["wendy", "pfeiffer", "pheiffer"],
};

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

function slug(value) {
  return normalise(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "payslip";
}

function staffText(staff) {
  return normalise([
    staff.preferred_name,
    staff.job_role,
    staff.employment_type,
    staff.primary_site,
    staff.profiles?.full_name,
    staff.profiles?.email,
  ].filter(Boolean).join(" "));
}

function scoreStaff(fileName, staff) {
  const hints = fileHints[fileName] || [];
  const haystack = staffText(staff);
  let score = 0;
  for (const hint of hints) {
    if (hint && haystack.includes(normalise(hint))) score += 10;
  }
  const stem = normalise(fileName.replace(/\.pdf$/i, ""));
  for (const part of stem.split(" ").filter(Boolean)) {
    if (part.length > 1 && haystack.includes(part)) score += 3;
  }
  return score;
}

function displayStaff(staff) {
  const fullName = staff.profiles?.full_name || staff.preferred_name || "Unknown";
  const preferred = staff.preferred_name && staff.preferred_name !== fullName ? ` (${staff.preferred_name})` : "";
  const email = staff.profiles?.email ? ` · ${staff.profiles.email}` : "";
  return `${fullName}${preferred}${email}`;
}

function payslipTitle(fileName) {
  if (fileName === "Sadie(1).pdf") return `${PERIOD_LABEL} payment summary`;
  if (/\(\d+\)\.pdf$/i.test(fileName)) return `${PERIOD_LABEL} payslip - additional document`;
  return `${PERIOD_LABEL} payslip`;
}

function resolveMapping(fileName, staff) {
  const scores = staff
    .map((person) => ({ person, score: scoreStaff(fileName, person) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1];
  if (!best) return { status: "unmatched", candidates: [] };
  if (second && second.score === best.score) {
    return { status: "ambiguous", candidates: scores.filter((item) => item.score === best.score).map((item) => item.person) };
  }
  return { status: "matched", staff: best.person, score: best.score };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!serviceKey && (!anonKey || !adminEmail || !adminPassword)) {
  fail("Missing credentials. Set APRES_SERVICE_ROLE_KEY, or set VITE_SUPABASE_ANON_KEY plus APRES_ADMIN_EMAIL and APRES_ADMIN_PASSWORD.");
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

const foundFiles = await readdir(payslipDir);
const expectedFiles = expectedFilesFromEnv.length
  ? expectedFilesFromEnv
  : foundFiles.filter((file) => file.toLowerCase().endsWith(".pdf")).sort((a, b) => a.localeCompare(b));
const missingFiles = expectedFiles.filter((file) => !foundFiles.includes(file));
if (missingFiles.length) fail(`Missing expected payslip PDFs:\n${missingFiles.map((file) => `- ${file}`).join("\n")}`);

const { data: staff, error: staffError } = await supabase
  .from("staff_records")
  .select("id, preferred_name, job_role, employment_type, primary_site, profiles(full_name, email)")
  .is("archived_at", null)
  .order("preferred_name", { ascending: true });
if (staffError) fail(`Could not load staff records: ${staffError.message}`);

const { data: categories, error: categoryError } = await supabase
  .from("hr_file_categories")
  .select("id, name, sensitivity")
  .ilike("name", "%payslip%")
  .limit(1);
if (categoryError) fail(`Could not load HR file categories: ${categoryError.message}`);
const payslipCategory = categories?.[0];
if (!payslipCategory?.id) fail("Could not find the Payslip HR file category.");

const mappings = expectedFiles.map((fileName) => ({ fileName, ...resolveMapping(fileName, staff || []) }));
const unresolved = mappings.filter((item) => item.status !== "matched");

console.log(`Payslip import dry-run for ${PERIOD_LABEL}`);
console.log(`Directory: ${payslipDir}`);
console.log("");
for (const mapping of mappings) {
  if (mapping.status === "matched") {
    console.log(`OK  ${mapping.fileName} -> ${displayStaff(mapping.staff)}`);
  } else if (mapping.status === "ambiguous") {
    console.log(`??  ${mapping.fileName} matched more than one staff record:`);
    for (const candidate of mapping.candidates) console.log(`    - ${displayStaff(candidate)}`);
  } else {
    console.log(`NO  ${mapping.fileName} could not be matched to a staff record.`);
  }
}

if (unresolved.length) {
  fail(`\nImport stopped: ${unresolved.length} payslip file(s) need an exact staff match before upload.`);
}

if (!confirm) {
  console.log("\nDry-run only. Re-run with --confirm to upload these private payslips.");
  process.exit(0);
}

let uploaded = 0;
let skipped = 0;

for (const mapping of mappings) {
  const { data: existing, error: existingError } = await supabase
    .from("staff_hr_files")
    .select("id, title, issue_date, status, storage_path")
    .eq("staff_record_id", mapping.staff.id)
    .eq("category_id", payslipCategory.id)
    .eq("issue_date", ISSUE_DATE)
    .eq("title", payslipTitle(mapping.fileName))
    .neq("status", "archived");
  if (existingError) fail(`Could not check existing payslip for ${displayStaff(mapping.staff)}: ${existingError.message}`);

  if (existing?.length && !replace) {
    console.log(`SKIP ${mapping.fileName} -> ${displayStaff(mapping.staff)} already has a ${PERIOD_LABEL} payslip.`);
    skipped += 1;
    continue;
  }

  if (existing?.length && replace) {
    const paths = existing.map((item) => item.storage_path).filter(Boolean);
    const ids = existing.map((item) => item.id);
    await supabase.from("staff_hr_files").update({ status: "archived", archived_at: new Date().toISOString() }).in("id", ids);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  }

  const filePath = path.join(payslipDir, mapping.fileName);
  const fileBytes = await readFile(filePath);
  const storagePath = `${mapping.staff.id}/${PERIOD}-payslip-${slug(mapping.fileName)}-${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, fileBytes, {
    cacheControl: "3600",
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) fail(`Upload failed for ${mapping.fileName}: ${uploadError.message}`);

  const { error: insertError } = await supabase.from("staff_hr_files").insert({
    staff_record_id: mapping.staff.id,
    category_id: payslipCategory.id,
    title: payslipTitle(mapping.fileName),
    storage_path: storagePath,
    file_url: null,
    issue_date: ISSUE_DATE,
    expiry_date: null,
    status: "active",
    notes: `Payslip for ${PERIOD_LABEL} payroll run.`,
  });
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    fail(`Metadata insert failed for ${mapping.fileName}: ${insertError.message}`);
  }

  console.log(`DONE ${mapping.fileName} -> ${displayStaff(mapping.staff)}`);
  uploaded += 1;
}

console.log(`\nPayslip import complete. Uploaded: ${uploaded}. Skipped existing: ${skipped}.`);
