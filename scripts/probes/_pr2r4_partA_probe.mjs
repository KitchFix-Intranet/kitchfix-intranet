// PR-2 R4 Part A probe.
//
// Target: TBR - FL, range 07/28/26 - 08/24/26. Kevin's report:
//   Food hero Spent       = $18,171.25
//   Food From bills       = $26,614.47
//   Food week bars        = ["no spend", "$9,169.55", "$9,001.70", "no spend", "running"]
//   Difference            = $8,443.22 which lands in the fiscal week [07/27, 08/02]
//
// Hypothesis: v_purchasing_by_site_week is filtered by `week_start >=
// '2026-07-28'` inside paginateWeekly, but the fiscal week containing
// 07/28 has week_start = '2026-07-27' - strictly less than 07/28 - so
// the whole first-fiscal-week row is dropped by the view read.
// Meanwhile paginateActuals filters by `txn_date >= '2026-07-28'`,
// so bill.com txn_dates 07/28..08/02 ARE counted in
// `billsOnlySpentForGl` (which feeds `From bills` and the route
// buckets[]).
//
// This probe measures:
//   A. v_purchasing_by_site_week read for (TBR-FL, food) with the
//      route's exact filter (week_start >= start, <= end)
//   B. purchasing_actuals bills-only for (TBR-FL, food) with route's
//      filter (txn_date >= start, <= end, source='billcom')
//   C. purchasing_actuals bills-only 07/28..08/02 slice
//   D. v_purchasing_by_site_week with LOOSENED filter that includes
//      the fiscal week that overlaps 07/28 (i.e. week_start >= 07/27)
//   E. Period-card bills-only sum (all food GL codes vs bucket bills)

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ACCOUNT = "TBR - FL";
const RANGE_START = "2026-07-28";
const RANGE_END = "2026-08-24";
const FIRST_WK_START = "2026-07-27";   // fiscal week that overlaps 07/28
const FIRST_WK_END = "2026-08-02";
const FOOD_PREFIX = "3200";

console.log("=".repeat(70));
console.log("PR-2 R4 Part A probe - TBR-FL 07/28-08/24 food arithmetic");
console.log("=".repeat(70));

// A. Weekly view - route's exact filter
{
  const q = await supa
    .from("v_purchasing_by_site_week")
    .select("week_start, week_end, gl_line_code, gl_bucket, amount, line_count, bill_count")
    .eq("account_key", ACCOUNT)
    .gte("week_start", RANGE_START)
    .lte("week_start", RANGE_END)
    .order("week_start", { ascending: true });
  if (q.error) { console.log("A err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const bySpend = new Map();
  for (const r of foodRows) {
    bySpend.set(r.week_start, (bySpend.get(r.week_start) || 0) + Number(r.amount || 0));
  }
  console.log("\nA. v_purchasing_by_site_week - route filter (week_start >= 07/28)");
  console.log("   food rows returned:", foodRows.length);
  console.log("   week_starts present:", [...bySpend.keys()].sort());
  const total = [...bySpend.values()].reduce((s, v) => s + v, 0);
  for (const [w, v] of [...bySpend.entries()].sort()) {
    console.log(`     ${w}  $${v.toFixed(2)}`);
  }
  console.log("   total food (weekly view, route filter):", "$" + total.toFixed(2));
}

// B. Bills-only from purchasing_actuals - route's exact filter
{
  const q = await supa
    .from("purchasing_actuals")
    .select("txn_date, amount, gl_line_code")
    .eq("account_key", ACCOUNT)
    .eq("source", "billcom")
    .eq("excluded", false)
    .gte("txn_date", RANGE_START)
    .lte("txn_date", RANGE_END);
  if (q.error) { console.log("B err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const total = foodRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log("\nB. purchasing_actuals bills-only (route filter txn_date >= 07/28)");
  console.log("   food rows:", foodRows.length);
  console.log("   food bills-only sum:", "$" + total.toFixed(2));
}

// C. Bills-only slice 07/28..08/02 (the missing first-week days)
{
  const q = await supa
    .from("purchasing_actuals")
    .select("txn_date, amount, gl_line_code")
    .eq("account_key", ACCOUNT)
    .eq("source", "billcom")
    .eq("excluded", false)
    .gte("txn_date", RANGE_START)
    .lte("txn_date", FIRST_WK_END);
  if (q.error) { console.log("C err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const total = foodRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log("\nC. Bills-only slice 07/28..08/02 (partial first-week days)");
  console.log("   rows:", foodRows.length, "  sum:", "$" + total.toFixed(2));
  console.log("   Kevin's arithmetic said this should be $8,443.22");
}

// D. Weekly view with LOOSENED filter (>= 07/27, week that overlaps)
{
  const q = await supa
    .from("v_purchasing_by_site_week")
    .select("week_start, gl_line_code, amount")
    .eq("account_key", ACCOUNT)
    .gte("week_start", FIRST_WK_START)
    .lte("week_start", RANGE_END)
    .order("week_start", { ascending: true });
  if (q.error) { console.log("D err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const bySpend = new Map();
  for (const r of foodRows) {
    bySpend.set(r.week_start, (bySpend.get(r.week_start) || 0) + Number(r.amount || 0));
  }
  const total = [...bySpend.values()].reduce((s, v) => s + v, 0);
  console.log("\nD. v_purchasing_by_site_week with week_start >= 07/27 (fiscal-week floor)");
  console.log("   food row count:", foodRows.length);
  for (const [w, v] of [...bySpend.entries()].sort()) {
    console.log(`     ${w}  $${v.toFixed(2)}`);
  }
  console.log("   total (whole-week 07/27-08/02 included):", "$" + total.toFixed(2));
}

// E. Full week 07/27..08/02 bills-only for food (whole fiscal week)
{
  const q = await supa
    .from("purchasing_actuals")
    .select("txn_date, amount, gl_line_code")
    .eq("account_key", ACCOUNT)
    .eq("source", "billcom")
    .eq("excluded", false)
    .gte("txn_date", FIRST_WK_START)
    .lte("txn_date", FIRST_WK_END);
  if (q.error) { console.log("E err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const total = foodRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log("\nE. Whole fiscal week 07/27-08/02 bills-only food");
  console.log("   rows:", foodRows.length, "  sum:", "$" + total.toFixed(2));
}

// F. Coded card spend for food in range (any account 3200.x source=rippling_spend)
{
  const q = await supa
    .from("purchasing_actuals")
    .select("txn_date, amount, gl_line_code")
    .eq("account_key", ACCOUNT)
    .eq("source", "rippling_spend")
    .eq("excluded", false)
    .not("gl_line_code", "is", null)
    .gte("txn_date", RANGE_START)
    .lte("txn_date", RANGE_END);
  if (q.error) { console.log("F err:", q.error.message); process.exit(2); }
  const foodRows = (q.data || []).filter(r =>
    r.gl_line_code && String(r.gl_line_code).startsWith(FOOD_PREFIX));
  const total = foodRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log("\nF. Coded card (rippling_spend) food in range 07/28-08/24");
  console.log("   rows:", foodRows.length, "  sum:", "$" + total.toFixed(2));
}

console.log("\n" + "=".repeat(70));
console.log("Kevin's ledger for reference:");
console.log("   hero Spent         = $18,171.25  (weekly-view total via route)");
console.log("   From bills         = $26,614.47  (bills-only from actuals via route)");
console.log("   From cards         = $0.00");
console.log("   bar sums           = $18,171.25  ($0 + $9,169.55 + $9,001.70 + $0 + running)");
console.log("   missing first wk   = $8,443.22   ($26,614.47 - $18,171.25)");
console.log("=".repeat(70));
