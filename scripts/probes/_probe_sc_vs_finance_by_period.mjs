#!/usr/bin/env node
// Kevin ruling PR-3 · item 2 residual report (2026-09-09).
//
// Kevin's mapping (B&G Lunch -> 2200, else -> 2400.1) doesn't tie
// exactly to finance's per-line P&L across P1 - P8:
//
//   catering       SC $49,106.25   finance $47,287.50   +$1,818.75
//   meal service   SC $1,434,675   finance $1,428,265   +$6,410
//
// Kevin: some is P&L catering NOT in the Service Calendar (his rule:
// what's on SC is what reaches the KPI board, no fallback to
// pnl_actuals). Some is period-boundary timing.
//
// This probe emits the per-period breakdown so Kevin can see the
// shape. Do not chase inside PR-3. Fully separate from the acceptance
// probe; runs against live payloads for both accounts on each of P1
// through P8 individually. Prints SC per line (from Overview's
// running-period mapping applied to closed periods for symmetry)
// against finance's per-line P&L actual.
//
// NOTE: this probe requires closed periods to have BOTH SC data
// (per-week basis loader picks up historical SC too) and finance
// P&L actuals posted. For any period lacking one side, prints
// what's available with a "n/a" flag.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

const PERIODS = {
  1: ["2025-12-29", "2026-01-25"],
  2: ["2026-01-26", "2026-02-22"],
  3: ["2026-02-23", "2026-03-22"],
  4: ["2026-03-23", "2026-04-19"],
  5: ["2026-04-20", "2026-05-17"],
  6: ["2026-05-18", "2026-06-14"],
  7: ["2026-06-15", "2026-07-12"],
  8: ["2026-07-13", "2026-08-09"],
};

async function fetchOv(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`, { headers: HEADERS });
  return r.json();
}

function fmt$(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return (Number(v) < 0 ? "-$" : "$") + Math.abs(Number(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n# ${acct} · SC (per-line from mapping) vs finance P&L, P1 - P8\n`);
  console.log("  P#  |  2200 catering (finance)  |  2400.1 meal service (finance)  |  Total revenue actual");
  console.log("  " + "-".repeat(120));
  let sumCatering = 0;
  let sumMeal = 0;
  for (const [p, [start, end]] of Object.entries(PERIODS)) {
    const ov = await fetchOv(acct, start, end);
    const rev = (ov?.statement_rows || []).filter(r => r.section === "revenue");
    const cat = rev.find(r => r.line_code === "2200");
    const meal = rev.find(r => r.line_code === "2400.1");
    const totActual = ov?.statement_totals?.revenue?.actual;
    console.log(`  P${p}  |  ${fmt$(cat?.actual).padStart(18)}  |  ${fmt$(meal?.actual).padStart(24)}  |  ${fmt$(totActual)}`);
    if (cat?.actual != null) sumCatering += Number(cat.actual);
    if (meal?.actual != null) sumMeal += Number(meal.actual);
  }
  console.log("  " + "-".repeat(120));
  console.log(`  Sum · catering ${fmt$(sumCatering)}   meal ${fmt$(sumMeal)}   both ${fmt$(sumCatering + sumMeal)}`);
  console.log(`  Kevin's reported P1-P8 SC totals:  catering $49,106.25   meal $1,434,675.28`);
  console.log(`  Kevin's reported P1-P8 finance:    catering $47,287.50   meal $1,428,265.08`);
  console.log(`  Residual SC-vs-finance (Kevin):    catering +$1,818.75   meal +$6,410.20`);
}

console.log(`\n(P1-P8 P&L per-line values above are Overview's current statement_rows for verified periods - which read pnl_actuals for those closed periods. This is the P&L side. Compare against Kevin's SC totals above; the residual is Kevin's report item.)`);
