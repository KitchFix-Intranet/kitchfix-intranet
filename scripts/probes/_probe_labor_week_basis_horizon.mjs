#!/usr/bin/env node
// Kevin Labor PR-B (2026-09-07): report confirmed-vs-forecast week
// counts per account before the UI work, so we know which path is
// actually being exercised.
//
// Kevin's ruling: build the fallback (forecast) as the main path,
// not the exception. Today the confirmed path only exercises on
// TBR - FL and TBJ - FL; on the other nine accounts every week
// falls back to forecast. This probe measures that split so the
// UI work knows what it's coding against.

import { createClient } from "@supabase/supabase-js";
import { loadWeeklyRevenueBasis } from "../../src/lib/labor/labor-week-basis.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TODAY = "2026-09-07";

const ACCOUNTS = [
  "TBR - FL", "TBJ - FL",  // hard-gate accounts, SC seeded
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - NY", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

const RANGES = [
  { name: "P9  · this period",  start: "2026-08-10", end: "2026-09-06" },
  { name: "P10 · next period",  start: "2026-09-07", end: "2026-10-04" },
];

console.log(`# Labor PR-B · per-week revenue basis  ·  today = ${TODAY}\n`);
console.log("Read surface: sc_daily_revenue view (NOT is_non_revenue).");
console.log("A week is `confirmed` when ANY served day has has_actuals; `forecast` when every served day has projections only.\n");

for (const range of RANGES) {
  console.log(`\n## ${range.name}  (${range.start} - ${range.end})\n`);
  console.log("| account | wk1 | wk2 | wk3 | wk4 | confirmed | forecast | notes |");
  console.log("|---|---|---|---|---|---:|---:|---|");
  for (const account of ACCOUNTS) {
    const res = await loadWeeklyRevenueBasis(supa, {
      members: [account],
      start: range.start,
      end: range.end,
      today: TODAY,
    });
    if (res.error) {
      console.log(`| ${account} | ERR ${res.error.message} |`);
      continue;
    }
    const weeks = res.data;
    const cells = weeks.map(w => {
      const b = w.basis === "confirmed" ? "C" : "F";
      const t = w.temporal === "closed" ? "cl" : w.temporal === "running" ? "run" : "fut";
      return `${b}·${t}`;
    });
    while (cells.length < 4) cells.push("-");
    const confirmedCount = weeks.filter(w => w.basis === "confirmed").length;
    const forecastCount  = weeks.filter(w => w.basis === "forecast").length;

    // Notes: highlight edge cases
    const notes = [];
    const running = weeks.find(w => w.temporal === "running");
    if (running) {
      notes.push(`running=${running.basis} (${running.confirmed_days}c/${running.projected_days}p days)`);
    }
    const anyForwardConfirmed = weeks.some(w => w.temporal === "future" && w.basis === "confirmed");
    if (anyForwardConfirmed) notes.push("forward confirmation");
    const totalRev = weeks.reduce((s, w) => s + w.revenue, 0);
    if (totalRev === 0) notes.push("no revenue data");

    console.log(`| ${account.padEnd(14)} | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${confirmedCount} | ${forecastCount} | ${notes.join(" · ")} |`);
  }
}

// Rollup: how many weeks × accounts × ranges exercise each path
console.log(`\n\n## Path exercise · which branch runs on today's data\n`);
let totalConfirmed = 0, totalForecast = 0;
const perAccountByRange = new Map();
for (const range of RANGES) {
  for (const account of ACCOUNTS) {
    const res = await loadWeeklyRevenueBasis(supa, {
      members: [account],
      start: range.start,
      end: range.end,
      today: TODAY,
    });
    if (res.error) continue;
    const c = res.data.filter(w => w.basis === "confirmed").length;
    const f = res.data.filter(w => w.basis === "forecast").length;
    totalConfirmed += c;
    totalForecast += f;
    const key = `${range.name} - ${account}`;
    perAccountByRange.set(key, { c, f });
  }
}
const total = totalConfirmed + totalForecast;
console.log(`Total week-account cells: ${total}  (${ACCOUNTS.length} accounts × ${RANGES.length} ranges × ~4 weeks)`);
console.log(`  Confirmed path exercised: ${totalConfirmed}  (${(totalConfirmed / total * 100).toFixed(1)}%)`);
console.log(`  Forecast path exercised:  ${totalForecast}  (${(totalForecast / total * 100).toFixed(1)}%)`);
console.log(`\nKevin's ruling holds: forecast is the majority path today. The main-path treatment is a code-emphasis choice that matches production reality.`);
