// READ-ONLY: enumerate all FK relationships involving the 11 wipe tables.
// Plus inspect triggers + relationships of document_* tables.
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
const DOC_TABLES = ["documents","document_chunks","document_issues","document_relationships","document_surfaces"];

// Supabase doesn't auto-expose pg_catalog tables, but does usually expose
// information_schema views. Try those first.
async function trySelect(table, cols) {
  const { data, error } = await supa.from(table).select(cols).limit(1);
  return { ok: !error, error: error?.message };
}

console.log("Probing introspection access...");
const probes = [
  await trySelect("information_schema.table_constraints", "constraint_name"),
  await trySelect("information_schema.referential_constraints", "constraint_name"),
];
for (const [i, p] of probes.entries()) {
  console.log(`  probe ${i}: ${p.ok ? "ok" : p.error?.slice(0, 80)}`);
}
console.log("");
console.log("If information_schema not exposed, paste this SQL in Studio for FK map:");
console.log("");
console.log("─── SQL: all FKs involving the 11 wipe + 5 document tables ───");
const allOfInterest = [...WIPE_TABLES, ...DOC_TABLES];
const tableList = allOfInterest.map((t) => `'${t}'`).join(", ");
console.log(`
SELECT
  tc.table_name      AS from_table,
  kcu.column_name    AS from_column,
  ccu.table_name     AS to_table,
  ccu.column_name    AS to_column,
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema   = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema   = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (tc.table_name IN (${tableList}) OR ccu.table_name IN (${tableList}))
ORDER BY tc.table_name, tc.constraint_name;
`);
console.log("─── SQL: triggers on the 11 wipe tables ───");
console.log(`
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing      AS timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN (${WIPE_TABLES.map((t) => `'${t}'`).join(", ")})
ORDER BY event_object_table, trigger_name;
`);
console.log("─── SQL: views that reference the 11 wipe tables ───");
console.log(`
SELECT DISTINCT
  v.table_name AS view_name,
  d.refobjid::regclass::text AS depends_on
FROM pg_views v
JOIN pg_class c ON c.relname = v.table_name AND c.relkind = 'v'
JOIN pg_rewrite r ON r.ev_class = c.oid
JOIN pg_depend d ON d.objid = r.oid AND d.refobjsubid > 0
WHERE v.schemaname = 'public'
  AND d.refobjid::regclass::text IN (${WIPE_TABLES.map((t) => `'${t}'`).join(", ")})
ORDER BY v.table_name, d.refobjid::regclass::text;
`);
