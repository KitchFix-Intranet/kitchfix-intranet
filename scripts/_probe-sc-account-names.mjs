// READ-ONLY: dump accounts.name for the 11 SC accounts so we can
// confirm that what the UI shows next to the team_key is a proper
// display name (e.g. "Cincinnati Reds - Arizona Complex") and not
// just the key echoed back.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data, error } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model, active")
    .order("team_key", { ascending: true });
  if (error) throw new Error(error.message);

  const keysOfInterest = ["CIN - AZ", "CIN - OH"];
  console.log("=== accounts (PG) - all rows ===");
  console.log("team_key                     | name                                 | level | billing  | active");
  console.log("-----------------------------+--------------------------------------+-------+----------+-------");
  for (const a of data) {
    const flag = keysOfInterest.includes(a.team_key) ? "  <-- target" : "";
    console.log(
      `${(a.team_key || "").padEnd(28)} | ${(a.name || "").padEnd(36)} | ${(a.level || "").padEnd(5)} | ${(a.billing_model || "").padEnd(8)} | ${a.active}${flag}`
    );
  }

  console.log("\n=== targets only ===");
  for (const key of keysOfInterest) {
    const row = data.find((a) => a.team_key === key);
    if (!row) { console.log(`${key}: NOT FOUND`); continue; }
    const fallback = row.name === row.team_key || !row.name;
    console.log(`${key}:`);
    console.log(`  name        = ${JSON.stringify(row.name)}`);
    console.log(`  same as key = ${row.name === row.team_key}`);
    console.log(`  empty/null  = ${!row.name}`);
    console.log(`  -> UI shows = "${row.team_key} - ${row.name || row.team_key}"  ${fallback ? "(degenerate)" : "(distinct)"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
