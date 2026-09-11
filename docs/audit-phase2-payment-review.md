# Phase 2, first reliability batch

Phase 1 pushed as commit e8202e9 to codex/audit-phase1. Following explicit approval, the processor authorisation fix was deployed on 11 September 2026 to the linked Après School project (djkfuftbtfthjpezvjuu). The callback caller already supplies the exact service credential and optional processor token, so its authorised path is retained. No live processor POST was used for verification because that could process genuine events and send emails. The late-event fix below is local, not deployed. Public Phase 1 changes remain on their review branch.

## Reproduced and locally fixed: processor authorisation

The actual payment processor handler was executed in a Node VM with stubbed server registration and database access. Imports are removed and TypeScript stripped; no network, database or email implementation is available in this harness.

Before the fix, a forged unsigned token claiming service_role reached the database boundary and returned the stub's 500 instead of 401. Source inspection also showed that an unset PONCHOPAY_PROCESSOR_TOKEN skipped the authorisation check. The deployment script lists this function with JWT verification disabled; actual deployed settings were not inspected. This is a verified application-level defect, not evidence of exploitation.

The fix accepts only the configured processor token or an exact configured service credential, and fails closed otherwise. Unverified decoded JWT claims no longer authorise financial operations. Trusted caller paths are retained.

Tests: eight denied cases across configured/unset token settings plus three accepted internal credential paths pass. Denied cases assert zero database calls. Existing PonchoPay contract remains 105/105.

## Reproduced and locally fixed: late failure downgrades paid invoice

Calling the actual buildInvoiceState function with a £100 completed invoice and then payment_failed produces payment_status=failed, paid_amount=100 and balance=0. Duplicate completion does not double the amount, and a weaker payment_reported_complete event preserves paid state. These are pure state tests, not end-to-end reconciliation tests.

The local fix preserves fully settled positive-value invoices with no refund when a payment_failed or payment_cancelled event arrives. Same, different and missing payment IDs all produce an audit record retaining both IDs where available. The event is skipped for finance review without writing invoice/checkout/booking state or issuing receipts/emails. A failed attempt cannot itself reverse received funds. Captured-only, guarantees, recurring-plan cancellation, unpaid failures and refund handling are unchanged.

24 isolated state-and-processor replay cases pass across paid/reconciled/bank-confirmed/fallback-card states and three payment-ID relationships. The fake database permits only invoice reads, event updates and audit inserts; unexpected side effects fail the tests. Additional tests retain refund, recurring cancellation and unsettled-failure behaviour. The existing 105-check PonchoPay contract still passes. This does not prove concurrent-worker safety: the processor reads and writes separately, so isolated database concurrency remains a release risk and subsequent task.

## Staging limitation

Neither Docker nor psql was available on PATH during inspection. No isolated database target has been verified, so concurrent-capacity, duplicate-worker, credit-ledger and provider replay tests have not run against a database. A passing pure-state test does not establish transaction idempotency. Do not substitute production records or a hidden frontend connected to production for isolated staging.

## Suggested next task

Review the late-event protection and validate it in isolated staging, including concurrent workers, then approve its deployment. Follow with top-up/credit settlement and two-child reservation-to-register tests. Production deployment should not be bundled silently with public content changes.

## Concurrent-worker follow-up — release blocked

`scripts/payment-concurrency-reproducer.mjs` deterministically interleaves two calls to the actual processEvent implementation with substituted I/O. Both read the pending £100 invoice. Completion writes paid/£100 first; the stale failure then writes failed/£0. Both workers report processed. The local sequential-event guard cannot prevent this lost update.

This is an in-memory reproduction, not a database staging test or evidence of a particular affected customer. No customer records or emails were accessed. The reproducer exits successfully when it reproduces the defect and explicitly reports releaseSafe=false; it is not a passing correctness test.

Current accessible projects are Après School (production) and the unrelated docode-studio. Neither is an approved isolated test target. Docker, Podman and psql were unavailable, and no Docker/Postgres application was found. Do not create test financial records in either remote project.

Next task: provision/identify isolated PostgreSQL/Supabase staging, then implement and verify atomic per-invoice processing, including event claiming and downstream side effects. A JavaScript process-local lock is insufficient across independent workers. Test conflicting events, worker crashes/retries, receipts, credit and notification deduplication before releasing the late-event change. The deployed authorisation-only fix is unaffected.

## Local PostgreSQL environment established

With approval, PostgreSQL 17.11 was installed through Homebrew (including its required dependencies). No background service was enabled. `scripts/payment-postgres-concurrency-check.mjs` creates a fresh disposable cluster for each run, rejects TCP connections, uses a private Unix socket, ignores database environment variables, and stops the server in its finally block. It never accepts a remote database URL. Synthetic evidence directories are retained in the macOS temporary directory for inspection.

The first run passed its reproduction assertions: two real PostgreSQL connections read the same pending invoice; the actual processor's state calculation produced a paid update and a stale failed update; applying those to the repository's invoice-table definition reproduced failed/£0. A separate row-lock test confirmed that a competing writer times out while another transaction holds the invoice row lock.

This is a working isolated PostgreSQL test environment, not a full Supabase emulator. Auth/storage, provider callbacks, email and the entire migration chain are not exercised. The late-event fix remains blocked from release. Next implement an atomic per-invoice transaction/outbox path and extend this harness to prove financial and downstream idempotency under parallel workers and crash/retry conditions.

Rerun with Node 22.13+ (or the available Node 24 runtime): `node scripts/payment-postgres-concurrency-check.mjs`. PostgreSQL binaries are resolved only from `/opt/homebrew/opt/postgresql@17/bin`; no production credentials are loaded.

## Atomic implementation — local, not deployed

Migration 0179 adds a service-only commit RPC and RLS-protected notification outbox. The RPC locks the invoice then event, validates a verified matching event, rejects stale invoice snapshots, and atomically commits invoice, checkout, receipt, booking/item changes, audit, event completion and notification intent. Existing database triggers execute within that same transaction. Duplicate events return existing without replaying writes. The processor rereads and recomputes on a conflict (up to four attempts), leaving unresolved events available for a subsequent invocation. An uncertain commit response does not reset a completed event.

Notification delivery is outside the financial transaction. Concurrent workers claim a pending row once. A known failure or uncertain send goes to review; a sending row abandoned for 30 minutes goes to review on the next invocation rather than being blindly resent. This deliberately does not promise exactly-once email delivery: a crash can leave delivery uncertain, requiring provider/log review. No test used the actual email function/provider.

Passed local tests:

- Real PostgreSQL conflicting workers: one commits, one conflicts, loser rereads; paid invoice, confirmed booking/item and paid checkout remain consistent.
- Concurrent duplicate recovery: one processed, one existing; only one durable notification intent.
- Transaction rollback before commit preserves the original invoice and received event; subsequent retry succeeds.
- Duplicate retry after commit produces no second receipt or notification intent.
- Anonymous/authenticated roles cannot execute the service RPC.
- 11 processor access cases, 24 adverse-event replay cases, three notification recovery/concurrency scenarios, and existing 105-check provider contract.

Release gates still open: the PostgreSQL harness uses the repository's invoice/event/receipt/checkout definitions but minimal booking/item/audit fixtures, not the full migration chain. Run the full credit/top-up/booking-capacity trigger stack and test migration compatibility before production. Manual repair actions still contain direct writes; review their interaction with the new path. Add an operational view/owner for notification review items and ensure a regular processor invocation drains pending items after crashes. These are not reasons to revert the live authorisation fix, which remains separate.

Next task: run full-ledger top-up, credit and cancellation regression tests against the complete isolated schema, then prepare a coordinated migration-and-function release. Deploying only the new function would fail because the RPC/outbox are required. No production migration or additional function deployment was performed in this batch.
