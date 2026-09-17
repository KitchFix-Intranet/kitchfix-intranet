// Harmless connectivity check for FIN-2027 W0. SELECT count only.
// run: node --env-file=.env.local scripts/_probe_fin2027_db_connect.mjs

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { count, error } = await supabase
  .from("kpi_lines")
  .select("*", { count: "exact", head: true });

if (error) {
  console.error("FAIL:", error.message);
  process.exit(2);
}
console.log(`PASS · kpi_lines row count: ${count}`);
