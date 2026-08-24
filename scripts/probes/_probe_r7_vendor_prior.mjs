// PR 2 R7 Fix 2 probe - why every vendor row reads `new`.
//
// Hits the purchasing route at FYTD scope with an aggregate account and
// samples the vendors[] rows: does any row have prior_spend > 0?
// If none, the "prior window" is landing outside available billcom data,
// so `isNewSpender = (prior_spend === 0)` fires for every row. Confirms
// root cause before we change render logic.

const BASE = process.env.PROBE_BASE || "http://localhost:3226";
const ACCOUNT = process.env.PROBE_ACCOUNT || "ALL"; // aggregate

async function main() {
  const url = `${BASE}/api/kpi/purchasing?account=${encodeURIComponent(ACCOUNT)}`;
  const r = await fetch(url, { headers: { "x-test-mode": "true" } });
  if (!r.ok) {
    console.error("HTTP", r.status, await r.text());
    process.exit(1);
  }
  const j = await r.json();
  const vendors = j?.vendors?.rows || [];
  console.log("range:", j.range?.start_date, "to", j.range?.end_date);
  console.log("vendor rows:", vendors.length);
  console.log("total_count:", j?.vendors?.total_count);
  const withPrior = vendors.filter(v => Number(v.prior_spend) > 0);
  const withoutPrior = vendors.filter(v => !(Number(v.prior_spend) > 0));
  console.log(`with prior_spend > 0: ${withPrior.length}`);
  console.log(`without prior_spend  : ${withoutPrior.length}`);
  console.log("\nfirst 5 rows:");
  for (const v of vendors.slice(0, 5)) {
    console.log(`  ${v.name?.slice(0, 30).padEnd(30)} spend=${v.spend?.toFixed(2).padStart(12)} prior=${(v.prior_spend ?? 0).toFixed(2).padStart(12)} lines=${v.line_count}`);
  }
  console.log("\nprior_range echoed by route (if any):", j?.vendors?.prior_range || "not exposed");
}

main().catch(e => { console.error(e); process.exit(1); });
