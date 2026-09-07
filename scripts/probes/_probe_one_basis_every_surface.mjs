#!/usr/bin/env node
// Kevin post-1053 sweep · PR-A (2026-09-08). One basis across every
// surface. API-level checks the client filters and displays feed off;
// DOM verification is Playwright's job. These asserts are that the
// payload SHAPE is right and the per-week adjusted basis is present +
// meaningfully different from the raw basis for the fixture cases.
//
// Items:
//   A. Labor Last period · per-week batr is populated AND differs from
//      the raw per-week (original_target). Fix must matter.
//   B. Labor This period · per-week batr populated on both confirmed
//      (past) weeks and forecast (future) weeks.
//   C. Labor This year · payload carries at least one in-progress week
//      (the row the client filters out of the table + chart).
//   D. Panel budget = sum(per-week batr) - regression check for
//      recomputeVerdictFromPanel + the WeekTable grand total.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchLab(acct, start, end, includeSalary = 1) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=${includeSalary}`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}

function pass(cond, msg) {
  const mark = cond ? "PASS" : "FAIL";
  console.log("  " + mark + "  " + msg);
  return cond;
}

let failures = 0;

console.log("\n## A · Last period · per-week batr populated + differs from raw");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2026-08-10", "2026-09-06", 1);
  const weeks = lab.board?.weeks || [];
  const closed = weeks.filter(w => w.state === "closed");
  const allHaveBatr = closed.length > 0 && closed.every(w => w.budget_at_this_week_revenue != null);
  if (!pass(allHaveBatr, `${acct} · all ${closed.length} closed weeks carry budget_at_this_week_revenue`)) failures += 1;
  const anyDiffer = closed.some(w => {
    const bawtr = Number(w.budget_at_this_week_revenue);
    const raw = Number(w.original_target);
    return Number.isFinite(bawtr) && Number.isFinite(raw) && Math.abs(bawtr - raw) > 0.5;
  });
  if (!pass(anyDiffer, `${acct} · at least one week has bawtr != original_target (fix matters)`)) failures += 1;
}

console.log("\n## B · This period · per-week batr populated on confirmed + forecast");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2026-09-07", "2026-10-04", 1);
  const weeks = lab.board?.weeks || [];
  const havingBatr = weeks.filter(w => w.budget_at_this_week_revenue != null);
  if (!pass(havingBatr.length === weeks.length && weeks.length > 0, `${acct} · every week (${weeks.length}) carries batr`)) failures += 1;
}

console.log("\n## C · This year · payload carries running-period week the client filters");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2025-12-29", "2026-10-04", 1);
  const weeks = lab.board?.weeks || [];
  const anyRunning = weeks.some(w => w.state === "in_progress");
  if (!pass(anyRunning, `${acct} · at least one week is in_progress (client drops period from table+chart)`)) failures += 1;
}

console.log("\n## D · Panel budget = sum(per-week batr) parity");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2026-08-10", "2026-09-06", 1);
  const panel = Number(lab.board?.budget_at_this_revenue || 0);
  const wks = lab.board?.weeks || [];
  const sum = wks.reduce((s, w) => s + (w.budget_at_this_week_revenue != null ? Number(w.budget_at_this_week_revenue) : 0), 0);
  const delta = Math.abs(panel - sum);
  if (!pass(delta < 0.02, `${acct} · panel $${panel.toFixed(2)} = sum $${sum.toFixed(2)} (delta $${delta.toFixed(4)})`)) failures += 1;
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
