#!/usr/bin/env node
// Read-only probe for the holiday-double-time reclassifier.
//
// MUST mirror the derive's input pipeline exactly (Kevin ruling
// 2026-10-05 post PR-1233 review). Earlier version read
// rippling_raw_pay_segments_latest which does DISTINCT ON rippling_id,
// not DISTINCT ON external_id - the derive's dedupePaySegments collapses
// by external_id. The _latest-based probe silently dropped every VARIED-
// worker segment (33 live workers, 2,673 live segments) and reported
// 0 unevaluable while the derive would have flagged 537 on its next
// run. A probe that contradicts the helper is not evidence; this
// rewrite calls the same shared helpers the derive calls.
//
// Does NOT write to the database. Does NOT run the derive.

import { createClient } from "@supabase/supabase-js";
import { dedupePaySegments } from "../../src/lib/labor/paySegmentDedupe.js";
import { classifyBucket, loadBaseHourlyWages } from "../../src/lib/labor/earningBucket.js";

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

console.log(`[probe] loading raw pay segments + presence + dedupe (derive pipeline)`);

// Step 1 · raw pay_segments. The derive reads from the raw table
// (not _latest) so dedupePaySegments can see every observation and
// collapse by external_id. Reading _latest here would mis-count any
// external_id whose latest observation is not what presence points to.
const paySegsRaw = await fetchAll("rippling_raw_pay_segments", "rippling_id, payload");
console.log(`  raw rows = ${paySegsRaw.length}`);

const presenceRows = await fetchAll(
  "rippling_current_presence",
  "rippling_id",
  { kind: "pay_segments" }
);
const presenceSet = new Set(presenceRows.map(r => r.rippling_id));
console.log(`  presence · pay_segments = ${presenceSet.size}`);

// Step 2 · the derive's own dedupe helper. One source of truth, no
// parallel implementation.
const dedupeOut = dedupePaySegments(paySegsRaw, presenceSet);
const paySegs = dedupeOut.segments;
console.log(`  post-dedupe segments = ${paySegs.length}`);
console.log(`    (presence passthrough: ${dedupeOut.stats.liveInPresence}, dedup collapsed: ${dedupeOut.stats.dedupDropped}, noExtId: ${dedupeOut.stats.noExtId})`);

// Step 3 · the derive's attribution lookups.
const workerRows = await fetchAll("rippling_raw_workers_latest", "payload");
const workerToDept = new Map();
for (const w of workerRows) {
  const id = w.payload?.id;
  const dept = w.payload?.department_id || null;
  if (id) workerToDept.set(id, dept);
}

const deptRows = await fetchAll(
  "rippling_department_map",
  "department_id, department_name, account_key, pnl_line, is_container"
);
const deptMap = new Map(deptRows.map(d => [d.department_id, d]));

const etRows = await fetchAll(
  "earning_type_map",
  "merged_earning_type_name, bucket"
);
const earningMap = new Map(etRows.map(r => [r.merged_earning_type_name, r]));

// Step 4 · wage map, from the shared helper the derive calls.
const wageMap = await loadBaseHourlyWages(supa);
console.log(`  base hourly wages resolved for ${wageMap.size} workers`);
console.log("");

// Mirror the derive's attribute() guard: skip CORP, D26 salaried-only,
// unknown workers, container depts, accounts with no hourly line.
// Those segments never reach classifyBucket in the derive, so the probe
// cannot count them toward the unevaluable guard either.
const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const accountToHourlyLine = new Map();
for (const d of deptRows) {
  if (d.is_container) continue;
  if (d.pnl_line !== "3100.1") continue;
  if (!d.account_key) continue;
  accountToHourlyLine.set(d.account_key, d.pnl_line);
}
function attribute(workerId) {
  if (!workerId) return { reason: "unknown_worker" };
  if (!workerToDept.has(workerId)) return { reason: "unknown_worker", workerId };
  const deptId = workerToDept.get(workerId);
  if (!deptId) return { reason: "no_worker_department", workerId };
  const d = deptMap.get(deptId);
  if (!d) return { reason: "unknown_department", workerId, deptId };
  if (d.is_container) return { reason: "container_leak", workerId, deptId };
  if (d.account_key === "CORP") return null;
  if (D26_SALARIED_ONLY.has(d.account_key)) return null;
  const hourlyLine = accountToHourlyLine.get(d.account_key);
  if (!hourlyLine) return { reason: "account_has_no_hourly_line", workerId, deptId };
  return { account_key: d.account_key, line_code: hourlyLine };
}

// Classify every attributed, post-dedupe live segment.
let considered = 0;
let skippedAttr = 0;
let evaluated = 0;
let unevaluableAny = 0;
let unevaluableRegular = 0;
let reclassifiedCount = 0;
const reclassifiedRows = [];
const unevaluableWorkers = new Set();
const unevaluableRegularWorkers = new Set();

for (const s of paySegs) {
  const p = s.payload || {};
  considered++;
  const workerId = p.owner_role?.id;
  const attr = attribute(workerId);
  if (attr === null || attr?.reason) { skippedAttr++; continue; }

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
    unevaluableAny++;
    unevaluableWorkers.add(workerId);
    const defaultBucket = mapEntry?.bucket || "premium_other";
    if (defaultBucket === "regular") {
      unevaluableRegular++;
      unevaluableRegularWorkers.add(workerId);
    }
  }
  if (v.reclassified) {
    reclassifiedCount++;
    reclassifiedRows.push({
      external_id: p.external_id || null,
      account_key: attr.account_key,
      segment_date: p.segment_date,
      ratio: v.ratio,
      et_name: etName,
    });
  }
}

console.log("=== classify output ===");
console.log(`  post-dedupe segments considered    = ${considered}`);
console.log(`  skipped at attribute()              = ${skippedAttr}`);
console.log(`  reached classifyBucket              = ${evaluated}`);
console.log(`  reclassified regular -> double_time = ${reclassifiedCount}`);
console.log(`  unevaluable (any bucket)            = ${unevaluableAny}  (distinct workers: ${unevaluableWorkers.size})`);
console.log(`  unevaluable (regular-mapped)        = ${unevaluableRegular}  (distinct workers: ${unevaluableRegularWorkers.size})`);
console.log("");
console.log(`=== reclassified external_ids (expect 5 per Kevin's fixture) ===`);
for (const r of reclassifiedRows.sort((a, b) => (a.segment_date || "").localeCompare(b.segment_date || ""))) {
  console.log(`  ${r.external_id}  ${r.segment_date}  ${r.account_key.padEnd(16)}  ratio=${r.ratio.toFixed(4)}  (was: ${r.et_name})`);
}

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
