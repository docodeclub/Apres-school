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
const amendmentAddSql = readFileSync(join(root, "supabase/migrations/0034_amend_parent_booking_add_items.sql"), "utf8");
const edgeFunction = readFileSync(join(root, "supabase/functions/create-parent-booking/index.ts"), "utf8");
const updateFunction = readFileSync(join(root, "supabase/functions/update-parent-booking/index.ts"), "utf8");

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
  ["amendment RPC enforces parent window", amendmentSql.includes("Amendment window has closed")],
  ["amendment RPC releases removed capacity holds", amendmentSql.includes("amend_parent_booking_remove_items") && amendmentSql.includes("released_at")],
  ["amendment RPC updates invoice balance", amendmentSql.includes("amended_credit_review") && amendmentSql.includes("balance = greatest")],
  ["booking update function calls amendment RPC", updateFunction.includes("amend_parent_booking_remove_items")],
  ["add-session amendment RPC enforces parent window", amendmentAddSql.includes("Amendment window has closed")],
  ["add-session amendment RPC checks capacity", amendmentAddSql.includes("booking_capacity_holds") && amendmentAddSql.includes("availableBeforeAmendment")],
  ["add-session amendment RPC updates invoice balance", amendmentAddSql.includes("amended_balance_due") && amendmentAddSql.includes("balance = balance + v_added_total")],
  ["booking update function calls add-session amendment RPC", updateFunction.includes("amend_parent_booking_add_items")],
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
