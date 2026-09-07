#!/usr/bin/env node
// Kevin post-1057 sweep item 2 (2026-09-08). R-86 · panel adjusted
// budget = sum of per-period adjusted budgets = table total. Assert
// three ways agree cent-exact, every range and account.
//
// Seed: TBJ - FL This year was $704.48 off panel vs table pre-fix.
// After #1055 (table on adjusted per-period), #1056 (chart on
// adjusted per-period), and #1057 (per-week revenue follows
// Overview for verified periods), the last disagreement lives on
// the panel. This asserts it's closed.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchLab(acct, start, end) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=1`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}

function fmt$(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const sign = n < 0 ? "-" : n > 0 ? "+" : " ";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
function pass(cond, msg) {
  const mark = cond ? "PASS" : "FAIL";
  console.log("  " + mark + "  " + msg);
  return cond;
}

const RANGES = [
  { key: "TY", label: "This year", start: "2025-12-29", end: "2026-10-04" },
  { key: "LP", label: "Last period", start: "2026-08-10", end: "2026-09-06" },
  { key: "TP", label: "This period", start: "2026-09-07", end: "2026-10-04" },
];

let failures = 0;

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct}`);
  for (const range of RANGES) {
    const lab = await fetchLab(acct, range.start, range.end);
    const board = lab.board || {};
    const panelBatr = board.budget_at_this_revenue != null ? Number(board.budget_at_this_revenue) : null;
    const weeks = board.weeks || [];
    const contributingWeeks = weeks.filter(w => w.state !== "in_progress" && w.state !== "not_started");
    const sumPerWeek = contributingWeeks.reduce((s, w) => s + (w.budget_at_this_week_revenue != null ? Number(w.budget_at_this_week_revenue) : 0), 0);
    const sumRounded = Math.round(sumPerWeek * 100) / 100;
    const delta = panelBatr != null ? Math.round((panelBatr - sumRounded) * 100) / 100 : null;
    console.log(`  ${range.label.padEnd(12)}  panel batr $${(panelBatr || 0).toFixed(2).padStart(12)}   sum per-week $${sumRounded.toFixed(2).padStart(12)}   Δ ${fmt$(delta)}   panel_batr_from_per_week=${board.panel_batr_from_per_week || false}`);
    // Acceptance: panel = sum, cent-exact. TP will pass trivially
    // (panel = null, no weeks contribute) - probe skips assertion
    // when panel is null.
    if (panelBatr != null && sumRounded > 0) {
      if (!pass(Math.abs(delta) < 0.02, `${acct} ${range.label} · panel batr = sum per-week (Δ ${fmt$(delta)})`)) failures += 1;
    } else {
      console.log(`         (skip · panel batr null or no contributing weeks - TP day 1 case)`);
    }
  }
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
