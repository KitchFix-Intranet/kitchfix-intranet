// src/app/kpi/purchasing/lib/board.js
//
// KPI PURCHASING PHASE 2 - PR 2 client-side board logic.
//
// The ONE stateOf(). §9B of the spec: pill, hero colour and chart state
// all derive from a single call per card, per render. Four separate
// bugs came from breaking this - keep them broken.
//
// No inferred financial constants (rule 7): every ratio / threshold
// traces to the spec. See §5.1 for weekly targets, §5.2 for the state
// resolver, §5.3 for pending, §7 for the design law that governs
// negative rendering and the 'no spend' baseline.
//
// This module does NO fetching, imports NO googleapis-touching helper,
// and never re-forks anything from labor - it imports periods.js via
// the shared '@/app/kpi/labor/lib/periods.js' path (known debt, future
// file move; rule 4 forbids forking).

import { weekStartsInRange, periodOf } from "@/app/kpi/labor/lib/periods.js";

// ─── Currency + arrow formatters (inlined, rule 13) ──────────────────
//
// formatCompactDollar lives in src/lib/opsUtils.js which imports
// src/lib/sheets.js which imports googleapis. Any client component that
// touches opsUtils drags the entire googleapis surface into the client
// bundle and the build fails. So the two formatters we use are inlined
// here. Cents always, per §7 design law rule 6.

/**
 * Format a signed dollar amount with two decimals and thousand
 * separators. Sign is preserved on the returned string (negative gets
 * a leading '-'); use `moneyArrow` when you want an arrow + absolute
 * value instead. Never render `$-1,219.18` - rule 5 of §7.
 *
 * @param {number} n
 * @returns {string} e.g. "$1,234.56" or "-$1,234.56"
 */
export function fmt$(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-$" + abs : "$" + abs;
}

/**
 * Arrow + absolute value. Down arrow for negative (spend under),
 * up arrow for positive (spend over). §7 rule 5 - never render a raw
 * negative. Caller decides tone class ('r' / 'g') from context.
 *
 * @param {number} n
 * @returns {string} e.g. "▲ $1,234.56" or "▼ $1,234.56"
 */
export function moneyArrow(n) {
  const v = Number(n || 0);
  const glyph = v < 0 ? "▼" : "▲";   // ▼  ▲
  return `${glyph} ${fmt$(Math.abs(v))}`;
}

/**
 * Percent with one decimal. Used by `x% used` sub-lines and pace
 * readouts. Not tone-carrying.
 */
export function fmtPct(x) {
  return (Number(x || 0) * 100).toFixed(1) + "%";
}

// ─── Chart cadence label (§9B one-source) ────────────────────────────
//
// Both PeriodCard and BucketCard label the chart strip above their
// week / period bars. PR 2 R11 item 5 restored a static "Each week"
// label to BucketCard - correct at tier A, wrong at tier B (which
// still shows week bars over a range) and wrong at tier C (period
// bars). R12 item 1 makes both callers derive the label from a single
// source so tier ↔ cadence can never disagree between the two cards on
// one page.
//
// `chartUnit(tier)` returns the unit the chart's bars represent:
//   'A' → 'week'      (period, week by week)
//   'B' → 'week'      (range, week by week)
//   'C' → 'period'    (range, period by period)
//
// Callers assemble their own copy from this primitive so PeriodCard
// can keep its fuller "THE PERIOD/RANGE · WEEK/PERIOD BY WEEK/PERIOD"
// while BucketCard uses the short "Each week / Each period".
export function chartUnit(tier) {
  return tier === "C" ? "period" : "week";
}

// ─── State resolver - THE ONE (§5.2, §9B) ────────────────────────────
//
// One function. Every card's pill, hero colour class, and chart state
// call this. Any UI element that renders a state MUST derive it from
// exactly one call per (card, render) - the assertions in ./assertOneState
// enforce this contract in dev.
//
// Returns one of:
//   'over'     - spent above budget (open: pace > 1.03; closed: spent > budget)
//   'under'    - spent below budget (open: pace < 0.97; closed: spent <= budget)
//   'onpace'   - within tolerance (open only; a closed period never reads onpace)
//   'none'     - no spend at all (also no bills for period-card use)
//   'nobud'    - no budget (context bucket that renders neutral)
//   'passthru' - pass_through account short-circuit
//
// **A closed period compares exactly** (§5.2). No 3% tolerance band -
// TBR P8 was 2.6% over and read "On target" while its own hero rendered
// red before this was tightened. `closed && onpace` collapses to
// `under` at the pill layer, but the resolver here returns 'under'
// directly on closed exactness so the color / pill / chart never
// disagree.
//
// `hasBills` semantics (R10 correction, owner ruling 2026-08-25):
//   The gate MUST mirror the hero's `spent` source. If the hero shows
//   $X.YY, then hasBills = (spent > 0). Any caller that passes a
//   different source (bills-only when the hero is bills + coded cards,
//   spent without pending when the resolver added pending, etc.) is
//   the drift class this round fixed. Both PeriodCard and BucketCard
//   used to violate this - see the R10 sweep for the 10 cards it
//   caught.
//
// **Closed period, no tolerance band, no hasBills gate.** (R10, owner
// ruling 2026-08-25.) The `hasBills` check moves BELOW the `closed`
// check because a closed period with zero spend against a real budget
// is under by 100%, not "no verdict". Live periods keep the hasBills
// gate - early-period zero spend legitimately has no verdict yet.
// Exact comparison inherits from R4 (no 3% band).
export function stateOf({
  spent,
  budget,
  elapsedFrac,
  hasBills,
  isPassThrough,
  closed,
} = {}) {
  if (isPassThrough) return "passthru";
  if (!(budget > 0)) return "nobud";
  // R10 - closed periods short-circuit BEFORE hasBills. Exact
  // comparison; zero spend renders "under" against a real budget.
  if (closed) return spent > budget ? "over" : "under";
  if (!hasBills) return "none";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}

// Pill copy per state. Kept next to the resolver so any add / rename
// touches both. `Provisional` / `Final` badges live on the period card
// separately (not a state - a period-lifecycle marker).
export const PILL_COPY = {
  over:     { tone: "r", label: "Over target" },
  under:    { tone: "g", label: "On target"   },
  onpace:   { tone: "b", label: "On pace"     },
  none:     { tone: "n", label: "No spend"    },
  nobud:    { tone: "n", label: "No budget"   },
  passthru: { tone: "n", label: "Billed to client" },
};

/**
 * Hero color class for a state. §7 rule 3 - bucket hero colour follows
 * state - green under/on pace, red over, neutral at zero.
 *
 * Returns '' (no class) for `none` / `nobud` / `passthru` because those
 * heroes read as neutral n-900. State-carrying classes are the same
 * `.g` / `.r` / `.b` scoped-to-.kpi-app tokens the labor board uses.
 */
export function heroToneClass(state) {
  if (state === "over") return "r";
  if (state === "under" || state === "onpace") return "g";
  return "";
}

// ─── Weekly targets (§5.1) ───────────────────────────────────────────
//
// original = period_budget / weeks_in_period
// adjusted = (period_budget - spend in FINISHED weeks) / weeks NOT finished
//
// The running week is NOT finished; its partial spend is NOT subtracted.
// Subtracting it while counting the week in the denominator is the
// double-count that makes overspending RAISE the target - a §5.1
// hard-fail printed every build.
//
// Returns { original, adjusted } - both in the same currency unit as
// the budget input. `adjusted` is null when every week is finished
// (nothing left to target) or when weeks_in_period <= 0 (bad input).
//
// finishedSpend is the SUM of spend across the fully-elapsed weeks
// only. Callers derive it from the weekly view - each week whose end
// is before `today` counts; the running week does not.
export function weeklyTargets({ budget, weeksInPeriod, finishedSpend, finishedWeeks }) {
  if (!(weeksInPeriod > 0)) return { original: null, adjusted: null, budgetSpent: false };
  const original = Math.round((Number(budget || 0) / weeksInPeriod) * 100) / 100;
  const notFinished = weeksInPeriod - Number(finishedWeeks || 0);
  if (!(notFinished > 0)) return { original, adjusted: null, budgetSpent: false };
  const remaining = Number(budget || 0) - Number(finishedSpend || 0);
  // PR-2 R2 Fix 2 - owner ruling 2026-08-24: a negative weekly target is
  // meaningless on screen. When the budget is spent (remaining <= 0),
  // clamp `adjusted` to 0 and set `budgetSpent: true`. The consumer
  // renders `$0.00` and a caption saying "budget spent"; the target
  // dashed line does not render below the baseline (bar chart already
  // clamps at `lineValue > 0`).
  if (remaining <= 0) {
    return { original, adjusted: 0, budgetSpent: true };
  }
  const adjusted = Math.round((remaining / notFinished) * 100) / 100;
  return { original, adjusted, budgetSpent: false };
}

// ─── Chart shape (§4.2 of the prompt / §9B rule 3) ───────────────────
//
// The chart shape derives from elapsed - NEVER hardcoded.
//   weeksGone = elapsed_frac * weeks_in_period
//   share[i]  = clamp(weeksGone - i, 0, 1) / weeksGone
//
// At 32% elapsed with 4 weeks: weeksGone = 1.28, so
//   share = [1.0/1.28, 0.28/1.28, 0, 0] = [0.78, 0.22, 0, 0].
//
// A hardcoded 62/38 caused 6 of 11 accounts to disagree with themselves
// (pill vs chart at week 1). The shape and the pace must describe the
// SAME MOMENT. This is the load-bearing check A2 asserts.
//
// closedShape is a flat [0.25,0.25,0.25,0.25] equivalent when every
// week is done - the caller provides the actual bill spend per week
// from the weekly view, so no shape modeling is required for closed
// periods. Kept exported for symmetry / testability.
export function elapsedShape(elapsedFrac, weeksInPeriod) {
  const w = Math.max(0, Number(weeksInPeriod || 0));
  const el = Math.max(0, Number(elapsedFrac || 0));
  if (!(w > 0) || !(el > 0)) return new Array(w).fill(0);
  const weeksGone = el * w;
  const out = new Array(w);
  for (let i = 0; i < w; i += 1) {
    const done = Math.max(0, Math.min(1, weeksGone - i));
    out[i] = weeksGone > 0 ? done / weeksGone : 0;
  }
  return out;
}

// ─── Weekly spend from route weekly[] ────────────────────────────────
//
// The route ships `weekly` as [{ account_key, week_start, week_end,
// gl_line_code, gl_bucket, amount, line_count, bill_count, paid_amount }].
// This helper filters and sums by (bucket, week_start) so a bucket
// card's per-week bars can render straight from the same numbers the
// route computed.
//
// bucketKey values: 'food' | 'packaging' | 'vehicle' | 'equip' | 'rm'.
// Mapping to gl_bucket lives on the route:
//   'food'      -> gl_line_code startsWith '3200'
//   'packaging' -> gl_line_code startsWith '3400'
//   'vehicle'   -> gl_line_code startsWith '3500'
//   'equip'     -> gl_line_code === '5002.5'
//   'rm'        -> gl_line_code === '5002.1'
//
// The route already returns gl_bucket = 'pl_cogs' for 3200/3400/3500
// and 'sga' for the 5xxx family; we still filter on gl_line_code here
// to keep the split precise (equipment vs R&M share sga).
const GL_PREFIX_FOR_BUCKET = {
  food:      (gl) => typeof gl === "string" && gl.startsWith("3200"),
  packaging: (gl) => typeof gl === "string" && gl.startsWith("3400"),
  vehicle:   (gl) => typeof gl === "string" && gl.startsWith("3500"),
  equip:     (gl) => gl === "5002.5",
  rm:        (gl) => gl === "5002.1",
};

/**
 * Sum weekly spend for one bucket, per week_start ISO. Returns an
 * ordered array of { week_start, amount } for every fiscal week in
 * [start, end], zero-filled for weeks with no rows.
 *
 * NOTE: uses weekStartsInRange from labor/lib/periods.js (rule 4:
 * never fork it) to enumerate the weeks, so this is byte-identical to
 * the route's own week enumeration.
 */
export function bucketWeeklySpend({ weekly, bucketKey, start, end }) {
  const test = GL_PREFIX_FOR_BUCKET[bucketKey];
  if (!test) return [];
  const weeks = weekStartsInRange(start, end);
  const bySpend = new Map(weeks.map(w => [w, 0]));
  for (const r of weekly || []) {
    if (!test(r?.gl_line_code)) continue;
    const w = r?.week_start;
    if (!bySpend.has(w)) continue;
    bySpend.set(w, (bySpend.get(w) || 0) + Number(r.amount || 0));
  }
  return weeks.map(w => ({
    week_start: w,
    amount: Math.round((bySpend.get(w) || 0) * 100) / 100,
  }));
}

/**
 * Sum weekly spend for the KPI-line period card only. §4.1 - food,
 * packaging, vehicle. Equipment and R&M explicitly do NOT contribute
 * to the period card total or its chart (they get their own cards).
 * Charting a subtotal while headlining a total is one of the four
 * §9B bugs.
 *
 * `pendingSum` is not folded here - pending is never in a week bar
 * per §5.3. It lives on the period card copy and in projected_close.
 */
export function periodWeeklySpend({ weekly, start, end }) {
  const weeks = weekStartsInRange(start, end);
  const bySpend = new Map(weeks.map(w => [w, 0]));
  for (const r of weekly || []) {
    const gl = r?.gl_line_code || "";
    // KPI-only: 3200 (food) + 3400 (packaging) + 3500 (vehicle)
    const isKpi = gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500");
    if (!isKpi) continue;
    const w = r?.week_start;
    if (!bySpend.has(w)) continue;
    bySpend.set(w, (bySpend.get(w) || 0) + Number(r.amount || 0));
  }
  return weeks.map(w => ({
    week_start: w,
    amount: Math.round((bySpend.get(w) || 0) * 100) / 100,
  }));
}

/**
 * Number of finished (fully-elapsed) fiscal weeks in [start, end] as
 * of `todayISO`. A week is finished iff its LAST day (week_start + 6d)
 * is strictly before today. The running week is not finished (§5.1).
 */
export function finishedWeekCount({ start, end, todayISO }) {
  const weeks = weekStartsInRange(start, end);
  const MS_PER_DAY = 86400000;
  const today = new Date(todayISO).getTime();
  let n = 0;
  for (const w of weeks) {
    const weekEnd = new Date(w).getTime() + 6 * MS_PER_DAY;
    if (weekEnd < today) n += 1;
  }
  return n;
}

// ─── Projected close + remaining (§5.3) ──────────────────────────────
//
// pending  - from route.pending.amount (dollar sum, never split by
//            bucket - card spend has no GL line)
// remaining = budget - bills - pending
// projected_close = (bills + pending) / elapsed_frac
//
// These live at the period-card level. Pending is not tracked into
// any bucket and is never a bar in a week strip.
export function projectedClose({ bills, pending, elapsedFrac }) {
  const b = Number(bills || 0);
  const p = Number(pending || 0);
  const e = Number(elapsedFrac || 0);
  if (!(e > 0)) return null;
  return Math.round(((b + p) / e) * 100) / 100;
}

export function remaining({ budget, bills, pending }) {
  return Math.round(
    (Number(budget || 0) - Number(bills || 0) - Number(pending || 0)) * 100
  ) / 100;
}

// ─── One-source assertion helper (§9B) ───────────────────────────────
//
// A card renders three things that must agree: pill state, hero-colour
// class and chart state. This helper returns all three from ONE stateOf
// call so the components can bind each attribute to a field on the
// same object. If pill, hero-tone or chart later need different logic,
// that is a design decision that must alter this function - not each
// consumer.
//
// Callers destructure { state, pillTone, pillLabel, heroClass,
// variance, sign, signClass } and pass state straight through to the
// chart's state-carrying prop. Charts also need `closed` (a period
// lifecycle marker, not a state value) - passed through separately to
// avoid folding it into `state`.
//
// R10 additions (owner ruling 2026-08-25): `variance`, `sign` and
// `signClass` are here so `VS BUDGET` / `Over by` / `Remaining`
// consumers do NOT recompute `spent - budget` on their own with a
// different `spent`. Every state-bearing element on the card reads
// from ONE object. `signClass` is the same "" | "g" | "r" token the
// components apply to `.kpi-p-value` on a `Vs budget` row.
//
// Rounding: `variance` is cents-rounded to absorb per-line float drift
// (matches the .toFixed(2) the render then applies). `sign` uses a
// half-cent deadband so a $0.005 float rounding does not flip the
// verdict from "on target" (variance = 0) to "over" (variance = 0.005).
export function resolveCardState(args) {
  const state = stateOf(args);
  const pill = PILL_COPY[state] || PILL_COPY.none;
  const spent = Number(args?.spent || 0);
  const budget = Number(args?.budget || 0);
  const varianceRaw = spent - budget;
  const variance = Math.round(varianceRaw * 100) / 100;
  let sign = 0;
  if (variance > 0.005) sign = 1;
  else if (variance < -0.005) sign = -1;
  let signClass = "";
  if (sign > 0) signClass = "r";
  else if (sign < 0) signClass = "g";
  return {
    state,
    pillTone: pill.tone,
    pillLabel: pill.label,
    heroClass: heroToneClass(state),
    variance,
    sign,
    signClass,
    spent,
    budget,
    closed: !!args?.closed,
  };
}

// ─── Resolver-owned card display (§9B, INV-P21 structural fix) ───────
//
// Every element that a card renders - hero value, sub-line, variance
// label, variance value, variance colour, variance caption, projected-
// close row, tier-aware weekly-target caption - is computed HERE and
// returned as a formatted string or a colour class.  The component
// consumes those fields and cannot compute anything itself.
//
// INV-P21 caught nine separate defects that all had one shape: two
// elements on the same card computing the same idea from different
// subsets of pending.  R10's assertion compared outputs; on WEST FYTD
// the outputs looked plausible while the inputs disagreed, and the
// assertion passed on a broken card.  Removing arithmetic from the
// component removes the shape entirely.
//
// Owner ruling 2026-08-26 (Option 2):
//   - Pending stays in the period-card verdict on LIVE ranges and
//     stays OUT of CLOSED verdicts.
//   - Hero stays coded-only in this PR (rule 2 - no figure changes).
//     Follow-up (Option 3, deferred): move hero to spent+pending on
//     live to close the class properly.
//   - Variance caption sign-gated:
//       under budget on live -> "net of pending"
//       over  budget on live -> "includes uncoded pending"
//       closed period        -> "period closed"
//
// Tier ruling (INV-P21 Part B2 item 2):
//   - `aim for $X / wk` renders only on tier A or B.  Tier C
//     (FYTD or >bWeekMax weeks) suppresses the caption entirely;
//     BucketCard used to show it despite the period-card chart legend
//     dropping it.  One rule, one caller.
//
// `cardKind` values: 'period' | 'bucket' | 'ledger'.
//
// The `__inputSignature` field is a deterministic hash of the inputs.
// The matrix probe asserts that every rendered element on a card
// resolved from the SAME signature - not that outputs agree, but that
// inputs match - which is the exact case R5/R6/R10 could not catch.
export function resolveCardDisplay(args) {
  const kind = args?.cardKind || "period";
  const spent = Number(args?.spent || 0);
  const budget = Number(args?.budget || 0);
  const pending = Number(args?.pending || 0);
  const closed = !!args?.closed;
  const isFutureRange = !!args?.isFutureRange;
  const isPassThrough = !!args?.isPassThrough;
  const tier = args?.tier || null;
  const original = args?.original;
  const adjusted = args?.adjusted;
  const budgetSpent = !!args?.budgetSpent;

  // Base state resolution.  For the PERIOD card on a live range the
  // resolver-spent includes pending (owner ruling 2026-08-26).  For
  // CLOSED it does not.  For BUCKET / LEDGER cards pending never
  // enters (structural - pending has no gl_line_code and can't be
  // attributed).
  //
  // Option 3 landed 2026-08-26 (this PR): on a live period the HERO,
  // sub-line %-used, and projected-close row all render against
  // `resolverSpent` (spent + pending) instead of coded-only.  Closed
  // periods are unaffected - `includePendingInVerdict` is false when
  // `closed`.  The three previously-diverging elements (hero excludes,
  // variance includes, pill includes) now agree.  #839 owned the
  // captioning contract; this PR owns the number.
  const includePendingInVerdict = kind === "period" && !closed;
  const resolverSpent = spent + (includePendingInVerdict ? pending : 0);
  const cs = resolveCardState({
    ...args,
    spent: resolverSpent,
    hasBills: resolverSpent > 0,
  });

  // Hero.  On live period the hero shows the same number the pill and
  // variance already resolve against - spent + pending.  On closed
  // (and on bucket/ledger cards) it stays coded-only.
  const heroValue = resolverSpent;
  const heroValueText = fmt$(heroValue);
  // Hero colour matches the variance colour so a `red $X` hero never
  // sits next to a `green Over by` (WEST FYTD's exact defect - state
  // said 'onpace' via the 3% pace band while the raw variance said
  // over).  On live an over hero + red variance both come from the
  // same `rem < 0` test.  On closed the two agree by construction
  // (state = spent > budget ? 'over' : 'under').

  // Sub-line under hero.  `%-used` reads off the hero, so a card
  // showing `SPENT $X of $Y` cannot compute Y% from a different
  // numerator than the hero.  #839's exact defect closed structurally.
  const subLineOfBudgetText = fmt$(budget);
  const spentUsedFrac = budget > 0 ? (heroValue / budget) : null;
  const subLinePctText = (!isFutureRange && spentUsedFrac != null) ? fmtPct(spentUsedFrac) : "";
  const subLineNoBudgetText = (budget === 0 && !isFutureRange) ? "no budget" : "";

  // Remaining / Over by / Vs budget block.
  //
  // `rem` computed here is the ONLY variance arithmetic.  Every downstream
  // display string reads from this one number.  Pending enters the live-
  // range rem so the label and the pill agree on which side of budget
  // the card is on; on closed it doesn't (per ruling).
  const remRaw = budget - spent - (includePendingInVerdict ? pending : 0);
  const rem = Math.round(remRaw * 100) / 100;
  const showOverArrow = rem < 0;
  const showRemainingBlock = !isFutureRange && budget !== 0;
  const showFutureBudgetBlock = isFutureRange;

  // Hero colour bound to variance sign (Option 3 owner ruling).  Over
  // -> red no matter what the pace band said.  Otherwise fall back to
  // state-derived heroClass so `under`/`onpace`/`none`/`nobud` still
  // render as they did before (green / green / neutral / neutral).
  const heroClassEffective = isFutureRange ? "" : (showOverArrow ? "r" : cs.heroClass);

  let remainingLabel = "";
  let remainingValueText = "";
  let remainingClass = "";
  let remainingCaption = "";

  if (kind === "ledger") {
    // Ledger: no pending concept.  Caption unchanged from prior behaviour.
    remainingLabel = closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining");
    remainingValueText = closed
      ? moneyArrow(cs.variance)
      : (showOverArrow ? fmt$(-rem) : fmt$(rem));
    remainingClass = closed
      ? (cs.signClass || (cs.variance > 0 ? "r" : "g"))
      : (showOverArrow ? "r" : "");
    remainingCaption = closed ? "period closed" : "every purchase below";
  } else if (kind === "bucket") {
    // Bucket: pending never enters, but the caption is tier + state gated.
    remainingLabel = closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining");
    remainingValueText = closed
      ? moneyArrow(cs.variance)
      : (showOverArrow ? fmt$(-rem) : fmt$(rem));
    remainingClass = closed
      ? (cs.signClass || (cs.variance > 0 ? "r" : "g"))
      : (showOverArrow ? "r" : "");
    if (closed) {
      remainingCaption = "period closed";
    } else if (budgetSpent) {
      remainingCaption = "budget spent";
    } else if (tier === "C") {
      // INV-P21 Part B2 item 2 - tier-C suppresses the weekly target.
      // Period card already suppressed it (BucketCard.js:306 vs
      // PeriodCard.js:336 disagreed).  Resolver decides once.
      remainingCaption = "no target this range";
    } else if (adjusted != null) {
      remainingCaption = `aim for ${fmt$(adjusted)} / wk`;
    } else {
      remainingCaption = "no target this range";
    }
  } else {
    // Period card.
    //
    // Option 3 caption change (owner ruling 2026-08-26): with the hero
    // now including pending on live, `net of pending` and `includes
    // uncoded pending` both restate what the hero already shows.  The
    // three numbers on the card (hero, sub-line %, variance) all read
    // against the same `resolverSpent`, so the reader has nothing to
    // reconstruct.  Caption is empty on live.
    //
    // R13 P0-1 (owner ruling 2026-08-26): on a closed card the label
    // is a single word matching the sign - "Over budget" or "Under
    // budget", not "Vs budget".  One label per number.  The Actual /
    // Budget / Variance sub-block is dropped; the closed hero already
    // owns the number and the sub-line owns "of $X · Y% used".  The
    // caption below the variance reads "as closed on the P&L" (the
    // lifecycle note) instead of "period closed".
    //
    // R13 P1-2 (owner ruling 2026-08-26): on live over cases the
    // "Over by" column earns a sub-line - `X.X% of the range budget`
    // - matching the "Spent · of $X · Y% used" sub-line on the left.
    if (closed) {
      remainingLabel = showOverArrow ? "Over budget" : "Under budget";
      // Bare value (no ▲/▼ glyph) - the label already carries the sign.
      remainingValueText = showOverArrow ? fmt$(-rem) : fmt$(rem);
      remainingClass = showOverArrow ? "r" : "g";
      remainingCaption = "as closed on the P&L";
    } else {
      remainingLabel = showOverArrow ? "Over by" : "Remaining";
      remainingValueText = showOverArrow ? fmt$(-rem) : fmt$(rem);
      remainingClass = showOverArrow ? "r" : "";
      remainingCaption = "";
    }
  }
  // R13 P1-2 - over-by sub-line "X.X% of the range budget".  Only
  // shows on live over cases where a budget exists; closed uses the
  // "as closed on the P&L" caption above and would double-annotate.
  const remainingSubLineText = (kind === "period" && !closed && showOverArrow && budget > 0)
    ? fmtPct(Math.abs(rem) / budget)
    : "";

  // Projected close (period card only).
  //
  // Option 3 (owner ruling 2026-08-26): on a live range the hero
  // includes pending, so the projected-close forecast projects the
  // SAME base forward.  Server ships `projectedClose = spent /
  // elapsed_frac`; the resolver adjusts to `(spent + pending) /
  // elapsed_frac` on live so the "if this pace holds" row stays
  // coherent with the hero.  Closed period doesn't render this row
  // anyway (`!closed` gate below).
  const serverProjectedClose = args?.projectedClose;
  const elapsedFrac = Number(args?.elapsedFrac || 0);
  const displayedProjectedClose = (kind === "period" && !closed
      && elapsedFrac > 0 && (spent + pending) > 0)
    ? Math.round(((spent + pending) / elapsedFrac) * 100) / 100
    : (serverProjectedClose != null ? Number(serverProjectedClose) : null);
  const showProjectedClose = kind === "period"
    && !isFutureRange && !closed
    && displayedProjectedClose != null;
  const pcOverBudget = showProjectedClose && displayedProjectedClose > budget;
  const projectedCloseValueText = showProjectedClose ? fmt$(displayedProjectedClose) : "";
  const projectedCloseValueClass = pcOverBudget ? "r" : "";
  const projectedCloseArrow = showProjectedClose ? (pcOverBudget ? "▲ " : "▼ ") : "";
  const projectedCloseDeltaText = showProjectedClose ? fmt$(Math.abs(displayedProjectedClose - budget)) : "";
  const projectedCloseAnnotationClass = pcOverBudget ? "r" : "g";

  // Input signature - deterministic hash of the exact numeric inputs +
  // range-flags that could change any element's value.  Two calls with
  // the same signature must return byte-identical display fields; the
  // matrix probe verifies that inputs match across every element on a
  // card - the check R5/R6/R10 couldn't perform.
  const __inputSignature = [
    `k=${kind}`,
    `s=${spent.toFixed(4)}`,
    `b=${budget.toFixed(4)}`,
    `p=${pending.toFixed(4)}`,
    `c=${closed ? 1 : 0}`,
    `f=${isFutureRange ? 1 : 0}`,
    `pt=${isPassThrough ? 1 : 0}`,
    `t=${tier || "?"}`,
    `pc=${projectedClose != null ? Number(projectedClose).toFixed(4) : "n"}`,
    `bs=${budgetSpent ? 1 : 0}`,
    `ef=${(Number(args?.elapsedFrac || 0)).toFixed(4)}`,
  ].join("|");

  // R13 P2-8 - chart cadence header names its bucket (or "food +
  // packaging + vehicle" for the period card).  identityLabel comes in
  // from the caller; when absent (legacy call site) the header falls
  // back to the cadence-only shape.
  const identityLabel = args?.identityLabel || null;
  const cadence = tier ? `Each ${chartUnit(tier)}` : "";
  const weekStripLabel = cadence
    ? (identityLabel ? `${cadence} · ${identityLabel}` : cadence)
    : "";

  // R13 P0-1 - prior-period comparison block (closed period cards).
  // The caller passes `priorPeriod` = { period_no, spent, label } for
  // the fiscal period immediately before this one, and `sparkline` =
  // [{ period_no, spent }] for the last 8 periods leading up to this
  // one.  Both are already rolled up across the current members
  // (route.js owns the aggregation - so ALL/EAST/WEST show the
  // portfolio shape, not one site's).  Resolver formats them for
  // display; component renders what it's told.
  const priorPeriod = args?.priorPeriod || null;
  const sparkline   = Array.isArray(args?.sparkline) ? args.sparkline : null;
  const showPriorPeriodBlock = kind === "period" && closed
    && priorPeriod && Number.isFinite(Number(priorPeriod.spent))
    && Number(priorPeriod.spent) > 0;
  let priorPeriodValueText   = "";
  let priorPeriodDeltaText   = "";
  let priorPeriodDeltaClass  = "";
  let priorPeriodDeltaArrow  = "";
  let priorPeriodLabelText   = "";
  let priorPeriodDescription = "";
  let sparklineHeights       = [];
  let sparklineCurrentIdx    = -1;
  let sparklineNote          = "";
  if (showPriorPeriodBlock) {
    const priorSpent = Number(priorPeriod.spent || 0);
    const currentClosedSpent = spent;   // closed hero = coded-only
    priorPeriodValueText   = fmt$(priorSpent);
    priorPeriodLabelText   = priorPeriod.label || `Period ${priorPeriod.period_no}`;
    priorPeriodDescription = "the period before";
    if (priorSpent > 0) {
      const pct = (currentClosedSpent - priorSpent) / priorSpent;
      const up = pct > 0;
      priorPeriodDeltaArrow = up ? "▲ " : "▼ ";
      priorPeriodDeltaText  = fmtPct(Math.abs(pct));
      priorPeriodDeltaClass = up ? "r" : "g";
    }
    if (sparkline && sparkline.length > 0) {
      const maxSpent = Math.max(1, ...sparkline.map(s => Number(s.spent || 0)));
      sparklineHeights = sparkline.map(s => Math.max(0.04, Number(s.spent || 0) / maxSpent));
      const cur = args?.periodNo != null ? args.periodNo : null;
      sparklineCurrentIdx = cur != null
        ? sparkline.findIndex(s => Number(s.period_no) === Number(cur))
        : -1;
      const first = sparkline[0]?.period_no;
      const last  = sparkline[sparkline.length - 1]?.period_no;
      sparklineNote = first != null && last != null ? `P${first} through P${last}` : "";
    }
  }

  // R13 P0-2 - running-unit projection threshold.  Below 25% elapsed
  // the projection swings wildly (probe 2026-08-26: ratios 0.60-1.72
  // on real periods, 1.88-2.17 on real weeks).  Above 25%, aggregate
  // scopes land within ±7%.  Resolver returns whether the projection
  // is stable enough to render; component draws the dashed extension
  // + `on pace for $X` tag only when true, otherwise renders the bar
  // alone with the `N% through` caption.  Applies to both running
  // week (elapsed = days/7) and running period (elapsed = days/28).
  const PROJECTION_MIN_ELAPSED = 0.25;
  const runningProjectionStable = elapsedFrac >= PROJECTION_MIN_ELAPSED;
  const runningProjectionValue  = (elapsedFrac > 0 && (spent + pending) > 0)
    ? (spent + pending) / elapsedFrac
    : 0;
  const runningElapsedPctText   = elapsedFrac > 0
    ? Math.round(elapsedFrac * 100) + "% through"
    : "";

  return {
    // Pill (unchanged shape, feeds off resolverSpent)
    pillTone: cs.pillTone,
    pillLabel: cs.pillLabel,
    // Hero
    heroValueText,
    heroClass: heroClassEffective,
    // Sub-line under hero
    subLineOfBudgetText,
    subLinePctText,
    subLineNoBudgetText,
    // Variance / Remaining block
    showRemainingBlock,
    showFutureBudgetBlock,
    remainingLabel,
    remainingValueText,
    remainingClass,
    remainingCaption,
    // R13 P1-2 - over-by sub-line "X.X% of the range budget"
    remainingSubLineText,
    // Projected close (period card only; false for others)
    showProjectedClose,
    projectedCloseValueText,
    projectedCloseValueClass,
    projectedCloseArrow,
    projectedCloseDeltaText,
    projectedCloseAnnotationClass,
    // R13 P2-8 - chart cadence label; now includes bucket name when
    // identityLabel is provided.  Format: "Each week · food".
    weekStripLabel,
    // R13 P0-1 - prior-period comparison block on closed period cards.
    showPriorPeriodBlock,
    priorPeriodLabelText,
    priorPeriodDescription,
    priorPeriodValueText,
    priorPeriodDeltaText,
    priorPeriodDeltaClass,
    priorPeriodDeltaArrow,
    sparklineHeights,
    sparklineCurrentIdx,
    sparklineNote,
    // R13 P0-2 - running-unit projection stability.  Component uses
    // `runningProjectionStable` as the gate for whether to draw the
    // dashed extension + tag; `runningElapsedPctText` is the caption
    // regardless (always states how far through).
    runningProjectionStable,
    runningProjectionValue,
    runningElapsedPctText,
    // For the input-comparison assertion (INV-P21 Part D).
    __inputSignature,
    // Passthrough of nested cs for legacy inspection during the
    // migration.  Do NOT read cs.variance directly on the component;
    // use remainingValueText.
    __cs: cs,
  };
}

// ─── Bucket definitions - client canonical ordering ──────────────────
//
// Route ships buckets[] for {food, packaging, vehicle} only. Equipment
// and R&M are 5xxx lines - the route reports them under categories[],
// so the client rolls those into ledger cards from that list + weekly.
//
// Colors match §7 rule 1. Every card that carries an identity stripe
// picks its stripe class from this table - never inline.
// ─── R14 - Management fee resolver ────────────────────────────────
//
// The management-fee card is a two-pane statement (Kevin ruling
// 2026-08-27, hybrid render).  Left = range-scoped reimbursable
// statement.  Right = FYTD-anchored year status.  This resolver owns
// every displayed value and caption on the card; the component reads
// formatted strings and renders them verbatim.
//
// Prefix-strip rule: category names in billcom_ref_accounts embed the
// account key (e.g. "STL - MO Food").  On a card viewing STL - MO
// that reads redundant, so we strip the "<account_key> " prefix when
// it matches the viewing account.  When the prefix does NOT match
// (e.g. "STL - FL Food" appearing on the STL - MO card), we render
// the raw name unchanged - a misattribution the operator needs to
// see, not one the resolver silently hides.
//
// Tail rule: categories worth less than TAIL_THRESHOLD_PCT of the
// hero collapse into a "N smaller lines" row, but only when N >= 2.
// A single sub-1% line renders individually - "1 smaller line" reads
// as a mystery bucket of one.
//
// Fun-money hero label swap: when 3200.2 spend > 0 in range, the hero
// value = reimbursable + fun_money and the label swaps from "Billed
// back to <client> · 13xx" to "Reimbursable and fun money · 13xx +
// 3200.2".  Fun money then joins the category list so subrow shares
// still sum to 100%.
const TAIL_THRESHOLD_PCT = 0.01;   // categories under 1% of hero fold to "N smaller lines"

// Number word for the sentence.  Beyond 4 falls back to the digit -
// no operator needs "seven periods" to read as a story.
const NUMBER_WORD = ["zero", "one", "two", "three", "four"];
function numWord(n) {
  return NUMBER_WORD[n] || String(n);
}

// Strip "<accountKey> " prefix from a category name IFF it matches.
// A mismatched prefix renders verbatim so misattribution is visible.
function stripAccountPrefix(name, accountKey) {
  if (typeof name !== "string" || !name) return name;
  const pfx = `${accountKey} `;
  if (name.startsWith(pfx)) return name.slice(pfx.length);
  return name;
}

// Case normalisation was originally added to match the render voice
// ("Packaged Snacks" -> "Packaged snacks").  Removed: it stripped
// legitimate second-word capitals off names like "Fun Money", and the
// principled call is to render the chart-of-accounts name verbatim.
// Kevin's PR body note: labels read as the DB has them; the render
// voice difference is cosmetic.
function normaliseCategoryCase(name) { return name; }

export function resolveMgmtFeeCard(args) {
  const {
    accountKey,
    goalRow,               // { annual, salesTaxApplied, clientLabel, taxCaveatState, breakdown }
    mgmtFee,               // route.mgmt_fee shape
    reimbSpentRange,       // range-scoped 13xx sum (from client-side categories rollup)
    pending,               // { amount, line_count }
    yearElapsedFrac,       // 0..1 (fraction of FY2026 elapsed)
    closed,
    provisional,
    isFutureRange,
    weekOfPeriod,
    weeksInPeriod,
    elapsedFrac,           // range-scoped elapsed
    cardTitle,             // "Fiscal year to date" | "Period 8" | ...
  } = args;

  const goalAmount = Number(goalRow?.annual || 0);
  const clientLabel = goalRow?.clientLabel || accountKey;
  const taxState = goalRow?.taxCaveatState || null;

  // ─── LEFT PANE: statement ────────────────────────────────────────
  const funMoneyRange = Number(mgmtFee?.fun_money?.spent || 0);
  const hasFunMoney = funMoneyRange > 0.005;
  const leftHeroValue = reimbSpentRange + (hasFunMoney ? funMoneyRange : 0);
  const leftHeroLabel = hasFunMoney
    ? "Reimbursable and fun money"
    : `Billed back to ${clientLabel}`;
  const leftHeroCodeSubtitle = hasFunMoney ? "13xx + 3200.2" : "13xx";

  // Category rows with tail grouping.
  const catsRaw = Array.isArray(mgmtFee?.reimb_categories)
    ? mgmtFee.reimb_categories.slice()
    : [];
  // Fun money joins the category list as a special row.  When it has
  // a positive budget the row carries verdict colour (r if over, b if
  // under) and a right-side "of $Y · Z% used" caveat.  This is the ONE
  // KitchFix-borne budget line at these sites (Kevin ruling 2026-08-27
  // - "the only number on the card that is a verdict").  The card
  // already uses r / b on the right-pane hero for over / under goal,
  // so the same grammar carries the fun-money verdict.
  const funMoneyBudget = Number(mgmtFee?.fun_money?.budget || 0);
  if (hasFunMoney) {
    catsRaw.push({
      gl_line_code: "3200.2",
      name:         "Fun Money",
      spent:        Math.round(funMoneyRange * 100) / 100,
      isFunMoney:   true,
      budget:       funMoneyBudget,
    });
  }
  catsRaw.sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0));

  const categoryRows = [];
  const tailBundle = [];
  for (const c of catsRaw) {
    const spentNum = Number(c.spent || 0);
    const share = leftHeroValue > 0 ? spentNum / leftHeroValue : 0;
    const rawName = c.name;
    const displayName = rawName
      ? normaliseCategoryCase(stripAccountPrefix(rawName, accountKey))
      : null;
    const row = {
      gl_line_code: c.gl_line_code,
      label:        displayName || c.gl_line_code,
      hasName:      !!displayName,
      spentNumeric: spentNum,
      valueText:    fmt$(spentNum),
      shareText:    fmtPct(share),
      share,
    };
    // Fun money extras: budget, over/under state class, of/used caveat.
    if (c.isFunMoney) {
      const bud = Number(c.budget || 0);
      row.isFunMoney = true;
      row.budgetText = bud > 0 ? fmt$(bud) : null;
      row.hasBudget = bud > 0;
      if (bud > 0) {
        const pct = spentNum / bud;
        row.usedPctText = fmtPct(pct);
        // r when over, b when under - same grammar as right-pane hero
        // over/under goal.  Applied to `valueText` via a `.r` / `.b`
        // class on the value cell.
        row.stateClass = spentNum > bud ? "r" : "b";
        row.captionText = `of ${fmt$(bud)} · ${row.usedPctText} used`;
      } else {
        row.stateClass = "";           // no budget, no verdict
        row.captionText = "no budget";
      }
    }
    if (share < TAIL_THRESHOLD_PCT && !c.isFunMoney) tailBundle.push(row);
    else categoryRows.push(row);
  }
  if (tailBundle.length === 1) categoryRows.push(tailBundle[0]);
  else if (tailBundle.length >= 2) {
    const tailSpent = tailBundle.reduce((s, r) => s + r.spentNumeric, 0);
    categoryRows.push({
      gl_line_code: null,
      label:        `${tailBundle.length} smaller lines`,
      hasName:      true,
      spentNumeric: tailSpent,
      valueText:    fmt$(tailSpent),
      shareText:    fmtPct(tailSpent / (leftHeroValue || 1)),
      isTail:       true,
    });
  }

  const pendingAmount = Number(pending?.amount || 0);
  const showPendingRow = pendingAmount > 0.005;
  const pendingValueText = fmt$(pendingAmount);

  // ─── RIGHT PANE: the year ────────────────────────────────────────
  // FYTD-anchored regardless of range picker.
  const annualSpent = Number(mgmtFee?.goal_fytd_spent || 0);
  const overAmount = annualSpent - goalAmount;
  const isOver = overAmount > 0;
  let rightHeroLabel = "";
  let rightHeroValueText = "";
  let rightHeroClass = "";
  if (goalAmount > 0) {
    if (isOver) {
      rightHeroLabel = "Over the annual goal by";
      rightHeroValueText = fmt$(overAmount);
      rightHeroClass = "r";
    } else {
      rightHeroLabel = "Room in the annual goal";
      rightHeroValueText = fmt$(-overAmount);
      rightHeroClass = "b";   // navy - stated, not judged
    }
  }
  const rightSubSpentText = fmt$(annualSpent);
  const rightSubGoalText = fmt$(goalAmount);
  const rightTaxCaption = taxState
    ? `before ${taxState} sales tax · provisional`
    : "provisional";

  // Track bar - scale runs to max(1, spentPct) so overage renders past
  // the goal marker.
  const spentPct = goalAmount > 0 ? annualSpent / goalAmount : 0;
  const scale = Math.max(1, spentPct);
  const trackSpentFrac = Math.min(1, spentPct) / scale;
  const trackOverFrac = Math.max(0, spentPct - 1) / scale;
  const goalMarkerFrac = 1 / scale;
  const yearMarkerFrac = Math.max(0, Math.min(1, yearElapsedFrac || 0)) / scale;
  const yearMarkerText = `${Math.round((yearElapsedFrac || 0) * 100)}% of the year`;
  const spentMarkerText = `${Math.round(spentPct * 100)}% spent`;

  // Sentence - crossed vs not-crossed.
  const currentPeriodTrend = Array.isArray(mgmtFee?.periods_trend) ? mgmtFee.periods_trend : [];
  const currentPeriodNo = currentPeriodTrend.length > 0
    ? currentPeriodTrend[currentPeriodTrend.length - 1].period_no
    : null;
  const periodsRemaining = currentPeriodNo != null ? Math.max(0, 13 - currentPeriodNo) : 0;
  const yearLeftPct = Math.max(0, Math.round(100 - (yearElapsedFrac || 0) * 100));
  const crossedPeriod = mgmtFee?.crossed_period_no;
  let sentenceText = "";
  if (crossedPeriod != null && goalAmount > 0) {
    sentenceText = `Crossed the goal in period ${crossedPeriod}, with ${numWord(periodsRemaining)} ${periodsRemaining === 1 ? "period" : "periods"} and ${yearLeftPct}% of the year still to run.`;
  } else if (goalAmount > 0) {
    const remainingText = fmt$(Math.max(0, goalAmount - annualSpent));
    sentenceText = `${remainingText} remains, with ${numWord(periodsRemaining)} ${periodsRemaining === 1 ? "period" : "periods"} and ${yearLeftPct}% of the year still to run.`;
  }

  // Mini trend (per-period spend, above-average = solid).
  const trendSpends = currentPeriodTrend.map(t => Number(t.spent || 0));
  const avgSpend = trendSpends.length > 0
    ? trendSpends.reduce((s, v) => s + v, 0) / trendSpends.length
    : 0;
  const maxSpend = Math.max(1, ...trendSpends);
  const miniBars = currentPeriodTrend.map(t => {
    const v = Number(t.spent || 0);
    const isRunning = t.period_no === currentPeriodNo && (yearElapsedFrac || 0) < 1;
    return {
      periodNo:  t.period_no,
      heightPct: (v / maxSpend) * 100,
      isAbove:   v > avgSpend,
      isRunning,
    };
  });
  const miniAvgFrac = maxSpend > 0 ? avgSpend / maxSpend : 0;

  // Status line (matches PeriodCard voice).
  let statusLineText = "";
  if (isFutureRange) statusLineText = "hasn't started";
  else if (closed) statusLineText = `${weeksInPeriod || 4} of ${weeksInPeriod || 4} weeks · closed`;
  else if (weekOfPeriod && weeksInPeriod) {
    const elapsedPct = elapsedFrac != null
      ? `${Math.round(Number(elapsedFrac) * 100)}% elapsed`
      : "";
    statusLineText = `week ${weekOfPeriod} of ${weeksInPeriod}${elapsedPct ? ` · ${elapsedPct}` : ""}`;
  } else if (elapsedFrac != null) {
    statusLineText = `${Math.round(Number(elapsedFrac) * 100)}% elapsed`;
  }

  const showFinalPill = closed && !isFutureRange;
  const showProvisionalPill = provisional && !closed && !isFutureRange;

  return {
    cardTitle,
    // Left pane
    leftHeroLabel,
    leftHeroCodeSubtitle,
    leftHeroValueText: fmt$(leftHeroValue),
    hasFunMoney,
    categoryRows,
    showPendingRow,
    pendingValueText,
    // Right pane
    rightHeroLabel,
    rightHeroValueText,
    rightHeroClass,
    rightSubSpentText,
    rightSubGoalText,
    rightTaxCaption,
    trackSpentFrac,
    trackOverFrac,
    goalMarkerFrac,
    yearMarkerFrac,
    yearMarkerText,
    spentMarkerText,
    sentenceText,
    // Mini trend
    miniBars,
    miniAvgFrac,
    // Shared card chrome
    statusLineText,
    pillTone: "n",
    pillLabel: "Billed to client",
    showFinalPill,
    showProvisionalPill,
  };
}

// R13 P2-1 ruling 2026-08-26: subtitle = GL code only.  Uniform width
// across all three cards; the category name in the title conveys scope;
// the GL code is what an operator cross-references against the P&L.
export const BUCKET_DEFS = [
  { key: "food",      label: "Food",                     sub: "3200",
    strokeClass: "kpi-p-b-food",     legend: "#153968" },
  { key: "packaging", label: "Packaging & supplies",     sub: "3400",
    strokeClass: "kpi-p-b-pkg",      legend: "#3E97D1" },
  { key: "vehicle",   label: "Vehicle",                  sub: "3500",
    strokeClass: "kpi-p-b-veh",      legend: "#7A3E9D" },
];

export const LEDGER_DEFS = [
  // R15 - Vehicle joins the matched-ledgers row.  Was a BucketCard with
  // 9 period bars for a category moving ~$2k a period; the chart carried
  // no signal (98.6% of Vehicle spend is on cards ALL FYTD, structurally
  // unlike Food/Packaging).  Now: same LedgerCard shape as Equipment
  // and R&M.  `glLikePrefix: "3500"` mirrors reimb's 13xx pattern.
  { key: "veh",   label: "Vehicle",                sub: "3500",   glLikePrefix: "3500",
    strokeClass: "kpi-p-b-veh",    legend: "#7A3E9D",
    payloadKey: "vehicle" },
  { key: "equip", label: "Equipment",              sub: "5002.5", glLineCode: "5002.5",
    strokeClass: "kpi-p-b-equip",  legend: "#0F766E",
    payloadKey: "equipment" },
  { key: "rm",    label: "Repair & maintenance",   sub: "5002.1", glLineCode: "5002.1",
    strokeClass: "kpi-p-b-rm",     legend: "#B45309",
    payloadKey: "repair" },
  // PR-2 R6 Part B - reimbursable is a bucket (13xx family), not a single
  // gl line. `glLikePrefix` gates the client-side hero sum across
  // categories[] entries whose gl_line_code starts with "13".
  { key: "reimb", label: "Reimbursable",           sub: "13xx",   glLikePrefix: "13",
    strokeClass: "kpi-p-b-per",    legend: "#4A6076",
    payloadKey: "reimbursable" },
];

// ─── Budget resolution helpers ───────────────────────────────────────
//
// Route ships budget.by_gl_line_code = [{ gl_line_code, amount }] for
// the range. The client sums per-bucket by walking the list.
export function bucketBudget({ byGlLineCode, bucketKey }) {
  const test = GL_PREFIX_FOR_BUCKET[bucketKey];
  if (!test) return 0;
  let s = 0;
  for (const r of byGlLineCode || []) {
    if (test(r?.gl_line_code)) s += Number(r.amount || 0);
  }
  return Math.round(s * 100) / 100;
}

/** KPI-line only budget - food + packaging + vehicle (§4.1). */
export function kpiBudget({ byGlLineCode }) {
  let s = 0;
  for (const r of byGlLineCode || []) {
    const gl = r?.gl_line_code || "";
    if (gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500")) {
      s += Number(r.amount || 0);
    }
  }
  return Math.round(s * 100) / 100;
}

// ─── Categories helpers (for ledger cards) ───────────────────────────
//
// The route's categories[] is the union of every gl_line_code with
// budget or spend in range. Ledger cards need the { budget, spent }
// figures per specific gl_line_code so we can render the hero + rows.
export function categoryFor(categories, glLineCode) {
  return (categories || []).find(c => c.gl_line_code === glLineCode) || null;
}
