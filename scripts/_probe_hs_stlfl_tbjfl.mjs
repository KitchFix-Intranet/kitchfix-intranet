// PROBE (read-only): what STL-FL and TBJ-FL rows look like in
// sc_homestand_schedule. Prior probe showed 66 rows each despite
// has_homestand_schedule = false.
//
//   node --env-file=.env.local scripts/_probe_hs_stlfl_tbjfl.mjs

import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

for (const acct of ["STL - FL", "TBJ - FL"]) {
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, homestand_id, game_pk")
    .eq("account_key", acct)
    .order("service_date", { ascending: true });
  if (error) { console.error(acct, error.message); continue; }
  const dt = new Map();
  for (const r of data) dt.set(r.day_type, (dt.get(r.day_type) || 0) + 1);
  const withId = data.filter(r => r.homestand_id && String(r.homestand_id).trim());
  console.log(`${acct}`);
  console.log(`  rows: ${data.length}`);
  console.log(`  day_type distribution: ${[...dt.entries()].map(([k,v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  rows with non-empty homestand_id: ${withId.length}`);
  console.log(`  date range: ${data[0]?.service_date} .. ${data[data.length-1]?.service_date}`);
  console.log(`  sample first 3: ${data.slice(0,3).map(r => `${r.service_date}/${r.day_type}/${r.opponent}/hs=${r.homestand_id || "(none)"}`).join(" ")}`);
  console.log("");
}
