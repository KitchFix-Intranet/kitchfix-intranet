// Phase 4 Path C - identify top-spend TBJ-FL unresolved protein SKUs.
// Rank by summed extended_price. Pick SKUs covering ~80% of unresolved dollars.
// Group by (vendor_id + item_number) when available, otherwise by (vendor_id + description).
// Output: _path_c_targets.json with ordered SKU list + invoice_uuids for each.

import fs from "node:fs";
import { P, ACCOUNTS, assignProteinType, inDollar, loadAugmented, round2, pct1 } from "./_common4.mjs";

const AUG = loadAugmented();
const REHAB = JSON.parse(fs.readFileSync(P.REHABBED_3C, "utf8"));
const REHAB_BY_ID = new Map(REHAB.map((r) => [r.id, r]));
const PATH_A = JSON.parse(fs.readFileSync(P.P4_PATH_A, "utf8"));
const PATH_A_IDS = new Set(PATH_A.apply_log.map((r) => r.id));
const PATH_B = JSON.parse(fs.readFileSync(P.P4_PATH_B, "utf8"));

// Rows Phase 4 Path B recovers (bacon 12 of 16)
const PATH_B_RECOVERED = new Set();
const PATH_B_STILL_UNRESOLVED = new Set();
for (const r of PATH_B.results) {
  for (const read of (r.reads || [])) {
    const line = r.lines?.[read.line_index - 1];
    if (!line) continue;
    if (read.total_lb_per_case && Number(read.total_lb_per_case) > 0 && Number(read.confidence || 0) >= 70) {
      PATH_B_RECOVERED.add(line.id);
    } else {
      PATH_B_STILL_UNRESOLVED.add(line.id);
    }
  }
}

// Focus: TBJ-FL priority (per prompt).
// Rank unresolved protein rows in TBJ-FL by summed extended_price.

const acct = "TBJ-FL";
const protRows = AUG.rows.filter(
  (r) => r.account_label === acct && inDollar(r) && String(r.category || "").toLowerCase() === "protein"
);

// A row is unresolved AFTER Phase 3b/3c/4-Path-A/4-Path-B IF:
//   - Phase 3c rehab dump has _effective_weight_lb null OR <= 0, AND
//   - Path A didn't apply, AND
//   - Path B didn't recover it.
function isStillUnresolved(r) {
  const rehab = REHAB_BY_ID.get(r.id);
  const eff = rehab ? rehab._effective_weight_lb : null;
  if (eff != null && eff > 0) return false;
  if (PATH_A_IDS.has(r.id)) return false;
  if (PATH_B_RECOVERED.has(r.id)) return false;
  return true;
}

const unresolved = protRows.filter(isStillUnresolved);
const totalUnresolvedSpend = unresolved.reduce((s, r) => s + (Number(r.extended_price) || 0), 0);

// Group by SKU
const skuMap = new Map();
for (const r of unresolved) {
  const key = r.vendor_id + "::" + (r.item_number || `descnorm::${String(r.description || "").toUpperCase().replace(/\s+/g, " ").trim()}`);
  if (!skuMap.has(key)) {
    skuMap.set(key, {
      key,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor_name,
      item_number: r.item_number,
      description_sample: r.description,
      protein_type: assignProteinType(r.description),
      category: r.category,
      rows: [],
      row_count: 0,
      spend: 0,
      has_pack_size: 0,
      has_wlv: 0,
    });
  }
  const s = skuMap.get(key);
  s.rows.push({
    id: r.id,
    invoice_uuid: r.invoice_uuid,
    invoice_date: r.invoice_date,
    description: r.description,
    pack_size: r.pack_size,
    quantity: r.quantity,
    qty_used: r.qty_used,
    extended_price: r.extended_price,
    weight_line_value: r.weight_line_value,
    review_reason: r.review_reason,
    parsed_weight_source: r.parsed_weight_source,
  });
  s.row_count += 1;
  s.spend += Number(r.extended_price) || 0;
  if (r.pack_size) s.has_pack_size += 1;
  if (r.weight_line_value && Number(r.weight_line_value) > 0) s.has_wlv += 1;
}

const skus = [...skuMap.values()].map((s) => ({ ...s, spend: round2(s.spend) })).sort((a, b) => b.spend - a.spend);

// Cumulative 80% cutoff
let cum = 0;
const top80 = [];
for (const s of skus) {
  top80.push(s);
  cum += s.spend;
  if (cum / totalUnresolvedSpend >= 0.8) break;
}

// Report
console.log(`[4-pathC] TBJ-FL protein unresolved (post 3c/4A/4B):`);
console.log(`  rows=${unresolved.length}  spend=$${round2(totalUnresolvedSpend)}`);
console.log(`  distinct SKUs: ${skus.length}`);
console.log(`  top-80% cover: ${top80.length} SKUs  ($${round2(top80.reduce((s, x) => s + x.spend, 0))}, ${pct1(top80.reduce((s, x) => s + x.spend, 0), totalUnresolvedSpend)}%)`);
console.log();
console.log(`Top ${Math.min(20, top80.length)} SKUs by unresolved spend:`);
for (const s of top80.slice(0, 20)) {
  console.log(`  $${s.spend.toFixed(2).padStart(9)}  ${s.protein_type.padEnd(12)}  vendor=${(s.vendor_name || '').slice(0, 12).padEnd(12)}  item#=${(s.item_number || 'none').padEnd(10)}  rows=${s.row_count}  desc=${(s.description_sample || '').slice(0, 40)}`);
}

// Group by invoice_uuid so we can batch invoice reads
const invMap = new Map();
for (const s of top80) {
  for (const r of s.rows) {
    if (!r.invoice_uuid) continue;
    if (!invMap.has(r.invoice_uuid)) invMap.set(r.invoice_uuid, { invoice_uuid: r.invoice_uuid, lines: [] });
    invMap.get(r.invoice_uuid).lines.push({
      id: r.id,
      sku_key: s.key,
      description: r.description,
      pack_size: r.pack_size,
      quantity: r.quantity,
      qty_used: r.qty_used,
      extended_price: r.extended_price,
      weight_line_value: r.weight_line_value,
      vendor_name: s.vendor_name,
    });
  }
}

// Write output
const out = {
  account_focus: acct,
  unresolved_rows: unresolved.length,
  unresolved_spend: round2(totalUnresolvedSpend),
  distinct_skus: skus.length,
  top80_skus: top80.map((s) => ({
    ...s,
    unresolved_spend_pct: pct1(s.spend, totalUnresolvedSpend),
    rows: undefined, // don't dump full rows in summary
  })),
  invoices: [...invMap.values()],
  path_b_recovered_ids: [...PATH_B_RECOVERED],
  path_b_still_unresolved_ids: [...PATH_B_STILL_UNRESOLVED],
};
fs.writeFileSync(P.P4_DIR + "/_path_c_targets.json", JSON.stringify(out, null, 2));
console.log(`\n[4-pathC] wrote ${P.P4_DIR}/_path_c_targets.json`);
console.log(`  invoices to fetch: ${invMap.size}`);
