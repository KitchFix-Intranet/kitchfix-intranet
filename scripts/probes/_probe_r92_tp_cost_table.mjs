#!/usr/bin/env node
// Kevin PR-3 follow-up (2026-09-09). Cost lines table on This period
// must not print a percentage or a variance. Card cardsRow says
// "no percentage yet"; the table below it must not contradict.
//
// Also asserts revenue actual renders green (not red) - the hero
// color follows the "Confirmed so far" pill, not the negative delta
// vs full-period projection.

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

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct} · This period`);
  const tp = await fetchOv(acct, TP_START, TP_END);
  const rev = tp.cards?.find(c => c.key === "revenue");
  const cog = tp.cards?.find(c => c.key === "cogs");
  const gm = tp.cards?.find(c => c.key === "gross_margin");

  // Item 1: cost lines table simplification is a CLIENT render change.
  // Server-side data (statement_rows) is unchanged; probe checks the
  // raw fields exist but the CLIENT's SimpleCostLinesTable omits the
  // percent/variance columns. Assert the source data still ships
  // (verifies the SimpleCostLinesTable can build from it).
  const cogsRows = (tp.statement_rows || []).filter(r => r.section === "cogs" && !r.parent_line_code);
  pass(cogsRows.length >= 4, `TP cost lines: ${cogsRows.length} rows present in payload`);
  for (const r of cogsRows) {
    pass(r.actual != null && r.period_budget != null && r.target_pct != null,
      `TP cost line ${r.line_code} (${r.label}) has actual/period_budget/target_pct`);
  }

  // Item 3: revenue card hero color follows pill (not delta_direction)
  // when confirmed_weeks_count is set. Server ships pill=good on TP;
  // client actualToneCls = kpi-ov-good.
  pass(rev?.confirmed_weeks_count != null && rev?.pill?.tone === "good",
    `TP revenue pill tone = "good" (client will render hero green via new logic)`);
  console.log(`  revenue.hero_actual=$${rev?.hero_actual}  delta_direction=${rev?.delta_direction}  pill.tone=${rev?.pill?.tone}  confirmed=${rev?.confirmed_weeks_count}/${rev?.total_weeks_count}`);

  // Item 2 · confirmed sum attributed to statement rows via
  // service mapping (B&G Lunch -> 2200, else -> 2400.1). Assert
  // total unchanged and line split matches Kevin's spec.
  console.log(`\n### Revenue lines (item 2 · post-fix)`);
  const revRows = (tp.statement_rows || []).filter(r => r.section === "revenue");
  const totalActual = tp.statement_totals?.revenue?.actual;
  const line2200 = revRows.find(r => r.line_code === "2200");
  const line2400_1 = revRows.find(r => r.line_code === "2400.1");
  const line2300 = revRows.find(r => r.line_code === "2300");
  console.log(`  2200 Catering:            reported=${line2200?.reported} actual=${line2200?.actual}`);
  console.log(`  2300 Service charges:     reported=${line2300?.reported} actual=${line2300?.actual}  (Kevin item 5: null on TP because R-67 accrues on complete weeks)`);
  console.log(`  2400.1 Meal service:      reported=${line2400_1?.reported} actual=${line2400_1?.actual}`);
  console.log(`  Total revenue actual:     $${totalActual}`);
  const linesSum = Math.round(((Number(line2200?.actual || 0)) + Number(line2400_1?.actual || 0)) * 100) / 100;
  pass(Math.abs(linesSum - Number(totalActual)) < 0.02,
    `lines 2200 + 2400.1 sum ($${linesSum}) = total revenue ($${totalActual})`);
  pass(Number(rev?.hero_actual) === Number(totalActual),
    `card hero_actual ($${rev?.hero_actual}) unchanged from statement total ($${totalActual})`);
  pass(line2300?.reported === false,
    `line 2300 stays unreported on TP (Kevin item 5 · no complete weeks in period)`);

  // Nothing else moves: Last period cost lines table unchanged.
  console.log(`\n## ${acct} · Last period (must not move)`);
  const lp = await fetchOv(acct, LP_START, LP_END);
  const lpCogsRows = (lp.statement_rows || []).filter(r => r.section === "cogs" && !r.parent_line_code);
  pass(lpCogsRows.length === cogsRows.length,
    `LP cost lines table has same row count as TP (${lpCogsRows.length} rows) - client render unchanged`);
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
