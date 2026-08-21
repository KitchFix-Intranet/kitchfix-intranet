#!/usr/bin/env node
/* Compute per-category card totals in purchasing_actuals by joining
   through raw rippling_id. Output: JSON with category_id -> {
     non_excl_sum, excl_sum, non_excl_count, excl_count
   } and per-account_key breakdown. */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Pull all rippling raw rows: id, rippling_id, category_id
const rawByRippId = new Map(); // rippling_id -> category_id
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id, category_id").order("id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) rawByRippId.set(r.rippling_id, r.category_id);
    if (data.length < step) break;
    from += step;
  }
}
process.stderr.write(`raw rippling_id -> category map: ${rawByRippId.size}\n`);

// Pull all purchasing_actuals for rippling_spend source
const actuals = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("purchasing_actuals")
      .select("source_line_id, amount, excluded, account_key")
      .eq("source", "rippling_spend")
      .order("id")
      .range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    actuals.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
process.stderr.write(`purchasing_actuals (rippling_spend): ${actuals.length}\n`);

// Aggregate
const byCat = new Map();  // cat_id -> { non_excl_sum, excl_sum, non_excl_count, excl_count, by_acct: Map<acct, {sum, count}> }
let unlinked = { count: 0, sum: 0 };
for (const r of actuals) {
  const rippId = r.source_line_id.replace(/^rippling_spend:/, "");
  const cat = rawByRippId.get(rippId);
  if (!cat) { unlinked.count++; unlinked.sum += Number(r.amount); continue; }
  if (!byCat.has(cat)) byCat.set(cat, { non_excl_sum: 0, excl_sum: 0, non_excl_count: 0, excl_count: 0, by_acct: new Map() });
  const g = byCat.get(cat);
  const amt = Number(r.amount);
  if (r.excluded) { g.excl_sum += amt; g.excl_count++; }
  else {
    g.non_excl_sum += amt; g.non_excl_count++;
    const acct = r.account_key || "<null>";
    if (!g.by_acct.has(acct)) g.by_acct.set(acct, { sum: 0, count: 0 });
    const a = g.by_acct.get(acct); a.sum += amt; a.count++;
  }
}
process.stderr.write(`unlinked actuals rows: ${unlinked.count}, sum=$${unlinked.sum.toFixed(2)}\n`);

// Write out
const out = { unlinked, per_category: {} };
for (const [cat, g] of byCat) {
  out.per_category[cat] = {
    non_excl_sum: g.non_excl_sum, excl_sum: g.excl_sum,
    non_excl_count: g.non_excl_count, excl_count: g.excl_count,
    by_acct: Object.fromEntries(g.by_acct),
  };
}
fs.writeFileSync("/tmp/g3_actuals_by_cat.json", JSON.stringify(out, null, 2));

// print top 20 by non_excl_sum
const sorted = [...byCat.entries()].sort((a, b) => b[1].non_excl_sum - a[1].non_excl_sum);
console.log(`cat_id                              | non_excl_$    | excl_$        | non_excl_ct | excl_ct`);
for (const [cat, g] of sorted) {
  console.log(`${cat} | ${("$" + g.non_excl_sum.toFixed(2)).padStart(13)} | ${("$" + g.excl_sum.toFixed(2)).padStart(13)} | ${String(g.non_excl_count).padStart(11)} | ${g.excl_count}`);
}

// grand totals
const tNe = sorted.reduce((a, [_, g]) => a + g.non_excl_sum, 0);
const tE = sorted.reduce((a, [_, g]) => a + g.excl_sum, 0);
console.log(`\n GRAND: non_excl=$${tNe.toFixed(2)}  excl=$${tE.toFixed(2)}  total=$${(tNe + tE).toFixed(2)}`);
