// M-2 smoke probe: verify the year-summary payload emits `homestands`
// for CIN-OH (pilot) and does NOT emit it for the four fence-class
// accounts (three non-pilot MLB + STL-FL + two MiLB AAA + PDC per-meal).
//
// Runs the server-side loader directly - the same code path the API
// handler uses - so we assert the emit gate and shape without
// spinning up a Next server.
//
// NOTE on runners:
//   `node` alone cannot resolve `@/lib/supabase` (the jsconfig alias
//   is a bundler concept; Node has no idea). Run via tsx which reads
//   jsconfig.json paths:
//
//     npx tsx scripts/_probe_m2_year_summary.mjs
//
//   If tsx also fails, the fallback is to hit the running dev server
//   directly (authenticated) and inspect the API response.

import { loadYearSummary } from "@/lib/dataStore/serviceCalendar.js";

const CASES = [
  { key: "CIN - OH",       shouldEmit: true,  role: "pilot" },
  { key: "STL - MO",       shouldEmit: false, role: "non-pilot MLB (Fence 5)" },
  { key: "TXR - TX - H",   shouldEmit: false, role: "non-pilot MLB (Fence 5)" },
  { key: "TXR - TX - V",   shouldEmit: false, role: "non-pilot MLB (Fence 5)" },
  { key: "STL - FL",       shouldEmit: false, role: "fee-no-dollar (Fence 4)" },
  { key: "CIN - KY",       shouldEmit: false, role: "MiLB AAA (Fence 1)" },
  { key: "TBJ - NY",       shouldEmit: false, role: "MiLB AAA (Fence 2)" },
  { key: "CIN - AZ",       shouldEmit: false, role: "PDC per-meal (Fence 3)" },
];

const TODAY = "2026-07-29";

console.log("═══ M-2 year-summary emit probe ═══");
let allPass = true;
for (const { key, shouldEmit, role } of CASES) {
  const resp = await loadYearSummary(key, 2026, { clientToday: TODAY });
  const emitted = Object.prototype.hasOwnProperty.call(resp, "homestands");
  const count = emitted ? (resp.homestands?.length || 0) : 0;
  const pass = emitted === shouldEmit;
  if (!pass) allPass = false;

  const mark = pass ? "✓" : "✗";
  const status = emitted ? `emitted (${count} blocks)` : "absent";
  console.log(`  ${mark} ${key.padEnd(14)} ${role.padEnd(30)} -> ${status}`);

  if (emitted && count > 0) {
    const first = resp.homestands[0];
    const required = ["key","ordinal","startDate","endDate","dayCount","gameCount","opponents","periodsTouched","status","servedDays","exceptionDays","meals","prepDays","windowStart","windowEnd"];
    const missingFields = required.filter((f) => !(f in first));
    if (missingFields.length) {
      console.log(`    ⚠ missing fields on first block: ${missingFields.join(", ")}`);
      allPass = false;
    }
    if (first.budget == null && !first.budgetReason) {
      console.log(`    ⚠ null budget without reason on first block`);
      allPass = false;
    }
    if (!["upcoming","in-progress","ended"].includes(first.status)) {
      console.log(`    ⚠ status not in M-2 enum: ${first.status}`);
      allPass = false;
    }
    const raw = JSON.stringify(resp.homestands);
    if (raw.includes("salary_budget")) {
      console.log(`    ⚠ salary_budget leaked into wire payload!`);
      allPass = false;
    }
    if (raw.includes("revenue_forecast")) {
      console.log(`    ⚠ revenue_forecast leaked into wire payload!`);
      allPass = false;
    }
    // Round 2 reversal invariant: any hasScheduleGap flag is a
    // vanishing-GAME-row alarm (trap §11.2). Surface it, do not fail
    // the probe on it - the flag exists precisely to make this
    // condition visible.
    const gaps = resp.homestands.filter((b) => b.hasScheduleGap);
    if (gaps.length > 0) {
      console.log(`    ⚠ hasScheduleGap on ${gaps.length} block(s): ${gaps.map((b) => b.ordinal).join(", ")}`);
    }
  }
}

console.log(`\n═══ headline: ${allPass ? "✓ payload gates + shape look right" : "✗ FAIL - see above"} ═══`);

if (allPass) {
  const cin = await loadYearSummary("CIN - OH", 2026, { clientToday: TODAY });
  const hs9 = cin.homestands.find((b) => b.ordinal === "HS9");
  if (hs9) {
    console.log("\n──── CIN-OH HS9 detail ────");
    console.log(`  ${hs9.startDate}..${hs9.endDate}  (${hs9.gameCount} games, ${hs9.dayCount} day span)`);
    console.log(`  opponents: ${hs9.opponents.join(", ")}`);
    console.log(`  status: ${hs9.status}`);
    console.log(`  prepDays: [${hs9.prepDays.join(", ")}]  (${hs9.prepDays.length} proposals)`);
    console.log(`  window: ${hs9.windowStart}..${hs9.windowEnd}`);
    console.log(`  budget: ${hs9.budget ? "$" + hs9.budget.amount : "null (" + (hs9.budgetReason || "no reason") + ")"}`);
    console.log(`  periodsTouched: [${hs9.periodsTouched.join(", ")}]`);
    console.log(`  schedule days (games + prep): ${hs9.gameCount + hs9.prepDays.length}`);
    console.log(`  served: ${hs9.servedDays}/${hs9.gameCount}   exceptions: ${hs9.exceptionDays}   meals: ${hs9.meals}`);
  }
}
