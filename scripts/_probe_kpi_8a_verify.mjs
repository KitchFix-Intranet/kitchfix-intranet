// scripts/_probe_kpi_8a_verify.mjs
//
// KPI PR 8a verify script.
//
// Two modes:
//
//   --mode=month --month=YYYY-MM
//     Five-section report over a calendar month, read from
//     rippling_raw_time_entries_latest + rippling_raw_pay_segments_latest.
//     Sections: totals, by date, by worker, approval breakdown,
//     anomalies. Default month is the previous complete calendar month.
//
//   --mode=stl-mo
//     STL-MO acceptance gate. Per-worker reg hours, OT hours, total
//     dollars for the five known-active STL-MO workers between
//     2026-07-05 and 2026-07-12 inclusive. Same OT rule as the one-off
//     Rippling report Kevin already eyeballed (overtime_multiplier > 1.0
//     OR merged_earning_type_name matches /overtime|OT/i).
//
// Read-only. Postgres-only. If it reaches back to the Rippling API, it
// is testing nothing.
//
// CLI:
//   node --env-file=.env.local scripts/_probe_kpi_8a_verify.mjs --mode=stl-mo
//   node --env-file=.env.local scripts/_probe_kpi_8a_verify.mjs --mode=month --month=2026-07

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mode: "month", month: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--mode="))  args.mode = a.slice("--mode=".length);
    else if (a.startsWith("--month=")) args.month = a.slice("--month=".length);
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}
const args = parseArgs(process.argv);
if (!["month", "stl-mo"].includes(args.mode)) {
  console.error("--mode must be 'month' or 'stl-mo'");
  process.exit(1);
}

// ─── STL-MO acceptance-gate constants ────────────────────────────────
//
// The five workers who had STL-MO activity in the 2026-07-05..2026-07-12
// window per the one-off Rippling pull on 2026-08-04. Hardcoded here
// because workers + departments are not yet in Postgres (that lands as
// part of PR 8b along with account attribution). Once workers land, the
// verify script filters by department_id via a JOIN and this constant
// goes away.
//
// Expected totals against Rippling (2026-08-04):
//   Gaby Thompson    reg=43.04  ot=38.30  $2,411.60  (9 segments)
//   Chase Whitmer    reg=43.07  ot=42.64  $2,355.28  (9 segments)
//   Beth Ruble       reg=40.00  ot=33.76  $2,084.95  (8 segments)
//   Rowan Conner     reg=43.19  ot=37.49  $1,790.10  (9 segments)
//   Ariel Allen      reg=40.01  ot=18.17  $1,345.00  (8 segments)
//   TOTAL            reg=209.31 ot=170.36 $9,986.93  (43 segments)
//
// If Postgres does not reproduce these numbers, the ingest is lossy and
// something between the raw payload and the aggregation broke.
const STL_MO_WORKER_IDS = [
  "69a09ae0b6ab55a66dd65099", // Gaby Thompson
  "69a09a0c05936a23170f7abd", // Chase Whitmer
  "69a21b02424f984e3d1f6d73", // Beth Ruble
  "6a04d5b652bf15ff10bfe4db", // Rowan Conner
  "69a21911048eb7dd5f146a93", // Ariel Allen
];
const STL_MO_DATE_FROM = "2026-07-05";
const STL_MO_DATE_TO   = "2026-07-12";

// ─── OT rule (matches the 2026-08-04 one-off) ────────────────────────
function isOT(seg) {
  const mult = seg.overtime_multiplier == null ? 1.0 : Number(seg.overtime_multiplier);
  if (mult > 1.0) return true;
  const name = String(seg.merged_earning_type_name || "").toLowerCase();
  if (name.includes("overtime") || /\bot\b/.test(name)) return true;
  return false;
}

// ─── Fetch helpers ───────────────────────────────────────────────────

// Full pull with automatic pagination past PostgREST's 1000-row cap.
async function fetchAllPayloads(table, monthFrom, monthTo, dateField) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const q = supa.from(table).select("payload").range(from, from + PAGE - 1);
    if (monthFrom && dateField) {
      q.gte(`payload->>${dateField}`, monthFrom).lte(`payload->>${dateField}`, monthTo);
    }
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all.map(r => r.payload);
}

// ─── Mode: stl-mo ───────────────────────────────────────────────────
if (args.mode === "stl-mo") {
  console.log(`STL - MO acceptance gate (from Postgres)`);
  console.log(`  window:   ${STL_MO_DATE_FROM} to ${STL_MO_DATE_TO}`);
  console.log(`  workers:  ${STL_MO_WORKER_IDS.length} (hardcoded pending PR 8b workers landing)`);
  console.log(`  source:   rippling_raw_pay_segments_latest`);
  console.log("");

  const payloads = await fetchAllPayloads("rippling_raw_pay_segments_latest", STL_MO_DATE_FROM, STL_MO_DATE_TO, "segment_date");
  const workerSet = new Set(STL_MO_WORKER_IDS);
  const matched = payloads.filter(p => workerSet.has(p?.owner_role?.id));

  const perWorker = {};
  for (const s of matched) {
    const wid = s.owner_role?.id;
    const name = s.owner_role?.display_value || "(unknown)";
    const hrs = Number(s.segment_duration_hours || 0);
    const amt = Number(s.estimated_amount || 0);
    if (!perWorker[wid]) perWorker[wid] = { name, reg: 0, ot: 0, total: 0, count: 0 };
    perWorker[wid].count++;
    if (isOT(s)) perWorker[wid].ot += hrs;
    else perWorker[wid].reg += hrs;
    perWorker[wid].total += amt;
  }

  const rowsOut = Object.entries(perWorker).sort((a, b) => b[1].total - a[1].total);
  const nameCol = Math.max(20, ...rowsOut.map(([, w]) => (w.name || "").length));

  console.log("OT rule: overtime_multiplier > 1.0 OR merged_earning_type_name matches /overtime|OT/i.");
  console.log("");
  const fmtHrs = v => v.toFixed(2).padStart(7);
  const fmtDol = v => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(11);
  console.log("Employee".padEnd(nameCol) + "  " + "Reg hrs".padStart(7) + "  " + "OT hrs".padStart(7) + "  " + "Total $".padStart(11) + "  Segs");
  console.log("-".repeat(nameCol + 2 + 7 + 2 + 7 + 2 + 11 + 2 + 4));
  let sumReg = 0, sumOt = 0, sumDol = 0, sumSeg = 0;
  for (const [, w] of rowsOut) {
    console.log(w.name.padEnd(nameCol) + "  " + fmtHrs(w.reg) + "  " + fmtHrs(w.ot) + "  " + fmtDol(w.total) + "  " + String(w.count).padStart(4));
    sumReg += w.reg; sumOt += w.ot; sumDol += w.total; sumSeg += w.count;
  }
  console.log("-".repeat(nameCol + 2 + 7 + 2 + 7 + 2 + 11 + 2 + 4));
  console.log("TOTAL".padEnd(nameCol) + "  " + fmtHrs(sumReg) + "  " + fmtHrs(sumOt) + "  " + fmtDol(sumDol) + "  " + String(sumSeg).padStart(4));
  console.log("");
  console.log("Expected (Rippling one-off, 2026-08-04):");
  console.log("  TOTAL".padEnd(nameCol + 2) + "  " + fmtHrs(209.31) + "  " + fmtHrs(170.36) + "  " + fmtDol(9986.93) + "    43");
  console.log("");
  console.log(`Rows read from Postgres: ${payloads.length} (segments in date range)`);
  console.log(`Matched to STL-MO worker set:  ${matched.length}`);
  process.exit(0);
}

// ─── Mode: month ─────────────────────────────────────────────────────

function lastCompleteMonth() {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
const targetMonth = args.month || lastCompleteMonth();
if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
  console.error(`--month must be YYYY-MM, got: ${targetMonth}`);
  process.exit(1);
}
const [yy, mm] = targetMonth.split("-").map(Number);
const monthStart = `${targetMonth}-01`;
const nextMonth = new Date(Date.UTC(yy, mm - 1, 1));
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
const lastDayOfMonth = new Date(nextMonth.getTime() - 86400000);
const monthEnd = lastDayOfMonth.toISOString().slice(0, 10);

console.log(`kpi-8a verify (from Postgres) month=${targetMonth} (${monthStart} to ${monthEnd})`);
console.log("");

// Pull time_entries by start_time (ISO timestamp); filter by prefix.
const teAll = await fetchAllPayloads("rippling_raw_time_entries_latest", null, null, null);
const teInMonth = teAll.filter(t => (t.start_time || "").slice(0, 10) >= monthStart && (t.start_time || "").slice(0, 10) <= monthEnd);

// Pull pay_segments by segment_date (date string).
const segsInMonth = await fetchAllPayloads("rippling_raw_pay_segments_latest", monthStart, monthEnd, "segment_date");

// ─── Section 1: totals ───────────────────────────────────────────────
let totalHrs = 0, totalOt = 0, totalReg = 0, totalDol = 0;
for (const s of segsInMonth) {
  const hrs = Number(s.segment_duration_hours || 0);
  const amt = Number(s.estimated_amount || 0);
  totalHrs += hrs;
  totalDol += amt;
  if (isOT(s)) totalOt += hrs; else totalReg += hrs;
}
console.log("Totals:");
console.log(`  Entries:   ${teInMonth.length}`);
console.log(`  Segments:  ${segsInMonth.length}`);
console.log(`  Hours:     ${totalHrs.toFixed(2)} (regular ${totalReg.toFixed(2)} + OT ${totalOt.toFixed(2)})`);
console.log(`  Dollars:   $${totalDol.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
console.log("");

// ─── Section 2: by date ──────────────────────────────────────────────
const byDate = {};
for (const s of segsInMonth) {
  const d = s.segment_date;
  if (!byDate[d]) byDate[d] = { entries: 0, segments: 0, hours: 0, dollars: 0 };
  byDate[d].segments++;
  byDate[d].hours += Number(s.segment_duration_hours || 0);
  byDate[d].dollars += Number(s.estimated_amount || 0);
}
for (const t of teInMonth) {
  const d = (t.start_time || "").slice(0, 10);
  if (!byDate[d]) byDate[d] = { entries: 0, segments: 0, hours: 0, dollars: 0 };
  byDate[d].entries++;
}
console.log("By date:");
console.log("  " + "Date".padEnd(10) + "  " + "Entries".padStart(7) + "  " + "Segments".padStart(8) + "  " + "Hours".padStart(8) + "  " + "Dollars".padStart(11));
for (const d of Object.keys(byDate).sort()) {
  const r = byDate[d];
  console.log("  " + d + "  " + String(r.entries).padStart(7) + "  " + String(r.segments).padStart(8) + "  " + r.hours.toFixed(2).padStart(8) + "  " + r.dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(11));
}
console.log("");

// ─── Section 3: by worker ────────────────────────────────────────────
const byWorker = {};
for (const s of segsInMonth) {
  const wid = s.owner_role?.id;
  const name = s.owner_role?.display_value || "(unknown)";
  if (!byWorker[wid]) byWorker[wid] = { name, reg: 0, ot: 0, dollars: 0, segments: 0 };
  byWorker[wid].segments++;
  const hrs = Number(s.segment_duration_hours || 0);
  const amt = Number(s.estimated_amount || 0);
  if (isOT(s)) byWorker[wid].ot += hrs; else byWorker[wid].reg += hrs;
  byWorker[wid].dollars += amt;
}
const workerRows = Object.entries(byWorker).sort((a, b) => b[1].dollars - a[1].dollars);
const nameW = Math.max(20, ...workerRows.map(([, w]) => (w.name || "").length));
console.log(`By worker (${workerRows.length} distinct, sorted by $ desc):`);
console.log("  " + "Name".padEnd(nameW) + "  " + "Reg hrs".padStart(8) + "  " + "OT hrs".padStart(7) + "  " + "Dollars".padStart(11) + "  Segs");
for (const [, w] of workerRows) {
  console.log("  " + w.name.padEnd(nameW) + "  " + w.reg.toFixed(2).padStart(8) + "  " + w.ot.toFixed(2).padStart(7) + "  " + w.dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(11) + "  " + String(w.segments).padStart(4));
}
console.log("");

// ─── Section 4: approval breakdown ───────────────────────────────────
const statusDist = {};
for (const t of teInMonth) {
  const s = t.status || "(no-status)";
  statusDist[s] = (statusDist[s] || 0) + 1;
}
console.log("Approval breakdown (time_entry.status):");
for (const k of Object.keys(statusDist).sort()) {
  console.log("  " + k.padEnd(16) + "  " + statusDist[k]);
}
console.log("");

// ─── Section 5: anomalies ────────────────────────────────────────────
const anomalies = {
  segNullAmount: segsInMonth.filter(s => s.estimated_amount == null || s.estimated_amount === ""),
  segNegAmount:  segsInMonth.filter(s => Number(s.estimated_amount || 0) < 0),
  segZeroHours:  segsInMonth.filter(s => Number(s.segment_duration_hours || 0) === 0),
  teNoClockOut:  teInMonth.filter(t => !t.end_time),
};
console.log("Anomalies:");
console.log(`  segments with null/missing estimated_amount: ${anomalies.segNullAmount.length}`);
console.log(`  segments with negative estimated_amount:     ${anomalies.segNegAmount.length}`);
console.log(`  segments with zero segment_duration_hours:   ${anomalies.segZeroHours.length}`);
console.log(`  time_entries with no end_time (open punch):  ${anomalies.teNoClockOut.length}`);
console.log("");

console.log(`Read from Postgres: ${teAll.length} total time_entries (${teInMonth.length} in month), ${segsInMonth.length} pay_segments in month.`);
process.exit(0);
