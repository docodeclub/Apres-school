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

## Ledger integration batch

The local PostgreSQL harness now applies the actual ledger and top-up trigger migrations 0057, 0059, 0173, 0177 and 0178, together with proposed 0179. Supporting parent/profile/booking tables remain synthetic fixtures. This is broader trigger integration coverage, not the complete Supabase schema or parent cancellation endpoint.

Passed: a £100 completed top-up clears a £30 staff ad-hoc invoice and booking balance, leaving £70 ledger credit; duplicate callback leaves £70; cancelling that care restores the £30 ledger debit once; a £50 cancellation credit remains correct after £20 is spent; a £20 top-up cash refund removes £20 once, including on duplicate callback. No actual notifications or provider calls were made.

The tests reproduced a zero-total regression: buildInvoiceState used a truthy fallback, replacing an authoritative £0 amended invoice total with the old callback amount. That is now a null/missing check. Atomic booking updates now exclude cancelled bookings, and the queued notification receives the actual updated booking status rather than an assumed confirmed status. Tests verify the £0 total, cancelled booking and previously spent credit survive delayed completion.

All PostgreSQL scenarios, the 11 access cases, 24 adverse-event replays, notification recovery cases and 105 provider contract checks pass. Test server stops automatically. Changes are committed locally; production is unchanged.

### Release preparation

Keep migration 0179 and the processor changes in the same release, separate from Phase 1 public content. Before approval: verify full deployed schema compatibility and existing trigger side effects; exercise actual parent cancellation RPC/window/ownership rules with two children; confirm cancelled sessions disappear from registers without changing the other child's sessions; provide an owner/operational route for outbox review and periodic draining. Do not roll back to the old non-atomic writer while new workers are active. Keep the already-deployed access fix in any rollback build.

Next task: two-child, individual-session cancellation through the actual parent RPC and register projection in isolated staging, including the credit outcome. This closes a remaining gap that direct invoice-ledger fixtures cannot prove.

## Individual-session cancellation and register integration

Added `scripts/payment-session-cancellation-check.mjs`, invoked by the isolated PostgreSQL harness. It loads the actual 0142 cancellation function and 0163 register function with the existing real ledger triggers and synthetic supporting tables. Two children share a paid £40 booking across three child-sessions. Cancelling Child A's £10 first session creates exactly £10 credit, reduces the booking to £30, releases one hold, and removes only that item from the real register output. Child A's second session and Child B's first session remain. Retry creates no additional credit; wrong parent, foreign item and notice-period violations are rejected without credit changes.

The complete local harness passed, including earlier concurrency/top-up/refund scenarios. Evidence: `/var/folders/nt/xywj28hj06vc566919dsjssm0000gn/T/apres-payment-test-UtNdpI`. No live records, deployments or emails. This exercises database functions, not the browser/HTTP endpoint or complete deployed schema. Supporting tables are fixtures; full production schema compatibility remains a release gate.

Next task: audit and harden cancellation RPC permissions and server-side caller identity before release. Function 0142 trusts supplied parent identity and actor role; the repository's original 0033 and replacement 0142 grant service-role execution but contain no explicit PUBLIC revoke. This is a repository permission concern, not a verified production exposure: deployed grants/default privileges must be checked. Existing ownership tests validate parameter matching, not authenticated caller identity. Do not label the release safe until this boundary is verified.

## Booking-change permission hardening

Draft migration 0180 explicitly revokes PUBLIC, anon and authenticated execution for individual removal, full cancellation, session addition and ad-hoc cancellation. It preserves service_role execution. This also removes explicit historical API-role grants, rather than relying only on a PUBLIC revoke. No function bodies, booking rules or emails were changed. The migration can ship independently of 0179, provided all four existing signatures are present; inspect deployed signatures/grants before approval. It has not been deployed and production exposure has not been verified.

Local PostgreSQL checks load the actual four function definitions, simulate explicit API grants, apply 0180 twice and verify all four deny anon/authenticated but allow service_role. Direct forged-superadmin removal calls fail at the permission boundary. The full cancellation/credit/register test now invokes removal as service_role and still passes along with all previous payment tests. Evidence: `/var/folders/nt/xywj28hj06vc566919dsjssm0000gn/T/apres-payment-test-Vcj31s`.

`scripts/booking-change-auth-check.mjs` executes the real update-parent-booking handler with synthetic substitutes: missing/invalid login, inactive account and failed profile lookup cause no mutation; body-supplied identity/role and user-editable auth metadata cannot replace the verified user and database profile role. Existing handler already implements this correctly; no handler change was necessary. This is not a live authentication or profile-RLS audit.

Next task: integrate the handler's follow-up `apply_booking_pricing` step into the two-child cancellation regression. The prior test proves the cancellation function and ledger, but the HTTP handler reprices afterwards; confirm discounts, credit and remaining sessions stay correct through that entire sequence. Production signature/grant verification and profile-role write permissions remain release gates.

## Post-cancellation repricing regression

The synthetic two-child test now loads the actual `apply_booking_pricing` definition from 0133 and invokes it after removal, matching the handler's two database calls. Fixtures contain existing 50% staff pricing-adjustment snapshots: gross £80, paid net £40 across three child-sessions. Removing the £10 item retains net £30 and £30 recorded discount, leaves the two remaining register entries, and preserves £10 ledger credit on repeat pricing. Subsequent individual removals produce cumulative £30 then £40 credit and an empty register.

The baseline failed at the last step: the zero-price auto-confirm branch reopened the fully cancelled booking as confirmed. Draft migration 0181 preserves cancelled bookings in that branch; it otherwise copies the latest 0133 function unchanged. The full local PostgreSQL suite and handler authentication tests pass after the fix. Evidence: `/var/folders/nt/xywj28hj06vc566919dsjssm0000gn/T/apres-payment-test-yMuoZ6`. No deployment, real records or email sends.

Scope: recorded-discount snapshot path, real cancellation/pricing/ledger/register functions, synthetic supporting schema. Fresh pricing-rule calculation, camp full-week changes, monthly balances, complete HTTP/browser workflow and concurrent cancellation-versus-payment remain unverified. The HTTP handler makes cancellation and repricing in separate transactions; this test is sequential, not proof of all-or-nothing recovery between calls.

Next task: test payment arriving concurrently with cancellation/repricing, including a failure between those two calls. Verify invoice, booking and credit cannot diverge before preparing the production release.
