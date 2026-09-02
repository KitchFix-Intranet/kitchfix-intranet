#!/usr/bin/env node
// scripts/probes/_probe_fytd_closed_only.mjs
//
// Kevin ruling 2026-09-02 (PR-1 of the language pass):
//
//   FYTD ends at the last CLOSED period. Not `today`. A live partial
//   period must not sit alongside eight closed ones on the year-to-
//   date figure. This probe asserts that:
//
//     A1  range.kind === "fytd" AND range.end === periodEndISO(last
//         closed period). No FYTD payload can end mid-period.
//     A2  every period in periods_in_range is verified per
//         range_composition. live.count === 0, planned.count === 0,
//         will_change_at_close === false.
//     A3  no revenue row on FYTD carries sc_daily_revenue or
//         kpi_budgets_*_planned / _contractual / _tracked / _estimate
//         in its sources. Only pnl_actuals.
//     A4  chart.series.length === range_composition.periods_total
//         (no ninth bar).
//     A5  sources.revenue.consequence === null (nothing changes at
//         close on a closed-only range).
//     A6  sources.revenue.parts contains exactly one entry ("P1-P{N}
//         verified against the finance P&L") - no live/planned tail.
//
// COVERAGE: all 11 accounts on FYTD. Any account whose fiscal state
// carries the ruling equally: fee, per-meal, salaried, tracked.
//
// USAGE
//   node scripts/probes/_probe_fytd_closed_only.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);
const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

// Sources allowed on FYTD revenue lines: pnl_actuals only.
const ALLOWED_FYTD_REV_SOURCES = new Set(["pnl_actuals"]);

// FY 2026 period ends (mirror of periods.js periodEndISO).
const FY_PERIOD_ENDS = {
  1: "2026-01-25", 2: "2026-02-22", 3: "2026-03-22", 4: "2026-04-19",
  5: "2026-05-17", 6: "2026-06-14", 7: "2026-07-12", 8: "2026-08-09",
  9: "2026-09-06", 10: "2026-10-04", 11: "2026-11-01", 12: "2026-11-29",
  13: "2026-12-27",
};

const today = new Date().toISOString().slice(0, 10);
function lastClosedBefore(today) {
  let last = null;
  for (let p = 1; p <= 13; p += 1) {
    const pe = FY_PERIOD_ENDS[p];
    if (pe && pe < today) last = p;
  }
  return last;
}
const LAST_CLOSED = lastClosedBefore(today);
const EXPECTED_FYTD_END = FY_PERIOD_ENDS[LAST_CLOSED];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function check(a) {
  const url = `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const j = await (await fetch(url)).json();
  if (j.error) { fail(a, `HTTP ${JSON.stringify(j.error)}`); return; }
  // A1: kind + end
  if (j.range?.kind !== "fytd") {
    fail(a, `range.kind=${j.range?.kind} (want "fytd")`);
  }
  if (j.range?.end !== EXPECTED_FYTD_END) {
    fail(a, `range.end=${j.range?.end} != expected ${EXPECTED_FYTD_END} (last closed=P${LAST_CLOSED})`);
  }
  const rc = j.range_composition;
  if (!rc) { fail(a, "range_composition missing"); return; }
  // A2: every period verified
  if (rc.live.count !== 0) fail(a, `live.count=${rc.live.count} (want 0)`);
  if (rc.planned.count !== 0) fail(a, `planned.count=${rc.planned.count} (want 0)`);
  if (rc.will_change_at_close !== false) fail(a, `will_change_at_close=${rc.will_change_at_close} (want false)`);
  if (rc.verified.count !== rc.periods_total) {
    fail(a, `verified.count=${rc.verified.count} != periods_total=${rc.periods_total}`);
  }
  // A3: no source other than pnl_actuals on any revenue line
  const revRows = (j.statement_rows || []).filter(r => r.section === "revenue");
  for (const r of revRows) {
    for (const s of (r.sources || [])) {
      if (!ALLOWED_FYTD_REV_SOURCES.has(s)) {
        fail(a, `revenue line ${r.line_code} carries disallowed source '${s}' on FYTD`);
      }
    }
  }
  // A4: chart bar count matches periods_total
  const chartLen = j.chart?.series?.length ?? null;
  if (chartLen !== rc.periods_total) {
    fail(a, `chart.series.length=${chartLen} != periods_total=${rc.periods_total}`);
  }
  // A5: consequence null
  if (j.sources?.revenue?.consequence != null) {
    fail(a, `sources.revenue.consequence=${JSON.stringify(j.sources.revenue.consequence)} (want null on closed-only)`);
  }
  // A6: parts is exactly one entry, the verified one
  const parts = j.sources?.revenue?.parts || [];
  if (parts.length !== 1) fail(a, `sources.revenue.parts has ${parts.length} entries (want 1): ${JSON.stringify(parts)}`);
  if (parts[0] && !/verified against the finance/i.test(parts[0])) {
    fail(a, `sources.revenue.parts[0]=${JSON.stringify(parts[0])} not the verified label`);
  }
}

async function main() {
  console.log(`# FYTD closed-only invariants - ${today}`);
  console.log(`# BASE=${BASE}  last closed period=P${LAST_CLOSED}  expected end=${EXPECTED_FYTD_END}`);
  console.log("");
  for (const a of ACCOUNTS) {
    const before = FAILS.length;
    await check(a);
    const after = FAILS.length;
    console.log(`  ${after === before ? "OK  " : "FAIL"} ${a}  (${after - before})`);
  }
  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: FYTD closed-only invariants hold across all ${ACCOUNTS.length} accounts.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
