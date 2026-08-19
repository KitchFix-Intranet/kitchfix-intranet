// scripts/derive_salary_actuals.mjs
//
// Salary PR 1 · C3. Derives labor_salary_actuals from
// rippling_raw_compensations_latest + rippling_raw_workers_latest +
// rippling_department_map. Effective-dated; per-worker per-week
// amount = annual_in_force / 52. Corporate excluded (department maps
// to account_key='CORP'). Rebuild the TRAILING 8 WEEKS every run
// (DELETE + INSERT) so late raises + transfers + terminations self-
// heal on the next nightly - idempotent posture.
//
// Bonuses / commission / relocation / signing are NOT included. The
// spec S-2 formula is annual_compensation.value only.
//
// Usage:
//   node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=manual --dry-run
//   node --env-file=.env.local scripts/derive_salary_actuals.mjs --source=manual --window=fytd
//
// --window=trailing8 (default) rebuilds the last 8 fiscal weeks.
// --window=fytd rebuilds every fiscal week from FY2026 opening
//   through today. Used for the initial backfill and for the S1f
//   before/after hourly-untouched receipt.
//
// Exit codes:
//   0  success (or dry-run success)
//   1  configuration error
//   2  derivation error mid-run

import { createClient } from "@supabase/supabase-js";
import { FY_START_ISO, periodOf } from "../src/app/kpi/labor/lib/periods.js";

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
  console.error("--source required, one of: " + [...VALID_SOURCES].join(", "));
  process.exit(1);
}
if (!VALID_WINDOWS.has(args.window)) {
  console.error("--window must be one of: " + [...VALID_WINDOWS].join(", "));
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────────────
//
// SALARIED PREDICATE per spec S-1 fallback. C2's enumeration on the
// compensations walk showed payment_type values are DEFAULT (1136)
// and VARIED (177); neither aligns with salaried-vs-hourly (DEFAULT
// covers both EXEMPT + NON_EXEMPT workers, VARIED likewise).
// payment_terms is null on every DEFAULT row; annual_salary_equivalent
// is populated on exactly one row. S-1 explicitly authorizes
// overtime_exemption as the fallback when employment_type is not
// populated (it is null on all 1126 workers).
//
// Cross-check via titles on active workers landed 30 EXEMPT people
// across 11 CORP + 19 site (CEO/CFO/VP/RDO/GM/Exec Chef/Director) -
// correct set. The 144 EXEMPT figure in the raw table includes
// terminated workers; the active-week predicate below already
// excludes those.
//
// The salaried predicate is a WORKER-payload check now, not a
// compensation-record filter. The derive still iterates
// compensation-by-worker (one worker may have raise history), but
// worker.overtime_exemption is what admits them.
const SALARIED_OT_EXEMPTION = "EXEMPT";

// ─── Env + Supabase ──────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const runStartISO = new Date().toISOString();
console.log(`derive_salary_actuals source=${args.source} dryRun=${args.dryRun} window=${args.window} started=${runStartISO}`);

// ─── Helpers ─────────────────────────────────────────────────────────
async function fetchAll(table, sel) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const r = await supa.from(table).select(sel).range(from, from + PS - 1);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    for (const row of r.data || []) out.push(row);
    if ((r.data || []).length < PS) break;
    from += PS;
  }
  return out;
}
function toDate(iso) { return new Date(`${iso}T00:00:00.000Z`); }
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDaysISO(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}
function mondayOnOrBefore(iso) {
  const d = toDate(iso);
  const dow = d.getUTCDay();                 // 0=Sun, 1=Mon, ..., 6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;    // days back to Monday
  d.setUTCDate(d.getUTCDate() + delta);
  return toISO(d);
}

// Fiscal week enumeration: Monday..Sunday, matches deriveActuals + labor
// route conventions. Returns week_start ISO dates in ascending order.
function enumerateWeeks(startISO, endISO) {
  const out = [];
  let w = mondayOnOrBefore(startISO);
  while (w <= endISO) {
    out.push(w);
    w = addDaysISO(w, 7);
  }
  return out;
}

// ─── Window ──────────────────────────────────────────────────────────
const todayISO = new Date().toISOString().slice(0, 10);
let windowStartISO;
if (args.window === "fytd") {
  windowStartISO = FY_START_ISO;
} else {
  windowStartISO = addDaysISO(mondayOnOrBefore(todayISO), -7 * 8);
}
const windowEndISO = mondayOnOrBefore(todayISO);   // last full-week Monday
const weeks = enumerateWeeks(windowStartISO, windowEndISO);
console.log(`  window: ${windowStartISO} .. ${windowEndISO}  weeks=${weeks.length}`);

// ─── 1. Load inputs ──────────────────────────────────────────────────
console.log("  loading workers + compensations + department map...");
const [workers, comps, deptMap] = await Promise.all([
  fetchAll("rippling_raw_workers_latest",       "rippling_id, payload"),
  fetchAll("rippling_raw_compensations_latest",  "rippling_id, worker_id, payment_type, annual_value, salary_effective_date, currency"),
  fetchAll("rippling_department_map",            "department_id, account_key, is_container"),
]);
console.log(`    workers=${workers.length}  compensations=${comps.length}  dept_map=${deptMap.length}`);

// Corp department set. Salary NEVER lands for CORP-attributed workers.
const corpDeptIds = new Set(
  deptMap.filter(d => d.account_key === "CORP").map(d => d.department_id)
);
const deptToAccount = new Map();
for (const d of deptMap) deptToAccount.set(d.department_id, { account_key: d.account_key, is_container: !!d.is_container });

// ─── 2. Index workers by rippling_id + admit EXEMPT only ─────────────
//
// Salaried predicate lives on the WORKER payload
// (overtime_exemption === 'EXEMPT'), not the compensation record.
// Index all workers here so the compensation loop can filter cheap
// on load.
const workerById = new Map();
let exemptCount = 0;
for (const w of workers) {
  const p = w.payload || {};
  workerById.set(w.rippling_id, p);
  if (p.overtime_exemption === SALARIED_OT_EXEMPTION) exemptCount++;
}
console.log(`    workers total=${workers.length}  EXEMPT (any status)=${exemptCount}`);

// ─── 3. Index compensations by worker, ordered by effective date ─────
//
// One worker may have multiple compensation records (raise history).
// For each week we pick the record with the LATEST
// salary_effective_date <= week_start. Filter to salaried workers
// here so the per-week loop stays fast; also skip null annual_value
// (VARIED records) since we can't produce a rate from them - probe
// S1g surfaces the count of active EXEMPT workers who ended up here.
const compsByWorker = new Map();
let skippedNoWorker = 0;
let skippedNotExempt = 0;
let skippedNoAnnual = 0;
for (const c of comps) {
  const wid = c.worker_id;
  if (!wid) { skippedNoWorker++; continue; }
  const w = workerById.get(wid);
  if (!w || w.overtime_exemption !== SALARIED_OT_EXEMPTION) { skippedNotExempt++; continue; }
  if (c.annual_value == null) { skippedNoAnnual++; continue; }
  const list = compsByWorker.get(wid) || [];
  list.push(c);
  compsByWorker.set(wid, list);
}
for (const list of compsByWorker.values()) {
  list.sort((a, b) => String(a.salary_effective_date || "").localeCompare(String(b.salary_effective_date || "")));
}
console.log(`    salaried (EXEMPT) workers with >=1 usable compensation record: ${compsByWorker.size}`);
console.log(`    compensation rows skipped: no_worker=${skippedNoWorker}  not_exempt=${skippedNotExempt}  null_annual_value=${skippedNoAnnual}`);

// Active-week predicate: worker.start_date <= week_end AND
// (end_date IS NULL OR end_date >= week_start) AND status not
// TERMINATED before week_start. Weeks span Mon..Sun (inclusive).
function isActiveInWeek(workerPayload, weekStartISO) {
  const wStart = weekStartISO;
  const wEnd = addDaysISO(weekStartISO, 6);
  const start = workerPayload?.start_date;
  const end = workerPayload?.end_date;
  const status = workerPayload?.status;
  if (!start) return false;
  if (start > wEnd) return false;
  if (end && end < wStart) return false;
  if (status === "TERMINATED" && end && end < wStart) return false;
  return true;
}

// annual_in_force for a worker at a week_start: latest compensation
// whose salary_effective_date <= week_start. If none <=, use the
// earliest record and flag effective_from accordingly (spec S-2).
function annualInForceForWeek(workerId, weekStartISO) {
  const list = compsByWorker.get(workerId);
  if (!list || list.length === 0) return null;
  let picked = null;
  for (const c of list) {
    if (c.salary_effective_date && c.salary_effective_date <= weekStartISO) picked = c;
  }
  if (!picked) picked = list[0];    // earliest; effective_from flags mid-week hire etc.
  if (picked.annual_value == null) return null;
  return picked;
}

// ─── 4. Derive rows ──────────────────────────────────────────────────
const rows = [];
const unattr = new Map();   // reason|dept|worker -> {count}
function bumpUnattr(reason, deptId, workerId) {
  const key = `${reason}|${deptId || ""}|${workerId || ""}`;
  unattr.set(key, (unattr.get(key) || 0) + 1);
}

let totalCandidateWeeks = 0;
let skippedNoCompForWeek = 0;
let skippedCorp = 0;
let skippedInactive = 0;

for (const [wid, list] of compsByWorker) {
  const worker = workerById.get(wid);
  if (!worker) { bumpUnattr("unknown_worker", null, wid); continue; }
  const deptId = worker.department_id || null;
  if (!deptId) { bumpUnattr("no_worker_department", null, wid); continue; }
  if (corpDeptIds.has(deptId)) { skippedCorp += weeks.length; continue; }
  const attr = deptToAccount.get(deptId);
  if (!attr) { bumpUnattr("unknown_department", deptId, wid); continue; }
  if (attr.is_container) { bumpUnattr("container_leak", deptId, wid); continue; }
  const accountKey = attr.account_key;
  if (!accountKey) { bumpUnattr("no_account_key", deptId, wid); continue; }

  for (const weekStartISO of weeks) {
    totalCandidateWeeks++;
    if (!isActiveInWeek(worker, weekStartISO)) { skippedInactive++; continue; }
    const comp = annualInForceForWeek(wid, weekStartISO);
    if (!comp) { skippedNoCompForWeek++; continue; }
    const amount = Math.round((Number(comp.annual_value) / 52) * 100) / 100;
    rows.push({
      account_key:              accountKey,
      week_start:               weekStartISO,
      worker_id:                wid,
      amount:                   amount,
      annual_comp_at_time:      Number(comp.annual_value),
      effective_from:           comp.salary_effective_date || null,
      compensation_rippling_id: comp.rippling_id,
      source:                   "rippling_compensations",
    });
  }
}

// ─── 5. Report + write ───────────────────────────────────────────────
console.log(`  derived rows: ${rows.length}`);
console.log(`    candidate worker-weeks: ${totalCandidateWeeks}`);
console.log(`    skipped: inactive=${skippedInactive}  no_comp_for_week=${skippedNoCompForWeek}  corp_worker_weeks=${skippedCorp}`);

const distinctWorkers = new Set(rows.map(r => r.worker_id)).size;
const perAccount = new Map();
for (const r of rows) perAccount.set(r.account_key, (perAccount.get(r.account_key) || 0) + 1);
console.log(`    distinct salaried workers landed: ${distinctWorkers}`);
console.log(`    per-account weeks:`);
for (const [k, n] of [...perAccount.entries()].sort()) console.log(`      ${k.padEnd(16)} ${n}`);

if (unattr.size > 0) {
  console.log(`  exception log (reason|dept|worker -> occurrences):`);
  for (const [k, n] of [...unattr.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}  ${n}`);
  }
}

if (args.dryRun) {
  console.log(`  DRY RUN - no writes. Exit 0.`);
  process.exit(0);
}

// Rebuild the window: DELETE where week_start in [windowStartISO, windowEndISO],
// then INSERT the freshly derived rows. Chunk large inserts (Supabase
// PostgREST caps request body ~5MB).
console.log(`  DELETE labor_salary_actuals WHERE week_start BETWEEN ${windowStartISO} AND ${windowEndISO}`);
const del = await supa.from("labor_salary_actuals").delete().gte("week_start", windowStartISO).lte("week_start", windowEndISO);
if (del.error) { console.error(`  DELETE failed: ${del.error.message}`); process.exit(2); }

const CHUNK = 500;
let insCount = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const ins = await supa.from("labor_salary_actuals").insert(chunk);
  if (ins.error) { console.error(`  INSERT chunk ${i}: ${ins.error.message}`); process.exit(2); }
  insCount += chunk.length;
}
console.log(`  INSERTED ${insCount} rows.`);

const runEndISO = new Date().toISOString();
console.log(`derive_salary_actuals FINISHED source=${args.source} started=${runStartISO} finished=${runEndISO}`);
process.exit(0);
