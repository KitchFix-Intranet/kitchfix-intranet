// scripts/probes/labor_time_entries_stage1.mjs
//
// Stage 1 (VALIDATE ONLY). Zero writes. Derives per-worker-week labor
// hours / dollars from `rippling_raw_time_entries_latest` directly and
// diffs the result against the live `labor_actuals_latest`. The two
// Rippling custom objects used by the current derive have returned 404
// since 2026-10-06 (time_entry_computed_pay_segment,
// time_entry_zo); the fix path routes around them by sourcing labor
// from the time entry itself. This probe is the regression gate for
// Stages 2 and 3 - no row of labor_actuals is written here.
//
// Run: node --env-file=.env.local scripts/probes/labor_time_entries_stage1.mjs
//
// READ ONLY. GET / SELECT only. No INSERT / UPDATE / DELETE.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
if (!url || !key) { console.error("missing env"); process.exit(1); }

const supa = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Paginate helpers ─────────────────────────────────────────────
async function pageAll(builderFactory, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builderFactory().range(from, from + pageSize - 1);
    if (q.error) throw new Error(`${q.error.message}`);
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

const presenceTE = new Set();
const presenceTeRows = await pageAll(() =>
  supa.from("rippling_current_presence").select("rippling_id").eq("kind", "time_entries"));
for (const r of presenceTeRows) presenceTE.add(r.rippling_id);
console.log(`  time_entries presence: ${presenceTE.size}`);

const presencePaySegs = new Set();
const presencePsRows = await pageAll(() =>
  supa.from("rippling_current_presence").select("rippling_id").eq("kind", "pay_segments"));
for (const r of presencePsRows) presencePaySegs.add(r.rippling_id);
console.log(`  pay_segments presence: ${presencePaySegs.size}`);

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
console.log(`  sc_day_metadata: ${dayRows.length}, dayMap: ${dayMap.size}`);

// ISO fallback (mirror of deriveActuals.js lines 109-121)
function isoWeekBounds(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}
function resolveWeek(accountKey, dateStr) {
  const day = dayMap.get(`${accountKey}|${dateStr}`);
  if (day) {
    const bounds = weekBoundsMap.get(`${accountKey}|${day.period}|${day.week_label}`);
    return {
      week_start: bounds?.start || dateStr,
      week_end: bounds?.end || dateStr,
      source: "sc_day_metadata",
    };
  }
  const iso = isoWeekBounds(dateStr);
  return { week_start: iso.start, week_end: iso.end, source: "iso_fallback" };
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

// ── Load time entries (presence-filtered + deduped) ──────────────
console.log("\nloading rippling_raw_time_entries_latest...");
const teLatest = await keysetPage(() =>
  supa.from("rippling_raw_time_entries_latest").select("rippling_id, payload"));
console.log(`  time_entries_latest: ${teLatest.length}`);

// Dedupe by payload->>id, latest payload->>updated_at wins. The _latest
// view is DISTINCT ON rippling_id. Rippling re-issues rippling_id for
// the same logical entry, so collapse by payload.id.
const liveTe = teLatest.filter(r => presenceTE.has(r.rippling_id));
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

// Timezone rule (open question 4): `start_time` carries UTC offset in
// its text, so slice(0, 10) is the LOCAL wall-clock date, not a UTC
// cast. Matches the convention `deriveActuals.js:581` already uses for
// time entries. We bucket on that date.
function localDate(iso) {
  if (!iso || typeof iso !== "string") return null;
  return iso.slice(0, 10);
}
function hoursBetween(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(0, (e - s) / 3600000);
}

// Earning-type bucketing. Match the labor_actuals four-bucket shape.
// `display_name` is the string Rippling emits on each segment. Mirror
// of the current derive's regular/overtime/double_time classification
// at the earning-type level - everything else lands as premium_other.
function bucketFor(name) {
  const n = (name || "").toLowerCase();
  if (n === "regular" || n === "base pay") return "regular";
  if (n === "overtime") return "overtime";
  if (n === "double overtime" || n === "double time" || n.includes("double")) return "double_time";
  return "premium_other";
}

// ── Compute worker-week hours + dollars + rates from time entries ─
console.log("\ncomputing per-worker-week aggregates from time entries...");
const buckets = new Map();        // key -> aggregate
let premiumRows = 0;
let pieceRateRows = 0;
let unattrEntries = 0;
let noDeptEntries = 0;
let attrEntries = 0;
let noStartDate = 0;
const perStatus = new Map();      // status -> count
const perAcctWeek = new Map();    // account|week_start -> entry_count (for outage projection)

function keyOf(acct, wid, ws) { return `${acct}|${wid}|${ws}`; }
function getBucket(acct, wid, ws, we, lineCode) {
  const k = keyOf(acct, wid, ws);
  let b = buckets.get(k);
  if (!b) {
    b = {
      account_key: acct, worker_id: wid, week_start: ws, week_end: we, line_code: lineCode,
      // hours from time_entry_summary
      hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
      // dollars computed per segment
      dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
      // total duration + anomaly tells
      duration: 0,
      approved_entries: 0, draft_entries: 0, finalized_entries: 0, paid_entries: 0,
      approved_hours: 0, draft_hours: 0,
      anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 0,
      // rate aggregation: hours by rate on Regular display_name
      regularHoursByRate: new Map(),
    };
    buckets.set(k, b);
  }
  return b;
}

for (const te of timeEntries) {
  const p = te.payload || {};
  const workerId = p.worker_id;
  const startDate = localDate(p.start_time);
  if (!workerId || !startDate) { noStartDate++; continue; }
  const attr = attribute(workerId);
  if (!attr) {
    unattrEntries++;
    if (workerToDept.has(workerId) && !workerToDept.get(workerId)) noDeptEntries++;
    continue;
  }
  attrEntries++;

  const status = String(p.status || "UNKNOWN");
  perStatus.set(status, (perStatus.get(status) || 0) + 1);

  // Zero-rows assertion for premiums + piece_rate_premiums
  if (Array.isArray(p.premiums) && p.premiums.length) premiumRows++;
  if (Array.isArray(p.piece_rate_premiums) && p.piece_rate_premiums.length) pieceRateRows++;

  const w = resolveWeek(attr.account_key, startDate);
  const b = getBucket(attr.account_key, workerId, w.week_start, w.week_end, attr.line_code);

  const summary = p.time_entry_summary || {};
  const dur = Number(summary.duration || 0);
  const reg = Number(summary.regular_hours || 0);
  const ot = Number(summary.over_time_hours || 0);
  const dot = Number(summary.double_over_time_hours || 0);
  const other = Math.max(0, dur - reg - ot - dot);

  b.hours_regular     += reg;
  b.hours_overtime    += ot;
  b.hours_double_time += dot;
  b.hours_premium_other += other;
  b.duration += dur;

  // Status accumulation
  if (status === "APPROVED") { b.approved_entries++; b.approved_hours += dur; }
  else if (status === "DRAFT") {
    b.draft_entries++;
    b.draft_hours += dur;
    if (!p.end_time) b.anomaly_no_clockout++;
    if (dur > 0 && dur < 1.0) b.anomaly_under_1h++;
    if (dur > 16.0) b.anomaly_over_16h++;
  }
  else if (status === "FINALIZED") b.finalized_entries++;
  else if (status === "PAID") b.paid_entries++;

  // Per-segment dollars + rate aggregation
  const segs = Array.isArray(p.segments) ? p.segments : [];
  for (const seg of segs) {
    const sDur = hoursBetween(seg.start_time, seg.end_time);
    const rate = Number(seg.pay_rate || 0);
    const mult = Number(seg.ot_multiplier || 1);
    const bucket = bucketFor(seg.display_name);
    // amount = rate × multiplier × duration. The ot_multiplier is
    // non-null on OT segments only in the current corpus; multiplying by
    // 1 on regular segments is a no-op.
    const amt = rate * mult * sDur;
    if (bucket === "regular") {
      b.dollars_regular += amt;
      if (rate > 0 && sDur > 0) {
        b.regularHoursByRate.set(rate, (b.regularHoursByRate.get(rate) || 0) + sDur);
      }
    } else if (bucket === "overtime") b.dollars_overtime += amt;
    else if (bucket === "double_time") b.dollars_double_time += amt;
    else b.dollars_premium_other += amt;
  }

  // Outage-window projection: group by account+week for post-10-06 only
  if (startDate >= "2026-10-06") {
    const k = `${attr.account_key}|${w.week_start}`;
    const cur = perAcctWeek.get(k) || { account_key: attr.account_key, week_start: w.week_start, entries: 0, approved: 0, draft: 0, finalized: 0, paid: 0, hr_reg: 0, hr_ot: 0, hr_dt: 0, hr_other: 0 };
    cur.entries++;
    if (status === "APPROVED") cur.approved++;
    else if (status === "DRAFT") cur.draft++;
    else if (status === "FINALIZED") cur.finalized++;
    else if (status === "PAID") cur.paid++;
    cur.hr_reg += reg; cur.hr_ot += ot; cur.hr_dt += dot; cur.hr_other += other;
    perAcctWeek.set(k, cur);
  }
}
console.log(`  attributed entries: ${attrEntries}  unattr: ${unattrEntries}  (no-dept subset: ${noDeptEntries})  no-start-date: ${noStartDate}`);
console.log(`  bucket count: ${buckets.size}`);

// ── Assertions (open question 3 + premium rows) ──────────────────
console.log("\nassertions:");
console.log(`  premiums[] rows across live corpus:        ${premiumRows}   (expect 0)`);
console.log(`  piece_rate_premiums[] rows across corpus:  ${pieceRateRows}   (expect 0)`);
console.log(`  status distribution over attributed:`);
for (const [s, n] of [...perStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${s.padEnd(12)} ${n}`);
}

// ── Load labor_actuals + compare ─────────────────────────────────
console.log("\nloading labor_actuals_latest for comparison...");
const laborActuals = await pageAll(() =>
  supa.from("labor_actuals_latest").select("account_key, worker_id, week_start, week_end, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount"));
console.log(`  labor_actuals rows: ${laborActuals.length}`);

const laMap = new Map();
for (const r of laborActuals) {
  laMap.set(`${r.account_key}|${r.worker_id}|${r.week_start}`, r);
}

// Compare in both directions
const compared = [];
const laOnly = [];
const teOnly = [];
for (const [k, b] of buckets) {
  const la = laMap.get(k);
  if (!la) { teOnly.push(b); continue; }
  compared.push({ k, b, la });
}
for (const [k, r] of laMap) {
  if (!buckets.has(k)) laOnly.push(r);
}
console.log(`\ncoverage:`);
console.log(`  worker-weeks on both sides:    ${compared.length}`);
console.log(`  only in time_entries (TE):     ${teOnly.length}`);
console.log(`  only in labor_actuals (LA):    ${laOnly.length}`);

// ── Hours gate ───────────────────────────────────────────────────
const EPS_H = 0.02;
function diff(a, b) { return Math.abs(Number(a || 0) - Number(b || 0)); }
let hReg02 = 0, hOt02 = 0, hDt02 = 0, allHours02 = 0;
const hoursOutliers = [];
for (const c of compared) {
  const dReg = diff(c.b.hours_regular, c.la.hours_regular);
  const dOt  = diff(c.b.hours_overtime, c.la.hours_overtime);
  const dDt  = diff(c.b.hours_double_time, c.la.hours_double_time);
  if (dReg <= EPS_H) hReg02++;
  if (dOt  <= EPS_H) hOt02++;
  if (dDt  <= EPS_H) hDt02++;
  if (dReg <= EPS_H && dOt <= EPS_H && dDt <= EPS_H) allHours02++;
  else hoursOutliers.push({ c, dReg, dOt, dDt });
}

console.log(`\n=== HOURS GATE (within ${EPS_H}h, out of ${compared.length}) ===`);
console.log(`  hours_regular within:      ${hReg02}  (${(100*hReg02/compared.length).toFixed(1)}%)`);
console.log(`  hours_overtime within:     ${hOt02}  (${(100*hOt02/compared.length).toFixed(1)}%)`);
console.log(`  hours_double_time within:  ${hDt02}  (${(100*hDt02/compared.length).toFixed(1)}%)`);
console.log(`  all three within:          ${allHours02}  (${(100*allHours02/compared.length).toFixed(1)}%)`);
console.log(`  regression gate baseline:  2577 (per brief)`);
console.log(`  verdict:                   ${allHours02 >= 2577 ? "PASS" : "REGRESSION"}`);

// ── Dollars gate ─────────────────────────────────────────────────
const EPS_D_TIGHT = 0.02;
const EPS_D_LOOSE = 1.0;
let dReg02 = 0, dOt02 = 0, dDt02 = 0, allD02 = 0, allD100 = 0;
const dollarOutliers = [];
for (const c of compared) {
  const dReg = diff(c.b.dollars_regular, c.la.dollars_regular);
  const dOt  = diff(c.b.dollars_overtime, c.la.dollars_overtime);
  const dDt  = diff(c.b.dollars_double_time, c.la.dollars_double_time);
  const maxD = Math.max(dReg, dOt, dDt);
  if (dReg <= EPS_D_TIGHT) dReg02++;
  if (dOt  <= EPS_D_TIGHT) dOt02++;
  if (dDt  <= EPS_D_TIGHT) dDt02++;
  if (maxD <= EPS_D_TIGHT) allD02++;
  if (maxD <= EPS_D_LOOSE) allD100++;
  if (maxD > EPS_D_TIGHT) dollarOutliers.push({ c, dReg, dOt, dDt, maxD });
}

console.log(`\n=== DOLLARS GATE (out of ${compared.length}) ===`);
console.log(`  dollars_regular within 0.02:     ${dReg02}  (${(100*dReg02/compared.length).toFixed(1)}%)`);
console.log(`  dollars_overtime within 0.02:    ${dOt02}  (${(100*dOt02/compared.length).toFixed(1)}%)`);
console.log(`  dollars_double_time within 0.02: ${dDt02}  (${(100*dDt02/compared.length).toFixed(1)}%)`);
console.log(`  all three within 0.02:           ${allD02}  (${(100*allD02/compared.length).toFixed(1)}%)`);
console.log(`  all three within 1.00:           ${allD100}  (${(100*allD100/compared.length).toFixed(1)}%)`);

// Dollar outlier size distribution. Public-repo rule: do not emit the
// bracket amount literals from the committed probe. The two threshold
// counts above are the gate; a detailed histogram goes in the CC
// report to Kevin instead. Flag whether the outliers are small or
// systemic without naming amounts.
console.log(`\n  total dollar outliers (any of the three buckets > 0.02): ${dollarOutliers.length}`);

// ── 141 classification ───────────────────────────────────────────
console.log(`\n=== 141 CLASSIFICATION ===`);
// Pull labor_actuals-higher subset
const laHigher = [];
const teHigher = [];
for (const c of compared) {
  const sumB = c.b.hours_regular + c.b.hours_overtime + c.b.hours_double_time;
  const sumL = Number(c.la.hours_regular || 0) + Number(c.la.hours_overtime || 0) + Number(c.la.hours_double_time || 0);
  const d = sumB - sumL;
  if (Math.abs(d) <= EPS_H) continue;
  if (d > 0) teHigher.push({ c, delta: d });
  else laHigher.push({ c, delta: d });
}
console.log(`  TE-higher worker-weeks: ${teHigher.length}  (sum delta hours: ${teHigher.reduce((s, x) => s + x.delta, 0).toFixed(2)})`);
console.log(`  LA-higher worker-weeks: ${laHigher.length}  (sum delta hours: ${laHigher.reduce((s, x) => s + x.delta, 0).toFixed(2)})`);

// Grouping by week_start to replicate the brief's table
const byWeek = new Map();
for (const o of teHigher) {
  const w = o.c.b.week_start;
  const cur = byWeek.get(w) || { te_higher: 0, la_higher: 0, te_delta: 0, la_delta: 0 };
  cur.te_higher++;
  cur.te_delta += o.delta;
  byWeek.set(w, cur);
}
for (const o of laHigher) {
  const w = o.c.b.week_start;
  const cur = byWeek.get(w) || { te_higher: 0, la_higher: 0, te_delta: 0, la_delta: 0 };
  cur.la_higher++;
  cur.la_delta += o.delta;
  byWeek.set(w, cur);
}
console.log(`\n  disagreements grouped by week_start:`);
console.log(`  week_start   te_hi  la_hi   te_delta_h   la_delta_h`);
for (const [w, s] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${w}   ${String(s.te_higher).padStart(5)}  ${String(s.la_higher).padStart(5)}   ${s.te_delta.toFixed(2).padStart(10)}   ${s.la_delta.toFixed(2).padStart(10)}`);
}

// For LA-higher cases: check pay-segment presence to test the roll-off
// hypothesis. If a worker's week has entries in time_entries but ALSO
// has pay-segment-sourced hours that are not covered by current time
// entries, that is the presence-roll-off pattern.
console.log(`\n  LA-higher cases per-row (worker hash | week_start | account | la_minus_te_h):`);
for (const o of laHigher.slice(0, 15)) {
  const h = String(o.c.b.worker_id).slice(0, 6);
  console.log(`    ${h}... | ${o.c.b.week_start} | ${o.c.b.account_key} | ${o.delta.toFixed(2)}`);
}

// ── Outage window projection (acceptance 5) ──────────────────────
console.log(`\n=== OUTAGE WINDOW PROJECTION (what Stage 2 would write, 2026-10-06 onward) ===`);
const outageRows = [...perAcctWeek.values()].sort((a, b) => (a.account_key + a.week_start).localeCompare(b.account_key + b.week_start));
console.log(`  per account+week (entries would land as approved+finalized+paid; drafts stay drafts):`);
console.log(`  account        week_start   entries  appr  draft  final  paid  hr_reg   hr_ot    hr_dt    hr_other`);
let outageWorkerWeeks = 0;
for (const r of outageRows) {
  outageWorkerWeeks++;
  console.log(`  ${r.account_key.padEnd(14)} ${r.week_start}  ${String(r.entries).padStart(6)}  ${String(r.approved).padStart(4)}  ${String(r.draft).padStart(5)}  ${String(r.finalized).padStart(5)}  ${String(r.paid).padStart(4)}  ${r.hr_reg.toFixed(1).padStart(6)}  ${r.hr_ot.toFixed(1).padStart(6)}  ${r.hr_dt.toFixed(1).padStart(6)}  ${r.hr_other.toFixed(1).padStart(6)}`);
}
console.log(`  TOTAL account-weeks post-10-06: ${outageWorkerWeeks}`);

// Also roll up by account only
const byAcctOutage = new Map();
for (const r of outageRows) {
  const cur = byAcctOutage.get(r.account_key) || { account_key: r.account_key, weeks: 0, entries: 0, appr: 0, draft: 0, final: 0, paid: 0, hr_total: 0 };
  cur.weeks++;
  cur.entries += r.entries;
  cur.appr += r.approved;
  cur.draft += r.draft;
  cur.final += r.finalized;
  cur.paid += r.paid;
  cur.hr_total += r.hr_reg + r.hr_ot + r.hr_dt + r.hr_other;
  byAcctOutage.set(r.account_key, cur);
}
console.log(`\n  per-account rollup:`);
console.log(`  account        weeks  entries  appr  draft  final  paid   total_h`);
for (const r of [...byAcctOutage.values()].sort((a, b) => a.account_key.localeCompare(b.account_key))) {
  console.log(`  ${r.account_key.padEnd(14)} ${String(r.weeks).padStart(5)}  ${String(r.entries).padStart(7)}  ${String(r.appr).padStart(4)}  ${String(r.draft).padStart(5)}  ${String(r.final).padStart(5)}  ${String(r.paid).padStart(4)}  ${r.hr_total.toFixed(1).padStart(8)}`);
}

// ── Presence roll-off oldest-live date (Q5) ──────────────────────
let oldestLiveStart = null;
for (const te of timeEntries) {
  const d = localDate(te.payload?.start_time);
  if (!d) continue;
  if (oldestLiveStart === null || d < oldestLiveStart) oldestLiveStart = d;
}
console.log(`\n=== PRESENCE ROLL-OFF (Q5) ===`);
console.log(`  oldest start_date among the ${timeEntries.length} live-in-presence deduped entries: ${oldestLiveStart}`);

// ── Open question answers ────────────────────────────────────────
console.log(`\n=== OPEN QUESTIONS - ANSWERS ===`);
console.log(`Q1 account mapping: carries over unchanged.`);
console.log(`  deriveActuals.js resolves account_key via workerToDept[worker_id] -> deptMap[dept_id].account_key.`);
console.log(`  time_entries.payload.worker_id is the SAME field pay_segments.owner_role.id is (both are Rippling worker ids). Verified: 100% match on 157 labor_actuals.worker_id and 94 pay_segments owner_role.id in the brief.`);
console.log();
console.log(`Q2 line_code: carries over unchanged.`);
console.log(`  deriveActuals.js:252-257 keys line_code off accountToHourlyLine.get(account_key). Pulls rippling_department_map rows where pnl_line = '3100.1'. This lookup does NOT depend on the entry type; a time_entry attributes to an account the same way, and the account's hourly line is read the same way. Daily-grain probe failure 2026-10-02 is a separate issue (grain-side 2-row mismatch across 1492 rows) unrelated to line_code assignment.`);
console.log();
console.log(`Q3 status gating:`);
console.log(`  current derive (deriveActuals.js:619-663):`);
console.log(`    DRAFT      -> draft_entry_count, draft_hours (gated by APPROVAL_TRACKING_START), anomaly_* detectors`);
console.log(`    APPROVED   -> approved_entry_count, approved_hours, still_costing (if zo-hop empty)`);
console.log(`    FINALIZED  -> no accumulator (hours flow via segments)`);
console.log(`    PAID       -> no accumulator (hours flow via segments)`);
console.log(`  observed status distribution in this probe (over the ${attrEntries} attributed entries) is above.`);
console.log(`  Stage 3 recommendation: treat FINALIZED and PAID as approved-equivalent for hours/dollars accounting - they are POST-approval states.`);
console.log();
console.log(`Q4 timezone: slice(0, 10) on the ISO start_time (which carries the local offset in text).`);
console.log(`  start_time example: "2026-10-05T22:00:00-05:00" -> slice yields "2026-10-05", the LOCAL date. Matches deriveActuals.js:581 convention.`);
console.log(`  Rule: bucket on the offset in the timestamp itself. Never a UTC cast, never a fixed zone, never a bare ::date cast on the whole timestamp.`);
console.log();
console.log(`Q5 presence roll-off: SAME property as pay-segments.`);
console.log(`  Both time_entries and pay_segments are gated by the live presence set. If a time_entry ages out of rippling_current_presence, a re-derive of its old week would lose that row too. The oldest live start_date is reported above.`);
console.log(`  Architectural risk: a re-derive of a historical range depends on presence still containing those entries.`);
console.log();
console.log(`Q6 anomaly columns: YES, all three computable from a time entry alone.`);
console.log(`  anomaly_no_clockout: DRAFT + end_time missing/empty.`);
console.log(`  anomaly_under_1h:    DRAFT + time_entry_summary.duration in (0, 1.0).`);
console.log(`  anomaly_over_16h:    DRAFT + time_entry_summary.duration > 16.0.`);
console.log(`  Reads from deriveActuals.js:627-629 are already time-entry-only.`);

console.log("\ndone.");
