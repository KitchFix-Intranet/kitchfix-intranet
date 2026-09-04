# SC input sweep - nine files sharing the price-editor swallow-bug pattern

**Filed:** 2026-09-04.
**Status:** Deferred. Its own PR after training week. Task #46.
**Trigger to unpark:** any second occurrence of a silent-input
loss on an SC admin surface. The first was the 2026-06-17 Media
Meals price-editor incident that motivates this sweep; the sweep
prevents the second.

---

## What this closes

The 2026-06-17 Media Meals price change was accepted by the UI,
recorded a success toast, and silently did not write - the API
route validated `effectiveDate` / `reason` / `requestedBy` but did
not validate `c.to !== c.from` (no-op guard), did not validate
`c.from` matches DB state (optimistic-lock), and did not validate
`c.to` is numeric-positive. A hand-crafted POST or stale-tab
submit could write `{from: X, to: X, reason: "meant Y"}` - the
price does not change, the change log fills up with no-ops, the
operator's real intent is lost.

The `sc-config-update` route is one of nine SC input surfaces
sharing this class of gap. **Every one is a potential silent-loss
site until the same three validations land in each server-side
handler.**

## The nine surfaces

The active-thread row for `sc-config-update` (see
`PROJECT_DASHBOARD.md`) covers surface #1. The other eight sit in
the same code neighborhood; the arc's silent-failure sweep survey
inventoried them. All nine need the same three checks:

1. **`c.to !== c.from` (no-op guard)** - fail 400 with a
   descriptive error, not a silent no-op.
2. **`c.from` matches DB current (optimistic-lock)** - fail 409
   with the actual current value, so a stale tab surfaces the
   drift instead of overwriting.
3. **`c.to` is numeric-positive (or the domain-appropriate
   validation)** - fail 400 on NaN, negative, or nonsense.

The nine surfaces:

- **1. `sc-config-update` price change** - the driving case.
  `src/app/api/service-calendar/route.js` around L735+.
- **2. `sc-config-update` fee change** - same handler branch for
  `sc_fee_schedule` rows. Same three checks, same shape.
- **3. `sc-config-update` group rename** - text field, not
  numeric; the optimistic-lock check is what matters (a rename
  from an out-of-date form drops the new name silently).
- **4. `sc-service-archive`** - archiving a service. Optimistic
  lock on `active_until` state; a stale-tab archive can
  double-archive or unarchive.
- **5. `sc-service-reactivate`** - the inverse; same lock shape.
- **6. `sc-service-add`** - new service. Uniqueness check on
  (account, service_name) is the guard here; the current handler
  can create a duplicate on race.
- **7. `sc-group-add`** - new service group. Same uniqueness gap.
- **8. `sc-submit-day` actuals write** - the day-entry path. The
  guard here is timestamp-based - the actuals form should carry
  the `updated_at` it read and fail 409 if the server's is newer,
  so a two-tab operator does not silently overwrite the other
  tab's save.
- **9. `sc-day-note` add** - the note ledger append. Uniqueness
  gap (same author + same timestamp + same body = probable
  double-submit; today it appends both).

## What must ship

- Extract a `validateConfigUpdate` helper in
  `src/lib/sc-admin/validation.js` (new file) that takes
  `{ current, incoming, kind: 'price' | 'fee' | 'text' | ... }`
  and returns `{ ok: true } | { ok: false, code: 400 | 409, message }`.
- Each of the nine handlers imports the helper and calls it before
  its write. The helper is exhaustive; the handler is a
  read-current + validate + write shape.
- Playwright tests for the failure paths: stale-form 409, no-op
  400, NaN 400, plus one regression per surface against the
  known bug shape (Media Meals for #1, and a spec'd shape for
  each of the others). Add a `tests/sc-admin-input-sweep.spec.ts`
  gathering them.

## What this DOES NOT do

- Does not change client-side validation. The client gates today
  are the pragmatic first line and stay; the server is the last
  line and gains parity. Do not remove the client gates.
- Does not add a rollback endpoint. Silent-loss is prevented by
  never accepting the bad input; recovery from bad state is a
  different problem out of scope here.
- Does not touch fees on non-PDC accounts. The five locked fees
  live in `sc_fee_schedule` for the fee-display accounts; the
  handler covers both without special-casing.

## Pointers into the code

- Driving handler: `src/app/api/service-calendar/route.js` -
  `sc-config-update` block starting around L735.
- Actuals handler: same file, `sc-submit-day` handler.
- Day-note handler: same file, `sc-day-note` handler.
- Client gates (verify parity before build): 
  `src/app/service-calendar/admin/PriceEditPanel.js` L104
  `priceChanged`; the FeeEditPanel counterpart; the RailService
  reactivation dialog.
- Related GOTCHAS entry: "Price editor swallow-bug pattern" +
  the arc's "operation that reports success regardless of
  outcome" meta-entry.

## Related backlog

- `docs/backlog/amount-type-services.md` - the amount input
  surface (when it lands) is the tenth surface; add its guard to
  the same helper in the same shape.
- `docs/backlog/notify-wrapper.md` - the wrapper is the send-side
  equivalent of this input-side abstraction; both remove the
  surface where a silent-failure class can be written.

## Discipline note

The sweep is a category fix, not a bug fix. The bug that
motivates it (Media Meals) is already patched; the sweep is what
prevents the next eight of its kind. Do not fold it into a
feature PR - the diff touches nine handlers plus a new helper
plus nine test cases, and the value is in the completeness. A
partial sweep leaves the same shape of gap on whichever surfaces
are skipped.
