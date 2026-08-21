import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// look at 10 rows for cat 68ed4977 - what's their external_id shape?
const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id, merchant_name").eq("category_id", "68ed4977b7aabd4234afda3a").limit(10);
for (const r of data) console.log(r.external_id.slice(0, 100), "  ", r.merchant_name);

console.log("");
// look at 10 rows for a "clean" cat with parseable name
const { data: d2 } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id").eq("category_id", "65aad3b6ecda651e1c45f95d").limit(3);
for (const r of d2) console.log(r.external_id.slice(0, 100));

// Where's the CSV txn 6a7d396952d716be9225cf83 in the DB (any way)?
console.log("\nchecking 6a7d396952d716be9225cf83:");
const { data: d3 } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id").ilike("external_id", "%6a7d396952d716be9225cf83%").limit(5);
console.log("found:", d3?.length);
for (const r of d3 || []) console.log("  cat=", r.category_id, " ext=", r.external_id.slice(0, 120));
