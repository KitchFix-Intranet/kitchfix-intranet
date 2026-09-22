#!/usr/bin/env node
// R-139 · verify the current-period labor row's sub-label prints the
// achieved rate (envelope / revenue-basis) rather than the budget
// rate (target_pct). DOM probe via Playwright + TEST_MODE bypass.
//
// Kevin's blast radius per the R-139 prompt · TBJ - FL / TBR - FL /
// CIN - AZ / TXR - AZ P10, hourly toggle:
//   TBJ - FL  18.20% → 20.61%
//   TBR - FL  18.96% → 16.01%   (points the wrong way today)
//   CIN - AZ  12.50% → 12.46%
//   TXR - AZ  15.40% → 16.51%

import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE || "http://localhost:3001";

// [account, expected-hourly-pct-on-P10]
const CASES = [
  ["TBJ - FL", "20.61%"],
  ["TBR - FL", "16.01%"],
  ["CIN - AZ", "12.46%"],
  ["TXR - AZ", "16.51%"],
];
// Salary toggle 3100 parent must NOT move on any of the four.
const SALARY_UNCHANGED = [
  ["TBJ - FL", "33.29%"],
  ["TBR - FL", "30.72%"],
  ["CIN - AZ", "28.59%"],
  ["TXR - AZ", "32.95%"],
];
// Non-labor lines must NOT move on any of the four.
const NON_LABOR = [
  { acct: "TBJ - FL", sal: "0", food: "23.03%", pack: "2.44%", veh: "0.70%" },
  { acct: "TBR - FL", sal: "0", food: "22.18%", pack: "3.97%", veh: "1.72%" },
  { acct: "CIN - AZ", sal: "0", food: "24.65%", pack: "4.56%" },
  { acct: "TXR - AZ", sal: "0", food: "28.92%", pack: "4.74%" },
];

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();

async function readTable(acct, sal) {
  const url = `${BASE}/kpi/overview?account=${encodeURIComponent(acct)}&start=2026-09-07&end=2026-10-04&include_salary=${sal}`;
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => /Period running/i.test(document.body.innerText || ""), { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".kpi-ov-cp-rn"));
    const out = {};
    for (const rn of rows) {
      const text = (rn.innerText || "").trim();
      const rlab = rn.closest(".kpi-ov-cp-rlab");
      const rg = rlab ? rlab.querySelector(".kpi-ov-cp-rg") : null;
      const sub = rg ? (rg.innerText || "").trim() : "";
      out[text] = sub;
    }
    return out;
  });
}

let fails = 0;
console.log("R-139 · rendered labor row percent · P10 · hourly toggle");
for (const [acct, expected] of CASES) {
  const rows = await readTable(acct, "0");
  // The 3100 row on hourly is labelled "Kitchen labor" (the R-129 hourly-toggle label swap
  // did not touch the CP table's label). Look for the row starting with 3100.
  const laborRow = Object.entries(rows).find(([k]) => k.includes("3100") && k.includes("labor"));
  const sub = laborRow ? laborRow[1] : "(row not found)";
  const ok = sub.includes(expected);
  if (!ok) { fails += 1; console.log(`  FAIL · ${acct}  expected "${expected}"  got "${sub}"`); }
  else console.log(`  PASS · ${acct}  "${sub}"`);
}

console.log();
console.log("R-139 · salary toggle 3100 parent unchanged");
for (const [acct, expected] of SALARY_UNCHANGED) {
  const rows = await readTable(acct, "1");
  const laborRow = Object.entries(rows).find(([k]) => k.includes("3100") && k.includes("labor"));
  const sub = laborRow ? laborRow[1] : "(row not found)";
  const ok = sub.includes(expected);
  if (!ok) { fails += 1; console.log(`  FAIL · ${acct}  expected "${expected}"  got "${sub}"`); }
  else console.log(`  PASS · ${acct}  "${sub}"`);
}

console.log();
console.log("R-139 · non-labor rows unchanged");
for (const c of NON_LABOR) {
  const rows = await readTable(c.acct, c.sal);
  const foodRow = Object.entries(rows).find(([k]) => k.includes("3200"));
  const packRow = Object.entries(rows).find(([k]) => k.includes("3400"));
  const vehRow  = Object.entries(rows).find(([k]) => k.includes("3500"));
  const foodSub = foodRow ? foodRow[1] : "";
  const packSub = packRow ? packRow[1] : "";
  const vehSub  = vehRow  ? vehRow[1]  : null;
  const foodOk = foodSub.includes(c.food);
  const packOk = packSub.includes(c.pack);
  const vehOk  = c.veh == null ? true : (vehSub && vehSub.includes(c.veh));
  if (!foodOk) { fails += 1; console.log(`  FAIL · ${c.acct} food  expected "${c.food}"  got "${foodSub}"`); }
  if (!packOk) { fails += 1; console.log(`  FAIL · ${c.acct} pack  expected "${c.pack}"  got "${packSub}"`); }
  if (c.veh != null && !vehOk) { fails += 1; console.log(`  FAIL · ${c.acct} veh   expected "${c.veh}"  got "${vehSub}"`); }
  if (foodOk && packOk && vehOk) console.log(`  PASS · ${c.acct}  food ${c.food} · pack ${c.pack}${c.veh?" · veh "+c.veh:""}`);
}

await b.close();
console.log();
console.log(fails === 0 ? "R-139 · PASS · all rendered percents correct" : `R-139 · FAIL · ${fails} mismatches`);
process.exit(fails === 0 ? 0 : 1);
