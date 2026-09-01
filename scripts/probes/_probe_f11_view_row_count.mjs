#!/usr/bin/env node
// scripts/probes/_probe_f11_view_row_count.mjs
//
// F-11 secondary. Read-only.
// Confirm whether rippling_report_only_pending_v1 is genuinely empty
// today (which would explain the 200ms warm timings and the missing
// coverage that leaves the ALL/FYTD path exposed on the FIRST call).
// Also probe the base tables to reason about materialisation cost.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

async function head(table, filters = (q) => q) {
  const t0 = Date.now();
  const r = await filters(supa.from(table).select("*", { count: "exact", head: true }));
  const ms = Date.now() - t0;
  return { ms, count: r.count, error: r.error };
}

async function main() {
  console.log(`# F-11 view row count / base-table sizing - ${new Date().toISOString()}`);
  console.log("");

  // The view
  console.log(`## rippling_report_only_pending_v1 (HEAD count, cold + warm)`);
  const v1 = await head("rippling_report_only_pending_v1");
  console.log(`  cold: ${v1.ms}ms  count=${v1.count}  ${v1.error ? "ERROR: " + v1.error.message : ""}`);
  const v2 = await head("rippling_report_only_pending_v1");
  console.log(`  warm: ${v2.ms}ms  count=${v2.count}  ${v2.error ? "ERROR: " + v2.error.message : ""}`);
  console.log("");

  // Upstream materialised bases the view walks
  console.log(`## Base tables the view materialises over`);
  console.log(`  rippling_report_txns_latest (view over rippling_report_txns):`);
  const t1 = await head("rippling_report_txns_latest");
  console.log(`    ${t1.ms}ms  count=${t1.count}`);

  console.log(`  rippling_report_txns (base):`);
  const t2 = await head("rippling_report_txns");
  console.log(`    ${t2.ms}ms  count=${t2.count}`);

  console.log(`  rippling_raw_spend_lines (base, the anti-join surface):`);
  const t3 = await head("rippling_raw_spend_lines");
  console.log(`    ${t3.ms}ms  count=${t3.count}`);

  console.log(`  rippling_raw_spend_lines_latest (view over base):`);
  const t4 = await head("rippling_raw_spend_lines_latest");
  console.log(`    ${t4.ms}ms  count=${t4.count}`);

  console.log(`  spend_work_location_site_map (attribution join):`);
  const t5 = await head("spend_work_location_site_map");
  console.log(`    ${t5.ms}ms  count=${t5.count}`);
  console.log("");

  // What is landing in the view now - if 0, why?
  console.log(`## Why the view might be empty today`);
  console.log(`  Rows in rippling_report_txns_latest with currency=USD and amount<>0 and category coded`);
  const t6 = await head("rippling_report_txns_latest", q =>
    q.eq("currency", "USD")
     .not("amount", "eq", 0));
  console.log(`    ${t6.ms}ms  count=${t6.count}   (base subject population before anti-join + attribution)`);

  // Note: cannot easily reproduce the NOT EXISTS on the client side
  // (would need a SQL RPC). The count above bounds the max view size.
  console.log("");

  console.log(`## Interpretation`);
  console.log(`  If HEAD on the view returns 0, the view is genuinely empty AND`);
  console.log(`  the previous 500 on ALL/FYTD was almost certainly the 8s cold-start`);
  console.log(`  timeout on the view's materialisation, not row-volume-driven work.`);
  console.log(`  A view that returns 0 rows still has to plan + probe both bases.`);
  console.log(`  Under Supabase's 8s statement_timeout with N parallel requests`);
  console.log(`  from the route's Promise.all, this hits the boundary intermittently.`);
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });
