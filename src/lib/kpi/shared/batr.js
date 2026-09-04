// src/lib/kpi/shared/batr.js
//
// budget_at_this_revenue - one formula, one owner, both boards call it.
//
// The R-77 defect (Kevin 2026-09-04) was two boards computing the same
// idea independently and drifting. Overview compared to the adjusted
// budget (line_target_pct × actual_revenue). Labor compared to the raw
// dollar budget. Same account, same line, same fiscal year - opposite
// verdicts (Labor said 121% over, Overview said 0.6 points over).
//
// The fix is not "make Labor match Overview by importing across
// routes". That leaves the Overview owning a formula Labor depends on
// and preserves the two-side-coincidence failure mode: as either side
// evolves the invariant can drift again.
//
// The fix is one shared module. Neither route owns it. Both call it.
// The invariant holds by construction rather than by aspiration.
//
// Rules (from R-44 + R-45):
//   R-44 · percent is the KPI; the target does not move when revenue
//          moves
//   R-45 · an account does not control its revenue, so it is held to
//          a percentage of whatever arrives
//
// Formula:
//   line_target_pct   = lineBudget / revenueBudgetFullPeriod   (a ratio)
//   budget_at_revenue = actualRevenue × line_target_pct
//
// Guards return null when the formula cannot be evaluated honestly:
//   - hasTarget false          (rolling windows have no target)
//   - actualRevenue null       (no revenue in the range)
//   - lineBudget null          (no budget for the line in the range)
//   - revenueBudgetFullPeriod  falsy (division-by-zero guard)
//
// Rounded to 2 decimal places to match every existing consumer's
// display + assertion tolerance.

export function budgetAtThisRevenue({
  actualRevenue,
  lineBudget,
  revenueBudgetFullPeriod,
  hasTarget = true,
}) {
  if (!hasTarget) return null;
  if (actualRevenue == null || Number.isNaN(Number(actualRevenue))) return null;
  if (lineBudget == null || Number.isNaN(Number(lineBudget))) return null;
  if (!revenueBudgetFullPeriod) return null;
  const lineTargetPct = Number(lineBudget) / Number(revenueBudgetFullPeriod);
  const raw = Number(actualRevenue) * lineTargetPct;
  return Math.round(raw * 100) / 100;
}

// envelope_delta - complement to batr on the same operand set.
//   budgetToDate - budgetAtThisRevenue
// Positive means the envelope shrank (revenue short of plan); negative
// means it grew. Exposed here so both boards can compute the same
// pace metric off the same batr.
export function envelopeDelta(budgetToDate, batr) {
  if (budgetToDate == null || batr == null) return null;
  const raw = Number(budgetToDate) - Number(batr);
  return Math.round(raw * 100) / 100;
}
