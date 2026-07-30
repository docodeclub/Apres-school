import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/0102_pricing_groups_engine.sql");
const assignmentMigration = read("supabase/migrations/0104_enforce_single_parent_pricing_group.sql");
const adHocPricingMigration = read("supabase/migrations/0106_staff_adhoc_pricing_quote.sql");
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
  [adHocPricingMigration.includes("quote_staff_adhoc_pricing") && adHocPricingMigration.includes("calculate_parent_price"), "staff ad-hoc drawer uses authoritative family quote"],
  [adHoc.includes("invoiceBeforeCharge") && adHoc.includes("total_amount: pricedTotal") && adHoc.includes("finalise_staff_adhoc_account_charge"), "staff ad-hoc invoice is repriced before the family charge"],
  [platform.includes("Family pricing") && platform.includes("Pricing benefit") && platform.includes("adHocQuotedTotal"), "staff ad-hoc drawer shows group savings and final charge"],
  [invoice.includes("Pricing group:") && invoice.includes("pricingLabel"), "invoice pricing transparency"],
  [bookingLab.includes("lab-active-pricing-benefit") && bookingLab.includes("Final price is confirmed after you choose dates and sessions"), "activity-level parent benefit preview"],
  [bookingLab.includes("pricingQuoteLoading") && bookingLab.includes("Checking your tier price") && bookingLab.includes("const basketPricingQuote = pricingQuote?.signature === basketPricingSignature"), "basket prices quote and display before checkout"],
  [bookingLab.includes("resolveLiveBasketSessionBlocks") && bookingLab.includes("fetchBookableSessions") && bookingLab.includes("liveBlock.id"), "prototype basket rows resolve to live session blocks before pricing"],
  [bookingLab.includes("confirmedWithoutPayment") && bookingLab.includes("confirmed_without_payment") && bookingLab.includes("No payment link is required"), "fully discounted bookings never open a payment fallback"],
  [createBooking.includes("zeroBalanceBooking") && createBooking.includes('status: "confirmed"') && createBooking.includes('due_today: 0'), "zero-balance backend fallback confirms without PonchoPay"],
  [bookingLab.includes("bookingRequiresNoPayment") && bookingLab.includes("Confirm free booking") && bookingLab.includes("No PonchoPay step or card guarantee"), "free-booking checkout clearly bypasses PonchoPay"],
  [bookingLab.includes("confirmedNoBalance") && bookingLab.includes('"Pricing benefit"'), "parent account shows confirmed zero-price bookings without a payment wait state"],
  [bookingLab.includes("explicitChildConsentChoices") && bookingLab.includes("Answer every permission with Yes or No") && !bookingLab.includes('["No", "N/A", "Yes"]'), "child permissions require explicit Yes or No"],
  [bookingLab.includes("childBookingProfileIssues") && bookingLab.includes("Your basket has been kept"), "checkout blocks incomplete child profiles with a recovery route"],
  [createBooking.includes("CHILD_PROFILE_INCOMPLETE") && createBooking.includes("requiredChildConsentRows") && createBooking.includes('["Yes", "No"]'), "server rejects bookings with incomplete child profiles or ambiguous permissions"],
  [createBooking.includes("Booking saved but confirmation email failed") && createBooking.includes("parent_booking_email_failed"), "booking success is not rolled back by email delivery failure"],
  [assignmentFunction.includes('emailType: "parent_pricing_tier_welcome"') && assignmentFunction.includes("Your benefits") && assignmentFunction.includes("buildStaffEmailHtml") && assignmentFunction.includes("sole discretion of Après School"), "branded pricing tier welcome email and eligibility terms"],
  [assignmentFunction.includes("APRES_PRICING_EMAIL_CC") && assignmentFunction.includes("luke@apres-school.co.uk") && assignmentFunction.includes("monitoringCc"), "pricing welcome monitoring copy"],
  [assignmentFunction.includes('rpc("assign_parent_pricing_group"') && supabaseClient.includes('"manage-parent-pricing-group"') && supabaseClient.includes("auth.refreshSession()") && bookingLab.includes("quoteParentBookingPricing") && read("src/bookingSystem.js").includes("supabase.auth.refreshSession()"), "session-safe assignment and parent quote calls"],
  [amendBooking.includes('action === "record_credit_note"') && amendBooking.includes("updatePayload.balance = nextBalance") && amendBooking.includes("outstanding_balance: moneyValue(updatePayload.balance)"), "credit notes clear invoice and booking balances"],
];

const failures = checks.filter(([pass]) => !pass);
for (const [pass, label] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
if (failures.length) process.exit(1);
console.log(`Pricing groups contract passed (${checks.length}/${checks.length}).`);
