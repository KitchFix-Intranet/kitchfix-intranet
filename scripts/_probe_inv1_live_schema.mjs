// INV-1 live schema recon - READ-ONLY.
// Map the actual PG state for every inventory table + flag splits vs
// the inv-1-smart-inventory-schema.sql migration intent.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGETS = [
  "inventory_items", "item_catalog", "item_aliases", "price_history",
  "review_queue", "ai_line_items", "vendors", "vendor_master", "vendor_aliases",
  "invoice_submissions", "count_sessions", "count_items", "storage_locations",
  "merge_history", "merge_history_items", "zone_corrections",
];

async function execSql(sql) {
  const { data, error } = await sb.rpc("exec_sql", { sql });
  if (error) throw new Error(error.message);
  return data;
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.0 - which target tables EXIST in public schema");
console.log("═══════════════════════════════════════════════════════════════");
const existsSql = `
  SELECT table_name
    FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name = ANY($1::text[])
   ORDER BY table_name;
`.trim();

let existing;
try {
  existing = await execSql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${TARGETS.map((t) => `'${t}'`).join(",")}) ORDER BY table_name`
  );
} catch (e) {
  console.log("exec_sql failed: " + e.message);
  console.log("Falling back to per-table probe...");
  existing = [];
  for (const t of TARGETS) {
    const { error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (!error) existing.push({ table_name: t });
    else if (error.code === "42P01") { /* table missing */ }
    else console.log("  " + t + " probe error: " + error.message + " (code=" + error.code + ")");
  }
}
const existingSet = new Set(existing.map((r) => r.table_name));
for (const t of TARGETS) {
  console.log("  " + (existingSet.has(t) ? "✓" : "✗") + " " + t);
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.1 - full column lists per existing table");
console.log("═══════════════════════════════════════════════════════════════");
for (const t of [...existingSet].sort()) {
  console.log();
  console.log("── " + t + " ──");
  try {
    const cols = await execSql(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, is_generated, generation_expression
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='${t}'
        ORDER BY ordinal_position`
    );
    for (const c of (cols || [])) {
      const type = c.udt_name && c.udt_name !== c.data_type ? `${c.data_type} (${c.udt_name})` : c.data_type;
      const len = c.character_maximum_length ? `(${c.character_maximum_length})` : "";
      const nul = c.is_nullable === "YES" ? "NULL" : "NOT NULL";
      const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
      const gen = c.is_generated === "ALWAYS" ? ` GENERATED ALWAYS AS (${c.generation_expression}) STORED` : "";
      console.log("  " + c.column_name + " " + type + len + " " + nul + def + gen);
    }
  } catch (e) {
    console.log("  ERROR reading columns: " + e.message);
  }
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.2 - PKs, FKs, UNIQUE, CHECK per existing table");
console.log("═══════════════════════════════════════════════════════════════");
for (const t of [...existingSet].sort()) {
  console.log();
  console.log("── " + t + " ──");
  try {
    const cons = await execSql(
      `SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid, true) AS def
         FROM pg_constraint con
         JOIN pg_class cls ON cls.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = cls.relnamespace
        WHERE n.nspname='public' AND cls.relname='${t}'
        ORDER BY con.contype, con.conname`
    );
    for (const c of (cons || [])) {
      const typeLabel = { p: "PK", f: "FK", u: "UNIQUE", c: "CHECK" }[c.type] || c.type;
      console.log("  [" + typeLabel + "] " + c.name + ": " + c.def);
    }
  } catch (e) {
    console.log("  ERROR reading constraints: " + e.message);
  }
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.3 - indexes per existing table");
console.log("═══════════════════════════════════════════════════════════════");
for (const t of [...existingSet].sort()) {
  console.log();
  console.log("── " + t + " ──");
  try {
    const idx = await execSql(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='${t}' ORDER BY indexname`
    );
    for (const i of (idx || [])) console.log("  " + i.indexdef);
  } catch (e) {
    console.log("  ERROR reading indexes: " + e.message);
  }
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.4 - row counts per existing table");
console.log("═══════════════════════════════════════════════════════════════");
for (const t of [...existingSet].sort()) {
  try {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) console.log("  " + t.padEnd(28) + " ERROR " + error.message);
    else console.log("  " + t.padEnd(28) + " " + count);
  } catch (e) {
    console.log("  " + t.padEnd(28) + " EXCEPTION " + e.message);
  }
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.5 - enum types relevant to inventory");
console.log("═══════════════════════════════════════════════════════════════");
try {
  const enums = await execSql(
    `SELECT t.typname, array_to_string(array_agg(e.enumlabel ORDER BY e.enumsortorder), ', ') AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname='public'
        AND t.typname IN (
          'inventory_item_status', 'inventory_alias_source', 'inventory_category',
          'count_session_status', 'price_history_source',
          'review_queue_status', 'review_queue_reason',
          'merge_history_action', 'merge_history_item_role'
        )
      GROUP BY t.typname
      ORDER BY t.typname`
  );
  for (const e of (enums || [])) {
    console.log("  " + e.typname + " = (" + e.labels + ")");
  }
} catch (e) {
  console.log("  ERROR reading enums: " + e.message);
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.6 - VIEWs in public schema");
console.log("═══════════════════════════════════════════════════════════════");
try {
  const views = await execSql(
    `SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_%' ORDER BY viewname`
  );
  for (const v of (views || [])) console.log("  " + v.viewname);
} catch (e) {
  console.log("  ERROR reading views: " + e.message);
}

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PART A.7 - functions/RPC relevant to inventory");
console.log("═══════════════════════════════════════════════════════════════");
try {
  const funcs = await execSql(
    `SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS result
       FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('merge_inventory_items', 'merge_vendors', 'exec_sql', 'archive_document', 'sousai_match')
      ORDER BY proname`
  );
  for (const f of (funcs || [])) {
    console.log("  " + f.proname + "(" + f.args + ") -> " + f.result);
  }
} catch (e) {
  console.log("  ERROR reading functions: " + e.message);
}

process.exit(0);
