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
