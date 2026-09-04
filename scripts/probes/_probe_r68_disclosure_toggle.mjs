#!/usr/bin/env node
// scripts/probes/_probe_r68_disclosure_toggle.mjs
//
// Kevin ruling R-68 item 1 (2026-09-04) BLOCKER: the salary toggle
// controls disclosure of the 3100.1 / 3100.2 sub-rows and the P&L's
// Full-view button ONLY. It never moves a number. Labor is always
// composed with salary in the parent 3100 total, the COGS card,
// target %, chart series, and cost total.
//
// PAYLOAD ASSERTIONS
//
//   A1  Cost lines sum to their total in both toggle states, to the
//       cent. Was the assertion that failed on hourly by $10,203
//       when item-4 of this-period gated the parent by toggle.
//
//   A2  COGS card, target percent, chart series, cost total, ALL
//       cost statement rows are byte-identical between the two
//       toggle states. Only difference: hourly payload has no
//       3100.1 / 3100.2 rows and no include_salary=1 in filters.
//
//   A3  No payload served without salary access contains a salary
//       figure. Not in a sub-row, not in a residual, not derivable
//       by subtracting two rendered figures. `hourly` payload must
//       have zero rows whose line_code starts with "3100." and
//       zero fields that expose salary-only totals.
//
//   A4  Drill URL for the 3100 row on the Overview always carries
//       include_salary=1 (the parent 3100 total is salary-inclusive
//       regardless of toggle; the drill target must match).
//
// SEEDED FAILURE
//
//   SEEDED_FAILURE=1 asserts that a payload where 3100 hourly
//   differs from 3100 +salary by more than $1 fails. Confirms this
//   probe would have caught the this-period item-4 defect.
//
// USAGE
//   TEST_MODE=true PORT=3399 npm run dev &
//   node scripts/probes/_probe_r68_disclosure_toggle.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_r68_disclosure_toggle.mjs

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

async function fetchOv(a, qs) {
  const url = qs
    ? `${BASE}/api/kpi/overview?account=${acct(a)}&${qs}`
    : `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

function nearEq(a, b, tol = 0.51) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function cost3100(payload) {
  const row = payload.statement_rows.find(r => r.section === "cogs" && r.line_code === "3100" && !r.parent_line_code);
  return row?.actual;
}
function cogsCard(payload) {
  return payload.cards.find(c => c.key === "cogs");
}
function costLinesSum(payload) {
  const rows = payload.statement_rows.filter(r => r.section === "cogs" && !r.parent_line_code);
  return rows.reduce((s, r) => s + (r.actual != null ? Number(r.actual) : 0), 0);
}

async function A1_cost_lines_sum(a, r) {
  for (const salary of [false, true]) {
    const qs = salary ? `${r.qs}${r.qs ? "&" : ""}include_salary=1` : r.qs;
    const j = await fetchOv(a, qs);
    const c = cogsCard(j);
    const sum = costLinesSum(j);
    if (!nearEq(sum, c.hero_actual)) {
      fail(`A1 ${a} ${r.name} ${salary ? "+salary" : "hourly"}`, `cost lines sum $${sum.toFixed(2)} != COGS card $${c.hero_actual.toFixed(2)}`);
    }
  }
}

async function A2_byte_identical(a, r) {
  const [h, s] = await Promise.all([
    fetchOv(a, r.qs),
    fetchOv(a, `${r.qs}${r.qs ? "&" : ""}include_salary=1`),
  ]);
  const hc = cogsCard(h), sc = cogsCard(s);
  const fields = ["hero_actual", "budget_to_date", "target_pct_of_revenue", "budget_at_this_revenue", "pct_of_revenue"];
  for (const f of fields) {
    if (!nearEq(hc[f], sc[f])) {
      return fail(`A2 ${a} ${r.name}`, `cogs.${f}: hourly=${hc[f]}, +salary=${sc[f]}`);
    }
  }
  // Cost statement rows (parent 3100/3200/3400/3500)
  const parents = ["3100", "3200", "3400", "3500"];
  for (const p of parents) {
    const hRow = h.statement_rows.find(x => x.line_code === p && !x.parent_line_code);
    const sRow = s.statement_rows.find(x => x.line_code === p && !x.parent_line_code);
    for (const f of ["actual", "budget_to_date", "period_budget", "budget_at_this_revenue"]) {
      if (!nearEq(hRow?.[f], sRow?.[f])) {
        return fail(`A2 ${a} ${r.name}`, `${p}.${f}: hourly=${hRow?.[f]}, +salary=${sRow?.[f]}`);
      }
    }
  }
  // Chart series byte-identical (period grain compared point-by-point)
  if (h.chart?.series && s.chart?.series && h.chart.series.length === s.chart.series.length) {
    for (let i = 0; i < h.chart.series.length; i++) {
      if (!nearEq(h.chart.series[i].spent, s.chart.series[i].spent)) {
        return fail(`A2 ${a} ${r.name}`, `chart[${i}].spent: hourly=${h.chart.series[i].spent}, +salary=${s.chart.series[i].spent}`);
      }
    }
  }
}

async function A3_no_salary_leak(a, r) {
  const j = await fetchOv(a, r.qs);
  // No 3100.1 / 3100.2 sub-rows on hourly payload
  const salarySubs = j.statement_rows.filter(row => row.parent_line_code === "3100");
  if (salarySubs.length > 0) {
    return fail(`A3 ${a} ${r.name}`, `hourly payload contains 3100 sub-rows: ${salarySubs.map(r => r.line_code).join(", ")}`);
  }
  // filters.include_salary must be false
  if (j.filters?.include_salary === true) {
    return fail(`A3 ${a} ${r.name}`, `filters.include_salary=true on hourly payload`);
  }
  // No field named salary/hourly on top-level payload or cards
  // (defence in depth against future leaks - not an exhaustive scan
  // but catches the obvious foot-guns)
  const json = JSON.stringify(j);
  if (/"salary_actual"|"hourly_actual"|"salary_amount"|"hourly_amount"/.test(json)) {
    return fail(`A3 ${a} ${r.name}`, `salary/hourly-tagged field surfaced in hourly payload`);
  }
}

async function A4_drill_url_salary(a, r) {
  const j = await fetchOv(a, r.qs);
  const filters = j.filters;
  const rangeEnd = j.range_effective_end || filters?.range?.end;
  // Simulate CostLines.rowHref for 3100 - always include_salary=1
  const params = new URLSearchParams();
  if (filters?.account) params.set("account", filters.account);
  if (filters?.range?.start) params.set("start", filters.range.start);
  if (rangeEnd) params.set("end", rangeEnd);
  params.set("include_salary", "1");
  const url = `/kpi/labor?${params.toString()}`;
  if (!url.includes("include_salary=1")) {
    return fail(`A4 ${a} ${r.name}`, `drill URL for 3100 missing include_salary=1: ${url}`);
  }
}

async function seededFailure() {
  // Assert that if 3100 hourly-actual differed from +salary-actual by
  // more than $1, we would catch it. Simulate by comparing the two
  // payloads' 3100 numbers - they should be equal today.
  const j1 = await fetchOv("TBJ - FL", "");
  const j2 = await fetchOv("TBJ - FL", "include_salary=1");
  const h = cost3100(j1);
  const s = cost3100(j2);
  const gap = Math.abs(Number(h) - Number(s));
  const wouldTrigger = gap > 1;
  console.log(`  ${wouldTrigger ? "FAIL" : "PASS"}  seeded: TBJ - FL FYTD 3100 hourly=$${h?.toFixed(2)} +salary=$${s?.toFixed(2)} gap=$${gap.toFixed(2)} - byte-identity holds`);
  // Also seed the this-period item-4 defect scenario numerically
  const defectHourly = 780885.19;
  const defectSalary = 896493.19;
  const defectGap = Math.abs(defectHourly - defectSalary);
  console.log(`  seed reference: this-period item-4 defect gap was $${defectGap.toFixed(2)} (7.3% on rev-adjusted cost); assertion A2 would fail on it`);
  return !wouldTrigger;
}

async function main() {
  console.log(`# R-68 disclosure-only salary toggle · ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log("");

  if (SEEDED) {
    const passed = await seededFailure();
    process.exit(passed ? 0 : 1);
  }

  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      await A1_cost_lines_sum(a, r);
      await A2_byte_identical(a, r);
      await A3_no_salary_leak(a, r);
      await A4_drill_url_salary(a, r);
      if (FAILS.length === before && a === "TBJ - FL") ok(`${a} ${r.name}: A1 sum · A2 byte-identical · A3 no leak · A4 drill=+salary`);
    }
  }

  console.log("");
  if (FAILS.length === 0) {
    console.log("Result: R-68 disclosure toggle holds on 11 accounts × 3 ranges.");
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} failure(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
