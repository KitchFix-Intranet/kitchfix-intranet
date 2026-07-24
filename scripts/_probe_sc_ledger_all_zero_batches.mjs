// PROBE: find existing all-zero same-timestamp batches in
// sc_daily_actuals_history so the Ledger's mark-no-service collapse
// (`bucket.entries.length > 1 && bucket.entries.every(e => Number(e.newValue) === 0)`)
// can be exercised on real data.
//
// Also lists the earliest actuals.created_at per (account, date) so the
// synthetic first-entered row can be spot-verified against the trigger's
// audit rows (does the synthetic row's changedAt line up with the
// FIRST insert on a day that ALSO has later UPDATEs?).
//
//   node --env-file=.env.local scripts/_probe_sc_ledger_all_zero_batches.mjs
//
// Read-only. No writes.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function findAllZeroBatches() {
  console.log("\n=== ALL-ZERO SAME-TIMESTAMP BATCHES (mark-no-service collapse target) ===\n");
  const { data, error } = await supa
    .from("sc_daily_actuals_history")
    .select("account_key, service_date, service_id, old_count, new_count, changed_at, changed_by")
    .order("account_key", { ascending: true })
    .order("service_date", { ascending: true })
    .order("changed_at", { ascending: true });

  if (error) {
    console.error(`  ERROR reading sc_daily_actuals_history: ${error.message}`);
    return;
  }

  // Bucket by (account, date, changed_at truncated to second).
  const buckets = new Map();
  for (const r of data || []) {
    const t = new Date(r.changed_at);
    if (!Number.isNaN(t.getTime())) t.setMilliseconds(0);
    const key = `${r.account_key}|${r.service_date}|${t.toISOString()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }

  const allZeroBatches = [];
  for (const [key, entries] of buckets.entries()) {
    if (entries.length > 1 && entries.every(e => Number(e.new_count) === 0)) {
      allZeroBatches.push({ key, entries });
    }
  }

  if (allZeroBatches.length === 0) {
    console.log("  NONE found in sc_daily_actuals_history.");
    console.log("  -> Cannot exercise the collapse against production data.");
    return;
  }

  console.log(`  FOUND ${allZeroBatches.length} all-zero batch(es):\n`);
  for (const b of allZeroBatches) {
    const [account, date, ts] = b.key.split("|");
    console.log(`    ${account} | ${date} | ${ts} | ${b.entries.length} services | by ${b.entries[0].changed_by || "(null author)"}`);
  }
  console.log("\n  Open one of these days in the Ledger to visually verify the collapse.");
}

async function findFirstEnteredCandidates() {
  console.log("\n=== FIRST-ENTERED SPOT CHECK (INSERT-only days) ===\n");
  // Find days that have actuals rows but NO history rows - these are
  // the days the first-entered synthesis is meant to fix. Confirms the
  // v1 render sees an "Entered counts" row where before it saw "No
  // activity yet."
  const [{ data: actuals, error: actErr }, { data: history, error: histErr }] = await Promise.all([
    supa.from("sc_daily_actuals")
      .select("account_key, service_date, created_by, created_at")
      .order("service_date", { ascending: false })
      .limit(500),
    supa.from("sc_daily_actuals_history")
      .select("account_key, service_date")
      .limit(5000),
  ]);
  if (actErr) { console.error(`  ERROR actuals: ${actErr.message}`); return; }
  if (histErr) { console.error(`  ERROR history: ${histErr.message}`); return; }

  const historyKeys = new Set();
  for (const h of history || []) historyKeys.add(`${h.account_key}|${h.service_date}`);

  const insertOnlyByKey = new Map();
  for (const a of actuals || []) {
    const key = `${a.account_key}|${a.service_date}`;
    if (historyKeys.has(key)) continue;
    const existing = insertOnlyByKey.get(key);
    if (!existing || a.created_at < existing.created_at) insertOnlyByKey.set(key, a);
  }

  if (insertOnlyByKey.size === 0) {
    console.log("  NONE found. (Every recent actuals day has at least one UPDATE.)");
    return;
  }

  console.log(`  FOUND ${insertOnlyByKey.size} insert-only day(s) - v1 was showing "No activity yet" for these; now shows "Entered counts":\n`);
  for (const [key, row] of Array.from(insertOnlyByKey.entries()).slice(0, 10)) {
    const [account, date] = key.split("|");
    console.log(`    ${account} | ${date} | first entered ${row.created_at} by ${row.created_by || "(null)"}`);
  }
  if (insertOnlyByKey.size > 10) console.log(`    ... and ${insertOnlyByKey.size - 10} more`);
}

async function main() {
  await findAllZeroBatches();
  await findFirstEnteredCandidates();
  console.log("");
}

main().catch(e => { console.error(e); process.exit(1); });
