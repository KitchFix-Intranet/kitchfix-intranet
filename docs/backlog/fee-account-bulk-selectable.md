# Fee-account prep + off-season days: bulk-selectable?

**Filed:** 2026-09-08. Held from the bulk-selector fix (per-meal
shipped as `sc/bulk-selector-zero-proj-2026-09-07`).
**Status:** Owner ruling required. Not urgent - not blocking training.
**Trigger to unpark:** owner ruling, or the first fee-account
operator (STL - FL, or an MLB site if one ever runs the bulk flow)
who tries to record counts on a prep / off-season day and cannot.

---

## What this closes

Extends the 2026-09-08 bulk-selector ruling (zero-projected per-meal
days are selectable + enterable through every path) to the two
fee-account statuses that carry the same "not projected → not
possible" shape:

- **`prep`** - fee-account non-game day with no non-zero actuals
  (`serviceCalendar.js:314`). Classifier catches PREP / OPEN /
  CLOSE / CLEAN homestand days that never received a non-zero meal
  count.
- **`off-season`** - fee-account day not in the schedule at all
  (`serviceCalendar.js:293`).

Both currently block bulk selection at `PeriodWorkspace.js:1432-1433`:

```js
const dayNotScheduled = d.status === "off-season"
  || d.status === "prep";
```

Kevin can open one of these days individually and enter values
today (the day-tile onClick is gated only on `isDisplayOnly` =
exhibition + away). Bulk selection is the sole surface that
refuses them. Same inconsistency shape as the 2026-09-08 per-meal
fix: enterable one way, not the other.

## The case for and against

**For selectable** (matches per-meal ruling):
- The operator should be able to record what actually happened
  regardless of what the schedule predicted. Same principle Kevin
  set for per-meal.
- Consistency: three paths (single-day modal, bulk-review matrix,
  bulk selector) all treating the same day the same way.
- The pattern "the schedule predicted X, reality was Y" is a
  first-class case in a real operational calendar.

**Against selectable**:
- Fee accounts bill a contracted amount regardless of counts, so
  entered counts on a prep or off-season day are **tracking, not
  billing**. The consequence of blocking is that tracking data
  goes unrecorded - a smaller loss than an unbillable meal on a
  per-meal account.
- MLB's contracted-flat billing is a distinct semantic from
  per-meal's meal-count billing. The ruling that projections are a
  budget guess is sharper on per-meal accounts where a recorded
  meal IS a billed meal. On fee accounts the projection was never
  a billing input in the first place.

## What ships if selectable

Two-line change mirroring the per-meal fix:

- `PeriodWorkspace.js:1432-1433` - remove the `off-season` +
  `prep` clauses from `dayNotScheduled`. Selector becomes
  `bulkMode && !isDisplayOnly` (only exhibition + away stay
  blocked - team on the road is a schedule truth, not a budget
  guess).
- Update the "Full 9-status partition" comment above the block
  (:1417-1428) to name the new ruling.

Everything downstream already handles fee-account days that have
actuals - `sc_daily_revenue` computes zero revenue on fee
services regardless (fee-no-dollar accounts don't have per-meal
prices), the finalize path already tolerates it, the counters
already handle it.

## What NOT to touch if selectable

- The classifier at `serviceCalendar.js:293 + :314` - the atom
  status is factual (day IS off-season, day IS prep). This
  ticket changes only what the selector does with that fact.
- The `isActionableDay` predicate at `dayPredicates.js` - the
  "X of Y entered" counter's denominator correctly excludes prep
  / off-season days from "expected entry" until an operator
  actually acts.
- MLB day-tile visuals - a prep or off-season day that gets
  entered flips to `entered` via the existing operator-intent-wins
  branch at `serviceCalendar.js:313`; the tile updates.

## Where the caveat came from

The 2026-09-08 selector-defect sweep found this. Kevin's ruling
that day was scoped to per-meal (TBR + TBJ are both per-meal, so
training was unblocked); the fee-account question was held for
owner ruling on the same reasoning ladder. My proposal, offered
without preference: per-meal principle applies, ship the same
change on fee accounts. Kevin decides.

## Related

- `docs/backlog/seasonal-window-gap.md` - separate but adjacent:
  MLB services on PDC accounts carry `active_until = null`
  year-round but only run in spring training. A per-meal PDC day
  where MLB services project zero (correctly, out of ST window)
  and PDC services project non-zero is a normal per-meal day with
  a subset of un-projected services. Kevin's 2026-09-08 ruling
  already covers this at the per-service level; the seasonal-
  window ticket is about surfacing the fact that MLB is out of
  window, not about entry gating.
- `serviceCalendar.js:326-333` classifier note - the Kind 1 vs
  Kind 2 discriminator (currently `hasActuals` inference from
  downstream code) needs to move to the classification layer if
  a future feature needs to tell "the client cancelled" from
  "we never planned service" apart.
