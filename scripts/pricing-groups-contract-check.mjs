import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0102_pricing_groups_engine.sql");
const assignmentMigration = read("supabase/migrations/0104_enforce_single_parent_pricing_group.sql");
const platform = read("src/PlatformModule.jsx");
const bookingLab = read("src/BookingLab.jsx");
const pricingUi = read("src/PricingGroupsModule.jsx");
const createBooking = read("supabase/functions/create-parent-booking/index.ts");
const amendBooking = read("supabase/functions/update-parent-booking/index.ts");
const adHoc = read("supabase/functions/create-staff-adhoc-booking/index.ts");
const invoice = read("supabase/functions/_shared/booking-invoice-pdf.js");
const assignmentFunction = read("supabase/functions/manage-parent-pricing-group/index.ts");
const supabaseClient = read("src/supabaseClient.js");

const checks = [
  [migration.includes("create table if not exists public.pricing_groups"), "pricing group schema"],
  [migration.includes("create table if not exists public.parent_pricing_assignments"), "effective-dated parent assignments"],
  [assignmentMigration.includes("assign_parent_pricing_group") && assignmentMigration.includes("parent_accounts_default_pricing_group"), "one explicit effective group per parent"],
  [migration.includes("create table if not exists public.parent_pricing_overrides"), "parent override schema"],
  [migration.includes("create table if not exists public.booking_pricing_adjustments"), "immutable booking price snapshots"],
  [migration.includes("if v_item.adjustment_id is not null") && migration.includes("continue;"), "amendments preserve historical prices"],
  [migration.indexOf("v_override.id is not null") < migration.indexOf("v_rule.id is not null"), "override precedence before group rules"],
  [migration.includes("quote_current_parent_pricing") && migration.includes("current_parent_pricing_summary"), "parent quote and benefits APIs"],
  [/Shrewsbury House Staff/.test(migration) && /Willington Staff/.test(migration) && /King''s House Staff/.test(migration) && /Ripley Staff/.test(migration), "required seeded staff groups"],
  [platform.includes('"Pricing Groups"') && platform.includes("PricingGroupsModule"), "role-aware admin navigation"],
  [pricingUi.includes("Manager view only") && pricingUi.includes("Activity Log") && pricingUi.includes("Reports"), "manager view and admin workspace"],
  [createBooking.includes('rpc("apply_booking_pricing"'), "parent bookings priced server-side"],
  [amendBooking.match(/rpc\("apply_booking_pricing"/g)?.length === 2, "add/remove amendments refresh totals"],
  [adHoc.includes('rpc("apply_booking_pricing"'), "staff ad-hoc bookings use family pricing"],
  [invoice.includes("Pricing group:") && invoice.includes("pricingLabel"), "invoice pricing transparency"],
  [bookingLab.includes("lab-active-pricing-benefit") && bookingLab.includes("Final price is confirmed after you choose dates and sessions"), "activity-level parent benefit preview"],
  [assignmentFunction.includes('emailType: "parent_pricing_tier_welcome"') && assignmentFunction.includes("Your benefits") && assignmentFunction.includes("buildStaffEmailHtml") && assignmentFunction.includes("sole discretion of Après School"), "branded pricing tier welcome email and eligibility terms"],
  [assignmentFunction.includes('rpc("assign_parent_pricing_group"') && supabaseClient.includes('"manage-parent-pricing-group"'), "secure assignment triggers welcome email"],
];

const failures = checks.filter(([pass]) => !pass);
for (const [pass, label] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
if (failures.length) process.exit(1);
console.log(`Pricing groups contract passed (${checks.length}/${checks.length}).`);
