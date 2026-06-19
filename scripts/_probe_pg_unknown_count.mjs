// Check tables that returned null count - confirm they exist + actual row count.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const tables = [
  "item_catalog",
  "invoice_verifications",
  "invoice_verifications_log",
  "catchweight_derivations_log",
  "vendor_master",
  "count_entries",
  "count_locations",
  "audit_log",
  "scan_audit",
  "events",
];

for (const t of tables) {
  // Try a plain select limit 1 first - establishes existence
  const { data, error } = await supa.from(t).select("*").limit(1);
  if (error) {
    console.log(`  ${t.padEnd(34)} ERROR: ${error.code} ${error.message.slice(0, 80)}`);
    continue;
  }
  // Now try count head:false (returns count via Content-Range)
  const { count, error: cErr } = await supa.from(t).select("*", { count: "exact", head: false }).limit(1);
  if (cErr) {
    console.log(`  ${t.padEnd(34)} EXISTS, count err: ${cErr.message.slice(0, 80)}`);
  } else {
    console.log(`  ${t.padEnd(34)} EXISTS, count=${count}, sample_keys=${Object.keys(data?.[0] || {}).slice(0, 8).join(",")}`);
  }
}
