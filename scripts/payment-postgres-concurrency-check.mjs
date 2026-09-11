// Isolated real PostgreSQL test. Never reads .env or accepts a database URL.
// Requires PostgreSQL 17 installed locally; starts no persistent service.
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
const run = promisify(execFile);
const bin = "/opt/homebrew/opt/postgresql@17/bin";
const root = await mkdtemp(join(tmpdir(), "apres-payment-test-"));
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket, { mode: 0o700 });
const env = { PATH: bin + ":/usr/bin:/bin", LC_ALL: "C" };
let started = false;
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(bin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", "55439", "-U", "apres_test", "-d", "postgres"], { env });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.on("data", chunk => { err += chunk; });
    child.on("error", reject);
    child.on("close", code => code ? reject(new Error(err)) : resolve(out.trim()));
    child.stdin.end(statement);
  });
}
const quoted = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
try {
  await run(join(bin, "initdb"), ["-D", data, "-U", "apres_test", "--auth-local=trust", "--auth-host=reject", "--no-locale"], { env });
  await run(join(bin, "pg_ctl"), ["-D", data, "-l", join(root, "server.log"), "-o", `-h '' -k ${socket} -p 55439`, "-w", "start"], { env });
  started = true;
  assert.equal(await sql("show listen_addresses;"), "", "No TCP listener permitted");
  const migration = await readFile(new URL("../supabase/migrations/0029_booking_core.sql", import.meta.url), "utf8");
  const ddl = migration.match(/create table if not exists booking_invoices \([\s\S]*?\n\);/)?.[0];
  assert.ok(ddl, "Use the repository's real invoice table definition");
  await sql(`create table profiles(id uuid primary key); ${ddl}
    insert into booking_invoices(id,total_amount,balance) values ('synthetic-invoice',100,100);`);
  const source = (await readFile(new URL("../supabase/functions/ponchopay-process-events/index.ts", import.meta.url), "utf8")).replace(/^import[\s\S]*?;\n/gm, "");
  const context = vm.createContext({ Deno: { env: { get: () => "synthetic" } }, serve() {}, createClient: () => ({}), Response, atob });
  vm.runInContext(stripTypeScriptTypes(source), context);
  const read = () => sql("select json_build_object('pid',pg_backend_pid(),'invoice',row_to_json(i)) from booking_invoices i where id='synthetic-invoice';").then(JSON.parse);
  const [left, right] = await Promise.all([read(), read()]);
  assert.notEqual(left.pid, right.pid, "Two separate database connections");
  const event = type => ({ id: "00000000-0000-4000-8000-000000000001", provider_event_id: type, event_type: type, invoice_id: "synthetic-invoice", amount: 100, expected_amount: 100, currency: "GBP", raw_payload: {} });
  const completed = context.buildInvoiceState(event("payment_completed"), left.invoice);
  const failed = context.buildInvoiceState(event("payment_failed"), right.invoice);
  async function write(state) {
    const { processingOutcome, retainSettledPayment, ...fields } = state;
    const columns = Object.keys(fields);
    return sql(`insert into booking_invoices (${columns.join(",")}) select ${columns.join(",")} from jsonb_populate_record(null::booking_invoices,${quoted(fields)}) on conflict(id) do update set ${columns.filter(key => key !== "id").map(key => `${key}=excluded.${key}`).join(",")};`);
  }
  await write(completed);
  await write(failed);
  const lost = (await read()).invoice;
  assert.equal(lost.payment_status, "failed");
  assert.equal(Number(lost.paid_amount), 0);
  // Establish that this environment can exercise real row-lock contention.
  const lock = spawn(join(bin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", "55439", "-U", "apres_test", "-d", "postgres"], { env });
  const locked = new Promise((resolve, reject) => { lock.stdout.on("data", chunk => { if (String(chunk).includes("LOCK_ACQUIRED")) resolve(); }); lock.on("error", reject); });
  const exited = new Promise(resolve => lock.on("close", resolve));
  lock.stdin.write("begin; select id from booking_invoices where id='synthetic-invoice' for update; select 'LOCK_ACQUIRED';\n");
  await locked;
  let contentionRejected = false;
  try { await sql("begin; set local lock_timeout='250ms'; update booking_invoices set payment_status='pending' where id='synthetic-invoice'; commit;"); }
  catch (error) { contentionRejected = /lock timeout/.test(error.message); }
  lock.stdin.end("rollback;\n");
  await exited;
  assert.ok(contentionRejected, "A separate writer is blocked by the row lock");
  const foundation = await readFile(new URL("../supabase/migrations/0041_booking_payment_foundations_backfill.sql", import.meta.url), "utf8");
  for (const table of ["ponchopay_webhook_events", "booking_receipts", "ponchopay_checkout_sessions"]) {
    const definition = foundation.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    assert.ok(definition);
    await sql(definition);
  }
  await sql(`create role anon; create role authenticated; create role service_role;
    create table bookings(id uuid primary key,status text,outstanding_balance numeric,invoice_id text,updated_at timestamptz);
    create table booking_items(booking_id text,status text,updated_at timestamptz);
    create table audit_log(action text,table_name text,record_id text,metadata jsonb);
    update booking_invoices set booking_id='00000000-0000-4000-8000-000000000020',payment_status='pending',paid_amount=0,balance=100;
    insert into bookings values('00000000-0000-4000-8000-000000000020','payment_pending',100,'synthetic-invoice',now());
    insert into booking_items values('00000000-0000-4000-8000-000000000020','reserved',now());
    insert into ponchopay_checkout_sessions(invoice_id) values('synthetic-invoice');`);
  await sql(await readFile(new URL("../supabase/migrations/0179_atomic_payment_event_commit.sql", import.meta.url), "utf8"));
  const successEvent = { ...event("payment_completed"), id: "00000000-0000-4000-8000-000000000010", provider_event_id: "atomic-success" };
  const failureEvent = { ...event("payment_failed"), id: "00000000-0000-4000-8000-000000000011", provider_event_id: "atomic-failure" };
  for (const e of [successEvent, failureEvent]) await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${e.id}','${e.provider_event_id}','${e.event_type}','synthetic-invoice','verified','synthetic');`);
  const snapshot = (await read()).invoice;
  function commit(e, current) {
    const next = context.buildInvoiceState(e,current);
    return `select commit_ponchopay_event('${e.id}','${current.id}',${quoted(current)},${quoted(next)},'${context.bookingStatusForInvoice(next.payment_status)}',${e.event_type === "payment_completed" ? quoted({ receipt_number: `synthetic-${e.provider_event_id}`, amount: e.amount }) : "null"});`;
  }
  const outcomes = await Promise.all([sql(commit(successEvent,snapshot)), sql(commit(failureEvent,snapshot))]);
  assert.equal(outcomes.map(JSON.parse).filter(r => r.status === "conflict").length,1);
  const loser = JSON.parse(outcomes[0]).status === "conflict" ? successEvent : failureEvent;
  await sql(commit(loser,(await read()).invoice));
  assert.equal((await read()).invoice.payment_status,"paid");
  assert.equal(Number((await read()).invoice.paid_amount),100);
  assert.equal(await sql("select status from bookings;"),"confirmed");
  assert.equal(await sql("select status from booking_items;"),"confirmed");
  assert.equal(await sql("select status from ponchopay_checkout_sessions;"),"paid");
  assert.equal(await sql("select count(*) from booking_receipts;"),"1");
  const outboxBefore = await sql("select count(*) from payment_notification_outbox;");
  assert.equal(JSON.parse(await sql(commit(successEvent,snapshot))).status,"existing");
  assert.equal(await sql("select count(*) from payment_notification_outbox;"),outboxBefore);
  // Emulate a crash after every statement executed but before transaction commit.
  const crash = { ...successEvent,id:"00000000-0000-4000-8000-000000000012",provider_event_id:"atomic-crash" };
  await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${crash.id}','atomic-crash','payment_completed','synthetic-invoice','verified','synthetic');`);
  await sql(`begin; ${commit(crash,(await read()).invoice)} rollback;`);
  assert.equal((await read()).invoice.payment_status,"paid");
  assert.equal(await sql(`select processing_status from ponchopay_webhook_events where id='${crash.id}';`),"received");
  assert.equal(await sql(`select count(*) from payment_notification_outbox where event_id='${crash.id}';`),"0");
  const retrySnapshot = (await read()).invoice;
  const retries = await Promise.all([sql(commit(crash,retrySnapshot)),sql(commit(crash,retrySnapshot))]);
  assert.deepEqual(retries.map(text => JSON.parse(text).status).sort(),["existing","processed"]);
  assert.equal(await sql(`select count(*) from payment_notification_outbox where event_id='${crash.id}';`),"1");
  assert.equal(await sql("select has_function_privilege('anon','commit_ponchopay_event(uuid,text,jsonb,jsonb,text,jsonb)','EXECUTE');"),"f");
  assert.equal(await sql("select has_function_privilege('authenticated','commit_ponchopay_event(uuid,text,jsonb,jsonb,text,jsonb)','EXECUTE');"),"f");
  console.log("PASS: atomic conflict/retry, paid booking/items/checkout, one receipt, duplicate delivery intent prevention, crash rollback and server-only grants");
  await sql(`alter table profiles add column email text, add column active boolean default true;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table parent_accounts(id uuid primary key,profile_id uuid,email text);
    create table parent_account_holders(parent_account_id uuid,profile_id uuid,status text);
    alter table bookings add column parent_account_id uuid, add column parent_id uuid, add column source text,
      add column metadata jsonb default '{}'::jsonb, add column due_today numeric;
    alter table audit_log add column actor_id uuid;`);
  for (const file of ["0057_parent_account_credit_ledger.sql","0059_parent_credit_topups.sql","0173_preserve_spent_cancellation_credit.sql","0177_reverse_cancelled_staff_adhoc_ledger_charge.sql","0178_apply_topups_to_outstanding_adhoc_invoices.sql"]) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
  }
  const account = "00000000-0000-4000-8000-000000000030";
  const care = "00000000-0000-4000-8000-000000000031";
  await sql(`insert into parent_accounts(id,email) values('${account}','synthetic@example.invalid');
    insert into bookings(id,status,parent_account_id,source,invoice_id,outstanding_balance) values('${care}','confirmed','${account}','staff_adhoc','synthetic-care',30);
    insert into booking_invoices(id,booking_id,total_amount,balance,metadata) values('synthetic-care','${care}',30,30,'{"staffAdHoc":true}');
    insert into booking_invoices(id,parent_email,total_amount,balance,metadata) values('synthetic-topup','synthetic@example.invalid',100,100,'{"creditTopUp":true,"parentAccountId":"${account}"}');`);
  const balance = () => sql(`select coalesce(sum(amount),0) from parent_account_credit_entries where parent_account_id='${account}' and status='posted';`).then(Number);
  assert.equal(await balance(),-30);
  const get = id => sql(`select row_to_json(i) from booking_invoices i where id='${id}';`).then(JSON.parse);
  const topup = { ...successEvent,id:"00000000-0000-4000-8000-000000000032",provider_event_id:"topup-success",invoice_id:"synthetic-topup" };
  await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${topup.id}','topup-success','payment_completed','synthetic-topup','verified','synthetic');`);
  const topupSnapshot = await get("synthetic-topup");
  await sql(commit(topup,topupSnapshot));
  assert.equal(await balance(),70,"£100 top-up minus £30 ad-hoc care");
  assert.equal(Number((await get("synthetic-care")).balance),0);
  assert.equal((await get("synthetic-care")).payment_status,"paid_with_credit");
  assert.equal(Number(await sql(`select outstanding_balance from bookings where id='${care}';`)),0);
  await sql(commit(topup,topupSnapshot));
  assert.equal(await balance(),70,"Duplicate top-up must not create credit twice");
  await sql(`update bookings set status='cancelled' where id='${care}'; update booking_invoices set payment_status='cancelled',balance=0 where id='synthetic-care';`);
  assert.equal(await balance(),100,"Cancelled ad-hoc care restores its ledger debit");
  await sql(`update booking_invoices set finance_status=finance_status where id='synthetic-care';`);
  assert.equal(await balance(),100,"Cancellation credit reconciliation is idempotent");
  console.log("PASS: real ledger triggers, £100 top-up, £30 ad-hoc settlement, duplicate top-up and cancellation debit reversal");
  const cancelledBooking = "00000000-0000-4000-8000-000000000040";
  await sql(`insert into bookings(id,status,parent_account_id,invoice_id) values('${cancelledBooking}','cancelled','${account}','synthetic-cancelled');
    insert into booking_invoices(id,booking_id,total_amount,paid_amount,balance,payment_status) values('synthetic-cancelled','${cancelledBooking}',0,50,0,'cancelled_credit');`);
  assert.equal(await balance(),150);
  await sql(`insert into parent_account_credit_entries(parent_account_id,entry_type,amount,description) values('${account}','credit_applied',-20,'Synthetic later booking');`);
  const delayed = { ...successEvent,id:"00000000-0000-4000-8000-000000000041",provider_event_id:"delayed-cancelled",invoice_id:"synthetic-cancelled",amount:50,expected_amount:50 };
  await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${delayed.id}','delayed-cancelled','payment_completed','synthetic-cancelled','verified','synthetic');`);
  await sql(commit(delayed,await get("synthetic-cancelled")));
  assert.equal(Number((await get("synthetic-cancelled")).total_amount),0,"Callback must retain amended zero total");
  assert.equal(await sql(`select status from bookings where id='${cancelledBooking}';`),"cancelled","No resurrection of cancelled care");
  assert.equal(await balance(),130,"Previously spent cancellation credit stays spent");
  const refundedTopup = { ...topup,id:"00000000-0000-4000-8000-000000000042",provider_event_id:"topup-refund",event_type:"payment_refunded",amount:20 };
  await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${refundedTopup.id}','topup-refund','payment_refunded','synthetic-topup','verified','synthetic');`);
  const refundSnapshot = await get("synthetic-topup");
  await sql(commit(refundedTopup,refundSnapshot));
  assert.equal(await balance(),110,"Cash refund reverses only the refunded top-up credit");
  await sql(commit(refundedTopup,refundSnapshot));
  assert.equal(await balance(),110,"Duplicate refund must not reverse credit twice");
  console.log("PASS: zero-total cancellation retained, cancelled booking not reopened, spent credit preserved, top-up refund and duplicate refund");
  await (await import('./payment-session-cancellation-check.mjs')).checkSessionCancellation(sql);
  console.log(JSON.stringify({ isolatedPostgres: true, tcpEnabled: false, twoConnections: true,
    staleWriteReproduced: true, rowLockContentionVerified: true, releaseSafe: false,
    legacyFinalStatus: lost.payment_status, legacyFinalPaid: lost.paid_amount,
    atomicFinalStatus: (await read()).invoice.payment_status, atomicConcurrencyPassed: true, evidenceDirectory: root,
    scope: "Real PostgreSQL invoice table and real state function; not full Supabase/provider/end-to-end integration." }, null, 2));
} finally {
  if (started) await run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { env });
}
