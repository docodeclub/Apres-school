import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(label, condition) {
  if (!condition) failures.push(label);
}

const sharedTemplate = read("supabase/functions/_shared/booking-email.ts");
expect("shared booking template uses the text Après School header", sharedTemplate.includes(">Après School</span>"));
expect("shared booking template uses the Family booking badge", sharedTemplate.includes(">Family booking</span>"));
expect("shared booking template uses the payslip-style action colour", sharedTemplate.includes('const actionBlue = "#4f6de8"'));
expect("shared booking template is light-mode safe", sharedTemplate.includes('name="color-scheme" content="light only"'));
expect("shared booking template no longer relies on a remote header image", !sharedTemplate.includes("<img "));
expect("shared booking template renders the account reminder opt-out link", sharedTemplate.includes("Stop account setup reminders"));
expect("shared booking sender supports one-click unsubscribe headers", sharedTemplate.includes("headers?: Record<string, string>"));

const parentAccountEmail = read("supabase/functions/manage-parent-account/index.ts");
const bookingLab = read("src/BookingLab.jsx");
const reminderBatch = read("scripts/send-magicbooking-account-reminders.mjs");
expect("migration completion reminders are separate from essential emails", parentAccountEmail.includes('emailType: "parent_migration_completion_reminder"'));
expect("migration reminders stop after the migrated review is complete", parentAccountEmail.includes('parent.portal_status === "active" && outstandingItems === 0'));
expect("migration reminders respect the parent opt-out", parentAccountEmail.includes("preferences.migrationSetupReminders === false"));
expect("migration reminders provide a signed opt-out link", parentAccountEmail.includes("migrationReminderToken") && parentAccountEmail.includes("constantTimeEqual"));
expect("opt-out copy preserves essential communications", parentAccountEmail.includes("Essential booking, payment and safeguarding messages are unaffected"));
expect("admins can send a migrated-account completion reminder", bookingLab.includes("Send completion reminder"));
expect("bulk reminder runs are dry-run by default", reminderBatch.includes('const runLive = args.has("--run")') && reminderBatch.includes('mode: runLive ? "live" : "dry-run"'));
expect("bulk reminders skip opted-out parents", reminderBatch.includes("preferences.migrationSetupReminders === false"));
expect("bulk reminders use a seven-day default cooldown", reminderBatch.includes("Number(process.argv[daysArg + 1] || 7)"));

const bookingFunctions = [
  "admin-adjust-parent-credit",
  "cancel-staff-adhoc-booking",
  "create-parent-booking",
  "create-staff-adhoc-booking",
  "manage-parent-account",
  "parent-password-reset",
  "ponchopay-process-events",
  "register-parent-account",
  "update-parent-booking",
];

for (const functionName of bookingFunctions) {
  const source = read(`supabase/functions/${functionName}/index.ts`);
  expect(`${functionName} imports the shared booking email helper`, source.includes("_shared/booking-email.ts"));
  expect(`${functionName} sends through the shared booking email helper`, source.includes("sendBookingEmail("));
  expect(`${functionName} renders branded HTML`, source.includes("paragraphsToHtml("));
}

const financeEmail = read("supabase/functions/send-finance-invoice/index.ts");
expect("finance invoice email imports the booking template", financeEmail.includes('from "../_shared/booking-email.ts"'));
expect("finance invoice email sends branded HTML", financeEmail.includes("html: paragraphsToHtml("));
expect("finance invoice email keeps its PDF attachment", financeEmail.includes("attachments: ["));

const staffTemplate = read("supabase/functions/_shared/staff-email.ts");
const registerParentEmail = read("supabase/functions/notify-register-parent/index.ts");
expect("staff email template supports an optional celebration image", staffTemplate.includes("celebrationImage?:"));
expect("staff email template provides meaningful image alt text", staffTemplate.includes("input.celebrationImage.alt"));
expect("staff email celebration artwork carries a badge awarded label", staffTemplate.includes('input.celebrationImage.label || "Badge awarded"'));
expect("register reward email awaits its branded HTML", registerParentEmail.includes("await rewardEmailHtml(context)"));
expect("reward email uses the dedicated public email asset bucket", registerParentEmail.includes('.from("email-brand-assets")'));
expect("reward email includes the celebration artwork only when available", registerParentEmail.includes("celebrationImage: celebrationImageUrl"));
expect(
  "reward email uses the positive rewards sender identity",
  registerParentEmail.includes('"Après School Rewards <hello@apres-school.co.uk>"'),
);
expect("reward celebration banner says well done", registerParentEmail.includes('label: "Well done!"'));

if (failures.length) {
  console.error("Booking email template check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Booking email template check passed for ${bookingFunctions.length} notification functions and finance invoices.`);
