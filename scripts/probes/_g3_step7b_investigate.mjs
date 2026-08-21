#!/usr/bin/env node
/* Investigate Dues & Subscriptions category mismatch, and the two unnamed cats. */

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Check purchasing_actuals totals by category (via raw join)
async function catActualsSum(cat) {
  // get raw external_ids for this cat, then find them in purchasing_actuals via source_line_id
  const { data: rawRows, error: e1 } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("external_id, rippling_id, amount")
    .eq("category_id", cat)
    .limit(2000);
  if (e1) throw e1;
  const externals = rawRows.map(r => r.external_id);
  // sum in purchasing_actuals
  let sum = 0; let count = 0; let excludedSum = 0; let excludedCount = 0;
  // paginate 100 at a time to avoid huge IN clause
  for (let i = 0; i < externals.length; i += 100) {
    const chunk = externals.slice(i, i + 100);
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("amount, excluded, source, source_line_id")
      .eq("source", "rippling_spend")
      .in("source_line_id", chunk);
    if (error) throw error;
    for (const r of data) {
      if (r.excluded) { excludedSum += Number(r.amount); excludedCount++; }
      else { sum += Number(r.amount); count++; }
    }
  }
  const rawSum = rawRows.reduce((a, r) => a + Number(r.amount), 0);
  return { rawSum, rawCount: rawRows.length, actualsNonExcludedSum: sum, actualsCount: count, actualsExcludedSum: excludedSum, actualsExcludedCount: excludedCount };
}

for (const cat of ["68ed4977b7aabd4234afda3a", "65aad3b6ecda651e1c45f971", "65aad3b6ecda651e1c45f981"]) {
  const r = await catActualsSum(cat);
  console.log(`\n${cat}:`);
  console.log(`  raw:               $${r.rawSum.toFixed(2)}  (${r.rawCount} rows)`);
  console.log(`  actuals non-excl:  $${r.actualsNonExcludedSum.toFixed(2)}  (${r.actualsCount} rows)`);
  console.log(`  actuals excluded:  $${r.actualsExcludedSum.toFixed(2)}  (${r.actualsExcludedCount} rows)`);
}

// Investigate the two categories with no CSV name
for (const cat of ["692f1cf10e3aaafc506fd705", "69154ddc92e0a2bc50ca6307"]) {
  const { data } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("category_id, merchant_name, amount, external_id, department_label, first_seen_at")
    .eq("category_id", cat)
    .limit(10);
  console.log(`\ncat=${cat} raw rows:`);
  for (const r of data) console.log("  ", JSON.stringify(r));
}
