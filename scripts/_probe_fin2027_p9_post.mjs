// Stage 0 post-load verify. Counts + PASS/FAIL only.
// Usage: node --env-file=.env.local scripts/_probe_fin2027_p9_post.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const check = async (label, expected, actualPromise) => {
  const actual = await actualPromise;
  const pass = actual === expected;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}: expected ${expected}, actual ${actual}`);
  return pass;
};

const rowCount = async (fq) => {
  let q = supa.from("pnl_actuals").select("*", { count: "exact", head: true }).eq("fiscal_year", 2026);
  if (fq) fq(q);
  const { count, error } = await q;
  if (error) throw error;
  return count;
};

console.log("Stage 0 verify · FY2026 P9 load");
console.log("");

let ok = true;
ok = (await check("FY2026 total rows == 3167 (2815 baseline + 352 P9)", 3167, rowCount())) && ok;
ok = (await check("FY2026 P1..P8 rows == 2815 (baseline unchanged)", 2815,
  supa.from("pnl_actuals").select("*", { count: "exact", head: true }).eq("fiscal_year", 2026).gte("period_no", 1).lte("period_no", 8).then((r) => r.count))) && ok;
ok = (await check("FY2026 P9 rows == 352 (loader emitted)", 352,
  supa.from("pnl_actuals").select("*", { count: "exact", head: true }).eq("fiscal_year", 2026).eq("period_no", 9).then((r) => r.count))) && ok;

console.log("\nFY2026 P9 per-account row counts:");
const { data: accts } = await supa.from("accounts").select("account_key").eq("team_key", "CORP").limit(1);
const clientAccounts = ["CIN - AZ","CIN - KY","CIN - OH","STL - FL","STL - MO","TBJ - FL","TBJ - NY","TBR - FL","TXR - AZ","TXR - TX - H","TXR - TX - V"];
let perAcctTotal = 0;
for (const a of clientAccounts) {
  const { count } = await supa
    .from("pnl_actuals")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", 2026)
    .eq("period_no", 9)
    .eq("account_key", a);
  console.log(`  ${a.padEnd(14)}  ${count} rows`);
  perAcctTotal += count;
}
ok = (perAcctTotal === 352) && ok;
console.log(`  sum: ${perAcctTotal}  ${perAcctTotal === 352 ? "PASS" : "FAIL"}`);

console.log("\nkpi_period_status FY2026 P8 + P9:");
const { data: kps } = await supa
  .from("kpi_period_status")
  .select("*")
  .eq("fiscal_year", 2026)
  .in("period_no", [8, 9])
  .order("period_no");
for (const r of kps) {
  console.log(`  P${r.period_no}: closed_at=${r.closed_at ?? "NULL"}  verified_at=${r.verified_at ?? "NULL"}  verified_by=${r.verified_by ?? "NULL"}  source_ref=${r.source_ref ? "PRESENT" : "NULL"}`);
}

// P9 checks per brief §3.4
const p9 = kps.find((r) => r.period_no === 9);
ok = (await check("kpi_period_status (2026,9) verified_at present", true, Promise.resolve(!!p9.verified_at))) && ok;
ok = (await check("kpi_period_status (2026,9) verified_by set to loader:...", true, Promise.resolve(p9.verified_by?.startsWith("loader:pnl_actuals_p9_")))) && ok;
ok = (await check("kpi_period_status (2026,9) source_ref present", true, Promise.resolve(!!p9.source_ref))) && ok;
ok = (await check("kpi_period_status (2026,9) closed_at STILL NULL (pnl-3 owns this)", true, Promise.resolve(p9.closed_at === null))) && ok;

// Sanity: P8 unchanged
ok = (await check("kpi_period_status (2026,8) closed_at still present", true, Promise.resolve(!!kps.find((r) => r.period_no === 8).closed_at))) && ok;

console.log("");
console.log(ok ? "STAGE 0 VERIFY · PASS" : "STAGE 0 VERIFY · FAIL");
process.exit(ok ? 0 : 2);
