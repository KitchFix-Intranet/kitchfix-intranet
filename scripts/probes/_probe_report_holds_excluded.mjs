#!/usr/bin/env node
// Regression guard for the Kevin ruling 2026-09-24 hold rule on the
// report path: NO counting purchasing_actuals row may exist that is
//   - sourced via the report path (above CARD_REPORT_SOURCE_FLOOR
//     AND source_line_id is NOT the old API-walk shape)
//   - with excluded=false
//   - whose parent_txn's rippling_report_txns.raw says the Object
//     Type is Card Authorization.
//
// Exits non-zero on any leak. Names the count and a sample.
// READ-ONLY.
//
// Expected lifecycle:
//   - Before the mapper fix lands + Kevin runs the 2026-11-05
//     backfill, this probe FAILS at 9 rows. That is expected.
//   - After both land, it passes.
//   - If it ever starts failing again, a regression re-counted
//     holds.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FLOOR = "2026-10-05";

const q = await supa.rpc  // not needed - we use a plain select with EXISTS-shaped filter via two fetches
  ? null : null;
// Plain approach: fetch counting report-path rows and inner-join
// client-side against rippling_report_txns_latest raw->Object Type.
// Two queries; small result sets (there are ~400 above-floor holds
// and a handful of actuals rows at any time).

// Step 1: report-path counting rows.
const actuals = await supa.from("purchasing_actuals")
  .select("id, source_bill_id, source_line_id, txn_date, amount, account_key")
  .eq("source", "rippling_spend")
  .eq("excluded", false)
  .gte("txn_date", FLOOR);
if (actuals.error) { console.error(`read actuals: ${actuals.error.message}`); process.exit(2); }
const reportPathActuals = (actuals.data || []).filter(r => !String(r.source_line_id || "").startsWith("rippling_spend:"));

// Step 2: parent_txn_ids flagged Card Authorization.
const parentIds = [...new Set(reportPathActuals.map(r => r.source_bill_id).filter(Boolean))];
const authSet = new Set();
if (parentIds.length > 0) {
  // Paginate IN() batches to stay under PostgREST row + URL limits.
  const BATCH = 100;
  for (let i = 0; i < parentIds.length; i += BATCH) {
    const batch = parentIds.slice(i, i + BATCH);
    const rt = await supa.from("rippling_report_txns_latest")
      .select("parent_txn_id, raw")
      .in("parent_txn_id", batch);
    if (rt.error) { console.error(`read report txns: ${rt.error.message}`); process.exit(2); }
    for (const r of (rt.data || [])) {
      if (r.raw && r.raw["Object Type"] === "Card Authorization") authSet.add(r.parent_txn_id);
    }
  }
}

const leaked = reportPathActuals.filter(r => authSet.has(r.source_bill_id));
console.log(`report-path counting actuals above floor: ${reportPathActuals.length}`);
console.log(`parent_txn_ids flagged Card Authorization: ${authSet.size}`);
console.log(`LEAKED (counting holds)                 : ${leaked.length}`);
console.log("");

if (leaked.length === 0) {
  console.log("PASS: zero counting holds on the report path.");
  process.exit(0);
}

const totalAmount = leaked.reduce((s, r) => s + Number(r.amount || 0), 0);
console.log(`FAIL: ${leaked.length} counting hold(s), $${totalAmount.toFixed(2)} total`);
for (const r of leaked.slice(0, 10)) {
  console.log(`  id=${r.id}  parent=${r.source_bill_id}  acct=${r.account_key}  ${r.txn_date}  $${Number(r.amount || 0).toFixed(2)}`);
}
if (leaked.length > 10) console.log(`  ...+${leaked.length - 10} more`);
process.exit(3);
