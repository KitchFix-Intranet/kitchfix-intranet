// src/lib/kpi/overview/formatting.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// Server-side formatting helpers. The Overview computes direction
// words, gap wording, and money strings ONCE, in the resolver, so
// the client never re-does the arithmetic. This mirrors the labor +
// purchasing rule "server computes every dollar" (§9B), applied to
// the presentation layer where direction words are as load-bearing
// as the numbers they modify.
//
// Vocabulary (R-24, §5.8):
//   - costs:    "under" / "over"          - under is the good direction
//   - margin:   "ahead" / "behind"        - ahead is the good direction
//   - revenue:  "above" / "below"         - above is the good direction
//   - gap under $1: "on budget"          (never signed, never "points")
//   - contractual (fee): "contractual"    (no gap wording)
//
// Number formatting:
//   - Whole dollars everywhere on the Overview (R-23). No cents.
//   - Percent-of-revenue: one decimal.
//   - Percentage-point gap: one decimal, never called "points" (R-24).
//
// All numbers arrive in this module as JS numbers (not strings, not
// null unless documented). Callers translate null to their own
// "not reported" affordance BEFORE calling formatMoneyWhole - a null
// passed here becomes "$0" which would be a data lie.

const DOLLAR_LOCALE = "en-US";

// Whole-dollar rendering. Negative shows a proper minus sign. Zero
// renders as "$0". Rounds half-up (JS Math.round default).
export function formatMoneyWhole(n) {
  if (n == null || Number.isNaN(n)) return null;
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString(DOLLAR_LOCALE);
  return n < 0 ? "-" + s : s;
}

// One-decimal percent. Handles null (returns null) so callers can
// distinguish "no data" from "0.0%".
export function formatPct(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n).toFixed(1) + "%";
}

// Percent of A over B. Returns null if B is null/undefined/zero -
// the ratio is undefined; callers render appropriately.
export function pctOf(a, b) {
  if (a == null || Number.isNaN(a)) return null;
  if (b == null || Number.isNaN(b) || !(Number(b) > 0)) return null;
  return (Number(a) / Number(b)) * 100;
}

// Direction word for a dollar delta. `good` is the label when the
// number is >=0 (in the "good" direction relative to `axis`); `bad`
// is the label when < 0. Callers pass axis-specific pairs.
//
// Convention per §5.8 R-24: gap is a POSITIVE number with a direction
// word attached. Never a signed number in the display; never called
// "points" for percentage-point gaps.
//
// Under-$1 gap renders as "on budget" (§5.8) - a distinct semantic
// state, not "0.0 under".
export function gapDollars(delta, goodWord, badWord) {
  if (delta == null || Number.isNaN(delta)) return null;
  const d = Number(delta);
  if (Math.abs(d) < 1) return "on budget";
  const magnitude = Math.abs(Math.round(d));
  const s = "$" + magnitude.toLocaleString(DOLLAR_LOCALE);
  return `${s} ${d >= 0 ? goodWord : badWord}`;
}

// Percentage-point gap: absolute value with one decimal + direction.
// Under-0.05pp reads "on target" (below rounding threshold at one
// decimal). Never "points" (R-24).
export function gapPoints(deltaPct, goodWord, badWord) {
  if (deltaPct == null || Number.isNaN(deltaPct)) return null;
  const d = Number(deltaPct);
  if (Math.abs(d) < 0.05) return "on target";
  return `${Math.abs(d).toFixed(1)}% ${d >= 0 ? goodWord : badWord}`;
}

// Axis-specific gap helpers. The axis triple names the direction
// language the render uses:
//   - cost axis (COGS lines): under is good.  positive delta = actual >
//     budget = OVER (bad direction).  So we invert the sign before
//     picking the word: delta_display = -delta so under/over reads
//     right when actual < budget.
//
// Callers pass `delta = actual - budget`. This helper returns the
// display-ready string with the axis's direction vocabulary.

// Cost delta: `delta = actual - budget`. Under = good. Display flips.
export function gapDollarsCost(delta) {
  if (delta == null || Number.isNaN(delta)) return null;
  return gapDollars(-Number(delta), "under", "over");
}

// Revenue delta: `delta = actual - budget`. Above = good. No flip.
export function gapDollarsRevenue(delta) {
  return gapDollars(delta, "above", "below");
}

// Margin (GM) delta: `delta = actual - budget`. Ahead = good. No flip.
export function gapDollarsMargin(delta) {
  return gapDollars(delta, "ahead", "behind");
}

// Percentage-point axis wrappers. `deltaPct` is a signed value:
// `actual_pct - target_pct` on the appropriate axis.
export function gapPointsCost(deltaPct) {
  if (deltaPct == null || Number.isNaN(deltaPct)) return null;
  // Cost axis: pos delta = actual > target = OVER = bad direction.
  // We display the magnitude and flip the sign for word choice.
  return gapPoints(-Number(deltaPct), "under", "over");
}

export function gapPointsRevenue(deltaPct) {
  return gapPoints(deltaPct, "above", "below");
}

export function gapPointsMargin(deltaPct) {
  return gapPoints(deltaPct, "ahead", "behind");
}

// The signed sense of a delta relative to a good direction. Returns
// "good", "bad", or "neutral" (delta small enough to read as
// on-budget / on-target). Callers use this to pick color / verdict
// pill without re-doing the arithmetic.
//
// axis: 'cost' | 'revenue' | 'margin'
// deltaKind: 'dollars' | 'points'
export function directionOfDelta(delta, axis, deltaKind = "dollars") {
  if (delta == null || Number.isNaN(delta)) return null;
  const d = Number(delta);
  const threshold = deltaKind === "dollars" ? 1 : 0.05;
  if (Math.abs(d) < threshold) return "neutral";
  const isGoodPositive = axis !== "cost";
  const isPositive = d > 0;
  if (isGoodPositive) return isPositive ? "good" : "bad";
  return isPositive ? "bad" : "good";
}
