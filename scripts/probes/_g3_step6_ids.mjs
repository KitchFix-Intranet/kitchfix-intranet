#!/usr/bin/env node
/* Look at rippling_raw_spend_lines_latest columns / ids to find the join key. */
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await supa.from("rippling_raw_spend_lines_latest")
  .select("id, rippling_id, external_id, category_id, parent_txn_id, merchant_name, amount")
  .limit(5);
for (const r of data) console.log(JSON.stringify(r));

// Try to look one specific CSV txn up multiple ways
const t = "697956f35f94e1555c5c7038";
console.log("\nlookup CSV txn:", t);
for (const col of ["parent_txn_id", "rippling_id", "external_id"]) {
  const { data, error } = await supa.from("rippling_raw_spend_lines_latest").select("id, category_id").eq(col, t).limit(2);
  console.log(`  by ${col}: ${data?.length || 0} rows, err=${error?.code || "none"}`);
}
// also try substring of external_id
{
  const { data } = await supa.from("rippling_raw_spend_lines_latest").select("id, category_id, external_id").ilike("external_id", "%"+t+"%").limit(3);
  console.log(`  ilike external_id: ${data?.length || 0}`);
  for (const r of data || []) console.log("    ", JSON.stringify(r));
}
