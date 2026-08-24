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
  // Projected end: arrow descriptor for JSX; probe reads value !== "—"
  const projectedFact = inProgress
    ? (closedWeeks < 1
        ? { value: "—", sub: "needs a closed week", muted: true }
        : (projectedEnd != null
            ? { value: { shape: "arrow", v: projectedEnd - budget, size: "value" } }
            : { value: "—", muted: true }))
    : null;
  const leftToSpend = inProgress && spent != null ? Math.max(0, budget - spent) : null;
  // Closed-shape facts (fire on closed AND multi_period)
  const ofBudgetUsedPct = closedShape && budget > 0 && spent != null ? (spent / budget) * 100 : null;
  const leftUnspent = closedShape && spent != null ? budget - spent : null;

  const facts = inProgress
    ? [
        { label: "Spent",        value: spent != null ? fmt$(spent) : "—" },
        { label: "Should be at", value: shouldBeAt != null ? fmt$(shouldBeAt) : "—" },
        { label: "Projected end", value: projectedFact.value, sub: projectedFact.sub, muted: projectedFact.muted },
        { label: "Left to spend", value: leftToSpend != null ? fmt$(leftToSpend) : "—" },
      ]
    : [
        { label: "Spent",  value: spent != null ? fmt$(spent) : "—" },
        { label: "Budget", value: fmt$(budget) },
        { label: "Of budget used",
          value: ofBudgetUsedPct != null ? `${ofBudgetUsedPct.toFixed(1)}%` : "—",
          tone: ofBudgetUsedPct == null ? undefined : ofBudgetUsedPct > 100 ? "bad" : "good" },
        leftUnspent != null && leftUnspent >= 0
          ? { label: "Left unspent", value: fmt$(leftUnspent), tone: "good" }
          : { label: "Overrun", value: leftUnspent != null ? fmt$(Math.abs(leftUnspent)) : "—", tone: "bad" },
      ];

  return { state, label, eyebrow, subLine, heroV: v, facts };
}

// ─── HoursLeftCard model ──────────────────────────────────────────
// multi_period with running week uses in-progress shape; multi_period
// fully closed returns { hidden: true } so the parent renders null.
// Owner ruling 2026-08-24: "a card whose premise does not hold is
// absent, not zeroed."
export function buildHoursLeftModel(board, salary) {
  const budget = board?.period_budget || board?.range_budget;
  const spent = board?.spent_to_date ?? 0;
  const rate = salary?.blended_rate_hourly ?? board?.avg_rate;
  const rateBasisHourlyOnly = salary?.rate_basis === "hourly_only";
  const hoursBasisHourlyOnly = salary?.hours_basis === "hourly_only";
  const rateLabel = rateBasisHourlyOnly ? "Hourly rate" : "Blended rate";
  const workers = board?.distinct_workers ?? 0;
  const kind = board?.kind;
  const inProgress = kind === "single_period_in_progress";
  const closed = kind === "single_period_closed";
  const isMulti = kind === "multi_period";
  const notStarted = board?.not_started_weeks_count || 0;
  const weeksRemaining = (inProgress || isMulti)
    ? (board?.in_progress_week_start ? 1 : 0) + notStarted
    : 0;
  const dollarsLeft = budget != null && budget > 0 ? budget - spent : null;
  const hoursLeft = (rate != null && rate > 0 && dollarsLeft != null)
    ? Math.max(0, dollarsLeft / rate)
    : null;
  const isOver = dollarsLeft != null && dollarsLeft < 0;
  const hoursOver = isOver && rate != null && rate > 0
    ? Math.abs(dollarsLeft) / rate
    : 0;

  // Multi-period range with ZERO weeks remaining (fully closed):
  // hide entirely per owner ruling. Do not render zeros for a card
  // whose premise no longer holds.
  if (isMulti && weeksRemaining === 0) {
    return { hidden: true };
  }

  if (budget == null || rate == null || rate <= 0) {
    return {
      state: "neutral",
      label: "—",
      eyebrow: "HOURS AVAILABLE",
      heroMute: true,
      subMute: "no budget to compare",
      facts: [
        { label: "Per week",     value: "—", muted: true },
        { label: "Per worker",   value: "—", muted: true },
        { label: "Budget left",  value: "—" },
        { label: rateLabel, value: rate != null ? `$${rate.toFixed(2)}/hr` : "—" },
      ],
    };
  }

  // Shape selection: multi with running week uses in-progress shape.
  const useInProgressShape = inProgress || (isMulti && weeksRemaining > 0);
  const state = useInProgressShape ? "info" : (closed && isOver ? "bad" : "good");
  const label = closed && isOver ? "OVER" : "ON TARGET";
  const eyebrow = closed ? "HOURS VS BUDGET" : "HOURS AVAILABLE";

  const perWeek = (useInProgressShape && weeksRemaining > 0 && hoursLeft != null)
    ? hoursLeft / weeksRemaining
    : null;
  const perWorkerPerWeek = (perWeek != null && workers > 0) ? perWeek / workers : null;

  const budgetedHours = rate > 0 ? budget / rate : null;
  const usedHours = board?.hours_vs_budget?.worked ?? null;

  // Hero: descriptor for JSX; probe reads value !== "—"
  const hero = closed
    ? { shape: "arrow", v: isOver ? hoursOver : -(hoursLeft ?? 0), size: "hero", fmt: "hrs" }
    : { shape: "hrs", value: fmtHrs(isOver ? hoursOver : (hoursLeft ?? 0)), over: isOver };

  const heroSub = closed
    ? (isOver ? "beyond what the budget covered" : "under what the budget covered")
    : (isOver ? "beyond what the budget covers" : "available hours this period");

  const facts = closed
    ? [
        { label: "Budgeted", value: budgetedHours != null ? fmtHrs(budgetedHours) : "—" },
        { label: "Used",     value: usedHours != null ? fmtHrs(usedHours) : "—" },
        isOver
          ? { label: "Overrun",     value: fmtHrs(hoursOver), tone: "bad" }
          : { label: "Unused",      value: fmtHrs(hoursLeft ?? 0), tone: "good" },
        { label: rateLabel, value: `$${rate.toFixed(2)}/hr` },
      ]
    : [
        { label: "Per week",     value: perWeek != null ? fmtHrs(perWeek) : "—", muted: perWeek == null },
        { label: "Per worker",
          value: hoursBasisHourlyOnly ? "hourly only" : (perWorkerPerWeek != null ? fmtHrs(perWorkerPerWeek) : "—"),
          muted: hoursBasisHourlyOnly ? false : (perWorkerPerWeek == null) },
        { label: "Budget left",
          value: isOver
            ? { shape: "arrow", v: Math.abs(dollarsLeft), size: "value" }
            : fmt$(dollarsLeft ?? 0),
          tone: isOver ? "bad" : "good" },
        { label: rateLabel, value: `$${rate.toFixed(2)}/hr` },
      ];

  return { state, label, eyebrow, hero, heroSub, facts };
}
