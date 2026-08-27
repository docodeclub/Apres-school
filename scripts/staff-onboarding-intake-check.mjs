import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0130_staff_onboarding_intake.sql");
const module = read("src/StaffOnboardingModule.jsx");
const offer = read("supabase/functions/manage-staff-offer/index.ts");
const platform = read("src/PlatformModule.jsx");
const client = read("src/supabaseClient.js");

const checks = [
  ["private onboarding table", migration.includes("staff_onboarding_submissions") && migration.includes("enable row level security")],
  ["owner-only evidence storage", migration.includes("staff-onboarding-evidence") && migration.includes("current_user_staff_record_id")],
  ["manager evidence access excluded", !migration.match(/onboarding evidence[^;]+manager/is)],
  ["server-side completion rules", migration.includes("staff_onboarding_section_status") && migration.includes("Complete every required onboarding section")],
  ["three distinct documents", migration.includes("count(distinct value->>'type')") && module.includes("Upload one primary document and two supporting documents")],
  ["two references", module.includes("referencesDetails: [{ ...emptyReference }, { ...emptyReference }]") && module.includes("Reference {index + 1}")],
  ["Après School declarations", module.includes("tell Après School immediately") && module.includes("Après School safeguarding induction")],
  ["save and return", module.includes("Save progress") && client.includes("save_my_staff_onboarding")],
  ["admin approval gate", migration.includes("review_staff_onboarding") && platform.includes("onboardingOnly")],
  ["direct email link", offer.includes("?section=onboarding") && offer.includes("Complete your onboarding")],
  ["no Docode wording", !module.includes("Docode") && !migration.includes("Docode")],
];

let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  failed ||= !passed;
}
if (failed) process.exit(1);
console.log("\nStaff onboarding intake contract checks passed.");
