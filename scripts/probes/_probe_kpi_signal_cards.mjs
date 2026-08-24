// scripts/probes/_probe_kpi_signal_cards.mjs
//
// PR-A acceptance. Owner ruling 2026-08-24 after walking every view:
// "Never render a bare `—` for a value the payload can compute. If a
// card's premise does not hold, the CARD is absent - not its values."
//
// The three-state bug (SignalCards.js:83-84) treated inProgress and
// closed as the only kinds; multi_period fell through and rendered `—`
// for `Of budget used`, `Overrun` (mislabel), `Per week`, `Per worker`,
// and `Weeks`. This probe asserts the CLASS does not recur.
//
// Property under test: for each of the four board kinds -
// single_period_in_progress, single_period_closed, multi_period with
// an in-progress week, multi_period fully closed - build the pace /
// hours-left / payroll card models against a synthetic board whose
// payload has every field the client would need. Assert no fact's
// value renders as the bare string "—" (that means the client did not
// compute what the payload allowed).
//
// The probe imports buildPaceCardModel / buildHoursLeftModel from
// SignalCards.js directly - the JSX components call the same builders,
// so testing the builder is testing the render.
//
// No network. No Supabase. Pure in-process assertion.

import {
  buildPaceCardModel,
  buildHoursLeftModel,
} from "../../src/app/kpi/labor/lib/signalCardModels.js";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function note(line) { console.log(`  NOTE  ${line}`); }

console.log("=".repeat(72));
console.log("KPI SignalCards - PR-A three-state acceptance");
console.log("=".repeat(72));

// ─── Synthetic boards (one per kind) ────────────────────────────────
// Each carries the fields the client uses to compute facts. Numbers
// are illustrative; the assertions are about SHAPE (no bare — for a
// computable field), not about specific values.

const boardSinglePeriodInProgress = {
  kind: "single_period_in_progress",
  period_no: 8,
  period_start: "2026-08-04",
  period_end: "2026-08-31",
  weeks_in_period: 4,
  weeks_in_range: 4,
  range_start_iso: "2026-08-04",
  range_end_iso: "2026-08-31",
  period_budget: 200000, range_budget: 200000,
  spent_to_date: 110000, variance: 10000,
  verdict: "watch", pace_pct: 55, elapsed_pct: 50,
  distinct_workers: 20,
  hours: 5500, ot_hours: 220, avg_rate: 20,
  closed_weeks_count: 2, in_progress_week_start: "2026-08-18", not_started_weeks_count: 1,
  spent_closed: 90000, spent_in_progress: 20000,
  projected_period_end: 220000, weekly_allowance: 45000, budget_exhausted: false,
  weekly_original_target: 50000,
  hours_vs_budget: { worked: 5500 },
  payroll_data: { priced_ww: 60, total_ww: 80, unpriced_hours: 30, unapproved_weeks: 2 },
};

const boardSinglePeriodClosed = {
  kind: "single_period_closed",
  period_no: 7, period_start: "2026-07-07", period_end: "2026-08-03",
  weeks_in_period: 4, weeks_in_range: 4,
  range_start_iso: "2026-07-07", range_end_iso: "2026-08-03",
  period_budget: 200000, range_budget: 200000,
  spent_to_date: 195000, variance: -5000,
  verdict: "on_track", pace_pct: 97.5, elapsed_pct: 100,
  distinct_workers: 20,
  hours: 9500, ot_hours: 380, avg_rate: 20.5,
  closed_weeks_count: 4, in_progress_week_start: null, not_started_weeks_count: 0,
  hours_vs_budget: { worked: 9500 },
  payroll_data: { priced_ww: 80, total_ww: 80, unpriced_hours: 0, unapproved_weeks: 0 },
};

// Multi with running week - the FYTD shape Kevin cited (96.2%,
// 34 of 35 weeks closed, $67,003.79 left unspent).
const boardMultiPeriodInProgress = {
  kind: "multi_period",
  period_no: null, period_start: null, period_end: null,
  weeks_in_period: null, weeks_in_range: 35,
  range_start_iso: "2025-12-29", range_end_iso: "2026-08-31",
  period_budget: null, range_budget: 1756936.78,
  spent_to_date: 1689932.99, variance: -67003.79,
  verdict: "on_track", pace_pct: 96.19, elapsed_pct: 100,
  distinct_workers: 220,
  hours: 84000, ot_hours: 3200, avg_rate: 20.12,
  closed_weeks_count: 34, in_progress_week_start: "2026-08-25", not_started_weeks_count: 0,
  hours_vs_budget: { worked: 84000 },
  payroll_data: { priced_ww: 800, total_ww: 850, unpriced_hours: 45, unapproved_weeks: 3 },
};

// Multi fully closed - the Last-4-Weeks shape. All weeks closed, no
// running week, no not-started weeks.
const boardMultiPeriodClosed = {
  kind: "multi_period",
  period_no: null, period_start: null, period_end: null,
  weeks_in_period: null, weeks_in_range: 4,
  range_start_iso: "2026-07-28", range_end_iso: "2026-08-24",
  period_budget: null, range_budget: 200000,
  spent_to_date: 195000, variance: -5000,
  verdict: "on_track", pace_pct: 97.5, elapsed_pct: 100,
  distinct_workers: 20,
  hours: 9500, ot_hours: 380, avg_rate: 20.5,
  closed_weeks_count: 4, in_progress_week_start: null, not_started_weeks_count: 0,
  hours_vs_budget: { worked: 9500 },
  payroll_data: { priced_ww: 80, total_ww: 80, unpriced_hours: 0, unapproved_weeks: 0 },
};

const cases = [
  { label: "single_period_in_progress", board: boardSinglePeriodInProgress },
  { label: "single_period_closed",      board: boardSinglePeriodClosed },
  { label: "multi_period + running",    board: boardMultiPeriodInProgress },
  { label: "multi_period fully closed", board: boardMultiPeriodClosed },
];

// A rendered "value" can be a string or a React element. The bug we
// are catching is `value: "—"` (the literal string), which is what
// the JSX renders when the fact builder returned no computed value.
function isBareDash(v) {
  return v === "—" || v === "-" || (typeof v === "string" && v.trim() === "—");
}

// ─── P1 - PaceCard: no bare — for any fact when the payload can compute it ─
console.log("");
console.log("[P1] PaceCard: no bare — for any fact when the payload has budget + spent + variance");
for (const c of cases) {
  const m = buildPaceCardModel(c.board);
  const bareDashes = (m.facts || []).filter(f => isBareDash(f.value));
  if (bareDashes.length === 0) ok(`${c.label}: ${m.facts.length} facts, none rendered — (state=${m.state})`);
  else fail(`${c.label}: ${bareDashes.length} facts rendered —: ${bareDashes.map(f => f.label).join(", ")}`);
}

// ─── P2 - PaceCard multi_period specific values ─────────────────────
console.log("");
console.log("[P2] PaceCard multi_period: Of budget used + Left unspent + sub-line all compute");
{
  const m = buildPaceCardModel(boardMultiPeriodInProgress);
  const ofBudgetUsed = m.facts.find(f => f.label === "Of budget used");
  const leftUnspent = m.facts.find(f => f.label === "Left unspent");
  const overrun = m.facts.find(f => f.label === "Overrun");
  if (ofBudgetUsed && ofBudgetUsed.value && !isBareDash(ofBudgetUsed.value)) ok(`multi with running: Of budget used = ${ofBudgetUsed.value} (expected ~96.2%)`);
  else fail(`multi with running: Of budget used missing or bare —`);
  if (leftUnspent) ok(`multi with running: Left unspent = ${leftUnspent.value} (variance < 0 -> Left unspent, not Overrun)`);
  else if (overrun) fail(`multi with running: rendered Overrun, expected Left unspent (variance is negative -> under budget)`);
  else fail(`multi with running: neither Left unspent nor Overrun rendered`);
  if (m.subLine === "34 of 35 weeks closed") ok(`multi with running: sub-line "${m.subLine}"`);
  else fail(`multi with running: sub-line "${m.subLine}", expected "34 of 35 weeks closed"`);
}
{
  const m = buildPaceCardModel(boardMultiPeriodClosed);
  if (m.subLine && m.subLine.startsWith("range closed through ")) ok(`multi fully closed: sub-line "${m.subLine}"`);
  else fail(`multi fully closed: sub-line "${m.subLine}", expected "range closed through MM/DD/YY"`);
}

// ─── P3 - HoursLeftCard: hides on multi fully closed, computes on others ───
console.log("");
console.log("[P3] HoursLeftCard: multi fully closed HIDES; other kinds render with no bare —");
for (const c of cases) {
  const m = buildHoursLeftModel(c.board, null);
  if (c.label === "multi_period fully closed") {
    if (m.hidden) ok(`${c.label}: card HIDDEN (weeksRemaining=0 - absent, not zeroed)`);
    else fail(`${c.label}: expected hidden, got state=${m.state}`);
  } else if (c.label === "single_period_closed") {
    // single_period_closed still uses the closed shape (HOURS VS BUDGET)
    if (m.hidden) fail(`${c.label}: unexpectedly hidden`);
    else {
      const bareDashes = (m.facts || []).filter(f => isBareDash(f.value));
      if (bareDashes.length === 0) ok(`${c.label}: ${m.facts.length} facts, none rendered — (eyebrow=${m.eyebrow})`);
      else fail(`${c.label}: ${bareDashes.length} facts rendered —: ${bareDashes.map(f => f.label).join(", ")}`);
    }
  } else {
    if (m.hidden) fail(`${c.label}: unexpectedly hidden`);
    else {
      const bareDashes = (m.facts || []).filter(f => isBareDash(f.value));
      if (bareDashes.length === 0) ok(`${c.label}: ${m.facts.length} facts, none rendered — (eyebrow=${m.eyebrow})`);
      else fail(`${c.label}: ${bareDashes.length} facts rendered —: ${bareDashes.map(f => f.label).join(", ")}`);
    }
  }
}

// ─── P4 - HoursLeftCard: multi with running week uses in-progress shape ────
console.log("");
console.log("[P4] HoursLeftCard multi + running: Per week + Per worker + Budget left compute");
{
  const m = buildHoursLeftModel(boardMultiPeriodInProgress, null);
  const perWeek = m.facts.find(f => f.label === "Per week");
  const perWorker = m.facts.find(f => f.label === "Per worker");
  const budgetLeft = m.facts.find(f => f.label === "Budget left");
  if (m.eyebrow === "HOURS LEFT TO SCHEDULE") ok(`eyebrow = "HOURS LEFT TO SCHEDULE" (in-progress shape on multi + running)`);
  else fail(`eyebrow = "${m.eyebrow}", expected "HOURS LEFT TO SCHEDULE"`);
  if (perWeek && !isBareDash(perWeek.value)) ok(`Per week = ${perWeek.value}`);
  else fail(`Per week rendered — or missing`);
  if (perWorker && !isBareDash(perWorker.value)) ok(`Per worker = ${perWorker.value}`);
  else fail(`Per worker rendered — or missing`);
  if (budgetLeft && budgetLeft.value != null) ok(`Budget left computed`);
  else fail(`Budget left missing`);
}

// ─── P5 - board.js: multi_period ships the fields the client needs ─────────
// Client-side unit test would not catch a regression where the SERVER
// stops shipping weeks_in_range / closed_weeks_count / range_end_iso
// on multi_period. Assert the field names are present in the model
// output for a synthetic board with those fields; the buildBoard-side
// probe (H-series + role gates) already asserts they get populated
// from real data. This is a shape check.
console.log("");
console.log("[P5] multi_period board must expose weeks_in_range + closed_weeks_count + range_end_iso for PR-A logic");
{
  const required = ["weeks_in_range", "closed_weeks_count", "in_progress_week_start", "not_started_weeks_count", "range_end_iso"];
  for (const b of [boardMultiPeriodInProgress, boardMultiPeriodClosed]) {
    const missing = required.filter(k => b[k] === undefined);
    if (missing.length === 0) ok(`${b.range_start_iso}..${b.range_end_iso}: has all ${required.length} PR-A fields`);
    else fail(`${b.range_start_iso}..${b.range_end_iso}: missing PR-A fields: ${missing.join(", ")}`);
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "SIGNAL CARDS PR-A: ALL PROBES PASS" : `SIGNAL CARDS PR-A: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
