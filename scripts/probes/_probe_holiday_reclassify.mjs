#!/usr/bin/env node
// Read-only probe. Loads live pay segments + wage map + earning map,
// calls classifyBucket on each, reports:
//   - total attributed live segments evaluated
//   - count reclassified (regular -> double_time)
//   - external_ids of every reclassified segment with ratio
//   - count unevaluable (regular + base wage missing)
//
// Does NOT write to the database. Does NOT run derive. Does NOT touch
// labor_actuals or labor_actuals_daily.

import { createClient } from "@supabase/supabase-js";
import { classifyBucket, loadBaseHourlyWages, HOLIDAY_DOUBLE_RATE_RATIO } from "../../src/lib/labor/earningBucket.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function fetchAll(table, columns, filters = {}) {
  const PAGE = 1000;
  let from = 0;
  const out = [];
  while (true) {
    let q = supa.from(table).select(columns).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const r = await q;
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    const rows = r.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Mirror derive's input scope: use presence to pick the LIVE pay-segment
// generation; use the latest workers view for current dept; use the
// department map (non-container) for account attribution. The probe
// should see exactly what the derive sees - without this filter the
// unevaluable baseline doesn't match either derive's own.
console.log(`[probe] loading presence + segments + workers + map + wages + earning_type_map`);

const presenceRows = await fetchAll(
  "rippling_current_presence",
  "rippling_id",
  { kind: "pay_segments" }
);
const presenceSet = new Set(presenceRows.map(r => r.rippling_id));
console.log(`  presence · pay_segments = ${presenceSet.size}`);

const segsAll = await fetchAll(
  "rippling_raw_pay_segments_latest",
  "rippling_id, payload"
);
const liveSegs = segsAll.filter(s => presenceSet.has(s.rippling_id));
console.log(`  raw pay_segments (latest) = ${segsAll.length}  live = ${liveSegs.length}`);

const workerRows = await fetchAll("rippling_raw_workers_latest", "payload");
const workerToDept = new Map();
for (const w of workerRows) {
  const id = w.payload?.id;
  const dept = w.payload?.department_id || null;
  if (id) workerToDept.set(id, dept);
}
console.log(`  workers_latest = ${workerToDept.size}`);

const deptRows = await fetchAll(
  "rippling_department_map",
  "department_id, department_name, account_key, pnl_line, is_container"
);
const deptMap = new Map(deptRows.map(d => [d.department_id, d]));
console.log(`  department_map = ${deptMap.size}`);

const etRows = await fetchAll(
  "earning_type_map",
  "merged_earning_type_name, bucket"
);
const earningMap = new Map(etRows.map(r => [r.merged_earning_type_name, r]));
console.log(`  earning_type_map = ${earningMap.size}`);

const wageMap = await loadBaseHourlyWages(supa);
console.log(`  base hourly wages resolved for ${wageMap.size} workers`);

// Run classify on every attributed live segment. Mirrors deriveActuals'
// attribute() guard: skip when worker not found, no dept, or dept is a
// container. CORP is a department that MAPS to CORP account - still
// "attributed" from classifyBucket's point of view; the derive drops
// those later. We count them to stay faithful to the classifier scope.
let evaluated = 0;
let skippedUnattr = 0;
let unevaluableTotal = 0;
let unevaluableRegular = 0;
let reclassifiedCount = 0;
const reclassifiedRows = [];
for (const s of liveSegs) {
  const p = s.payload || {};
  const workerId = p.owner_role?.id;
  if (!workerId) { skippedUnattr++; continue; }
  const deptId = workerToDept.get(workerId);
  if (!deptId) { skippedUnattr++; continue; }
  const dept = deptMap.get(deptId);
  if (!dept || dept.is_container) { skippedUnattr++; continue; }

  const etName = p.merged_earning_type_name || null;
  const mapEntry = etName ? earningMap.get(etName) : null;
  const baseWage = wageMap.get(workerId) ?? null;

  const v = classifyBucket({
    segmentPayload: p,
    mapEntry,
    baseHourlyWage: baseWage,
  });
  evaluated++;
  if (v.unevaluable) {
    unevaluableTotal++;
    if ((mapEntry?.bucket || "premium_other") === "regular") unevaluableRegular++;
  }
  if (v.reclassified) {
    reclassifiedCount++;
    reclassifiedRows.push({
      external_id: p.external_id || null,
      account_key: dept.account_key,
      segment_date: p.segment_date,
      ratio: v.ratio,
      et_name: etName,
    });
  }
}

console.log("");
console.log("=== classify output ===");
console.log(`  live segments considered       = ${liveSegs.length}`);
console.log(`  skipped unattributed           = ${skippedUnattr}`);
console.log(`  evaluated                      = ${evaluated}`);
console.log(`  unevaluable (any bucket)       = ${unevaluableTotal}`);
console.log(`  unevaluable (regular-mapped)   = ${unevaluableRegular}`);
console.log(`  reclassified regular -> double = ${reclassifiedCount}`);
console.log("");
console.log(`=== reclassified external_ids (expect 5 per Kevin's fixture) ===`);
for (const r of reclassifiedRows.sort((a, b) => (a.segment_date || "").localeCompare(b.segment_date || ""))) {
  console.log(`  ${r.external_id}  ${r.segment_date}  ${r.account_key.padEnd(16)}  ratio=${r.ratio.toFixed(4)}  (was: ${r.et_name})`);
}

// Expected fixture per the brief (test fixture, not hardcoded in the rule).
const EXPECTED = new Set([
  "019e5e5b-35f9-7b25-945e-e009b7cce558_1779699480",
  "019ee01c-4368-77a5-a2c6-c05ff60a21f9_1781876400",
  "019f2daa-34b6-762d-acec-fc8cd2fa3942_1783177560",
  "019f2db3-1bb4-713d-897b-6bcbefe89c81_1783178160",
  "019f2df7-a3ea-7828-bea0-d4413e547276_1783182600",
]);
const got = new Set(reclassifiedRows.map(r => r.external_id));
const missing = [...EXPECTED].filter(x => !got.has(x));
const extra = [...got].filter(x => !EXPECTED.has(x));
console.log("");
console.log(`fixture match: ${missing.length === 0 && extra.length === 0 ? "PASS" : "FAIL"}`);
if (missing.length) console.log(`  missing: ${missing.join(", ")}`);
if (extra.length) console.log(`  extra:   ${extra.join(", ")}`);
