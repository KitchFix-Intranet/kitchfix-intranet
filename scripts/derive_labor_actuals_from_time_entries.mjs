// scripts/derive_labor_actuals_from_time_entries.mjs
//
// labor-te-1 (2026-10-16). Derives per-worker-week labor_actuals rows
// from rippling_raw_time_entries, writing only week_start >=
// TIME_ENTRY_SOURCE_FLOOR through the WINDOWED RPC
// swap_labor_actuals_for_account_window. The unwindowed RPC and the
// frozen pre-floor era (report_backfill + pay-segments 2026-04-20..
// 2026-10-04) are not touched.
//
// Why this script exists: the two Rippling custom objects the old
// derive consumed (time_entry_computed_pay_segment, time_entry_zo)
// began returning 404 on 2026-10-07. Everything the derive needs is
// already on the time entry; sourcing from time_entries directly cuts
// both dead objects.
//
// labor-te-2 (2026-10-16, same day) extracted the compute into
// src/lib/labor/timeEntriesDerive.js so the weekly and daily derives
// share one implementation of the hours/dollars model. Any change to
// the computation must land in that module, not inline here. The
// grain probe D1 reconciliation only ties if the two derives compute
// identically.
//
// Model (full header in src/lib/labor/timeEntriesDerive.js):
//   hours per entry  = time_entry_summary.{regular,over_time,double_over_time}_hours
//   rate per entry   = segment pay_rate on Regular/Base Pay (two-source
//                      fallback to compensations hourly_wage.value)
//   dollars per hour bucket = hours * rate * {1.0, 1.5, 2.0}
//   status           = every known status priced (owner ruling 2026-10-16);
//                      approved_hours / draft_hours are subset trackers.
//
// CLI:
//   node --env-file=.env.local scripts/derive_labor_actuals_from_time_entries.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_labor_actuals_from_time_entries.mjs --source=manual --dry-run
//
// Exit codes:
//   0  success (or dry-run success)
//   1  configuration error
//   2  derivation error mid-run
//   3  pre-flight failed (windowed RPC absent, duration exceeded, etc.)

import { createClient } from "@supabase/supabase-js";
import { TIME_ENTRY_SOURCE_FLOOR } from "../src/lib/kpi/floors.js";
import {
  KNOWN_STATUSES,
  APPROVED_EQUIVALENT,
  localDate,
  loadReferenceData,
  loadTimeEntries,
  makeAttribute,
  makeResolveRate,
  computeEntryHoursAndDollars,
} from "../src/lib/labor/timeEntriesDerive.js";

const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const MAX_DURATION_SEC = 600;
// APPROVAL_TRACKING_START mirrors the constant in deriveActuals.js.
// Pre-cutoff DRAFT entries do not contribute to draft_hours or
// oldest_draft_date; they still fire anomalies if present.
const APPROVAL_TRACKING_START = "2026-08-24";

function parseArgs(argv) {
  const args = { source: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--source=")) args.source = a.slice(9);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source is required, one of: " + [...VALID_SOURCES].join(", "));
  process.exit(1);
}

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("missing env"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const runStartISO = new Date().toISOString();
const t0 = Date.now();
console.log(`derive_labor_actuals_from_time_entries source=${args.source} dryRun=${args.dryRun} started=${runStartISO}`);
console.log(`floor: TIME_ENTRY_SOURCE_FLOOR = ${TIME_ENTRY_SOURCE_FLOOR}`);

// ── Pre-flight (write mode only): windowed RPC must be present ──
// Acceptance 1 of the brief. Never fall back to the unwindowed RPC;
// that is the destructive path.
if (!args.dryRun) {
  console.log("\npre-flight: checking swap_labor_actuals_for_account_window in pg_proc...");
  const probe = await supa.rpc("swap_labor_actuals_for_account_window", {
    p_account_key: "__preflight__",
    p_actuals: [],
    p_source_run: "preflight",
    p_week_from: TIME_ENTRY_SOURCE_FLOOR,
  });
  const msg = String(probe.error?.message || "");
  if (probe.error && /does not exist|could not find the function|PGRST202/i.test(msg)) {
    console.error("pre-flight FAIL: swap_labor_actuals_for_account_window is ABSENT.");
    console.error("Apply docs/migrations/labor-te-1-windowed-rpc.sql in Studio first.");
    process.exit(3);
  }
  if (probe.error && /account_key .* not in accounts/i.test(msg)) {
    console.log("  windowed RPC: PRESENT");
  } else if (!probe.error) {
    console.log("  windowed RPC: PRESENT (unexpected: sentinel succeeded)");
  } else {
    console.error(`pre-flight unknown error: ${msg}`);
    process.exit(3);
  }
}

// ── Load reference data (shared module) ─────────────────────────
console.log("\nloading reference data...");
const ref = await loadReferenceData(supa);
console.log(`  presence time_entries: ${ref.counts.presenceTe}`);
console.log(`  presence compensations: ${ref.counts.presenceComp}`);
console.log(`  dept map: ${ref.counts.deptMap}, accounts with 3100.1: ${ref.counts.accountToHourlyLine}`);
console.log(`  workers: ${ref.counts.workers}`);
console.log(`  comps_latest: ${ref.counts.compsLatest}  (presence-dropped: ${ref.counts.compPresenceDrops}, no-wage dropped: ${ref.counts.compNoWageDrops})`);
console.log(`  hourly wage resolved for: ${ref.counts.workerToWage} workers`);
console.log(`  sc_day_metadata: ${ref.counts.dayRows}`);

const attribute = makeAttribute(ref);
const resolveRate = makeResolveRate(ref);

// ── Week resolver (weekly-only; daily uses the raw service date) ─
function isoWeekBounds(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const year = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return {
    label: `iso-${year}-W${String(week).padStart(2, "0")}`,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}
function resolveWeek(accountKey, dateStr) {
  const day = ref.dayMap.get(`${accountKey}|${dateStr}`);
  if (day) {
    const bounds = ref.weekBoundsMap.get(`${accountKey}|${day.period}|${day.week_label}`);
    return {
      week_label: day.week_label,
      week_start: bounds?.start || dateStr,
      week_end: bounds?.end || dateStr,
      period_no: parseInt(day.period, 10) || null,
      week_source: "sc_day_metadata",
    };
  }
  const iso = isoWeekBounds(dateStr);
  return {
    week_label: iso.label,
    week_start: iso.start,
    week_end: iso.end,
    period_no: null,
    week_source: "iso_fallback",
  };
}

function fiscalYearForDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr >= "2025-12-29" && dateStr <= "2026-12-27") return 2026;
  if (dateStr >= "2024-12-30" && dateStr <= "2025-12-28") return 2025;
  if (dateStr >= "2026-12-28" && dateStr <= "2027-12-26") return 2027;
  return null;
}

// ── Load time entries + dedupe (shared) ─────────────────────────
console.log("\nloading rippling_raw_time_entries_latest...");
const { timeEntries, counts: teCounts } = await loadTimeEntries(supa, ref.presenceTe);
console.log(`  rows: ${teCounts.latest}  live-in-presence: ${teCounts.liveInPresence}  deduped: ${timeEntries.length}`);

// ── Build buckets ────────────────────────────────────────────────
console.log("\ncomputing per-worker-week buckets...");
const buckets = new Map();
let skippedPreFloor = 0, skippedUnattr = 0, skippedUnknownStatus = 0, skippedNoStartDate = 0;
let entriesInApproved = 0, entriesInDraft = 0;
let rateFromSegment = 0, rateFromWage = 0, rateNone = 0;
const unpricedEntries = [];

function getBucket(acct, workerId, w, lineCode) {
  const k = `${acct}|${workerId}|${w.week_start}|${lineCode}`;
  let b = buckets.get(k);
  if (!b) {
    b = {
      account_key: acct,
      worker_id: workerId,
      week_label: w.week_label,
      week_start: w.week_start,
      week_end: w.week_end,
      fiscal_year: fiscalYearForDate(w.week_start),
      period_no: w.period_no,
      week_source: w.week_source,
      line_code: lineCode,
      hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      hours_without_dollars: 0,
      segment_count: 0,
      entry_count: 0,
      coverage_state: "complete",
      draft_entry_count: 0,
      draft_hours: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
      approved_hours: 0,
      still_costing_hours: 0,
      oldest_draft_start: null,
    };
    buckets.set(k, b);
  }
  return b;
}

for (const te of timeEntries) {
  const p = te.payload || {};
  const workerId = p.worker_id;
  const startDate = localDate(p.start_time);
  if (!workerId || !startDate) { skippedNoStartDate++; continue; }
  if (startDate < TIME_ENTRY_SOURCE_FLOOR) { skippedPreFloor++; continue; }
  const attr = attribute(workerId);
  if (!attr) { skippedUnattr++; continue; }

  const status = String(p.status || "");
  if (!KNOWN_STATUSES.has(status)) { skippedUnknownStatus++; continue; }
  const isApproved = APPROVED_EQUIVALENT.has(status);
  const isDraft = status === "DRAFT";

  const w = resolveWeek(attr.account_key, startDate);
  if (w.week_start < TIME_ENTRY_SOURCE_FLOOR) { skippedPreFloor++; continue; }

  const b = getBucket(attr.account_key, workerId, w, attr.line_code);
  b.entry_count++;

  const { rate, source } = resolveRate(p, workerId);
  if (source === "segment") rateFromSegment++;
  else if (source === "compensations") rateFromWage++;
  else rateNone++;

  const compute = computeEntryHoursAndDollars(p, rate);
  if (rate <= 0 && compute.dur > 0) {
    unpricedEntries.push({
      workerIdHash: String(workerId).slice(0, 6) + "...",
      startDate,
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
  if (rate <= 0) b.hours_without_dollars += compute.dur;

  if (isApproved) {
    entriesInApproved++;
    b.approved_hours += compute.dur;
  }
  if (isDraft) {
    entriesInDraft++;
    b.draft_entry_count++;
    if (!p.end_time) b.anomaly_no_clockout++;
    if (compute.dur > 0 && compute.dur < 1.0) b.anomaly_under_1h++;
    if (compute.dur > 16.0) b.anomaly_over_16h++;
    const startIso = p.start_time || null;
    const inTracking = startIso && startIso.slice(0, 10) >= APPROVAL_TRACKING_START;
    if (inTracking) {
      b.draft_hours += compute.dur;
      if (b.oldest_draft_start === null || startIso < b.oldest_draft_start) {
        b.oldest_draft_start = startIso;
      }
    }
  }
}

const durationSec = ((Date.now() - t0) / 1000);
console.log(`  entries processed: ${timeEntries.length}`);
console.log(`    APPROVED/FINALIZED/PAID (approved_hours tracker): ${entriesInApproved}`);
console.log(`    DRAFT (draft_hours tracker):                      ${entriesInDraft}`);
console.log(`    skipped pre-floor:   ${skippedPreFloor}`);
console.log(`    skipped unattr:      ${skippedUnattr}`);
console.log(`    skipped no start:    ${skippedNoStartDate}`);
console.log(`    skipped status (unknown): ${skippedUnknownStatus}`);
console.log(`  rate resolution over ALL priced entries:`);
console.log(`    from segment pay_rate:    ${rateFromSegment}`);
console.log(`    from compensations wage:  ${rateFromWage}`);
console.log(`    unpriced (rate <= 0):     ${rateNone}`);
console.log(`  bucket count: ${buckets.size}`);
console.log(`  elapsed so far: ${durationSec.toFixed(2)}s`);

if (unpricedEntries.length > 0) {
  console.error(`\nSTOP: ${unpricedEntries.length} entries have hours but no resolvable rate.`);
  console.error(`  (shift pay_rate NULL AND compensations hourly_wage absent for the worker)`);
  console.error(`  first 20 (workerHash | account | start_date | status | duration):`);
  for (const u of unpricedEntries.slice(0, 20)) {
    console.error(`    ${u.workerIdHash} | ${u.account_key} | ${u.startDate} | ${u.status} | ${u.dur}h`);
  }
  console.error(`\nFix the data (missing compensation row for the worker) or extend the`);
  console.error(`rate resolution before writing. No labor_actuals row is written.`);
  process.exit(3);
}

// ── Build RPC payload per account ────────────────────────────────
const round2 = x => Math.round(x * 100) / 100;
const perAccount = new Map();
for (const b of buckets.values()) {
  const row = {
    account_key: b.account_key,
    worker_id: b.worker_id,
    week_label: b.week_label,
    line_code: b.line_code,
    hours_regular:         round2(b.hours_regular),
    hours_overtime:        round2(b.hours_overtime),
    hours_double_time:     round2(b.hours_double_time),
    hours_premium_other:   round2(b.hours_premium_other),
    dollars_regular:       round2(b.dollars_regular),
    dollars_overtime:      round2(b.dollars_overtime),
    dollars_double_time:   round2(b.dollars_double_time),
    dollars_premium_other: round2(b.dollars_premium_other),
    amount:                round2(b.dollars_regular + b.dollars_overtime + b.dollars_double_time + b.dollars_premium_other),
    hours_without_dollars: round2(b.hours_without_dollars),
    week_start: b.week_start,
    week_end:   b.week_end,
    fiscal_year: b.fiscal_year,
    period_no:   b.period_no,
    week_source: b.week_source,
    segment_count: b.segment_count,
    entry_count:   b.entry_count,
    coverage_state: b.coverage_state,
    draft_entry_count:   b.draft_entry_count,
    draft_hours:         round2(b.draft_hours),
    anomaly_no_clockout: b.anomaly_no_clockout,
    anomaly_under_1h:    b.anomaly_under_1h,
    anomaly_over_16h:    b.anomaly_over_16h,
    approved_hours:      round2(b.approved_hours),
    still_costing_hours: round2(b.still_costing_hours),
    oldest_draft_date:   b.oldest_draft_start ? b.oldest_draft_start.slice(0, 10) : null,
  };
  if (!perAccount.has(b.account_key)) perAccount.set(b.account_key, []);
  perAccount.get(b.account_key).push(row);
}

// ── Aggregated-by-account+week summary ──────────────────────────
console.log("\nper-account+week summary (what Stage 2 would write):");
console.log("  account         week_start   wks  entries  appr  draft  hr_reg  hr_ot  hr_dt  draft_h");
const sortedAccts = [...perAccount.keys()].sort();
for (const acct of sortedAccts) {
  const byWeek = new Map();
  for (const r of perAccount.get(acct)) {
    const cur = byWeek.get(r.week_start) || {
      week_start: r.week_start, wks: 0, entries: 0, appr: 0, draft: 0,
      hr_reg: 0, hr_ot: 0, hr_dt: 0, draft_h: 0,
    };
    cur.wks++;
    cur.entries += r.entry_count;
    cur.appr += r.entry_count - r.draft_entry_count;
    cur.draft += r.draft_entry_count;
    cur.hr_reg += r.hours_regular;
    cur.hr_ot += r.hours_overtime;
    cur.hr_dt += r.hours_double_time;
    cur.draft_h += r.draft_hours;
    byWeek.set(r.week_start, cur);
  }
  for (const r of [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start))) {
    console.log(`  ${acct.padEnd(15)} ${r.week_start}   ${String(r.wks).padStart(3)}  ${String(r.entries).padStart(7)}  ${String(r.appr).padStart(4)}  ${String(r.draft).padStart(5)}  ${r.hr_reg.toFixed(1).padStart(5)}  ${r.hr_ot.toFixed(1).padStart(5)}  ${r.hr_dt.toFixed(1).padStart(5)}  ${r.draft_h.toFixed(1).padStart(6)}`);
  }
}

// Per-account rollup
console.log("\nper-account rollup:");
console.log("  account         rows  entries  hr_total  draft_h  approved_h");
let totalRows = 0, totalEntries = 0, totalHr = 0, totalDraft = 0, totalApproved = 0;
for (const acct of sortedAccts) {
  const rows = perAccount.get(acct);
  let rowCount = rows.length;
  let entries = 0, hrTot = 0, draftHr = 0, apprHr = 0;
  for (const r of rows) {
    entries += r.entry_count;
    hrTot += r.hours_regular + r.hours_overtime + r.hours_double_time + r.hours_premium_other;
    draftHr += r.draft_hours;
    apprHr += r.approved_hours;
  }
  console.log(`  ${acct.padEnd(15)}  ${String(rowCount).padStart(4)}  ${String(entries).padStart(7)}  ${hrTot.toFixed(2).padStart(8)}  ${draftHr.toFixed(2).padStart(7)}  ${apprHr.toFixed(2).padStart(10)}`);
  totalRows += rowCount;
  totalEntries += entries;
  totalHr += hrTot;
  totalDraft += draftHr;
  totalApproved += apprHr;
}
console.log(`  TOTAL            ${String(totalRows).padStart(4)}  ${String(totalEntries).padStart(7)}  ${totalHr.toFixed(2).padStart(8)}  ${totalDraft.toFixed(2).padStart(7)}  ${totalApproved.toFixed(2).padStart(10)}`);

if (durationSec > MAX_DURATION_SEC) {
  console.error(`\nderive duration exceeded ${MAX_DURATION_SEC}s. Per D38, stop and report rather than optimising.`);
  process.exit(3);
}

if (args.dryRun) {
  console.log("\nDRY RUN: skipping DB writes. Nothing persisted.");
  console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  process.exit(0);
}

// ── Write via windowed RPC, per account ──────────────────────────
console.log(`\nwriting via swap_labor_actuals_for_account_window(p_week_from='${TIME_ENTRY_SOURCE_FLOOR}')...`);
let totalWritten = 0;
for (const acct of sortedAccts) {
  const payload = perAccount.get(acct);
  const { data, error } = await supa.rpc("swap_labor_actuals_for_account_window", {
    p_account_key: acct,
    p_actuals: payload,
    p_source_run: args.source,
    p_week_from: TIME_ENTRY_SOURCE_FLOOR,
  });
  if (error) {
    console.error(`[${acct}] write FAILED: ${error.message}`);
    process.exit(2);
  }
  const written = typeof data === "number" ? data : data?.[0];
  totalWritten += written || 0;
  console.log(`  [${acct}] wrote ${written} labor_actuals rows (post-floor)`);
}

console.log("");
console.log(`derive_labor_actuals_from_time_entries summary:`);
console.log(`  accounts written:        ${sortedAccts.length}`);
console.log(`  labor_actuals rows:      ${totalWritten}`);
console.log(`  elapsed:                 ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(`  source=${args.source}`);
process.exit(0);
