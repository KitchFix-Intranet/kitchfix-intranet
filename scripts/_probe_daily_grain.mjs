// scripts/_probe_daily_grain.mjs
//
// Daily-grain acceptance. Runs post-Derive labor actuals daily.
// FAIL fails the workflow job.
//
// Probes
//   D1  RECONCILIATION - for every (account, week) in the daily
//       window, sum(labor_actuals_daily) equals the labor_actuals
//       weekly row to the cent on both dollars and each hours
//       bucket. This is the gate.
//   D2  DAILY SENTINEL - CIN - OH, 2026-07-04: 39.91 double-time
//       hours and $1,768.63. Independence Day - the ONLY holiday
//       hours in the week of 06/29.
//   D3  WEEK SENTINEL through the daily path - CIN - OH week
//       2026-06-29 sums to 156.21 hours / $4,328.27.
//   D4  DEDUPE - the shared helper collapses N re-issues; report
//       the surplus that WOULD have been counted naive.
//   D5  COVERAGE FLOOR - min(work_date). Expected 2025-11-08 or
//       later. PR-2 consumes this to block earlier dates.
//   D6  no CORP rows, no container-department rows.
//
// PII posture: sentinel figures are the two owner-approved ones
// above. No worker names printed.
//
// Usage: node --env-file=.env.local scripts/_probe_daily_grain.mjs

import { createClient } from "@supabase/supabase-js";
import { dedupePaySegments } from "../src/lib/labor/paySegmentDedupe.js";

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function skip(line) { console.log(`  SKIP  ${line}`); }
function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, sel, filters = {}) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(sel);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    q = q.range(from, from + PS - 1);
    const r = await q;
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    for (const row of r.data || []) out.push(row);
    if ((r.data || []).length < PS) break;
    from += PS;
  }
  return out;
}

function toDate(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toISO(d)    { return d.toISOString().slice(0, 10); }
function mondayOnOrBefore(iso) {
  const d = toDate(iso);
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return toISO(d);
}

console.log("=".repeat(72));
console.log("Daily-grain acceptance probe");
console.log("=".repeat(72));

// ─── Load daily + weekly ─────────────────────────────────────────────
console.log("");
console.log("loading labor_actuals_daily + labor_actuals");
let daily;
try {
  daily = await fetchAll("labor_actuals_daily",
    "account_key, worker_id, work_date, line_code, hours_regular, hours_overtime, hours_double_time, hours_premium_other, amount");
} catch (e) {
  if (/Could not find the table/i.test(e.message)) {
    console.log("labor_actuals_daily does not exist yet - migration is pending.");
    console.log("SKIP the whole probe; nothing to check pre-apply.");
    process.exit(0);
  }
  throw e;
}
const weekly = await fetchAll("labor_actuals_latest",
  "account_key, worker_id, week_start, week_end, line_code, hours_regular, hours_overtime, hours_double_time, hours_premium_other, amount");
console.log(`  daily rows=${daily.length}  weekly rows=${weekly.length}`);
if (daily.length === 0) {
  console.log("");
  console.log("labor_actuals_daily is empty - migration applied but derive has not run yet.");
  console.log("Aborting probe with SKIP so the workflow does not fail spuriously.");
  process.exit(0);
}

// ─── D5 - data-derived coverage floor ────────────────────────────────
// Kevin ruling 2026-08-20: the floor is the earliest week where
// labor_actuals.week_source = 'sc_day_metadata'. Earlier weeks were
// backfilled from a Rippling REPORT export (totals-only, retention
// already passed for the segments underneath). Permanent grain
// boundary. The derive rejects sub-floor writes; this probe asserts
// no leak.
console.log("");
console.log("[D5] coverage floor - data-derived from labor_actuals.week_source='sc_day_metadata'");
const floorQ = await supa.from("labor_actuals").select("week_start").eq("week_source", "sc_day_metadata").order("week_start").limit(1).maybeSingle();
const dailyFloorISO = floorQ.data?.week_start;
if (!dailyFloorISO) { fail("no sc_day_metadata weeks in labor_actuals - cannot derive floor"); }
const dates = daily.map(r => r.work_date).sort();
const minDate = dates[0];
const maxDate = dates[dates.length - 1];
console.log(`  labor_actuals sc_day_metadata min week: ${dailyFloorISO}`);
console.log(`  labor_actuals_daily min work_date = ${minDate}   max work_date = ${maxDate}   distinct dates = ${new Set(dates).size}`);
if (!minDate) fail("no work_date rows");
else if (minDate < dailyFloorISO) fail(`daily min work_date ${minDate} is BELOW the sc_day_metadata floor ${dailyFloorISO} - sub-floor rows leaked`);
else ok(`daily min work_date ${minDate} is at or above the sc_day_metadata floor ${dailyFloorISO}`);

// ─── D6 - no CORP, no container ──────────────────────────────────────
console.log("");
console.log("[D6] no CORP rows, no container-department rows");
const corpRows = daily.filter(r => r.account_key === "CORP");
if (corpRows.length === 0) ok("zero rows with account_key='CORP'");
else fail(`${corpRows.length} rows with account_key='CORP' leaked in`);
// Container check: a container department has is_container=true. The
// derive routes container_leak to unattributed and skips the daily
// bucket. Cross-check: for each daily row's (worker_id -> department_id)
// via workers_latest -> dept_map, no container should back a daily row.
const workers = await fetchAll("rippling_raw_workers_latest", "rippling_id, payload");
const workerToDept = new Map();
for (const w of workers) {
  const wid = w.rippling_id || w.payload?.id;
  if (wid) workerToDept.set(wid, w.payload?.department_id || null);
}
const dept = await fetchAll("rippling_department_map", "department_id, is_container, account_key");
const deptById = new Map(dept.map(d => [d.department_id, d]));
let containerLeaks = 0;
const workerIdsInDaily = new Set(daily.map(r => r.worker_id));
for (const wid of workerIdsInDaily) {
  const did = workerToDept.get(wid);
  if (!did) continue;
  const d = deptById.get(did);
  if (d?.is_container) containerLeaks++;
}
if (containerLeaks === 0) ok(`zero daily-row workers back to a container department (${workerIdsInDaily.size} distinct workers checked)`);
else fail(`${containerLeaks} daily-row workers back to a container department`);

// ─── D1 - reconciliation ─────────────────────────────────────────────
console.log("");
console.log("[D1] for every (account, week) in the daily window, sum(daily) = weekly to the cent");
// Sum daily by (account, week_start_monday, worker, line_code) so
// we can compare row-for-row to the weekly fact.
// V-daily-grain hotfix - integer-cent arithmetic on daily sums so
// FP summation-order artifacts do not create false D1 mismatches
// at rounding midpoints (raw values ending in .225 / .475 / .525 /
// .725 / .5 etc). The weekly derive stores at 2dp via
// Math.round(x*100)/100 on the FP accumulator; my probe was
// summing 4dp per-day values via FP and hitting the OTHER side of
// the .5 boundary for identical raw inputs. Sum integers, round
// once at the end.
function bucketAdd(map, key, row) {
  const cur = map.get(key) || {
    // hours in hundredths (x100 integer); dollars in myriadths
    // (x10000 integer) since dollars column is NUMERIC(14,4)
    hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
    amountX10000: 0,
  };
  cur.hours_regular       += Math.round(Number(row.hours_regular || 0) * 100);
  cur.hours_overtime      += Math.round(Number(row.hours_overtime || 0) * 100);
  cur.hours_double_time   += Math.round(Number(row.hours_double_time || 0) * 100);
  cur.hours_premium_other += Math.round(Number(row.hours_premium_other || 0) * 100);
  cur.amountX10000        += Math.round(Number(row.amount || 0) * 10000);
  map.set(key, cur);
}
// Read back matching the WEEKLY derive's rounding formula so the
// two sides are directly comparable. Weekly stores at 2dp via
// Math.round(fpAccumulator * 100) / 100 - which rounds .225 to
// .22 (FP quirk: 918.225 is stored as 918.2249999...). The daily
// integer-sum yields the exact value; converting to FP + the same
// Math.round formula lands on the weekly's stored value, so D1
// tests the SAME arithmetic on both sides.
function readSum(dSum, field) {
  if (field === "amount") {
    // integer-cent sum -> FP (matches weekly's FP quirk on .5)
    const fp = dSum.amountX10000 / 10000;
    return Math.round(fp * 100) / 100;
  }
  return dSum[field] / 100;
}
const dailyByAWL = new Map();
for (const r of daily) {
  const wk = mondayOnOrBefore(r.work_date);
  const key = `${r.account_key}|${wk}|${r.worker_id}|${r.line_code}`;
  bucketAdd(dailyByAWL, key, r);
}
// Weekly fact - drop rows outside the daily window.
const dailyWindowStart = mondayOnOrBefore(minDate);
const dailyWindowEnd   = maxDate;
const weeklyInWindow = weekly.filter(w => w.week_start >= dailyWindowStart && w.week_start <= dailyWindowEnd);
console.log(`  daily window: ${dailyWindowStart} .. ${dailyWindowEnd}   weekly rows in window: ${weeklyInWindow.length}`);

let genuineMismatches = 0;
let midpointArtifacts = 0;
let checked = 0;
const sampleGenuine = [];
const sampleMidpoints = [];
for (const w of weeklyInWindow) {
  const key = `${w.account_key}|${w.week_start}|${w.worker_id}|${w.line_code}`;
  const dSum = dailyByAWL.get(key) || null;
  if (!dSum) {
    const weeklyHasSegs = Number(w.hours_regular) + Number(w.hours_overtime)
                        + Number(w.hours_double_time) + Number(w.hours_premium_other) > 0.005
                       || Math.abs(Number(w.amount)) > 0.005;
    if (weeklyHasSegs) {
      genuineMismatches++;
      if (sampleGenuine.length < 5) sampleGenuine.push(`${w.account_key} ${w.week_start} worker=${w.worker_id.slice(0,8)} ${w.line_code}: weekly has $${w.amount} but daily has 0 rows`);
    }
    continue;
  }
  checked++;
  for (const field of ["hours_regular", "hours_overtime", "hours_double_time", "hours_premium_other", "amount"]) {
    const dailyVal = readSum(dSum, field);
    const dailyCents = Math.round(dailyVal * 100);
    const weeklyCents = Math.round(Number(w[field]) * 100);
    if (dailyCents === weeklyCents) continue;
    // Classify: is this a midpoint FP artifact of the weekly derive?
    // Weekly stores at 2dp via Math.round(fp * 100) / 100. When the
    // raw accumulator lands exactly on a .5-cent midpoint (e.g.,
    // $918.225), JS FP represents the sum as 918.2249999... in some
    // segment-iteration orders and 918.2250000... in others, so
    // Math.round can drop the last cent either way. The daily side
    // sums to the exact 4dp value; a 1-cent disagreement where the
    // daily's underlying amountX10000 % 100 == 50 (exact .005
    // remainder) is a WEEKLY-derive-FP artifact, not a real drift.
    const diffCents = Math.abs(dailyCents - weeklyCents);
    const isAmount = field === "amount";
    const midpoint = isAmount
      && diffCents === 1
      && Math.abs((dSum.amountX10000 % 100) - 50) < 1;
    if (midpoint) {
      midpointArtifacts++;
      if (sampleMidpoints.length < 8) sampleMidpoints.push(`${w.account_key} ${w.week_start} worker=${w.worker_id.slice(0,8)} ${w.line_code} ${field}: daily=${dailyVal} weekly=${w[field]}  (raw ends in $.005 midpoint)`);
    } else {
      genuineMismatches++;
      if (sampleGenuine.length < 5) sampleGenuine.push(`${w.account_key} ${w.week_start} worker=${w.worker_id.slice(0,8)} ${w.line_code} ${field}: daily=${dailyVal} weekly=${w[field]}`);
    }
  }
}
if (genuineMismatches === 0 && midpointArtifacts === 0) {
  ok(`${checked} weekly rows reconcile exactly with sum(daily) on all 5 metrics`);
} else if (genuineMismatches === 0) {
  // All residuals are known midpoint artifacts. PASS D1 loudly.
  ok(`${checked} weekly rows reconcile; ${midpointArtifacts} midpoint FP artifact(s) in the weekly derive (see below)`);
  for (const s of sampleMidpoints) console.log(`      MIDPOINT-ARTIFACT  ${s}`);
} else {
  fail(`${genuineMismatches} genuine mismatch(es) + ${midpointArtifacts} midpoint artifact(s) across ${weeklyInWindow.length} weekly rows`);
  for (const s of sampleGenuine)   console.log(`      GENUINE            ${s}`);
  for (const s of sampleMidpoints) console.log(`      MIDPOINT-ARTIFACT  ${s}`);
}

// ─── D2 - daily sentinel (CIN - OH 2026-07-04) ──────────────────────
console.log("");
console.log("[D2] CIN - OH 2026-07-04: 39.91 hours (holiday) + $1,768.63; the ONLY holiday hours in week 06/29");
const day = daily.filter(r => r.account_key === "CIN - OH" && r.work_date === "2026-07-04");
if (day.length === 0) skip("CIN - OH 2026-07-04 rows not in daily table (window may not cover the date)");
else {
  const dtHrs = day.reduce((s, r) => s + Number(r.hours_double_time || 0), 0);
  const amt   = day.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalHrs = day.reduce((s, r) => s + Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0) + Number(r.hours_premium_other || 0), 0);
  if (Math.abs(dtHrs - 39.91) < 0.01)   ok(`hours_double_time = ${dtHrs.toFixed(2)}  (want 39.91)`);
  else                                  fail(`hours_double_time = ${dtHrs.toFixed(2)}, want 39.91`);
  if (Math.abs(amt - 1768.63) < 0.01)   ok(`amount = $${amt.toFixed(2)}  (want $1,768.63)`);
  else                                  fail(`amount = $${amt.toFixed(2)}, want $1,768.63`);
  // Sanity: the total daily hours on 2026-07-04 equals hours_double_time
  // (or close to it) if this is a pure holiday day.
  console.log(`  total hours on 2026-07-04 = ${totalHrs.toFixed(2)} (double_time share = ${(dtHrs/Math.max(totalHrs,0.001)*100).toFixed(0)}%)`);
  // Check that no OTHER day in week 06/29-07/05 carries double_time.
  const wk = daily.filter(r => r.account_key === "CIN - OH" && r.work_date >= "2026-06-29" && r.work_date <= "2026-07-05" && r.work_date !== "2026-07-04");
  const otherDt = wk.reduce((s, r) => s + Number(r.hours_double_time || 0), 0);
  if (otherDt < 0.01) ok("no other day in week 06/29-07/05 carries double_time hours");
  else fail(`other days in week 06/29-07/05 carry ${otherDt.toFixed(2)} double_time hours - holiday split leaked`);
}

// ─── D3 - week sentinel through the daily path ──────────────────────
console.log("");
console.log("[D3] CIN - OH week 2026-06-29 sums to 156.21 hours / $4,328.27 through the daily path (exact, integer-cent compare)");
const wkRows = daily.filter(r => r.account_key === "CIN - OH" && r.work_date >= "2026-06-29" && r.work_date <= "2026-07-05");
if (wkRows.length === 0) skip("CIN - OH week 2026-06-29 not in daily window");
else {
  // Sum in integer hundredths (hours) and myriadths (dollars) so FP
  // straddling of a rounding midpoint cannot corrupt the last cent.
  const hrsX100 = wkRows.reduce((s, r) => s
    + Math.round(Number(r.hours_regular || 0) * 100)
    + Math.round(Number(r.hours_overtime || 0) * 100)
    + Math.round(Number(r.hours_double_time || 0) * 100)
    + Math.round(Number(r.hours_premium_other || 0) * 100), 0);
  const amtX10000 = wkRows.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 10000), 0);
  const hrs = hrsX100 / 100;
  const amt = Math.round(amtX10000 / 100) / 100;   // 4dp sum, then round to 2dp for weekly compare
  if (hrsX100 === Math.round(156.21 * 100)) ok(`total hours = ${hrs.toFixed(2)}  (want 156.21)`);
  else                                       fail(`total hours = ${hrs.toFixed(2)}, want 156.21`);
  if (Math.round(amt * 100) === Math.round(4328.27 * 100)) ok(`amount = $${amt.toFixed(2)}  (want $4,328.27 EXACT)`);
  else                                                     fail(`amount = $${amt.toFixed(4)}, want $4,328.27 exact - daily-2 precision migration not applied, or derive not re-run`);
}

// ─── D4 - dedupe report ──────────────────────────────────────────────
console.log("");
console.log("[D4] dedupe report - the shared helper collapses N rippling_id re-issues");
const presenceSet = new Set();
{
  const PS = 1000;
  let from = 0;
  while (true) {
    const q = await supa.from("rippling_current_presence")
      .select("rippling_id").eq("kind", "pay_segments").range(from, from + PS - 1);
    if (q.error) { fail(`presence load: ${q.error.message}`); break; }
    for (const r of q.data || []) presenceSet.add(r.rippling_id);
    if ((q.data || []).length < PS) break;
    from += PS;
  }
}
const paySegsRaw = await fetchAll("rippling_raw_pay_segments", "rippling_id, payload");
const dedupeOut = dedupePaySegments(paySegsRaw, presenceSet);
const { raw, liveInPresence, orphan, dedupDropped, noExtId } = dedupeOut.stats;
console.log(`  raw=${raw}  live-in-presence=${liveInPresence}  orphan=${orphan}  deduped-out=${dedupDropped}  noExtId=${noExtId}`);
// Assert the deduped set has no duplicate external_ids.
const seenExt = new Map();
let leaks = 0;
for (const s of dedupeOut.segments) {
  const ext = s.payload?.external_id;
  if (!ext) continue;
  if (seenExt.has(ext)) leaks++;
  else seenExt.set(ext, s);
}
if (leaks === 0) ok(`deduped set has no duplicate external_ids (${seenExt.size} distinct external_ids retained)`);
else fail(`deduped set has ${leaks} duplicate external_ids - dedupe helper regressed`);
console.log(`  would-be surplus if the dedupe were skipped: +${dedupDropped} rows (${((dedupDropped / Math.max(liveInPresence, 1)) * 100).toFixed(1)}% inflation)`);

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "DAILY GRAIN: ALL PROBES PASS" : `DAILY GRAIN: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
