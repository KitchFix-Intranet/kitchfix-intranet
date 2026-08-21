import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Get all PG rows with created_at >= 2026-06-10
const { data: lateRows } = await supa.from("ai_line_items")
  .select("account_key, vendor_name, invoice_number, created_at, invoice_uuid")
  .gte("created_at", "2026-06-09T18:00:00Z")
  .order("created_at", { ascending: false });
console.log("PG rows with created_at >= 2026-06-09 18:00 UTC: " + (lateRows?.length || 0));

const byDay = new Map();
for (const r of lateRows || []) {
  const d = String(r.created_at).slice(0, 10);
  byDay.set(d, (byDay.get(d) || 0) + 1);
}
console.log("By day:");
for (const [d, c] of [...byDay.entries()].sort()) console.log("  " + d + " : " + c);
