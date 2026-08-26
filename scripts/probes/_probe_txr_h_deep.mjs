// TXR - TX - H deep dive. Pulls:
//   1. Our budgets (kpi_budgets 3100.1 + 3100.2 P1-P8)
//   2. Our hourly actuals (labor_actuals_latest amount by period)
//   3. Our salary actuals (labor_salary_actuals by week -> period)
//   4. Salaried headcount per period (distinct worker_id, presence)
//   5. Companion: CIN - AZ P5 hourly for the reclass hypothesis
//
// Emits a single JSON snapshot the report probe consumes. Aggregates
// only; no worker names, no individual pay amounts.

import { createClient } from "@supabase/supabase-js";
import { periodOf, periodStartISO, periodEndISO } from "../../src/app/kpi/labor/lib/periods.js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("env ABSENT"); process.exit(1); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const FY = 2026;
const ACCT = "TXR - TX - H";
const COMPANION = "CIN - AZ";

function n2(v) { return v == null ? null : Math.round(v * 100) / 100; }

// 1) Budgets
async function loadBudgets(acct, line) {
  const q = await supa.from("kpi_budgets")
    .select("period_no, amount")
    .eq("fiscal_year", FY)
    .eq("account_key", acct)
    .eq("line_code", line);
  if (q.error) throw new Error(`budgets ${acct} ${line}: ${q.error.message}`);
  const m = new Map();
  for (const r of q.data || []) m.set(Number(r.period_no), Number(r.amount));
  return m;
}
const budH_txr = await loadBudgets(ACCT, "3100.1");
const budS_txr = await loadBudgets(ACCT, "3100.2");

// 2) Hourly actuals - period_no is on labor_actuals_latest rows.
async function loadHourly(acct) {
  const PS = 1000;
  const per = new Map();
  let from = 0;
  while (true) {
    const q = await supa.from("labor_actuals_latest")
      .select("period_no, amount")
      .eq("fiscal_year", FY)
      .eq("account_key", acct)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_actuals ${acct}: ${q.error.message}`);
    for (const r of q.data || []) {
      const p = Number(r.period_no);
      if (p >= 1 && p <= 13) per.set(p, (per.get(p) || 0) + Number(r.amount || 0));
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return per;
}
const actH_txr = await loadHourly(ACCT);
const actH_cin = await loadHourly(COMPANION);

// 3) Salary actuals + headcount per period.
//    labor_salary_actuals is per (worker, week_start). No period_no
//    on the table - derive via periodOf(week_start).
async function loadSalaryDetail(acct) {
  const PS = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const q = await supa.from("labor_salary_actuals")
      .select("worker_id, week_start, amount")
      .eq("account_key", acct)
      .gte("week_start", "2025-12-29")
      .lte("week_start", "2026-12-27")
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`salary_actuals ${acct}: ${q.error.message}`);
    for (const r of q.data || []) rows.push(r);
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  // Aggregate per period: total $, distinct workers, per-worker week
  // counts (to detect full vs partial period presence).
  const perPeriod = new Map();
  for (const r of rows) {
    const p = periodOf(r.week_start);
    if (p == null || p < 1 || p > 13) continue;
    const inner = perPeriod.get(p) || { total: 0, workerWeeks: new Map() };
    inner.total += Number(r.amount || 0);
    const wkey = String(r.worker_id ?? "");
    inner.workerWeeks.set(wkey, (inner.workerWeeks.get(wkey) || 0) + 1);
    perPeriod.set(p, inner);
  }
  // Fold to: total, distinct_headcount, present_all_4_weeks, present_partial
  const out = new Map();
  for (const [p, v] of perPeriod) {
    let full = 0, partial = 0;
    for (const [, weekCount] of v.workerWeeks) {
      if (weekCount >= 4) full++;
      else partial++;
    }
    out.set(p, {
      total: n2(v.total),
      distinct_headcount: v.workerWeeks.size,
      present_all_4_weeks: full,
      present_partial: partial,
    });
  }
  return out;
}
const salaryDetail = await loadSalaryDetail(ACCT);

// 4) Build the report JSON.
const out = {
  account: ACCT,
  fiscal_year: FY,
  periods: {},
  companion_cin_az_hourly: {},
  salary_headcount: {},
};
for (let p = 1; p <= 8; p++) {
  out.periods[`P${p}`] = {
    period_start: periodStartISO(p),
    period_end:   periodEndISO(p),
    db_hourly_budget: n2(budH_txr.get(p) ?? null),
    db_hourly_actual: n2(actH_txr.get(p) ?? null),
    db_salary_budget: n2(budS_txr.get(p) ?? null),
    db_salary_actual: salaryDetail.get(p)?.total ?? null,
  };
  out.companion_cin_az_hourly[`P${p}`] = n2(actH_cin.get(p) ?? null);
  out.salary_headcount[`P${p}`] = salaryDetail.get(p) ?? { distinct_headcount: 0, present_all_4_weeks: 0, present_partial: 0 };
}
console.log(JSON.stringify(out, null, 2));
