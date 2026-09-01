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

  // Per-account WoW deltas (weekN.ot - weekN-1.ot) + accompanying
  // display so Kevin can eyeball the shape.
  console.log("## Per-account WoW deltas (hours)");
  console.log("");
  const allDeltas = [];
  const allAbsDeltas = [];
  for (const acct of HOURLY_ACCOUNTS) {
    const arr = byAcct.get(acct) || [];
    if (arr.length < 2) { console.log(`  ${acct}: fewer than 2 closed weeks in scope`); continue; }
    const parts = [];
    for (let i = 1; i < arr.length; i += 1) {
      const d = Math.round((arr[i].ot_hours - arr[i - 1].ot_hours) * 10) / 10;
      allDeltas.push(d);
      allAbsDeltas.push(Math.abs(d));
      parts.push(`${arr[i].week_start.slice(5)}=${d >= 0 ? "+" : ""}${d.toFixed(1)}`);
    }
    console.log(`  ${acct.padEnd(14)} n_weeks=${arr.length}  n_deltas=${arr.length - 1}  deltas: ${parts.join("  ")}`);
  }
  console.log("");

  console.log("## Distribution of |WoW delta| in hours (all accounts pooled)");
  const abs = distributionSummary(allAbsDeltas);
  if (abs) {
    console.log(`  n=${abs.n}  min=${abs.min.toFixed(1)}  p25=${abs.p25.toFixed(1)}  p50=${abs.p50.toFixed(1)}  p75=${abs.p75.toFixed(1)}  p90=${abs.p90.toFixed(1)}  p95=${abs.p95.toFixed(1)}  p99=${abs.p99.toFixed(1)}  max=${abs.max.toFixed(1)}  mean=${abs.mean.toFixed(2)}`);
  }
  console.log("");

  console.log("## Distribution of SIGNED WoW delta in hours (all accounts pooled)");
  const signed = distributionSummary(allDeltas);
  if (signed) {
    console.log(`  n=${signed.n}  min=${signed.min.toFixed(1)}  p10=${signed.p10.toFixed(1)}  p25=${signed.p25.toFixed(1)}  p50=${signed.p50.toFixed(1)}  p75=${signed.p75.toFixed(1)}  p90=${signed.p90.toFixed(1)}  p95=${signed.p95.toFixed(1)}  max=${signed.max.toFixed(1)}  mean=${signed.mean.toFixed(2)}`);
  }
  console.log("");

  console.log("## Suggested breakpoint framework (Kevin rules on the actual numbers)");
  console.log("");
  console.log("  Idea: pair a hours-magnitude threshold with a direction:");
  console.log("    up > <thr_hrs>            -> WATCH");
  console.log("    up > <thr_hrs> and worse  -> ALARM");
  console.log("    down > <any>              -> CLEAR (improvement)");
  console.log("    within +/- <thr_hrs>      -> NEUTRAL / on track");
  console.log("");
  if (abs) {
    console.log(`  Data-driven candidates from the distribution above:`);
    console.log(`    NEUTRAL band: within +/- ${abs.p50.toFixed(1)} hrs (the median absolute move)`);
    console.log(`    WATCH:        up > ${abs.p75.toFixed(1)} hrs (top-quartile increase)`);
    console.log(`    ALARM:        up > ${abs.p90.toFixed(1)} hrs (top-decile increase)`);
  }
  console.log("");
  console.log("These are candidates only. Kevin owns the final numbers.");
}
main().catch(e => { console.error(e); process.exit(1); });
