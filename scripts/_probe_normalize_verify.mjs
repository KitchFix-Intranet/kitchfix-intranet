// scripts/_probe_normalize_verify.mjs
//
// Local verify: pull raw JSONB from rippling_raw_spend_lines_latest and
// re-project through the fixed normalizer. Report counts of non-null
// amount + non-null category_id, plus any parse errors.
//
// This walks the same code path as the fixed sync's normalizeSpendLine
// (importing it via a small extraction shim), but does not write.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Inline the FIXED normalizer for the verify (identical logic to
// scripts/purchasing_rippling_sync.mjs post-fix).
function pickNested(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v && typeof v === "object") return v;
  }
  return null;
}
function pickScalar(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}
function normalizeSpendLine(row) {
  const department  = pickNested(row, ["department"]);
  const workLoc     = pickNested(row, ["work_location"]);
  const parentTxn   = pickNested(row, ["parent_txn", "spend_transaction", "spend_transaction_zo", "parent"]);
  let categoryId = null;
  const rawCat = row?.category;
  if (typeof rawCat === "string" && rawCat.length > 0) categoryId = rawCat;
  else if (rawCat && typeof rawCat === "object") categoryId = rawCat.id || null;
  if (!categoryId) categoryId = pickScalar(row, ["category_id"]) || null;
  let amount = null;
  const rawAmt = row?.amount;
  if (rawAmt && typeof rawAmt === "object" && !Array.isArray(rawAmt)) {
    const v = rawAmt.value;
    if (v != null && v !== "") {
      const parsed = Number(v);
      if (!Number.isFinite(parsed)) throw new Error(`amount unparseable rippling_id=${row.id} v=${JSON.stringify(v)}`);
      amount = parsed;
    }
  } else {
    const scalarAmt = pickScalar(row, ["amount", "total_amount", "line_amount"]);
    if (scalarAmt != null) {
      const p = Number(scalarAmt);
      amount = Number.isFinite(p) ? p : null;
    }
  }
  return { rippling_id: String(row.id), amount, category_id: categoryId, department_id: department?.id, work_location_id: workLoc?.id, parent_txn_id: parentTxn?.id };
}

// Fetch all 10,789 raw rows
async function fetchAll() {
  const rows = [];
  let from = 0;
  const CHUNK = 500;
  while (true) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id, raw").range(from, from + CHUNK - 1);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return rows;
}

const rows = await fetchAll();
console.log(`fetched ${rows.length} rows`);

let nonNullAmount = 0;
let nonNullCategory = 0;
let totalAmount = 0;
const catIds = new Set();
let parseErrors = 0;
for (const r of rows) {
  try {
    const n = normalizeSpendLine(r.raw);
    if (n.amount != null) { nonNullAmount++; totalAmount += n.amount; }
    if (n.category_id) { nonNullCategory++; catIds.add(n.category_id); }
  } catch (e) {
    parseErrors++;
    console.error(`parse error: ${e.message}`);
  }
}
console.log(`\nafter fixed normalizer:`);
console.log(`  non-null amount:     ${nonNullAmount} / ${rows.length}`);
console.log(`  non-null category:   ${nonNullCategory} / ${rows.length}`);
console.log(`  distinct category ids: ${catIds.size}`);
console.log(`  parse errors:        ${parseErrors}`);
console.log(`  sum(amount):         $${totalAmount.toFixed(2)}   (verify-only, not persisted)`);
