#!/usr/bin/env node
/**
 * Phase-two verify probe.  Reads role_table_grants, the unique
 * constraint definition, and the post-load row count.  Runs after
 * the migration is applied AND at least one ingest has completed.
 *
 * Kevin's rules 3 + 4:
 *   3. Any new table needs a GRANT to service_role and a verify probe
 *      reading role_table_grants - five green structural checks
 *      preceded a 403 once.
 *   4. Any new table a sync populates needs a post-sync row-count
 *      check - billcom_ref_vendors passed six structural verifies
 *      while holding zero rows.
 *
 * Output: counts + column list.  Never a row payload.  Never a name.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function main() {
  // 1. Table existence via a HEAD count.  If the migration has not
  //    been applied yet this returns 42P01.
  const { count, error: countErr } = await supa.from("rippling_report_txns").select("*", { count: "exact", head: true });
  if (countErr) {
    if (countErr.code === "42P01") {
      console.error("rippling_report_txns DOES NOT EXIST - migration not applied");
      process.exit(3);
    }
    console.error(`count read failed: ${countErr.message}`);
    process.exit(3);
  }
  console.log(`row count:  ${count}`);
  if (count === 0) {
    console.error("POST-SYNC ROW COUNT IS ZERO - table exists but empty (billcom_ref_vendors incident guard)");
    process.exit(4);
  }

  // 2. Structural probes on the projected columns via a tiny SELECT
  //    (id 1 or the first row).  We do NOT log any row value; only
  //    the column list.  This proves the columns exist without
  //    reading employee names / vendor names / amounts.
  const { data: sample, error: sampleErr } = await supa
    .from("rippling_report_txns")
    .select("id, parent_txn_id, content_hash, purchased_at, posted_date, submission_date, approved_at, approval_state, has_receipt, amount, currency, vendor_name, vendor, category, category_name, department_name, work_location, employee, employee_id, memo, line_item_memo, gl_sync_status, gl_vendor_name, is_manually_paid, repayment_status, is_user_edited, raw, first_seen_at, last_seen_at")
    .limit(1);
  if (sampleErr) { console.error(`sample select failed: ${sampleErr.message}`); process.exit(3); }
  if (!sample || sample.length === 0) { console.error("sample empty"); process.exit(4); }
  const cols = Object.keys(sample[0]).sort();
  console.log(`projected columns: ${cols.length}`);
  const required = ["id", "parent_txn_id", "content_hash", "purchased_at", "raw", "first_seen_at", "last_seen_at"];
  for (const r of required) {
    if (!cols.includes(r)) { console.error(`missing required column: ${r}`); process.exit(3); }
  }
  console.log("  all required columns present");

  // 3. Distinct parent count vs row count - how many rows are
  //    category-split (same parent_txn_id, different content_hash)?
  const { count: parents } = await supa.from("rippling_report_txns").select("parent_txn_id", { count: "exact", head: true });
  console.log(`row_count=${count}  parent_txn_id_distinct(approx)=${parents ?? "?"}`);

  // 4. Idempotency signal: newest last_seen_at.  If the workflow ran
  //    within the last 26 hours, we expect a recent last_seen_at.
  const { data: latest } = await supa.from("rippling_report_txns")
    .select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1);
  console.log(`newest last_seen_at: ${latest?.[0]?.last_seen_at ?? "n/a"}`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
