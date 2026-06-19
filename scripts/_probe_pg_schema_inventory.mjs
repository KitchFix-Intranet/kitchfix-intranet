// READ-ONLY enumeration of live PG tables + row counts.
// Used to scope the planned invoice/inventory wipe.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Pull the live table list from information_schema via RPC if available,
// else fall back to a hardcoded probe of every known table name.
// We know from the migration arc which tables exist; we'll just enumerate.
const knownTables = [
  // ─── INVOICE DOMAIN ────────────────────────────────────────────────
  "invoice_submissions",
  "invoice_rejections",
  "ai_line_items",
  "gl_codes",

  // ─── INVENTORY DOMAIN (cron + intranet shared) ─────────────────────
  "item_catalog",
  "inventory_items",
  "item_aliases",
  "price_history",
  "review_queue",
  "merge_history",
  "merge_history_items",
  "invoice_verifications",
  "invoice_verifications_log",
  "catchweight_derivations_log",

  // ─── VENDOR DOMAIN (shared - DO NOT WIPE) ──────────────────────────
  "vendors",
  "vendor_master",
  "vendor_aliases",
  "vendor_accounts",

  // ─── ACCOUNTS / CONTACTS / SUBMISSIONS / LOCATIONS (DO NOT WIPE) ──
  "accounts",
  "contacts",
  "submissions",
  "work_locations",
  "storage_locations",
  "hero_images",
  "news_interactions",
  "count_sessions",
  "count_entries",
  "count_items",
  "count_locations",

  // ─── OTHER (DO NOT WIPE) ───────────────────────────────────────────
  "audit_log",
  "scan_audit",
  "events",
];

console.log("Live PG tables - row counts (read-only):");
console.log("");
const out = [];
for (const t of knownTables) {
  const { count, error } = await supa.from(t).select("*", { count: "exact", head: true });
  if (error) {
    out.push({ table: t, count: null, status: error.code === "PGRST205" ? "(not in PG)" : `ERR: ${error.message.slice(0, 60)}` });
  } else {
    out.push({ table: t, count, status: "ok" });
  }
}
// pretty print
for (const r of out) {
  const cnt = r.count === null ? r.status : String(r.count).padStart(8);
  console.log("  " + r.table.padEnd(34) + " " + cnt + (r.status === "ok" ? "" : "  " + r.status));
}
