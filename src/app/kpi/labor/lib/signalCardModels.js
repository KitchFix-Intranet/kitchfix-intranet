// src/app/kpi/labor/lib/signalCardModels.js
//
// PR-A - pure fact-building for SignalCards, extracted so a Node probe
// can construct synthetic board payloads and assert without JSX
// compilation. The JSX component in SignalCards.js consumes the same
// models here, so there is one source of truth: a probe green implies
// the client would render green on the same inputs.
//
// Owner ruling 2026-08-24: multi_period is a third state, not a
// fall-through. Prior code treated inProgress and closed as the only
// branches; multi_period rendered — on Of budget used, Overrun (a
// mislabel), Per week, Per worker, Weeks. This module makes the
// three-way discrimination explicit.
//
// No JSX. No React. Fact `value` fields are either a formatted string
// or a descriptor like { shape: "arrow", v, size } for the JSX layer
// to reconstruct. The probe asserts on strings; the JSX render path
// handles descriptors.

import { fmt$, fmtHrs } from "./formatting.js";

function fmtMMDDYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y.slice(2)}`;
}

// V29-17 - pill vocabulary is the same across the row.
export function pillFor(verdict) {
  if (verdict === "on_track") return { state: "good", label: "ON TARGET" };
  if (verdict === "watch")    return { state: "warn", label: "WATCH" };
  if (verdict === "over")     return { state: "bad",  label: "OVER" };
  return { state: "neutral", label: "—" };
}

// 2026-08-26 v43-1 - Approvals card pill classification. Reports
// AGE and never claims completion unless it is genuinely true.
//
// Owner ruling 2026-08-26 (post-scope-review): the materiality
// threshold from polish round 2 is DROPPED for this card - a pill
// reading ALL CLEAR beside 116.75 hrs pending approval reads as a
// flat claim of completion while 116 hours need a signature. Kevin's
// words: "ALL CLEAR fires only at genuinely zero, so it can be
// trusted. One unapproved hour still gets an honest pill." CIN - OH's
// 1.38 hrs from yesterday now reads THIS WEEK - accurate and calm
// without pretending it is done.
//
// Two paths only (down from round 2's three):
//   zero drafts                        -> ALL CLEAR green
//   any drafts                         -> age-based amber/red pill
//
// Age bands (only bite when there are drafts to age):
//   oldest <= 7 days                   -> THIS WEEK   amber
//   oldest 8-14 days                   -> N DAYS OLD  amber
//   oldest > 14 days                   -> N DAYS OLD  red
//   oldest_draft_date NULL but drafts  -> PENDING     amber
//     (transient state - drafts exist but derive has not repopulated
//      oldest_draft_date since v43-1 apply; renders a claim-less pill
//      until the next derive fills the date)
//
// Extracted from the JSX layer so a probe can assert the invariant
// that this classifier CANNOT return ALL CLEAR when draft_hours > 0.
// That is the assertion that stops the materiality trap recurring.
export function approvalsPill(approvalsHourly) {
  const draftHrs = approvalsHourly?.draft_hours ?? 0;
  const oldestDraftDate = approvalsHourly?.oldest_draft_date ?? null;
  if (draftHrs <= 0.004) return { state: "good", label: "ALL CLEAR" };
  if (!oldestDraftDate) return { state: "warn", label: "PENDING" };
  const then = new Date(`${oldestDraftDate}T00:00:00.000Z`);
  const now = new Date();
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.max(0, Math.floor((nowUtc - then.getTime()) / 86400000));
  if (days > 14) return { state: "bad",  label: `${days} DAYS OLD` };
  if (days > 7)  return { state: "warn", label: `${days} DAYS OLD` };
  return { state: "warn", label: "THIS WEEK" };
}

// 2026-08-26 polish round 2 item 6 - canonical period list for a
// board's range. `board.weeks[]` is populated by buildBoard for
// EVERY calendar week in [start, end], including zero-labor weeks
// where no rows exist in the underlying actuals table. That is the
// authoritative source for "what periods does this range touch."
//
// TierCStrip (per-period bar chart in StoryBlock.js) and the
// WeekTable grouping in page.js MUST derive their period list from
// this helper. The defect this fixes: prior to 2026-08-26 the chart
// counted from board.weeks[] (correct - 9 periods for CIN - OH
// FYTD) while the table counted from actuals-derived groupings
// (7 periods, because P1 and P2 had zero labor). Two components
// counting periods independently WILL diverge again the next time
// either changes - the shared derivation is the guard.
//
// Returns [{ period_no, fiscal_year, weeks_in_period }] sorted by
// period_no ascending. `weeks_in_period` = count of week rows for
// that period in board.weeks[]. Empty when board is missing or
// carries no weeks.
export function periodsInBoardWeeks(board) {
  const byPeriod = new Map();
  for (const w of board?.weeks || []) {
    if (w.period_no == null) continue;
    let cur = byPeriod.get(w.period_no);
    if (!cur) {
      cur = { period_no: w.period_no, fiscal_year: w.fiscal_year ?? 2026, weeks_in_period: 0 };
      byPeriod.set(w.period_no, cur);
    }
    cur.weeks_in_period += 1;
  }
  return [...byPeriod.values()].sort((a, b) => a.period_no - b.period_no);
}

// 2026-08-26 signal card revisions - Covers dashed line per card.
// Derived from board.weeks[] counters (closed_weeks_count,
// in_progress_week_start, not_started_weeks_count) which the server
// computes for both single_period_in_progress and multi_period ranges.
// Card-specific because coverage genuinely differs per card - one
// global string would not do. Owner ruling 2026-08-26: on Hours
// available + Payroll data, any figure inside the Covers line
// describes the hourly-only picture (already true for these copies -
// weeks are weeks - and we do not introduce worker-week counts here).
function ordinalWeekPos(closed, notStarted) {
  return (Number(closed) || 0) + 1;
}
function pluralWeeks(n) { return n === 1 ? "week" : "weeks"; }
function periodPart(board) {
  const wp = board?.weeks_in_period;
  const wr = board?.weeks_in_range;
  return wp != null ? `${wp} ${pluralWeeks(wp)} of the period`
       : wr != null ? `${wr} ${pluralWeeks(wr)} in the range`
       : "the period";
}
function coversInProgress(board, { withDraftHours } = {}) {
  const closed = board?.closed_weeks_count || 0;
  const notStarted = board?.not_started_weeks_count || 0;
  const inProgIdx = ordinalWeekPos(closed, notStarted);
  const inProg = board?.in_progress_week_start;
  const parts = [];
  if (closed > 0) parts.push(`${closed} closed ${pluralWeeks(closed)}`);
  if (inProg) parts.push(`week ${inProgIdx} in progress`);
  if (notStarted > 0 && parts.length === 0) parts.push(`${notStarted} ${pluralWeeks(notStarted)} not started`);
  let s = parts.length > 0 ? `Covers ${parts.join(" + ")}` : "Covers this period";
  if (withDraftHours) {
    const draft = withDraftHours;
    if (draft > 0.004) s += ` · ${draft.toFixed(1)} hrs not yet approved`;
  }
  return s;
}
function coversAllPeriod(board) {
  return `Covers all ${periodPart(board)}`;
}
function coversMultiInProgress(board) {
  const closed = board?.closed_weeks_count || 0;
  const total = board?.weeks_in_range || 0;
  return total > 0 ? `Covers ${closed} of ${total} weeks closed` : "Covers the range";
}
function coversWeeksRemaining(board) {
  const notStarted = board?.not_started_weeks_count || 0;
  const inProg = board?.in_progress_week_start ? 1 : 0;
  const remaining = notStarted + inProg;
  return `Covers the ${remaining} ${pluralWeeks(remaining)} remaining in this period`;
}

/**
 * Build a card-appropriate Covers string.
 * @param {object} board
 * @param {"pace"|"overtime"|"hours_available"|"payroll_data"} kindCard
 * @param {object} [opts]
 * @param {number} [opts.draftHoursHourly] - hourly-only draft hours for
 *   the Spending pace annotation. Salaried people do not clock in, so
 *   any draft hours are hourly by construction, but we require callers
 *   to pass the value they read from the pinned source so the Covers
 *   line and the pinned figure can never disagree.
 */
export function buildCoversLine(board, kindCard, opts = {}) {
  if (!board || board.applies === false) return null;
  const kind = board.kind;
  const hourlyTail = (kindCard === "hours_available" || kindCard === "payroll_data")
    ? " · Hourly only"
    : "";

  if (kindCard === "hours_available") {
    // Card only renders on single_period_in_progress; this string
    // only makes sense there. Return null anywhere else so the
    // caller does not attach a Covers line to a card that will
    // itself return null.
    if (kind !== "single_period_in_progress") return null;
    return `${coversWeeksRemaining(board)}${hourlyTail}`;
  }

  if (kindCard === "payroll_data") {
    if (kind === "single_period_in_progress" || kind === "single_period_closed") {
      return `${coversAllPeriod(board)}${hourlyTail}`;
    }
    if (kind === "multi_period") {
      // Multi-period: report the range shape rather than "all weeks
      // of the period" which would misdescribe a many-period range.
      const wr = board?.weeks_in_range;
      const s = wr != null ? `Covers all ${wr} ${pluralWeeks(wr)} in the range` : "Covers the range";
      return `${s}${hourlyTail}`;
    }
    return null;
  }

  // pace + overtime share the same in-progress / closed / multi
  // vocabulary; pace optionally appends draft-hours annotation.
  if (kind === "single_period_in_progress") {
    const draft = kindCard === "pace" ? (opts.draftHoursHourly ?? 0) : 0;
    return coversInProgress(board, kindCard === "pace" ? { withDraftHours: draft } : {});
  }
  if (kind === "single_period_closed") {
    return coversAllPeriod(board);
  }
  if (kind === "multi_period") {
    return board?.in_progress_week_start
      ? coversMultiInProgress(board)
      : (board?.weeks_in_range != null ? `Covers all ${board.weeks_in_range} ${pluralWeeks(board.weeks_in_range)} in the range` : "Covers the range");
  }
  return null;
}

// ─── Pace / Final vs budget model ─────────────────────────────────
// multi_period reads the closed-shape facts (Spent · Budget · Of
// budget used · Left unspent / Overrun) because variance is defined
// (board.js:441: variance = spent - budget with elapsed_pct = 100).
export function buildPaceCardModel(board) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date;
  const v = board?.variance;
  const verdict = board?.verdict;
  const kind = board?.kind;
  const elapsedPct = board?.elapsed_pct;
  const closedWeeks = board?.closed_weeks_count || 0;
  const weeksInRange = board?.weeks_in_range || 0;
  const inProgressWeekStart = board?.in_progress_week_start;
  const projectedEnd = board?.projected_period_end;
  const inProgress = kind === "single_period_in_progress";
  const closed = kind === "single_period_closed";
  const isMulti = kind === "multi_period";
  const closedShape = closed || isMulti;

  if (v == null || !budget) {
    return {
      state: "neutral",
      label: "—",
      eyebrow: inProgress ? "SPENDING PACE" : "FINAL VS BUDGET",
      heroMute: true,
      subMute: "no budget in range",
      facts: [
        { label: "Spent", value: spent != null ? fmt$(spent) : "—" },
        { label: "Budget", value: "—" },
      ],
    };
  }

  const under = v < 0;
  const { state, label } = pillFor(verdict);
  const eyebrow = (inProgress || isMulti) ? "SPENDING PACE" : "FINAL VS BUDGET";

  // Sub-line resolution per kind
  const rangeEnd = board?.range_end_iso || board?.period_end;
  const subLine = inProgress
    ? (Math.abs(v) < 0.5
        ? `on an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`
        : `${under ? "behind" : "ahead of"} an even burn, ${elapsedPct != null ? Math.round(elapsedPct) : "—"}% into the period`)
    : isMulti
      ? (inProgressWeekStart
          ? `${closedWeeks} of ${weeksInRange} weeks closed`
          : (rangeEnd ? `range closed through ${fmtMMDDYY(rangeEnd)}` : "range closed"))
      : "period closed";

  // In-progress facts
  const shouldBeAt = inProgress
    ? (spent != null && v != null ? spent - v : null)
    : null;
  // 2026-08-26 label swap: Projected end now shows WHERE YOU LAND (the
  // end figure); the overage / underage moves to its own fact called
  // "Vs budget" (arrow), which matches how every other card names a
  // variance. Arithmetic is unchanged; only the label carrying each
  // number changed. Owner ruling: the prior "Projected end ▲$6,873.99"
  // reads at a glance as the end number, which was the confusion.
  const projectedEndFact = inProgress
    ? (closedWeeks < 1
        ? { label: "Projected end", value: "—", sub: "needs a closed week", muted: true }
        : (projectedEnd != null
            ? { label: "Projected end", value: fmt$(projectedEnd) }
            : { label: "Projected end", value: "—", muted: true }))
    : null;
  const vsBudgetFact = inProgress
    ? (closedWeeks < 1 || projectedEnd == null
        ? { label: "Vs budget", value: "—", muted: true }
        : { label: "Vs budget", value: { shape: "arrow", v: projectedEnd - budget, size: "value" } })
    : null;
  // Closed-shape facts (fire on closed AND multi_period)
  const ofBudgetUsedPct = closedShape && budget > 0 && spent != null ? (spent / budget) * 100 : null;
  const leftUnspent = closedShape && spent != null ? budget - spent : null;
  // 2026-08-26 polish round 2 item 5 - on multi_period the hero is
  // already the signed variance and "Of budget used" is a percentage
  // expression of the same relationship, so "Left unspent" is a third
  // repetition of the same number. Replace with "Avg per week" =
  // spent / closed_weeks_count on multi_period only. Genuinely new
  // information - the figure a site leader uses to sanity-check a
  // year at a glance. single_period_closed keeps Left unspent (it is
  // NOT a duplicate of the hero there: the closed-period pace hero
  // is the arrow-signed variance, so the plain-money "Left unspent"
  // adds absolute-scale context).
  const closedWeeksForAvg = board?.closed_weeks_count || 0;
  const avgPerWeek = isMulti && closedWeeksForAvg > 0 && spent != null
    ? spent / closedWeeksForAvg
    : null;

  const facts = inProgress
    ? [
        { label: "Spent",        value: spent != null ? fmt$(spent) : "—" },
        { label: "Should be at", value: shouldBeAt != null ? fmt$(shouldBeAt) : "—" },
        projectedEndFact,
        vsBudgetFact,
      ]
    : [
        { label: "Spent",  value: spent != null ? fmt$(spent) : "—" },
        { label: "Budget", value: fmt$(budget) },
        { label: "Of budget used",
          value: ofBudgetUsedPct != null ? `${ofBudgetUsedPct.toFixed(1)}%` : "—",
          tone: ofBudgetUsedPct == null ? undefined : ofBudgetUsedPct > 100 ? "bad" : "good" },
        isMulti
          ? { label: "Avg per week", value: avgPerWeek != null ? fmt$(avgPerWeek) : "—", muted: avgPerWeek == null }
          : (leftUnspent != null && leftUnspent >= 0
              ? { label: "Left unspent", value: fmt$(leftUnspent), tone: "good" }
              : { label: "Overrun", value: leftUnspent != null ? fmt$(Math.abs(leftUnspent)) : "—", tone: "bad" }),
      ];

  return { state, label, eyebrow, subLine, heroV: v, facts };
}

// ─── HoursLeftCard model ──────────────────────────────────────────
// 2026-08-26 signal card revisions - three owner rulings folded in:
//   1. RENDER ONLY when kind === "single_period_in_progress". Absent
//      on closed periods, FYTD, last-4-weeks and any multi-period
//      range. The card's one honest sentence ("N hrs left to schedule
//      in Period M - about K a week for the R weeks remaining") only
//      works there. Prior code rendered a "HOURS VS BUDGET" variant
//      on closed periods and a hidden-only path for multi-period-
//      fully-closed; both retired.
//   2. READ from `pinnedHours` unconditionally. Never branch on the
//      salary prop. The pinning contract is enforced by the server
//      (see salaryBoard.js `pinHourlyOnly`); reading unconditionally
//      is what makes the toggle unable to reach this card by
//      construction. A conditional read is a bug waiting for someone
//      to change the condition.
//   3. Sub-line names the period ("left to schedule in Period 9",
//      not "available hours this period"). Drop `Per worker` -
//      9.86 hrs each assumes everyone works equally and no chef
//      schedules that way. Add `Weeks left` - what makes `Per week`
//      legible. Keep `Per week`, `Budget left`, `Blended rate`.
export function buildHoursLeftModel(board, pinnedHours) {
  const kind = board?.kind;
  // Ruling 1: render only on single_period_in_progress.
  if (kind !== "single_period_in_progress") return { hidden: true };
  if (!pinnedHours || pinnedHours.applies === false) return { hidden: true };

  const budget = pinnedHours.period_budget ?? pinnedHours.range_budget;
  const spent = pinnedHours.spent_to_date ?? 0;
  const rate = pinnedHours.avg_rate;
  const periodNo = board?.period_no;
  const notStarted = pinnedHours.not_started_weeks_count || 0;
  const inProgressWeek = pinnedHours.in_progress_week_start ? 1 : 0;
  const weeksRemaining = notStarted + inProgressWeek;
  const dollarsLeft = budget != null && budget > 0 ? budget - spent : null;
  const hoursLeft = (rate != null && rate > 0 && dollarsLeft != null)
    ? Math.max(0, dollarsLeft / rate)
    : null;
  const isOver = dollarsLeft != null && dollarsLeft < 0;
  const hoursOver = isOver && rate != null && rate > 0
    ? Math.abs(dollarsLeft) / rate
    : 0;

  if (budget == null || rate == null || rate <= 0) {
    return {
      state: "neutral",
      label: "—",
      eyebrow: "HOURS AVAILABLE",
      heroMute: true,
      subMute: "no budget to compare",
      facts: [
        { label: "Per week",     value: "—", muted: true },
        { label: "Weeks left",   value: `${weeksRemaining}` },
        { label: "Budget left",  value: "—" },
        { label: "Blended rate", value: rate != null ? `$${rate.toFixed(2)}/hr` : "—" },
      ],
    };
  }

  const state = "info";
  const label = "ON TARGET";
  const eyebrow = "HOURS AVAILABLE";
  const perWeek = weeksRemaining > 0 && hoursLeft != null ? hoursLeft / weeksRemaining : null;

  const hero = { shape: "hrs", value: fmtHrs(isOver ? hoursOver : (hoursLeft ?? 0)), over: isOver };
  const periodName = periodNo != null ? `Period ${periodNo}` : "this period";
  const heroSub = isOver
    ? `beyond what the budget covers this period`
    : `left to schedule in ${periodName}`;

  const facts = [
    { label: "Per week",     value: perWeek != null ? fmtHrs(perWeek) : "—", muted: perWeek == null },
    { label: "Weeks left",   value: `${weeksRemaining}` },
    { label: "Budget left",
      value: isOver
        ? { shape: "arrow", v: Math.abs(dollarsLeft), size: "value" }
        : fmt$(dollarsLeft ?? 0),
      tone: isOver ? "bad" : "good" },
    { label: "Blended rate", value: `$${rate.toFixed(2)}/hr` },
  ];

  return { state, label, eyebrow, hero, heroSub, facts };
}
