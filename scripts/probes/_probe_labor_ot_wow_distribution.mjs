#!/usr/bin/env node
// scripts/probes/_probe_labor_ot_wow_distribution.mjs
//
// R-38 threshold-distribution probe. Read-only.
//
// Kevin's rule: "Do not pick thresholds without showing that
// distribution." This probe reads per-week OT hours across the 11
// accounts for the last 10 CLOSED weeks and prints the week-over-week
// hour-delta distribution so Kevin can rule on the breakpoints for
// the OT card's state chip. The card currently ships with a neutral
// chip + movement in words; the numbers here are the input to
// converting that to a graded chip.
//
// USAGE:
//   node --env-file=.env.local scripts/probes/_probe_labor_ot_wow_distribution.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const HOURLY_ACCOUNTS = [
  // Excludes D26 salaried-only accounts (CIN - KY, TBJ - NY) - the
  // WoW OT question doesn't apply to accounts with zero hourly rows.
  "CIN - AZ", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const LOOKBACK_WEEKS = 10;
const PAGE = 1000;

async function paginateActuals(members, start, end) {
  const out = [];
  const chunk = 200;
  for (let i = 0; i < members.length; i += chunk) {
    const slice = members.slice(i, i + chunk);
    let from = 0;
    while (true) {
      const r = await supa.from("labor_actuals_latest")
        .select("account_key, week_start, week_end, worker_id, hours_overtime")
        .in("account_key", slice)
        .gte("week_start", start)
        .lte("week_end", end)
        .order("account_key", { ascending: true })
        .order("week_start", { ascending: true })
        .range(from, from + PAGE - 1);
      if (r.error) throw new Error(r.error.message);
      out.push(...(r.data || []));
      if ((r.data || []).length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
}

function distributionSummary(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))));
    return sorted[idx];
  };
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  return {
    n: values.length,
    min: sorted[0],
    p10: p(0.10),
    p25: p(0.25),
    p50: p(0.50),
    p75: p(0.75),
    p90: p(0.90),
    p95: p(0.95),
    p99: p(0.99),
    max: sorted[sorted.length - 1],
    mean,
  };
}

async function main() {
  console.log(`# R-38 WoW OT-hours distribution - ${new Date().toISOString()}`);
  console.log(`# Population: last ${LOOKBACK_WEEKS} CLOSED fiscal weeks per hourly account`);
  console.log(`# Accounts: ${HOURLY_ACCOUNTS.length} (D26 salaried-only excluded)`);
  console.log("");

  // Pull actuals for a lookback that covers the last 12 weeks so the
  // paginate can find 10 CLOSED weeks after we filter today's/in-
  // progress weeks out.
  const today = new Date().toISOString().slice(0, 10);
  const lookbackDays = LOOKBACK_WEEKS * 7 + 21;
  const start = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);

  const actuals = await paginateActuals(HOURLY_ACCOUNTS, start, today);

  // Aggregate to (account, week_start) -> ot_hours.
  const byAcctWeek = new Map();
  for (const r of actuals) {
    const k = `${r.account_key}|${r.week_start}`;
    const ot = Number(r.hours_overtime || 0);
    byAcctWeek.set(k, (byAcctWeek.get(k) || 0) + ot);
  }
  // Restructure to per-account week series.
  const byAcct = new Map();
  for (const [k, v] of byAcctWeek) {
    const [acct, ws] = k.split("|");
    if (!byAcct.has(acct)) byAcct.set(acct, []);
    byAcct.get(acct).push({ week_start: ws, ot_hours: Math.round(v * 10) / 10 });
  }
  for (const [, arr] of byAcct) arr.sort((a, b) => a.week_start.localeCompare(b.week_start));

  // Filter to CLOSED weeks (week_end < today). Compute week_end from
  // week_start + 6 days.
  const isClosed = (ws) => {
    const s = new Date(`${ws}T00:00:00Z`);
    const e = new Date(s.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    return e < today;
  };
  for (const [acct, arr] of byAcct) {
    const closed = arr.filter(w => isClosed(w.week_start));
    // Take the last LOOKBACK_WEEKS closed weeks.
    byAcct.set(acct, closed.slice(-LOOKBACK_WEEKS));
  }

  // Median of a numeric array. Empty -> null.
  const median = (arr) => {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  };

  // Per-account WoW deltas plus per-account median weekly OT hours.
  console.log("## Per-account WoW deltas (hours) and median weekly OT");
  console.log("");
  const rawDeltasByAcct = new Map();       // acct -> [{ week, hours }]
  const medianByAcct = new Map();          // acct -> median weekly OT
  const allRawDeltas = [];                 // pre-clean signed deltas
  for (const acct of HOURLY_ACCOUNTS) {
    const arr = byAcct.get(acct) || [];
    if (arr.length < 2) { console.log(`  ${acct}: fewer than 2 closed weeks in scope`); continue; }
    const rows = [];
    for (let i = 1; i < arr.length; i += 1) {
      const d = Math.round((arr[i].ot_hours - arr[i - 1].ot_hours) * 10) / 10;
      rows.push({ week: arr[i].week_start, hours: d });
      allRawDeltas.push(d);
    }
    rawDeltasByAcct.set(acct, rows);
    const med = median(arr.map(w => w.ot_hours));
    medianByAcct.set(acct, med);
    const parts = rows.map(r => `${r.week.slice(5)}=${r.hours >= 0 ? "+" : ""}${r.hours.toFixed(1)}`);
    console.log(`  ${acct.padEnd(14)} med_wkly_ot=${med.toFixed(1)}  n_deltas=${rows.length}  deltas: ${parts.join("  ")}`);
  }
  console.log("");

  // ─── Mirror-image cleaning ─────────────────────────────────────
  // A pair of consecutive deltas (d_i, d_{i+1}) is a "mirror pair"
  // when they cancel each other. Formal:
  //   sign(d_i) != sign(d_{i+1})           (opposite direction)
  //   min(|d_i|, |d_{i+1}|) >= MIRROR_MIN  (not noise)
  //   |d_i + d_{i+1}| <= MIRROR_TOL_ABS *or* |d_i + d_{i+1}| / max(|d_i|, |d_{i+1}|) <= MIRROR_TOL_REL
  // Drop BOTH deltas when a pair matches. Loop scans left-to-right
  // and skips past the pair after a match (no overlapping matches).
  const MIRROR_MIN = 10;   // hours - anything smaller is normal noise, not a bulk reload
  const MIRROR_TOL_ABS = 5;
  const MIRROR_TOL_REL = 0.10;
  console.log("## Mirror-image pair detection");
  console.log(`# Rule: opposite sign, both >= ${MIRROR_MIN} hrs magnitude, sum within +/- ${MIRROR_TOL_ABS} hrs OR ${MIRROR_TOL_REL * 100}% of the larger side.`);
  console.log("");
  const cleanedDeltasByAcct = new Map();
  const droppedByAcct = new Map();
  let droppedTotal = 0;
  for (const [acct, rows] of rawDeltasByAcct) {
    const keep = [];
    const dropped = [];
    let i = 0;
    while (i < rows.length) {
      if (i + 1 < rows.length) {
        const a = rows[i].hours, b = rows[i + 1].hours;
        const oppSign = (a > 0 && b < 0) || (a < 0 && b > 0);
        const bigEnough = Math.min(Math.abs(a), Math.abs(b)) >= MIRROR_MIN;
        const net = Math.abs(a + b);
        const relTol = Math.max(Math.abs(a), Math.abs(b)) * MIRROR_TOL_REL;
        const cancels = net <= MIRROR_TOL_ABS || net <= relTol;
        if (oppSign && bigEnough && cancels) {
          dropped.push({ week: rows[i].week, hours: a }, { week: rows[i + 1].week, hours: b });
          i += 2;
          continue;
        }
      }
      keep.push(rows[i]);
      i += 1;
    }
    cleanedDeltasByAcct.set(acct, keep);
    if (dropped.length > 0) droppedByAcct.set(acct, dropped);
    droppedTotal += dropped.length;
  }
  if (droppedTotal === 0) {
    console.log("  no mirror pairs detected");
  } else {
    console.log(`  dropped ${droppedTotal} deltas (${droppedTotal / 2} pairs) across ${droppedByAcct.size} account(s):`);
    for (const [acct, dropped] of droppedByAcct) {
      const parts = [];
      for (let k = 0; k < dropped.length; k += 2) {
        parts.push(`(${dropped[k].week.slice(5)}=${dropped[k].hours >= 0 ? "+" : ""}${dropped[k].hours.toFixed(1)}, ${dropped[k + 1].week.slice(5)}=${dropped[k + 1].hours >= 0 ? "+" : ""}${dropped[k + 1].hours.toFixed(1)})`);
      }
      console.log(`    ${acct.padEnd(14)} dropped=${dropped.length}  pairs: ${parts.join("  ")}`);
    }
  }
  console.log("");

  // Pooled cleaned deltas.
  const cleanedDeltas = [];
  for (const [, rows] of cleanedDeltasByAcct) {
    for (const r of rows) cleanedDeltas.push(r.hours);
  }
  const cleanedAbs = cleanedDeltas.map(x => Math.abs(x));

  console.log("## Cleaned distribution of |WoW delta| in hours (mirror pairs removed)");
  const cleanAbs = distributionSummary(cleanedAbs);
  if (cleanAbs) {
    console.log(`  n=${cleanAbs.n}  min=${cleanAbs.min.toFixed(1)}  p25=${cleanAbs.p25.toFixed(1)}  p50=${cleanAbs.p50.toFixed(1)}  p75=${cleanAbs.p75.toFixed(1)}  p90=${cleanAbs.p90.toFixed(1)}  p95=${cleanAbs.p95.toFixed(1)}  p99=${cleanAbs.p99.toFixed(1)}  max=${cleanAbs.max.toFixed(1)}  mean=${cleanAbs.mean.toFixed(2)}`);
  }
  console.log("");

  console.log("## Cleaned distribution of SIGNED WoW delta in hours (mirror pairs removed)");
  const cleanSigned = distributionSummary(cleanedDeltas);
  if (cleanSigned) {
    console.log(`  n=${cleanSigned.n}  min=${cleanSigned.min.toFixed(1)}  p10=${cleanSigned.p10.toFixed(1)}  p25=${cleanSigned.p25.toFixed(1)}  p50=${cleanSigned.p50.toFixed(1)}  p75=${cleanSigned.p75.toFixed(1)}  p90=${cleanSigned.p90.toFixed(1)}  p95=${cleanSigned.p95.toFixed(1)}  max=${cleanSigned.max.toFixed(1)}  mean=${cleanSigned.mean.toFixed(2)}`);
  }
  console.log("");

  // ─── Relative-to-median distribution ────────────────────────────
  // Normalize each cleaned delta by that account's median weekly OT.
  // Accounts with median 0 (e.g. TXR - AZ ships 0.0 every week) are
  // excluded from the relative distribution - a threshold measured
  // as a fraction of zero is undefined. State that exclusion.
  console.log("## Per-account median weekly OT hours (scale sanity check)");
  console.log("");
  console.log("  Account         median_wkly_ot_hrs");
  const relDeltas = [];
  const relSigned = [];
  const relExcluded = [];
  for (const acct of HOURLY_ACCOUNTS) {
    const med = medianByAcct.get(acct);
    if (med == null) continue;
    const note = med < 0.1 ? " (excluded from relative distribution)" : "";
    console.log(`  ${acct.padEnd(14)}  ${med.toFixed(1)}${note}`);
    if (med < 0.1) { relExcluded.push(acct); continue; }
    const rows = cleanedDeltasByAcct.get(acct) || [];
    for (const r of rows) {
      const rel = r.hours / med;
      relSigned.push(rel);
      relDeltas.push(Math.abs(rel));
    }
  }
  console.log("");
  if (relExcluded.length > 0) {
    console.log(`  Excluded from relative distribution (median == 0): ${relExcluded.join(", ")}`);
    console.log("");
  }

  console.log("## Distribution of |WoW delta / account median| (unitless multiplier)");
  const relAbs = distributionSummary(relDeltas);
  if (relAbs) {
    const p = (v) => v.toFixed(2);
    console.log(`  n=${relAbs.n}  min=${p(relAbs.min)}  p25=${p(relAbs.p25)}  p50=${p(relAbs.p50)}  p75=${p(relAbs.p75)}  p90=${p(relAbs.p90)}  p95=${p(relAbs.p95)}  p99=${p(relAbs.p99)}  max=${p(relAbs.max)}  mean=${p(relAbs.mean)}`);
    console.log("");
    console.log("  Interpretation: a value of 1.0x means the delta equalled the account's median weekly OT.");
  }
  console.log("");

  console.log("## Distribution of SIGNED WoW delta / account median");
  const relSignedDist = distributionSummary(relSigned);
  if (relSignedDist) {
    const p = (v) => v.toFixed(2);
    console.log(`  n=${relSignedDist.n}  min=${p(relSignedDist.min)}  p10=${p(relSignedDist.p10)}  p25=${p(relSignedDist.p25)}  p50=${p(relSignedDist.p50)}  p75=${p(relSignedDist.p75)}  p90=${p(relSignedDist.p90)}  p95=${p(relSignedDist.p95)}  max=${p(relSignedDist.max)}  mean=${p(relSignedDist.mean)}`);
  }
  console.log("");

  // ─── Proposed breakpoints from the RELATIVE distribution ────────
  console.log("## Proposed breakpoints (relative to account median)");
  console.log("");
  console.log("  Chip form: 'up 0.6x' means the delta was 60% of the account's median weekly OT.");
  console.log("  Same threshold means the same thing at TBR - FL and CIN - AZ.");
  console.log("");
  if (relAbs) {
    console.log("  Data-driven candidates (Kevin owns the final numbers):");
    console.log(`    NEUTRAL band: |delta| within ${relAbs.p50.toFixed(2)}x of median (the median relative move)`);
    console.log(`    WATCH:        up > ${relAbs.p75.toFixed(2)}x median (top-quartile increase)`);
    console.log(`    ALARM:        up > ${relAbs.p90.toFixed(2)}x median (top-decile increase)`);
  }
  console.log("");
  console.log("  Down deltas (improvement) stay CLEAR regardless of magnitude.");
  console.log("");
  console.log("  Rounded to sensible operator numbers, the shape suggests:");
  console.log("    NEUTRAL   |delta| < 0.5x median");
  console.log("    WATCH     up in [0.5x, 1.0x] median");
  console.log("    ALARM     up > 1.0x median (i.e. this week's OT jumped by MORE than the account's typical whole week)");
  console.log("");
  console.log("  Rounded numbers are a starting point. Kevin picks the actual multipliers.");
}
main().catch(e => { console.error(e); process.exit(1); });
