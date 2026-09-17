// Stage 0 pre/post baseline. Counts + PASS/FAIL only. No amounts.
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_p9_prepost.mjs
//
// Prints:
//   - FY2026 pnl_actuals total row count
//   - FY2026 pnl_actuals per-period distinct-account count (P1..P13)
//   - kpi_period_status FY2026 P8 + P9 (verified_* + closed_at fields)

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { count: total, error: totalErr } = await supa
  .from("pnl_actuals")
  .select("*", { count: "exact", head: true })
  .eq("fiscal_year", 2026);
if (totalErr) throw totalErr;
console.log(`FY2026 pnl_actuals total rows: ${total}`);

const { data: perPeriod, error: ppErr } = await supa
  .from("pnl_actuals")
  .select("period_no, account_key")
  .eq("fiscal_year", 2026);
if (ppErr) throw ppErr;

const perP = new Map();
for (const r of perPeriod) {
  if (!perP.has(r.period_no)) perP.set(r.period_no, new Set());
  perP.get(r.period_no).add(r.account_key);
}
console.log("\nFY2026 pnl_actuals distinct accounts per period:");
for (let p = 1; p <= 13; p += 1) {
  const n = perP.get(p)?.size ?? 0;
  console.log(`  P${String(p).padStart(2)}: ${n} accounts`);
}

const { data: kps, error: kpsErr } = await supa
  .from("kpi_period_status")
  .select("*")
  .eq("fiscal_year", 2026)
  .in("period_no", [8, 9])
  .order("period_no");
if (kpsErr) throw kpsErr;
console.log("\nkpi_period_status FY2026 P8 + P9:");
for (const r of kps) {
  console.log(`  P${r.period_no}: closed_at=${r.closed_at ?? "NULL"}  verified_at=${r.verified_at ?? "NULL"}  verified_by=${r.verified_by ?? "NULL"}  source_ref=${r.source_ref ? "PRESENT" : "NULL"}`);
}

const { count: p1p8, error: p18Err } = await supa
  .from("pnl_actuals")
  .select("*", { count: "exact", head: true })
  .eq("fiscal_year", 2026)
  .gte("period_no", 1)
  .lte("period_no", 8);
if (p18Err) throw p18Err;
console.log(`\nFY2026 P1-P8 total rows: ${p1p8}`);

const { count: p9, error: p9Err } = await supa
  .from("pnl_actuals")
  .select("*", { count: "exact", head: true })
  .eq("fiscal_year", 2026)
  .eq("period_no", 9);
if (p9Err) throw p9Err;
console.log(`FY2026 P9 total rows: ${p9}`);
