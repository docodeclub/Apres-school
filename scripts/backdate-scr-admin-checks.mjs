#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

const PROJECT_REF = "djkfuftbtfthjpezvjuu";
const LIVE_ORIGIN = "https://apres-school.co.uk";
const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");

const targets = [
  {
    label: "Rama Singh",
    terms: ["rama", "singh"],
    email: "ramasingh_uk@yahoo.com",
    checkedDate: "2025-08-21",
  },
  {
    label: "Brenda Harrison",
    terms: ["brenda", "harrison"],
    checkedDate: "2024-09-02",
  },
  {
    label: "Sadie Woodley",
    terms: ["sadie", "woodley"],
    checkedDate: "2025-08-20",
  },
  {
    label: "Maisie",
    terms: ["maisie"],
    checkedDate: "2026-05-19",
  },
];

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

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function findLivePublishableKey() {
  const seen = new Set();
  const queue = [`${LIVE_ORIGIN}/staff-login`];

  while (queue.length && seen.size < 100) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    let text = "";
    try {
      text = await fetchText(url);
    } catch {
      continue;
    }

    const key = text.match(/sb_publishable_[A-Za-z0-9_.-]+/)?.[0];
    if (key && text.includes(`${PROJECT_REF}.supabase.co`)) return key;

    const assetMatches = text.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']|["']([^"']*assets\/[^"']+\.js[^"']*)["']/g);
    for (const match of assetMatches) {
      const asset = match[1] || match[2];
      if (!asset) continue;
      queue.push(new URL(asset, LIVE_ORIGIN).toString());
    }

    const importMatches = text.matchAll(/import\(["']([^"']+\.js[^"']*)["']\)|from ["']([^"']+\.js[^"']*)["']/g);
    for (const match of importMatches) {
      const asset = match[1] || match[2];
      if (!asset) continue;
      queue.push(new URL(asset, url).toString());
    }
  }

  return "";
}

function staffSearchText(staff) {
  const profile = profileOf(staff);
  return normalise([
    staff.preferred_name,
    staff.job_role,
    staff.primary_site,
    profile?.full_name,
    profile?.email,
  ].filter(Boolean).join(" "));
}

function findTargetStaff(staffRecords, target) {
  const matches = staffRecords
    .map((staff) => {
      const haystack = staffSearchText(staff);
      let score = 0;
      for (const term of target.terms) {
        if (haystack.includes(normalise(term))) score += 2;
      }
      if (target.email && haystack.includes(normalise(target.email))) score += 10;
      return { staff, score, haystack };
    })
    .filter(({ score }) => score >= target.terms.length * 2)
    .sort((a, b) => b.score - a.score);

  const topScore = matches[0]?.score || 0;
  const topMatches = matches.filter((match) => match.score === topScore);
  if (topMatches.length !== 1) {
    console.log(`Could not uniquely match ${target.label}. Candidates:`);
    for (const match of matches.slice(0, 8)) console.log(`- ${displayStaff(match.staff)} · score ${match.score}`);
    fail(`Expected one match for ${target.label}; found ${topMatches.length || matches.length}.`);
  }
  return topMatches[0].staff;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function checkedEvidence(value, checkedDate, checkedIso) {
  const next = asObject(value);
  return {
    ...next,
    status: next.status || "Checked",
    checkedAt: checkedIso,
    checkedOn: checkedDate,
    verifiedAt: checkedIso,
    adminCheckedAt: checkedIso,
    adminCheckedOn: checkedDate,
    checkedBy: next.checkedBy || "Luke Currie",
  };
}

function hasUsefulEvidence(value) {
  const item = asObject(value);
  return Boolean(Object.keys(item).length && Object.values(item).some((entry) => entry !== "" && entry !== null && entry !== false));
}

function checkedGroup(value, checkedDate, checkedIso) {
  return checkedEvidence({
    ...asObject(value),
    checked: true,
    adminVerified: true,
  }, checkedDate, checkedIso);
}

function appendNote(existingNote, date) {
  const note = `SCR checks verified on ${date}; backdated to the onboarding/SCR review date.`;
  if (String(existingNote || "").includes(note)) return existingNote || note;
  return [existingNote, note].filter(Boolean).join("\n");
}

function buildBackdatedScr(existingScr, checkedDate) {
  const checkedIso = `${checkedDate}T12:00:00.000Z`;
  const adminReview = asObject(existingScr?.admin_review);
  const existingChecklist = asObject(adminReview.checklist);
  const existingEvidence = {
    ...asObject(existingChecklist.evidence),
    ...asObject(adminReview.evidence),
  };

  const requiredEvidenceKeys = [
    "rightToWork",
    "identity",
    "dbs",
    "barredList",
    "safeguarding",
    "allergy",
    "references",
    "declarations",
  ];
  const nextEvidence = { ...existingEvidence };
  for (const key of requiredEvidenceKeys) {
    nextEvidence[key] = checkedEvidence(nextEvidence[key] || {
      reference: "Checked at onboarding/SCR review",
    }, checkedDate, checkedIso);
  }

  for (const [key, value] of Object.entries(existingEvidence)) {
    if (hasUsefulEvidence(value)) nextEvidence[key] = checkedEvidence(value, checkedDate, checkedIso);
  }

  const firstAidRequired = Boolean(existingChecklist.firstAid || hasUsefulEvidence(existingEvidence.firstAid) || hasUsefulEvidence(existingScr?.first_aid));
  const eyfsRequired = Boolean(existingChecklist.eyfsLevel || hasUsefulEvidence(existingEvidence.eyfsLevel) || asObject(existingScr?.recruitment_checks).eyfsLevel);
  if (firstAidRequired) nextEvidence.firstAid = checkedEvidence(nextEvidence.firstAid || {}, checkedDate, checkedIso);
  if (eyfsRequired) nextEvidence.eyfsLevel = checkedEvidence(nextEvidence.eyfsLevel || {}, checkedDate, checkedIso);

  const checklist = {
    ...existingChecklist,
    rightToWork: true,
    identity: true,
    dbs: true,
    barredList: true,
    safeguarding: true,
    allergy: true,
    references: true,
    declarations: true,
    firstAid: firstAidRequired,
    eyfsLevel: eyfsRequired,
    evidence: nextEvidence,
    note: appendNote(existingChecklist.note || adminReview.note, checkedDate),
    approvedAt: checkedIso,
    approvedBy: existingChecklist.approvedBy || adminReview.approvedBy || "Luke Currie",
    updatedAt: checkedIso,
  };

  return {
    right_to_work: checkedGroup(existingScr?.right_to_work, checkedDate, checkedIso),
    identity_checks: checkedGroup(existingScr?.identity_checks, checkedDate, checkedIso),
    dbs: checkedGroup({
      ...asObject(existingScr?.dbs),
      barredList: true,
    }, checkedDate, checkedIso),
    safeguarding: checkedGroup(existingScr?.safeguarding, checkedDate, checkedIso),
    first_aid: firstAidRequired ? checkedGroup(existingScr?.first_aid, checkedDate, checkedIso) : asObject(existingScr?.first_aid),
    annual_declarations: checkedGroup(existingScr?.annual_declarations, checkedDate, checkedIso),
    recruitment_checks: checkedGroup({
      ...asObject(existingScr?.recruitment_checks),
      references: true,
    }, checkedDate, checkedIso),
    admin_review: {
      ...adminReview,
      status: "Compliant",
      checklist,
      evidence: nextEvidence,
      note: checklist.note,
      checkedAt: checkedIso,
      checkedOn: checkedDate,
      reviewedAt: checkedIso,
      approvedAt: checkedIso,
      approved_at: checkedIso,
      approvedBy: checklist.approvedBy,
      approved_by: checklist.approvedBy,
      updatedAt: checkedIso,
    },
    updated_at: checkedIso,
  };
}

let supabaseKey = process.env.APRES_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const adminEmail = process.env.APRES_ADMIN_EMAIL;
const adminPassword = process.env.APRES_ADMIN_PASSWORD;

if (!supabaseKey) supabaseKey = await findLivePublishableKey();
if (!supabaseKey) fail("Could not find a Supabase key. Set APRES_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY.");
if (!process.env.APRES_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY && (!adminEmail || !adminPassword)) {
  fail("Set APRES_ADMIN_EMAIL and APRES_ADMIN_PASSWORD when using the publishable/anon key.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (!process.env.APRES_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { error } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (error) fail(`Could not sign in admin user: ${error.message}`);
}

const { data: staffRecords, error: staffError } = await supabase
  .from("staff_records")
  .select(`
    id,
    preferred_name,
    primary_site,
    job_role,
    archived_at,
    profiles!staff_records_profile_id_fkey(full_name, email),
    scr_checks(
      id,
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
  .is("archived_at", null)
  .order("preferred_name", { ascending: true });

if (staffError) fail(`Could not load staff records: ${staffError.message}`);

const updates = targets.map((target) => {
  const staff = findTargetStaff(staffRecords || [], target);
  const existingScr = scrOf(staff) || {};
  return {
    target,
    staff,
    payload: buildBackdatedScr(existingScr, target.checkedDate),
  };
});

console.log(`SCR admin check backdate ${confirm ? "CONFIRM" : "dry-run"}`);
for (const update of updates) {
  const approvedAt = scrOf(update.staff)?.admin_review?.approvedAt || scrOf(update.staff)?.admin_review?.approved_at || "not recorded";
  console.log(`- ${displayStaff(update.staff)}: ${approvedAt} -> ${update.target.checkedDate}`);
}

if (!confirm) {
  console.log("\nDry-run only. Re-run with --confirm to update Supabase.");
  process.exit(0);
}

for (const update of updates) {
  const { error } = await supabase.from("scr_checks").upsert({
    staff_record_id: update.staff.id,
    ...update.payload,
  }, { onConflict: "staff_record_id" });
  if (error) fail(`Could not update ${displayStaff(update.staff)}: ${error.message}`);
}

const { data: verifyRows, error: verifyError } = await supabase
  .from("staff_records")
  .select("id, preferred_name, primary_site, profiles!staff_records_profile_id_fkey(full_name, email), scr_checks(admin_review, updated_at)")
  .in("id", updates.map((update) => update.staff.id))
  .order("preferred_name", { ascending: true });

if (verifyError) fail(`Could not verify updates: ${verifyError.message}`);

console.log("\nUpdated SCR review dates:");
for (const staff of verifyRows || []) {
  const scr = scrOf(staff) || {};
  const approvedAt = scr.admin_review?.approvedAt || scr.admin_review?.approved_at || "";
  console.log(`- ${displayStaff(staff)} · approved ${approvedAt.slice(0, 10)} · row ${String(scr.updated_at || "").slice(0, 10)}`);
}
