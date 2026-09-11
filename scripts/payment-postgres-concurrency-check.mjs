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
  console.log(JSON.stringify({ isolatedPostgres: true, tcpEnabled: false, twoConnections: true,
    staleWriteReproduced: true, rowLockContentionVerified: true, releaseSafe: false,
    finalStatus: lost.payment_status, finalPaid: lost.paid_amount, evidenceDirectory: root,
    scope: "Real PostgreSQL invoice table and real state function; not full Supabase/provider/end-to-end integration." }, null, 2));
} finally {
  if (started) await run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { env });
}
