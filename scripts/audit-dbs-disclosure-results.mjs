#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const serviceKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const adminEmail = process.env.APRES_ADMIN_EMAIL;
const adminPassword = process.env.APRES_ADMIN_PASSWORD;

const disclosureRows = [
  { surname: "ELEKES", dob: "2001-11-19", applicationRef: "E0873119464", certificateNo: "001897639742", issueDate: "2024-10-04", terms: ["angel", "elekes", "alekes"] },
  { surname: "ROSE", dob: "1961-12-17", applicationRef: "E0873119200", certificateNo: "001898008401", issueDate: "2024-10-07", terms: ["julie", "rose"] },
  { surname: "WATTS", dob: "2001-01-05", applicationRef: "E0873290870", certificateNo: "001898280331", issueDate: "2024-10-09", terms: ["jack", "watts"] },
  { surname: "HARRISON", dob: "1964-11-08", applicationRef: "E0873570208", certificateNo: "001898619439", issueDate: "2024-10-10", terms: ["brenda", "harrison"] },
  { surname: "NEWLAND", dob: "2001-04-13", applicationRef: "E0874177630", certificateNo: "001898755098", issueDate: "2024-10-11", terms: ["sonny", "newland"] },
  { surname: "SNELL", dob: "1977-09-25", applicationRef: "E0873119373", certificateNo: "001898911282", issueDate: "2024-10-14", terms: ["snell"] },
  { surname: "WOODLEY", dob: "1978-08-11", applicationRef: "E0873292660", certificateNo: "001901359590", issueDate: "2024-10-31", terms: ["sadie", "woodley"] },
  { surname: "TOPPING", dob: "2005-07-22", applicationRef: "E0877531318", certificateNo: "001902110271", issueDate: "2024-11-06", terms: ["hannah", "topping"] },
  { surname: "LALLY", dob: "2004-10-13", applicationRef: "E0877531214", certificateNo: "001902110211", issueDate: "2024-11-06", terms: ["josie", "lally"] },
  { surname: "MARSHALL", dob: "2005-04-18", applicationRef: "E0877527730", certificateNo: "001902127873", issueDate: "2024-11-06", terms: ["joel", "marshall"] },
  { surname: "NICOLIN", dob: "1979-03-25", applicationRef: "E0884832057", certificateNo: "001909625370", issueDate: "2025-01-15", terms: ["amanda", "nicholson", "nicolin"] },
  { surname: "AZEBAZE AYANGMA", dob: "2007-12-18", applicationRef: "E0886155639", certificateNo: "001910951943", issueDate: "2025-01-24", terms: ["joelle", "azebaze", "ayanam", "ayangma"] },
  { surname: "KELLY", dob: "1997-01-07", applicationRef: "E0888337193", certificateNo: "001916508152", issueDate: "2025-03-10", terms: ["kelly"] },
  { surname: "GRANT", dob: "2002-08-12", applicationRef: "E0913830370", certificateNo: "001941644626", issueDate: "2025-09-26", terms: ["grant"] },
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

function staffText(staff) {
  const profile = Array.isArray(staff.profiles) ? staff.profiles[0] : staff.profiles;
  return normalise([
    staff.preferred_name,
    staff.date_of_birth,
    staff.job_role,
    staff.primary_site,
    profile?.full_name,
    profile?.email,
  ].filter(Boolean).join(" "));
}

function displayStaff(staff) {
  const profile = Array.isArray(staff.profiles) ? staff.profiles[0] : staff.profiles;
  const name = profile?.full_name || staff.preferred_name || "Unknown staff";
  const preferred = staff.preferred_name && staff.preferred_name !== name ? ` (${staff.preferred_name})` : "";
  const email = profile?.email ? ` · ${profile.email}` : "";
  const dob = staff.date_of_birth ? ` · DOB ${staff.date_of_birth}` : "";
  return `${name}${preferred}${email}${dob}`;
}

function dbsNumber(staff) {
  const scr = Array.isArray(staff.scr_checks) ? staff.scr_checks[0] : staff.scr_checks;
  const dbs = scr?.dbs || {};
  const checklist = scr?.admin_review?.checklist || {};
  const evidence = checklist.evidence?.dbs || scr?.admin_review?.evidence?.dbs || {};
  return dbs.number || dbs.dbsNumber || dbs.dbs_number || dbs.certificateNo || checklist.dbsNumber || evidence.number || evidence.dbsNumber || "";
}

function scoreStaff(row, staff) {
  const haystack = staffText(staff);
  let score = 0;
  for (const term of row.terms) {
    if (haystack.includes(normalise(term))) score += 12;
  }
  if (staff.date_of_birth && staff.date_of_birth === row.dob) score += 25;
  if (haystack.includes(normalise(row.surname))) score += 8;
  return score;
}

function resolveRow(row, staffRecords) {
  const candidates = staffRecords
    .map((staff) => ({ staff, score: scoreStaff(row, staff), currentDbs: dbsNumber(staff) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return { status: "unmatched", row, candidates: [] };
  if (second && second.score === best.score) {
    return {
      status: "ambiguous",
      row,
      candidates: candidates.filter((candidate) => candidate.score === best.score),
    };
  }
  return {
    status: best.currentDbs === row.certificateNo ? "updated" : best.currentDbs ? "different-current-dbs" : "matched-missing-dbs",
    row,
    staff: best.staff,
    score: best.score,
    currentDbs: best.currentDbs,
  };
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

const { data: staffRecords, error } = await supabase
  .from("staff_records")
  .select(`
    id,
    preferred_name,
    date_of_birth,
    job_role,
    primary_site,
    archived_at,
    profiles!staff_records_profile_id_fkey(full_name, email),
    scr_checks(dbs, admin_review, updated_at)
  `)
  .is("archived_at", null)
  .order("preferred_name", { ascending: true });

if (error) fail(`Could not load staff records: ${error.message}`);

const results = disclosureRows.map((row) => resolveRow(row, staffRecords || []));
const summary = results.reduce((totals, result) => {
  totals[result.status] = (totals[result.status] || 0) + 1;
  return totals;
}, {});

if (json) {
  console.log(JSON.stringify({
    source: "Disclosure-Results-27062026091744.pdf",
    checkedAt: new Date().toISOString(),
    summary,
    results: results.map((result) => ({
      status: result.status,
      surname: result.row.surname,
      dateOfBirth: result.row.dob,
      certificateNo: result.row.certificateNo,
      applicationRef: result.row.applicationRef,
      issueDate: result.row.issueDate,
      matchedStaff: result.staff ? displayStaff(result.staff) : null,
      currentDbs: result.currentDbs || null,
      candidates: result.candidates?.map((candidate) => ({
        staff: displayStaff(candidate.staff),
        score: candidate.score,
        currentDbs: candidate.currentDbs || null,
      })) || [],
    })),
  }, null, 2));
  process.exit(0);
}

console.log("DBS disclosure audit");
console.log("Source: Disclosure-Results-27062026091744.pdf");
console.log(`Rows checked: ${results.length}`);
console.log(`Updated: ${summary.updated || 0}`);
console.log(`Matched but missing DBS: ${summary["matched-missing-dbs"] || 0}`);
console.log(`Matched but current DBS differs: ${summary["different-current-dbs"] || 0}`);
console.log(`Ambiguous: ${summary.ambiguous || 0}`);
console.log(`Unmatched: ${summary.unmatched || 0}`);
console.log("");

for (const result of results) {
  const rowLabel = `${result.row.surname} ${result.row.dob} · ${result.row.certificateNo}`;
  if (result.status === "updated") {
    console.log(`OK  ${rowLabel} -> ${displayStaff(result.staff)}`);
  } else if (result.status === "matched-missing-dbs") {
    console.log(`ADD ${rowLabel} -> ${displayStaff(result.staff)} currently has no DBS number`);
  } else if (result.status === "different-current-dbs") {
    console.log(`!!  ${rowLabel} -> ${displayStaff(result.staff)} currently has ${result.currentDbs}`);
  } else if (result.status === "ambiguous") {
    console.log(`??  ${rowLabel} matched more than one staff record:`);
    for (const candidate of result.candidates) console.log(`    - ${displayStaff(candidate.staff)} score ${candidate.score}`);
  } else {
    console.log(`NO  ${rowLabel} could not be matched to a current staff record.`);
  }
}

const needsAttention = results.filter((result) => result.status !== "updated");
if (needsAttention.length) {
  process.exitCode = 1;
}
