// src/lib/labor/timeEntriesDerive.js
//
// Shared compute for the two time-entries-sourced labor derives
// (weekly: scripts/derive_labor_actuals_from_time_entries.mjs;
//  daily:  scripts/derive_labor_actuals_daily.mjs).
//
// Extracted 2026-10-16 (labor-te-2). Rationale from the labor-te-2
// brief: "if the two derives compute hours or dollars differently,
// the grain probe's D1 reconciliation can never tie." One source of
// truth for presence loading, dedupe, attribution, rate resolution,
// and per-entry hours+dollars computation. The two scripts bucket
// differently (weekly groups by week_start, daily groups by
// work_date) and write differently (weekly via windowed RPC, daily
// via bounded delete+insert); the compute itself is shared.

// Known Rippling status values. Any new status must be surfaced
// explicitly rather than silently dropped - count it in skippedStatus
// and fail the run if it ever becomes non-zero.
export const KNOWN_STATUSES = new Set(["APPROVED", "FINALIZED", "PAID", "DRAFT"]);

// Statuses that populate the approved_hours subset tracker. These
// are POST-approval states; the realized hours+dollars path treats
// every known status identically per owner ruling 2026-10-16.
export const APPROVED_EQUIVALENT = new Set(["APPROVED", "FINALIZED", "PAID"]);

// Segment display_name values that count as the worker's REGULAR
// hourly rate (used by resolveRate for the primary lookup).
export const REGULAR_SEGMENT_NAMES = new Set(["Regular", "Base Pay"]);

// Date rule: slice(0, 10) on the ISO start_time, which carries the
// local UTC offset in its text. Never a ::date cast on the full
// timestamp. Accounts span ET/CT/MT/AZ. Mirrors deriveActuals.js:581.
export function localDate(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : null;
}

// Postgres offset-paginate helper. Supabase .select() caps at 1000
// rows per request; pageAll walks the result set deterministically
// via .range(from, from+size-1).
export async function pageAll(builderFactory, pageSize = 1000) {
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

// Keyset-paginate on rippling_id (text PK). Used for the _latest
// DISTINCT ON views; offset-paginate on those crosses the Postgres
// statement timeout at ~60s on the deeper pages (incident
// 2026-08-22..27 on rippling_raw_time_entries_latest).
export async function keysetPage(builderFactory, keyCol = "rippling_id", pageSize = 1000) {
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

// Build worker -> hourly wage from compensations_latest, presence-
// filtered. Gate on hourly_wage.value > 0 directly - payment_type is
// DEFAULT (hourly workers) or VARIED (variable-rate workers); only
// DEFAULT carries a usable wage, and the field itself is the
// authoritative signal regardless of the payment_type label. Latest
// payload.updated_at per worker wins.
async function loadWorkerToWage(supa, presenceComp) {
  const comps = await keysetPage(() =>
    supa.from("rippling_raw_compensations_latest").select("rippling_id, payload"));
  const workerToWage = new Map();
  let compPresenceDrops = 0, compNoWageDrops = 0;
  for (const c of comps) {
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
  return { workerToWage, compPresenceDrops, compNoWageDrops, compsCount: comps.length };
}

// Load all reference maps needed for the time-entries derive.
// Single shared loader so weekly + daily always see the same corpus.
export async function loadReferenceData(supa) {
  // Presence sets
  const presenceTe = new Set();
  for (const r of await pageAll(() =>
    supa.from("rippling_current_presence").select("rippling_id").eq("kind", "time_entries"))) {
    presenceTe.add(r.rippling_id);
  }
  const presenceComp = new Set();
  for (const r of await pageAll(() =>
    supa.from("rippling_current_presence").select("rippling_id").eq("kind", "compensations"))) {
    presenceComp.add(r.rippling_id);
  }

  // Department map + account->hourly-line (3100.1 only; mirrors the
  // 2026-09-17 Anna Hughes fix in deriveActuals.js and the daily derive).
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

  // Workers -> their current department.
  const workers = await keysetPage(() =>
    supa.from("rippling_raw_workers_latest").select("rippling_id, payload"));
  const workerToDept = new Map();
  for (const w of workers) {
    const wid = w.payload?.id;
    if (wid) workerToDept.set(wid, w.payload?.department_id || null);
  }

  // Compensations -> current hourly wage per worker.
  const { workerToWage, compPresenceDrops, compNoWageDrops, compsCount } = await loadWorkerToWage(supa, presenceComp);

  // sc_day_metadata -> week bounds (for weekly bucketing). Daily uses
  // the service date directly, so this is only read on the weekly path.
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

  return {
    presenceTe,
    presenceComp,
    deptMap,
    accountToHourlyLine,
    workerToDept,
    workerToWage,
    dayMap,
    weekBoundsMap,
    counts: {
      presenceTe: presenceTe.size,
      presenceComp: presenceComp.size,
      deptMap: deptMap.size,
      accountToHourlyLine: accountToHourlyLine.size,
      workers: workers.length,
      compsLatest: compsCount,
      compPresenceDrops,
      compNoWageDrops,
      workerToWage: workerToWage.size,
      dayRows: dayRows.length,
    },
  };
}

// Load time_entries (presence-filtered, deduped by payload.id with
// latest payload.updated_at winning). This matches the pay_segments
// dedupe pattern (payload.external_id in that case); rippling_id gets
// re-issued for the same logical record so dedupe-by-logical-id is
// required.
export async function loadTimeEntries(supa, presenceTe) {
  const teLatest = await keysetPage(() =>
    supa.from("rippling_raw_time_entries_latest").select("rippling_id, payload"));
  const liveTe = teLatest.filter(r => presenceTe.has(r.rippling_id));
  const bestById = new Map();
  for (const r of liveTe) {
    const id = r.payload?.id;
    if (!id) continue;
    const uat = r.payload?.updated_at || "";
    const prev = bestById.get(id);
    if (!prev || uat > prev.uat) bestById.set(id, { r, uat });
  }
  return {
    timeEntries: [...bestById.values()].map(x => x.r),
    counts: { latest: teLatest.length, liveInPresence: liveTe.length },
  };
}

// Attribution factory. Returns the attribute(workerId) function
// closing over the reference maps. Mirrors deriveActuals.js:attribute
// and derive_labor_actuals_daily.js:attribute exactly, so the three
// derives attribute identically.
export function makeAttribute({ workerToDept, deptMap, accountToHourlyLine }) {
  return function attribute(workerId) {
    if (!workerId || !workerToDept.has(workerId)) return null;
    const deptId = workerToDept.get(workerId);
    if (!deptId) return null;
    const d = deptMap.get(deptId);
    if (!d || d.is_container) return null;
    if (d.account_key === "CORP") return null;
    const hourlyLine = accountToHourlyLine.get(d.account_key);
    if (!hourlyLine) return null;
    return { account_key: d.account_key, line_code: hourlyLine };
  };
}

// Rate resolution factory. Returns resolveRate(payload, workerId)
// closing over workerToWage. Two sources in order: segment pay_rate
// on Regular/Base Pay segments (null on 34.4% of Regular segments in
// the live corpus) then the compensations hourly wage fallback.
// Measured 2026-10-16: the two-source rate gets 409/465 worker-weeks
// exact; wage-only gets 363/465. The 51-week gap is mostly mid-week
// raises where the shift carries the old rate and the wage record
// only knows the new one.
export function makeResolveRate({ workerToWage }) {
  return function resolveRate(payload, workerId) {
    const segs = Array.isArray(payload.segments) ? payload.segments : [];
    for (const seg of segs) {
      if (!REGULAR_SEGMENT_NAMES.has(seg.display_name)) continue;
      const r = Number(seg.pay_rate);
      if (Number.isFinite(r) && r > 0) return { rate: r, source: "segment" };
    }
    const wage = workerToWage.get(workerId);
    if (wage && wage.wage > 0) return { rate: wage.wage, source: "compensations" };
    return { rate: 0, source: "none" };
  };
}

// Per-entry hours and dollars computation. Returns the four hour
// buckets, the four dollar buckets, the total duration, and the
// break-even "other" category for any display_name outside the three
// known labels. Owner ruling 2026-10-16: approval state is NOT a
// filter on cost; every status is priced identically here. The
// subset trackers (approved_hours, draft_hours, anomalies) are the
// caller's responsibility - this function returns realized values.
//
// labor-te-2 precision note: Rippling returns time_entry_summary
// hour fields at full timestamp precision (a 7h40m shift lands as
// 7.683333333333334 regular_hours; 264 of 832 post-floor fields
// examined 2026-10-16 carry sub-cent precision). The storage column
// labor_actuals_daily.hours_regular is NUMERIC(10,2), so hours are
// rounded to 2dp PER ENTRY here before accumulation. This has two
// consequences, both intentional:
//   (a) daily and weekly derives sum identical 2dp per-entry
//       contributions, so the grain probe D1 reconciliation ties
//       exactly on hours - no "per-day rounding drift" against the
//       single-pass weekly round. See the D1 header in the probe.
//   (b) dollars are computed from the 2dp-rounded hours, which is
//       what Rippling's payroll actually runs on - its UI shows
//       7.68, not 7.6833. The alternative (full-precision hours ×
//       rate) would land dollars that cannot be reproduced from the
//       stored hours by multiplying by rate.
//
// Multipliers hardcoded by display_name presence in the live corpus:
//   Regular              -> 1.0 (10,841 segments)
//   1.5x Overtime        -> 1.5 (1,360 segments)
//   Holiday Double Rate  -> 2.0 (29 segments; ot_multiplier is NULL,
//                                the rule D37 trap)
// A detector reading ot_multiplier misses holidays. The hardcoded
// multipliers reflect the actual OT allocation Rippling has already
// done in time_entry_summary.*_hours.
const h2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function computeEntryHoursAndDollars(payload, rate) {
  const summary = payload.time_entry_summary || {};
  // Round to 2dp PER ENTRY (storage precision) before accumulating.
  // See the function header for the rationale.
  const dur = h2(summary.duration);
  const reg = h2(summary.regular_hours);
  const ot = h2(summary.over_time_hours);
  const dot = h2(summary.double_over_time_hours);
  const other = Math.max(0, dur - reg - ot - dot);
  return {
    dur, reg, ot, dot, other,
    dollars_regular:       reg   * rate,
    dollars_overtime:      ot    * rate * 1.5,
    dollars_double_time:   dot   * rate * 2.0,
    dollars_premium_other: other * rate,
  };
}
