import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/0099_employee_documents.sql", import.meta.url), "utf8");
const effectiveTermsMigration = fs.readFileSync(new URL("../supabase/migrations/0100_employee_document_effective_terms.sql", import.meta.url), "utf8");
const privacyMigration = fs.readFileSync(new URL("../supabase/migrations/0101_employee_document_privacy_hardening.sql", import.meta.url), "utf8");
const managerOwnPayslipMigration = fs.readFileSync(new URL("../supabase/migrations/0112_manager_own_payslip_storage.sql", import.meta.url), "utf8");
for (const table of ["employee_document_types", "employee_document_templates", "employee_documents", "employee_document_signatures", "employee_document_events", "employment_terms_history"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `Missing ${table}`);
}
assert.match(migration, /deleted_at timestamptz/);
assert.match(migration, /unique\(staff_record_id,lineage_id,version\)/);
assert.match(migration, /employee_document_can_read/);
assert.match(migration, /restricted_hr','confidential_payroll/);
assert.match(migration, /Standard Contract Variation/);
assert.match(effectiveTermsMigration, /apply_due_employment_terms/);
assert.match(effectiveTermsMigration, /contract_hours/);
assert.match(effectiveTermsMigration, /cron\.schedule/);
assert.match(privacyMigration, /employee_document_row_visible/);
assert.match(privacyMigration, /employee_document_storage_object_visible/);
assert.match(privacyMigration, /awaiting_signature','signed','declined','superseded','expired/);
assert.match(privacyMigration, /revoke execute on function public\.employee_document_record_event/);
assert.match(managerOwnPayslipMigration, /current_user_app_role\(\) not in \('staff','manager'\)/);
assert.match(managerOwnPayslipMigration, /split_part\(object_name,'\/',1\) <> public\.current_user_staff_record_id\(\)::text/);
assert.match(managerOwnPayslipMigration, /staff_hr_files_storage_staff_select_own/);

const service = fs.readFileSync(new URL("../supabase/functions/manage-employee-document/index.ts", import.meta.url), "utf8");
for (const action of ["create", "register_upload", "generate", "new_version", "send", "sign", "decline", "archive", "url"]) {
  assert.ok(service.includes(`action === "${action}"`), `Missing server action ${action}`);
}
assert.match(service, /buildPdf/);
assert.match(service, /evidenceHash/);
assert.match(service, /clientIp/);
assert.match(service, /user-agent/);
assert.match(service, /employee_document_ready/);
assert.match(service, /signed_storage_path/);
assert.match(service, /\["awaiting_signature", "signed", "declined", "superseded", "expired"\]\.includes\(document\.status\)/);

const moduleSource = fs.readFileSync(new URL("../src/EmployeeDocumentsModule.jsx", import.meta.url), "utf8");
for (const label of ["Documents", "Create document", "New contract variation", "Create next version", "Audit history", "Review & sign", "Draw signature", "Employment terms history"]) {
  assert.ok(moduleSource.includes(label), `Missing employee document UI: ${label}`);
}
assert.match(moduleSource, /EmployeeDocumentsDirectory/);
const clientSource = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
assert.match(clientSource, /Upload a PDF, Word, Excel, JPEG or PNG/);
assert.match(clientSource, /createEmployeeDocumentVersion/);

const platform = fs.readFileSync(new URL("../src/PlatformModule.jsx", import.meta.url), "utf8");
assert.match(platform, /EmployeeDocumentsPanel/);
assert.match(platform, /"Employee Documents"/);
assert.match(platform, /"Documents", "Pay", "Sites"/);

console.log("Employee document contract checks passed.");
