// FIN-2027 W5 · Schema check on pnl_actuals + related tables.
// READ ONLY.

import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Sample a pnl_actuals row for schema visibility
const r = await s.from("pnl_actuals").select("*").limit(2);
if (r.error) { console.error(r.error); process.exit(1); }
console.log("=== pnl_actuals sample rows ===");
for (const row of r.data) console.log(JSON.stringify(row, null, 2));

// Show every distinct column via a keys probe
const one = await s.from("pnl_actuals").select("*").limit(1).maybeSingle();
if (one.data) console.log("\ncolumns:", Object.keys(one.data).join(", "));

// Look at what other pnl / actuals / kpi tables exist
console.log("\n=== related tables ===");
for (const name of ["pnl_lines", "pnl_actuals_by_line", "pnl_actuals_view",
                    "kpi_pnl_actuals", "finance_actuals", "period_actuals",
                    "budget_actuals", "kpi_pnl", "pnl_summary"]) {
  const t = await s.from(name).select("*", { count: "exact", head: true });
  if (!t.error) console.log(`  ${name}: ${t.count} rows`);
}
