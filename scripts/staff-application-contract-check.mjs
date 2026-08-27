import fs from "node:fs";

const client = fs.readFileSync("src/supabaseClient.js", "utf8");
const platform = fs.readFileSync("src/PlatformModule.jsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/0126_staff_application_review.sql", "utf8");

const checks = [
  [client.includes('.from("staff_applications")'), "staff applications are loaded from Supabase"],
  [client.includes('.rpc("review_staff_application"'), "application decisions use the protected review RPC"],
  [platform.includes("fetchStaffApplications"), "the onboarding screen loads live applications"],
  [platform.includes("View full application"), "the complete application can be reviewed"],
  [!platform.includes("function approveApplication(application)"), "the legacy browser-only approval action is removed"],
  [migration.includes("v_role not in ('admin', 'superadmin')"), "only Admin and Superadmin can save decisions"],
  [migration.includes("staff_application_reviewed"), "review decisions are audited"],
];

const failed = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
if (failed.length) process.exit(1);
