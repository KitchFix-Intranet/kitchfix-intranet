// src/app/kpi/labor/lib/weekHatched.js
//
// Kevin CC prompt 2026-09-10 (one definition of spent). Shared per-
// week hatched-dollar helper. Kevin's rule:
//
//     spent  =  costed + unpriced + unapproved
//
// Every Labor surface consumes the same helper so the panel, the
// table (per-week + per-period + grand total), the bar caption,
// the week card, and every percentage struck from spend all agree
// by construction.
//
// Sources (both mean "worked, not yet final" per Kevin CC prompt
// 2026-09-10 item 1, PR #1103):
//   - unpriced_hrs × rate  = hours with no pay segment yet
//   - draft_hours  × rate  = priced but awaiting site-lead approval
//
// Gates mirror the prior in-line render gates so this is a no-op
// on any week the two components did not exist on (no drafts + no
// unpriced hours == no change).
//
// Non-Labor callers must NEVER treat this as "adjusted" - Guard 1
// (Labor panel == Overview 3100 batr) compares batr, not spent.
// This helper strictly adds to the spent side.

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
  // Both sides call it `draft_hours`. Read whichever exists so the
  // WeekTable (weekAggregates) and StoryBlock/SpendCard (board) can
  // share one helper without renaming fields upstream.
  const spent = Number(w?.spent ?? w?.amount ?? 0);
  const upHrs = w?.unpriced_hrs ?? w?.hours_without_dollars ?? 0;
  const isZero = !isNotStarted && (!spent || spent <= 0.5);
  const capDollars = estimateUnpricedDollars(upHrs, rate) || 0;
  const draftHrs = Number(w?.draft_hours || 0);
  const unappDollars = (!isZero && !isNotStarted && draftHrs > 0.004 && rate)
    ? draftHrs * Number(rate)
    : 0;
  return { capDollars, unappDollars, draftHrs, total: capDollars + unappDollars };
}
