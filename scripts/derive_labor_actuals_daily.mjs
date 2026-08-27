// scripts/derive_labor_actuals_daily.mjs
//
// Day-grain rebuild of labor_actuals_daily. Runs AFTER the weekly
// derive so the reconciliation probe (D1) reads a stable weekly.
// Same input discipline as the weekly:
//
//   1. presence filter FIRST, then dedupe by external_id - via the
//      shared helper in src/lib/labor/paySegmentDedupe.js so the
//      weekly and daily derives cannot drift on the 2026-08-19
//      hotfix contract. A tripled Tuesday reads as a busy Tuesday
//      if we skip the dedupe here (the weekly's hours_regular > 48
//      sanity assert has no day-level analogue).
//   2. attribution identical to the weekly derive - worker.
//      department_id via rippling_department_map, CORP excluded,
//      container departments excluded, D26 3100.1 excluded.
//   3. round only at the end. Full precision through the
//      accumulator; r2() at the row-build step. Per-day rounded
//      sums drop a cent vs the weekly (CIN - OH week of 06/29:
//      $4,328.26 rounded per-day vs $4,328.27 unrounded).
//
// Usage
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=manual --dry-run
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=manual --window=fytd
//
// --window=trailing8 (default) rebuilds the last 8 fiscal weeks.
// --window=fytd rebuilds every day from FY2026 open through today.
//
// Exit codes
//   0  success (or dry-run success)
//   1  configuration error
//   2  derivation error mid-run

import { createClient } from "@supabase/supabase-js";
import { FY_START_ISO } from "../src/app/kpi/labor/lib/periods.js";
import { dedupePaySegments } from "../src/lib/labor/paySegmentDedupe.js";
import { fetchAllOffset, fetchAllKeyset } from "../src/lib/rippling/paginate.js";

// ─── CLI ─────────────────────────────────────────────────────────────
const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const VALID_WINDOWS = new Set(["trailing8", "fytd"]);
function parseArgs(argv) {
  const a = { source: null, dryRun: false, window: "trailing8" };
  for (const x of argv.slice(2)) {
    if      (x.startsWith("--source="))  a.source = x.slice(9);
    else if (x === "--dry-run")          a.dryRun = true;
    else if (x.startsWith("--window="))  a.window = x.slice(9);
    else { console.error("unknown arg: " + x); process.exit(1); }
  }
  return a;
}
const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source required, one of: " + [...VALID_SOURCES].join(", ")); process.exit(1);
}
if (!VALID_WINDOWS.has(args.window)) {
  console.error("--window must be one of: " + [...VALID_WINDOWS].join(", ")); process.exit(1);
}

// ─── Env + Supabase ──────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const runStartISO = new Date().toISOString();
const runSource = `daily/${args.source}/${runStartISO}`;
console.log(`derive_labor_actuals_daily source=${args.source} dryRun=${args.dryRun} window=${args.window} started=${runStartISO}`);

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
// V-daily-grain D3 fix - store to 4 decimal places (matches
// labor_actuals_daily NUMERIC(14,4) after daily-2 precision
// migration). Per-day rounding to 2dp loses cents on the week
// aggregate ($4,328.26 vs $4,328.27 on CIN - OH 06/29); rounding
// to 4dp preserves sub-cent precision through the sum.
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;

// ─── Helpers ─────────────────────────────────────────────────────────
// 2026-08-27 - local fetchAll retired for the same reason as
// deriveActuals.js. Base-table reads use fetchAllOffset; `_latest`
// DISTINCT ON view reads use fetchAllKeyset. See
// src/lib/rippling/paginate.js for the incident rationale.
const fetchAll = (table, sel) => fetchAllOffset(supa, table, sel);
function toDate(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toISO(d)    { return d.toISOString().slice(0, 10); }
function addDaysISO(iso, days) {
  const d = toDate(iso); d.setUTCDate(d.getUTCDate() + days); return toISO(d);
}
function mondayOnOrBefore(iso) {
  const d = toDate(iso);
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return toISO(d);
}

// ─── Window ──────────────────────────────────────────────────────────
const todayISO = new Date().toISOString().slice(0, 10);
let windowStartISO;
if (args.window === "fytd") windowStartISO = FY_START_ISO;
else                        windowStartISO = addDaysISO(mondayOnOrBefore(todayISO), -7 * 8);
const windowEndISO = todayISO;
console.log(`  delete window: ${windowStartISO} .. ${windowEndISO}`);

// ─── V-daily-grain D1 fix - data-derived floor ──────────────────────
// Kevin ruling 2026-08-20: the earliest week where
// labor_actuals.week_source='sc_day_metadata' is the ONLY reachable
// day-grain floor. Weeks before that were backfilled from a Rippling
// REPORT export (totals-only, no per-segment breakdown, retention
// already passed for the underlying segments); they are a permanent
// grain boundary, not a gap we can fill.
//
// The derive REFUSES to write below this floor. Defense at the data
// layer so a future backfill cannot silently reintroduce
// low-confidence rows. Floor is data-derived (not a hardcoded date)
// so the code documents why the boundary exists.
const floorQ = await supa
  .from("labor_actuals")
  .select("week_start")
  .eq("week_source", "sc_day_metadata")
  .order("week_start")
  .limit(1)
  .maybeSingle();
if (floorQ.error) { console.error("floor lookup:", floorQ.error.message); process.exit(2); }
const dailyFloorISO = floorQ.data?.week_start;
if (!dailyFloorISO) { console.error("no sc_day_metadata weeks in labor_actuals - cannot derive day-grain floor"); process.exit(2); }
console.log(`  day-grain floor: ${dailyFloorISO}  (min sc_day_metadata week_start; earlier weeks are rippling_report-backfilled, no segments)`);
// The DELETE still runs on the broader window so pre-floor rows
// from earlier backfills are swept out. Only the INSERT is floored.
const writeFloorISO = dailyFloorISO;

// ─── 1. Load reference maps ─────────────────────────────────────────
console.log("loading earning_type_map, workers, department_map");
const [emRows, workers, deptMap] = await Promise.all([
  fetchAll("earning_type_map",              "merged_earning_type_name, multiplier, bucket"),
  // 2026-08-27 - keyset on rippling_id for _latest views. See
  // src/lib/rippling/paginate.js for the incident rationale.
  fetchAllKeyset(supa, "rippling_raw_workers_latest", "rippling_id, payload"),
  fetchAll("rippling_department_map",       "department_id, account_key, is_container, pnl_line"),
]);
const earningMap = new Map(emRows.map(m => [m.merged_earning_type_name, m]));
const workerToDept = new Map();
for (const w of workers) {
  const wid = w.rippling_id || w.payload?.id;
  if (wid) workerToDept.set(wid, w.payload?.department_id || null);
}
const deptById = new Map();
for (const d of deptMap) deptById.set(d.department_id, d);
console.log(`  earning_types=${earningMap.size} workers=${workers.length} depts=${deptById.size}`);

// ─── 2. Attribution (mirrors weekly deriveActuals.js:attribute) ─────
// Kept in sync with src/lib/labor/deriveActuals.js. If the weekly
// rules change (new D-ruling), update this too - PR-1 does not
// extract this into a shared helper because the weekly attribute
// closes over local bumpUnattr state; a shared version is a
// separate refactor. See docs/KPI_DASHBOARD_PLAYBOOK.md.
function attribute(workerId) {
  if (!workerId) return { reason: "unknown_worker" };
  if (!workerToDept.has(workerId)) return { reason: "unknown_worker", workerId };
  const deptId = workerToDept.get(workerId);
  if (!deptId) return { reason: "no_worker_department", workerId };
  const d = deptById.get(deptId);
  if (!d) return { reason: "unknown_department", workerId, deptId };
  if (d.is_container) return { reason: "container_leak", workerId, deptId };
  if (d.account_key === "CORP") return null;
  if (D26_SALARIED_ONLY.has(d.account_key) && d.pnl_line === "3100.1") return null;
  if (!d.pnl_line) return { reason: "unknown_department", workerId, deptId };
  return { account_key: d.account_key, line_code: d.pnl_line };
}

// ─── 3. Load pay_segments + presence + dedupe (shared helper) ───────
console.log("loading pay_segments (raw) + presence");
const psWalkGlobal = await supa
  .from("rippling_walks")
  .select("completed_at")
  .eq("kind", "pay_segments")
  .eq("status", "success")
  .order("completed_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (psWalkGlobal.error) { console.error("presence walk lookup:", psWalkGlobal.error.message); process.exit(2); }

const presenceSet = new Set();
{
  const PS = 1000;
  let from = 0;
  while (true) {
    const q = await supa.from("rippling_current_presence")
      .select("rippling_id").eq("kind", "pay_segments").range(from, from + PS - 1);
    if (q.error) { console.error("presence load:", q.error.message); process.exit(2); }
    for (const r of q.data || []) presenceSet.add(r.rippling_id);
    if ((q.data || []).length < PS) break;
    from += PS;
  }
}
console.log(`  presence holds ${presenceSet.size} pay-segment ids`);

const paySegsRaw = await fetchAll("rippling_raw_pay_segments", "rippling_id, payload");
const dedupeOut = dedupePaySegments(paySegsRaw, presenceSet);
const paySegs = dedupeOut.segments;
console.log(`  raw=${dedupeOut.stats.raw} live-in-presence=${dedupeOut.stats.liveInPresence} orphan=${dedupeOut.stats.orphan}`);
console.log(`  external_id dedup: ${dedupeOut.stats.liveInPresence} -> ${paySegs.length} (${dedupeOut.stats.dedupDropped} rippling_id re-issues collapsed; ${dedupeOut.stats.noExtId} carry no external_id)`);

// ─── 4. Accumulate per (account, worker, work_date, line) ───────────
const buckets = new Map();   // key -> { hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, segment_count }
function getBucket(account_key, worker_id, work_date, line_code) {
  const k = `${account_key}|${worker_id}|${work_date}|${line_code}`;
  let b = buckets.get(k);
  if (!b) {
    b = {
      account_key, worker_id, work_date, line_code,
      hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      amount: 0, segment_count: 0,
    };
    buckets.set(k, b);
  }
  return b;
}

let skippedCorp = 0, skippedContainer = 0, skippedUnattr = 0, skippedOutOfWindow = 0, skippedNoDate = 0, skippedBelowFloor = 0;
for (const seg of paySegs) {
  const p = seg.payload || {};
  const workerId = p.owner_role?.id;
  const segDate = p.segment_date;
  if (!segDate) { skippedNoDate++; continue; }
  if (segDate < windowStartISO || segDate > windowEndISO) { skippedOutOfWindow++; continue; }
  // V-daily-grain D1 fix - reject sub-floor writes at the derive.
  // See dailyFloorISO computation above for the rationale.
  if (segDate < writeFloorISO) { skippedBelowFloor++; continue; }

  const attr = attribute(workerId);
  if (attr === null) { skippedCorp++; continue; }
  if (attr.reason) {
    if (attr.reason === "container_leak") skippedContainer++;
    else skippedUnattr++;
    continue;
  }

  const b = getBucket(attr.account_key, workerId, segDate, attr.line_code);
  const hrs = Number(p.segment_duration_hours || 0);
  const amt = Number(p.estimated_amount || 0);
  b.amount += amt;
  b.segment_count++;

  const etName = p.merged_earning_type_name || null;
  const mapEntry = etName ? earningMap.get(etName) : null;
  if (!mapEntry) {
    b.hours_premium_other += hrs;
    b.dollars_premium_other += amt;
  } else if (mapEntry.bucket === "regular") {
    b.hours_regular += hrs;
    b.dollars_regular += amt;
  } else if (mapEntry.bucket === "overtime") {
    b.hours_overtime += hrs;
    b.dollars_overtime += amt;
  } else if (mapEntry.bucket === "double_time") {
    b.hours_double_time += hrs;
    b.dollars_double_time += amt;
  } else {
    b.hours_premium_other += hrs;
    b.dollars_premium_other += amt;
  }
}
console.log(`  buckets: ${buckets.size}`);
console.log(`  skipped: corp=${skippedCorp} container=${skippedContainer} unattr=${skippedUnattr} out_of_window=${skippedOutOfWindow} no_date=${skippedNoDate} below_floor=${skippedBelowFloor}`);

// ─── 5. Build rows (round ONLY here) ────────────────────────────────
const derivedAt = new Date().toISOString();
const rows = [];
// Hours stay at 2dp (integer-ish input from Rippling; 2dp is
// well within stored NUMERIC(10,2) precision). Dollars round to
// 4dp per D3 fix - see r4 declaration above.
const h2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
for (const b of buckets.values()) {
  rows.push({
    account_key:           b.account_key,
    worker_id:             b.worker_id,
    work_date:             b.work_date,
    line_code:             b.line_code,
    hours_regular:         h2(b.hours_regular),
    hours_overtime:        h2(b.hours_overtime),
    hours_double_time:     h2(b.hours_double_time),
    hours_premium_other:   h2(b.hours_premium_other),
    dollars_regular:       r4(b.dollars_regular),
    dollars_overtime:      r4(b.dollars_overtime),
    dollars_double_time:   r4(b.dollars_double_time),
    dollars_premium_other: r4(b.dollars_premium_other),
    amount:                r4(b.amount),
    segment_count:         b.segment_count,
    derived_at:            derivedAt,
    source_run:            runSource,
    source:                args.source,
  });
}
console.log(`  rows to write: ${rows.length}`);

// ─── 6. Write - DELETE window, then INSERT batches ─────────────────
if (args.dryRun) {
  console.log(`DRY RUN: would DELETE work_date in [${windowStartISO}, ${windowEndISO}] then INSERT ${rows.length} rows`);
} else {
  console.log(`deleting existing rows in window ${windowStartISO} .. ${windowEndISO}`);
  const del = await supa.from("labor_actuals_daily").delete()
    .gte("work_date", windowStartISO).lte("work_date", windowEndISO);
  if (del.error) { console.error(`delete failed: ${del.error.message}`); process.exit(2); }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const ins = await supa.from("labor_actuals_daily").insert(chunk);
    if (ins.error) { console.error(`insert failed at offset ${i}: ${ins.error.message}`); process.exit(2); }
    written += chunk.length;
  }
  console.log(`  inserted ${written} rows`);
}

console.log(`derive_labor_actuals_daily done source=${args.source} finished=${new Date().toISOString()}`);
