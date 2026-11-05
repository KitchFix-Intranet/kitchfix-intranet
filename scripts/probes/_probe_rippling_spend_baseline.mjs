#!/usr/bin/env node
// Baseline for the acceptance check on the rippling spend step
// retirement. Reports counts + max(txn_date) so a post-merge
// workflow_dispatch run can be compared cent-exact. Read-only.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_rippling_spend_baseline.mjs
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function count(filterFn) {
  let q = supa.from("purchasing_actuals").select("id", { count: "exact", head: true });
  q = filterFn(q);
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}
async function maxDate(src) {
  const r = await supa.from("purchasing_actuals").select("txn_date").eq("source", src).order("txn_date", { ascending: false }).limit(1).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data?.txn_date ?? null;
}

console.log(`probe started=${new Date().toISOString()}`);

const r1 = await count(q => q.eq("source", "rippling_spend"));
const r1max = await maxDate("rippling_spend");
console.log(`purchasing_actuals source=rippling_spend  rows=${r1}  max_txn_date=${r1max}`);

const r2 = await count(q => q.eq("source", "billcom"));
console.log(`purchasing_actuals source=billcom         rows=${r2}`);

const r3 = await count(q => q.eq("source", "billcom_credit"));
console.log(`purchasing_actuals source=billcom_credit  rows=${r3}`);

console.log("");
console.log("after a nightly run:");
console.log("  rippling_spend must be byte-identical: rows=14,191, max_txn_date=2026-11-04");
console.log("  billcom + billcom_credit: expect only the normal nightly delta");
