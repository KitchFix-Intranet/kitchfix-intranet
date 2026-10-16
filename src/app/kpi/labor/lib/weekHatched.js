// src/app/kpi/labor/lib/weekHatched.js
//
// Shared per-week hatched-dollar helper. Returns the dollars that
// are NOT already inside `amount` / `w.spent` for a given week, so a
// consumer can add them to reach a full picture.
//
// History
// -------
// Kevin ruling 2026-09-10 originally defined `spent = costed +
// unpriced + unapproved`. Pre-labor-te-1 the derive wrote only
// APPROVED pay-segment dollars into `dollars_regular` and friends;
// draft hours sat outside `amount`, so adding `draft_hours x rate`
// here was correct.
//
// Kevin ruling 2026-10-16 (supersedes the 2026-09-17 version) -
// every status counts as actual dollars. The labor-te-1 derive
// prices drafts into `dollars_regular -> amount` directly. The
// `unapproved` addend is retired: drafts are already in `amount`,
// so adding `draft_hours x rate` here double-counts them.
//
// The operational trigger: on 2026-10-16 the Overview current-period
// labor figure was overstating by hundreds of hours' worth of priced
// drafts and flipping budget verdicts from under to over. Executive
// Chefs were being told to cut hours they did not need to cut. #1305
// fixed the Rippling labor table's TOTAL cells; this change retires
// the add at the helper level so every other consumer
// (CurrentPeriodTable 3100 landed, WeekTable VsBudget chips,
// StoryBlock bar + panel spent) stops double-counting too.
//
// What the helper returns now
// ---------------------------
// Only unpriced hours. These are hours the derive could not price
// because no rate resolved (segment pay_rate was null AND the
// worker's compensations hourly_wage was null) - 8.00 hours on 2
// rows across the full labor_actuals corpus 2026-10-16. The term is
// retained for correctness in that edge case; it has no measurable
// effect on current data.
//
// Shape (capDollars, unappDollars, draftHrs, total) is preserved so
// StoryBlock.js:666 can continue to destructure the fields it names
// (hatchedUnapp == 0 post-ruling, which naturally retires the
// `solid bar = value - hatchedUnapp` visual split - drafts become
// baked into the solid bar, which is semantically correct now).
//
// Non-Labor callers must NEVER treat this as "adjusted" - Guard 1
// (Labor panel == Overview 3100 batr) compares batr, not spent.
// This helper strictly adds to the spent side when unpriced hours
// exist, and is a no-op otherwise.

import { estimateUnpricedDollars } from "@/lib/labor/estimateUnpricedDollars";

/**
 * @param {object} w - a board.weeks[] entry (state, spent, unpriced_hrs, draft_hours)
 * @param {number|null|undefined} rate - dollars per hour (board.avg_rate)
 * @returns {{ capDollars: number, unappDollars: number, draftHrs: number, total: number }}
 */
export function weekHatchedDollars(w, rate) {
  const isNotStarted = w?.state === "not_started";
  // Two schemas call this helper:
  //   - board.weeks[]   carries `spent` + `unpriced_hrs`
  //   - weekAggregates  carries `amount` + `hours_without_dollars`
  //     (client-side aggregation of raw actuals rows in page.js)
  // Read whichever exists so WeekTable (weekAggregates) and
  // StoryBlock/SpendCard (board) share one helper without renaming
  // fields upstream.
  const upHrs = w?.unpriced_hrs ?? w?.hours_without_dollars ?? 0;
  const capDollars = estimateUnpricedDollars(upHrs, rate) || 0;
  const draftHrs = Number(w?.draft_hours || 0);
  // Retired 2026-10-16 (Kevin ruling). draftHrs stays on the return
  // shape as a flag source for callers that render the pending-
  // approval count; it no longer contributes dollars.
  const unappDollars = 0;
  return { capDollars, unappDollars, draftHrs, total: capDollars + unappDollars };
}
