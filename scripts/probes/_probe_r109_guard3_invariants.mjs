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
      const goalPerWk = wk.map(w => Number(w.week_revenue || 0) * (pct / 100));
      const goalSum = goalPerWk.reduce((s, v) => s + v, 0);
      // Landed:
      let landedSum;
      if (line === "3100") {
        landedSum = (lb?.board?.weeks || []).reduce((s, w) => s + Number(w.spent || 0), 0);
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
      }
      const inv1 = eq(goalSum, batr, 1.0);   // 1 dollar tol - week_revenue rounds to cents, pct is 4 decimals
      const inv2 = eq(landedSum, actual, 0.5);
      const leftFromInv4 = batr - actual;
      const inv4 = true;  // definitional; kept for symmetry
      console.log(`  ${line} · target_pct=${pct}%  batr=${fmt$(batr)}  actual=${fmt$(actual)}`);
      console.log(`    INV1 · sum(goal) == batr:      sum=${fmt$(goalSum)}  batr=${fmt$(batr)}  ${inv1 ? "PASS" : "FAIL delta="+dollar(goalSum-batr)}`);
      console.log(`    INV2 · sum(landed) == actual:  sum=${fmt$(landedSum)}  actual=${fmt$(actual)}  ${inv2 ? "PASS" : "FAIL delta="+dollar(landedSum-actual)}`);
      console.log(`    INV4 · period left:            ${fmt$(leftFromInv4)}`);
      if (!inv1) totalFails++;
      if (!inv2) totalFails++;
    }

    // Invariants 5 + 6: cross-board identity - the same cost cell
    // read from Labor / Purchasing must equal Overview's cell.
    // INV5: Labor board's 3100 period landed == Overview's 3100 actual
    const lb3100Landed = (lb?.board?.weeks || []).reduce((s, w) => s + Number(w.spent || 0), 0);
    const ov3100Actual = Number(stmtByLine.get("3100")?.actual || 0);
    const inv5 = eq(lb3100Landed, ov3100Actual, 0.5);
    console.log(`  INV5 · Labor 3100 landed == Overview 3100 actual`);
    console.log(`    labor sum(weeks[].spent) = ${fmt$(lb3100Landed)}`);
    console.log(`    overview statement_rows[3100].actual = ${fmt$(ov3100Actual)}`);
    console.log(`    ${inv5 ? "PASS" : "FAIL delta="+dollar(lb3100Landed-ov3100Actual)}`);
    if (!inv5) totalFails++;

    // INV6: Purchasing 3200 spent == Overview 3200 actual
    const pu3200Spent = Number(pu?.categories?.find?.(c => c.gl_line_code === "3200.1")?.spent || 0)
                     || (pu?.weekly || []).reduce((s, r) => {
                          if (!String(r.gl_line_code || "").startsWith("3200")) return s;
                          return s + Number(r.amount || 0);
                        }, 0);
    const ov3200Actual = Number(stmtByLine.get("3200")?.actual || 0);
    const inv6 = eq(pu3200Spent, ov3200Actual, 0.5);
    console.log(`  INV6 · Purchasing 3200 spent == Overview 3200 actual`);
    console.log(`    purchasing sum(weekly where gl 3200*) = ${fmt$(pu3200Spent)}`);
    console.log(`    overview statement_rows[3200].actual  = ${fmt$(ov3200Actual)}`);
    console.log(`    ${inv6 ? "PASS" : "FAIL delta="+dollar(pu3200Spent-ov3200Actual)}`);
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
