// READ-ONLY: count is_historical=TRUE vs FALSE per table; flag tables that
// don't have the column.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const WIPE_TABLES = [
  "ai_line_items","invoice_submissions","invoice_rejections",
  "inventory_items","item_aliases","price_history","review_queue",
  "merge_history","merge_history_items","count_sessions","count_items",
];

console.log("Per-table is_historical + data_provenance state:");
console.log("");
console.log(`  ${"Table".padEnd(22)} ${"total".padStart(7)}  ${"is_hist=T".padStart(10)}  ${"is_hist=F".padStart(10)}  ${"prov".padStart(20)}  has_col`);
console.log(`  ${"─".repeat(22)}  ${"─".repeat(7)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(20)}  ${"─".repeat(8)}`);

for (const t of WIPE_TABLES) {
  const { count: total } = await supa.from(t).select("*", { count: "exact", head: true });

  // Try is_historical
  const { count: histTrue, error: histErr } = await supa.from(t).select("*", { count: "exact", head: true }).eq("is_historical", true);
  const { count: histFalse } = await supa.from(t).select("*", { count: "exact", head: true }).eq("is_historical", false);

  let provSummary = "";
  if (!histErr) {
    // Pull distinct data_provenance values + counts
    const { data: provRows, error: provErr } = await supa.from(t).select("data_provenance").limit(1000);
    if (provErr) {
      provSummary = "(no col)";
    } else {
      const counts = new Map();
      for (const r of provRows || []) counts.set(r.data_provenance, (counts.get(r.data_provenance) || 0) + 1);
      provSummary = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(",").slice(0, 19) || "(empty)";
    }
  }

  const hasCol = !histErr ? "yes" : "NO";
  console.log(`  ${t.padEnd(22)} ${String(total ?? "?").padStart(7)}  ${histErr ? "n/a".padStart(10) : String(histTrue).padStart(10)}  ${histErr ? "n/a".padStart(10) : String(histFalse).padStart(10)}  ${provSummary.padStart(20)}  ${hasCol}`);
}
