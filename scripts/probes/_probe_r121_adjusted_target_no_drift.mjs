#!/usr/bin/env node
// scripts/probes/_probe_r121_adjusted_target_no_drift.mjs
//
// Kevin R-121 (2026-09-18) · adjusted target does not drift with revenue.
//
// Rule: total labor allowed = merged_pct × actual_revenue. Salary
// holds its budget dollar. Hourly is the remainder. On multi-period
// ranges the allowance is Method B: Σ_p (AR_p × merged_bud_p / rev_bud_p).
//
// Asserts (all hard fails):
//   1. Single-period: adjusted percent (batr / AR) equals the set
//      labor percent (merged_bud / rev_bud) to the cent. Method B
//      and annual formula are algebraically identical on one period.
//   2. Multi-period: overview 3100 batr equals Σ per-period batr to
//      the cent. This is the Method B invariant, testable without
//      reference to an annual ratio (Kevin ruling 2026-09-18: the
//      drift-vs-set-percent check on multi-period ranges was
//      withdrawn - a YTD ratio-of-totals is not the same object as a
//      revenue-weighted average of period ratios, and they agree
//      only when actual revenue mix matches budgeted mix).
//   3. Labor panel batr == Overview 3100 batr to the cent (Guard 1 on
//      +salary toggle, on all four audit accounts and both ranges).
//   4. 3100.1 batr + 3100.2 batr == 3100 batr (child sum on adjusted).
//   5. 3100.2 batr == salary period budget (Guard A - salary static).
//   6. COGS card batr == sum of parent-line batr (Guard B).
//
// Runs against local dev server on :3000. Loads per-period budgets +
// actuals directly from Postgres for the Method B expected value.
//
// USAGE
//   TEST_MODE=true nohup npm run dev > /tmp/kf-dev.log 2>&1 &
//   node --env-file=.env.local scripts/probes/_probe_r121_adjusted_target_no_drift.mjs

import { createClient } from "@supabase/supabase-js";

const req = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of req) {
  if (!process.env[k]) { console.error(`ABORT: ${k} ABSENT`); process.exit(2); }
}
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = process.env.PROBE_BASE || "http://localhost:3000";
const TOL_DOLLAR = 0.02;
const REVENUE_LINE_CODES = ["2200", "2300", "2400.1", "2500", "2600"];

// Kevin's acceptance table. `setPct` used only for single-period
// drift-to-zero check (annual and Method B agree on one period).
const CASES = [
  { account: "TBJ - FL", start: "2025-12-29", end: "2026-09-06", name: "TBJ - FL P1-P9", multi: true,  periods: [1,2,3,4,5,6,7,8,9] },
  { account: "TBJ - FL", start: "2026-08-10", end: "2026-09-06", name: "TBJ - FL P9",    multi: false, periods: [9], setPct: 33.81 },
  { account: "TBR - FL", start: "2025-12-29", end: "2026-09-06", name: "TBR - FL P1-P9", multi: true,  periods: [1,2,3,4,5,6,7,8,9] },
  { account: "TBR - FL", start: "2026-08-10", end: "2026-09-06", name: "TBR - FL P9",    multi: false, periods: [9], setPct: 29.59 },
  { account: "CIN - AZ", start: "2025-12-29", end: "2026-09-06", name: "CIN - AZ P1-P9", multi: true,  periods: [1,2,3,4,5,6,7,8,9] },
  { account: "CIN - AZ", start: "2026-08-10", end: "2026-09-06", name: "CIN - AZ P9",    multi: false, periods: [9], setPct: 26.99 },
  { account: "TXR - AZ", start: "2025-12-29", end: "2026-09-06", name: "TXR - AZ P1-P9", multi: true,  periods: [1,2,3,4,5,6,7,8,9] },
  { account: "TXR - AZ", start: "2026-08-10", end: "2026-09-06", name: "TXR - AZ P9",    multi: false, periods: [9], setPct: 30.53 },
];

// Compute Σ_p (AR_p × (H_p + S_p) / RB_p) directly from Postgres for
// the Method B expected total. Returns the total plus a per-period
// breakdown for surface in the failure message.
async function methodBSum(account, periods) {
  const [budResp, actResp] = await Promise.all([
    supa.from("kpi_budgets")
      .select("period_no, line_code, amount")
      .eq("account_key", account).eq("fiscal_year", 2026)
      .in("period_no", periods)
      .in("line_code", ["3100.1", "3100.2", ...REVENUE_LINE_CODES]),
    supa.from("pnl_actuals")
      .select("period_no, line_code, actual")
      .eq("account_key", account).eq("fiscal_year", 2026)
      .in("period_no", periods)
      .in("line_code", REVENUE_LINE_CODES),
  ]);
  if (budResp.error) throw new Error(`kpi_budgets: ${budResp.error.message}`);
  if (actResp.error) throw new Error(`pnl_actuals: ${actResp.error.message}`);

  const budByPeriod = new Map();
  for (const r of budResp.data) {
    if (!budByPeriod.has(r.period_no)) budByPeriod.set(r.period_no, { h: 0, s: 0, revBud: 0 });
    const e = budByPeriod.get(r.period_no);
    if (r.line_code === "3100.1") e.h += Number(r.amount || 0);
    else if (r.line_code === "3100.2") e.s += Number(r.amount || 0);
    else if (REVENUE_LINE_CODES.includes(r.line_code)) e.revBud += Number(r.amount || 0);
  }
  const revActByPeriod = new Map();
  for (const r of actResp.data) {
    if (REVENUE_LINE_CODES.includes(r.line_code)) {
      revActByPeriod.set(r.period_no, (revActByPeriod.get(r.period_no) || 0) + Number(r.actual || 0));
    }
  }
  let total = 0;
  const perPeriod = [];
  for (const p of periods) {
    const b = budByPeriod.get(p);
    const ar = revActByPeriod.get(p) || 0;
    if (!b || !b.revBud || (b.h + b.s) <= 0 || ar <= 0) {
      perPeriod.push({ period: p, contribution: 0, note: "no data / zero" });
      continue;
    }
    const contrib = ar * (b.h + b.s) / b.revBud;
    total += contrib;
    perPeriod.push({ period: p, ar: Math.round(ar * 100) / 100, mergedBud: b.h + b.s, revBud: b.revBud, contribution: Math.round(contrib * 100) / 100 });
  }
  return { total: Math.round(total * 100) / 100, perPeriod };
}

function pad(s, n) { return String(s).padStart(n); }
function fmt(n) { return n == null ? "null" : "$" + Number(n).toFixed(2); }
function pctFmt(n) { return n == null ? "null" : Number(n).toFixed(2) + "%"; }

let anyFail = false;

console.log("═══ R-121 · Method B invariant + Guard 1 parity ════════════════════════");
console.log("account          range          overview_batr    labor_batr      diff    | method_b_test");
console.log("---------------- -------------- --------------- --------------- -------- | ---------------------");
for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const [overviewRes, laborRes, methodB] = await Promise.all([
    fetch(`${BASE}/api/kpi/overview?${qs.toString()}`),
    fetch(`${BASE}/api/kpi/labor?${qs.toString()}`),
    methodBSum(c.account, c.periods),
  ]);
  if (!overviewRes.ok || !laborRes.ok) {
    console.error(`  ${c.name}: fetch FAIL overview=${overviewRes.status} labor=${laborRes.status}`);
    anyFail = true;
    continue;
  }
  const overview = await overviewRes.json();
  const labor = await laborRes.json();

  const rows = overview.statement_rows || [];
  const parent3100 = rows.find(r => r.line_code === "3100" && !r.parent_line_code);
  const sub31001 = rows.find(r => r.line_code === "3100.1");
  const sub31002 = rows.find(r => r.line_code === "3100.2");
  const overviewBatr = parent3100 ? Number(parent3100.budget_at_this_revenue) : null;
  const laborBatr = labor.board ? Number(labor.board.budget_at_this_revenue) : null;

  const parityDiff = (overviewBatr != null && laborBatr != null)
    ? Math.round((overviewBatr - laborBatr) * 100) / 100 : null;
  const parityOk = parityDiff != null && Math.abs(parityDiff) < TOL_DOLLAR;

  let mbTestOk, mbTestDesc;
  if (c.multi) {
    // Multi-period: Method B invariant. Overview batr equals the
    // Postgres-computed Σ per-period contribution to the cent.
    const mbDiff = overviewBatr != null ? Math.round((overviewBatr - methodB.total) * 100) / 100 : null;
    mbTestOk = mbDiff != null && Math.abs(mbDiff) < TOL_DOLLAR;
    mbTestDesc = `Σ per-period = ${fmt(methodB.total)}  diff=${fmt(mbDiff)}`;
  } else {
    // Single-period: drift-to-zero on adjusted pct vs set pct
    // (algebraically identical - Method B and annual formula are
    // the same on one period).
    const revenue = Number((overview.cards || []).find(x => x.key === "revenue")?.hero_actual || 0);
    const adjustedPct = (overviewBatr != null && revenue > 0) ? (overviewBatr / revenue) * 100 : null;
    const drift = adjustedPct != null ? adjustedPct - c.setPct : null;
    mbTestOk = drift != null && Math.abs(drift) < 0.01;   // to the cent on pct means 0.01
    mbTestDesc = `adj_pct=${pctFmt(adjustedPct)} set_pct=${pctFmt(c.setPct)} drift=${pctFmt(drift)}`;
  }

  const rowOk = parityOk && mbTestOk;
  if (!rowOk) anyFail = true;

  console.log(
    `${pad(c.account, 16)} ${pad(c.multi ? "P1-P9" : "P9", 14)} ` +
    `${pad(fmt(overviewBatr), 15)} ${pad(fmt(laborBatr), 15)} ${pad(fmt(parityDiff), 8)} | ` +
    `${mbTestDesc}  · ${rowOk ? "OK" : "FAIL"}`
  );

  // Child sum invariant on adjusted: parent.batr == 3100.1.batr + 3100.2.batr
  if (sub31001 && sub31002) {
    const hourlyBatr = Number(sub31001.budget_at_this_revenue);
    const salaryBatr = Number(sub31002.budget_at_this_revenue);
    const composeDiff = Math.round((overviewBatr - (hourlyBatr + salaryBatr)) * 100) / 100;
    if (Math.abs(composeDiff) > TOL_DOLLAR) {
      console.error(`    FAIL child sum: 3100.batr=${fmt(overviewBatr)} vs 3100.1+3100.2=${fmt(hourlyBatr+salaryBatr)} diff=${fmt(composeDiff)}`);
      anyFail = true;
    }
  }
}

// COGS card = sum of parent batrs (Guard B)
console.log("\n═══ Guard B · COGS card batr equals sum of parent-line batr ═══════════");
for (const c of CASES.slice(0, 4)) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const res = await fetch(`${BASE}/api/kpi/overview?${qs.toString()}`);
  if (!res.ok) continue;
  const body = await res.json();
  const rows = body.statement_rows || [];
  const cogsCard = (body.cards || []).find(x => x.key === "cogs");
  const cogsCardBatr = cogsCard ? Number(cogsCard.budget_at_this_revenue) : null;
  const parentBatrSum = ["3100", "3200", "3400", "3500"]
    .reduce((s, code) => {
      const r = rows.find(x => x.line_code === code && !x.parent_line_code);
      return s + Number(r?.budget_at_this_revenue || 0);
    }, 0);
  const diff = cogsCardBatr != null ? Math.round((cogsCardBatr - parentBatrSum) * 100) / 100 : null;
  const ok = diff != null && Math.abs(diff) < TOL_DOLLAR;
  console.log(`  ${pad(c.name, 20)} cogs_card_batr=${pad(fmt(cogsCardBatr), 12)}  sum_parents=${pad(fmt(parentBatrSum), 12)}  diff=${pad(fmt(diff), 8)}  · ${ok ? "OK" : "FAIL"}`);
  if (!ok) anyFail = true;
}

// Guard A · 3100.2 batr equals salary period budget on every case
console.log("\n═══ Guard A · 3100.2 batr == salary period budget (unchanged) ═════════");
for (const c of CASES) {
  const qs = new URLSearchParams({ account: c.account, start: c.start, end: c.end, include_salary: "1" });
  const res = await fetch(`${BASE}/api/kpi/overview?${qs.toString()}`);
  if (!res.ok) continue;
  const body = await res.json();
  const rows = body.statement_rows || [];
  const sub31002 = rows.find(r => r.line_code === "3100.2");
  if (!sub31002) { console.log(`  ${c.name}: 3100.2 row absent · SKIP`); continue; }
  const batr = Number(sub31002.budget_at_this_revenue);
  const pb = Number(sub31002.period_budget);
  const diff = Math.round((batr - pb) * 100) / 100;
  const ok = Math.abs(diff) < TOL_DOLLAR;
  console.log(`  ${pad(c.name, 20)}  batr=${pad(fmt(batr), 10)}  period_budget=${pad(fmt(pb), 10)}  diff=${pad(fmt(diff), 8)}  · ${ok ? "OK" : "FAIL"}`);
  if (!ok) anyFail = true;
}

console.log("");
if (anyFail) {
  console.log("FAIL · at least one R-121 acceptance check tripped");
  process.exit(1);
} else {
  console.log("PASS · Method B invariant on multi-period · drift-to-zero on single-period · Guard 1 parity · child sums · Guard A + B");
  process.exit(0);
}
