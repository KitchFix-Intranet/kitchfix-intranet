#!/usr/bin/env node
/*
 * R16 P0 followup: my first probe returned 0 report-only rows for
 * STL - MO FYTD but Kevin's UI showed a 49 vs 32 gap.  Either:
 *   - date range mismatch
 *   - account filter mismatch
 *   - view definition surprises
 *
 * Widen the search: what's in rippling_report_only_pending_v1 right now?
 */
import { createClient } from "@supabase/supabase-js";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`env: ${SB_URL ? "PRESENT" : "ABSENT"} / ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) process.exit(2);
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Total in the view, no filters
const total = await supa.from("rippling_report_only_pending_v1")
  .select("*", { count: "exact", head: true });
console.log(`rippling_report_only_pending_v1 total rows: ${total.count}`);

// First 10 rows
const first = await supa.from("rippling_report_only_pending_v1")
  .select("*").limit(10);
console.log(`  first-row columns: ${first.data?.[0] ? Object.keys(first.data[0]).join(", ") : "(no rows)"}`);
if (first.data?.length) {
  console.log(`  sample:`);
  for (const r of first.data.slice(0, 5)) console.log(`    ${JSON.stringify(r)}`);
}

// By account_key
const perAcct = await supa.from("rippling_report_only_pending_v1")
  .select("account_key");
if (!perAcct.error && perAcct.data) {
  const byA = new Map();
  for (const r of perAcct.data) byA.set(r.account_key, (byA.get(r.account_key) || 0) + 1);
  console.log(`\ndistinct account_keys in the view:`);
  for (const [k, n] of [...byA.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k || "(null)"}: ${n}`);
}

// STL - MO specifically, no date filter
const stlAll = await supa.from("rippling_report_only_pending_v1")
  .select("*").eq("account_key", "STL - MO");
console.log(`\nSTL - MO (no date filter): ${stlAll.data?.length || 0} rows`);
if (stlAll.data?.length) {
  const dates = stlAll.data.map(r => r.purchased_at).filter(Boolean).sort();
  console.log(`  date range: ${dates[0]} .. ${dates[dates.length - 1]}`);
}

// CIN - AZ specifically, no date filter
const cinAll = await supa.from("rippling_report_only_pending_v1")
  .select("*").eq("account_key", "CIN - AZ");
console.log(`CIN - AZ (no date filter): ${cinAll.data?.length || 0} rows`);
if (cinAll.data?.length) {
  const dates = cinAll.data.map(r => r.purchased_at).filter(Boolean).sort();
  console.log(`  date range: ${dates[0]} .. ${dates[dates.length - 1]}`);
}
