import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0122_scr_assurance_wizard.sql");
const client = read("src/supabaseClient.js");
const platform = read("src/PlatformModule.jsx");
const scrStart = platform.indexOf("function SCR(");
const scrEnd = platform.indexOf("function SCRDetailsPanel", scrStart);
const scrSource = platform.slice(scrStart, scrEnd);

const checks = [
  ["persistent assurance workflow", migration.includes("create table if not exists public.scr_assurance_workflows")],
  ["Admin-only database access", migration.includes("current_user_app_role() in ('admin','superadmin')")],
  ["submission requires every SCR section", migration.includes("Complete every required SCR section") && migration.includes("p_step_status ->> 'assurance'")],
  ["submission recipient and method required", migration.includes("Record who received the assurance letter") && migration.includes("Record how the assurance letter was submitted")],
  ["submission is audited", migration.includes("scr_assurance_letter_submitted") && migration.includes("insert into public.audit_log")],
  ["client can load and save progress", client.includes("fetchScrAssuranceWorkflows") && client.includes("saveScrAssuranceWorkflow")],
  ["progress loader is scoped to SCR", scrSource.includes("fetchScrAssuranceWorkflows") && !platform.slice(0, scrStart).includes("setAssuranceWorkflows")],
  ["wizard is Admin-only", platform.includes('["Admin", "Superadmin"].includes(access?.role)') && platform.includes("SCRAssuranceWizard")],
  ["skipped sections stay incomplete", platform.includes('statusValue = wizardCompletion[section.id] ? "complete" : skip ? "skipped" : "incomplete"')],
  ["letter waits for real completion", platform.includes("wizardRequiredComplete") && platform.includes("Complete the required sections before generating")],
  ["existing assurance PDF is reused", platform.includes("exportSchoolAssuranceLetter(selectedSchoolStaff, selectedScrSchool")],
];

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures += 1;
}
console.log(`\n${checks.length} checks, ${failures} failures.`);
if (failures) process.exit(1);
