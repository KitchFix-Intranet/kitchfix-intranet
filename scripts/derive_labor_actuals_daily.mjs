// scripts/derive_labor_actuals_daily.mjs
//
// labor-te-2 (2026-10-16). Day-grain rebuild of labor_actuals_daily
// sourced from rippling_raw_time_entries. Clamped to
// TIME_ENTRY_SOURCE_FLOOR: no pre-floor row is ever deleted or
// rewritten, so the frozen pay-segments-era rows
// (2026-04-20..2026-10-04) stay exactly as they were on 2026-10-06.
//
// Shares the compute with the weekly derive via
// src/lib/labor/timeEntriesDerive.js. One source of truth for hours,
// dollars, rate resolution, and attribution - the grain probe D1
// reconciliation only ties if the two derives match.
//
// The DELETE is bounded by work_date range; both --window=trailing8
// and --window=fytd land their effective start at
// max(windowStart, TIME_ENTRY_SOURCE_FLOOR). The script refuses to
// touch any day earlier than the floor even if a payload accidentally
// carries one.
//
// Usage:
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=manual --window=fytd
//   node --env-file=.env.local scripts/derive_labor_actuals_daily.mjs --source=manual --dry-run
//
// Exit codes
//   0  success (or dry-run success)
//   1  configuration error
//   2  derivation error mid-run
//   3  pre-flight failed (unpriced entries, below-floor payload)

import { createClient } from "@supabase/supabase-js";
import { FY_START_ISO } from "../src/app/kpi/labor/lib/periods.js";
import { TIME_ENTRY_SOURCE_FLOOR } from "../src/lib/kpi/floors.js";
import {
  KNOWN_STATUSES,
  localDate,
  loadReferenceData,
  loadTimeEntries,
  makeAttribute,
  makeResolveRate,
  computeEntryHoursAndDollars,
} from "../src/lib/labor/timeEntriesDerive.js";

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
console.log(`SUPABASE_URL: ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("missing env"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const runStartISO = new Date().toISOString();
const t0 = Date.now();
const runSource = `daily/${args.source}/${runStartISO}`;
console.log(`derive_labor_actuals_daily source=${args.source} dryRun=${args.dryRun} window=${args.window} started=${runStartISO}`);
console.log(`floor: TIME_ENTRY_SOURCE_FLOOR = ${TIME_ENTRY_SOURCE_FLOOR}`);

// ─── Window + clamp ──────────────────────────────────────────────────
function toDate(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toISO(d) { return d.toISOString().slice(0, 10); }
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

const todayISO = new Date().toISOString().slice(0, 10);
const rawWindowStartISO = args.window === "fytd"
  ? FY_START_ISO
  : addDaysISO(mondayOnOrBefore(todayISO), -7 * 8);
// labor-te-2 clamp: never reach past the floor. Both the DELETE and the
// row set must respect it. The weekly table's pre-floor era is owned
// by the pay-segments derive and is frozen; the daily table's pre-floor
// era is likewise owned by the (now-frozen) pay-segments daily derive.
// Touching either from the time-entries source is the same class of
// damage labor-te-1 was built to prevent, arriving by a different door.
const windowStartISO = rawWindowStartISO < TIME_ENTRY_SOURCE_FLOOR
  ? TIME_ENTRY_SOURCE_FLOOR
  : rawWindowStartISO;
const windowEndISO = todayISO;
console.log(`  raw window start:       ${rawWindowStartISO}`);
console.log(`  effective window start: ${windowStartISO}  ${windowStartISO === TIME_ENTRY_SOURCE_FLOOR ? "(CLAMPED to floor)" : ""}`);
console.log(`  effective window end:   ${windowEndISO}`);
console.log(`  delete window:          ${windowStartISO} .. ${windowEndISO}`);

// ─── Load reference data (shared) ────────────────────────────────────
console.log("\nloading reference data...");
const ref = await loadReferenceData(supa);
console.log(`  presence time_entries: ${ref.counts.presenceTe}`);
console.log(`  presence compensations: ${ref.counts.presenceComp}`);
console.log(`  dept map: ${ref.counts.deptMap}, accounts with 3100.1: ${ref.counts.accountToHourlyLine}`);
console.log(`  workers: ${ref.counts.workers}`);
console.log(`  hourly wage resolved for: ${ref.counts.workerToWage} workers`);

const attribute = makeAttribute(ref);
const resolveRate = makeResolveRate(ref);

// ─── Load time entries + dedupe (shared) ─────────────────────────────
console.log("\nloading rippling_raw_time_entries_latest...");
const { timeEntries, counts: teCounts } = await loadTimeEntries(supa, ref.presenceTe);
console.log(`  rows: ${teCounts.latest}  live-in-presence: ${teCounts.liveInPresence}  deduped: ${timeEntries.length}`);

// ─── Accumulate per (account, worker, work_date, line) ──────────────
const buckets = new Map();
function getBucket(account_key, worker_id, work_date, line_code) {
  const k = `${account_key}|${worker_id}|${work_date}|${line_code}`;
  let b = buckets.get(k);
  if (!b) {
    b = {
      account_key, worker_id, work_date, line_code,
      hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      amount: 0, entry_count: 0,
    };
    buckets.set(k, b);
  }
  return b;
}

let skippedPreFloor = 0, skippedOutOfWindow = 0, skippedUnattr = 0;
let skippedUnknownStatus = 0, skippedNoStartDate = 0;
let rateFromSegment = 0, rateFromWage = 0, rateNone = 0;
const unpricedEntries = [];

for (const te of timeEntries) {
  const p = te.payload || {};
  const workerId = p.worker_id;
  const workDate = localDate(p.start_time);
  if (!workerId || !workDate) { skippedNoStartDate++; continue; }
  // Clamp enforcement: never process below the floor.
  if (workDate < TIME_ENTRY_SOURCE_FLOOR) { skippedPreFloor++; continue; }
  // Window filter: skip days outside the derive's own range.
  if (workDate < windowStartISO || workDate > windowEndISO) { skippedOutOfWindow++; continue; }
  const attr = attribute(workerId);
  if (!attr) { skippedUnattr++; continue; }
  const status = String(p.status || "");
  if (!KNOWN_STATUSES.has(status)) { skippedUnknownStatus++; continue; }

  const b = getBucket(attr.account_key, workerId, workDate, attr.line_code);
  b.entry_count++;

  const { rate, source } = resolveRate(p, workerId);
  if (source === "segment") rateFromSegment++;
  else if (source === "compensations") rateFromWage++;
  else rateNone++;

  const compute = computeEntryHoursAndDollars(p, rate);
  if (rate <= 0 && compute.dur > 0) {
    unpricedEntries.push({
      workerIdHash: String(workerId).slice(0, 6) + "...",
      workDate,
      status,
      dur: Math.round(compute.dur * 100) / 100,
      account_key: attr.account_key,
    });
  }

  b.hours_regular       += compute.reg;
  b.hours_overtime      += compute.ot;
  b.hours_double_time   += compute.dot;
  b.hours_premium_other += compute.other;
  b.dollars_regular     += compute.dollars_regular;
  b.dollars_overtime    += compute.dollars_overtime;
  b.dollars_double_time += compute.dollars_double_time;
  b.dollars_premium_other += compute.dollars_premium_other;
  b.amount += compute.dollars_regular + compute.dollars_overtime
            + compute.dollars_double_time + compute.dollars_premium_other;
}

const durationSec = ((Date.now() - t0) / 1000);
console.log(`  entries processed: ${timeEntries.length}`);
console.log(`    buckets built:        ${buckets.size}`);
console.log(`    skipped pre-floor:    ${skippedPreFloor}`);
console.log(`    skipped out-of-window:${skippedOutOfWindow}`);
console.log(`    skipped unattr:       ${skippedUnattr}`);
console.log(`    skipped no start:     ${skippedNoStartDate}`);
console.log(`    skipped status:       ${skippedUnknownStatus}`);
console.log(`  rate resolution:`);
console.log(`    from segment pay_rate:   ${rateFromSegment}`);
console.log(`    from compensations wage: ${rateFromWage}`);
console.log(`    unpriced (rate <= 0):    ${rateNone}`);
console.log(`  elapsed so far: ${durationSec.toFixed(2)}s`);

if (unpricedEntries.length > 0) {
  console.error(`\nSTOP: ${unpricedEntries.length} entries have hours but no resolvable rate.`);
  console.error(`  first 20 (workerHash | account | work_date | status | duration):`);
  for (const u of unpricedEntries.slice(0, 20)) {
    console.error(`    ${u.workerIdHash} | ${u.account_key} | ${u.workDate} | ${u.status} | ${u.dur}h`);
  }
  process.exit(3);
}

// ─── Build rows (round only here) ───────────────────────────────────
const derivedAt = new Date().toISOString();
const h2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
// 4dp precision on dollars matches labor_actuals_daily NUMERIC(14,4)
// after the daily-2 precision migration. Per-day rounding to 2dp
// loses cents on the week aggregate (D1 historical finding).
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const rows = [];
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
    segment_count:         b.entry_count,
    derived_at:            derivedAt,
    source_run:            runSource,
    source:                args.source,
  });
}
console.log(`  rows to write: ${rows.length}`);

// ─── Dry-run summary ─────────────────────────────────────────────────
if (args.dryRun) {
  console.log(`\nDRY RUN: would DELETE labor_actuals_daily where work_date in [${windowStartISO}, ${windowEndISO}]`);
  console.log(`         then INSERT ${rows.length} rows (clamp at ${TIME_ENTRY_SOURCE_FLOOR})`);
  // Per-account+date rollup
  console.log(`\nper-account rollup:`);
  console.log(`  account         rows  entries  hr_total`);
  const byAcct = new Map();
  for (const r of rows) {
    const cur = byAcct.get(r.account_key) || { rows: 0, entries: 0, hr: 0 };
    cur.rows++;
    cur.entries += r.segment_count;
    cur.hr += r.hours_regular + r.hours_overtime + r.hours_double_time + r.hours_premium_other;
    byAcct.set(r.account_key, cur);
  }
  for (const a of [...byAcct.keys()].sort()) {
    const c = byAcct.get(a);
    console.log(`  ${a.padEnd(15)} ${String(c.rows).padStart(4)}  ${String(c.entries).padStart(7)}  ${c.hr.toFixed(2).padStart(8)}`);
  }
  console.log(`\nelapsed: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  process.exit(0);
}

// ─── Write: bounded DELETE + batched INSERT ─────────────────────────
console.log(`\ndeleting existing rows in window ${windowStartISO} .. ${windowEndISO}`);
const del = await supa.from("labor_actuals_daily").delete()
  .gte("work_date", windowStartISO).lte("work_date", windowEndISO);
if (del.error) {
  console.error(`delete failed: ${del.error.message}`);
  process.exit(2);
}

const BATCH = 500;
let written = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  // belt-and-braces: no row below the floor can slip past.
  for (const r of chunk) {
    if (r.work_date < TIME_ENTRY_SOURCE_FLOOR) {
      console.error(`row below floor detected: ${r.work_date} < ${TIME_ENTRY_SOURCE_FLOOR}`);
      process.exit(2);
    }
  }
  const ins = await supa.from("labor_actuals_daily").insert(chunk);
  if (ins.error) {
    console.error(`insert failed at offset ${i}: ${ins.error.message}`);
    process.exit(2);
  }
  written += chunk.length;
}

console.log("");
console.log(`derive_labor_actuals_daily summary:`);
console.log(`  rows inserted: ${written}`);
console.log(`  elapsed:       ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(`  source=${args.source}  window=${args.window}  floor=${TIME_ENTRY_SOURCE_FLOOR}`);
process.exit(0);
