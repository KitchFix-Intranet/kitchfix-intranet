import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const c = "65aad3b6ecda651e1c45f987";
const { data: scm } = await supa.from("spend_category_map").select("*").eq("category_id", c);
console.log("scm:", JSON.stringify(scm[0], null, 2));
const { data: raw } = await supa.from("rippling_raw_spend_lines_latest").select("id, merchant_name, amount").eq("category_id", c).limit(5);
console.log("raw sample:", raw);
const { count } = await supa.from("rippling_raw_spend_lines_latest").select("*", { count: "exact", head: true }).eq("category_id", c);
console.log("raw count:", count);
