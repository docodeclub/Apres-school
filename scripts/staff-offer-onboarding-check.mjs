import { readFile } from "node:fs/promises";

const files = {
  migration: await readFile("supabase/migrations/0128_staff_offer_onboarding.sql", "utf8"),
  edge: await readFile("supabase/functions/manage-staff-offer/index.ts", "utf8"),
  client: await readFile("src/supabaseClient.js", "utf8"),
  platform: await readFile("src/PlatformModule.jsx", "utf8"),
  directMigration: await readFile("supabase/migrations/0129_direct_application_onboarding.sql", "utf8"),
};

const checks = [
  ["protected offer table", /create table if not exists public\.staff_offers/i.test(files.migration)],
  ["candidate onboarding table", /create table if not exists public\.staff_candidate_onboarding/i.test(files.migration)],
  ["admin-only offer reads", /Admins can read staff offers[\s\S]*role in \('admin','superadmin'\)/i.test(files.migration)],
  ["application answers marked unverified", /imported_unverified/.test(files.migration) && /verified: false/.test(files.edge)],
  ["signed contract confirmation is audited", /contract_signed_confirmed_at/.test(files.directMigration) && /staff_signed_contract_confirmed/.test(files.edge)],
  ["direct application activation", /action === "activate-application"/.test(files.edge) && /activateApplicationOnboarding/.test(files.edge)],
  ["family-account collision guard", /belongs to a family account/.test(files.edge)],
  ["SCR checks remain incomplete", /identity_checks: \{ status: "incomplete"/.test(files.edge) && /dbs: \{ status: "incomplete"/.test(files.edge)],
  ["signed contract is not re-issued", /if \(!signedContractAlreadyHeld\) await createOfferDocument/.test(files.edge)],
  ["Admin onboarding wizard", /Application onboarding wizard/.test(files.platform) && /"Start onboarding"/.test(files.platform)],
  ["contract confirmation required in UI", /I confirm this applicant has accepted the role and signed their contract/.test(files.platform)],
  ["frontend direct onboarding service", /startOnboardingFromApplication/.test(files.client) && /activate-application/.test(files.client)],
  ["no candidate accept-decline UI", !/StaffOfferResponse/.test(files.platform) && !/"Accept offer"/.test(files.platform)],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  if (!passed) failed += 1;
}

if (failed) {
  console.error(`\n${failed} staff offer onboarding contract check(s) failed.`);
  process.exit(1);
}

console.log("\nStaff offer onboarding contract checks passed.");
