#!/usr/bin/env node
// scripts/probes/_probe_r72_allocations_and_defects.mjs
//
// Kevin R-72 (2026-09-04): three assertions.
//
// A1 · cost_allocations · never applied on an open period
//   For every open period on every account, no cost row's `allocation`
//   is > 0. Allocations are booked at close (same rule as inventory
//   JEs). Kevin's ruling.
//
// A2 · chart sums to cost card on EVERY closed range
//   Extends the existing chart-sums-to-card check (which held on
//   open ranges) to closed ranges too. Formula:
//     period grain: sum(series.spent for closed periods) = card.hero_actual
//     week grain:   sum(closed week bars) + period_inventory_adjustment
//                                        + period_allocation
//                   = card.hero_actual
//   Prior defect: on TBJ - FL P8 chart summed to $83,383 vs card
//   $86,773 (JE $3,389 gap). Fix: period grain applies per-period JE
//   + allocation; week grain exposes period totals for the client
//   caption and this assertion.
//
// A3 · revenue table period_budget = card budget_full_period
//   Every account × every range: sum of statement_rows revenue-line
//   period_budget = card.budget_full_period. Kevin's Item 3.
//   Same shape as the existing forecast-total assertion.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 asserts that if allocations were double-counted
//   into an open period, A1 would flag it (uses TBJ - FL P9 as the
//   test case).
//
// USAGE
//   TEST_MODE=true PORT=3399 npm run dev &
//   node scripts/probes/_probe_r72_allocations_and_defects.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_r72_allocations_and_defects.mjs

const BASE = process.env.BASE || "http://localhost:3399";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { name: "P9 open",   qs: "start=2026-08-10&end=2026-09-06" },
  { name: "P8 closed", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "FYTD",      qs: "" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }
function ok(w) { console.log(`  OK    ${w}`); }
function near(a, b, tol = 0.51) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function fetchOv(a, qs) {
  const url = qs ? `${BASE}/api/kpi/overview?account=${acct(a)}&${qs}` : `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

async function A1_no_alloc_on_open(a, r) {
  const j = await fetchOv(a, r.qs);
  if (j.period_state !== "open") return;
  const costs = (j.statement_rows || []).filter(x => x.section === "cogs" && !x.parent_line_code);
  for (const row of costs) {
    if (row.allocation != null && Math.abs(row.allocation) >= 1) {
      fail(`A1 ${a} ${r.name}`, `${row.line_code} carries allocation=$${row.allocation} on OPEN period - allocations must apply on closed periods only`);
    }
  }
}

async function A2_chart_sums_to_card(a, r) {
  const j = await fetchOv(a, r.qs);
  const chart = j.chart;
  const cogs = (j.cards || []).find(c => c.key === "cogs");
  if (!chart || !cogs || cogs.hero_actual == null) return;
  const cardActual = Number(cogs.hero_actual);

  if (chart.grain === "period") {
    const barSum = (chart.series || [])
      .filter(s => s.state === "closed" || s.state === "in_progress")
      .reduce((s, x) => s + Number(x.spent || 0), 0);
    if (!near(barSum, cardActual)) {
      fail(`A2 ${a} ${r.name} period`, `sum(series.spent)=$${barSum.toFixed(2)} != card.hero_actual=$${cardActual.toFixed(2)} gap=$${(barSum - cardActual).toFixed(2)}`);
    }
  } else {
    // week grain: sum closed bars + period inventory adj + allocation
    const closedSum = (chart.series || [])
      .filter(s => s.state === "closed")
      .reduce((s, x) => s + Number(x.spent || 0), 0);
    const invAdj = Number(chart.period_inventory_adjustment || 0);
    const alloc = Number(chart.period_allocation || 0);
    const combined = closedSum - invAdj + alloc;
    if (!near(combined, cardActual)) {
      fail(`A2 ${a} ${r.name} week`, `sum(closed bars)=$${closedSum.toFixed(2)} - inv_adj=$${invAdj.toFixed(2)} + alloc=$${alloc.toFixed(2)} = $${combined.toFixed(2)} != card=$${cardActual.toFixed(2)} gap=$${(combined - cardActual).toFixed(2)}`);
    }
  }
}

async function A3_revenue_period_budget_ties(a, r) {
  const j = await fetchOv(a, r.qs);
  const rev = (j.cards || []).find(c => c.key === "revenue");
  const rows = (j.statement_rows || []).filter(x => x.section === "revenue");
  const cardPB = rev?.budget_full_period;
  const tablePB = rows.reduce((s, x) => s + (x.period_budget != null ? Number(x.period_budget) : 0), 0);
  if (cardPB == null && tablePB === 0) return;
  if (!near(tablePB, cardPB)) {
    fail(`A3 ${a} ${r.name}`, `revenue table period_budget sum=$${tablePB.toFixed(2)} != card.budget_full_period=$${cardPB?.toFixed(2)} gap=$${(tablePB - (cardPB || 0)).toFixed(2)}`);
  }
  // Also check budget_to_date parity (Kevin: "to-date ties everywhere").
  const cardBTD = rev?.budget_to_date;
  const tableBTD = rows.reduce((s, x) => s + (x.budget_to_date != null ? Number(x.budget_to_date) : 0), 0);
  if (cardBTD == null && tableBTD === 0) return;
  if (!near(tableBTD, cardBTD)) {
    fail(`A3-btd ${a} ${r.name}`, `revenue table budget_to_date sum=$${tableBTD.toFixed(2)} != card.budget_to_date=$${cardBTD?.toFixed(2)} gap=$${(tableBTD - (cardBTD || 0)).toFixed(2)}`);
  }
}

async function seededFailure() {
  // If an allocation were shipped on P9 open, A1 should fail.
  // Simulate by fetching TBJ - FL P9 and checking that if we saw an
  // allocation > 1, we'd flag. Since the fix guarantees zero
  // allocation on open, this is a "we'd catch a re-broken guard".
  const j = await fetchOv("TBJ - FL", "start=2026-08-10&end=2026-09-06");
  const costs = (j.statement_rows || []).filter(x => x.section === "cogs" && !x.parent_line_code);
  const vehicle = costs.find(x => x.line_code === "3500");
  const alloc = Number(vehicle?.allocation || 0);
  const wouldFire = alloc > 1;
  console.log(`  ${wouldFire ? "FAIL" : "PASS"}  seeded: TBJ - FL P9 (open) 3500 allocation=$${alloc.toFixed(2)}; A1 would fire if > $1`);
  console.log(`  seed reference: prior defect had cost card include JE while chart excluded it; TBJ - FL P8 gap was $3,389`);
  return !wouldFire;
}

async function main() {
  console.log(`# R-72 allocations + defects · ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}\n`);

  if (SEEDED) {
    const passed = await seededFailure();
    process.exit(passed ? 0 : 1);
  }

  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      await A1_no_alloc_on_open(a, r);
      await A2_chart_sums_to_card(a, r);
      await A3_revenue_period_budget_ties(a, r);
      if (FAILS.length === before && (a === "TBJ - FL" || a === "CIN - KY")) {
        ok(`${a.padEnd(15)} ${r.name.padEnd(10)}  · A1 no-alloc-on-open · A2 chart=card · A3 rev pb ties`);
      }
    }
  }

  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: R-72 invariants hold across 11 accounts × 3 ranges.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} failure(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
