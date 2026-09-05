import { readFileSync } from "node:fs";
import { join } from "node:path";
import { labSessions } from "../src/bookingLab/labData.js";
import { dayLabelToIso } from "../src/bookingLab/wraparound2026.js";

const root = process.cwd();
const failures = [];

const reservationSql = readFileSync(join(root, "supabase/migrations/0030_create_parent_booking_reservation.sql"), "utf8");
const seedSql = readFileSync(join(root, "supabase/migrations/0045_seed_2026_wraparound_booking_sessions.sql"), "utf8");
const cancellationSql = readFileSync(join(root, "supabase/migrations/0032_cancel_parent_booking.sql"), "utf8");
const amendmentSql = readFileSync(join(root, "supabase/migrations/0033_amend_parent_booking_remove_items.sql"), "utf8");
const individualCancellationSql = readFileSync(join(root, "supabase/migrations/0142_individual_session_cancellation_window.sql"), "utf8");
const amendmentAddSql = readFileSync(join(root, "supabase/migrations/0034_amend_parent_booking_add_items.sql"), "utf8");
const edgeFunction = readFileSync(join(root, "supabase/functions/create-parent-booking/index.ts"), "utf8");
const bookingSystemSource = readFileSync(join(root, "src/bookingSystem.js"), "utf8");
const siblingDiscountSql = readFileSync(join(root, "supabase/migrations/0157_server_side_sibling_discount.sql"), "utf8");
const staffFamilyRegisterSql = readFileSync(join(root, "supabase/migrations/0158_register_staff_family_indicator.sql"), "utf8");
const updateFunction = readFileSync(join(root, "supabase/functions/update-parent-booking/index.ts"), "utf8");
const bookingLabSource = readFileSync(join(root, "src/BookingLab.jsx"), "utf8");
const termsUrl = "https://docs.google.com/document/d/1ursh4YbP1e8cLG7fiUy0z3JezZWBUBG2_-7eG8wA0u0/edit?usp=sharing";

const launchSession = labSessions.find((session) => session.id === "lab-willington-after") || labSessions.find((session) => session.type === "Wraparound");
if (!launchSession) failures.push("No launch wraparound session found.");

const request = launchSession ? buildSampleRequest(launchSession) : null;
if (request) validateRequestShape(request);

[
  ["reservation RPC resolves labSessionId", reservationSql.includes("metadata->>'labSessionId'")],
  ["reservation RPC resolves sessionDate", reservationSql.includes("metadata->>'sessionDate'")],
  ["reservation RPC resolves labBlockLabel", reservationSql.includes("labBlockLabel")],
  ["seed stores labSessionId", seedSql.includes("'labSessionId'")],
  ["seed stores sessionDate", seedSql.includes("'sessionDate'")],
  ["edge function accepts labSessionId", edgeFunction.includes("labSessionId")],
  ["edge function accepts sessionDate", edgeFunction.includes("sessionDate")],
  ["edge function accepts sessionLabel", edgeFunction.includes("sessionLabel")],
  ["edge function permits resolvable metadata", edgeFunction.includes("hasResolvableMetadata")],
  ["edge function sends client request id", edgeFunction.includes("clientRequestId")],
  ["reservation RPC stores client request id", reservationSql.includes("metadata->>'clientRequestId'")],
  ["reservation RPC reuses existing request", reservationSql.includes("'existing', true")],
  ["cancellation RPC enforces parent window", cancellationSql.includes("Cancellation window has closed")],
  ["cancellation RPC releases capacity holds", cancellationSql.includes("booking_capacity_holds") && cancellationSql.includes("released_at")],
  ["cancellation RPC updates invoice status", cancellationSql.includes("booking_invoices") && cancellationSql.includes("cancelled_refund_review")],
  ["booking update function calls cancellation RPC", updateFunction.includes("cancel_parent_booking")],
  ["individual session cancellation uses the selected session start", individualCancellationSql.includes("selected_booking_item.starts_at")],
  ["individual session cancellation uses configured notice hours", individualCancellationSql.includes("selected_session.cancellation_hours") && individualCancellationSql.includes("make_interval")],
  ["amendment RPC releases removed capacity holds", amendmentSql.includes("amend_parent_booking_remove_items") && amendmentSql.includes("released_at")],
  ["amendment RPC updates invoice balance", amendmentSql.includes("amended_credit_review") && amendmentSql.includes("balance = greatest")],
  ["booking update function calls amendment RPC", updateFunction.includes("amend_parent_booking_remove_items")],
  ["parent portal enables live individual-session cancellation", bookingLabSource.includes("individualSessionCancellationPolicy") && bookingLabSource.includes("usesRealApi: realBookingServiceReady && Boolean(booking.id && item.id)")],
  ["parent portal uses four task-focused primary destinations", bookingLabSource.includes('aria-label="Quick parent navigation"') && bookingLabSource.includes(">Home</strong>") && bookingLabSource.includes(">Book</strong>") && bookingLabSource.includes(">Calendar</strong>") && bookingLabSource.includes(">Account</strong>")],
  ["parent home prioritises the next booking and common tasks", bookingLabSource.includes('aria-label="Parent home"') && bookingLabSource.includes("Next booking") && bookingLabSource.includes('aria-label="Common tasks"')],
  ["secondary parent functions are grouped within Account", bookingLabSource.includes('aria-label="Account options"') && bookingLabSource.includes("Payments &amp; credit") && bookingLabSource.includes("Help &amp; messages")],
  ["add-session amendment RPC enforces parent window", amendmentAddSql.includes("Amendment window has closed")],
  ["add-session amendment RPC checks capacity", amendmentAddSql.includes("booking_capacity_holds") && amendmentAddSql.includes("availableBeforeAmendment")],
  ["add-session amendment RPC updates invoice balance", amendmentAddSql.includes("amended_balance_due") && amendmentAddSql.includes("balance = balance + v_added_total")],
  ["booking update function calls add-session amendment RPC", updateFunction.includes("amend_parent_booking_add_items")],
  ["parent terms URL is canonical", bookingLabSource.includes(`const APRES_TERMS_URL = "${termsUrl}"`)],
  ["terms link is used at account creation and booking review", (bookingLabSource.match(/href=\{APRES_TERMS_URL\}/g) || []).length >= 2],
  ["technical ledger diagnostics are hidden from launch parents", bookingLabSource.includes("realBookingServiceReady && !isLaunchMode")],
  ["family account exposes authorised collectors", bookingLabSource.includes('"Authorised Collectors"') && bookingLabSource.includes("Manage authorised collectors")],
  ["authorised collectors remain separate from emergency contacts", bookingLabSource.includes("authorisedCollectors: updatedChild.authorisedCollectors || []")],
  ["parent checkout bypasses silent browser validation", bookingLabSource.includes('onSubmit={submitBooking} noValidate')],
  ["parent checkout shows an in-place submission status", bookingLabSource.includes('className="lab-checkout-action-status"') && bookingLabSource.includes('aria-live="polite"')],
  ["parent checkout blocks duplicate booking submissions", bookingLabSource.includes("bookingSubmissionRef.current") && bookingLabSource.includes('bookingSubmitting ? "Reserving sessions…"')],
  ["parent booking displays four clear journey stages", bookingLabSource.includes('label: "Choose care"') && bookingLabSource.includes('label: "Dates"') && bookingLabSource.includes('label: "Payment method"') && bookingLabSource.includes('label: "Confirmation"')],
  ["launch checkout starts at payment without a misleading child stage", bookingLabSource.includes('isLaunchMode ? ["Payment", "Review"]') && bookingLabSource.includes('`${checkoutStep === "Review" ? 4 : 3} of 4`')],
  ["booking failures preserve selections and explain that nothing was charged", bookingLabSource.includes("friendlyBookingFailure") && bookingLabSource.includes("nothing has been charged") && bookingLabSource.includes("Your selections are still here")],
  ["submission lock remains active while secure checkout is prepared", bookingLabSource.indexOf("bookingSubmissionRef.current = false;", bookingLabSource.indexOf("let checkoutPreparationIssue")) > bookingLabSource.indexOf("await createCheckoutSessionForBooking(booking)")],
  ["journey session summary includes items already moved into the basket", bookingLabSource.includes("const launchJourneySessionCount = draftBookingBasket.length || selectedBlockCount || pickedDays.length")],
  ["parent home promotes secure account credit top-ups", bookingLabSource.includes('className="lab-parent-home-credit"') && bookingLabSource.includes("openParentCreditTopUp") && bookingLabSource.includes("Any unused balance stays on your account")],
  ["authoritative parent quote applies sibling pricing", bookingSystemSource.includes('quote_current_parent_pricing_with_sibling')],
  ["booking creation persists sibling pricing", edgeFunction.includes('apply_booking_sibling_discount')],
  ["booking creation prefers a parent's owned account over linked-holder invitations", edgeFunction.indexOf('.from("parent_accounts")', edgeFunction.indexOf("async function resolveBookingActor")) < edgeFunction.indexOf('.from("parent_account_holders")', edgeFunction.indexOf("async function resolveBookingActor"))],
  ["booking creation surfaces database error messages", edgeFunction.includes('readableErrorMessage(error, "Unable to create booking")') && edgeFunction.includes("stringValue(error.message)")],
  ["sibling pricing requires at least two distinct children", siblingDiscountSql.includes("count(distinct") && siblingDiscountSql.includes("v_child_count < 2")],
  ["sibling pricing is visible in the basket", bookingLabSource.includes('10% sibling discount applied') && bookingLabSource.includes('basketPricingQuote.siblingDiscountTotal')],
  ["register identifies staff families server-side", staffFamilyRegisterSql.includes("parent_is_staff boolean") && staffFamilyRegisterSql.includes("parent_pricing_assignments") && staffFamilyRegisterSql.includes("staff_records")],
  ["register displays a labelled staff-family marker", bookingLabSource.includes('10% sibling discount applied') && readFileSync(join(root, "src/PlatformModule.jsx"), "utf8").includes('aria-label="Staff family"')],
].forEach(([label, ok]) => {
  if (!ok) failures.push(label);
});

const seedCoverage = labSessions
  .filter((session) => session.type === "Wraparound" && session.academicYear === "2026/27")
  .map((session) => ({
    id: session.id,
    inSeed: seedSql.includes(`'${sqlEscape(session.id)}'`),
    labels: (session.sessionBlocks || []).map((block) => ({
      label: block.label,
      inSeed: seedSql.includes(`"label":"${jsonEscape(block.label)}"`),
    })),
  }));

seedCoverage.forEach((row) => {
  if (!row.inSeed) failures.push(`${row.id}: missing from seed migration`);
  row.labels.forEach((label) => {
    if (!label.inSeed) failures.push(`${row.id}: missing block label ${label.label} from seed migration`);
  });
});

const report = {
  bookingContractReady: failures.length === 0,
  sampleRequest: request ? {
    parent: request.parent,
    paymentMethod: request.paymentMethod,
    paymentPlan: request.paymentPlan,
    itemCount: request.items.length,
    firstItem: request.items[0],
  } : null,
  seedCoverage,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

function buildSampleRequest(session) {
  const dayLabel = session.days?.[0];
  const sessionDate = dayLabelToIso(dayLabel);
  const items = (session.sessionBlocks || []).map((block) => ({
    childName: "Ava",
    labSessionId: session.id,
    sessionDate,
    sessionLabel: block.label,
    quantity: 1,
    metadata: {
      labSessionId: session.id,
      labDay: dayLabel,
      sessionDate,
      labBlockKey: `${block.label}-${block.start}-${block.end}`,
      labBlockLabel: block.label,
    },
  }));

  return {
    parent: {
      fullName: "Demo Parent",
      email: "demo@example.com",
      phone: "07123 456789",
    },
    paymentMethod: "card",
    paymentPlan: "pay_now",
    paymentRoute: "PonchoPay card + vouchers",
    clientRequestId: "lab-booking-contract-check",
    source: "launch_parent_flow",
    metadata: {
      clientRequestId: "lab-booking-contract-check",
      localDraftId: "lab-booking-contract-check",
      site: session.site,
      activity: session.title,
      selectedDays: [dayLabel],
    },
    items,
  };
}

function validateRequestShape(request) {
  if (!request.items.length) failures.push("Sample booking request has no items.");
  request.items.forEach((item, index) => {
    if (!item.labSessionId) failures.push(`Item ${index + 1}: missing labSessionId`);
    if (!item.sessionDate) failures.push(`Item ${index + 1}: missing sessionDate`);
    if (!item.sessionLabel) failures.push(`Item ${index + 1}: missing sessionLabel`);
    if (!item.metadata?.labBlockLabel) failures.push(`Item ${index + 1}: missing metadata.labBlockLabel`);
    if (item.sessionBlockId) failures.push(`Item ${index + 1}: should not require sessionBlockId for metadata-resolved launch bookings`);
  });
}

function sqlEscape(value) {
  return String(value || "").replaceAll("'", "''");
}

function jsonEscape(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
