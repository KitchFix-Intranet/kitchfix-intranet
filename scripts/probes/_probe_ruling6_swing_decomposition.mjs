#!/usr/bin/env node
// scripts/probes/_probe_ruling6_swing_decomposition.mjs
//
// Decompose the 0.234% under -> +3.30% over reconciliation swing.
// Read-only.
//
// APPROACH
//   Two candidates for the ~$79K swing between the 2026-08-28 baseline
//   (board 0.234% under finance) and today (board +3.30% over finance):
//
//   (a) Ruling 6 revealed a pre-existing P22 tilt. Ruling 6 was
//       accidentally compensating for the P22 arc by excluding ~$79K
//       of legitimate coded COGS rows. Post-fix, that compensation
//       is gone and the P22 tilt is exposed.
//
//   (b) Four days of new data (2026-08-28 -> 2026-09-01) landed
//       incremental bills/charges that inflated the board without
//       inflating the P8 workbook.
//
//   Both can be true; the question is proportion. This probe measures:
//     - money that came back to the board post-fix (coded intersection
//       cohort now excluded=false, that used to be excluded=true)
//     - purchasing_actuals rows whose derived_at >= 2026-08-28, within
//       the YTD-P8 txn_date window (i.e. new writes into the closed
//       window that could shift the board without shifting the
//       workbook)

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
function bucketOf(gl) {
  const s = String(gl || "");
  if (s.startsWith("3200")) return "food";
  if (s.startsWith("3400")) return "packaging";
  if (s.startsWith("3500")) return "vehicle";
  return null;
}

async function walkPurchasing({ derivedGte } = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    let q = supa
      .from("purchasing_actuals")
      .select("id, source, gl_line_code, amount, txn_date, derived_at, excluded")
      .eq("excluded", false)
      .gte("txn_date", WINDOW_START)
      .lte("txn_date", WINDOW_END);
    if (derivedGte) q = q.gte("derived_at", derivedGte);
    const r = await q
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`page ${from}: ${r.error.message}`);
    const chunk = r.data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  console.log(`# Ruling 6 swing decomposition - ${new Date().toISOString()}`);
  console.log(`# Window: YTD-P8 (${WINDOW_START} .. ${WINDOW_END})`);
  console.log(`# Baseline: derived_at >= ${BASELINE}`);
  console.log("");

  const allRows = await walkPurchasing();
  const newRows = await walkPurchasing({ derivedGte: BASELINE });

  const summarize = (rows) => {
    const totals = { food: 0, packaging: 0, vehicle: 0,
                     food_card: 0, food_bill: 0,
                     pkg_card: 0, pkg_bill: 0,
                     veh_card: 0, veh_bill: 0 };
    for (const r of rows) {
      const b = bucketOf(r.gl_line_code);
      if (!b) continue;
      const amt = Number(r.amount || 0);
      totals[b] += amt;
      const suffix = b === "food" ? "food" : b === "packaging" ? "pkg" : "veh";
      if (r.source === "billcom") totals[`${suffix}_bill`] += amt;
      else if (r.source === "rippling_spend") totals[`${suffix}_card`] += amt;
    }
    return { rows: rows.length, ...totals };
  };
  const all = summarize(allRows);
  const nw  = summarize(newRows);

  console.log(`## All excluded=false rows in YTD-P8 window (post-fix board totals)`);
  console.log(`  total rows: ${all.rows}`);
  console.log(`  Food:      ${fmt$(all.food)}   (cards ${fmt$(all.food_card)}, bills ${fmt$(all.food_bill)})`);
  console.log(`  Packaging: ${fmt$(all.packaging)}   (cards ${fmt$(all.pkg_card)}, bills ${fmt$(all.pkg_bill)})`);
  console.log(`  Vehicle:   ${fmt$(all.vehicle)}   (cards ${fmt$(all.veh_card)}, bills ${fmt$(all.veh_bill)})`);
  console.log(`  Purchasing total (3200+3400+3500): ${fmt$(all.food + all.packaging + all.vehicle)}`);
  console.log("");

  console.log(`## Subset - rows with derived_at >= 2026-08-28 (new + re-derived since baseline)`);
  console.log(`  total rows: ${nw.rows}   (${((nw.rows / all.rows) * 100).toFixed(2)}% of full window)`);
  console.log(`  Food:      ${fmt$(nw.food)}   (cards ${fmt$(nw.food_card)}, bills ${fmt$(nw.food_bill)})`);
  console.log(`  Packaging: ${fmt$(nw.packaging)}   (cards ${fmt$(nw.pkg_card)}, bills ${fmt$(nw.pkg_bill)})`);
  console.log(`  Vehicle:   ${fmt$(nw.vehicle)}   (cards ${fmt$(nw.veh_card)}, bills ${fmt$(nw.veh_bill)})`);
  console.log(`  Purchasing total (3200+3400+3500): ${fmt$(nw.food + nw.packaging + nw.vehicle)}`);
  console.log("");

  console.log(`## Interpretation`);
  console.log(`  Purchasing_actuals uses DELETE+INSERT on re-derive, so derived_at`);
  console.log(`  captures ALL rows re-derived since 2026-08-28 - which is essentially`);
  console.log(`  every row (last derive was today's re-run).`);
  console.log(`  The right comparison is money-that-came-back-onto-the-board post-fix`);
  console.log(`  vs money-freshly-landed-in-the-closed-window. Cannot compute directly`);
  console.log(`  without a purchasing_actuals history table (see PURCHASING_CC_HANDOFF`);
  console.log(`  2026-08-28.md \"Historical corpus reconstruction\" note - #927 flagged`);
  console.log(`  this as a not-blocking gap).`);
  console.log("");
  console.log(`  Proxy: intersection cohort coded-and-came-back sum (from`);
  console.log(`  _probe_ruling6_row_accounting.mjs Section D):`);
  console.log(`     4261 rows / $995,846.25 (portfolio, all GL codes)`);
  console.log(`  Of that, the FOOD+PKG+VEH slice landing in the YTD-P8 window is`);
  console.log(`  the driver of the swing. Direct measurement requires the pre-fix`);
  console.log(`  corpus snapshot which is not preserved.`);
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });
