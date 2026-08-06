// src/lib/labor/deriveActuals.js
//
// Derive labor_actuals + labor_unattributed from the four Rippling raw
// _latest views + rippling_department_map + sc_day_metadata.
//
// Never calls Rippling. Postgres only. When the department map is
// corrected (a `- REDS`-class discovery), re-derive rather than
// re-pull. When the raw layer is updated by the nightly sync, re-derive.
//
// Grain: (account_key, worker_id, week_label, line_code).
//
// Design decisions baked in:
//
//   - amount = sum of pay_segment.estimated_amount (Rippling-computed, D27)
//     Never hours * rate.
//   - Regular vs overtime: overtime_multiplier > 1.0 OR
//     merged_earning_type_name matches /overtime|OT/i.
//   - Attribution via worker.department_id -> rippling_department_map
//     -> account_key + pnl_line. Never from department name (D24, D32).
//   - Approval state is dollar-accurate via the two-hop join:
--        pay_segment.time_entry.id -> zo.id (UUID direct)
--        zo.external_id -> REST rippling_id (Mongo ObjectId direct)
//     Requires PR 8a-2's rippling_raw_time_entry_zo table.
//   - Week resolution: sc_day_metadata.week_label if the (account,
//     date) pair exists, ISO week otherwise. week_source records which.
//   - Every status present in approval_state even at zero (N2).
//   - Unattributed goes to labor_unattributed with reason_code (N5).
//
// PR 8b produces 3100.1 only. 3100.2 needs compensations.read
// per worker allocated by period; its own design with §8 access weight.

// ─── Constants ──────────────────────────────────────────────────────

// Fiscal year boundaries (playbook §12, FY2026_END provisional pending Joe).
const FY_BOUNDARIES = [
  { fy: 2025, start: "2024-12-30", end: "2025-12-28" }, // approximation
  { fy: 2026, start: "2025-12-29", end: "2026-12-27" },
  { fy: 2027, start: "2026-12-28", end: "2027-12-26" }, // approximation
];
function fiscalYearForDate(date) {
  for (const b of FY_BOUNDARIES) {
    if (date >= b.start && date <= b.end) return b.fy;
  }
  return null;
}

const ALL_STATUSES = ["DRAFT", "APPROVED", "PAID", "FINALIZED"];

function isOTSegment(seg) {
  const mult = seg.overtime_multiplier == null ? 1.0 : Number(seg.overtime_multiplier);
  if (mult > 1.0) return true;
  const name = String(seg.merged_earning_type_name || "").toLowerCase();
  if (name.includes("overtime") || /\bot\b/.test(name)) return true;
  return false;
}

// ISO week helper - returns { week, year } for a given YYYY-MM-DD date.
function isoWeekOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}
function isoWeekBounds(dateStr) {
  const { year, week } = isoWeekOf(dateStr);
  // Find Monday of the ISO week containing this date
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    label: `iso-${year}-W${String(week).padStart(2, "0")}`,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

// ─── Load helpers ───────────────────────────────────────────────────

async function fetchAll(supa, tableOrView, columns = "*") {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supa.from(tableOrView).select(columns).range(from, from + 999);
    if (error) throw new Error(`${tableOrView}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// ─── Main derivation ────────────────────────────────────────────────

/**
 * Derive labor_actuals + labor_unattributed rows from Postgres raw tables.
 *
 * Returns { actuals, unattributed, stats } where stats contains counts
 * for logging. Does NOT write to DB - caller inserts.
 */
export async function deriveLaborActuals({ supa, sourceRun, log = () => {} }) {
  log("loading department map...");
  const deptMap = new Map();
  for (const d of await fetchAll(supa, "rippling_department_map")) {
    deptMap.set(d.department_id, d);
  }

  log("loading workers...");
  const workerToDept = new Map();
  for (const w of await fetchAll(supa, "rippling_raw_workers_latest", "payload")) {
    const wid = w.payload?.id;
    const did = w.payload?.department_id;
    if (wid) workerToDept.set(wid, did || null);
  }

  log("loading sc_day_metadata for week resolution...");
  // Map: `${account_key}|${service_date}` -> { period, week_label }
  const dayMap = new Map();
  // Map: `${account_key}|${period}|${week_label}` -> { start: minDate, end: maxDate }
  const weekBounds = new Map();
  for (const r of await fetchAll(supa, "sc_day_metadata", "account_key, service_date, period, week_label")) {
    if (!r.week_label || !r.period) continue;
    dayMap.set(`${r.account_key}|${r.service_date}`, { period: r.period, week_label: r.week_label });
    const wk = `${r.account_key}|${r.period}|${r.week_label}`;
    const existing = weekBounds.get(wk);
    if (!existing) weekBounds.set(wk, { start: r.service_date, end: r.service_date });
    else {
      if (r.service_date < existing.start) existing.start = r.service_date;
      if (r.service_date > existing.end) existing.end = r.service_date;
    }
  }

  log("loading pay segments...");
  const segments = await fetchAll(supa, "rippling_raw_pay_segments_latest", "payload");

  log("loading time entries...");
  const entries = await fetchAll(supa, "rippling_raw_time_entries_latest", "rippling_id, payload");

  log("loading time_entry_zo...");
  const zos = await fetchAll(supa, "rippling_raw_time_entry_zo_latest", "rippling_id, payload");

  // Build zo lookup indexes
  const zoById = new Map();
  const zoByExternal = new Map();
  for (const z of zos) {
    zoById.set(z.rippling_id, z.payload);
    if (z.payload?.external_id) zoByExternal.set(z.payload.external_id, z.payload);
  }
  const teByRid = new Map();
  for (const e of entries) teByRid.set(e.rippling_id, e.payload);

  // ─── Week resolver ────────────────────────────────────────────────
  function resolveWeek(accountKey, dateStr) {
    const key = `${accountKey}|${dateStr}`;
    const day = dayMap.get(key);
    if (day) {
      const bounds = weekBounds.get(`${accountKey}|${day.period}|${day.week_label}`);
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

  // ─── Attribution resolver ────────────────────────────────────────
  function attribute(workerId, segmentDate) {
    if (!workerId) return { reason: "unknown_worker" };
    if (!workerToDept.has(workerId)) return { reason: "unknown_worker", worker_id: workerId };
    const deptId = workerToDept.get(workerId);
    if (!deptId) return { reason: "no_worker_department", worker_id: workerId };
    const dept = deptMap.get(deptId);
    if (!dept) return { reason: "unknown_department", worker_id: workerId, department_id: deptId };
    if (dept.is_container) return { reason: "container_leak", worker_id: workerId, department_id: deptId, department_name: dept.department_name };
    if (!dept.pnl_line) return { reason: "unknown_department", worker_id: workerId, department_id: deptId, department_name: dept.department_name, notes: "dept in map but no pnl_line" };
    if (dept.account_key === "CORP") return null; // CORP is out of scope; skip silently (D17)
    return { account_key: dept.account_key, line_code: dept.pnl_line, department_id: deptId, department_name: dept.department_name };
  }

  // ─── Aggregate buckets ────────────────────────────────────────────
  // key: `${account}|${worker}|${week_label}|${week_start}|${week_end}|${line}`
  const buckets = new Map();
  const unattributed = [];
  const newDeptAlerts = new Set(); // department_ids seen in data but not in map
  const stats = {
    segments_processed: 0,
    segments_attributed: 0,
    segments_unattributed: 0,
    entries_processed: 0,
    entries_attributed: 0,
    entries_unattributed: 0,
    entries_without_zo: 0,
    entries_without_segments: 0,
    iso_fallback_dates: new Set(),
  };

  function getBucket(accountKey, workerId, weekInfo, lineCode) {
    const k = `${accountKey}|${workerId}|${weekInfo.week_label}|${weekInfo.week_start}|${weekInfo.week_end}|${lineCode}`;
    let b = buckets.get(k);
    if (!b) {
      b = {
        account_key: accountKey, worker_id: workerId,
        week_label: weekInfo.week_label, week_start: weekInfo.week_start, week_end: weekInfo.week_end,
        fiscal_year: fiscalYearForDate(weekInfo.week_start) || 2026,
        period_no: weekInfo.period_no,
        line_code: lineCode,
        week_source: weekInfo.week_source,
        segments: [],
        entries: [], // { te, zoId, status }
      };
      buckets.set(k, b);
    }
    return b;
  }

  // ─── Iterate pay segments ─────────────────────────────────────────
  for (const rec of segments) {
    stats.segments_processed++;
    const seg = rec.payload;
    const workerId = seg.owner_role?.id;
    const segDate = seg.segment_date;
    if (!segDate) { stats.segments_unattributed++; continue; }
    const attr = attribute(workerId, segDate);
    if (attr === null) continue; // CORP - skip
    if (attr.reason) {
      stats.segments_unattributed++;
      if (attr.department_id && !deptMap.has(attr.department_id)) newDeptAlerts.add(attr.department_id);
      unattributed.push({
        reason_code: attr.reason,
        department_id: attr.department_id || null,
        department_name: attr.department_name || null,
        worker_id: attr.worker_id || workerId || null,
        segment_date: segDate,
        amount: Number(seg.estimated_amount || 0),
        hours: Number(seg.segment_duration_hours || 0),
        segment_count: 1,
        source_run: sourceRun,
        notes: attr.notes || null,
      });
      continue;
    }
    stats.segments_attributed++;
    const weekInfo = resolveWeek(attr.account_key, segDate);
    if (weekInfo.week_source === "iso_fallback") stats.iso_fallback_dates.add(segDate);
    const bucket = getBucket(attr.account_key, workerId, weekInfo, attr.line_code);
    bucket.segments.push(seg);
  }

  // ─── Iterate time entries ─────────────────────────────────────────
  for (const rec of entries) {
    stats.entries_processed++;
    const te = rec.payload;
    const workerId = te.worker_id;
    const startDate = te.start_time?.slice(0, 10);
    if (!startDate || !workerId) { stats.entries_unattributed++; continue; }
    const attr = attribute(workerId, startDate);
    if (attr === null) continue;
    if (attr.reason) { stats.entries_unattributed++; continue; } // segments already tracked unattributed
    stats.entries_attributed++;
    const weekInfo = resolveWeek(attr.account_key, startDate);
    if (weekInfo.week_source === "iso_fallback") stats.iso_fallback_dates.add(startDate);
    const bucket = getBucket(attr.account_key, workerId, weekInfo, attr.line_code);

    // Try to find zo for this entry (via te.rippling_id == zo.external_id)
    const zo = zoByExternal.get(rec.rippling_id);
    if (!zo) stats.entries_without_zo++;
    bucket.entries.push({
      te,
      te_rippling_id: rec.rippling_id,
      zoId: zo?.id || null,
      status: te.status || "(no-status)",
      duration_hours: Number(zo?.duration_hours || 0),
    });
  }

  // ─── Build output rows ────────────────────────────────────────────
  const actuals = [];
  for (const b of buckets.values()) {
    // Sum segments for amount + hours
    let amount = 0, hoursReg = 0, hoursOt = 0;
    // Index segments by their zoId (via seg.time_entry.id) for the join
    const segsByZoId = new Map(); // zoId -> [segments]
    for (const seg of b.segments) {
      const zoId = seg.time_entry?.id;
      amount += Number(seg.estimated_amount || 0);
      const hrs = Number(seg.segment_duration_hours || 0);
      if (isOTSegment(seg)) hoursOt += hrs; else hoursReg += hrs;
      if (zoId) {
        if (!segsByZoId.has(zoId)) segsByZoId.set(zoId, []);
        segsByZoId.get(zoId).push(seg);
      }
    }

    // Build approval_state per status: entries, dollars, entries_without_segments, hours_without_segments
    const approval = {};
    for (const st of ALL_STATUSES) approval[st] = { entries: 0, dollars: 0, entries_without_segments: 0, hours_without_segments: 0 };
    // Distinct entry_id per bucket
    const distinctEntries = new Set();
    for (const e of b.entries) {
      const st = ALL_STATUSES.includes(e.status) ? e.status : "(no-status)";
      if (!approval[st]) approval[st] = { entries: 0, dollars: 0, entries_without_segments: 0, hours_without_segments: 0 };
      approval[st].entries++;
      distinctEntries.add(e.te_rippling_id);
      // Look up segments for this entry via zoId
      const segs = e.zoId ? (segsByZoId.get(e.zoId) || []) : [];
      if (segs.length === 0) {
        approval[st].entries_without_segments++;
        approval[st].hours_without_segments += e.duration_hours;
        stats.entries_without_segments++;
      } else {
        for (const seg of segs) approval[st].dollars += Number(seg.estimated_amount || 0);
      }
    }
    // Round the JSONB values
    for (const st of Object.keys(approval)) {
      approval[st].dollars = Math.round(approval[st].dollars * 100) / 100;
      approval[st].hours_without_segments = Math.round(approval[st].hours_without_segments * 100) / 100;
    }

    actuals.push({
      account_key: b.account_key,
      worker_id: b.worker_id,
      week_label: b.week_label,
      week_start: b.week_start,
      week_end: b.week_end,
      fiscal_year: b.fiscal_year,
      period_no: b.period_no,
      line_code: b.line_code,
      amount: Math.round(amount * 100) / 100,
      hours_regular: Math.round(hoursReg * 100) / 100,
      hours_overtime: Math.round(hoursOt * 100) / 100,
      segment_count: b.segments.length,
      entry_count: distinctEntries.size,
      approval_state: approval,
      week_source: b.week_source,
      source_run: sourceRun,
    });
  }

  stats.new_department_alerts = [...newDeptAlerts];
  stats.iso_fallback_date_count = stats.iso_fallback_dates.size;
  delete stats.iso_fallback_dates;

  return { actuals, unattributed, stats };
}
