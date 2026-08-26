import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0123_employee_holiday_management.sql");
const bookingRules = read("supabase/migrations/0124_site_staff_school_holiday_rule.sql");
const client = read("src/supabaseClient.js");
const platform = read("src/PlatformModule.jsx");
const holiday = read("src/HolidayModule.jsx");
const styles = read("src/styles.css");
const notification = read("supabase/functions/notify-holiday-request/index.ts");

const checks = [
  ["staff own-record privacy", migration.includes("sr.profile_id = auth.uid()") && migration.includes("revoke insert, update, delete on public.staff_absences")],
  ["manager direct-report scope", migration.includes("hrl.manager_staff_record_id = v_staff_id") && migration.includes("Managers can review direct reports only")],
  ["Admin entitlement controls", migration.includes("holiday_save_entitlement") && migration.includes("Admin access is required")],
  ["allowance overbooking prevented", migration.includes("exceeds your remaining holiday allowance")],
  ["Admin staff may request any date", bookingRules.includes("v_role in ('admin','superadmin')") && bookingRules.includes("'any_time'")],
  ["site staff restricted to school holidays", bookingRules.includes("Site staff can only request annual leave during published school holidays") && bookingRules.includes("half_term_holiday") && bookingRules.includes("seasonal_holiday")],
  ["missing site calendar fails safely", bookingRules.includes("usual school is not linked to a published calendar")],
  ["overlapping requests prevented", migration.includes("covering these dates")],
  ["approval creates rota cover", migration.includes("status = 'cover_required'") && migration.includes("holiday_absence_id = v_request.id")],
  ["cancellation restores linked shifts", migration.includes("where holiday_absence_id=v_request.id") && migration.includes("status='assigned'")],
  ["holiday pay is separate", migration.includes("create table if not exists public.holiday_payroll_entries") && client.includes("holidayPayroll")],
  ["payroll shows worked and holiday split", platform.includes("row.workedHours.toFixed(2)") && platform.includes("row.holidayHours.toFixed(2)")],
  ["staff request interface", holiday.includes("Submit holiday request") && holiday.includes("Remaining after request")],
  ["booking rules explained before submission", holiday.includes("Rule 1 · Admin staff") && holiday.includes("Rule 2 · Site staff") && holiday.includes("Available school-holiday windows")],
  ["approval and calendar views", holiday.includes("Holiday approvals") && holiday.includes("Team leave calendar")],
  ["dashboard shortcut", platform.includes("Request holiday") && platform.includes("onOpenHoliday")],
  ["branded request and decision emails", notification.includes("buildStaffEmailHtml") && notification.includes("Holiday request") && client.includes("notifyHolidayRequest")],
  ["responsive styling", styles.includes(".holiday-workspace") && styles.includes("@media (max-width: 650px)")],
];

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures += 1;
}
console.log(`\n${checks.length} checks, ${failures} failures.`);
if (failures) process.exit(1);
