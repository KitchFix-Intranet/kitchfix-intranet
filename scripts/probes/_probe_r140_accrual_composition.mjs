#!/usr/bin/env node
// R-140 · diagnose which revenue line drives the TBR-FL vs the other
// 3 divergence. Read kpi_budgets to see period-level 2200 / 2300 /
// 2600 breakdowns per account.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("env ABSENT"); process.exit(1); }
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ACCTS = ["TBR - FL", "TBJ - FL", "CIN - AZ", "TXR - AZ"];
const q = await s
  .from("kpi_budgets")
  .select("account_key, period_no, line_code, amount")
  .eq("fiscal_year", 2026)
  .eq("period_no", 10)
  .in("account_key", ACCTS)
  .in("line_code", ["2200", "2300", "2400.1", "2400.2", "2600"]);
if (q.error) { console.error(q.error); process.exit(1); }

const byAcct = new Map();
for (const r of q.data) {
  if (!byAcct.has(r.account_key)) byAcct.set(r.account_key, {});
  byAcct.get(r.account_key)[r.line_code] = Number(r.amount);
}
console.log("TBR/TBJ/CIN-AZ/TXR-AZ P10 revenue-line budgets · kpi_budgets:");
for (const acct of ACCTS) {
  const rows = byAcct.get(acct) || {};
  const _2200 = rows["2200"] || 0;
  const _2300 = rows["2300"] || 0;
  const _2600 = rows["2600"] || 0;
  const _2400_1 = rows["2400.1"] || 0;
  const _2400_2 = rows["2400.2"] || 0;
  const accrual = _2200 + _2300 + _2600;
  const feeOnly = _2300;
  const perWeekDiff = (accrual - feeOnly) / 4;
  console.log(`  ${acct}:  2200=$${_2200}  2300=$${_2300}  2600=$${_2600}  2400.1=$${_2400_1}  2400.2=$${_2400_2}`);
  console.log(`     accrual (2200+2300+2600) = $${accrual}  ·  fee-only (2300) = $${feeOnly}`);
  console.log(`     per-week diff on a closed week: (accrual - fee) / 4 = $${perWeekDiff.toFixed(2)}`);
}
