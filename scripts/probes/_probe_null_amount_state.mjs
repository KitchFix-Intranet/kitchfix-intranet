#!/usr/bin/env node
/**
 * BEFORE-state probe for the amount-mapping fix.
 *
 * Reports on rippling_report_txns:
 *   - total rows
 *   - rows with amount NOT NULL
 *   - rows with amount IS NULL
 *   - newest last_seen_at + oldest first_seen_at (audit trail)
 *
 * Run BEFORE the fix, run AGAIN AFTER Kevin re-triggers the ingest
 * workflow.  Delta on "amount NOT NULL" is the backfill measurement.
 *
 * No worker or cardholder names.  Aggregate counts only.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function main() {
  const { count: total, error: e1 } = await supa
    .from("rippling_report_txns")
    .select("*", { count: "exact", head: true });
  if (e1) { console.error(e1.message); process.exit(1); }

  const { count: withAmount, error: e2 } = await supa
    .from("rippling_report_txns")
    .select("*", { count: "exact", head: true })
    .not("amount", "is", null);
  if (e2) { console.error(e2.message); process.exit(1); }

  const nullCount = total - withAmount;
  const populatedPct = total > 0 ? (withAmount / total * 100).toFixed(2) : "0";
  console.log(`rippling_report_txns rows total:          ${total}`);
  console.log(`rows with amount NOT NULL:                ${withAmount}  (${populatedPct}%)`);
  console.log(`rows with amount IS NULL:                 ${nullCount}`);
  console.log("");

  const { data: parentCount } = await supa
    .from("rippling_report_txns")
    .select("parent_txn_id")
    .limit(20000);
  const distinctParents = new Set((parentCount || []).map(r => r.parent_txn_id));
  console.log(`distinct parent_txn_id (approx, first 20k):  ${distinctParents.size}`);

  const { data: seen } = await supa
    .from("rippling_report_txns")
    .select("first_seen_at, last_seen_at")
    .order("first_seen_at", { ascending: true }).limit(1);
  const { data: seenNew } = await supa
    .from("rippling_report_txns")
    .select("first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false }).limit(1);
  console.log(`oldest first_seen_at:  ${seen?.[0]?.first_seen_at || "n/a"}`);
  console.log(`newest last_seen_at:   ${seenNew?.[0]?.last_seen_at || "n/a"}`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
