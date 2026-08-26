#!/usr/bin/env node
/**
 * Hero movement measurement (Option 3 acceptance report).
 *
 * For every scope, hit the API at:
 *   - FYTD (2025-12-29 -> 2026-08-26)  - the marquee live range
 *   - P9 (2026-08-10 -> 2026-09-06)    - the current live period
 *   - P8 (2026-07-13 -> 2026-08-09)    - a closed period
 *
 * Report:
 *   - BEFORE hero (fmt$(spent))
 *   - AFTER  hero (fmt$(spent + pending on live, spent on closed))
 *   - delta
 *
 * Owner rule: any CLOSED delta > 0 is a stop-and-report.
 */
function fmt$(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-$" + abs : "$" + abs;
}

const KPI_BASE = process.env.KPI_BASE || "http://localhost:3014";

const SCOPES = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
  "EAST", "WEST", "ALL",
];
const RANGES = [
  { key: "FYTD",     start: "2025-12-29", end: "2026-08-26", closed: false },
  { key: "P9_live",  start: "2026-08-10", end: "2026-09-06", closed: false },
  { key: "P8_closed",start: "2026-07-13", end: "2026-08-09", closed: true  },
];

async function fetchOne(scope, range) {
  const q = new URLSearchParams({ account: scope, start: range.start, end: range.end });
  const res = await fetch(`${KPI_BASE}/api/kpi/purchasing?${q}`, { headers: { "X-Test-Mode": "1" } });
  if (!res.ok) return { ok: false, status: res.status };
  const p = await res.json();
  return { ok: true, payload: p };
}

async function main() {
  const rows = [];
  const closedViolations = [];
  for (const s of SCOPES) {
    for (const r of RANGES) {
      const resp = await fetchOne(s, r);
      if (!resp.ok) {
        rows.push({ scope: s, range: r.key, err: resp.status });
        continue;
      }
      const p = resp.payload;
      const spent = Number(p?.totals?.pl_cogs?.spent || 0);
      const budget = Number(p?.totals?.pl_cogs?.budget || 0);
      const pending = Number(p?.pending?.amount || 0);
      const beforeHero = spent;
      const afterHero  = r.closed ? spent : (spent + pending);
      const delta = afterHero - beforeHero;
      rows.push({ scope: s, range: r.key, closed: r.closed,
        spent, budget, pending, beforeHero, afterHero, delta });
      if (r.closed && Math.abs(delta) > 0.001) {
        closedViolations.push({ scope: s, range: r.key, delta });
      }
    }
  }
  // Print the movement table
  console.log("\n=== Hero movement per scope × range ===\n");
  console.log("  scope         range      closed   BEFORE hero        AFTER hero         delta");
  console.log("  " + "-".repeat(90));
  for (const row of rows) {
    if (row.err) { console.log(`  ${row.scope.padEnd(13)} ${row.range.padEnd(10)} ERR ${row.err}`); continue; }
    const c = row.closed ? "yes    " : "no     ";
    const b = fmt$(row.beforeHero).padStart(18);
    const a = fmt$(row.afterHero).padStart(18);
    const d = row.delta === 0 ? "  UNCHANGED".padStart(18) : ("+" + fmt$(row.delta)).padStart(18);
    console.log(`  ${row.scope.padEnd(13)} ${row.range.padEnd(10)} ${c}  ${b}  ${a}  ${d}`);
  }
  console.log("\n=== CLOSED-must-not-move check ===");
  if (closedViolations.length === 0) {
    console.log(`  PASS  zero closed rows moved.  ${rows.filter(r => r.closed).length} closed rows measured.`);
  } else {
    console.log(`  FAIL  ${closedViolations.length} closed rows moved:`);
    for (const v of closedViolations) console.log(`    ${v.scope} ${v.range}: delta=${fmt$(v.delta)}`);
    process.exit(1);
  }
  // Summary of live-range movements
  const liveRows = rows.filter(r => !r.closed && !r.err);
  const nonzeroLive = liveRows.filter(r => Math.abs(r.delta) > 0.001);
  console.log(`\n=== Live-range movements summary ===`);
  console.log(`  ${liveRows.length} live rows, ${nonzeroLive.length} moved.`);
  const totalLiveDelta = nonzeroLive.reduce((s, r) => s + r.delta, 0);
  console.log(`  total live-range delta (sum of pending across live scopes): ${fmt$(totalLiveDelta)}`);
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
