# Finalize pretax guard - move rejection above the finalize row insert

**Status:** backlog. Post-training work. **Not urgent** - this is the shape improvement, not the correctness fix. The correctness fix landed in the pair-widen PR that shipped this backlog item.

## Current shape (2026-09-16)

The confirm-vs-payload pretax guard lives inside `runFinalizeEffects` at `src/lib/scWeekFinalize.js`, immediately after `buildInvoicePayload` succeeds. On a mismatch the finalize row (already inserted by the route handler) transitions to `push_failed`, N2 fires, and the operator sees the failed state with Revert as the only unlock path.

Chosen this shape because:

- It parallels the existing `BUILD_ERROR` failure path in the same function.
- Moving the payload build above the finalize-row insert is a genuine refactor a week before Monday training - not the right week for it.
- **This guard should never fire once the display is fixed.** It is a regression sentinel, not an expected path. A slightly awkward recovery on a case that should not occur is the right trade.

## Desired shape (post-training)

Reject the mismatch **before** the finalize row is inserted:

- Route handler at `src/app/api/service-calendar/route.js` `action === "sc-finalize-week"` builds the payload first (dry-run via `runFinalizeEffects` or a lift of the payload-build path).
- Compares `confirmedPretaxCents` against payload total.
- Mismatch returns a 400 with the operator-language message. No `sc_week_finalize` row inserted. No `push_failed` state to unwind. Operator can approve fresh and retry.

## Why the move matters

A mismatch means the operator approved a number that is not what bills. Locking the week on that basis is wrong - the operator's approval was against a display that lied, and the recovery path being Revert-then-retry adds friction for something that was never the operator's fault.

## The alternative I considered and rejected

A cheaper guard - comparing the confirm total against a raw `sc_daily_revenue` sum, which would not need the payload built. **Does not work:** the builder applies `export_excluded` per service, so on TBR the payload total legitimately differs from the raw sum by the B&G amount. The guard must compare against the built payload, not the raw revenue. Keeping this note so a future attempt to "simplify" the guard by dropping the payload build doesn't reintroduce the problem.

## Blocking work needed

- Refactor: extract the payload-build portion of `runFinalizeEffects` into a pure helper callable from the route handler before the insert, or move the entire build-then-check block above the insert.
- The `runFinalizeEffects` function then either takes a built payload as input or is restructured so its first side effect is the QBO post rather than the finalize-row transition.

## Reference

Introduced 2026-09-16 in the finalize-confirm pair-widen PR. The guard tests in `src/lib/billing/__tests__/runFinalizeEffects.test.mjs` (four cases: match / mismatch / absent / null) are the shape to preserve on the refactor.
