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
// Model (full evidence in claude/LABOR_API_DOLLARS_MODEL_PROVEN_2026-10-16.md):
//   hours per entry:
//     regular     = time_entry_summary.regular_hours
//     overtime    = time_entry_summary.over_time_hours
//     double_time = time_entry_summary.double_over_time_hours
//     Never re-derive the OT split. Rippling allocates against the
//     weekly 40h boundary; the summary is authoritative.
//
//   rate per entry (two sources, in order):
//     1. segments[].pay_rate on display_name in {'Regular','Base Pay'}
//        where pay_rate IS NOT NULL
//     2. rippling_raw_compensations latest hourly_wage.value for the
//        worker, presence-filtered. MANDATORY fallback - pay_rate is
//        null on ~34% of Regular segments and 38% of OT segments.
//
//   dollars per entry (approved-equivalent only):
//     regular     = regular_hours          * rate
//     overtime    = over_time_hours        * rate * 1.5
//     double_time = double_over_time_hours * rate * 2.0
//     Multipliers are hardcoded by display_name presence in the corpus
//     ('Regular' x1.0, '1.5x Overtime' x1.5, 'Holiday Double Rate'
//     x2.0 - Holiday Double Rate carries NULL ot_multiplier, so any
//     detector reading ot_multiplier misses the holiday case).
//
//   status gating (corpus: PAID 11182 / DRAFT 109 / APPROVED 108):
//     APPROVED | FINALIZED | PAID  -> approved-equivalent (hours+dollars)
//     DRAFT                        -> draft_hours only; anomalies fire
//     Treating PAID as neither would silently drop 98% of entries.
//
//   date rule: left(start_time, 10) - the local wall-clock date from
//   the ISO string's own UTC offset. Never a ::date cast on the
//   whole timestamp. Accounts span ET/CT/MT/AZ.
//
//   account + line_code: unchanged from the pay-segments derive.
//   worker_id -> rippling_department_map -> account_key, and the
//   account's hourly pnl_line (where pnl_line='3100.1') -> line_code.
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

const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const MAX_DURATION_SEC = 600;
// APPROVAL_TRACKING_START mirrors the constant in deriveActuals.js.
// Pre-cutoff DRAFT entries do not contribute to draft_hours or
// oldest_draft_date; they still fire anomalies if present.
const APPROVAL_TRACKING_START = "2026-08-24";

const APPROVED_EQUIVALENT = new Set(["APPROVED", "FINALIZED", "PAID"]);
const REGULAR_SEGMENT_NAMES = new Set(["Regular", "Base Pay"]);

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
  // Function exists if the error is business-logic (account_key not in
  // accounts) rather than "function does not exist" / 404.
  const msg = String(probe.error?.message || "");
  if (probe.error && /does not exist|could not find the function|PGRST202/i.test(msg)) {
    console.error("pre-flight FAIL: swap_labor_actuals_for_account_window is ABSENT.");
    console.error("Apply docs/migrations/labor-te-1-windowed-rpc.sql in Studio first.");
    process.exit(3);
  }
  // Expected: raised the "account_key not in accounts table" exception
  // with the __preflight__ sentinel. That is PRESENT + working.
  if (probe.error && /account_key .* not in accounts/i.test(msg)) {
    console.log("  windowed RPC: PRESENT");
  } else if (!probe.error) {
    console.log("  windowed RPC: PRESENT (unexpected: sentinel succeeded)");
  } else {
    console.error(`pre-flight unknown error: ${msg}`);
    process.exit(3);
  }
}

// ── Paginate helpers ─────────────────────────────────────────────
async function pageAll(builderFactory, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builderFactory().range(from, from + pageSize - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function keysetPage(builderFactory, keyCol = "rippling_id", pageSize = 1000) {
  const out = [];
  let cursor = null;
  while (true) {
    let q = builderFactory();
    if (cursor) q = q.gt(keyCol, cursor);
    q = q.order(keyCol, { ascending: true }).limit(pageSize);
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    const rows = r.data || [];
    for (const row of rows) out.push(row);
    if (rows.length < pageSize) break;
    cursor = rows[rows.length - 1][keyCol];
  }
  return out;
}

// ── Load reference data ──────────────────────────────────────────
console.log("\nloading reference data...");

const presenceTe = new Set();
for (const r of await pageAll(() => supa.from("rippling_current_presence").select("rippling_id").eq("kind", "time_entries"))) {
  presenceTe.add(r.rippling_id);
}
console.log(`  presence time_entries: ${presenceTe.size}`);

const presenceComp = new Set();
for (const r of await pageAll(() => supa.from("rippling_current_presence").select("rippling_id").eq("kind", "compensations"))) {
  presenceComp.add(r.rippling_id);
}
console.log(`  presence compensations: ${presenceComp.size}`);

const deptRows = await pageAll(() =>
  supa.from("rippling_department_map").select("department_id, department_name, account_key, pnl_line, is_container"));
const deptMap = new Map(deptRows.map(d => [d.department_id, d]));
const accountToHourlyLine = new Map();
for (const d of deptRows) {
  if (d.is_container) continue;
  if (d.pnl_line !== "3100.1") continue;
  if (!d.account_key) continue;
  accountToHourlyLine.set(d.account_key, d.pnl_line);
}
console.log(`  dept map: ${deptMap.size}, accounts with 3100.1: ${accountToHourlyLine.size}`);

const workers = await keysetPage(() =>
  supa.from("rippling_raw_workers_latest").select("rippling_id, payload"));
const workerToDept = new Map();
for (const w of workers) {
  const wid = w.payload?.id;
  if (wid) workerToDept.set(wid, w.payload?.department_id || null);
}
console.log(`  workers: ${workers.length}`);

// Build worker -> hourly wage from compensations_latest, presence-filtered.
// Gate on hourly_wage.value > 0 directly - payment_type in this corpus
// is DEFAULT (hourly workers) or VARIED (variable-rate workers); only
// DEFAULT carries a usable wage, and the field itself is the authoritative
// signal regardless of the payment_type label. Latest payload.updated_at
// per worker wins.
const compsLatest = await keysetPage(() =>
  supa.from("rippling_raw_compensations_latest").select("rippling_id, payload"));
const workerToWage = new Map();
let compPresenceDrops = 0, compNoWageDrops = 0;
for (const c of compsLatest) {
  if (!presenceComp.has(c.rippling_id)) { compPresenceDrops++; continue; }
  const p = c.payload || {};
  const workerId = p.worker_id;
  if (!workerId) continue;
  const wage = Number(p.hourly_wage?.value || 0);
  if (!(wage > 0)) { compNoWageDrops++; continue; }
  const uat = p.updated_at || "";
  const prev = workerToWage.get(workerId);
  if (!prev || uat > prev.uat) workerToWage.set(workerId, { wage, uat });
}
console.log(`  comps_latest: ${compsLatest.length}  (presence-dropped: ${compPresenceDrops}, no-wage dropped: ${compNoWageDrops})`);
console.log(`  hourly wage resolved for: ${workerToWage.size} workers`);

const dayRows = await pageAll(() =>
  supa.from("sc_day_metadata").select("account_key, service_date, period, week_label"));
const dayMap = new Map();
const weekBoundsMap = new Map();
for (const r of dayRows) {
  if (!r.week_label || !r.period) continue;
  dayMap.set(`${r.account_key}|${r.service_date}`, { period: r.period, week_label: r.week_label });
  const k = `${r.account_key}|${r.period}|${r.week_label}`;
  const cur = weekBoundsMap.get(k);
  if (!cur) weekBoundsMap.set(k, { start: r.service_date, end: r.service_date });
  else {
    if (r.service_date < cur.start) cur.start = r.service_date;
    if (r.service_date > cur.end)   cur.end   = r.service_date;
  }
}
console.log(`  sc_day_metadata: ${dayRows.length}`);

// ── Week resolver ────────────────────────────────────────────────
function isoWeekBounds(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;   // Monday = 0
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
  const day = dayMap.get(`${accountKey}|${dateStr}`);
  if (day) {
    const bounds = weekBoundsMap.get(`${accountKey}|${day.period}|${day.week_label}`);
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

// FY lookup mirroring deriveActuals.js. FY2026 is 2025-12-29..2026-12-27.
function fiscalYearForDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr >= "2025-12-29" && dateStr <= "2026-12-27") return 2026;
  if (dateStr >= "2024-12-30" && dateStr <= "2025-12-28") return 2025;
  if (dateStr >= "2026-12-28" && dateStr <= "2027-12-26") return 2027;
  return null;
}

function attribute(workerId) {
  if (!workerId || !workerToDept.has(workerId)) return null;
  const deptId = workerToDept.get(workerId);
  if (!deptId) return null;
  const d = deptMap.get(deptId);
  if (!d || d.is_container) return null;
  if (d.account_key === "CORP") return null;
  const hourlyLine = accountToHourlyLine.get(d.account_key);
  if (!hourlyLine) return null;
  return { account_key: d.account_key, line_code: hourlyLine };
}

// ── Load time entries + dedupe ───────────────────────────────────
console.log("\nloading rippling_raw_time_entries_latest...");
const teLatest = await keysetPage(() =>
  supa.from("rippling_raw_time_entries_latest").select("rippling_id, payload"));
console.log(`  rows: ${teLatest.length}`);

const liveTe = teLatest.filter(r => presenceTe.has(r.rippling_id));
const bestById = new Map();
for (const r of liveTe) {
  const id = r.payload?.id;
  if (!id) continue;
  const uat = r.payload?.updated_at || "";
  const prev = bestById.get(id);
  if (!prev || uat > prev.uat) bestById.set(id, { r, uat });
}
const timeEntries = [...bestById.values()].map(x => x.r);
console.log(`  live-in-presence: ${liveTe.length}  deduped: ${timeEntries.length}`);

// ── Resolve rate per entry ───────────────────────────────────────
// Order: shift pay_rate on Regular/Base Pay segments first; then
// compensations hourly_wage fallback. Measured: shift rate rescues 51
// worker-weeks over wage-only; wage-only wins 1. Keep both.
function resolveRate(payload, workerId) {
  const segs = Array.isArray(payload.segments) ? payload.segments : [];
  for (const seg of segs) {
    if (!REGULAR_SEGMENT_NAMES.has(seg.display_name)) continue;
    const r = Number(seg.pay_rate);
    if (Number.isFinite(r) && r > 0) return { rate: r, source: "segment" };
  }
  const wage = workerToWage.get(workerId);
  if (wage && wage.wage > 0) return { rate: wage.wage, source: "compensations" };
  return { rate: 0, source: "none" };
}

// ── Build buckets ────────────────────────────────────────────────
console.log("\ncomputing per-worker-week buckets...");
const buckets = new Map();
let skippedPreFloor = 0, skippedUnattr = 0, skippedUnknownStatus = 0, skippedNoStartDate = 0;
let entriesInApproved = 0, entriesInDraft = 0;
let rateFromSegment = 0, rateFromWage = 0, rateNone = 0;

function localDate(iso) { return typeof iso === "string" ? iso.slice(0, 10) : null; }
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
      segment_count: 0,          // 0 on this path; segments not consumed
      entry_count: 0,
      coverage_state: "complete", // presence is live by construction
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
  const isApproved = APPROVED_EQUIVALENT.has(status);
  const isDraft = status === "DRAFT";
  if (!isApproved && !isDraft) { skippedUnknownStatus++; continue; }

  const w = resolveWeek(attr.account_key, startDate);
  // Only touch weeks on or after the floor. resolveWeek returns bounds
  // from sc_day_metadata which may land on a slightly different
  // week_start than the start_date; the floor is on the resolved week.
  if (w.week_start < TIME_ENTRY_SOURCE_FLOOR) { skippedPreFloor++; continue; }

  const b = getBucket(attr.account_key, workerId, w, attr.line_code);
  b.entry_count++;

  const summary = p.time_entry_summary || {};
  const dur = Number(summary.duration || 0);
  const reg = Number(summary.regular_hours || 0);
  const ot = Number(summary.over_time_hours || 0);
  const dot = Number(summary.double_over_time_hours || 0);

  if (isApproved) {
    entriesInApproved++;
    b.hours_regular += reg;
    b.hours_overtime += ot;
    b.hours_double_time += dot;
    // premium_other = total duration - the three Rippling-split
    // buckets. Rare; zero in the current corpus. Covers any
    // display_name outside Regular / 1.5x Overtime / Holiday Double
    // Rate landing in the summary.duration tally.
    const other = Math.max(0, dur - reg - ot - dot);
    b.hours_premium_other += other;
    b.approved_hours += dur;

    // Dollars: resolve rate once per entry, apply hardcoded multipliers.
    const { rate, source } = resolveRate(p, workerId);
    if (source === "segment") rateFromSegment++;
    else if (source === "compensations") rateFromWage++;
    else rateNone++;
    b.dollars_regular     += reg * rate;
    b.dollars_overtime    += ot  * rate * 1.5;
    b.dollars_double_time += dot * rate * 2.0;
    // Any premium_other hours get the base rate; near-zero contributor
    // in practice (the three live display_names cover every observed
    // segment).
    b.dollars_premium_other += other * rate;
    if (rate === 0) b.hours_without_dollars += dur;
  } else if (isDraft) {
    entriesInDraft++;
    b.draft_entry_count++;
    if (!p.end_time) b.anomaly_no_clockout++;
    if (dur > 0 && dur < 1.0) b.anomaly_under_1h++;
    if (dur > 16.0) b.anomaly_over_16h++;
    const startIso = p.start_time || null;
    const inTracking = startIso && startIso.slice(0, 10) >= APPROVAL_TRACKING_START;
    if (inTracking) {
      b.draft_hours += dur;
      if (b.oldest_draft_start === null || startIso < b.oldest_draft_start) {
        b.oldest_draft_start = startIso;
      }
    }
  }
}

const durationSec = ((Date.now() - t0) / 1000);
console.log(`  entries processed: ${timeEntries.length}`);
console.log(`    approved-equivalent: ${entriesInApproved}  (dollars written)`);
console.log(`    draft:               ${entriesInDraft}  (draft_hours only)`);
console.log(`    skipped pre-floor:   ${skippedPreFloor}`);
console.log(`    skipped unattr:      ${skippedUnattr}`);
console.log(`    skipped no start:    ${skippedNoStartDate}`);
console.log(`    skipped status:      ${skippedUnknownStatus}`);
console.log(`  rate resolution over approved entries:`);
console.log(`    from segment pay_rate:   ${rateFromSegment}`);
console.log(`    from compensations wage: ${rateFromWage}`);
console.log(`    none (dollars = 0):      ${rateNone}`);
console.log(`  bucket count: ${buckets.size}`);
console.log(`  elapsed so far: ${durationSec.toFixed(2)}s`);

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
// Collapse worker-week rows to one line per account+week so Kevin can
// read the shape of what Stage 2 would write without scrolling 68
// worker-weeks. Public-repo rule: hours and counts only in the
// committed probe output; dollar validation goes in the CC report to
// Kevin separately.
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
