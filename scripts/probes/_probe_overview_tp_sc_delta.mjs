#!/usr/bin/env node
// Kevin post-1053 sweep · PR-A item 4 report (2026-09-08).
//
// Report BEFORE building. Item 4 asks: should Overview This period
// switch to Labor's per-week SC basis for revenue? What does that do
// to cost percentages?
//
// This probe measures the DELTA - not a fix - for every candidate
// account (per-meal, TP range). It prints:
//   1. What Overview reports today (revenue actual + cost pct per line)
//   2. What Labor sees (sum per-week SC revenue on the same range)
//   3. What Overview's cost pcts WOULD BE if the revenue denominator
//      switched to Labor's SC basis
//
// Kevin rules on direction; then the build happens.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

// This period range - resolved from board.period_start / period_end
// once fetched. Caller supplies "today" fallback if we cannot resolve.
async function fetchOv(acct, start, end) {
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}
async function fetchLab(acct, start, end) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=1`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}

// TP window - period 10 starts 2026-09-07 (Sunday). Kevin's earlier
// sessions treated 09-07 as today. Period end for P10 is 2026-10-04.
const TP_START = "2026-09-07";
const TP_END = "2026-10-04";

// Per-meal candidates. AT_RISK minus fee-revenue (TXR - TX - H) and
// tracked (TXR - TX - V) per src/lib/kpi/overview/revenue-source.js.
// This is the exact set of account keys the SC picker allows to read
// sc_daily_revenue. Prior list contained non-keys (TBJ - AZ,
// CIN - IL, PDC, MLB, MiLB); those are not accounts.
const CANDIDATES = [
  "CIN - AZ",
  "CIN - KY",
  "TBJ - FL",
  "TBJ - NY",
  "TBR - FL",
  "TXR - AZ",
];

function fmt$(v) { return v == null ? "—" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function fmtPct(v) { return v == null ? "—" : `${Number(v).toFixed(2)}%`; }
function pctOf(a, b) { return (a == null || b == null || b === 0) ? null : (Number(a) / Number(b)) * 100; }

console.log("\n# Overview TP · SC-basis delta report");
console.log(`Range: ${TP_START} - ${TP_END}`);
console.log(`Candidates: ${CANDIDATES.length} per-meal accounts\n`);

for (const acct of CANDIDATES) {
  const [ov, lab] = await Promise.all([
    fetchOv(acct, TP_START, TP_END),
    fetchLab(acct, TP_START, TP_END),
  ]);
  if (ov.error || !ov.levers) {
    console.log(`## ${acct} · Overview error/skip (${ov.error || "no levers"})`);
    continue;
  }
  if (lab.error) {
    console.log(`## ${acct} · Labor error/skip (${lab.error})`);
    continue;
  }

  // Overview TP revenue actual + cost lines
  const ovRev = Number(ov.revenue_actual || 0);
  const revSource = ov.revenue_source_state || "unknown";
  const ovLevers = Object.values(ov.levers || {});
  const cogsLines = ovLevers.filter(l => ["3100", "3200", "3400", "3500"].includes(l.line_code));

  // Labor TP revenue basis: sum of confirmed + forecast per week
  const weeks = lab.board?.weeks || [];
  const labConfirmed = weeks
    .filter(w => w.revenue_basis === "confirmed" || w.revenue_basis === "partial")
    .reduce((s, w) => s + Number(w.week_revenue || 0), 0);
  const labAll = weeks
    .reduce((s, w) => s + Number(w.week_revenue || 0), 0);
  const anyScLive = weeks.some(w => w.revenue_basis === "confirmed" || w.revenue_basis === "partial");

  console.log(`## ${acct}`);
  console.log(`  revenue_source_state (Overview picker): ${revSource}`);
  console.log(`  Overview revenue actual:    ${fmt$(ovRev)}`);
  console.log(`  Labor per-week (confirmed): ${fmt$(labConfirmed)}   (SC-live weeks: ${weeks.filter(w => w.revenue_basis !== "forecast").length}/${weeks.length})`);
  console.log(`  Labor per-week (all wks):   ${fmt$(labAll)}   (SC + forecast, same as Labor panel)`);

  // If Overview switched to Labor's basis, cost pcts would be:
  //   pct_current = actual / ovRev
  //   pct_labor   = actual / labAll   (Labor uses full-range mix)
  // For SC-live accounts, ovRev ~= labAll (they agree). Divergence
  // fires when Overview picker landed on "planned" (revSource
  // !== "live") but Labor already sums SC-based revenue.
  for (const l of cogsLines) {
    const actual = Number(l.actual || 0);
    const curPct = pctOf(actual, ovRev);
    const labPct = pctOf(actual, labAll);
    const delta = (curPct != null && labPct != null) ? labPct - curPct : null;
    console.log(`    ${l.line_code}  actual ${fmt$(actual)}   current ${fmtPct(curPct)}   if-SC ${fmtPct(labPct)}   delta ${delta == null ? "—" : (delta >= 0 ? "+" : "") + delta.toFixed(2) + " pp"}`);
  }
  console.log("");
}

console.log("\n# Reading this report");
console.log("  - `revenue_source_state = live`   Overview already uses SC; no delta.");
console.log("  - `revenue_source_state = planned` Overview uses budget; if-SC column");
console.log("    shows what cost pcts become when Overview reads SC (Labor's basis).");
console.log("  - A negative delta = Overview reports HIGHER cost pct today than the");
console.log("    SC-basis would show; positive delta = LOWER cost pct today.");
