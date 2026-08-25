// Tiny sanity probe: presence + reachability. No values echoed.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
if (!url || !key) process.exit(1);
console.log(`url length: ${url.length}, key length: ${key.length}`);
try {
  const supa = createClient(url, key, { auth: { persistSession: false } });
  const q = await supa.from("kpi_budgets").select("account_key", { count: "exact", head: true });
  console.log(`ping status: ${q.error ? "ERR " + q.error.message : "OK count=" + q.count}`);
} catch (e) {
  console.log(`ping THREW: ${e.message}`);
  console.log(`cause: ${e.cause?.message || "n/a"}`);
}
