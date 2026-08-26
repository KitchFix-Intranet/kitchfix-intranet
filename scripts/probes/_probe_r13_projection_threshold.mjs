#!/usr/bin/env node
/**
 * R13 P0-2 - projection stability threshold.
 *
 * For a running week (7 days) and a running period (4 weeks / 28
 * days), simulate what `spent / elapsed_frac` returns at 10%, 25%,
 * 50% elapsed against actual production spend patterns.
 *
 * Method: pick the current running week + period (as of today).  For
 * each scope, walk day-by-day cumulative spend, then compute the
 * projection each day.  Report:
 *   - projection value at 10%, 25%, 50%, 100% elapsed
 *   - variance of projection during first 10%, 25%, 50%
 *   - "final" (projection at end, which = actual)
 *
 * The threshold is where the projection stops being a lie about the
 * eventual total.
 */
import { createClient } from "@supabase/supabase-js";
function envOrDie(name) { const v=process.env[name]; if(!v){console.error(`env ${name} ABSENT`);process.exit(1);} return v; }
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL?"PRESENT":"ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?"PRESENT":"ABSENT"}`);
const supa = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"), { auth:{persistSession:false} });

// Take a real closed week (a completed 7-day span, so I can walk its
// day-by-day trajectory and see what the projection would have said
// on each day if we'd been running it live).  Pick the last week of
// P8: 2026-08-03 to 2026-08-09.
const RECENT_WEEKS = [
  { key: "P8 week 4",  start: "2026-08-03", end: "2026-08-09", days: 7 },
  { key: "P8 week 3",  start: "2026-07-27", end: "2026-08-02", days: 7 },
  { key: "P8 week 2",  start: "2026-07-20", end: "2026-07-26", days: 7 },
  { key: "P8 week 1",  start: "2026-07-13", end: "2026-07-19", days: 7 },
];
const RECENT_PERIODS = [
  { key: "P7",  start: "2026-06-15", end: "2026-07-12", days: 28 },
  { key: "P8",  start: "2026-07-13", end: "2026-08-09", days: 28 },
];

const EAST = ["STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL"];
const WEST = ["CIN - AZ", "CIN - KY", "CIN - OH", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
const ALL  = [...EAST, ...WEST];

// Choose a variety of scopes to stress-test the projection
const SCOPES = [
  { name: "ALL",     members: ALL },
  { name: "WEST",    members: WEST },
  { name: "TBJ-FL",  members: ["TBJ - FL"] },
];

async function dailySpend(members, start, end) {
  const byDay = new Map();
  const IN_CHUNK = 100;
  const PS = 1000;
  for (let i = 0; i < members.length; i += IN_CHUNK) {
    const chunk = members.slice(i, i + IN_CHUNK);
    let from = 0;
    while (true) {
      const q = await supa.from("purchasing_actuals")
        .select("txn_date, amount")
        .eq("excluded", false)
        .in("account_key", chunk)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .not("gl_line_code", "is", null)
        .neq("gl_line_code", "3100.1").neq("gl_line_code", "3100.2")
        .order("txn_date", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) throw new Error(q.error.message);
      const rows = q.data || [];
      for (const r of rows) {
        byDay.set(r.txn_date, (byDay.get(r.txn_date) || 0) + Number(r.amount || 0));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return byDay;
}

function walkProjection(byDay, start, days) {
  const startMs = new Date(start + "T00:00:00Z").getTime();
  const results = [];
  let cumSpent = 0;
  for (let d = 1; d <= days; d++) {
    const dateISO = new Date(startMs + (d - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10);
    cumSpent += Number(byDay.get(dateISO) || 0);
    const elapsed = d / days;
    const projection = elapsed > 0 ? cumSpent / elapsed : 0;
    results.push({ day: d, elapsed, cumSpent, projection });
  }
  return results;
}

console.log("\n=== Weekly - projection stability across a real 7-day span ===\n");
console.log("  scope    span         d1 (14%)   d2 (29%)   d3 (43%)  d4 (57%)  d7 final");
console.log("  " + "-".repeat(90));
for (const sc of SCOPES) {
  for (const wk of RECENT_WEEKS.slice(0, 2)) {   // sample two weeks
    const byDay = await dailySpend(sc.members, wk.start, wk.end);
    const walk = walkProjection(byDay, wk.start, wk.days);
    const fmt$ = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const d1 = walk[0], d2 = walk[1], d3 = walk[2], d4 = walk[3], d7 = walk[6];
    console.log(`  ${sc.name.padEnd(8)} ${wk.key.padEnd(12)}  ${fmt$(d1.projection).padStart(10)} ${fmt$(d2.projection).padStart(10)} ${fmt$(d3.projection).padStart(10)} ${fmt$(d4.projection).padStart(10)} ${fmt$(d7.projection).padStart(10)}`);
  }
}

console.log("\n=== Periodic - projection stability across a real 28-day period ===\n");
console.log("  scope    period    wk1 (25%)  wk2 (50%)  wk3 (75%)  final");
console.log("  " + "-".repeat(70));
for (const sc of SCOPES) {
  for (const pd of RECENT_PERIODS) {
    const byDay = await dailySpend(sc.members, pd.start, pd.end);
    const walk = walkProjection(byDay, pd.start, pd.days);
    const fmt$ = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const w1 = walk[6], w2 = walk[13], w3 = walk[20], final = walk[27];
    console.log(`  ${sc.name.padEnd(8)} ${pd.key.padEnd(6)}   ${fmt$(w1.projection).padStart(10)} ${fmt$(w2.projection).padStart(10)} ${fmt$(w3.projection).padStart(10)} ${fmt$(final.projection).padStart(10)}`);
  }
}

console.log("\n=== Ratio: projection at N% elapsed / final ===\n");
console.log("  If close to 1.0, the projection was accurate.  If far above/below 1.0, it lied.");
console.log("");
console.log("  scope    span           10%      15%      20%      25%      30%      50%");
console.log("  " + "-".repeat(90));
for (const sc of SCOPES) {
  for (const pd of RECENT_PERIODS) {
    const byDay = await dailySpend(sc.members, pd.start, pd.end);
    const walk = walkProjection(byDay, pd.start, pd.days);
    const final = walk[walk.length - 1].cumSpent;
    if (final === 0) continue;
    // Find days at each threshold
    const thresholds = [0.10, 0.15, 0.20, 0.25, 0.30, 0.50];
    const ratios = thresholds.map(t => {
      const day = Math.round(t * pd.days);
      const w = walk[day - 1];
      return w && final > 0 ? (w.projection / final) : 0;
    });
    const fmtR = r => r ? r.toFixed(2) : "-";
    console.log(`  ${sc.name.padEnd(8)} ${pd.key.padEnd(14)}  ${ratios.map(r => fmtR(r).padStart(6)).join("  ")}`);
  }
}

console.log("\nNote: the projection is spent/elapsed_frac.  Ratio 1.30 = projection was 30% high vs final;");
console.log("      ratio 0.70 = projection was 30% low vs final.  Reader intuition: acceptable within ~15%.");
