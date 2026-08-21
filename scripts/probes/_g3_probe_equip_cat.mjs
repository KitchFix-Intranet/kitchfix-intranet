import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: scm } = await supa.from("spend_category_map").select("category_id").order("category_id");
console.log("scm cat_ids:", scm.length);
// Show all IDs (so we can see which ones map to Equipment via a re-run)
for (const r of scm) console.log(r.category_id);
