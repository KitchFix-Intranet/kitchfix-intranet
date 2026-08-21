#!/usr/bin/env node
/* How do source_line_id in purchasing_actuals relate to the raw
   external_id / rippling_id? */
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data } = await supa.from("purchasing_actuals")
  .select("id, source, source_bill_id, source_line_id, amount, excluded, vendor_or_merchant")
  .eq("source", "rippling_spend")
  .eq("excluded", false)
  .limit(5);
for (const r of data) console.log(JSON.stringify(r));

// distribution: what does source_line_id look like for rippling_spend rows?
const { data: d2 } = await supa.from("purchasing_actuals")
  .select("source_line_id, source_bill_id, amount")
  .eq("source", "rippling_spend")
  .limit(5);
console.log("\n5 rippling_spend rows:");
for (const r of d2) console.log("  ", JSON.stringify(r));
