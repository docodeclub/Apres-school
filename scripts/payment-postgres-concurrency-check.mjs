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
    create table bookings(id text primary key,status text,outstanding_balance numeric,invoice_id text,updated_at timestamptz);
    create table booking_items(booking_id text,status text,updated_at timestamptz);
    create table audit_log(action text,table_name text,record_id text,metadata jsonb);
    update booking_invoices set booking_id='synthetic-booking',payment_status='pending',paid_amount=0,balance=100;
    insert into bookings values('synthetic-booking','payment_pending',100,'synthetic-invoice',now());
    insert into booking_items values('synthetic-booking','reserved',now());
    insert into ponchopay_checkout_sessions(invoice_id) values('synthetic-invoice');`);
  await sql(await readFile(new URL("../supabase/migrations/0179_atomic_payment_event_commit.sql", import.meta.url), "utf8"));
  const successEvent = { ...event("payment_completed"), id: "00000000-0000-4000-8000-000000000010", provider_event_id: "atomic-success" };
  const failureEvent = { ...event("payment_failed"), id: "00000000-0000-4000-8000-000000000011", provider_event_id: "atomic-failure" };
  for (const e of [successEvent, failureEvent]) await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${e.id}','${e.provider_event_id}','${e.event_type}','synthetic-invoice','verified','synthetic');`);
  const snapshot = (await read()).invoice;
  function commit(e, current) {
    const next = context.buildInvoiceState(e,current);
    return `select commit_ponchopay_event('${e.id}','synthetic-invoice',${quoted(current)},${quoted(next)},'${context.bookingStatusForInvoice(next.payment_status)}',${e.event_type === "payment_completed" ? quoted({ receipt_number: "synthetic-receipt", amount: 100 }) : "null"});`;
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
  console.log(JSON.stringify({ isolatedPostgres: true, tcpEnabled: false, twoConnections: true,
    staleWriteReproduced: true, rowLockContentionVerified: true, releaseSafe: false,
    legacyFinalStatus: lost.payment_status, legacyFinalPaid: lost.paid_amount,
    atomicFinalStatus: (await read()).invoice.payment_status, atomicConcurrencyPassed: true, evidenceDirectory: root,
    scope: "Real PostgreSQL invoice table and real state function; not full Supabase/provider/end-to-end integration." }, null, 2));
} finally {
  if (started) await run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { env });
}
