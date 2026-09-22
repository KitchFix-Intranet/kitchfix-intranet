#!/usr/bin/env node
// R-147 · P10 before-and-after table, all 11 accounts. This is what
// Kevin approves before merge.
//
// Before = board pre-R-147 · direct read of purchasing_actuals filtered
//          to non-rippling + COGS-prefix (what the P&L board rendered
//          before this PR landed).
// After  = board post-R-147 · R-147 paginateActuals filtered to
//          non-rippling + COGS-prefix.
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_r147_p10_deltas.mjs

import { createClient } from "@supabase/supabase-js";
import { paginateActuals, IN_CHUNK, V6_PAGE_DEFAULT, chunk } from "../../src/lib/purchasing/loaders.js";
import { periodStartISO, periodEndISO } from "../../src/app/kpi/labor/lib/periods.js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MEMBERS = ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ","STL - FL","STL - MO","CIN - KY","CIN - OH","TXR - TX - H","TXR - TX - V","TBJ - NY"];
const COGS = (gl) => typeof gl === "string" && (gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500"));
const round2 = n => Math.round(Number(n || 0) * 100) / 100;
const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const start = periodStartISO(10);
const end = periodEndISO(10);

// BEFORE: direct read of purchasing_actuals invoice-side.
async function boardBefore(acct) {
  let sum = 0, rows = 0;
  for (const memberChunk of chunk([acct], IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await s.from("purchasing_actuals")
        .select("gl_line_code, amount, source")
        .in("account_key", memberChunk)
        .neq("source", "rippling_spend")
        .eq("excluded", false)
        .gte("txn_date", start).lte("txn_date", end)
        .range(from, from + V6_PAGE_DEFAULT - 1);
      if (q.error) throw q.error;
      for (const r of q.data || []) {
        if (!COGS(r.gl_line_code)) continue;
        sum += Number(r.amount || 0); rows += 1;
      }
      if ((q.data || []).length < V6_PAGE_DEFAULT) break;
      from += V6_PAGE_DEFAULT;
    }
  }
  return { sum: round2(sum), rows };
}

// AFTER: R-147 paginateActuals invoice-side.
async function boardAfter(acct) {
  const r = await paginateActuals(s, { members: [acct], start, end, includeLines: true });
  if (r.error) throw r.error;
  let sum = 0, rows = 0;
  for (const row of r.data) {
    if (row.source === "rippling_spend") continue;
    if (!COGS(row.gl_line_code)) continue;
    sum += Number(row.amount || 0); rows += 1;
  }
  return { sum: round2(sum), rows };
}

console.log(`R-147 · P10 board invoice-side COGS · before vs after cutover`);
console.log(`P10: ${start} .. ${end}`);
console.log();
console.log(`| Account         | Before (bill.com)       | After (R-147)           | Δ dollars   | Δ %       | Reason                        |`);
console.log(`|-----------------|-------------------------|-------------------------|-------------|-----------|-------------------------------|`);
const reasons = {
  "TBJ - FL":     "capture on",
  "TBR - FL":     "capture on",
  "CIN - AZ":     "capture on",
  "TXR - AZ":     "capture on",
  "STL - FL":     "capture on (COGS-prefix small; STL bulk in reimb 1385)",
  "STL - MO":     "capture on (COGS-prefix ≈0; STL bulk in reimb 1385)",
  "CIN - KY":     "bill.com retained",
  "CIN - OH":     "capture on (mostly reimb 1374)",
  "TXR - TX - H": "capture on",
  "TXR - TX - V": "capture on",
  "TBJ - NY":     "bill.com retained",
};
let totalBefore = 0, totalAfter = 0;
for (const acct of MEMBERS) {
  const b = await boardBefore(acct);
  const a = await boardAfter(acct);
  totalBefore += b.sum; totalAfter += a.sum;
  const delta = round2(a.sum - b.sum);
  const pct = b.sum === 0 ? (a.sum === 0 ? "0.00%" : "n/a") : ((delta / b.sum) * 100).toFixed(2) + "%";
  const bStr = `${fmt$(b.sum)} (${b.rows} rows)`;
  const aStr = `${fmt$(a.sum)} (${a.rows} rows)`;
  console.log(`| ${acct.padEnd(15)} | ${bStr.padEnd(23)} | ${aStr.padEnd(23)} | ${fmt$(delta).padStart(11)} | ${pct.padStart(9)} | ${reasons[acct]}`);
}
console.log(`| ${"TOTAL".padEnd(15)} | ${fmt$(totalBefore).padEnd(23)} | ${fmt$(totalAfter).padEnd(23)} | ${fmt$(round2(totalAfter - totalBefore)).padStart(11)} | ${totalBefore === 0 ? "n/a" : (((totalAfter - totalBefore) / totalBefore) * 100).toFixed(2) + "%"}                        |`);
