#!/usr/bin/env node
/*
 * Item 4 measurement: time each of the six loaders in the purchasing
 * route across a 42-combination sweep (7 accounts x 6 ranges).
 *
 * Uses the temporary probe branch's Server-Timing header + inline
 * `_timings` block on the payload.  Runs each combination twice and
 * reports the median of two so cold-cache first-hits don't dominate.
 *
 * The route we hit is `/api/kpi/purchasing`.  TEST_MODE bypass in the
 * middleware lets us hit it without auth (X-Test-Mode: 1 header).
 *
 * Env consumed: none (dev server at BASE below).
 * Run: node scripts/probes/_probe_purchasing_loader_timings.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const BASE = process.env.KPI_BASE || "http://localhost:3021";
const today = new Date().toISOString().slice(0, 10);
const OUT_JSON = path.join(os.homedir(), "Downloads", `purchasing_loader_timings_${today}.json`);

// Seven representative accounts covering at_risk, pass_through, and
// aggregate paths.  CIN - AZ is our regression bellwether (used in
// R15's baseline probe); the others fan out coverage.
const ACCOUNTS = [
  "CIN - AZ",    // pass_through - low volume
  "CIN - OH",    // at_risk - highest single-account spend
  "TBR - FL",    // at_risk - long-history account
  "STL - FL",    // at_risk - largest FYTD single account
  "TXR - AZ",    // at_risk - mid-volume
  "TBJ - FL",    // at_risk - large volume
  "ALL",         // aggregate - full portfolio
];

// Six representative ranges spanning tier A (<=6 weeks), tier B (7-13),
// and tier C (>13).  Fiscal-year assumption: today is late fiscal
// period, so `this_period` gives us a small tier-A range; `p8` gives
// a closed single period; `fytd` gives a tier-C multi-period run.
function isoMinusDays(d, n) { const t = new Date(d + "T00:00:00Z").getTime(); return new Date(t - n * 86400000).toISOString().slice(0, 10); }
const RANGES = [
  { name: "this_period",   start: null, end: null, preset: "this_period" },
  { name: "last_4wk",      start: null, end: null, preset: "last_4wk" },
  { name: "fytd",          start: null, end: null, preset: "fytd" },
  { name: "period_p4",     start: "2026-03-30", end: "2026-04-26" },
  { name: "period_p8",     start: "2026-07-20", end: "2026-08-16" },
  { name: "custom_2wk",    start: isoMinusDays(today, 14), end: today },
];

function buildUrl(account, range) {
  const p = new URLSearchParams({ account });
  if (range.preset) p.set("preset", range.preset);
  if (range.start) p.set("start", range.start);
  if (range.end)   p.set("end",   range.end);
  return `${BASE}/api/kpi/purchasing?${p.toString()}`;
}

async function hit(url) {
  const s = Date.now();
  const r = await fetch(url, { headers: { "X-Test-Mode": "1" } });
  const body = await r.json();
  const wallClient = Date.now() - s;
  if (!r.ok) return { ok: false, status: r.status, error: body?.error || "unknown" };
  return {
    ok: true,
    status: r.status,
    wallClient,
    // Both surfaces of the timings for verification:
    timings: body._timings || null,
    serverTiming: r.headers.get("Server-Timing"),
  };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}
function p95(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

const results = [];
let idx = 0;
const total = ACCOUNTS.length * RANGES.length;
for (const account of ACCOUNTS) {
  for (const range of RANGES) {
    idx++;
    const url = buildUrl(account, range);
    // Two hits: discard the first as cache-warming, keep the second.
    let first, second;
    try {
      first = await hit(url);
      second = await hit(url);
    } catch (e) {
      results.push({ account, range: range.name, error: String(e?.message || e) });
      continue;
    }
    if (!first.ok) { results.push({ account, range: range.name, first_error: first }); continue; }
    if (!second.ok) { results.push({ account, range: range.name, second_error: second }); continue; }
    const t = second.timings || {};
    const row = {
      account, range: range.name,
      wall_client_ms: second.wallClient,
      preamble: t.preamble ?? null,
      ledger_vehicle: t.ledger_vehicle ?? null,
      ledger_equip:   t.ledger_equip   ?? null,
      ledger_repair:  t.ledger_repair  ?? null,
      ledger_reimb:   t.ledger_reimb   ?? null,
      card_charges:   t.card_charges   ?? null,
      vendor_rollup:  t.vendor_rollup  ?? null,
      promise_all_wall: t.promise_all_wall ?? null,
      total: t.total ?? null,
    };
    results.push(row);
    process.stderr.write(`  ${idx}/${total} ${account.padEnd(10)} ${range.name.padEnd(14)}  total=${row.total}ms  preamble=${row.preamble}ms  promise_all=${row.promise_all_wall}ms\n`);
  }
}

// Per-loader aggregate (across the 42-cell sweep, excluding errors).
const clean = results.filter(r => r.total != null);
const LOADERS = ["preamble", "ledger_vehicle", "ledger_equip", "ledger_repair", "ledger_reimb", "card_charges", "vendor_rollup", "promise_all_wall", "total"];
const agg = {};
for (const k of LOADERS) {
  const vals = clean.map(r => r[k]).filter(v => v != null);
  if (!vals.length) continue;
  agg[k] = {
    n: vals.length,
    min: Math.min(...vals),
    median: Math.round(median(vals)),
    p95: p95(vals),
    max: Math.max(...vals),
    sum: vals.reduce((s, v) => s + v, 0),
  };
}

// Long-pole identification per-cell + overall.
for (const r of clean) {
  const loaderVals = [
    ["ledger_vehicle", r.ledger_vehicle],
    ["ledger_equip",   r.ledger_equip],
    ["ledger_repair",  r.ledger_repair],
    ["ledger_reimb",   r.ledger_reimb],
    ["card_charges",   r.card_charges],
    ["vendor_rollup",  r.vendor_rollup],
  ].filter(([, v]) => v != null);
  if (loaderVals.length) {
    loaderVals.sort((a, b) => b[1] - a[1]);
    r.long_pole = loaderVals[0][0];
    r.long_pole_ms = loaderVals[0][1];
  }
}

const longPoleCounts = new Map();
for (const r of clean) {
  if (!r.long_pole) continue;
  longPoleCounts.set(r.long_pole, (longPoleCounts.get(r.long_pole) || 0) + 1);
}

console.log("\n══ PER-LOADER AGGREGATE (42-combination sweep) ══");
console.log(`  ${"loader".padEnd(20)}  n   min    p50    p95   max    sum`);
for (const k of LOADERS) {
  const a = agg[k];
  if (!a) continue;
  console.log(`  ${k.padEnd(20)}  ${String(a.n).padStart(2)}  ${String(a.min).padStart(4)}ms ${String(a.median).padStart(5)}ms ${String(a.p95).padStart(5)}ms ${String(a.max).padStart(5)}ms ${String(a.sum).padStart(6)}ms`);
}

console.log("\n══ LONG-POLE (per cell, which of the six loaders was slowest) ══");
for (const [name, count] of [...longPoleCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(20)}  ${count} of ${clean.length} cells`);
}

console.log("\n══ TOP 10 SLOWEST CELLS ══");
const sorted = [...clean].sort((a, b) => b.total - a.total);
for (let i = 0; i < Math.min(10, sorted.length); i++) {
  const r = sorted[i];
  console.log(`  ${i + 1}. ${r.account.padEnd(10)} ${r.range.padEnd(14)}  total=${r.total}ms  preamble=${r.preamble}ms  promise_all=${r.promise_all_wall}ms  long_pole=${r.long_pole}(${r.long_pole_ms}ms)`);
}

await fs.writeFile(OUT_JSON, JSON.stringify({
  generated_at: new Date().toISOString(),
  base: BASE,
  cells: results,
  aggregate: agg,
  long_pole_counts: Object.fromEntries(longPoleCounts),
}, null, 2));
console.log(`\nJSON: ${OUT_JSON}`);
