#!/usr/bin/env node
/**
 * R13 P0-1 - prior-period + 8-period sparkline query-cost measurement.
 *
 * For the closed-card comparison block we need:
 *   - Prior-period total spend for the current members
 *   - Last-8-periods per-period totals for the current members
 *
 * Measure wall-time at aggregate scopes (ALL / EAST / WEST) plus one
 * at-risk scope (TBJ-FL) as a control.  Kevin's threshold: >100ms
 * overhead means fall back to Option 1.
 *
 * Approach:
 *   - Read the weekly view (v_purchasing_by_site_week) grouped by
 *     account_key + week_start, then roll up to period per account.
 *   - Compare cost of a single 8-period read vs eight per-period reads.
 */
import { createClient } from "@supabase/supabase-js";
function envOrDie(name) { const v=process.env[name]; if(!v){console.error(`env ${name} ABSENT`);process.exit(1);} return v; }
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL?"PRESENT":"ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?"PRESENT":"ABSENT"}`);
const supa = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"), { auth:{persistSession:false} });

// FY2026 period ranges (from src/app/kpi/labor/lib/periods.js).
// P1 = 2025-12-29..2026-01-25, each period = 4 weeks.
function periodStartISO(p) {
  const START = new Date("2025-12-29T00:00:00Z").getTime();
  const d = new Date(START + (p - 1) * 28 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function periodEndISO(p) {
  const START = new Date("2025-12-29T00:00:00Z").getTime();
  const d = new Date(START + p * 28 * 24 * 3600 * 1000 - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

const EAST = ["STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL"];
const WEST = ["CIN - AZ", "CIN - KY", "CIN - OH", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];
const ALL  = [...EAST, ...WEST];

const SCENARIOS = [
  { name: "ALL",     members: ALL },
  { name: "EAST",    members: EAST },
  { name: "WEST",    members: WEST },
  { name: "TBJ-FL",  members: ["TBJ - FL"] },
  { name: "CIN-OH",  members: ["CIN - OH"] },
];

// Purchasing lines: same filter as loadPurchasingBudgets - excludes
// labor (3100.1) and salaried (3100.2).
async function sumRangeViaWeekly(members, start, end) {
  const t0 = Date.now();
  let sum = 0;
  let from = 0; const PS = 1000;
  while (true) {
    const q = await supa.from("v_purchasing_by_site_week")
      .select("account_key, amount")
      .in("account_key", members)
      .gte("week_start", start)
      .lte("week_start", end)
      .order("account_key", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) sum += Number(r.amount || 0);
    if (rows.length < PS) break;
    from += PS;
  }
  return { sum: Math.round(sum * 100) / 100, ms: Date.now() - t0 };
}

// Approach 1: eight per-period reads
async function historyEightSeparate(members) {
  const t0 = Date.now();
  const periods = [];
  for (let p = 1; p <= 8; p++) {
    const r = await sumRangeViaWeekly(members, periodStartISO(p), periodEndISO(p));
    periods.push({ p, sum: r.sum });
  }
  return { periods, ms: Date.now() - t0 };
}

// Approach 2: single 8-period read (P1..P8), roll up client-side
async function historyOneRead(members) {
  const t0 = Date.now();
  const start = periodStartISO(1);
  const end   = periodEndISO(8);
  const byWeek = new Map();
  let from = 0; const PS = 1000;
  while (true) {
    const q = await supa.from("v_purchasing_by_site_week")
      .select("account_key, week_start, amount")
      .in("account_key", members)
      .gte("week_start", start)
      .lte("week_start", end)
      .order("week_start", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    for (const r of rows) {
      const wk = r.week_start;
      byWeek.set(wk, (byWeek.get(wk) || 0) + Number(r.amount || 0));
    }
    if (rows.length < PS) break;
    from += PS;
  }
  // Roll to periods: each week_start falls into exactly one period.
  const byPeriod = new Map();
  const START = new Date("2025-12-29T00:00:00Z").getTime();
  for (const [wk, amt] of byWeek) {
    const wkMs = new Date(wk + "T00:00:00Z").getTime();
    const weeksSinceStart = Math.round((wkMs - START) / (7 * 24 * 3600 * 1000));
    const p = Math.floor(weeksSinceStart / 4) + 1;
    if (p >= 1 && p <= 8) byPeriod.set(p, (byPeriod.get(p) || 0) + amt);
  }
  const periods = [];
  for (let p = 1; p <= 8; p++) periods.push({ p, sum: Math.round((byPeriod.get(p) || 0) * 100) / 100 });
  return { periods, ms: Date.now() - t0 };
}

// Approach 3: raw actuals with a date range (simulate joining direct
// to purchasing_actuals like loadPending does).
async function historyDirectActuals(members) {
  const t0 = Date.now();
  const start = periodStartISO(1);
  const end   = periodEndISO(8);
  const IN_CHUNK = 100;
  const PS = 1000;
  const byPeriod = new Map();
  const START = new Date("2025-12-29T00:00:00Z").getTime();
  for (let i = 0; i < members.length; i += IN_CHUNK) {
    const chunk = members.slice(i, i + IN_CHUNK);
    let from = 0;
    while (true) {
      const q = await supa.from("purchasing_actuals")
        .select("txn_date, amount, gl_line_code")
        .eq("excluded", false)
        .in("account_key", chunk)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .neq("gl_line_code", "3100.1")
        .neq("gl_line_code", "3100.2")
        .not("gl_line_code", "is", null)
        .order("txn_date", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) throw new Error(q.error.message);
      const rows = q.data || [];
      for (const r of rows) {
        const dMs = new Date(r.txn_date + "T00:00:00Z").getTime();
        const daysSinceStart = Math.floor((dMs - START) / (24 * 3600 * 1000));
        const p = Math.floor(daysSinceStart / 28) + 1;
        if (p >= 1 && p <= 8) byPeriod.set(p, (byPeriod.get(p) || 0) + Number(r.amount || 0));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  const periods = [];
  for (let p = 1; p <= 8; p++) periods.push({ p, sum: Math.round((byPeriod.get(p) || 0) * 100) / 100 });
  return { periods, ms: Date.now() - t0 };
}

// Warm up connection
await sumRangeViaWeekly(["TBJ - FL"], periodStartISO(1), periodEndISO(1));

console.log("\n=== Approach 1: eight per-period reads (serial) ===");
for (const s of SCENARIOS) {
  const r = await historyEightSeparate(s.members);
  console.log(`  ${s.name.padEnd(8)} ${r.ms.toString().padStart(5)}ms  ${r.periods.map(p => `P${p.p}=${p.sum}`).join(" ")}`);
}

console.log("\n=== Approach 2: single 8-period read, roll up client-side ===");
for (const s of SCENARIOS) {
  const r = await historyOneRead(s.members);
  console.log(`  ${s.name.padEnd(8)} ${r.ms.toString().padStart(5)}ms  ${r.periods.map(p => `P${p.p}=${p.sum}`).join(" ")}`);
}

console.log("\n=== Approach 3: direct purchasing_actuals ===");
for (const s of SCENARIOS) {
  const r = await historyDirectActuals(s.members);
  console.log(`  ${s.name.padEnd(8)} ${r.ms.toString().padStart(5)}ms  ${r.periods.map(p => `P${p.p}=${p.sum}`).join(" ")}`);
}

console.log("\n=== Verdict ===");
console.log("  Threshold: >100ms overhead means fall back to Option 1.");
console.log("  Winner should be the fastest approach that returns per-period + per-scope rollups.");
