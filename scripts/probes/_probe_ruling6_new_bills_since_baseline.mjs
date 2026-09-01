#!/usr/bin/env node
// scripts/probes/_probe_ruling6_new_bills_since_baseline.mjs
//
// Quantify bill.com activity 2026-08-28 -> today in the YTD-P8 window.
// Read-only.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const WINDOW_START = "2025-12-29";
const WINDOW_END   = "2026-08-09";
const BASELINE = "2026-08-28T00:00:00.000Z";
const PAGE = 1000;

function fmt$(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  console.log(`# Bill.com activity since ${BASELINE}, YTD-P8 window`);
  console.log("");

  // bill.com derive_run history
  console.log(`## purchasing_derive_runs for bill.com since 2026-08-28`);
  const runs = await supa
    .from("purchasing_derive_runs")
    .select("started_at, completed_at, status, source, fetch_source")
    .eq("source", "billcom")
    .gte("started_at", BASELINE)
    .order("started_at", { ascending: false });
  if (runs.error) throw new Error(runs.error.message);
  console.log(`  runs since baseline: ${runs.data.length}`);
  for (const r of runs.data.slice(0, 20)) {
    console.log(`    ${r.started_at}  status=${r.status}  fetch_source=${r.fetch_source}  completed=${r.completed_at || "in_progress"}`);
  }
  console.log("");

  // bill.com rows with derived_at >= baseline in YTD-P8 window
  console.log(`## bill.com rows re-derived since ${BASELINE} in YTD-P8 window`);
  const rows = [];
  let from = 0;
  while (true) {
    const r = await supa
      .from("purchasing_actuals")
      .select("gl_line_code, amount, txn_date, derived_at, source_bill_id, excluded")
      .eq("source", "billcom")
      .eq("excluded", false)
      .gte("txn_date", WINDOW_START)
      .lte("txn_date", WINDOW_END)
      .gte("derived_at", BASELINE)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`page ${from}: ${r.error.message}`);
    const chunk = r.data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  const summarize = (rs) => {
    const t = { food: 0, packaging: 0, vehicle: 0, other: 0, n: rs.length };
    for (const r of rs) {
      const s = String(r.gl_line_code || "");
      const amt = Number(r.amount || 0);
      if (s.startsWith("3200")) t.food += amt;
      else if (s.startsWith("3400")) t.packaging += amt;
      else if (s.startsWith("3500")) t.vehicle += amt;
      else t.other += amt;
    }
    return t;
  };
  const t = summarize(rows);
  console.log(`  rows: ${t.n}`);
  console.log(`  Food:      ${fmt$(t.food)}`);
  console.log(`  Packaging: ${fmt$(t.packaging)}`);
  console.log(`  Vehicle:   ${fmt$(t.vehicle)}`);
  console.log(`  Other GL:  ${fmt$(t.other)}`);
  console.log(`  Purchasing (3-family) total: ${fmt$(t.food + t.packaging + t.vehicle)}`);
  console.log("");

  // Compare against the FULL YTD-P8 bill.com totals (from our recon)
  console.log(`## Full YTD-P8 bill.com totals (for context, from _probe_ruling6_fix_reconciliation)`);
  console.log(`  Food:      $1,885,046.81`);
  console.log(`  Packaging:   $174,354.78`);
  console.log(`  Vehicle:         $244.40`);
  console.log(`  bill.com total: $2,059,645.99`);
  console.log("");

  // Newly-added bills (as opposed to re-derived rows). bill.com sync is
  // idempotent; if a bill_id was already known and unchanged, would
  // its derived_at update? Depends on whether the sync overwrites on
  // no-change. Kevin's #927 audit noted purchasing_actuals uses
  // DELETE+INSERT per fact key. That means every re-derive rewrites
  // derived_at. So derived_at >= baseline for bill.com means EITHER
  // the sync ran since baseline OR the row is brand new.
  //
  // With 0 bill.com syncs since baseline (if the query above shows 0),
  // the answer is: any bill.com row with derived_at >= baseline is a
  // NEW bill for the closed P8 window.
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });
