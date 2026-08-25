// scripts/_probe_pnl_recon_db.mjs
// Pull our numbers from Postgres for the P&L recon audit. Emits a
// JSON snapshot keyed by account_key -> P1..P8 -> { hourly_budget,
// hourly_actual, salary_budget, salary_actual }. No worker names or
// individual pay amounts leave this process; account-period aggregates
// only.

import { createClient } from "@supabase/supabase-js";
import { periodOf, periodStartISO, periodEndISO } from "../src/app/kpi/labor/lib/periods.js";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL) { console.error("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL: ABSENT"); process.exit(1); }
if (!SUPA_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(1); }
console.error("SUPABASE_URL: PRESENT");
console.error("SUPABASE_SERVICE_ROLE_KEY: PRESENT");
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const FY = 2026;

// 1) Discover account_keys present in kpi_budgets FY2026 (any 3100.*
//    line). This is the universe the P&L cares about.
const acctQ = await supa
  .from("kpi_budgets")
  .select("account_key")
  .eq("fiscal_year", FY)
  .in("line_code", ["3100.1", "3100.2"]);
if (acctQ.error) { console.error("acctQ:", acctQ.error.message); process.exit(1); }
const accounts = [...new Set((acctQ.data || []).map(r => r.account_key))].sort();
console.error(`ACCOUNTS: ${accounts.length}`);

// 2) Budgets 3100.1 + 3100.2 for all accounts x P1..P8.
async function loadBudgets(line_code) {
  const q = await supa
    .from("kpi_budgets")
    .select("account_key, period_no, amount")
    .eq("fiscal_year", FY)
    .eq("line_code", line_code)
    .in("account_key", accounts);
  if (q.error) throw new Error(`budgets ${line_code}: ${q.error.message}`);
  const map = new Map();  // acct -> period -> amount
  for (const r of q.data || []) {
    const inner = map.get(r.account_key) || new Map();
    inner.set(Number(r.period_no), Number(r.amount));
    map.set(r.account_key, inner);
  }
  return map;
}
const budH = await loadBudgets("3100.1");
const budS = await loadBudgets("3100.2");

// 3) Hourly actuals: labor_actuals_latest.amount aggregated per
//    (account, period_no). period_no is on the row (see route.js
//    L136 column list).
async function loadHourlyActuals() {
  const PS = 1000;
  const totals = new Map();  // acct -> period -> sum
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, period_no, amount")
      .eq("fiscal_year", FY)
      .in("account_key", accounts)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_actuals_latest: ${q.error.message}`);
    for (const r of q.data || []) {
      const inner = totals.get(r.account_key) || new Map();
      const p = Number(r.period_no);
      if (p >= 1 && p <= 13) {
        inner.set(p, (inner.get(p) || 0) + Number(r.amount || 0));
      }
      totals.set(r.account_key, inner);
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return totals;
}
const actH = await loadHourlyActuals();

// 4) Salary actuals: labor_salary_actuals per (account, week_start).
//    No period_no on the table - derive from week_start via periodOf().
async function loadSalaryActuals() {
  const PS = 1000;
  const totals = new Map();
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_salary_actuals")
      .select("account_key, week_start, amount")
      .in("account_key", accounts)
      .gte("week_start", "2025-12-29")   // FY2026 start
      .lte("week_start", "2026-12-27")   // FY2026 end
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`labor_salary_actuals: ${q.error.message}`);
    for (const r of q.data || []) {
      const p = periodOf(r.week_start);
      if (p == null || p < 1 || p > 13) continue;
      const inner = totals.get(r.account_key) || new Map();
      inner.set(p, (inner.get(p) || 0) + Number(r.amount || 0));
      totals.set(r.account_key, inner);
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return totals;
}
const actS = await loadSalaryActuals();

// 5) Emit unified per-account snapshot.
function n(v) { return v == null ? null : Math.round(v * 100) / 100; }
const out = {};
for (const acct of accounts) {
  const perPeriod = {};
  for (let p = 1; p <= 8; p++) {
    perPeriod[`P${p}`] = {
      period_start: periodStartISO(p),
      period_end:   periodEndISO(p),
      hourly_budget: n(budH.get(acct)?.get(p) ?? null),
      hourly_actual: n(actH.get(acct)?.get(p) ?? null),
      salary_budget: n(budS.get(acct)?.get(p) ?? null),
      salary_actual: n(actS.get(acct)?.get(p) ?? null),
    };
  }
  out[acct] = perPeriod;
}
console.log(JSON.stringify(out, null, 2));
