// PROBE (read-only): accounts table current state - billing_model +
// has_homestand_schedule + covered_by. Sanity-check the deep-dive
// contradictions.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data, error } = await supa
  .from("accounts")
  .select("*")
  .order("team_key", { ascending: true });
if (error) { console.error(error.message); process.exit(1); }

console.log(`accounts row count: ${data.length}\n`);
console.log(`columns: ${Object.keys(data[0]).join(", ")}\n`);

for (const r of data) {
  console.log(`${(r.team_key || "").padEnd(15)} bm=${(r.billing_model||"").padEnd(28)} hs=${r.has_homestand_schedule ? "T" : "f"}  level=${r.level || ""}${r.covered_by ? "  covered_by=" + r.covered_by : ""}`);
}
