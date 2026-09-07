#!/usr/bin/env node
// Kevin shared-period-basis PR verification (2026-09-07). Six
// acceptance items - not six fixes. These are how we know the
// extraction worked.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchOv(acct, start, end) {
  const url = start
    ? `${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`
    : `${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&range_preset=fytd`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}
async function fetchLab(acct, start, end, includeSalary = 1) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=${includeSalary}`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}
function get3100(j) {
  const p = Object.values(j.levers || {}).find(l => l.line_code === "3100") || {};
  return { actual: Number(p.actual || 0), batr: p.budget_at_this_revenue };
}
function pass(cond, msg) {
  const mark = cond ? "PASS" : "FAIL";
  console.log("  " + mark + "  " + msg);
  return cond;
}
function approxEq(a, b, tol = 0.02) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < tol;
}

let failures = 0;

console.log("\n## Item 1 · No range claims verified for a period absent from pnl_actuals");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const j = await fetchOv(acct, "2026-08-10", "2026-09-06");
  const horizon = j.range_labels?.horizon || "";
  // R-94 (2026-09-09): horizon copy changed from "P9 · awaiting
  // verification" to "P9 · closed 09/06 · figures still settling".
  // Same semantic - period is closed but not yet verified. Assert
  // via period_state (robust) with horizon copy as belt-and-braces.
  const periodState = j.period_state;
  const horizonNamesUnsettled = horizon.includes("figures still settling") || horizon.includes("awaiting verification");
  if (!pass(periodState === "closed_awaiting" && horizonNamesUnsettled, `${acct} Last period period_state="closed_awaiting" + horizon names unsettled (${horizon})`)) failures += 1;
}

console.log("\n## Item 2 · TBR - FL Last period revenue lines matching budget");
{
  const j = await fetchOv("TBR - FL", "2026-08-10", "2026-09-06");
  const revLines = (j.statement_rows || []).filter(r => r.section === "revenue");
  const matched = revLines.filter(r => r.actual != null && r.period_budget != null && Math.abs(r.actual - r.period_budget) < 0.02);
  console.log(`  found ${matched.length} matching line(s): ${matched.map(r => r.line_code).join(", ") || "(none)"}`);
  const allContractual = matched.every(r => (r.sources || []).includes("kpi_budgets_contractual_accrual"));
  if (!pass(allContractual, "all matches are R-67 contractual accruals (mathematical identity, not fallback)")) failures += 1;
}

console.log("\n## Item 3 · Labor This year total = Overview 3100 on both accounts");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const ov = await fetchOv(acct);  // fytd preset
  const p3100 = get3100(ov);
  for (const salary of [0, 1]) {
    const lab = await fetchLab(acct, "2025-12-29", "2026-09-06", salary);
    const labSpent = lab.board?.closed_spent_to_date ?? lab.board?.spent_to_date ?? 0;
    if (!pass(approxEq(p3100.actual, labSpent), `${acct} This year tog=${salary}: Ov=$${p3100.actual.toFixed(2)}  Lab=$${Number(labSpent).toFixed(2)}`)) failures += 1;
  }
}

console.log("\n## Item 4 · Panel budget = sum(week-card budgets); pill = card sign");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2026-08-10", "2026-09-06", 1);
  const panelBatr = lab.board?.budget_at_this_revenue;
  const wks = lab.board?.weeks || [];
  const sumBatr = wks.reduce((s, w) => s + (w.budget_at_this_week_revenue || 0), 0);
  if (!pass(approxEq(panelBatr, sumBatr), `${acct} panel batr $${Number(panelBatr).toFixed(2)} = sum-per-week $${sumBatr.toFixed(2)}`)) failures += 1;
  const closedVariance = lab.board?.closed_variance;
  const verdict = lab.board?.verdict;
  const cardIsUnder = closedVariance != null && closedVariance < 0;
  const pillIsGood = verdict === "on_track" || verdict === "watch";
  const cardIsOver = closedVariance != null && closedVariance > 0;
  const pillIsBad = verdict === "over";
  const pillAgrees = (cardIsUnder && pillIsGood) || (cardIsOver && pillIsBad) || (closedVariance == null);
  if (!pass(pillAgrees, `${acct} pill (${verdict}) agrees with card sign (var=$${Number(closedVariance).toFixed(2)})`)) failures += 1;
}

console.log("\n## Item 5 · Chart per-period adjusted budget = single-period view");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const ovYear = await fetchOv(acct);  // fytd preset
  const chartSeries = ovYear.chart?.series || [];
  const p9Chart = chartSeries.find(s => s.period_no === 9);
  const ovP9 = await fetchOv(acct, "2026-08-10", "2026-09-06");
  // Single-period P9 doesn't have adjusted_budget in chart series
  // (only fytd/multi has chart). Use levers 3100+3200+3400+3500 batr sum.
  // Actually the acceptance is that chart adjusted = single-period adjusted;
  // both computed the same way, per-period target x per-period revenue.
  // For a single closed period, "per-period" IS the whole range so cogs batr = per-period adjusted budget.
  const cogsAdjust = Object.values(ovP9.levers || {})
    .filter(l => ["3100", "3200", "3400", "3500"].includes(l.line_code))
    .reduce((s, l) => s + Number(l.budget_at_this_revenue || 0), 0);
  console.log(`  ${acct} P9 chart adj=$${Number(p9Chart?.adjusted_budget || 0).toFixed(2)}  single-period cogs batr sum=$${cogsAdjust.toFixed(2)}`);
  if (!pass(approxEq(p9Chart?.adjusted_budget, cogsAdjust, 1.00), `${acct} P9 chart vs single-period agree (Kevin acceptance)`)) failures += 1;
}

console.log("\n## Item 6 · P8 verified doesn't move (regression check)");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const j = await fetchOv(acct, "2026-07-13", "2026-08-09");
  const revLines = (j.statement_rows || []).filter(r => r.section === "revenue" && r.reported);
  const allFromPnl = revLines.every(r => (r.sources || []).some(s => s === "pnl_actuals"));
  if (!pass(allFromPnl, `${acct} P8 revenue reads from pnl_actuals (${revLines.length} lines)`)) failures += 1;
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
