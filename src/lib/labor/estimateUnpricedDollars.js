// src/lib/labor/estimateUnpricedDollars.js
//
// V42 PR-B - the one shared estimator both the week-bar's hatched
// cap and the Payroll card's "Will rise" figure call. Owner ruling
// 2026-08-20 after V42 rollout: the two must agree to the cent so a
// future divergence between "N unpriced hours + this rate" and the
// two rendered figures is impossible to introduce.
//
// Signal source is hours_without_dollars, NOT draft_hours. Priced
// drafts land in the solid bar already; capping them with draft
// hours would double-count. See kpi PR v42-1b (route rebind + owner
// correction on TXR - AZ 08/10 = 173.93 draft hrs, 0.00 unpriced,
// $3,430.45 priced - every entry is DRAFT but Rippling priced them
// all, so the cap is zero on that week).
//
// Rate: caller passes the same rate the Payroll card reads today -
// `salary?.blended_rate_hourly ?? board?.avg_rate`. When neither is
// available, returns null; the render suppresses the cap and the
// "Will rise" line rather than showing a false zero.

/**
 * Estimate the dollar value of unpriced hours.
 *
 * @param {number|null|undefined} hoursWithoutDollars
 * @param {number|null|undefined} rate  dollars per hour
 * @returns {number|null}  cents-round dollars, or null when the
 *   estimate is not answerable (missing rate, zero unpriced hours)
 */
export function estimateUnpricedDollars(hoursWithoutDollars, rate) {
  const h = Number(hoursWithoutDollars || 0);
  const r = Number(rate || 0);
  if (h <= 0.004) return null;
  if (!(r > 0)) return null;
  return Math.round(h * r * 100) / 100;
}
