// src/lib/labor/deriveActuals.js
//
// KPI PR 8b - part B1. Derives labor_actuals + labor_unattributed from
// the raw Rippling tables, presence, earning_type_map, and the department
// map. Never calls the Rippling API; Postgres only.
//
// Design decisions this file encodes (playbook v0.7):
//
//   D36 - presence FILTERS. Sum every raw pay-segment row whose
//         rippling_id is in rippling_current_presence. Never fall back
//         to a retired observation. Never reconstruct a figure for a
//         labor fact with no present row. Orphan counts surface as a
//         nightly-log line and hours_only coverage on the affected
//         week.
//
//   D37 - earning types resolve through earning_type_map. Left-join
//         merged_earning_type_name. Never a regex, never
//         overtime_multiplier (null on Holiday Double Rate, which
//         pays 2x). Unmapped names route to hours_premium_other AND
//         upsert into earning_type_unmapped for visibility.
//
//   D38 - full nightly re-derive. Upsert-on-grain via atomic per-account
//         swap RPC. Preserved column: earning_type_unmapped.first_seen_at
//         (SET, not accumulate).
//
//   B3  - if the most recent successful pay_segments walk completed
//         more than 54 hours ago, EVERY emitted row gets
//         coverage_state='unknown' and no dollar figure is authoritative.
//
//   B4  - hours from time_entry_summary.duration on the REST time
//         entry, NEVER from zo.duration_hours (null once ZO is pruned).
//
//   D26 - CIN-KY and TBJ-NY are salaried-only. Their 3100.1 rows are
//         never emitted.
//
//   D27 - never compute labor as hours times rate. Every dollar comes
//         from a live pay-segment's estimated_amount.

const ALL_KINDS = ["time_entries", "pay_segments", "workers", "time_entry_zo"];
const STALE_PRESENCE_H = 54;
const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);

// Full source-of-truth fiscal-year boundaries (playbook §12: FY2026_END
// provisional pending Joe). Weeks whose start date falls outside a
// known FY get period_no=null; the weekly row still emits.
const FY_BOUNDARIES = [
  { fy: 2025, start: "2024-12-30", end: "2025-12-28" },
  { fy: 2026, start: "2025-12-29", end: "2026-12-27" },
  { fy: 2027, start: "2026-12-28", end: "2027-12-26" },
];
function fiscalYearForDate(dateStr) {
  for (const b of FY_BOUNDARIES) {
    if (dateStr >= b.start && dateStr <= b.end) return b.fy;
  }
  return null;
}

// ISO week helper. Returns "YYYY-Www" label + start/end YYYY-MM-DD.
function isoWeekOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week };
}
function isoWeekBounds(dateStr) {
  const { year, week } = isoWeekOf(dateStr);
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

async function fetchAll(supa, tableOrView, columns = "*", filters = []) {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = supa.from(tableOrView).select(columns).range(from, from + PAGE - 1);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tableOrView}: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/**
 * Derive labor_actuals + labor_unattributed rows.
 *
 * @param {object} opts
 * @param {SupabaseClient} opts.supa
 * @param {string} opts.sourceRun - 'nightly' | 'manual' | 'backfill'
 * @param {(msg:string)=>void} [opts.log]
 * @param {number|null} [opts.forcePresenceAgeH] - TEST HOOK - override presence-age
 *        computation. Requires KPI_DERIVE_TEST_HOOKS=1 in env or throws. If set past 54h,
 *        every emitted row reads coverage_state='unknown' and the dashboard goes blank -
 *        that is what makes it a test hook rather than a production knob.
 * @param {Array<object>|null} [opts.overrideDeptMap] - TEST HOOK - inline dept map (rows
 *        shaped like rippling_department_map). Requires KPI_DERIVE_TEST_HOOKS=1 in env or
 *        throws. Existed to let acceptance evidence run pre-migration-apply and stays for
 *        regression testing; production must never pass it.
 * @returns {{
 *   accountResults: Array<{ accountKey, actuals: Row[], stats }>,
 *   unattributed: Row[],
 *   unmappedTotals: Array<{name, count, hours, amount}>,
 *   stats: { presenceAgeH, isStalePresence, orphanCount, ... }
 * }}
 */
export async function deriveLaborActuals({ supa, sourceRun, log = () => {}, forcePresenceAgeH = null, overrideDeptMap = null }) {
  // Gate the test hooks. Positive-gate on an env var rather than negative-gate on
  // NODE_ENV: the workflow does not set NODE_ENV=production, so a NODE_ENV check
  // would silently allow test hooks in production. KPI_DERIVE_TEST_HOOKS must be
  // set explicitly - the nightly workflow does not set it, so test hooks cannot
  // fire from production callers by accident. Fails loud, mentions the flag.
  if ((forcePresenceAgeH != null || overrideDeptMap != null) && process.env.KPI_DERIVE_TEST_HOOKS !== "1") {
    throw new Error(
      "deriveLaborActuals: forcePresenceAgeH and overrideDeptMap are test-only hooks. " +
      "Set KPI_DERIVE_TEST_HOOKS=1 to enable. Never set this env var in production - " +
      "forcePresenceAgeH>54 flips every row to coverage_state=unknown and blanks the dashboard."
    );
  }
  const runStart = Date.now();

  // ── 1. Presence + walks ──────────────────────────────────────
  log("loading walks (last successful per kind)...");
  const walkByKind = new Map();
  for (const kind of ALL_KINDS) {
    const { data, error } = await supa
      .from("rippling_walks")
      .select("id, kind, completed_at, ids_seen")
      .eq("kind", kind)
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`walks[${kind}]: ${error.message}`);
    walkByKind.set(kind, data || null);
  }

  const psWalk = walkByKind.get("pay_segments");
  const psAgeH = forcePresenceAgeH != null
    ? forcePresenceAgeH
    : (psWalk?.completed_at ? (runStart - new Date(psWalk.completed_at).getTime()) / (1000 * 60 * 60) : null);
  const isStalePresence = psAgeH == null || psAgeH > STALE_PRESENCE_H;
  log(`pay_segments presence age: ${psAgeH == null ? "no successful walk" : psAgeH.toFixed(2) + "h"} - ${isStalePresence ? "STALE (>54h) all rows will read unknown" : "fresh"}`);

  log("loading pay-segment presence ids...");
  const presencePaySegs = new Set();
  {
    let from = 0;
    while (true) {
      const { data, error } = await supa
        .from("rippling_current_presence")
        .select("rippling_id")
        .eq("kind", "pay_segments")
        .range(from, from + 999);
      if (error) throw new Error(`presence: ${error.message}`);
      for (const r of data) presencePaySegs.add(r.rippling_id);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  log(`presence holds ${presencePaySegs.size} pay-segment ids`);

  // ── 2. Lookup tables ─────────────────────────────────────────
  log("loading department + earning-type maps...");
  let deptRows;
  if (overrideDeptMap) {
    deptRows = overrideDeptMap;
    log(`  (using inline dept map: ${deptRows.length} rows - test/pre-apply mode)`);
  } else {
    deptRows = await fetchAll(supa, "rippling_department_map",
      "department_id, department_name, account_key, pnl_line, is_container");
  }
  const deptMap = new Map(deptRows.map(d => [d.department_id, d]));

  const emRows = await fetchAll(supa, "earning_type_map",
    "merged_earning_type_name, multiplier, bucket");
  const earningMap = new Map(emRows.map(m => [m.merged_earning_type_name, m]));

  // ── 3. Raw data ──────────────────────────────────────────────
  log("loading workers...");
  const workers = await fetchAll(supa, "rippling_raw_workers_latest", "payload");
  const workerToDept = new Map();
  for (const w of workers) {
    const wid = w.payload?.id;
    if (wid) workerToDept.set(wid, w.payload?.department_id || null);
  }

  log("loading pay-segments (raw, presence-filtered client-side)...");
  const paySegsRaw = await fetchAll(supa, "rippling_raw_pay_segments",
    "rippling_id, payload");
  const paySegs = paySegsRaw.filter(s => presencePaySegs.has(s.rippling_id));
  log(`  raw=${paySegsRaw.length} live-in-presence=${paySegs.length} orphan-observations=${paySegsRaw.length - paySegs.length}`);

  log("loading time_entries...");
  const teRows = await fetchAll(supa, "rippling_raw_time_entries_latest", "rippling_id, payload");

  log("loading time_entry_zo...");
  const zoRows = await fetchAll(supa, "rippling_raw_time_entry_zo_latest", "rippling_id, payload");

  // ── 4. Indexes ───────────────────────────────────────────────
  // zo by external_id (= REST te.rippling_id): te -> zo hop
  const zoByExtId = new Map();
  for (const z of zoRows) {
    const ext = z.payload?.external_id;
    if (ext) zoByExtId.set(ext, z);
  }
  // segments by zo.id (= seg.time_entry.id): zo -> segments hop
  const segsByZoId = new Map();
  for (const s of paySegs) {
    const zoId = s.payload?.time_entry?.id;
    if (!zoId) continue;
    if (!segsByZoId.has(zoId)) segsByZoId.set(zoId, []);
    segsByZoId.get(zoId).push(s);
  }

  // ── 5. Week resolver (sc_day_metadata) ────────────────────────
  log("loading sc_day_metadata for week labels...");
  const dayMap = new Map();            // (account|date) -> { period, week_label }
  const weekBoundsMap = new Map();     // (account|period|week_label) -> { start, end }
  {
    const dayRows = await fetchAll(supa, "sc_day_metadata",
      "account_key, service_date, period, week_label");
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
  }
  function resolveWeek(accountKey, dateStr) {
    const key = `${accountKey}|${dateStr}`;
    const day = dayMap.get(key);
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

  // ── 6. Attribution ──────────────────────────────────────────
  function attribute(workerId) {
    if (!workerId) return { reason: "unknown_worker" };
    if (!workerToDept.has(workerId)) return { reason: "unknown_worker", workerId };
    const deptId = workerToDept.get(workerId);
    if (!deptId) return { reason: "no_worker_department", workerId };
    const d = deptMap.get(deptId);
    if (!d) return { reason: "unknown_department", workerId, deptId };
    if (d.is_container) return { reason: "container_leak", workerId, deptId };
    if (d.account_key === "CORP") return null;                       // D17 out of scope
    if (D26_SALARIED_ONLY.has(d.account_key) && d.pnl_line === "3100.1") return null;  // D26
    if (!d.pnl_line) return { reason: "unknown_department", workerId, deptId };
    return { account_key: d.account_key, line_code: d.pnl_line, deptId };
  }

  // ── 7. Bucket accumulator ────────────────────────────────────
  const buckets = new Map();           // key -> bucket
  function bkey(a, w, wk, ln) { return `${a}|${w}|${wk}|${ln}`; }
  function getBucket(attr, weekInfo) {
    const k = bkey(attr.account_key, "PLACEHOLDER", weekInfo.week_label, attr.line_code);
    // NOTE: worker_id filled per-row below
    return k;
  }

  const unattributedByKey = new Map();   // (reason|dept|worker) -> aggregated
  function bumpUnattr(reason, deptId, workerId, seg) {
    const key = `${reason}|${deptId || ""}|${workerId || ""}`;
    const cur = unattributedByKey.get(key) || {
      reason_code: reason, department_id: deptId || null, worker_id: workerId || null,
      amount: 0, hours: 0, segment_count: 0,
      first_seen_date: null, last_seen_date: null,
    };
    cur.amount += Number(seg.payload?.estimated_amount || 0);
    cur.hours += Number(seg.payload?.segment_duration_hours || 0);
    cur.segment_count++;
    const d = seg.payload?.segment_date;
    if (d) {
      if (!cur.first_seen_date || d < cur.first_seen_date) cur.first_seen_date = d;
      if (!cur.last_seen_date  || d > cur.last_seen_date)  cur.last_seen_date  = d;
    }
    unattributedByKey.set(key, cur);
  }

  const unmappedTotals = new Map();  // earning_type_name -> { count, hours, amount }
  function bumpUnmapped(name, seg) {
    const cur = unmappedTotals.get(name) || { count: 0, hours: 0, amount: 0 };
    cur.count++;
    cur.hours += Number(seg.payload?.segment_duration_hours || 0);
    cur.amount += Number(seg.payload?.estimated_amount || 0);
    unmappedTotals.set(name, cur);
  }

  // ── 8. First pass: segments -> buckets, unattributed, unmapped
  log("processing pay-segments...");
  const bucketRows = new Map();  // full bucket key including worker -> row
  function getFullBucket(accountKey, workerId, weekInfo, lineCode) {
    const k = `${accountKey}|${workerId}|${weekInfo.week_label}|${lineCode}`;
    let b = bucketRows.get(k);
    if (!b) {
      b = {
        account_key: accountKey, worker_id: workerId,
        week_label: weekInfo.week_label, week_start: weekInfo.week_start, week_end: weekInfo.week_end,
        fiscal_year: fiscalYearForDate(weekInfo.week_start),
        period_no: weekInfo.period_no,
        line_code: lineCode,
        week_source: weekInfo.week_source,
        hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
        dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
        amount: 0,
        hours_without_dollars: 0,
        segment_count: 0,
        entry_count: 0,
        coveredEntries: new Set(),   // te.rippling_id -> covered by at least one live segment
        seenEntries:    new Set(),   // te.rippling_id -> exists in bucket
      };
      bucketRows.set(k, b);
    }
    return b;
  }

  for (const seg of paySegs) {
    const p = seg.payload || {};
    const workerId = p.owner_role?.id;
    const segDate = p.segment_date;
    if (!segDate) continue;

    const attr = attribute(workerId);
    if (attr === null) continue;         // CORP or D26 salaried-only 3100.1
    if (attr.reason) {
      bumpUnattr(attr.reason, attr.deptId, attr.workerId || workerId, seg);
      continue;
    }

    const weekInfo = resolveWeek(attr.account_key, segDate);
    const bucket = getFullBucket(attr.account_key, workerId, weekInfo, attr.line_code);

    const hrs = Number(p.segment_duration_hours || 0);
    const amt = Number(p.estimated_amount || 0);
    bucket.amount += amt;
    bucket.segment_count++;

    const etName = p.merged_earning_type_name || null;
    const mapEntry = etName ? earningMap.get(etName) : null;
    if (!mapEntry) {
      bucket.hours_premium_other += hrs;
      bucket.dollars_premium_other += amt;
      if (etName) bumpUnmapped(etName, seg);
    } else if (mapEntry.bucket === "regular") {
      bucket.hours_regular += hrs;
      bucket.dollars_regular += amt;
    } else if (mapEntry.bucket === "overtime") {
      bucket.hours_overtime += hrs;
      bucket.dollars_overtime += amt;
    } else if (mapEntry.bucket === "double_time") {
      bucket.hours_double_time += hrs;
      bucket.dollars_double_time += amt;
    } else {
      bucket.hours_premium_other += hrs;
      bucket.dollars_premium_other += amt;
    }
  }

  // ── 9. Second pass: time-entries -> entry_count, hours_without_dollars
  log("processing time-entries for coverage + hours_without_dollars...");
  for (const te of teRows) {
    const p = te.payload || {};
    const workerId = p.worker_id;
    const startDate = p.start_time?.slice(0, 10);
    if (!startDate || !workerId) continue;

    const attr = attribute(workerId);
    if (attr === null) continue;
    if (attr.reason) continue;   // segments already logged; entries don't add anything

    const weekInfo = resolveWeek(attr.account_key, startDate);
    const bucket = getFullBucket(attr.account_key, workerId, weekInfo, attr.line_code);

    bucket.entry_count++;
    bucket.seenEntries.add(te.rippling_id);

    // Is this entry covered? te.rippling_id -> zo.external_id -> zo.id -> live pay-segment(s)
    const zo = zoByExtId.get(te.rippling_id);
    const segs = zo ? (segsByZoId.get(zo.rippling_id) || []) : [];
    const covered = segs.length > 0;
    if (covered) {
      bucket.coveredEntries.add(te.rippling_id);
    } else {
      // Uncovered: take hours from time_entry_summary.duration (B4)
      // NOT from zo.duration_hours (which is null once ZO is pruned)
      const dur = Number(p.time_entry_summary?.duration || 0);
      bucket.hours_without_dollars += dur;
    }
  }

  // ── 10. Coverage state + emit rows ─────────────────────────
  const perAccount = new Map();
  for (const b of bucketRows.values()) {
    let coverage_state;
    if (isStalePresence) {
      coverage_state = "unknown";
    } else if (b.entry_count === 0) {
      // Bucket exists only via segments (no time-entry counterpart) - treat as complete
      // since presence-verified segments carry their own hours+dollars.
      coverage_state = "complete";
    } else if (b.coveredEntries.size === b.seenEntries.size) {
      coverage_state = "complete";
    } else if (b.coveredEntries.size === 0) {
      coverage_state = "hours_only";
    } else {
      coverage_state = "partial";
    }

    // Round to 2 decimals
    const round2 = x => Math.round(x * 100) / 100;
    const row = {
      account_key: b.account_key,
      worker_id: b.worker_id,
      week_label: b.week_label,
      line_code: b.line_code,
      hours_regular: round2(b.hours_regular),
      hours_overtime: round2(b.hours_overtime),
      hours_double_time: round2(b.hours_double_time),
      hours_premium_other: round2(b.hours_premium_other),
      dollars_regular: round2(b.dollars_regular),
      dollars_overtime: round2(b.dollars_overtime),
      dollars_double_time: round2(b.dollars_double_time),
      dollars_premium_other: round2(b.dollars_premium_other),
      amount: round2(b.amount),
      hours_without_dollars: round2(b.hours_without_dollars),
      week_start: b.week_start,
      week_end: b.week_end,
      fiscal_year: b.fiscal_year,
      period_no: b.period_no,
      week_source: b.week_source,
      segment_count: b.segment_count,
      entry_count: b.entry_count,
      coverage_state,
    };

    if (!perAccount.has(b.account_key)) perAccount.set(b.account_key, []);
    perAccount.get(b.account_key).push(row);
  }

  // ── 11. Orphan count (segments with raw observations but no presence)
  // Already computed above as paySegsRaw.length - paySegs.length. Break
  // down by account so a nightly log can pinpoint which account is losing
  // coverage. Orphans that don't attribute to an account (unknown worker,
  // unmapped dept) also count.
  const orphansByAccount = new Map();
  let orphanTotal = 0;
  for (const s of paySegsRaw) {
    if (presencePaySegs.has(s.rippling_id)) continue;
    orphanTotal++;
    const wid = s.payload?.owner_role?.id;
    const attr = attribute(wid);
    const ak = (attr && !attr.reason) ? attr.account_key : "(unattributable)";
    orphansByAccount.set(ak, (orphansByAccount.get(ak) || 0) + 1);
  }

  // ── 12. Build outputs ──────────────────────────────────────
  const accountResults = [];
  for (const [accountKey, actuals] of perAccount.entries()) {
    accountResults.push({
      accountKey,
      actuals,
      stats: {
        rows: actuals.length,
        orphans: orphansByAccount.get(accountKey) || 0,
        buckets_by_state: actuals.reduce((acc, r) => {
          acc[r.coverage_state] = (acc[r.coverage_state] || 0) + 1;
          return acc;
        }, {}),
      },
    });
  }
  accountResults.sort((a, b) => a.accountKey.localeCompare(b.accountKey));

  const unattributed = [...unattributedByKey.values()];
  const unmappedRows = [...unmappedTotals.entries()].map(([name, v]) => ({
    merged_earning_type_name: name,
    occurrence_count: v.count,
    total_hours: Math.round(v.hours * 100) / 100,
    total_amount: Math.round(v.amount * 100) / 100,
    last_seen_at: new Date().toISOString(),
  }));

  const totalDurationSec = (Date.now() - runStart) / 1000;

  return {
    accountResults,
    unattributed,
    unmappedRows,
    stats: {
      presenceAgeH: psAgeH,
      isStalePresence,
      paySegRaw: paySegsRaw.length,
      paySegInPresence: paySegs.length,
      orphanTotal,
      orphansByAccount: Object.fromEntries(orphansByAccount),
      unmappedCount: unmappedRows.length,
      unattributedGroups: unattributed.length,
      durationSec: totalDurationSec,
      sourceRun,
    },
  };
}

/**
 * Write the derivation result to Postgres via the atomic per-account RPCs.
 * Called by scripts/derive_labor_actuals.mjs after deriveLaborActuals.
 */
export async function writeLaborDerivation({ supa, result, log = () => {} }) {
  const runStart = Date.now();
  let totalActualsWritten = 0;

  for (const acc of result.accountResults) {
    const { data, error } = await supa.rpc("swap_labor_actuals_for_account", {
      p_account_key: acc.accountKey,
      p_actuals: acc.actuals,
      p_source_run: result.stats.sourceRun,
    });
    if (error) {
      log(`  [${acc.accountKey}] swap FAILED: ${error.message}`);
      throw new Error(`swap_labor_actuals_for_account(${acc.accountKey}): ${error.message}`);
    }
    const written = typeof data === "number" ? data : data?.[0];
    totalActualsWritten += written || 0;
    log(`  [${acc.accountKey}] wrote ${written} labor_actuals rows`);
  }

  // Unattributed - one call
  const { error: uErr } = await supa.rpc("swap_labor_unattributed_all", {
    p_rows: result.unattributed,
    p_source_run: result.stats.sourceRun,
  });
  if (uErr) throw new Error(`swap_labor_unattributed_all: ${uErr.message}`);
  log(`  wrote ${result.unattributed.length} labor_unattributed rows`);

  // earning_type_unmapped - upsert with SET semantics, preserving first_seen_at.
  // Supabase-js upsert with partial payload: fields omitted from payload are
  // untouched on UPDATE (existing value preserved) and take DEFAULT on INSERT.
  // We omit first_seen_at + resolved_at, so first_seen_at defaults on INSERT
  // (NOW) and stays on UPDATE.
  if (result.unmappedRows.length > 0) {
    const { error: eErr } = await supa
      .from("earning_type_unmapped")
      .upsert(result.unmappedRows, { onConflict: "merged_earning_type_name" });
    if (eErr) throw new Error(`earning_type_unmapped upsert: ${eErr.message}`);
    log(`  upserted ${result.unmappedRows.length} earning_type_unmapped rows (SET semantics)`);
  }

  return {
    actualsWritten: totalActualsWritten,
    unattributedWritten: result.unattributed.length,
    unmappedWritten: result.unmappedRows.length,
    writeDurationSec: (Date.now() - runStart) / 1000,
  };
}
