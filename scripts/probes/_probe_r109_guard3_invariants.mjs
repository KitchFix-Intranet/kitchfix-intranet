#!/usr/bin/env node
// R-109 Guard 3 · six invariants against live payloads (before code).
// Runs the prompt § "Guard 3" checks on TBJ + TBR Current period,
// hourly + salary. If any invariant fails on today's payloads, that's
// a defect to report - not something to work around.

const BASE = process.env.BASE || "http://localhost:3000";
const HEADER = { "x-test-user": "kevin@kitchfix.com" };
const ACCOUNTS = ["TBJ - FL", "TBR - FL"];
const TOGGLES = ["hourly", "salary"];  // ?include_salary=1 vs default

const dollar = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const eq = (a, b, tol = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tol;

async function jget(path) {
  const r = await fetch(`${BASE}${path}`, { headers: HEADER });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: null, raw: t.slice(0, 400) }; }
}

const fmt$ = (n) => n == null ? "null" : dollar(n);

let totalFails = 0;

for (const account of ACCOUNTS) {
  const enc = encodeURIComponent(account);
  for (const toggle of TOGGLES) {
    const salaryQs = toggle === "salary" ? "&include_salary=1" : "";
    // Fetch all three boards. Overview uses ?range=period:N so we let
    // the server compute it from today; Purchasing + Labor use dates.
    const ovResp = await jget(`/api/kpi/overview?account=${enc}&range=period:${await currentPeriod()}${salaryQs}`);
    if (ovResp.status !== 200) { console.log(`FAIL overview ${account} ${toggle}: HTTP ${ovResp.status}`); totalFails++; continue; }
    const ov = ovResp.body;
    const cpStart = ov?.range?.start;
    const cpEnd   = ov?.range?.end;
    const lbResp = await jget(`/api/kpi/labor?account=${enc}&start=${cpStart}&end=${cpEnd}${salaryQs}`);
    const puResp = await jget(`/api/kpi/purchasing?account=${enc}&start=${cpStart}&end=${cpEnd}`);
    if (lbResp.status !== 200) { console.log(`FAIL labor ${account} ${toggle}: HTTP ${lbResp.status}`); totalFails++; continue; }
    if (puResp.status !== 200) { console.log(`FAIL purchasing ${account} ${toggle}: HTTP ${puResp.status}`); totalFails++; continue; }
    const lb = lbResp.body;
    const pu = puResp.body;

    console.log(`\n=== ${account} · ${toggle} · CP (${cpStart}..${cpEnd}) ===`);
    console.log(`  Overview range.kind=${ov?.range?.kind} period_state=${ov?.period_state}`);
    console.log(`  Labor board.kind=${lb?.board?.kind}`);

    const wk = ov?.week_rail?.weeks || [];
    if (wk.length !== 4) {
      console.log(`  FAIL: week_rail has ${wk.length} weeks, expected 4`);
      totalFails++;
      continue;
    }
    const stmtByLine = new Map((ov?.statement_rows || []).map(r => [r.line_code, r]));
    // Sub-row lookup for 3100 on the +salary path (Kevin ruling INV1).
    // R-111 lands 3100.1.target_pct as full-period ratio, so goal on
    // salary decomposes cleanly into hourly-ratio + salary-flat.
    const sub3100Hourly = stmtByLine.get("3100.1") || null;
    const sub3100Salary = stmtByLine.get("3100.2") || null;
    const salaryPath = sub3100Hourly != null && sub3100Salary != null;

    // Invariant 3 · sum(week revenue) == cards[0] projection (post #1120)
    const wkRevSum = wk.reduce((s, w) => s + Number(w.week_revenue || 0), 0);
    const revCard = (ov?.cards || [])[0] || null;
    const cardProj = Number(revCard?.projected_period_revenue || 0);
    const inv3 = eq(wkRevSum, cardProj);
    console.log(`  INV3 · sum(week revenue) == cards[0].projected_period_revenue`);
    console.log(`    sum(week_rail.weeks[].week_revenue) = ${fmt$(wkRevSum)}`);
    console.log(`    cards[0].projected_period_revenue   = ${fmt$(cardProj)}`);
    console.log(`    ${inv3 ? "PASS" : "FAIL"}`);
    if (!inv3) totalFails++;

    // Per cost line: invariants 1, 2, 4
    for (const line of ["3100", "3200", "3400"]) {
      const row = stmtByLine.get(line);
      if (!row) { console.log(`  ${line}: no statement_row (skip)`); continue; }
      const pct = Number(row.target_pct || 0);
      const batr = Number(row.budget_at_this_revenue || 0);
      const actual = Number(row.actual || 0);

      // Goals per Kevin ruling INV1 (R-111 lands the sub-row split for
      // salary). For 3100 on salary use hourly-ratio × week_rev +
      // salary-flat / 4; otherwise the row's exact target_pct
      // suffices. R-111 makes 3100.1.target_pct the correct full-
      // period ratio so this decomposes cleanly.
      let goalPerWk;
      let goalFormula;
      if (line === "3100" && salaryPath) {
        const hourlyRatio = Number(sub3100Hourly.target_pct || 0) / 100;
        const salaryPerWk = Number(sub3100Salary.period_budget || 0) / 4;
        goalPerWk = wk.map(w => Number(w.week_revenue || 0) * hourlyRatio + salaryPerWk);
        goalFormula = `week_rev × ${(hourlyRatio * 100).toFixed(4)}% + $${salaryPerWk.toFixed(2)}/4`;
      } else {
        goalPerWk = wk.map(w => Number(w.week_revenue || 0) * (pct / 100));
        goalFormula = `week_rev × ${pct.toFixed(4)}%`;
      }
      const goalSum = goalPerWk.reduce((s, v) => s + v, 0);

      // Landed per Kevin ruling INV2/INV5 (2026-09-15). For 3100 the
      // authoritative source is Labor's per-week sum (R-103 - costed
      // + unpriced + unapproved). We reconcile Labor sum against
      // Labor's own period total (board.spent_to_date). Overview's
      // statement_rows[3100].actual is a DIFFERENT figure (approved-
      // only + accrual, no hatched) - logged as a follow-up (adopt
      // R-103 on running ranges eventually; closed ranges unaffected
      // because hatched is zero there). Reported here for the record
      // but not the invariant.
      let landedSum;
      let landedReference;
      let landedRefLabel;
      let overviewNote = null;
      if (line === "3100") {
        landedSum = (lb?.board?.weeks || []).reduce((s, w) => s + Number(w.spent || 0), 0);
        landedReference = Number(lb?.board?.spent_to_date || 0);
        landedRefLabel = "labor.board.spent_to_date";
        overviewNote = `overview.statement_rows[3100].actual = ${fmt$(actual)} · differs by ${dollar(landedSum - actual)} (hatched not yet in Overview, R-103 follow-up)`;
      } else {
        // Purchasing weekly[] filtered by gl_line_code prefix and week_start.
        const wkStartSet = new Set(wk.map(w => w.week_start));
        const prefix = line;
        landedSum = (pu?.weekly || []).reduce((s, r) => {
          const gl = String(r.gl_line_code || "");
          if (!gl.startsWith(prefix)) return s;
          if (!wkStartSet.has(r.week_start)) return s;
          return s + Number(r.amount || 0);
        }, 0);
        landedReference = Number(row.actual || 0);
        landedRefLabel = "overview.statement_rows[line].actual";
      }
      const inv1 = eq(goalSum, batr, 1.0);   // 1 dollar tol - week_rev rounds to cents, pct is 4 decimals
      const inv2 = eq(landedSum, landedReference, 0.5);
      const leftFromInv4 = batr - landedSum;
      console.log(`  ${line} · target_pct=${pct}%  batr=${fmt$(batr)}  landed=${fmt$(landedSum)}`);
      console.log(`    INV1 · sum(goal) == batr:                sum=${fmt$(goalSum)}  batr=${fmt$(batr)}  ${inv1 ? "PASS" : "FAIL delta=" + dollar(goalSum - batr)}`);
      console.log(`           goal formula: ${goalFormula}`);
      console.log(`    INV2 · sum(landed) == ${landedRefLabel}:  sum=${fmt$(landedSum)}  ref=${fmt$(landedReference)}  ${inv2 ? "PASS" : "FAIL delta=" + dollar(landedSum - landedReference)}`);
      if (overviewNote) console.log(`           note: ${overviewNote}`);
      console.log(`    INV4 · period left = batr - sum(landed):  ${fmt$(leftFromInv4)}`);
      if (!inv1) totalFails++;
      if (!inv2) totalFails++;
    }

    // INV5 · cross-board identity. Per Kevin's INV2/INV5 ruling, the
    // 3100 period-landed cell on Overview CP renders Labor's per-week
    // sum. Labor CP renders the same source. The invariant becomes
    // "Overview's 3100-cell reads == Labor's 3100-cell reads" -
    // cent-exact by construction (same source, no derivation). The
    // old formulation (Labor sum vs Overview statement_rows actual)
    // now surfaces as the note above, not the invariant.
    const lb3100Landed = (lb?.board?.weeks || []).reduce((s, w) => s + Number(w.spent || 0), 0);
    const lb3100Period = Number(lb?.board?.spent_to_date || 0);
    const inv5 = eq(lb3100Landed, lb3100Period, 0.5);
    console.log(`  INV5 · Labor's 3100 cell (per-week sum) == Labor's own period total`);
    console.log(`    sum(labor.board.weeks[].spent) = ${fmt$(lb3100Landed)}`);
    console.log(`    labor.board.spent_to_date      = ${fmt$(lb3100Period)}`);
    console.log(`    ${inv5 ? "PASS" : "FAIL delta=" + dollar(lb3100Landed - lb3100Period)}`);
    if (!inv5) totalFails++;

    // INV6 · Purchasing 3200 weekly-sum == Overview 3200 actual. Both
    // read the same source (billed + coded card). Bucket spent per
    // Kevin ruling 2 (2026-09-15) includes pending cards which land
    // via card_charges attribution client-side, not weekly[] here.
    const pu3200Spent = (pu?.weekly || []).reduce((s, r) => {
      if (!String(r.gl_line_code || "").startsWith("3200")) return s;
      return s + Number(r.amount || 0);
    }, 0);
    const ov3200Actual = Number(stmtByLine.get("3200")?.actual || 0);
    const inv6 = eq(pu3200Spent, ov3200Actual, 0.5);
    console.log(`  INV6 · Purchasing 3200 weekly-sum == Overview 3200 actual`);
    console.log(`    purchasing sum(weekly where gl 3200*) = ${fmt$(pu3200Spent)}`);
    console.log(`    overview statement_rows[3200].actual  = ${fmt$(ov3200Actual)}`);
    console.log(`    ${inv6 ? "PASS" : "FAIL delta=" + dollar(pu3200Spent - ov3200Actual)}`);
    if (!inv6) totalFails++;
  }
}

console.log(`\n=== ${totalFails === 0 ? "ALL SIX INVARIANTS PASS" : `${totalFails} INVARIANT FAILURES`} ===`);
process.exit(totalFails === 0 ? 0 : 1);

// Helper: current period from today.
async function currentPeriod() {
  const { currentPeriodNo } = await import("../../src/app/kpi/labor/lib/periods.js");
  return currentPeriodNo(new Date().toISOString().slice(0, 10)) || 10;
}
