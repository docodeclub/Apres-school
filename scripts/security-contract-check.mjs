import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = [];
const expect = (name, condition) => checks.push({ name, passed: Boolean(condition) });

const checkout = read("supabase/functions/ponchopay-create-checkout/index.ts");
const registration = read("supabase/functions/register-parent-account/index.ts");
const reset = read("supabase/functions/parent-password-reset/index.ts");
const bookingLab = read("src/BookingLab.jsx");
const staffApplication = read("src/app.jsx");
const crm = read("src/PlatformModule.jsx");
const vercel = read("vercel.json");

expect("Checkout authenticates browser callers", checkout.includes("supabase.auth.getUser(token)"));
expect("Checkout reloads saved booking", checkout.includes('from("bookings")'));
expect("Checkout verifies ownership", checkout.includes("ownsBooking"));
expect("Checkout ignores caller redirect URLs", !checkout.includes("stringValue(body.successUrl)"));
expect("Registration requires email verification", registration.includes('type: "signup"') && !registration.includes("email_confirm: true"));
expect("Registration is rate limited", registration.includes('"parent-registration"'));
expect("Reset URL is server controlled", reset.includes("const loginUrl = defaultLoginUrl") && !reset.includes("input.loginUrl"));
expect("Reset is rate limited", reset.includes('"parent-password-reset"'));
expect("Registration passwords are not persisted", bookingLab.includes("...safeDraft") && !bookingLab.includes('JSON.stringify(next));\n      return next;\n    });\n  }\n\n  function updateChildRegistration'));
expect("Staff application uses protected function", staffApplication.includes("submitStaffApplication(application)") && !staffApplication.includes('localStorage.setItem(staffApplicationsStorageKey'));
expect("Prospect list is not bundled into CRM", !crm.includes('import("./outreachProspects.js")'));
expect("CSP is staged report-only", vercel.includes("Content-Security-Policy-Report-Only"));

const failures = checks.filter((check) => !check.passed);
console.log(JSON.stringify({ securityContractReady: failures.length === 0, checks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
