# Payment and cancellation release approval checklist

## Read-only production review — 11 September 2026

Target confirmed from linked project: `djkfuftbtfthjpezvjuu` (Après School). Only catalog SELECTs were issued; no customer rows, booking mutations, function execution tests or emails. CLI uses its authenticated Management API path.

Live functions have the signatures required by migration 0180. `amend_parent_booking_add_items`, `amend_parent_booking_remove_items` and `cancel_parent_booking` grant EXECUTE to both anon and authenticated. They are SECURITY DEFINER, accept `p_actor_role`, and their bodies contain no `auth.uid()` call. This confirms the unsafe permission boundary identified locally. No exploit or customer change was attempted. The staff-ad-hoc cancellation and pricing functions are already server-only.

The new `commit_ponchopay_event` and `remove_parent_booking_items_atomic` functions are absent. Core types match the proposed changes: booking ID UUID, booking status booking_status enum, invoice ID/booking link text, last webhook event UUID.

Live trigger coverage is broader than the local harness: cancelled-invoice finance normalization, secured-invoice booking synchronization, confirmed-item synchronization, launch capacity checks, duplicate-child-session prevention and deferred camp early-dropoff dependency enforcement. Compatibility is therefore PARTIAL, not release certification. Full definitions and interactions must be rehearsed in isolated staging before the combined payment release.

## A — urgent permissions-only approval

- Obtain approval specifically for applying `0180_booking_change_rpc_permissions.sql` to this project.
- Capture current function signatures and ACLs as restricted release evidence; the read-only review confirms signatures currently match.
- Apply only 0180. Do not run a general database push: other unpublished changes are not approved by this step.
- Verify anon/authenticated EXECUTE is false and service_role EXECUTE is true for all four signatures.
- Verify the authenticated server path still works with controlled synthetic staging tests, not customer cancellations.
- No Edge function replacement is necessary for this ACL-only fix.
- Do not restore unsafe PUBLIC/anon/authenticated grants as an automatic rollback. If a legitimate path breaks, keep the boundary closed and repair its server routing.

## B — combined payment/cancellation release: not yet ready

Prerequisites:

- Capture deployed Edge versions and source/configuration for payment processor and update-parent-booking; do not assume the local pre-change source is identical to production.
- Capture deployed function definitions before replacing pricing; compare them against local 0133/0181 to avoid overwriting later fixes.
- Rehearse actual live trigger definitions and constraints with synthetic records, including top-up settlement across multiple bookings and camp dependencies.
- Verify parent profiles cannot self-edit privileged roles.
- Assign an owner and operational route for notification outbox review; verify scheduled draining after interrupted runs.
- Prepare and test an authorisation-hardened processor recovery build. The old non-atomic payment writer is not a safe rollback while atomic workers are running.

Proposed order, subject to those gates and separate deployment approval:

1. Coordinate processor traffic/workers so old and new writers do not overlap. Do not discard queued events.
2. Apply 0179 (atomic payment commit/outbox), 0180 if not already applied, 0181 (cancelled-status repricing fix), then 0182 (atomic removal wrapper), using exact reviewed SQL rather than unrelated migrations.
3. Deploy the matching payment processor and update-parent-booking builds. Never deploy either new handler before its database function exists.
4. Verify signatures, restricted grants, processor authentication, queued event progress and error logs read-only. Keep parent emails out of ad-hoc manual testing.
5. Watch for stuck events, invoice/booking disagreement and outbox review entries. Record versions and timing.

Recovery:

- If SQL fails, do not deploy dependent handlers. Determine which statements committed before proceeding; some migrations are not wrapped as one batch transaction.
- If handler deployment fails after SQL, retain additive functions/tables and restrict or pause the affected worker while restoring a vetted compatible build.
- Never drop the outbox, erase ledger/audit history or blindly replay emails as rollback.
- Restore pricing only from the captured deployed definition and after checking it will not reopen cancelled bookings.
- Preserve 0180 and the already-deployed processor authentication hardening in every recovery build.

Next recommended action: approve the separate 0180 permissions-only fix. Keep the larger rollout blocked pending the staging and operational gates above.
