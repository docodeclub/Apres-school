import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0115_employee_expense_claims.sql");
const client = read("src/supabaseClient.js");
const platform = read("src/PlatformModule.jsx");

const checks = [
  ["private receipt bucket", migration.includes("'employee-expense-receipts','employee-expense-receipts',false")],
  ["staff ownership enforced", migration.includes("current_user_owns_staff_record")],
  ["manager direct-report approval enforced", migration.includes("h.manager_staff_record_id = public.current_user_staff_record_id()")],
  ["admin-only payroll transfer", migration.includes("Only Admin can add expenses to payroll")],
  ["duplicate payroll transfer prevented", migration.includes("v_claim.status <> 'approved'")],
  ["receipt type and size validation", client.includes("Receipts must be 10 MB or smaller") && client.includes("Upload a PDF, JPG, PNG or WebP receipt")],
  ["short-lived receipt link", client.includes("createSignedUrl(claim.receiptPath, 900)")],
  ["staff dashboard shortcut", platform.includes("Submit an expense") && platform.includes("onOpenExpenses")],
  ["manager review actions", platform.includes("reviewEmployeeExpenseClaim") && platform.includes("Approve")],
  ["payroll action", platform.includes("addEmployeeExpenseToPayroll") && platform.includes("Add to {formatPayrollPeriod(payrollPeriod)} payroll")],
];

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures += 1;
}
console.log(`\n${checks.length} checks, ${failures} failures.`);
if (failures) process.exit(1);
