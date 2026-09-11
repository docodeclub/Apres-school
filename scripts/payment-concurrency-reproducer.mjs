// Deterministic in-memory interleaving of the real processor orchestration.
// This is NOT a PostgreSQL/staging integration test. All I/O is substituted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
const source = readFileSync(new URL("../supabase/functions/ponchopay-process-events/index.ts", import.meta.url), "utf8").replace(/^import[\s\S]*?;\n/gm, "");
let invoice = { id: "synthetic-invoice", total_amount: 100, paid_amount: 0, refunded_amount: 0, payment_status: "pending", currency: "GBP" };
let releaseReads, releasePaidWrite;
const bothRead = new Promise(resolve => { releaseReads = resolve; });
const paidWritten = new Promise(resolve => { releasePaidWrite = resolve; });
let reads = 0;
const writes = [];
const context = vm.createContext({
  Deno: { env: { get: () => "synthetic" } }, serve() {},
  createClient: () => ({ from(table) { assert.equal(table, "audit_log"); return { insert: async () => ({ error: null }) }; } }),
  Response, atob, console,
  testRead: async () => {
    const snapshot = structuredClone(invoice);
    if (++reads === 2) releaseReads();
    await bothRead;
    return snapshot;
  },
  testWrite: async next => {
    if (next.payment_status === "failed") await paidWritten;
    invoice = structuredClone(next);
    writes.push(next.payment_status);
    if (next.payment_status === "paid") releasePaidWrite();
  },
});
vm.runInContext(stripTypeScriptTypes(source), context);
vm.runInContext(`
  resolveInvoiceId = async event => event.invoice_id;
  getInvoice = testRead;
  upsertInvoice = testWrite;
  updateCheckoutSessionFromEvent = async () => {};
  ensureReceipt = async () => "synthetic-receipt";
  updateBookingFromInvoice = async () => "synthetic";
  sendPaymentLifecycleEmail = async () => null;
  markEvent = async () => {};
`, context);
const event = type => ({ id: type, provider_event_id: type, event_type: type, invoice_id: invoice.id, amount: 100, expected_amount: 100, currency: "GBP", raw_payload: {} });
const results = await Promise.all([context.processEvent(event("payment_completed")), context.processEvent(event("payment_failed"))]);
assert.ok(results.every(result => result.status === "processed"));
assert.deepEqual(writes, ["paid", "failed"]);
assert.equal(invoice.payment_status, "failed");
assert.equal(invoice.paid_amount, 0);
console.log(JSON.stringify({ reproduced: true, releaseSafe: false, writes, finalStatus: invoice.payment_status, finalPaidAmount: invoice.paid_amount,
  explanation: "Both workers read pending; the stale failure overwrites the completed payment. Sequential replay protection is insufficient.",
  scope: "In-memory simulation of actual processEvent with substituted I/O; no live data, email, network or PostgreSQL transaction." }, null, 2));
