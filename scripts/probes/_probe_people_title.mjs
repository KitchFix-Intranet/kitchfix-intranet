import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const q = await supa.from("people").select("worker_id, display_name, title, account_key").eq("worker_id", "6418e1e52a44e07c8b303f7b").maybeSingle();
if (q.error) console.log("err:", q.error.message);
else console.log("row:", JSON.stringify(q.data, null, 2));
