#!/usr/bin/env node
// scripts/probes/_probe_ranges_period_aligned.mjs
//
// Permanent assertion (Kevin, 2026-09-02):
//
//   Every range the platform will resolve is either FYTD or exactly
//   one fiscal period. For each of P1..P13 and FYTD, assert start
//   and end equal periodStartISO(n) / periodEndISO(n) (or the FY
//   bounds), on all three routes.
//
//   Seeded failure: request a deliberately misaligned range and
//   assert it snaps rather than computing across the boundary.
//
// This is what makes the retire-custom PR a retirement rather than
// a patch.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_ranges_period_aligned.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_ranges_period_aligned.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);

// FY26 fiscal calendar. Same source of truth as
// src/app/kpi/labor/lib/periods.js - inlined here so the probe has
// zero import dependency on the app runtime.
const FY_START = "2025-12-29";
const PERIODS = {
  1:  ["2025-12-29", "2026-01-25"],
  2:  ["2026-01-26", "2026-02-22"],
  3:  ["2026-02-23", "2026-03-22"],
  4:  ["2026-03-23", "2026-04-19"],
  5:  ["2026-04-20", "2026-05-17"],
  6:  ["2026-05-18", "2026-06-14"],
  7:  ["2026-06-15", "2026-07-12"],
  8:  ["2026-07-13", "2026-08-09"],
  9:  ["2026-08-10", "2026-09-06"],
  10: ["2026-09-07", "2026-10-04"],
  11: ["2026-10-05", "2026-11-01"],
  12: ["2026-11-02", "2026-11-29"],
  13: ["2026-11-30", "2026-12-27"],
};

const ACCOUNT = "TBR - FL";  // one account is enough - snap logic is not per-account
const ROUTES = [
  { name: "overview",   base: `${BASE}/api/kpi/overview`,   readStart: (j) => j.range?.start,       readEnd: (j) => j.range?.end },
  { name: "labor",      base: `${BASE}/api/kpi/labor`,      readStart: (j) => j.filters?.start,     readEnd: (j) => j.filters?.end },
  { name: "purchasing", base: `${BASE}/api/kpi/purchasing`, readStart: (j) => j.filters?.range?.start || j.range?.start, readEnd: (j) => j.filters?.range?.end || j.range?.end },
];

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const FAILS = [];
function fail(where, why) { FAILS.push(`${where}  ${why}`); }

async function checkAlignedRange(route, label, url, expectStart, expectEnd, expectSnap) {
  let j;
  try { j = await fetchJson(url); } catch (e) { fail(`${route.name} ${label}`, e.message); return; }
  const gotStart = route.readStart(j);
  const gotEnd = route.readEnd(j);
  const gotSnap = !!j.range_snap?.snapped;
  if (gotStart !== expectStart) fail(`${route.name} ${label}`, `start=${gotStart} expected=${expectStart}`);
  if (gotEnd !== expectEnd) fail(`${route.name} ${label}`, `end=${gotEnd} expected=${expectEnd}`);
  if (gotSnap !== expectSnap) fail(`${route.name} ${label}`, `snap=${gotSnap} expected=${expectSnap}`);
}

async function main() {
  console.log(`# ranges are period-aligned across all three boards - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}  seeded=${SEEDED}`);
  console.log("");

  const today = new Date().toISOString().slice(0, 10);

  if (SEEDED) {
    // Seeded axis: request a deliberately misaligned range and
    // assert the response says it snapped (rather than silently
    // computing across the period boundary).
    console.log("## Seeded failure axis - misaligned URL must snap, never compute");
    const seedFails = [];
    for (const route of ROUTES) {
      const url = `${route.base}?account=${acct(ACCOUNT)}&start=2026-08-03&end=2026-08-30`;
      const j = await fetchJson(url);
      const snapped = !!j.range_snap?.snapped;
      const snappedTo = j.range_snap?.snapped_to;
      // The snap MUST fire and land on P9 (period containing end=08/30).
      const passed = snapped
        && snappedTo?.start === "2026-08-10"
        && snappedTo?.end === "2026-09-06";
      seedFails.push({ route: route.name, snapped, snappedTo, passed });
      console.log(`  ${passed ? "PASS" : "FAIL"}  ${route.name} 08/03-08/30 must snap to P9`);
      console.log(`         snapped=${snapped}  snapped_to=${JSON.stringify(snappedTo)}`);
    }
    const allPass = seedFails.every(s => s.passed);
    console.log("");
    console.log(allPass ? "Seeded failure axis: PASS" : "Seeded failure axis: FAIL");
    process.exit(allPass ? 0 : 1);
  }

  // Live pass: for each of P1..P13 and FYTD, on all three routes,
  // assert start/end equal the expected period (or FY) boundaries
  // and no snap fired.
  console.log("## Live - each of P1..P13 + FYTD returns exact period boundaries on all three routes");
  for (const route of ROUTES) {
    // FYTD: no start/end -> route defaults resolve to FY_START..today.
    // Purchasing + Labor snap won't fire because (FY_START, today) is the
    // FYTD exception in snapRange. Overview also returns kind: "fytd".
    const fytdUrl = `${route.base}?account=${acct(ACCOUNT)}`;
    await checkAlignedRange(route, "FYTD", fytdUrl, FY_START, today, false);

    // P1..P13
    for (let n = 1; n <= 13; n++) {
      const [ps, pe] = PERIODS[n];
      const url = `${route.base}?account=${acct(ACCOUNT)}&start=${ps}&end=${pe}`;
      await checkAlignedRange(route, `P${n}`, url, ps, pe, false);
    }
  }

  const rangesCount = ROUTES.length * (1 + 13);
  console.log(`  ${FAILS.length === 0 ? "OK" : "FAIL"} ${rangesCount} configurations scanned, ${FAILS.length} violations`);

  if (FAILS.length === 0) {
    console.log("");
    console.log(`Result: 0 violations across all ranges.`);
    process.exit(0);
  }
  console.log("");
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS.slice(0, 20)) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
