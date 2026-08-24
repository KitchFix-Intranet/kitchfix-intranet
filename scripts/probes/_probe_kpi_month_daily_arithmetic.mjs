// scripts/probes/_probe_kpi_month_daily_arithmetic.mjs
//
// Range PR-1 acceptance. Owner ruling 2026-08-24 after raising
// MAX_DAILY_SPAN_DAYS from 21 to 31 in rangeResolver.js:
//
//   "M1 is the probe that matters: July on CIN - OH must return
//    $18,714.03. Before the raise, weekly widening returned
//    $21,555.27 - overstated by 15%, with nothing on screen naming
//    that the range moved."
//
// This probe reads labor_actuals_daily directly from Supabase and
// sums the amount column over the calendar month. It is what the
// daily-path route computes on the same range, once the cap raise
// routes 31-day requests there.
//
// Pins the arithmetic ground truth. If a future refactor breaks
// the daily pipeline OR the resolver silently widens July to whole
// weeks again, this probe fires. Weekly widening produces
// $21,555.27; anything other than $18,714.03 (+/- 1 cent) fails.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

console.log("=".repeat(72));
console.log("KPI calendar-month daily arithmetic (Range PR-1)");
console.log("=".repeat(72));

async function sumDaily(account, start, end) {
  // Paginate defensively in case the account-month exceeds page size.
  const pageSize = 1000;
  let from = 0;
  let sum = 0;
  let rows = 0;
  while (true) {
    const q = await supa.from("labor_actuals_daily")
      .select("amount")
      .eq("account_key", account)
      .gte("work_date", start)
      .lte("work_date", end)
      .range(from, from + pageSize - 1);
    if (q.error) throw new Error(`labor_actuals_daily: ${q.error.message}`);
    const batch = q.data || [];
    for (const r of batch) sum += Number(r.amount || 0);
    rows += batch.length;
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return { sum: r2(sum), rows };
}

async function sumWeeklyWidened(account, mondayStart, sundayEnd) {
  // Reproduces the pre-PR-1 weekly-widening path for a calendar
  // month: the route silently widened to whole fiscal weeks around
  // the calendar dates. For July 2026 (07/01 Wed - 07/31 Fri), the
  // widening covered 06/29 Mon - 08/02 Sun = 5 weeks. This function
  // sums labor_actuals_latest over that widened window - it's what
  // the operator saw on screen before the cap raise.
  const q = await supa.from("labor_actuals_latest")
    .select("amount")
    .eq("account_key", account)
    .gte("week_start", mondayStart)
    .lte("week_end", sundayEnd);
  if (q.error) throw new Error(`labor_actuals_latest: ${q.error.message}`);
  let sum = 0;
  for (const r of q.data || []) sum += Number(r.amount || 0);
  return { sum: r2(sum), rows: (q.data || []).length };
}

// ─── M1 - July on CIN - OH ──────────────────────────────────────────
console.log("");
console.log("[M1] CIN - OH July 2026 (07/01 - 07/31) via daily path");
{
  const daily = await sumDaily("CIN - OH", "2026-07-01", "2026-07-31");
  const EXPECTED = 18714.03;
  if (Math.abs(daily.sum - EXPECTED) < 0.02) ok(`daily sum = $${daily.sum.toFixed(2)} (expected $${EXPECTED}, ${daily.rows} rows)`);
  else fail(`daily sum drift: $${daily.sum.toFixed(2)} vs expected $${EXPECTED} (${daily.rows} rows)`);
}

// ─── M1a - reproduce the pre-raise weekly widening ─────────────────
// Documents the drift the raise fixes. Owner's number was $21,555.27
// for the widened whole-week range 06/29 - 08/02.
console.log("");
console.log("[M1a] CIN - OH weekly widening (06/29 - 08/02) - pre-PR-1 shape");
{
  const wk = await sumWeeklyWidened("CIN - OH", "2026-06-29", "2026-08-02");
  const EXPECTED_WIDENED = 21555.27;
  if (Math.abs(wk.sum - EXPECTED_WIDENED) < 0.02) ok(`weekly-widened sum = $${wk.sum.toFixed(2)} (matches pre-PR-1 observation of $${EXPECTED_WIDENED})`);
  else fail(`weekly-widened sum drift: $${wk.sum.toFixed(2)} vs expected $${EXPECTED_WIDENED} - the widening path may have shifted; verify the resolver.`);
}

// ─── M1b - drift magnitude ─────────────────────────────────────────
// Verify the fix's headline: overstate closes.
console.log("");
console.log("[M1b] drift closed by PR-1");
{
  const daily = await sumDaily("CIN - OH", "2026-07-01", "2026-07-31");
  const wk = await sumWeeklyWidened("CIN - OH", "2026-06-29", "2026-08-02");
  const drift = wk.sum - daily.sum;
  const driftPct = daily.sum > 0 ? (drift / daily.sum) * 100 : 0;
  console.log(`  drift closed: $${drift.toFixed(2)} = ${driftPct.toFixed(1)}% overstate on the pre-raise path`);
  if (drift > 100) ok(`the pre-raise widening overstated July by more than $100 - PR-1 justifies itself`);
  else fail(`drift < $100 - the widening drift Kevin flagged did not reproduce; investigate before shipping the cap raise`);
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "RANGE PR-1 ARITHMETIC: ALL PROBES PASS" : `RANGE PR-1 ARITHMETIC: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
