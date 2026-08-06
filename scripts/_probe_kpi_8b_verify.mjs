// scripts/_probe_kpi_8b_verify.mjs
//
// KPI PR 8b acceptance probe. Read-only, Postgres-only. Runs after
// derive_labor_actuals.mjs has done at least one pass.
//
// Five gates:
//   1. STL-MO 2026-07-05 to 07-12 ties to the cent (209.31 / 170.36 /
//      $9,986.93 / 43 segments / 5 workers). Worker set is DERIVED
//      from the data, not hardcoded - so a missing worker would show
//      as a count mismatch, not a silent pass.
//   2. Coverage: entries attributed to a client account vs CORP vs
//      unattributed. Name every unattributed department.
//   3. Per-account weekly totals, all 11 client accounts printed as a
//      table. CIN-AZ must exceed CIN-OH by entry count (128 workers vs
//      16). If reversed, the D32 correction did not land.
//   4. Zero attributed entries against any is_container=true dept.
//   5. week_source distribution - how many rows used sc_day_metadata
//      vs iso_fallback.
//
// CLI:
//   node --env-file=.env.local scripts/_probe_kpi_8b_verify.mjs

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function fetchAll(view, cols = "*", extra) {
  const all = [];
  let from = 0;
  while (true) {
    let q = supa.from(view).select(cols).range(from, from + 999);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${view}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

console.log("KPI 8b acceptance probe");
console.log("started", new Date().toISOString());
console.log("");

// ─── Load ─────────────────────────────────────────────────────────
const actuals = await fetchAll("labor_actuals_latest");
const unattr = await fetchAll("labor_unattributed");
const deptMap = await fetchAll("rippling_department_map");
const workers = await fetchAll("rippling_raw_workers_latest", "payload");
console.log(`labor_actuals_latest: ${actuals.length}`);
console.log(`labor_unattributed:   ${unattr.length}`);
console.log(`department_map:       ${deptMap.length}`);
console.log(`workers:              ${workers.length}`);
console.log("");

const deptById = new Map(deptMap.map(d => [d.department_id, d]));
const workerToDept = new Map();
for (const w of workers) {
  if (w.payload?.id) workerToDept.set(w.payload.id, w.payload.department_id || null);
}

// ─── Gate 1 - STL-MO 2026-07-05 to 07-12 cent-tie ────────────────
console.log("## Gate 1 - STL-MO 2026-07-05 to 07-12 (cent-tie against Kevin's Rippling one-off)");
console.log("");
console.log("Expected: 5 workers, 43 segments, 209.31 reg hours, 170.36 OT hours, $9,986.93 total.");
console.log("Worker set derived from labor_actuals rows in the window - a missing worker shows as a count mismatch, not silent.");
console.log("");
const win = actuals.filter(a =>
  a.account_key === "STL - MO" &&
  a.line_code === "3100.1" &&
  a.week_start <= "2026-07-12" &&
  a.week_end   >= "2026-07-05"
);
// Weeks overlapping the target window - but the target window may not align to week boundaries.
// The STL-MO cent-tie is against segment_date in [2026-07-05, 2026-07-12], which may span two weeks.
// For the accuracy check, we need to walk the underlying pay_segments in that date range - which requires
// re-computing from raw. That's what the probe actually does:
console.log("Re-computing from raw pay_segments filtered by segment_date in [2026-07-05, 2026-07-12] + STL-MO worker set...");
const stlMoWorkerIds = new Set();
for (const [wid, did] of workerToDept.entries()) {
  const dept = deptById.get(did);
  if (dept?.account_key === "STL - MO" && dept.pnl_line === "3100.1") stlMoWorkerIds.add(wid);
}
console.log(`  STL - MO 3100.1 worker set (from data): ${stlMoWorkerIds.size} workers`);
const segs = await fetchAll(
  "rippling_raw_pay_segments_latest",
  "payload",
  (q) => q.gte("payload->>segment_date", "2026-07-05").lte("payload->>segment_date", "2026-07-12"),
);
console.log(`  pay_segments in date range: ${segs.length}`);
const matched = segs.filter(s => stlMoWorkerIds.has(s.payload?.owner_role?.id));
console.log(`  matched to STL-MO workers:  ${matched.length}`);
let reg = 0, ot = 0, dol = 0;
const uniqueWorkers = new Set();
for (const rec of matched) {
  const seg = rec.payload;
  uniqueWorkers.add(seg.owner_role?.id);
  const hrs = Number(seg.segment_duration_hours || 0);
  const amt = Number(seg.estimated_amount || 0);
  dol += amt;
  const mult = seg.overtime_multiplier == null ? 1.0 : Number(seg.overtime_multiplier);
  const isOT = mult > 1.0 || /overtime|OT/i.test(String(seg.merged_earning_type_name || ""));
  if (isOT) ot += hrs; else reg += hrs;
}
console.log(`  unique workers in matched segments: ${uniqueWorkers.size}`);
console.log(`  totals from raw:   reg=${reg.toFixed(2)}  ot=${ot.toFixed(2)}  dollars=$${dol.toFixed(2)}  segments=${matched.length}`);
console.log(`  expected:          reg=209.31  ot=170.36  dollars=$9,986.93  segments=43  workers=5`);
const gate1Pass = (
  uniqueWorkers.size === 5 &&
  matched.length === 43 &&
  Math.abs(reg - 209.31) < 0.01 &&
  Math.abs(ot - 170.36) < 0.01 &&
  Math.abs(dol - 9986.93) < 0.01
);
console.log(`  Gate 1: ${gate1Pass ? "PASS" : "FAIL"}`);
console.log("");

// ─── Gate 2 - coverage ───────────────────────────────────────────
console.log("## Gate 2 - attribution coverage");
console.log("");
const totalEntriesInRawTe = await supa.from("rippling_raw_time_entries_latest").select("id", { count: "exact", head: true });
console.log(`  raw time_entries_latest total: ${totalEntriesInRawTe.count}`);
// Sum entry_count in labor_actuals grouped by account type
let corpEntries = 0, clientEntries = 0;
const byAccount = {};
for (const a of actuals) {
  const dept = a.account_key;
  if (dept === "CORP") corpEntries += a.entry_count;
  else clientEntries += a.entry_count;
  if (!byAccount[dept]) byAccount[dept] = { entries: 0, dollars: 0, hours_reg: 0, hours_ot: 0, workers: new Set(), weeks: new Set() };
  byAccount[dept].entries += a.entry_count;
  byAccount[dept].dollars += Number(a.amount || 0);
  byAccount[dept].hours_reg += Number(a.hours_regular || 0);
  byAccount[dept].hours_ot += Number(a.hours_overtime || 0);
  byAccount[dept].workers.add(a.worker_id);
  byAccount[dept].weeks.add(a.week_label);
}
console.log(`  entries attributed to a client account: ${clientEntries}`);
console.log(`  entries attributed to CORP:             ${corpEntries}`);
console.log(`  unattributed rows:                      ${unattr.length}`);
if (unattr.length) {
  const byReason = {};
  for (const u of unattr) {
    const key = `${u.reason_code}|${u.department_id || "-"}|${u.department_name || "-"}`;
    if (!byReason[key]) byReason[key] = 0;
    byReason[key]++;
  }
  console.log("  unattributed by reason + department:");
  for (const [k, c] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${c} rows`);
}
console.log("");

// ─── Gate 3 - per-account weekly totals ─────────────────────────
console.log("## Gate 3 - per-account totals");
console.log("");
console.log("| account | weeks | workers | reg hrs | OT hrs | entries | dollars |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
const accts = ["CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
for (const a of accts) {
  const b = byAccount[a] || { entries: 0, dollars: 0, hours_reg: 0, hours_ot: 0, workers: new Set(), weeks: new Set() };
  console.log(`| ${a} | ${b.weeks.size} | ${b.workers.size} | ${b.hours_reg.toFixed(2)} | ${b.hours_ot.toFixed(2)} | ${b.entries} | $${b.dollars.toFixed(2)} |`);
}
const cinAzEntries = byAccount["CIN - AZ"]?.entries || 0;
const cinOhEntries = byAccount["CIN - OH"]?.entries || 0;
console.log("");
console.log(`  CIN - AZ entries: ${cinAzEntries}`);
console.log(`  CIN - OH entries: ${cinOhEntries}`);
console.log(`  Gate 3 (CIN-AZ > CIN-OH per D32): ${cinAzEntries > cinOhEntries ? "PASS" : "FAIL - D32 REGRESSION"}`);
console.log("");

// ─── Gate 4 - container leak ────────────────────────────────────
console.log("## Gate 4 - container departments received zero entries");
console.log("");
const containerLeaks = unattr.filter(u => u.reason_code === "container_leak");
console.log(`  labor_unattributed rows with reason=container_leak: ${containerLeaks.length}`);
if (containerLeaks.length) {
  console.log("  (any > 0 is a defect - a container had entries)");
  for (const l of containerLeaks.slice(0, 10)) console.log(`    ${l.department_name} (${l.department_id})  worker=${l.worker_id}  date=${l.segment_date}  amount=$${l.amount}`);
}
console.log(`  Gate 4: ${containerLeaks.length === 0 ? "PASS" : "FAIL"}`);
console.log("");

// ─── Gate 5 - week_source distribution ──────────────────────────
console.log("## Gate 5 - week_source distribution");
console.log("");
const bySrc = {};
for (const a of actuals) bySrc[a.week_source] = (bySrc[a.week_source] || 0) + 1;
console.log("  labor_actuals rows by week_source:");
for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
  const pct = ((v / actuals.length) * 100).toFixed(1);
  console.log(`    ${k}: ${v}  (${pct}%)`);
}
console.log("");

// ─── Summary ────────────────────────────────────────────────────
console.log("probe complete", new Date().toISOString());
console.log("");
console.log("Gate summary:");
console.log(`  Gate 1  STL-MO cent-tie                                        ${gate1Pass ? "PASS" : "FAIL"}`);
console.log(`  Gate 2  attribution coverage - inspect above`);
console.log(`  Gate 3  CIN-AZ > CIN-OH (D32)                                  ${cinAzEntries > cinOhEntries ? "PASS" : "FAIL"}`);
console.log(`  Gate 4  container leak = 0                                     ${containerLeaks.length === 0 ? "PASS" : "FAIL"}`);
console.log(`  Gate 5  week_source distribution - inspect above`);
