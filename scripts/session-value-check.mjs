import assert from "node:assert/strict";
import { bookedSessionValue, bookingItemValue, sessionPaymentLabel } from "../src/bookingLab/sessionValue.js";

const block = { price: 11.3, childName: "Child A" };
assert.equal(bookedSessionValue([{ unitAmount: 10.17, quantity: 1 }], block, 2), 10.17);
assert.equal(bookedSessionValue([{ unit_amount: 11.3, quantity: 1 }], block, 1), 11.3);
assert.equal(bookedSessionValue([], block, 2), 11.3);
assert.equal(bookedSessionValue([], { price: 11.3 }, 2), 22.6);
assert.equal(bookedSessionValue([{ line_total: 10.17 }, { lineTotal: 10.17 }], {}, 2), 20.34);
assert.equal(bookingItemValue({ lineTotal: 0, unitAmount: 11.3 }), 0);
assert.equal(bookingItemValue({ unit_amount: 5.65, quantity: 2 }), 11.3);
console.log("Session value checks passed (discounts, per-child fallback, quantities, zero-price items).");

// Sophie: the Monday session stays paid; Tuesday's credit belongs to the invoice.
assert.equal(bookedSessionValue([{ unitAmount: 6.12 }], { price: 6.8, childName: "Child A" }, 2), 6.12);
const active = { status: "Future" };
const amended = { status: "Credit raised", balance: 0, liveInvoice: { balance: 0 } };
assert.equal(sessionPaymentLabel(active, amended, "Confirmed"), "Paid");
assert.equal(sessionPaymentLabel(active, { ...amended, liveInvoice: { balance: 5 } }), "Outstanding");
assert.equal(sessionPaymentLabel(active, { status: "Credit raised" }), "Payment review");
assert.equal(sessionPaymentLabel(active, { status: "Payment plan" }), "Payment plan");
assert.equal(sessionPaymentLabel(active, { status: "Failed" }), "Failed");
assert.equal(sessionPaymentLabel(active, null, "Awaiting payment"), "Awaiting payment");
assert.equal(sessionPaymentLabel({ status: "Cancelled", cancellationOutcome: "credit", actualCreditAmount: 10.17 }, amended), "Credit raised");
assert.equal(sessionPaymentLabel({ status: "Cancelled", cancellationOutcome: "refunded" }, amended), "Refunded");
assert.equal(sessionPaymentLabel({ status: "Cancelled" }, amended), "Cancelled");
console.log("Session payment labels passed (active, cancelled, outstanding, unknown, refund and plan states).");
