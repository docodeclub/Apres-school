import assert from "node:assert/strict";
import { bookedSessionValue, bookingItemValue } from "../src/bookingLab/sessionValue.js";

const block = { price: 11.3, childName: "Child A" };
assert.equal(bookedSessionValue([{ unitAmount: 10.17, quantity: 1 }], block, 2), 10.17);
assert.equal(bookedSessionValue([{ unit_amount: 11.3, quantity: 1 }], block, 1), 11.3);
assert.equal(bookedSessionValue([], block, 2), 11.3);
assert.equal(bookedSessionValue([], { price: 11.3 }, 2), 22.6);
assert.equal(bookedSessionValue([{ line_total: 10.17 }, { lineTotal: 10.17 }], {}, 2), 20.34);
assert.equal(bookingItemValue({ lineTotal: 0, unitAmount: 11.3 }), 0);
assert.equal(bookingItemValue({ unit_amount: 5.65, quantity: 2 }), 11.3);
console.log("Session value checks passed (discounts, per-child fallback, quantities, zero-price items).");
