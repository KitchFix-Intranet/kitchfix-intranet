#!/usr/bin/env node
// scripts/probes/_probe_sub_line_rollup_effect.mjs
//
// Kevin ruling 2026-09-17. Sub-lines roll up their children.
//
// Loads purchasing_actuals CY (P1-P9) and applies the rollup helper
// (src/lib/purchasing/glRollup.js) to every account × canonical sub-line
// pair. Prints before (exact match) / after (rollup) / delta so Kevin can
// verify the change measured from source, not predicted from spec.
//
// Not a PASS/FAIL gate. This is a one-shot verification probe run in
// the sub-line-rollup PR body. The helper it exercises is the same code
// path the Purchasing route + Overview resolver import.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_sub_line_rollup_effect.mjs

import { createClient } from "@supabase/supabase-js";
import { canonicalSubLine, isDescendantOfLine } from "../../src/lib/purchasing/glRollup.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FY_START = "2025-12-29";
const CY_END = "2026-09-06";

async function fetchAll(table, cols, filters = []) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + PS - 1);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PS) break;
    from += PS;
  }
  return out;
}

console.log("# sub-line rollup · effect matrix");
console.log("# rule: line's actual = every row whose code === line OR code starts with line + '.'");
console.log(`# range: ${FY_START} .. ${CY_END} (P1-P9)\n`);

const rows = await fetchAll("purchasing_actuals", "account_key, gl_line_code, amount", [
  (q) => q.eq("excluded", false),
  (q) => q.gte("txn_date", FY_START).lte("txn_date", CY_END),
  (q) => q.not("gl_line_code", "is", null),
]);
console.log(`purchasing_actuals rows loaded: ${rows.length}`);

// Every canonical sub-line under 3200/3400/3500 + 13xx families that
// has at least one raw code in the data.
const canonicalByAccount = new Map();  // account -> Set<canonical>
for (const r of rows) {
  const code = r.gl_line_code;
  if (typeof code !== "string") continue;
  if (!/^(3[245]00|13[0-9][0-9])\./.test(code)) continue;
  const canonical = canonicalSubLine(code);
  if (!canonical) continue;
  const s = canonicalByAccount.get(r.account_key) || new Set();
  s.add(canonical);
  canonicalByAccount.set(r.account_key, s);
}

const results = [];
for (const [account, lines] of canonicalByAccount) {
  for (const line of lines) {
    let exact = 0;
    let rolled = 0;
    for (const r of rows) {
      if (r.account_key !== account) continue;
      const code = r.gl_line_code;
      if (code === line) exact += Number(r.amount || 0);
      if (isDescendantOfLine(code, line)) rolled += Number(r.amount || 0);
    }
    if (Math.abs(rolled - exact) < 0.005) continue;
    results.push({
      account,
      sub_line: line,
      before: Math.round(exact * 100) / 100,
      after: Math.round(rolled * 100) / 100,
      delta: Math.round((rolled - exact) * 100) / 100,
    });
  }
}

results.sort((a, b) => a.account.localeCompare(b.account) || a.sub_line.localeCompare(b.sub_line));

const fmt = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad = (s, n) => String(s).padStart(n);

console.log("");
console.log("| account       | sub-line |       before |        after |           Δ |");
console.log("|---------------|----------|-------------:|-------------:|------------:|");
let totalDelta = 0;
for (const r of results) {
  totalDelta += r.delta;
  console.log(
    `| ${r.account.padEnd(13)} | ${r.sub_line.padEnd(8)} | ${pad(fmt(r.before), 12)} | ${pad(fmt(r.after), 12)} | ${pad("+" + fmt(r.delta), 11)} |`,
  );
}
console.log(`\ntotal Δ: +${fmt(totalDelta)}`);
console.log(`accounts affected: ${new Set(results.map(r => r.account)).size}`);
console.log(`sub-lines affected: ${results.length}`);
