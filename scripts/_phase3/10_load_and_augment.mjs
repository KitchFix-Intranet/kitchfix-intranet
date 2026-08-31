// Load ai_line_items rows for the window, resolve weights via packSizeParser,
// classify food/non-food via foodClassifier, resolve orphan-corrected rows via
// invoice_submissions status. Cache to disk so downstream steps do not re-hit
// the DB.
//
// Read-only.

import fs from "node:fs";
import {
  ACCOUNTS,
  ACCOUNT_LABEL,
  WINDOW_START,
  WINDOW_END,
  WINDOW_LABEL,
  fetchLineItemsInWindow,
  supa,
  sum,
  round,
} from "./_common.mjs";
import { resolveWeightForRow, resolveQuantity, parsePackSize } from "./packSizeParser.js";
import { classifyLine } from "./foodClassifier.js";

const OUT_JSON = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json";

console.log("[load] window:", WINDOW_LABEL);

const select =
  "id, account_key, invoice_uuid, invoice_date, vendor_id, vendor_name, description, item_number, category, quantity, unit, unit_price, extended_price, pack_size, uom_raw, shipped_count, ordered_count, weight_line_value, catch_weight_marker, needs_review, review_reason, is_historical";

const { rows, driftRecovered } = await fetchLineItemsInWindow({ select });
console.log("[load] rows raw:", rows.length, "drift-recovered:", driftRecovered);

// Load invoice_submissions for status / gl_breakdown / total_amount / invoice_date
const uuids = [...new Set(rows.map((r) => r.invoice_uuid).filter(Boolean))];
console.log("[load] distinct invoice_uuids:", uuids.length);
const headerMap = new Map();
const CHUNK = 100;
for (let i = 0; i < uuids.length; i += CHUNK) {
  const batch = uuids.slice(i, i + CHUNK);
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, status, total_amount, gl_breakdown, invoice_date, vendor_name")
    .in("id", batch);
  if (error) throw error;
  for (const r of data) headerMap.set(r.id, r);
}
console.log("[load] resolved headers:", headerMap.size);

// Build catalog cache for parser fallback: (vendor_id, item_number) -> parsedPack
// Seed from rows in the fetched set that have a cleanly-parseable pack_size.
// SKIP suspicious pack_size shapes so they do not propagate via catalog_lookup.
const catalogLookup = new Map();
for (const r of rows) {
  if (!r.vendor_id || !r.item_number) continue;
  const key = `${r.vendor_id}::${r.item_number}`;
  if (catalogLookup.has(key)) continue;
  if (isSuspiciousPackSize(r.pack_size)) continue;
  const p = parsePackSize(r.pack_size);
  if (p && p.totalMass_lb != null) catalogLookup.set(key, p);
}
console.log("[load] catalog seed entries:", catalogLookup.size);

// Filter out orphan-corrected rows (attached to corrected/deleted invoice)
let orphanCount = 0;
const live = [];
for (const r of rows) {
  const hdr = headerMap.get(r.invoice_uuid);
  if (hdr && (hdr.status === "corrected" || hdr.status === "deleted")) {
    orphanCount += 1;
    continue;
  }
  live.push(r);
}
console.log("[load] orphan-corrected rows excluded:", orphanCount);
console.log("[load] live rows:", live.length);

// Augment: parser + classifier + normalized date + suspicious-pack quarantine
//
// Data quality gate on pack_size parser: OCR frequently drops the slash in
// multi-pack sizes so "4/10 LB" arrives as "410 LB" and gets read literally as
// 410 pounds by parsePackSize (single_weight). A survey of the 6,969 rows
// showed 416 rows / 112.5K lbs (42% of weight-set food lbs) came from this
// shape, mostly Sysco chicken cases whose real weight is ~40 lb per case.
// Flag these shapes as 'pack_size_ambiguous_multipack' so WEIGHT SET excludes
// them rather than reporting inflated pounds.
function isSuspiciousPackSize(rawPackSize) {
  if (!rawPackSize) return false;
  const s = String(rawPackSize).trim().toUpperCase();
  // 3+ leading digits, no separator, ending in "LB" -> almost certainly a
  // dropped-slash multi-pack. A single case >100 lb is possible (Sysco pork
  // whole primal, brisket) but the shape appears reliably as 'NN LB' or 'N/M
  // LB' in the same dataset when it's legitimate.
  if (/^\d{3,}\s?LB$/i.test(s)) return true;
  // 4+ digits followed by OZ implies a dropped-slash multi-pack (e.g. "2420
  // OZ" = "24/20 OZ" = 480 oz = 30 lb). Legitimate single-case OZ shapes
  // like "10 OZ" or "125 OZ" (a large jar) exist; require 4+ digits.
  if (/^\d{4,}\s?OZ$/i.test(s)) return true;
  // Similar for GAL and FOZ (volumes) - handled separately by volume filter
  // but flag here for consistency when treated as weight.
  return false;
}
let wt_by_method = {};
let food_by_verdict = {};
let suspiciousCount = 0;
for (const r of live) {
  let wt = resolveWeightForRow(r, { catalogLookup });
  if (wt.resolution_method === "pack_size:single_weight" && isSuspiciousPackSize(r.pack_size)) {
    suspiciousCount += 1;
    wt = { ...wt, weight_lb: null, resolution_method: "pack_size_ambiguous_multipack", confidence: "n/a" };
  }
  r._wt_resolution = wt;
  const hdr = headerMap.get(r.invoice_uuid);
  const cls = classifyLine(r, hdr);
  r._food = cls;
  wt_by_method[wt.resolution_method] = (wt_by_method[wt.resolution_method] || 0) + 1;
  food_by_verdict[cls.verdict] = (food_by_verdict[cls.verdict] || 0) + 1;
}
console.log("[load] suspicious pack_size rows quarantined:", suspiciousCount);

console.log("\n[load] weight resolution methods:");
for (const [m, n] of Object.entries(wt_by_method).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${n} (${round((n / live.length) * 100, 1)}%)`);
}
console.log("\n[load] food verdicts:");
for (const [v, n] of Object.entries(food_by_verdict).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v}: ${n} (${round((n / live.length) * 100, 1)}%)`);
}

// Serialize a stripped copy - only fields the workbook needs.
const compact = live.map((r) => ({
  id: r.id,
  account_key: r.account_key,
  account_label: ACCOUNT_LABEL[r.account_key],
  invoice_uuid: r.invoice_uuid,
  invoice_date: r._invoice_date_norm,
  invoice_date_raw: r.invoice_date,
  drift_recovered: !!r._drift_recovered,
  month: r._invoice_date_norm ? r._invoice_date_norm.slice(0, 7) : null,
  vendor_id: r.vendor_id,
  vendor_name: r.vendor_name,
  description: r.description,
  description_norm: (r.description || "").trim().toUpperCase(),
  item_number: r.item_number,
  category: r.category,
  quantity: Number(r.quantity) || 0,
  unit: r.unit,
  unit_price: Number(r.unit_price) || 0,
  extended_price: Number(r.extended_price) || 0,
  pack_size: r.pack_size,
  uom_raw: r.uom_raw,
  shipped_count: r.shipped_count,
  ordered_count: r.ordered_count,
  weight_line_value: r.weight_line_value,
  catch_weight_marker: r.catch_weight_marker,
  needs_review: r.needs_review,
  review_reason: r.review_reason,
  is_historical: r.is_historical,
  parsed_weight_lb: r._wt_resolution.weight_lb,
  parsed_weight_source: r._wt_resolution.resolution_method,
  parsed_weight_confidence: r._wt_resolution.confidence,
  qty_used: r._wt_resolution.qty,
  qty_source: r._wt_resolution.quantity_source,
  is_food: r._food.is_food,
  food_verdict: r._food.verdict,
  food_disagreement: r._food.disagreement,
  food_signals: r._food.signals,
}));

// Also persist headers subset
const headersCompact = [...headerMap.values()].map((h) => ({
  id: h.id,
  status: h.status,
  total_amount: Number(h.total_amount) || 0,
  gl_breakdown: h.gl_breakdown,
  invoice_date: h.invoice_date,
  vendor_name: h.vendor_name,
}));

fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      window_label: WINDOW_LABEL,
      window_start: WINDOW_START,
      window_end: WINDOW_END,
      accounts: ACCOUNTS.map((k) => ({ key: k, label: ACCOUNT_LABEL[k] })),
      drift_recovered: driftRecovered,
      orphan_excluded: orphanCount,
      row_count: compact.length,
      rows: compact,
      headers: headersCompact,
    },
    null,
    2
  )
);
console.log("\n[load] wrote", OUT_JSON, `(${compact.length} rows, ${headersCompact.length} headers)`);
