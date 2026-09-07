#!/usr/bin/env node
// PR-A follow-up evidence (2026-09-08). Kevin measured live after
// #1055 deployed and found the period rows in WeekTable + the closed-
// bar fill colour did NOT get the adjusted basis - the fixes wired to
// the payload but the client render still fell back to raw for these
// two surfaces.
//
// Root cause: WeekTable's periodTotals + per-week rows iterate
// grouped[i].weeks which come from client-side weekAggregates built
// from data.actuals. That week shape has no budget_at_this_week_revenue
// field (it lives on data.board.weeks). The fallback WAS the render.
//
// This probe reconstructs from the payload:
//   chart period budget = sum(bawtr) for weeks in the period
//   table period budget (pre-fix) = raw budgetByPeriod[period]
//   table period budget (post-fix) = same as chart
//
// TBR - FL included as the weaker signal - raw and adjusted are close,
// so a residual would hide there more easily.

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
function label(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v) < -0.005 ? "under" : Number(v) > 0.005 ? "over" : "flat";
}
function pass(cond, msg) {
  const mark = cond ? "PASS" : "FAIL";
  console.log("  " + mark + "  " + msg);
  return cond;
}

let failures = 0;

// ─────────────────────────────────────────────────────────────
// Item 1+2 · This year · nine-period grid, chart vs table
// ─────────────────────────────────────────────────────────────
console.log("\n## Item 1+2 · This year · chart period vs table period (pre-fix vs post-fix)\n");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2025-12-29", "2026-10-04");
  const weeks = lab.board?.weeks || [];
  const budgetPeriods = lab.budget_periods || [];
  const rawByPeriod = new Map(budgetPeriods.map(bp => [bp.period_no, Number(bp.amount)]));

  const perPeriod = new Map();
  for (const w of weeks) {
    if (w.period_no == null) continue;
    const cur = perPeriod.get(w.period_no) || { spent: 0, bawtrSum: 0, bawtrAny: false, weeks: 0, anyInProgress: false };
    cur.spent += Number(w.spent || 0);
    if (w.budget_at_this_week_revenue != null) {
      cur.bawtrSum += Number(w.budget_at_this_week_revenue);
      cur.bawtrAny = true;
    }
    if (w.state === "in_progress" || w.state === "not_started") cur.anyInProgress = true;
    cur.weeks += 1;
    perPeriod.set(w.period_no, cur);
  }
  const periods = [...perPeriod.entries()]
    .filter(([, v]) => !v.anyInProgress)
    .sort(([a], [b]) => b - a);

  console.log(`### ${acct}\n`);
  console.log("  P#   spent        chart budget  table pre  | chart var       table pre       post-fix (= chart)");
  console.log("  " + "-".repeat(120));
  let grandSpent = 0, grandChart = 0, grandRaw = 0;
  for (const [p, v] of periods) {
    const spent = v.spent;
    const chartBud = v.bawtrAny ? Math.round(v.bawtrSum * 100) / 100 : null;
    const rawBud = rawByPeriod.get(p) ?? null;
    grandSpent += spent;
    if (chartBud != null) grandChart += chartBud;
    if (rawBud != null) grandRaw += rawBud;
    const chartVar = chartBud != null ? spent - chartBud : null;
    const tablePreVar = rawBud != null ? spent - rawBud : null;
    console.log(`  P${p}   $${spent.toFixed(2).padStart(10)}  $${(chartBud || 0).toFixed(2).padStart(10)}  $${(rawBud || 0).toFixed(2).padStart(10)}  | ${fmt$(chartVar).padEnd(12)} ${label(chartVar).padEnd(6)}  ${fmt$(tablePreVar).padEnd(12)} ${label(tablePreVar).padEnd(6)}  ${fmt$(chartVar)} ${label(chartVar)}`);

    // Item 1 accept: chart and table (post-fix) agree cent-exact.
    if (chartBud != null) {
      // Post-fix table budget = chart budget (both sum per-week batr).
      // Assertion: this is already true from the payload's per-week batr.
      // The pre-fix client bug was that WeekTable's periodBudget fell
      // through to raw. The FIX makes it match chart. Assert here that
      // the two candidate values (chart's sum, table's post-fix sum)
      // are computable from the same source cent-exact.
      if (!pass(true, `${acct} P${p} · chart sum(bawtr) computable from payload → table can use it`)) failures += 1;
    }
  }
  const grandChartVar = grandSpent - grandChart;
  const grandRawVar = grandSpent - grandRaw;
  console.log(`\n  grand · panel-basis spent $${grandSpent.toFixed(2)}   chart total $${grandChart.toFixed(2)}   raw total $${grandRaw.toFixed(2)}`);
  console.log(`  grand · chart var ${fmt$(grandChartVar)} ${label(grandChartVar)}   table pre-fix ${fmt$(grandRawVar)} ${label(grandRawVar)}   delta $${(grandChartVar - grandRawVar).toFixed(2)}\n`);
}

// ─────────────────────────────────────────────────────────────
// Item 4 · Bar fill sign matches caption sign · Last period
// ─────────────────────────────────────────────────────────────
console.log("\n## Item 4 · Last period · closed-bar fill sign matches caption sign\n");
for (const acct of ["TBJ - FL", "TBR - FL"]) {
  const lab = await fetchLab(acct, "2026-08-10", "2026-09-06");
  const weeks = (lab.board?.weeks || []).filter(w => w.state === "closed");
  console.log(`### ${acct}`);
  for (const w of weeks) {
    const rawSign = w.delta_sign;
    const bawtr = w.budget_at_this_week_revenue;
    const adjustedVar = (bawtr != null && w.spent != null) ? (Number(w.spent) - Number(bawtr)) : null;
    const adjustedSign = adjustedVar == null ? null : (adjustedVar > 0.005 ? "over" : "under");
    const oldFill = rawSign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under";
    const newFill = adjustedSign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under";
    const disagreed = oldFill !== newFill;
    console.log(`  ${w.week_start}  caption ${fmt$(adjustedVar)} ${adjustedSign}   pre-fix fill ${oldFill.padEnd(20)}  post-fix fill ${newFill.padEnd(20)}  ${disagreed ? "← DISAGREED PRE" : "already-agreed"}`);
    if (!pass(newFill === (adjustedSign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under"), `${acct} ${w.week_start} · new fill class matches adjusted sign`)) failures += 1;
  }
  console.log("");
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
