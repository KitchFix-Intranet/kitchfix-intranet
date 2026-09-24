// FIN-2027 W5 · accounts table schema + existing rows. READ ONLY.
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const r = await s.from("accounts").select("*").order("team_key");
if (r.error) { console.error(r.error); process.exit(1); }
console.log(`=== accounts · ${r.data.length} rows ===`);
if (r.data[0]) console.log("columns:", Object.keys(r.data[0]).join(", "));
console.log();
for (const row of r.data) {
  console.log(JSON.stringify(row));
}

// Confirm CORP exists
const c = r.data.find(x => x.team_key === "CORP");
console.log("\nCORP exists:", !!c);
if (c) console.log("CORP row:", JSON.stringify(c, null, 2));

// Confirm CIN - FL and CHI - IL do NOT exist yet
for (const k of ["CIN - FL", "CHI - IL"]) {
  console.log(`${k} exists:`, !!r.data.find(x => x.team_key === k));
}

// pnl_tab_name column present?
const hasTab = r.data.length > 0 && "pnl_tab_name" in r.data[0];
console.log(`pnl_tab_name column present: ${hasTab}`);
