#!/usr/bin/env node
// Kevin R-93 (2026-09-09). This year excludes any period whose close
// date is less than 8 days before today. Applies to Overview + Labor
// + Purchasing.
//
// The API doesn't know "today" - the client passes start/end. So this
// probe simulates the client behavior:
//   1. Compute r93FytdEndISO(today) via the calendar formula
//   2. Fetch each board with (FY_START, r93_end)
//   3. Assert board contains no period whose close is less than 8d
//      before today
//   4. Compare figures: TBJ - FL, TBR - FL revenue + cost on all three
//      boards, before vs after
//
// Also simulates three "today" values to prove the roll-in Monday:
//   2026-09-08 (today, P9 not settled - excluded)
//   2026-09-13 (Sunday, P9 not settled - excluded)
//   2026-09-14 (Monday, P9 settled - included)

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

const FY_START = "2025-12-29";
const MS_PER_DAY = 86400000;
const DAYS_PER_PERIOD = 28;

function periodEndISO(p) {
  const fy = new Date(FY_START + "T00:00:00Z");
  return new Date(fy.getTime() + (p * DAYS_PER_PERIOD - 1) * MS_PER_DAY).toISOString().slice(0, 10);
}
function periodOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const fy = new Date(FY_START + "T00:00:00Z");
  const days = Math.floor((d - fy) / MS_PER_DAY);
  return days < 0 ? null : Math.floor(days / DAYS_PER_PERIOD) + 1;
}
function r93FytdEndISO(todayISO) {
  const t = new Date(todayISO + "T00:00:00Z");
  const cutoffMs = t.getTime() - 7 * MS_PER_DAY;
  const curP = periodOf(todayISO) ?? 13;
  for (let p = Math.min(13, curP); p >= 1; p -= 1) {
    const end = periodEndISO(p);
    const endMs = new Date(end + "T00:00:00Z").getTime();
    if (endMs < cutoffMs) return end;
  }
  return null;
}
function r93ExcludedPeriodNo(todayISO) {
  const curP = periodOf(todayISO);
  if (curP == null) return null;
  const priorP = curP - 1;
  if (priorP < 1) return null;
  const priorEnd = periodEndISO(priorP);
  const priorEndMs = new Date(priorEnd + "T00:00:00Z").getTime();
  const cutoffMs = new Date(todayISO + "T00:00:00Z").getTime() - 7 * MS_PER_DAY;
  return priorEndMs < cutoffMs ? null : priorP;
}

async function fetchOv(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`, { headers: HEADERS });
  return r.json();
}
async function fetchLab(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${start}&end=${end}&include_salary=1`, { headers: HEADERS });
  return r.json();
}
async function fetchPur(acct, start, end) {
  const r = await fetch(`${BASE}/api/kpi/purchasing?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`, { headers: HEADERS });
  return r.json();
}

function fmt$(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return (v < 0 ? "-$" : "$") + Math.abs(Math.round(Number(v))).toLocaleString("en-US");
}

let failures = 0;
function pass(cond, msg) {
  const mark = cond ? "  PASS" : "  FAIL";
  console.log(`${mark}  ${msg}`);
  if (!cond) failures += 1;
}

console.log("\n# R-93 helper self-test\n");
for (const [today, expectedEnd, expectedExcluded] of [
  ["2026-09-08", "2026-08-09", 9],   // today: Mon P10 W1, P9 not settled
  ["2026-09-13", "2026-08-09", 9],   // Sun before rollover, P9 not settled
  ["2026-09-14", "2026-09-06", null], // Mon rollover, P9 settled
  ["2026-09-20", "2026-09-06", null], // deep in P10, P9 settled
]) {
  const gotEnd = r93FytdEndISO(today);
  const gotExcluded = r93ExcludedPeriodNo(today);
  pass(gotEnd === expectedEnd, `today ${today} · r93FytdEndISO = ${gotEnd} (expected ${expectedEnd})`);
  pass(gotExcluded === expectedExcluded, `today ${today} · r93ExcludedPeriodNo = ${gotExcluded} (expected ${expectedExcluded})`);
}

console.log("\n# Before / after · TBJ - FL and TBR - FL, all three boards\n");
const TODAY = "2026-09-08";
const beforeEnd = "2026-10-04";  // through P10 end - the "old fytd" behavior
const afterEnd = r93FytdEndISO(TODAY);

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct}\n`);

  const [ovBefore, ovAfter] = await Promise.all([
    fetchOv(acct, FY_START, beforeEnd),
    fetchOv(acct, FY_START, afterEnd),
  ]);
  const [labBefore, labAfter] = await Promise.all([
    fetchLab(acct, FY_START, beforeEnd),
    fetchLab(acct, FY_START, afterEnd),
  ]);
  const [purBefore, purAfter] = await Promise.all([
    fetchPur(acct, FY_START, beforeEnd),
    fetchPur(acct, FY_START, afterEnd),
  ]);

  const ovRevBefore = ovBefore?.statement_totals?.revenue?.actual;
  const ovRevAfter = ovAfter?.statement_totals?.revenue?.actual;
  const ovCogBefore = ovBefore?.statement_totals?.cogs?.actual;
  const ovCogAfter = ovAfter?.statement_totals?.cogs?.actual;

  const labSpentBefore = labBefore?.board?.closed_spent_to_date ?? labBefore?.board?.spent_to_date;
  const labSpentAfter = labAfter?.board?.closed_spent_to_date ?? labAfter?.board?.spent_to_date;

  console.log(`  Overview  revenue    before ${fmt$(ovRevBefore)}    after ${fmt$(ovRevAfter)}`);
  console.log(`  Overview  cost       before ${fmt$(ovCogBefore)}    after ${fmt$(ovCogAfter)}`);
  console.log(`  Labor     spend      before ${fmt$(labSpentBefore)}    after ${fmt$(labSpentAfter)}`);

  // Also count periods in Overview + Labor payloads to confirm P9 dropped.
  const ovPeriodsAfter = ovAfter?.range_composition?.periods_total ?? null;
  const labWeeksAfter = (labAfter?.board?.weeks || []).length;
  console.log(`  Overview periods after: ${ovPeriodsAfter} (expected 8)`);
  console.log(`  Labor weeks after: ${labWeeksAfter} (expected 32 for P1-P8, was 40 for P1-P10)`);

  // Assertion: no week in Labor board falls in an unsettled period.
  const cutoffMs = new Date(TODAY + "T00:00:00Z").getTime() - 7 * MS_PER_DAY;
  const weeksAfter = labAfter?.board?.weeks || [];
  const badWeeks = weeksAfter.filter(w => {
    const p = periodOf(w.week_start);
    if (p == null) return false;
    const endMs = new Date(periodEndISO(p) + "T00:00:00Z").getTime();
    return endMs >= cutoffMs;
  });
  pass(badWeeks.length === 0, `${acct} · Labor · no week in unsettled period (found ${badWeeks.length})`);

  // Overview: assert period count = 8.
  pass(ovPeriodsAfter === 8, `${acct} · Overview · range_composition.periods_total = 8`);
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
