// PR-2 R2 CARD STALENESS PROBE (REPORT ONLY).
//
// Reports:
//   - purchasing_derive_runs latest completed_at per source
//   - max(txn_date) on rippling_spend
//   - split by source to see raw_latest vs the derived split
//
// This probe is REPORT-ONLY per Kevin ruling 2026-08-24. Do not
// "fix" the card-staleness lag - the owner rules on that data
// question.

import { createClient } from "@supabase/supabase-js";

const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = need.filter(k => !process.env[k]);
if (missing.length) {
  console.error("MISSING ENV:", missing.join(", "));
  process.exit(2);
}

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // 1. Latest sync per source from purchasing_derive_runs.
  const [bc, rp, drAll] = await Promise.all([
    supa.from("purchasing_derive_runs")
      .select("source, status, started_at, completed_at, bills_touched, lines_written")
      .eq("source", "billcom").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(3),
    supa.from("purchasing_derive_runs")
      .select("source, status, started_at, completed_at, lines_written")
      .eq("source", "rippling_spend").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(3),
    supa.from("purchasing_derive_runs")
      .select("source, status, started_at, completed_at")
      .order("completed_at", { ascending: false }).limit(10),
  ]);

  console.log("\n=== LATEST BILLCOM SYNCS ===");
  console.log(JSON.stringify(bc.data, null, 2));

  console.log("\n=== LATEST RIPPLING SYNCS ===");
  console.log(JSON.stringify(rp.data, null, 2));

  console.log("\n=== LATEST 10 DERIVE RUNS (any source, any status) ===");
  console.log(JSON.stringify(drAll.data, null, 2));

  // 2. max(txn_date) on rippling_spend across purchasing_actuals.
  const maxRip = await supa.from("purchasing_actuals")
    .select("txn_date, source")
    .eq("source", "rippling_spend")
    .order("txn_date", { ascending: false })
    .limit(5);
  console.log("\n=== TOP 5 RIPPLING_SPEND rows by txn_date ===");
  console.log(JSON.stringify(maxRip.data, null, 2));

  const maxBill = await supa.from("purchasing_actuals")
    .select("txn_date, source")
    .eq("source", "billcom")
    .order("txn_date", { ascending: false })
    .limit(5);
  console.log("\n=== TOP 5 BILLCOM rows by txn_date ===");
  console.log(JSON.stringify(maxBill.data, null, 2));

  // 3. Count of rippling_spend rows per week in the last 4 weeks.
  const weeks = [
    "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17",
  ];
  console.log("\n=== RIPPLING_SPEND row counts per 7d window ===");
  for (const wStart of weeks) {
    const wEnd = new Date(new Date(wStart).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const c = await supa.from("purchasing_actuals")
      .select("*", { count: "exact", head: true })
      .eq("source", "rippling_spend")
      .gte("txn_date", wStart)
      .lte("txn_date", wEnd);
    console.log(`  ${wStart}..${wEnd}: ${c.count} rows`);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(3); });
