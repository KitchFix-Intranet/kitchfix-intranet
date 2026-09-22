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

// BEFORE: direct read of purchasing_actuals invoice-side (all buckets:
// COGS + reimbursable + SG&A + everything the operator captured).
// This matches Kevin's brief numbers, which are total-invoice not
// COGS-only.
async function boardBefore(acct) {
  let sumAll = 0, sumCogs = 0, rowsAll = 0;
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
        sumAll += Number(r.amount || 0); rowsAll += 1;
        if (COGS(r.gl_line_code)) sumCogs += Number(r.amount || 0);
      }
      if ((q.data || []).length < V6_PAGE_DEFAULT) break;
      from += V6_PAGE_DEFAULT;
    }
  }
  return { sumAll: round2(sumAll), sumCogs: round2(sumCogs), rows: rowsAll };
}

// AFTER: R-147 paginateActuals invoice-side (all buckets).
async function boardAfter(acct) {
  const r = await paginateActuals(s, { members: [acct], start, end, includeLines: true });
  if (r.error) throw r.error;
  let sumAll = 0, sumCogs = 0, rowsAll = 0;
  for (const row of r.data) {
    if (row.source === "rippling_spend") continue;
    sumAll += Number(row.amount || 0); rowsAll += 1;
    if (COGS(row.gl_line_code)) sumCogs += Number(row.amount || 0);
  }
  return { sumAll: round2(sumAll), sumCogs: round2(sumCogs), rows: rowsAll };
}

console.log(`R-147 · P10 board invoice-side · before vs after cutover`);
console.log(`P10: ${start} .. ${end}`);
console.log(`"Total" = every non-card gl_line_code (COGS + reimbursable + SG&A). "COGS" = the 32/34/35 subset.`);
console.log();
console.log(`| Account         | Before total       | After total        | Δ total     | Before COGS  | After COGS   | Reason                        |`);
console.log(`|-----------------|--------------------|--------------------|-------------|--------------|--------------|-------------------------------|`);
const reasons = {
  "TBJ - FL":     "capture on",
  "TBR - FL":     "capture on",
  "CIN - AZ":     "capture on",
  "TXR - AZ":     "capture on",
  "STL - FL":     "capture on (bulk in reimb 1385)",
  "STL - MO":     "capture on (bulk in reimb 1385)",
  "CIN - KY":     "bill.com retained",
  "CIN - OH":     "capture on (bulk in reimb 1374)",
  "TXR - TX - H": "capture on",
  "TXR - TX - V": "capture on",
  "TBJ - NY":     "bill.com retained",
};
let totalBeforeAll = 0, totalAfterAll = 0, totalBeforeCogs = 0, totalAfterCogs = 0;
for (const acct of MEMBERS) {
  const b = await boardBefore(acct);
  const a = await boardAfter(acct);
  totalBeforeAll += b.sumAll; totalAfterAll += a.sumAll;
  totalBeforeCogs += b.sumCogs; totalAfterCogs += a.sumCogs;
  const deltaAll = round2(a.sumAll - b.sumAll);
  console.log(`| ${acct.padEnd(15)} | ${fmt$(b.sumAll).padStart(18)} | ${fmt$(a.sumAll).padStart(18)} | ${fmt$(deltaAll).padStart(11)} | ${fmt$(b.sumCogs).padStart(12)} | ${fmt$(a.sumCogs).padStart(12)} | ${reasons[acct]}`);
}
console.log(`| ${"TOTAL".padEnd(15)} | ${fmt$(totalBeforeAll).padStart(18)} | ${fmt$(totalAfterAll).padStart(18)} | ${fmt$(round2(totalAfterAll - totalBeforeAll)).padStart(11)} | ${fmt$(totalBeforeCogs).padStart(12)} | ${fmt$(totalAfterCogs).padStart(12)} |`);
