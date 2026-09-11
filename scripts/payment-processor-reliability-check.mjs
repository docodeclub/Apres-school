// Execute the actual processor in an isolated VM: no network, database or email access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
const source = readFileSync(new URL("../supabase/functions/ponchopay-process-events/index.ts", import.meta.url), "utf8").replace(/^import[\s\S]*?;\n/gm, "");
function processor(token = "synthetic-processor-secret", database) {
  let handler;
  let dbCalls = 0;
  const context = vm.createContext({
    Deno: { env: { get: key => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret", PONCHOPAY_PROCESSOR_TOKEN: token })[key] } },
    createClient: () => database || ({ from() { dbCalls++; throw new Error("Synthetic database boundary"); } }),
    serve: fn => { handler = fn; }, Response, Request, Headers, atob, console: { error() {} },
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return { context, handler, calls: () => dbCalls };
}
const forged = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.unsigned`;
for (const token of ["synthetic-processor-secret", ""]) {
  for (const headers of [{}, { authorization: `Bearer ${forged}` }, { "x-processor-token": "wrong" }, { apikey: "wrong" }]) {
    const p = processor(token);
    const response = await p.handler(new Request("https://synthetic.invalid/process", { method: "POST", headers, body: "{}" }));
    assert.equal(response.status, 401, `Deny untrusted request with configured token=${Boolean(token)}`);
    assert.equal(p.calls(), 0, "Reject before accessing financial data");
  }
}
for (const headers of [{ "x-processor-token": "synthetic-processor-secret" }, { authorization: "Bearer synthetic-service-secret" }, { apikey: "synthetic-service-secret" }]) {
  const p = processor();
  await p.handler(new Request("https://synthetic.invalid/process", { method: "POST", headers, body: "{}" }));
  assert.equal(p.calls(), 1, "Trusted internal request reaches the isolated database boundary");
}
const p = processor();
const original = { id: "synthetic-invoice", total_amount: 100, paid_amount: 0, refunded_amount: 0, currency: "GBP" };
const event = type => ({ id: "synthetic-event", provider_event_id: type, event_type: type, invoice_id: original.id, amount: 100, expected_amount: 100, currency: "GBP", raw_payload: {} });
const paid = p.context.buildInvoiceState(event("payment_completed"), original);
const replayed = p.context.buildInvoiceState(event("payment_completed"), paid);
assert.equal(replayed.paid_amount, 100);
assert.equal(replayed.balance, 0);
const reported = p.context.buildInvoiceState(event("payment_reported_complete"), paid);
assert.equal(reported.payment_status, "paid");
assert.equal(reported.balance, 0);
const lateFailure = p.context.buildInvoiceState(event("payment_failed"), paid);
assert.equal(lateFailure.payment_status, "paid");
let replayCases = 0;
for (const status of ["paid", "reconciled", "bank_confirmed", "paid_by_fallback_card"]) {
  for (const type of ["payment_failed", "payment_cancelled"]) {
    for (const paymentId of ["settled-attempt", "different-attempt", null]) {
      const settled = { ...paid, payment_status: status, provider_payment_id: "settled-attempt" };
      const incoming = { ...event(type), payment_id: paymentId };
      const next = p.context.buildInvoiceState(incoming, settled);
      assert.equal(next.payment_status, status);
      assert.equal(next.provider_payment_id, "settled-attempt");
      assert.equal(next.retainSettledPayment, true);
      const writes = [];
      const database = { async rpc(name, args) {
        assert.equal(name, "commit_ponchopay_event");
        assert.equal(args.p_next.retainSettledPayment, true);
        writes.push(["atomic_rpc", args]);
        return { data: { status: "skipped", reason: "adverse_event_after_settlement" }, error: null };
      }, from(table) {
        return {
          select() { assert.equal(table, "booking_invoices"); return { eq() { return { maybeSingle: async () => ({ data: settled }) }; } }; },
          update(value) { assert.equal(table, "ponchopay_webhook_events"); writes.push([table, value]); return { eq: async () => ({ error: null }) }; },
          insert(value) { assert.equal(table, "audit_log"); writes.push([table, value]); return Promise.resolve({ error: null }); },
        };
      } };
      const isolated = processor(undefined, database);
      const result = await isolated.context.processEvent(incoming);
      assert.equal(result.reason, "adverse_event_after_settlement");
      assert.ok(writes.some(([table]) => table === "atomic_rpc"));
      replayCases++;
    }
  }
}
for (const status of ["pending", "part_paid", "payment_guaranteed", "payment_plan_active", "captured"]) {
  const next = p.context.buildInvoiceState(event("payment_failed"), { ...original, payment_status: status });
  assert.equal(next.retainSettledPayment, false);
  assert.equal(next.payment_status, "failed");
}
const refund = p.context.buildInvoiceState({ ...event("payment_refunded"), amount: 20 }, paid);
assert.equal(refund.refunded_amount, 20);
assert.equal(refund.retainSettledPayment, false);
assert.equal(p.context.buildInvoiceState(event("recurring_payment_cancelled"), paid).payment_status, "payment_plan_cancelled");
console.log(`PASS: ${replayCases} adverse-event state and processor-path replays; refunds, plan cancellation and unpaid failures unchanged`);
function outboxDatabase(row) {
  return { from(table) {
    assert.equal(table, "payment_notification_outbox");
    let change = null;
    const filters = [];
    function execute(single = false) {
      if (!filters.every(test => test(row))) return { data: single ? null : [], error: null };
      if (change) Object.assign(row, change);
      return { data: single ? structuredClone(row) : [structuredClone(row)], error: null };
    }
    const query = {
      select() { return query; }, update(value) { change = value; return query; },
      eq(key,value) { filters.push(r => r[key] === value); return query; },
      lt(key,value) { filters.push(r => r[key] < value); return query; },
      order() { return query; }, limit() { return Promise.resolve(execute()); },
      maybeSingle() { return Promise.resolve(execute(true)); },
      then(resolve,reject) { return Promise.resolve(execute()).then(resolve,reject); },
    };
    return query;
  } };
}
for (const scenario of ["parallel", "uncertain", "abandoned"]) {
  const row = { event_id: "synthetic-notification", status: scenario === "abandoned" ? "sending" : "pending",
    updated_at: "2000-01-01T00:00:00Z", payload: { event: {}, invoice: {}, receiptId: null, bookingStatus: "confirmed" } };
  const worker = processor(undefined,outboxDatabase(row));
  let sends = 0;
  worker.context.sendPaymentLifecycleEmail = async () => { sends++; if (scenario === "uncertain") throw new Error("Synthetic uncertain delivery"); return { status: "sent" }; };
  await Promise.all([worker.context.drainPaymentNotifications(),worker.context.drainPaymentNotifications()]);
  await worker.context.drainPaymentNotifications();
  assert.equal(sends,scenario === "abandoned" ? 0 : 1);
  assert.equal(row.status,scenario === "parallel" ? "sent" : "review");
}
console.log("PASS: notification concurrent claim, uncertain delivery and interrupted-worker review without blind resend");
console.log(JSON.stringify({ authCasesPassed: 11, duplicateCompletion: "passes pure state calculation", weakerReportedComplete: "preserves paid", lateFailure: { status: lateFailure.payment_status, paid: lateFailure.paid_amount, balance: lateFailure.balance }, limits: "No database transaction, provider callback or email executed" }, null, 2));
