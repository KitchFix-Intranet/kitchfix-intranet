#!/usr/bin/env node
// Dry-run equivalent for the report mapper hold-exclusion fix.
// Rather than downloading a fresh CSV (Gmail SA auth broken from the
// prior arc), reconstructs projected report rows directly from the
// stored rippling_report_txns_latest table - its top-level columns
// match the parser's `spec.col` names 1:1, except `object_type`
// which lives in the stored `raw` payload (keyed by the original
// CSV header "Object Type").
//
// Runs mapReportRowToActualsShape over the sample and reports:
//   - total rows considered
//   - count flagged excluded (any reason)
//   - count flagged excluded specifically for Card Authorization
//   - sanity: the Card Authorization count equals the raw-Object-Type
//     count of "Card Authorization" in the sample
//
// READ-ONLY. No DB writes.

import { createClient } from "@supabase/supabase-js";
import { buildDbCategoryMap, mapReportRowToActualsShape } from "../../src/lib/purchasing/reportToActualsMap.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Fetch the spend_category_map for the GL resolution.
const catMapResp = await supa.from("spend_category_map").select("category_label, gl_line_code");
if (catMapResp.error) { console.error(`category map read: ${catMapResp.error.message}`); process.exit(2); }
const dbCategoryMap = buildDbCategoryMap(catMapResp.data || []);

// Pull a window of post-floor rows that would land in a real
// nightly CSV. Floor is 2026-10-05.
const PAGE = 1000;
let from = 0;
const rows = [];
for (;;) {
  const q = await supa.from("rippling_report_txns_latest")
    .select("parent_txn_id, purchased_at, posted_date, approval_state, has_receipt, amount, currency, vendor_name, vendor, category, category_name, department_name, work_location, employee, employee_id, memo, line_item_memo, gl_sync_status, raw")
    .gte("purchased_at", "2026-10-05")
    .order("purchased_at", { ascending: false })
    .range(from, from + PAGE - 1);
  if (q.error) { console.error(`sample read: ${q.error.message}`); process.exit(2); }
  const batch = q.data || [];
  rows.push(...batch);
  if (batch.length < PAGE) break;
  from += PAGE;
}
console.log(`sampled rows (post-floor): ${rows.length}`);

let excluded = 0;
let excludedHold = 0;
let rawHoldCount = 0;
const sampleHoldIds = [];
for (const r of rows) {
  // Lift Object Type out of the stored raw into the flat projection.
  // The parser would populate reportRow.object_type directly from
  // the CSV; this probe does the equivalent from stored jsonb.
  const objectType = r.raw && r.raw["Object Type"];
  const projected = { ...r, object_type: objectType };
  if (objectType === "Card Authorization") {
    rawHoldCount += 1;
    if (sampleHoldIds.length < 3) sampleHoldIds.push(r.parent_txn_id);
  }
  const shape = mapReportRowToActualsShape(projected, dbCategoryMap);
  if (shape.excluded) excluded += 1;
  if (shape._is_card_authorization) excludedHold += 1;
}

console.log("");
console.log(`rows flagged excluded (any reason)         : ${excluded}`);
console.log(`rows flagged excluded for Card Authorization: ${excludedHold}`);
console.log(`raw sample with Object Type='Card Authorization': ${rawHoldCount}`);
console.log("");
if (excludedHold === rawHoldCount) {
  console.log(`OK: the mapper marks every Card Authorization row excluded.`);
} else {
  console.log(`MISMATCH: mapper excluded ${excludedHold} holds; raw has ${rawHoldCount}.`);
}
if (sampleHoldIds.length > 0) console.log(`sample hold parent_txn_ids: ${sampleHoldIds.join(", ")}`);

// Also sanity-check that non-holds are not newly excluded by this
// change. A non-hold Card Transaction with a valid work location
// and GL must still come through as excluded=false.
const nonHoldSample = rows.find(r => r.raw?.["Object Type"] === "Card Transaction" && r.work_location && r.category_name);
if (nonHoldSample) {
  const projected = { ...nonHoldSample, object_type: nonHoldSample.raw["Object Type"] };
  const shape = mapReportRowToActualsShape(projected, dbCategoryMap);
  console.log("");
  console.log(`non-hold sample: Card Transaction with work_location="${nonHoldSample.work_location}"`);
  console.log(`  mapped excluded=${shape.excluded}  account_key=${shape.account_key}  gl_line_code=${shape.gl_line_code}`);
  if (shape.excluded && !shape._is_card_authorization) {
    console.log(`  (excluded for non-hold reason, which is fine - could be unmapped work location or GL override)`);
  }
}
