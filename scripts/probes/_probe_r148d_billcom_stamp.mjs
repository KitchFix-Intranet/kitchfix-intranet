#!/usr/bin/env node
// R-148D pre-sweep · stamp reason='gl_not_on_board' on the 97 billcom
// rows currently carrying excluded=true, reason=null. Kevin ruling
// 2026-09-24: a GL code outside the board's chart of accounts is
// correctly excluded (the board exists to help a site operator hit
// budget; anything else is noise). The current billcom derive sets
// excluded=true via the class map but never stamps a reason. This
// script backfills the reason on the 97 in-scope rows.
//
// DELETE + INSERT-marker pattern (service_role has SELECT/INSERT/
// DELETE only, no UPDATE). Reversal file at scripts/probes/artifacts/
// r148d_billcom_reversal.json is committable (source_line_id + old
// reason only, no dollars/vendors/employees).
//
// Same safety pattern as R-148B / R-148D card auth sweeps: constraint
// precheck, reversal-first, abort-on-first-failure, leakage assertion.
//
// Usage:
//   node --env-file=.env.local scripts/probes/_probe_r148d_billcom_stamp.mjs           # dry-run
//   node --env-file=.env.local scripts/probes/_probe_r148d_billcom_stamp.mjs --execute # write

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const execute = process.argv.includes("--execute");
const KEY_URL = process.env.SUPABASE_URL;
const KEY_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY_URL || !KEY_SVC) { console.error("env missing"); process.exit(1); }
const s = createClient(KEY_URL, KEY_SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const ARTIFACT_DIR    = path.join(__dirname, "artifacts");
const REVERSAL_PATH   = path.join(ARTIFACT_DIR, "r148d_billcom_reversal.json");
const REVIEW_PATH     = process.env.R148D_BILLCOM_REVIEW_PATH
  || path.join(homedir(), "Downloads", "kf-r148d-billcom-review.json");
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

console.log(`R-148D billcom stamp · ${execute ? "EXECUTE" : "DRY-RUN"}`);
console.log();

// Load all 97 (verify count exactly)
const PAGE = 1000;
async function pageAll(t, sel, filt = q => q) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = filt(s.from(t).select(sel).range(from, from + PAGE - 1));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const rows = await pageAll(
  "purchasing_actuals",
  "id, source, source_line_id, source_bill_id, account_key, gl_line_code, gl_bucket, amount, txn_date, posting_date, paid, approx_date, vendor_or_merchant, excluded, reason",
  q => q.eq("source", "billcom").eq("excluded", true).is("reason", null),
);
console.log(`  loaded ${rows.length} candidate rows`);
if (rows.length === 0) { console.log("  nothing to stamp · no-op"); process.exit(0); }

// Constraint precheck (mirrors R-148B/R-148D)
const VALID_SOURCES = new Set(["billcom", "billcom_credit", "rippling_spend", "upload"]);
const buildMarker = orig => ({
  source:             orig.source,
  source_line_id:     orig.source_line_id,
  source_bill_id:     orig.source_bill_id,
  account_key:        null,     // already null on the original per excluded_shape; preserved
  gl_line_code:       orig.gl_line_code,
  gl_bucket:          orig.gl_bucket,
  amount:             orig.amount,
  txn_date:           orig.txn_date,
  posting_date:       orig.posting_date,
  vendor_or_merchant: orig.vendor_or_merchant,
  paid:               orig.paid,
  approx_date:        orig.approx_date,
  excluded:           true,
  reason:             "gl_not_on_board",
});
let cshape_bad = [];
for (const r of rows) {
  const m = buildMarker(r);
  const ok_excluded = !(m.excluded === true && m.account_key !== null);
  const ok_reason   = m.reason === null || m.excluded === true;
  const ok_source   = VALID_SOURCES.has(m.source);
  const ok_source_nn = m.source != null;
  const ok_sli_nn    = m.source_line_id != null;
  const ok_amount_nn = m.amount != null;
  const ok_amount_preserved  = Number(m.amount) === Number(r.amount);
  const ok_txndate_preserved = m.txn_date === r.txn_date;
  const all = ok_excluded && ok_reason && ok_source && ok_source_nn && ok_sli_nn && ok_amount_nn && ok_amount_preserved && ok_txndate_preserved;
  if (!all) cshape_bad.push({ pa_id: r.id, ok_excluded, ok_reason, ok_source, ok_source_nn, ok_sli_nn, ok_amount_nn, ok_amount_preserved, ok_txndate_preserved });
}
if (cshape_bad.length > 0) {
  console.error(`  HALT · ${cshape_bad.length} markers would fail a PA constraint or drop a load-bearing column`);
  process.exit(2);
}
console.log(`  constraint-precheck · ${rows.length}/${rows.length} markers pass`);

// Write reversal file BEFORE any DELETE
const reversal = {
  brief_ref: "R-148D pre-sweep · billcom gl_not_on_board stamp · Kevin ruling 2026-09-24",
  schema_version: 1,
  reason_before: null,
  reason_after: "gl_not_on_board",
  swept_at: new Date().toISOString(),
  retirements: rows.map(r => ({
    source_line_id: r.source_line_id,
  })).sort((a, b) => a.source_line_id.localeCompare(b.source_line_id)),
};
fs.writeFileSync(REVERSAL_PATH, JSON.stringify(reversal, null, 2));
const review = {
  generated_at: new Date().toISOString(),
  brief_ref: "R-148D pre-sweep · billcom stamp",
  rows: rows.map(r => ({
    id: r.id, source_line_id: r.source_line_id, source_bill_id: r.source_bill_id,
    gl_line_code: r.gl_line_code, amount: Number(r.amount), txn_date: r.txn_date,
    vendor_or_merchant: r.vendor_or_merchant,
  })),
};
fs.writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2));
console.log(`  wrote reversal ${REVERSAL_PATH} + review ${REVIEW_PATH}`);

if (!execute) {
  console.log(`  dry-run · would stamp ${rows.length} rows · no write`);
  process.exit(0);
}

let stamped = 0, deleted = 0, inserted = 0;
for (const r of rows) {
  const del = await s.from("purchasing_actuals").delete().eq("id", r.id);
  if (del.error) { console.error(`  DELETE FAIL id=${r.id} · ${del.error.message}`); break; }
  deleted += 1;
  const ins = await s.from("purchasing_actuals").insert([buildMarker(r)]);
  if (ins.error) { console.error(`  INSERT FAIL after DELETE id=${r.id} sli=${r.source_line_id} · ${ins.error.message}`); break; }
  inserted += 1;
  stamped += 1;
}
if (deleted !== inserted) { console.error(`  HALT leakage · deleted=${deleted} inserted=${inserted}`); process.exit(3); }
console.log(`  stamped ${stamped}/${rows.length}`);
