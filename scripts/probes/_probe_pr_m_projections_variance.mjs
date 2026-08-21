// SC projection calibration probe. READ-ONLY. Written 2026-08-20 for
// the PR-M TXR-AZ vs CIN-AZ recon; findings + fix order live at
// `docs/audits/SC_PROJECTION_CALIBRATION_2026-08-20.md`. Kept in the
// repo per Kevin ruling 2026-08-20 - projection accuracy is parked
// behind the shadow weeks, and this is where the work resumes if
// Sebastian raises it.
//
// What it measures:
//   For each account in ACCOUNTS, joins sc_daily_projections and
//   sc_daily_actuals on (account_key, service_date, service_id) and
//   computes delta = actual - projected. Positive delta = actual came
//   in HIGHER than projected (underestimate); negative = overestimate.
//   Groups the paired rows by:
//     - service        (via sc_services.service_name)
//     - day-of-week    (Sun..Sat)
//     - month          (YYYY-MM)
//     - phase-block    (via PER_ACCOUNT_2026 from phaseCalendar.js)
//   Emits per-bucket stats (n, mean, median, stdev, min/max, p25/p75)
//   plus a shape histogram (delta binned into 12 ranges) so the
//   caller can tell a flat offset from a shaped pattern.
//
// What it does NOT do:
//   - No writes. No calls to sc-submit-day, sc-reset-day, or any RPC.
//   - Unpaired rows (projection with no actual, or vice versa) are
//     counted for context but excluded from the variance stats -
//     a missing side is a gap in one dataset, not an over/under.
//
// How to run:
//   node --env-file=.env.local scripts/_probe_pr_m_projections_variance.mjs
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Output is JSON to
// stdout - pipe to a file for inspection.
//
// Extending to another account (say TBJ-FL): add its key to ACCOUNTS
// and confirm the phase-block source (PER_ACCOUNT_2026) has an entry.
// If the account is missing from PER_ACCOUNT_2026 the "phase" bucket
// will collapse to "unknown"; the other buckets still work.

import { createClient } from "@supabase/supabase-js";
import { PER_ACCOUNT_2026 } from "../src/app/service-calendar/season/phaseCalendar.js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ACCOUNTS = ["TXR - AZ", "CIN - AZ"];
const START = "2026-01-01";
const END   = "2026-08-19"; // last full day before today

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayOfWeek(iso) { return DOW[new Date(iso + "T12:00:00Z").getUTCDay()]; }
function monthOf(iso) { return iso.slice(0, 7); }
function phaseOf(account, iso) {
  const blocks = PER_ACCOUNT_2026[account] || [];
  for (const b of blocks) {
    if (iso >= b.start && iso <= b.end) return b.recordedLabel;
  }
  return "unknown";
}

function stats(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    n: nums.length,
    sum,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    stdev: Number(Math.sqrt(variance).toFixed(2)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
  };
}

function bucketize(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r.delta);
  }
  return [...map.entries()].map(([k, arr]) => ({ key: k, ...stats(arr) }));
}

async function loadServices() {
  const { data, error } = await supa
    .from("sc_services")
    .select("id, account_key, service_name")
    .in("account_key", ACCOUNTS);
  if (error) throw error;
  const byId = new Map();
  for (const r of data || []) byId.set(r.id, { ...r, name: r.service_name });
  return byId;
}

async function loadRows(table, account) {
  const cols = table === "sc_daily_projections"
    ? "account_key, service_id, service_date, projected_count"
    : "account_key, service_id, service_date, actual_count";
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from(table)
      .select(cols)
      .eq("account_key", account)
      .gte("service_date", START)
      .lte("service_date", END)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function run() {
  const services = await loadServices();
  const perAccountReports = [];

  for (const account of ACCOUNTS) {
    const projs   = await loadRows("sc_daily_projections", account);
    const actuals = await loadRows("sc_daily_actuals",     account);

    const key = (r) => `${r.service_date}|${r.service_id}`;
    const projMap = new Map(projs.map(p => [key(p), Number(p.projected_count) || 0]));
    const actMap  = new Map(actuals.map(a => [key(a), Number(a.actual_count) || 0]));

    // Join on the union of (date, service) pairs so we capture
    // both directions of miss (projection with no actual, actual
    // with no projection).
    const allKeys = new Set([...projMap.keys(), ...actMap.keys()]);
    const paired = [];
    for (const k of allKeys) {
      const [date, sid] = k.split("|");
      const projected = projMap.has(k) ? projMap.get(k) : null;
      const actual    = actMap.has(k)  ? actMap.get(k)  : null;
      // For variance analysis, exclude rows where BOTH sides are
      // null OR either side is null (a null side isn't an
      // over/underestimate, it's a gap in one dataset). Kevin's
      // question is calibration on paired rows.
      if (projected == null || actual == null) continue;
      paired.push({
        date, sid,
        service: services.get(sid)?.name || sid,
        projected, actual,
        delta: actual - projected,
        dow: dayOfWeek(date),
        month: monthOf(date),
        phase: phaseOf(account, date),
      });
    }

    // Unpaired counts (context signal, not variance).
    const projOnly = [...allKeys].filter(k => projMap.has(k) && !actMap.has(k)).length;
    const actOnly  = [...allKeys].filter(k => actMap.has(k)  && !projMap.has(k)).length;

    perAccountReports.push({
      account,
      totalProjectionRows: projs.length,
      totalActualRows: actuals.length,
      pairedRows: paired.length,
      projOnlyRows: projOnly,
      actOnlyRows: actOnly,
      overall: stats(paired.map(r => r.delta)),
      byService: bucketize(paired, r => r.service).sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0)),
      byDow:     bucketize(paired, r => r.dow).sort((a, b) => DOW.indexOf(a.key) - DOW.indexOf(b.key)),
      byMonth:   bucketize(paired, r => r.month).sort((a, b) => a.key.localeCompare(b.key)),
      byPhase:   bucketize(paired, r => r.phase).sort((a, b) => (b.n ?? 0) - (a.n ?? 0)),
      // Distribution shape signal: how many rows fall in each
      // absolute-delta bucket. Flat offset would concentrate
      // deltas near one value; shaped would spread across.
      shapeHistogram: (() => {
        const bins = [
          [-Infinity, -20], [-20, -10], [-10, -5], [-5, -2], [-2, 0], [0, 0],
          [0, 2], [2, 5], [5, 10], [10, 20], [20, 50], [50, Infinity],
        ];
        return bins.map(([lo, hi]) => {
          const count = paired.filter(r => {
            if (lo === hi) return r.delta === 0;
            return r.delta > lo && r.delta <= hi;
          }).length;
          const label = lo === hi ? "0" : `(${lo},${hi}]`;
          return { bucket: label, n: count };
        });
      })(),
    });
  }

  console.log(JSON.stringify(perAccountReports, null, 2));
}

run().catch(err => { console.error(err); process.exit(1); });
