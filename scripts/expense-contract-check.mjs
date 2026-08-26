import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0115_employee_expense_claims.sql");
const approvalMigration = read("supabase/migrations/0117_superadmin_expense_approval.sql");
const privacyMigration = read("supabase/migrations/0118_remove_manager_expense_access.sql");
const client = read("src/supabaseClient.js");
const platform = read("src/PlatformModule.jsx");
const app = read("src/app.jsx");
const notification = read("supabase/functions/notify-expense-claim/index.ts");
const serverQueueMigration = read("supabase/migrations/0120_queue_expense_notification_on_submit.sql");

const checks = [
  ["private receipt bucket", migration.includes("'employee-expense-receipts','employee-expense-receipts',false")],
  ["staff ownership enforced", migration.includes("current_user_owns_staff_record")],
  ["managers cannot see colleagues' expenses", privacyMigration.includes("public.current_user_app_role() in ('admin','superadmin')") && !privacyMigration.includes("hr_reporting_lines")],
  ["admin-only payroll transfer", migration.includes("Only Admin can add expenses to payroll")],
  ["duplicate payroll transfer prevented", migration.includes("v_claim.status <> 'approved'")],
  ["receipt type and size validation", client.includes("Receipts must be 10 MB or smaller") && client.includes("Upload a PDF, JPG, PNG or WebP receipt")],
  ["short-lived receipt link", client.includes("createSignedUrl(claim.receiptPath, 900)")],
  ["staff dashboard shortcut", platform.includes("Submit an expense") && platform.includes("onOpenExpenses")],
  ["role preview stays scoped", platform.includes("const scopedClaims = canProcessPayroll ? claims : claims.filter") && platform.includes("Submission is disabled while previewing")],
  ["Superadmin review actions", platform.includes("reviewEmployeeExpenseClaim") && platform.includes("Approve") && platform.includes("Deny")],
  ["Superadmin-only decision", approvalMigration.includes("Only Superadmin can approve or deny an expense") && platform.includes('const canReview = role === "Superadmin"')],
  ["staff claim totals", platform.includes('title="Claims by staff member"') && platform.includes("Total claimed")],
  ["branded submission email", notification.includes("buildStaffEmailHtml") && notification.includes("Review expense and evidence") && notification.includes("luke@apres-school.co.uk")],
  ["server-side notification queue", serverQueueMigration.includes("net.http_post") && serverQueueMigration.includes("notification_queued")],
  ["Superadmin notification recovery", notification.includes("isSuperadmin") && platform.includes("Send email notification")],
  ["notification cannot expose evidence", notification.includes("is not attached to this email") && notification.includes("Sign in before opening the private receipt")],
  ["email deep link", app.includes("requestedExpense") && app.includes('nextAccess.role === "Superadmin"')],
  ["payroll action", platform.includes("addEmployeeExpenseToPayroll") && platform.includes("Add to {formatPayrollPeriod(payrollPeriod)} payroll")],
];

let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures += 1;
}
console.log(`\n${checks.length} checks, ${failures} failures.`);
if (failures) process.exit(1);
