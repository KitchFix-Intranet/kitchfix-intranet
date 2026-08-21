#!/usr/bin/env node
/* G3 3b: verify balance target, find TBR-FL account_key, look at
   spend_category_map contents. */

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// find distinct account_keys
const acctSet = new Set();
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("purchasing_actuals").select("account_key").order("id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) acctSet.add(r.account_key || "<null>");
    if (data.length < step) break;
    from += step;
  }
}
console.log("distinct account_keys:", [...acctSet].sort());

// balance target check for card-only
async function sumAmount(filter) {
  let sum = 0; let from = 0; const step = 1000;
  while (true) {
    let q = supa.from("purchasing_actuals").select("amount").order("id").range(from, from + step - 1);
    q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) sum += Number(r.amount || 0);
    if (data.length < step) break;
    from += step;
  }
  return sum;
}
const cardExcl = await sumAmount(q => q.eq("source", "rippling_spend").eq("excluded", true));
const cardNonExcl = await sumAmount(q => q.eq("source", "rippling_spend").eq("excluded", false));
console.log(`\nCARD (rippling_spend): excl=$${cardExcl.toFixed(2)} + non-excl=$${cardNonExcl.toFixed(2)} = $${(cardExcl + cardNonExcl).toFixed(2)}`);
console.log("(spec balance target: $2,482,310.31)");

// spend_category_map contents
const scm = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("spend_category_map").select("category_id, category_label, gl_line_code, merchant_sample, first_seen_at").order("category_id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    scm.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
console.log(`\nspend_category_map has ${scm.length} rows`);
console.log("First 5:");
for (const r of scm.slice(0, 5)) {
  console.log(`  ${r.category_id} | "${r.category_label}" | merchant="${r.merchant_sample}"`);
}

// sentinel: TBR FL, P8, 3200.1 billcom
// Find the tbr-fl-like key first
for (const ak of [...acctSet]) {
  if (ak.toLowerCase().includes("tbr") || ak.toLowerCase().includes("fl")) console.log("account_key candidate:", ak);
}
