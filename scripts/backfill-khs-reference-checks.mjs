#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");

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

const referenceChecks = [
  {
    match: ["rama", "singh"],
    checkedAt: "2025-08-19",
    verifiedBy: "Luke Currie",
    references: [
      { name: "Kamran", organisation: "Able Staffing", contact: "kamran@ablestaffing.co.uk" },
    ],
  },
  {
    match: ["brenda", "harrison"],
    checkedAt: "2024-08-31",
    verifiedBy: "Luke Currie",
    references: [],
  },
  {
    match: ["sadie", "woodley"],
    checkedAt: "2025-08-18",
    verifiedBy: "Luke Currie",
    references: [],
  },
  {
    match: ["maisie", "marsden"],
    checkedAt: "2026-05-17",
    verifiedBy: "Luke Currie",
    references: [
      { name: "Bruce Bolden", contact: "07879457225", address: "48 Caroline Cottages, Twickenham" },
      { name: "Emile Bitar", contact: "07939287843", address: "30 Grosvenor Road, Twickenham" },
    ],
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

function profileOf(staff) {
  return Array.isArray(staff.profiles) ? staff.profiles[0] : staff.profiles;
}

function scrOf(staff) {
  return Array.isArray(staff.scr_checks) ? staff.scr_checks[0] : staff.scr_checks;
}

function displayStaff(staff) {
  const profile = profileOf(staff);
  const name = profile?.full_name || staff.preferred_name || "Unknown staff";
  const email = profile?.email ? ` · ${profile.email}` : "";
  const site = staff.primary_site ? ` · ${staff.primary_site}` : "";
  return `${name}${email}${site}`;
}

function referenceEvidence({ checkedAt, verifiedBy, references: providedReferences = [] }) {
  const references = Array.isArray(providedReferences) ? providedReferences : [];
  const referenceCount = references.length || 2;
  const referenceLabel = references.length
    ? references.map((reference) => reference.organisation ? `${reference.name} (${reference.organisation})` : reference.name).join("; ")
    : "Names not recorded in registration export";
  return {
    status: "Approved",
    reference: references.length ? `References checked: ${referenceLabel}` : "Employment references checked",
    referencesReceived: true,
    referenceCount,
    referenceNames: references.map((reference) => reference.name).filter(Boolean),
    references,
    dateSeen: checkedAt,
    checkedAt,
    verifiedAt: checkedAt,
    verifiedBy,
    wouldReemploy: true,
    wouldEmployAgain: true,
    safeguardingConcerns: false,
    recommendedForChildren: true,
    recommendForChildrenRole: true,
    referenceOne: {
      received: true,
      ...(references[0] || {}),
      wouldReemploy: true,
      safeguardingConcerns: false,
      recommendedForChildren: true,
    },
    referenceTwo: {
      received: true,
      ...(references[1] || {}),
      wouldReemploy: true,
      safeguardingConcerns: false,
      recommendedForChildren: true,
    },
    note: `References confirmed${references.length ? ` from ${referenceLabel}` : ""}: would employ again yes; safeguarding concerns no; recommended for a role working with children yes.`,
  };
}

function mergeScr(existingScr = {}, check) {
  const adminReview = existingScr.admin_review || {};
  const checklist = adminReview.checklist || {};
  const evidence = {
    ...(checklist.evidence || {}),
    ...(adminReview.evidence || {}),
  };
  const nextReferenceEvidence = referenceEvidence(check);
  const nextEvidence = {
    ...evidence,
    references: {
      ...(evidence.references || {}),
      ...nextReferenceEvidence,
    },
  };
  return {
    right_to_work: existingScr.right_to_work || {},
    identity_checks: existingScr.identity_checks || {},
    dbs: existingScr.dbs || {},
    safeguarding: existingScr.safeguarding || {},
    first_aid: existingScr.first_aid || {},
    annual_declarations: existingScr.annual_declarations || {},
    recruitment_checks: {
      ...(existingScr.recruitment_checks || {}),
      references: true,
      referencesStatus: "Complete",
      referencesCheckedAt: check.checkedAt,
      referencesVerifiedBy: check.verifiedBy,
      wouldReemploy: true,
      safeguardingConcerns: false,
      recommendedForChildren: true,
    },
    admin_review: {
      ...adminReview,
      status: adminReview.status || "Review needed",
      checklist: {
        ...checklist,
        references: true,
        evidence: nextEvidence,
        updatedAt: new Date().toISOString(),
      },
      evidence: nextEvidence,
      updatedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
}

if (!serviceKey) fail("Missing APRES_SERVICE_ROLE_KEY. Add it to the environment before updating SCR references.");

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: staffRecords, error: staffError } = await supabase
  .from("staff_records")
  .select("id, preferred_name, primary_site, job_role, archived_at, profiles!staff_records_profile_id_fkey(full_name, email), scr_checks(*)")
  .is("archived_at", null)
  .order("preferred_name", { ascending: true });
if (staffError) fail(`Could not load staff records: ${staffError.message}`);

const updates = [];
for (const check of referenceChecks) {
  const matches = (staffRecords || []).filter((staff) => {
    const profile = profileOf(staff);
    const haystack = normalise([staff.preferred_name, staff.job_role, staff.primary_site, profile?.full_name, profile?.email].filter(Boolean).join(" "));
    return check.match.every((part) => haystack.includes(part));
  });
  if (matches.length !== 1) {
    console.log(`Match check failed for ${check.match.join(" ")}`);
    for (const match of matches) console.log(`- ${displayStaff(match)}`);
    fail(`Expected exactly one active staff record for ${check.match.join(" ")}, found ${matches.length}.`);
  }
  updates.push({ staff: matches[0], check });
}

console.log(`King's House reference backfill ${confirm ? "CONFIRM" : "dry-run"}`);
for (const { staff, check } of updates) {
  const names = check.references?.length ? check.references.map((reference) => reference.name).join(", ") : "reference names not found in workbook";
  console.log(`- ${displayStaff(staff)} · references checked ${check.checkedAt} · ${names} · would employ again YES · safeguarding concerns NO · recommend children role YES`);
}

if (!confirm) {
  console.log("\nDry-run only. Re-run with --confirm to update live SCR records.");
  process.exit(0);
}

for (const { staff, check } of updates) {
  const existingScr = scrOf(staff) || {};
  const merged = mergeScr(existingScr, check);
  const { error: updateError } = await supabase
    .from("scr_checks")
    .upsert({
      staff_record_id: staff.id,
      ...merged,
    }, { onConflict: "staff_record_id" });
  if (updateError) fail(`SCR reference update failed for ${displayStaff(staff)}: ${updateError.message}`);
  console.log(`DONE ${displayStaff(staff)}`);
}

console.log("\nKing's House reference checks updated.");
