// scripts/verify_labor_actuals_by_source.mjs
//
// Snapshot labor_actuals row counts and dollar sums, split by source
// and by the D35 dollar-coverage floor (2026-04-20). Read-only.
//
// Standard checks operators run before/after the pre-floor backfill
// loader to prove the two partitions stayed clean:
//   - api pre-floor rows       (should be 0 post-C6.1 + post-load)
//   - api post-floor rows      (owned by nightly derive)
//   - report_backfill rows     (owned by loader; 0 pre-load, ~1206 post-load)
//
// CLI:
//   node --env-file=.env.local scripts/verify_labor_actuals_by_source.mjs

import { createClient } from "@supabase/supabase-js";
import { DOLLAR_COVERAGE_FLOOR } from "../src/lib/kpi/floors.js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function fetchAll(t, c, filters = []) {
  const all = []; const PAGE = 1000; let from = 0;
  while (true) {
    let q = supa.from(t).select(c).range(from, from + PAGE - 1);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
const rows = await fetchAll("labor_actuals", "source, amount, week_start, account_key");

const bySrc = new Map();
for (const r of rows) {
  const s = r.source || "(null)";
  const cur = bySrc.get(s) || { n: 0, amt: 0 };
  cur.n++; cur.amt += Number(r.amount || 0);
  bySrc.set(s, cur);
}
console.log(`labor_actuals snapshot (floor = ${DOLLAR_COVERAGE_FLOOR}):`);
console.log("");
console.log("  source              count       sum(amount)");
for (const [s, v] of [...bySrc.entries()].sort()) {
  console.log(`  ${s.padEnd(20)}  ${String(v.n).padStart(6)}      $${v.amt.toFixed(2)}`);
}
console.log(`  ${"TOTAL".padEnd(20)}  ${String(rows.length).padStart(6)}      $${rows.reduce((s,r) => s + Number(r.amount||0), 0).toFixed(2)}`);
console.log("");

// Split by floor
const splits = { apiPre: 0, apiPost: 0, backfillPre: 0, backfillPost: 0 };
for (const r of rows) {
  const isPre = r.week_start < DOLLAR_COVERAGE_FLOOR;
  const key = `${r.source === "report_backfill" ? "backfill" : "api"}${isPre ? "Pre" : "Post"}`;
  splits[key]++;
}
console.log("Floor split (partition health):");
console.log(`  api        pre-floor:   ${String(splits.apiPre).padStart(6)}   ${splits.apiPre === 0 ? "clean" : "SHOULD BE 0 post-C6.1"}`);
console.log(`  api        post-floor:  ${String(splits.apiPost).padStart(6)}   (nightly-owned)`);
console.log(`  backfill   pre-floor:   ${String(splits.backfillPre).padStart(6)}   (loader-owned)`);
console.log(`  backfill   post-floor:  ${String(splits.backfillPost).padStart(6)}   ${splits.backfillPost === 0 ? "clean" : "SHOULD BE 0 - loader refuses post-floor writes"}`);
console.log("");

// Pre-floor api row breakdown - useful when C6.1 hasn't been applied
if (splits.apiPre > 0) {
  const preFloor = new Map();
  for (const r of rows) {
    if (r.source !== "api") continue;
    if (r.week_start >= DOLLAR_COVERAGE_FLOOR) continue;
    preFloor.set(r.account_key, (preFloor.get(r.account_key) || 0) + 1);
  }
  console.log(`Pre-floor api rows by account (must be 0 after loader --write on each account):`);
  let total = 0;
  for (const [a, n] of [...preFloor.entries()].sort()) {
    console.log(`  ${a.padEnd(15)}  ${n} rows`);
    total += n;
  }
  console.log(`  TOTAL: ${total}`);
}
