import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const wid = "6418e1e52a44e07c8b303f7b";
const attempts = await supa.from("academy_check_attempts").select("attempt_id, correct").eq("worker_id", wid);
const progress = await supa.from("academy_module_progress").select("requirement_id, time_spent_seconds").eq("worker_id", wid);
const atts = await supa.from("academy_attestations").select("requirement_id, signed_at").eq("worker_id", wid);
console.log("attempts:", attempts.data?.length, "correct:", attempts.data?.filter(a=>a.correct).length);
console.log("progress rows:", progress.data?.length, "total secs:", progress.data?.reduce((a,r)=>a+(r.time_spent_seconds||0),0));
console.log("attestations:", atts.data);
