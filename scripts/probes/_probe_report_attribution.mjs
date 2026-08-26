#!/usr/bin/env node
/**
 * Round 4 - attribution + exclusion rules for the 314 report-only rows.
 *
 * Questions:
 *   1. accounts table shape - is there a work_location label column that
 *      the report's `work_location` string can join on?
 *   2. For each report-only parent_txn_id, does it have a work_location
 *      that resolves to an account_key?  Report count by attribution
 *      outcome (resolved / unresolved).
 *   3. Rulings 2-5 - do they apply to report-only rows?
 *      - R2 duplicate splits: report may have multiple content_hash rows
 *        per parent_txn_id (72 in phase 2).  _latest resolves this WITHIN
 *        source.  Between sources: API absent by construction on these.
 *      - R3 non-USD: currency column exists on report; filter on 'USD'.
 *      - R4 auth-pair: `rippling_report_seen_txns` is the auth-pair seed
 *        set.  For report-only rows we don't have an API row to arbitrate
 *        against; but auth-pair means both halves of the pair have to be
 *        excluded.  Check whether any report-only parent_txn_ids show up
 *        with the same amount / date / vendor as another row (auth-pair
 *        signature).
 *      - R5 zero-amount: filter amount != 0.
 *   4. Per-account live hero delta - sum of qualifying report-only
 *      amounts by account_key.
 */
import { createClient } from "@supabase/supabase-js";
function envOrDie(name) { const v=process.env[name]; if(!v){console.error(`env ${name} ABSENT`);process.exit(1);} return v; }
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL?"PRESENT":"ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?"PRESENT":"ABSENT"}`);
const supa = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"), { auth:{persistSession:false} });

console.log("\n=== A - accounts table label columns ===");
{
  const q = await supa.from("accounts").select("*").limit(3);
  if (q.error) { console.error(q.error.message); process.exit(1); }
  const cols = Object.keys(q.data?.[0] || {});
  console.log(`  columns: ${cols.join(", ")}`);
  console.log(`  first row: ${JSON.stringify(q.data?.[0], null, 2)}`);
}

console.log("\n=== A2 - all account team_keys + candidate work_location labels ===");
{
  const q = await supa.from("accounts").select("team_key, work_location, work_location_id, rippling_work_location").limit(50);
  if (q.error) { console.log(`  (some cols not present) ${q.error.message}`); }
  else {
    for (const r of q.data || []) console.log(`  ${JSON.stringify(r)}`);
  }
}

console.log("\n=== B - report distinct work_location values ===");
{
  const set = new Map();  // wl -> count
  let from=0; const PS=1000;
  while(true){
    const q = await supa.from("rippling_report_txns").select("work_location").order("id",{ascending:true}).range(from,from+PS-1);
    if (q.error){ console.error(q.error.message); process.exit(1); }
    const rows = q.data || [];
    for (const r of rows) {
      const wl = r.work_location || "(null)";
      set.set(wl, (set.get(wl) || 0) + 1);
    }
    if (rows.length < PS) break;
    from += PS;
  }
  const entries = [...set.entries()].sort((a,b) => b[1] - a[1]);
  console.log(`  distinct work_location values (${entries.length}):`);
  for (const [wl, n] of entries) console.log(`    ${n.toString().padStart(6)}  "${wl}"`);
}

console.log("\n=== C - how does the existing derive attribute work_location? ===");
{
  const q = await supa.from("rippling_raw_spend_lines")
    .select("work_location_id, work_location_label")
    .not("work_location_label", "is", null)
    .limit(20);
  if (q.error) { console.log(`  ${q.error.message}`); }
  else {
    const seen = new Set();
    for (const r of q.data || []) {
      const key = `${r.work_location_id}|${r.work_location_label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  wl_id=${r.work_location_id} wl_label="${r.work_location_label}"`);
    }
  }
}

console.log("\n=== D - report ONLY parent_txn_ids: attribution + amount + date breakdown ===");
{
  // Build the set of API prefixes
  const apiPrefixes = new Set();
  {
    let from=0; const PS=1000;
    while(true){
      const q = await supa.from("rippling_raw_spend_lines").select("external_id").order("id",{ascending:true}).range(from,from+PS-1);
      if (q.error){ console.error(q.error.message); process.exit(1); }
      const rows = q.data || [];
      for (const r of rows) {
        const m = String(r.external_id || "").match(/^([0-9a-f]{24})__/);
        if (m) apiPrefixes.add(m[1]);
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }

  // Read report rows - use newest (highest id) per parent_txn_id
  const byParent = new Map();
  {
    let from=0; const PS=1000;
    while(true){
      const q = await supa.from("rippling_report_txns")
        .select("id, parent_txn_id, purchased_at, amount, currency, work_location, approval_state, submission_date, category, gl_sync_status, vendor_name, is_manually_paid")
        .order("id", { ascending: true }).range(from,from+PS-1);
      if (q.error){ console.error(q.error.message); process.exit(1); }
      const rows = q.data || [];
      for (const r of rows) {
        const existing = byParent.get(r.parent_txn_id);
        if (!existing || existing.id < r.id) byParent.set(r.parent_txn_id, r);
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  console.log(`  report distinct parents (via _latest = max(id)): ${byParent.size}`);

  const reportOnly = [];
  for (const [pid, r] of byParent) if (!apiPrefixes.has(pid)) reportOnly.push(r);
  console.log(`  report-only rows: ${reportOnly.length}`);

  // Break down by currency (R3)
  const byCurrency = new Map();
  for (const r of reportOnly) byCurrency.set(r.currency, (byCurrency.get(r.currency) || 0) + 1);
  console.log(`\n  by currency (R3 non-USD): ${JSON.stringify([...byCurrency])}`);

  // Break down by amount = 0 (R5)
  const zeroAmt = reportOnly.filter(r => Number(r.amount || 0) === 0);
  console.log(`  zero-amount rows (R5): ${zeroAmt.length}`);

  // Break down by approval_state
  const byState = new Map();
  for (const r of reportOnly) byState.set(r.approval_state, (byState.get(r.approval_state) || 0) + 1);
  console.log(`  by approval_state: ${JSON.stringify([...byState])}`);

  // Break down by is_manually_paid (a signal of reimbursement, not card)
  const byManual = new Map();
  for (const r of reportOnly) byManual.set(String(r.is_manually_paid), (byManual.get(String(r.is_manually_paid)) || 0) + 1);
  console.log(`  by is_manually_paid: ${JSON.stringify([...byManual])}`);

  // Break down by work_location -> account_key (attribution)
  const wlMap = new Map();
  for (const r of reportOnly) wlMap.set(r.work_location || "(null)", (wlMap.get(r.work_location || "(null)") || 0) + 1);
  console.log(`\n  by work_location (attribution):`);
  const sorted = [...wlMap].sort((a,b) => b[1] - a[1]);
  for (const [wl, n] of sorted) console.log(`    ${n.toString().padStart(4)}  "${wl}"`);

  // Sum amount by work_location, USD only, non-zero, purchased_at in FYTD (2025-12-29 to 2026-08-26)
  const START = "2025-12-29", END = "2026-08-26";
  const totalUsdInRange = reportOnly.filter(r =>
    r.currency === "USD" &&
    Number(r.amount || 0) !== 0 &&
    r.purchased_at != null &&
    r.purchased_at >= START && r.purchased_at <= END
  );
  console.log(`\n  USD, non-zero, purchased_at in [${START},${END}]: ${totalUsdInRange.length} rows`);
  const wlAmount = new Map();
  for (const r of totalUsdInRange) {
    const wl = r.work_location || "(null)";
    wlAmount.set(wl, (wlAmount.get(wl) || 0) + Number(r.amount || 0));
  }
  console.log(`  sum by work_location:`);
  for (const [wl, amt] of [...wlAmount].sort((a,b) => b[1] - a[1])) {
    console.log(`    ${amt.toFixed(2).padStart(12)}  "${wl}"`);
  }
}

console.log("\ndone.");
