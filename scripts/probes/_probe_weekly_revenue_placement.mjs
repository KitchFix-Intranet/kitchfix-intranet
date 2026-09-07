#!/usr/bin/env node
// Report before fix (2026-09-08). Weekly revenue split misplaces
// contractual accrual - Kevin measured $705 gap on TBJ - FL, chased to
// a per-period disagreement between the weekly slices and the
// Overview's per-period revenue.
//
// This probe reproduces the nine-period grid for TBJ - FL and TBR - FL
// so the shape (not just the total) is visible. TBR - FL is the
// control: no consulting revenue, so if its periods tie cleanly the
// diagnosis is contractual accrual specifically; if TBR also drifts
// the cause is broader.
//
// Payload sources:
//   weeks say  ->  sum(w.week_revenue) for weeks whose period_no === P
//                  (labor payload attaches this via attachWeeklyBasisToBoard)
//   Overview   ->  /api/kpi/overview per-period fetch, revenue_actual
//                  (uses computePeriodRevenueByLine + sumPeriodRevenue)

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

const YEAR_START = "2025-12-29";
const YEAR_END = "2026-10-04";  // through P10 end

// Period boundary map for the fetches. FY2026: 28-day blocks aligned
// to FY_START. Weeks aligned to same anchor.
const PERIOD_BOUNDS = {
  1: ["2025-12-29", "2026-01-25"],
  2: ["2026-01-26", "2026-02-22"],
  3: ["2026-02-23", "2026-03-22"],
  4: ["2026-03-23", "2026-04-19"],
  5: ["2026-04-20", "2026-05-17"],
  6: ["2026-05-18", "2026-06-14"],
  7: ["2026-06-15", "2026-07-12"],
  8: ["2026-07-13", "2026-08-09"],
  9: ["2026-08-10", "2026-09-06"],
};

async function fetchOv(acct, start, end) {
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}
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

let failures = 0;
function pass(cond, msg) {
  const mark = cond ? "PASS" : "FAIL";
  console.log("  " + mark + "  " + msg);
  return cond;
}

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct} · nine-period grid · sum(week_revenue) per period vs Overview per-period revenue\n`);

  // One This year labor fetch: gives us board.weeks with week_revenue
  // per week.
  const labYear = await fetchLab(acct, YEAR_START, YEAR_END);
  const weeks = labYear.board?.weeks || [];
  const weekRevByPeriod = new Map();
  for (const w of weeks) {
    if (w.period_no == null) continue;
    const cur = weekRevByPeriod.get(w.period_no) || { rev: 0, accrual: 0, weeks: 0 };
    cur.rev += Number(w.week_revenue || 0);
    cur.accrual += Number(w.week_contractual_accrual || 0);
    cur.weeks += 1;
    weekRevByPeriod.set(w.period_no, cur);
  }

  console.log("  P#   weeks $         Overview $         Δ (weeks - Ov)   split: contract line delta, meal line delta");
  console.log("  " + "-".repeat(150));
  let totalDelta = 0;
  for (let p = 1; p <= 9; p += 1) {
    const [ps, pe] = PERIOD_BOUNDS[p];
    const ov = await fetchOv(acct, ps, pe);
    const ovRev = Number(ov?.statement_totals?.revenue?.actual || 0);
    // Per-line breakdown for the accrual lines specifically (2200,
    // 2300, 2600). Overview's P&L vs per-week's budget diverges here.
    const perLine = new Map();
    for (const r of (ov?.statement_rows || [])) {
      if (r.section !== "revenue") continue;
      perLine.set(r.line_code, {
        actual: r.actual != null ? Number(r.actual) : null,
        budget: r.period_budget != null ? Number(r.period_budget) : null,
        source: (r.sources || []).join(","),
      });
    }
    const contractSum = ["2200", "2300", "2600"].reduce((s, lc) => {
      const e = perLine.get(lc);
      return s + (e?.actual || 0);
    }, 0);
    const mealSum = ["2400.1", "2400.2"].reduce((s, lc) => {
      const e = perLine.get(lc);
      return s + (e?.actual || 0);
    }, 0);
    const accrualLineDetail = ["2200", "2300", "2600"]
      .map(lc => {
        const e = perLine.get(lc);
        if (!e) return `${lc}:—`;
        const a = e.actual != null ? `$${e.actual.toFixed(0)}` : "—";
        const b = e.budget != null ? `$${e.budget.toFixed(0)}` : "—";
        return `${lc}=${a}/${b}`;
      })
      .join(" ");
    // Split the delta into a contract-line component and a meal-line
    // component so the two independent mechanisms are visible.
    const weekEntry = weekRevByPeriod.get(p) || { rev: 0, accrual: 0, weeks: 0 };
    const weekMeal = weekEntry.rev - weekEntry.accrual;
    const contractDelta = contractSum - weekEntry.accrual;
    const mealDelta = mealSum - weekMeal;
    const weeksSay = Math.round(weekEntry.rev * 100) / 100;
    const accrualPlaced = Math.round(weekEntry.accrual * 100) / 100;
    const delta = Math.round((weeksSay - ovRev) * 100) / 100;
    totalDelta += delta;
    const splitStr = `contract Δ ${fmt$(-contractDelta)}, meal Δ ${fmt$(-mealDelta)}`;
    console.log(`  P${p}   weeks $${weeksSay.toFixed(2).padStart(11)}   Ov $${ovRev.toFixed(2).padStart(11)}   Δ ${fmt$(delta).padStart(12)}   ${splitStr}`);
    console.log(`         ↳ ${accrualLineDetail}`);
    // Kevin acceptance (2026-09-08): per-period, cent-exact.
    // Verified periods must tie via Direction A distribution;
    // closed_awaiting periods (P9 today) already tied.
    if (!pass(Math.abs(delta) < 0.02, `${acct} P${p} · sum(week_revenue) = Overview per-period revenue (Δ ${fmt$(delta)})`)) failures += 1;
  }
  console.log(`\n  total delta (weeks minus Overview across 9 periods): ${fmt$(totalDelta)}`);
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
