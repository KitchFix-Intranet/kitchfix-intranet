// _probe-service-catalog.mjs (throwaway, feat/sous-portfolio-tool 2026-08-04)
// Probe distinct service_name + group_name in sc_daily_revenue to decide
// the serviceType mapping for the portfolio tool. Kevin's spec: "resolve
// the type against the service catalog rather than string-matching user
// text - if the catalog has no clean type column, [ran] a probe of the
// distinct service names, report what you find, and propose the mapping
// rather than inventing one."
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE env missing");
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from("sc_daily_revenue")
  .select("service_name, group_name")
  .not("service_name", "is", null)
  .limit(20000);
if (error) throw error;

const byName = new Map();
const byGroup = new Map();
for (const r of rows) {
  const n = r.service_name;
  const g = r.group_name || "(null)";
  byName.set(n, (byName.get(n) || 0) + 1);
  byGroup.set(g, (byGroup.get(g) || 0) + 1);
}

console.log("=== distinct service_name (with row count) ===");
const nameRows = [...byName.entries()].sort((a, b) => b[1] - a[1]);
console.log(`total distinct: ${nameRows.length}`);
for (const [name, ct] of nameRows) console.log(`  ${String(ct).padStart(6)} · ${name}`);

console.log("\n=== distinct group_name (with row count) ===");
const groupRows = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
console.log(`total distinct: ${groupRows.length}`);
for (const [name, ct] of groupRows) console.log(`  ${String(ct).padStart(6)} · ${name}`);

// Try to fetch a services catalog table if it exists.
console.log("\n=== sc_services catalog ===");
const { data: svcs, error: svcErr } = await sb
  .from("sc_services")
  .select("id, service_name, group_name, account_key")
  .limit(200);
if (svcErr) console.log(`  (no sc_services table or fetch failed: ${svcErr.message})`);
else {
  console.log(`  total rows: ${svcs.length}`);
  const catNames = new Set(svcs.map((s) => s.service_name));
  const catGroups = new Set(svcs.map((s) => s.group_name));
  console.log(`  distinct catalog service names: ${catNames.size}`);
  console.log(`  distinct catalog group names: ${catGroups.size}`);
}
