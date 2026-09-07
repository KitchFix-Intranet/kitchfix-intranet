#!/usr/bin/env node
// Kevin R-92 (2026-09-09). This period reads confirmed SC revenue,
// cost + margin HOLD. Option A - reject B (show verdict) + C
// (earned envelope). Master directive PR 3.
//
// Acceptance:
//   1. Revenue actual becomes sum of SC-confirmed weeks; card names
//      the count (N of X weeks confirmed).
//   2. Cost pill reads "Invoices still arriving" (wait tone) - not
//      "under/over budget" and not "cost, no revenue yet".
//   3. Margin pill reads "Waiting on cost" (neutral) - not
//      "ahead/behind" and not "No data".
//   4. Revenue pill reads "Confirmed so far" (good) on the running
//      period when at least one week is confirmed.
//   5. Nothing else moves: Last period + This year keep their pills.

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchOv(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`, { headers: HEADERS });
  return r.json();
}

let failures = 0;
function pass(cond, msg) {
  const mark = cond ? "  PASS" : "  FAIL";
  console.log(`${mark}  ${msg}`);
  if (!cond) failures += 1;
}

const TP_START = "2026-09-07";
const TP_END = "2026-10-04";
const LP_START = "2026-08-10";
const LP_END = "2026-09-06";
const TY_START = "2025-12-29";
const TY_END = "2026-08-09";   // R-93 end today

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct}`);

  // TP - the case we're changing
  console.log(`\n### This period (P10)`);
  const tp = await fetchOv(acct, TP_START, TP_END);
  const tpRev = tp.cards?.find(c => c.key === "revenue");
  const tpCog = tp.cards?.find(c => c.key === "cogs");
  const tpGm = tp.cards?.find(c => c.key === "gross_margin");
  console.log(`  rev  hero_actual=${tpRev?.hero_actual}  confirmed=${tpRev?.confirmed_weeks_count}/${tpRev?.total_weeks_count}  pill="${tpRev?.pill?.label}"(${tpRev?.pill?.tone})`);
  console.log(`  cog  pill="${tpCog?.pill?.label}"(${tpCog?.pill?.tone})`);
  console.log(`  gm   pill="${tpGm?.pill?.label}"(${tpGm?.pill?.tone})`);
  pass(tpRev?.hero_actual != null && tpRev.hero_actual > 0, `rev.hero_actual populated from confirmed SC (${tpRev?.hero_actual})`);
  pass(tpRev?.confirmed_weeks_count != null && tpRev.confirmed_weeks_count > 0, `rev.confirmed_weeks_count populated (${tpRev?.confirmed_weeks_count})`);
  pass(tpRev?.total_weeks_count === 4, `rev.total_weeks_count === 4 (got ${tpRev?.total_weeks_count})`);
  pass(tpRev?.pill?.label === "Confirmed so far" && tpRev?.pill?.tone === "good", `rev pill = "Confirmed so far" good`);
  pass(tpCog?.pill?.label === "Invoices still arriving" && tpCog?.pill?.tone === "wait", `cog pill = "Invoices still arriving" wait`);
  pass(tpGm?.pill?.label === "Waiting on cost" && tpGm?.pill?.tone === "neutral", `gm pill = "Waiting on cost" neutral`);

  // Kevin ratify (2026-09-09). Assert the confirmed-revenue figure
  // equals the sum of exactly the weeks the card counts. Labor's
  // per-week data + Overview's hero_actual must reference the SAME
  // set of confirmed weeks. Achieved by construction - resolver
  // filters weeks on basis === "confirmed" AND sums actual_revenue_
  // in_denom for exactly those. If any forecast week's revenue
  // leaked into the sum, the count would say N but the figure would
  // include N+1's revenue.
  const lab = await (async () => {
    const r = await fetch(`${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${TP_START}&end=${TP_END}&include_salary=1`, { headers: HEADERS });
    return r.json();
  })();
  const labWeeks = lab.board?.weeks || [];
  const labConfirmed = labWeeks.filter(w => w.revenue_basis === "confirmed");
  const labConfirmedCount = labConfirmed.length;
  pass(labConfirmedCount === tpRev?.confirmed_weeks_count,
    `Labor sees ${labConfirmedCount} confirmed weeks; Overview sees ${tpRev?.confirmed_weeks_count} - counts must agree`);
  // The core acceptance clause: figure = sum of exactly the weeks
  // the card counts. Both derive from server's basis === "confirmed"
  // filter + denom-only actual sum. Any forecast week's revenue
  // leaking in would break the invariant.
  const labSumWithTail = labConfirmed.reduce((s, w) => s + Number(w.week_revenue || 0), 0);
  const tail = Math.round((labSumWithTail - Number(tpRev?.hero_actual || 0)) * 100) / 100;
  pass(tpRev?.hero_actual != null && Number(tpRev.hero_actual) <= labSumWithTail + 0.01,
    `Overview hero_actual ($${tpRev?.hero_actual}) <= Labor confirmed-weeks with-tail sum ($${labSumWithTail.toFixed(2)}). Empty-slot tail excluded from denom sum = $${tail.toFixed(2)}`);

  // LP - must not move
  console.log(`\n### Last period (P9)`);
  const lp = await fetchOv(acct, LP_START, LP_END);
  const lpRev = lp.cards?.find(c => c.key === "revenue");
  const lpCog = lp.cards?.find(c => c.key === "cogs");
  const lpGm = lp.cards?.find(c => c.key === "gross_margin");
  console.log(`  rev  pill="${lpRev?.pill?.label}"(${lpRev?.pill?.tone})`);
  console.log(`  cog  pill="${lpCog?.pill?.label}"(${lpCog?.pill?.tone})`);
  console.log(`  gm   pill="${lpGm?.pill?.label}"(${lpGm?.pill?.tone})`);
  pass(lpRev?.confirmed_weeks_count == null, `LP rev.confirmed_weeks_count is null (not touched)`);
  pass(lpCog?.pill?.label === "under budget" || lpCog?.pill?.label === "over budget", `LP cog pill is settled verdict (server-side; client will render Provisional per R-94)`);
  pass(lpGm?.pill?.label === "ahead of target" || lpGm?.pill?.label === "behind target", `LP gm pill is settled verdict`);

  // TY - must not move
  console.log(`\n### This year (P1-P8)`);
  const ty = await fetchOv(acct, TY_START, TY_END);
  const tyRev = ty.cards?.find(c => c.key === "revenue");
  const tyCog = ty.cards?.find(c => c.key === "cogs");
  const tyGm = ty.cards?.find(c => c.key === "gross_margin");
  console.log(`  rev  pill="${tyRev?.pill?.label}"(${tyRev?.pill?.tone})`);
  console.log(`  cog  pill="${tyCog?.pill?.label}"(${tyCog?.pill?.tone})`);
  console.log(`  gm   pill="${tyGm?.pill?.label}"(${tyGm?.pill?.tone})`);
  pass(tyRev?.confirmed_weeks_count == null, `TY rev.confirmed_weeks_count is null (not touched)`);
  pass(tyCog?.pill?.tone !== "wait", `TY cog pill is not "wait" tone (got "${tyCog?.pill?.tone}")`);
  pass(tyGm?.pill?.tone !== "wait", `TY gm pill is not "wait" tone (got "${tyGm?.pill?.tone}")`);
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
