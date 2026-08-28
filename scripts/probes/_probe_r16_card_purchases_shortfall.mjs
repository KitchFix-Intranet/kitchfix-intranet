#!/usr/bin/env node
/*
 * R16 P0: measure the Card purchases hero-vs-list gap.
 *
 * Hero at STL - MO FYTD reads $12,314.84 / 49 charges.
 * List footer reads $7,505.37 / 32 charges.
 * Gap: $4,809.47 / 17 charges.
 *
 * Hypothesis: mergePending() adds report-only pending to API pending
 * for the hero, but loadCardCharges walks purchasing_actuals only.
 * The 17 missing rows are report-only (parents in
 * rippling_report_only_pending_v1 that have not yet appeared as rows
 * in purchasing_actuals).
 *
 * Report-only.  No writes.
 */
import { createClient } from "@supabase/supabase-js";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${SB_URL ? "PRESENT" : "ABSENT"}   SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const CASES = [
  { name: "STL - MO FYTD",       account: "STL - MO", start: "2025-12-29", end: "2026-08-27" },
  { name: "CIN - AZ this_period", account: "CIN - AZ", start: "2026-08-10", end: "2026-08-27" },
];

async function paginate(sel, cols, extras = q => q, PS = 1000) {
  const rows = []; let from = 0;
  while (true) {
    const r = extras(supa.from(sel).select(cols).range(from, from + PS - 1));
    const { data, error } = await r;
    if (error) throw new Error(`${sel}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PS) break;
    from += PS;
  }
  return rows;
}

for (const c of CASES) {
  console.log(`\n════ ${c.name} (${c.account}, ${c.start}..${c.end}) ════`);
  // API side: loadPending / loadCardCharges shape
  const apiRows = await paginate("purchasing_actuals", "id, source_line_id, amount",
    q => q.eq("source", "rippling_spend").eq("excluded", false).is("gl_line_code", null)
          .eq("account_key", c.account).gte("txn_date", c.start).lte("txn_date", c.end));
  const apiAmount = apiRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`  API side (purchasing_actuals uncoded rippling_spend):`);
  console.log(`    line_count = ${apiRows.length}`);
  console.log(`    amount     = $${apiAmount.toFixed(2)}`);

  // Report-only side: rippling_report_only_pending_v1 for this account, in-window
  const reportRows = await paginate("rippling_report_only_pending_v1", "parent_txn_id, amount, purchased_at, account_key",
    q => q.eq("account_key", c.account).gte("purchased_at", c.start).lte("purchased_at", c.end));
  const reportAmount = reportRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  console.log(`  Report-only side (rippling_report_only_pending_v1):`);
  console.log(`    line_count = ${reportRows.length}`);
  console.log(`    amount     = $${reportAmount.toFixed(2)}`);

  console.log(`  Combined (mergePending shape):`);
  console.log(`    line_count = ${apiRows.length + reportRows.length}`);
  console.log(`    amount     = $${(apiAmount + reportAmount).toFixed(2)}`);
  console.log(`  ---`);
  console.log(`  Diagnosis:`);
  console.log(`    Hero would read:  ${apiRows.length + reportRows.length} charges / $${(apiAmount + reportAmount).toFixed(2)}`);
  console.log(`    List would read:  ${apiRows.length} charges / $${apiAmount.toFixed(2)}   (loadCardCharges = API only)`);
  console.log(`    Gap (report-only, missing from list): ${reportRows.length} charges / $${reportAmount.toFixed(2)}`);
}
