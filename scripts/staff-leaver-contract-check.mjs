import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/0113_former_staff_document_access.sql", import.meta.url), "utf8");
const lockdown = fs.readFileSync(new URL("../supabase/migrations/0114_former_staff_operational_lockdown.sql", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../supabase/functions/manage-staff-leaver/index.ts", import.meta.url), "utf8");
const payPinService = fs.readFileSync(new URL("../supabase/functions/manage-staff-pay-pin/index.ts", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/supabaseClient.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const platform = fs.readFileSync(new URL("../src/PlatformModule.jsx", import.meta.url), "utf8");

assert.match(migration, /staff_access_status text not null default 'active'/);
assert.match(migration, /current_user_is_former_staff/);
assert.match(migration, /former_staff_portal/);
assert.match(migration, /current_user_app_role[\s\S]*active = true[\s\S]*staff_access_status = 'active'/);
assert.match(migration, /staff_hr_files_staff_read_own[\s\S]*current_user_is_former_staff/);
assert.match(migration, /staff_records_read_own[\s\S]*current_user_profile_active/);
assert.match(migration, /sessions_read_authenticated[\s\S]*current_user_profile_active/);
assert.match(migration, /'P45','confidential_payroll'/);
assert.match(lockdown, /as restrictive for all to authenticated/);
assert.match(lockdown, /Former staff own profile only/);
assert.match(lockdown, /employee_document_row_visible[\s\S]*current_user_is_former_staff/);
assert.match(lockdown, /employee signatures own insert[\s\S]*current_user_profile_active/);

assert.match(service, /staff_access_status: "former"/);
assert.match(service, /active: false/);
assert.match(service, /staff_leaver_access/);
assert.match(service, /previous payslips and other HR files/);
assert.match(service, /registers, staffing, safeguarding, children, bookings/);
assert.match(service, /safeLoginUrl/);
assert.match(payPinService, /Pay privacy settings are unavailable for former staff accounts/);

assert.match(client, /fetchFormerStaffPortalData/);
assert.match(client, /staffLeaverFunctionName/);
assert.match(client, /formerStaff: true/);
assert.match(app, /formerStaffAccess/);
assert.match(platform, /FormerStaffPortal/);
assert.match(platform, /Your retained employment documents/);
assert.match(platform, /Documents only/);

console.log("Former staff access contract checks passed.");
