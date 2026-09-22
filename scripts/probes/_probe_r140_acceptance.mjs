#!/usr/bin/env node
// R-140 · Overview/Labor revenue-basis tie on the running period.
// Verifies the fix in labor-week-basis.js (closed-week accrual uses
// fee/4, not accrual/4) landed on the 17-combo blast radius Kevin
// enumerated and did not disturb anything else.

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
async function get(u) { return (await fetch(u)).json(); }

// Blast radius: 17 account-periods across FY2026 with 2200 or 2600 > 0.
const BLAST = [
  { acct:"CIN - AZ", p:1,  s:"2025-12-29", e:"2026-01-25", line:"2200", amt:46000, state:"verified", must_tie:"hero_actual" },
  { acct:"CIN - AZ", p:2,  s:"2026-01-26", e:"2026-02-22", line:"2200", amt: 3000, state:"verified", must_tie:"hero_actual" },
  { acct:"CIN - AZ", p:3,  s:"2026-02-23", e:"2026-03-22", line:"2200", amt: 3000, state:"verified", must_tie:"hero_actual" },
  { acct:"TBJ - FL", p:1,  s:"2025-12-29", e:"2026-01-25", line:"2600", amt: 5000, state:"verified", must_tie:"hero_actual" },
  { acct:"TBJ - FL", p:2,  s:"2026-01-26", e:"2026-02-22", line:"2600", amt: 5000, state:"verified", must_tie:"hero_actual" },
  { acct:"TBJ - FL", p:3,  s:"2026-02-23", e:"2026-03-22", line:"2600", amt:15000, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:1,  s:"2025-12-29", e:"2026-01-25", line:"2200", amt: 9100, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:2,  s:"2026-01-26", e:"2026-02-22", line:"2200", amt: 9100, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:3,  s:"2026-02-23", e:"2026-03-22", line:"2200", amt: 7150, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:4,  s:"2026-03-23", e:"2026-04-19", line:"2200", amt: 9100, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:5,  s:"2026-04-20", e:"2026-05-17", line:"2200", amt: 9100, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:6,  s:"2026-05-18", e:"2026-06-14", line:"2200", amt: 1950, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:9,  s:"2026-08-10", e:"2026-09-06", line:"2200", amt: 4550, state:"verified", must_tie:"hero_actual" },
  { acct:"TBR - FL", p:10, s:"2026-09-07", e:"2026-10-04", line:"2200", amt: 9100, state:"open",     must_tie:"week_rail_sum" },
  { acct:"TBR - FL", p:11, s:"2026-10-05", e:"2026-11-01", line:"2200", amt: 9100, state:"planned",  must_tie:"skip_future" },
  { acct:"TBR - FL", p:12, s:"2026-11-02", e:"2026-11-29", line:"2200", amt: 7150, state:"planned",  must_tie:"skip_future" },
  { acct:"TBR - FL", p:13, s:"2026-11-30", e:"2026-12-27", line:"2200", amt: 4550, state:"planned",  must_tie:"skip_future" },
];

let fails = 0;
console.log("R-140 · blast-radius sweep · Labor Σ week_revenue vs Overview basis");
console.log("acct        P   state      2200/2600   labor Σwk       ov basis        Δ         verdict");
for (const c of BLAST) {
  const [ov, lb] = await Promise.all([
    get(`${BASE}/api/kpi/overview?account=${encodeURIComponent(c.acct)}&start=${c.s}&end=${c.e}&include_salary=1`),
    get(`${BASE}/api/kpi/labor?account=${encodeURIComponent(c.acct)}&start=${c.s}&end=${c.e}&include_salary=1`),
  ]);
  const state = ov.period_state;
  const lbSum = (lb.board?.weeks || []).reduce((s,w) => s + Number(w.week_revenue || 0), 0);
  let ovBasis, verdict;
  if (c.must_tie === "hero_actual") {
    ovBasis = Number(ov.cards?.[0]?.hero_actual || 0);
    const delta = lbSum - ovBasis;
    verdict = Math.abs(delta) < 0.05 ? "OK" : `FAIL $${delta.toFixed(2)}`;
    if (verdict !== "OK") fails += 1;
  } else if (c.must_tie === "week_rail_sum") {
    ovBasis = (ov.week_rail?.weeks || []).reduce((s,w) => s + Number(w.week_revenue || 0), 0);
    const delta = lbSum - ovBasis;
    verdict = Math.abs(delta) < 0.05 ? "OK" : `FAIL $${delta.toFixed(2)}`;
    if (verdict !== "OK") fails += 1;
  } else {
    // Future ranges: no shipped revenue basis to compare. Confirm all
    // weeks are temporal !== "closed" so the accrual branch does not
    // fire (byte-identical before/after R-140 by construction).
    const wks = lb.board?.weeks || [];
    const anyClosed = wks.some(w => w.revenue_basis_temporal === "closed");
    ovBasis = 0;
    verdict = anyClosed ? "FAIL closed week on future range" : "OK · no closed weeks (accrual branch cannot fire)";
    if (anyClosed) fails += 1;
  }
  console.log(`  ${c.acct.padEnd(11)} P${String(c.p).padStart(2)} ${state.padEnd(10)} ${c.line}=$${String(c.amt).padStart(5)}  $${lbSum.toFixed(2).padStart(11)}  $${ovBasis.toFixed(2).padStart(11)}   ${verdict}`);
}

// Guard 1 on P10 (the fix target): Labor panel batr == Overview 3100 batr
// (salary) and Overview 3100.1 batr (hourly).
console.log();
console.log("R-140 · Guard 1 on P10 · Labor board.batr == Overview batr both toggles");
for (const acct of ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ"]) {
  const [ov, lbS, lbH] = await Promise.all([
    get(`${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=2026-09-07&end=2026-10-04&include_salary=1`),
    get(`${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=2026-09-07&end=2026-10-04&include_salary=1`),
    get(`${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=2026-09-07&end=2026-10-04&include_salary=0`),
  ]);
  const sr = Object.fromEntries((ov.statement_rows||[]).map(r=>[r.line_code,r]));
  const ovParent  = Number(sr["3100"]?.budget_at_this_revenue || 0);
  const ov31001   = Number(sr["3100.1"]?.budget_at_this_revenue || 0);
  const lbBatrS   = Number(lbS.board?.budget_at_this_revenue || 0);
  const lbBatrH   = Number(lbH.board?.budget_at_this_revenue || 0);
  const okS = Math.abs(lbBatrS - ovParent) < 0.02;
  const okH = Math.abs(lbBatrH - ov31001)  < 0.02;
  if (!okS) fails += 1;
  if (!okH) fails += 1;
  console.log(`  ${acct.padEnd(11)} sal=1: labor $${lbBatrS.toFixed(2)} vs ov 3100 $${ovParent.toFixed(2)} ${okS?"OK":"FAIL"}    sal=0: labor $${lbBatrH.toFixed(2)} vs ov 3100.1 $${ov31001.toFixed(2)} ${okH?"OK":"FAIL"}`);
}

console.log();
console.log(fails === 0 ? "R-140 · PASS · every blast-radius combo ties" : `R-140 · FAIL · ${fails} mismatches`);
process.exit(fails === 0 ? 0 : 1);
