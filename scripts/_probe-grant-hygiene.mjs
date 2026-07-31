// Fresh grant-state re-derivation for the R1 revoke.
// Read-only against information_schema. Reports every public.table_name
// that grants any of TRUNCATE / REFERENCES / TRIGGER / DELETE / UPDATE to
// anon or authenticated.
//
// Run: node --env-file=.env.local scripts/_probe-grant-hygiene.mjs
//
// Referenced from docs/audits/GRANT_HYGIENE_2026-07-29.md.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and service role required");

const sb = createClient(url, key, { auth: { persistSession: false } });

// information_schema.table_privileges is not exposed via PostgREST. Use the
// service-role client to call a one-liner RPC via .rpc()... no such rpc
// exists in this project. Fall back to reading the view via the SQL exec
// route: pg REST does expose information_schema tables/views for a schema
// exactly like any other. The view is world-readable to any authenticated
// role; PostgREST projects it if the schema is on the exposed list.
//
// If PostgREST doesn't expose `information_schema`, this script exits with
// a clear message and directs the reader to Studio for the same query.
const q = await sb
  .schema("information_schema")
  .from("table_privileges")
  .select("grantee, table_schema, table_name, privilege_type")
  .eq("table_schema", "public")
  .in("grantee", ["anon", "authenticated"])
  .in("privilege_type", ["TRUNCATE", "REFERENCES", "TRIGGER", "DELETE", "UPDATE", "INSERT", "SELECT"]);

if (q.error) {
  console.error("information_schema.table_privileges query failed:");
  console.error("  code:", q.error.code, "message:", q.error.message);
  console.error("");
  console.error("PostgREST likely does not expose the information_schema.");
  console.error("Run this in Studio instead:");
  console.error("");
  console.error("  SELECT grantee, table_name, privilege_type");
  console.error("  FROM information_schema.table_privileges");
  console.error("  WHERE table_schema = 'public'");
  console.error("    AND grantee IN ('anon','authenticated')");
  console.error("    AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','DELETE','UPDATE','INSERT','SELECT')");
  console.error("  ORDER BY table_name, grantee, privilege_type;");
  process.exit(2);
}

// Roll up: per-table -> {anon: Set, authenticated: Set}
const perTable = new Map();
for (const r of q.data) {
  const t = r.table_name;
  let entry = perTable.get(t);
  if (!entry) { entry = { anon: new Set(), authenticated: new Set() }; perTable.set(t, entry); }
  entry[r.grantee].add(r.privilege_type);
}

const FLAGGED = new Set(["TRUNCATE", "REFERENCES", "TRIGGER", "DELETE", "UPDATE"]);
const KEEP = new Set(["SELECT", "INSERT"]);

const flaggedTables = [];
const perPrivCount = { TRUNCATE: 0, REFERENCES: 0, TRIGGER: 0, DELETE: 0, UPDATE: 0 };

for (const [table, roles] of [...perTable.entries()].sort()) {
  const anonFlagged = [...roles.anon].filter((p) => FLAGGED.has(p));
  const authFlagged = [...roles.authenticated].filter((p) => FLAGGED.has(p));
  const union = [...new Set([...anonFlagged, ...authFlagged])].sort();
  if (union.length === 0) continue;
  flaggedTables.push({
    table,
    anon: [...roles.anon].sort(),
    authenticated: [...roles.authenticated].sort(),
    flagged_privileges: union,
  });
  for (const p of union) perPrivCount[p] = (perPrivCount[p] || 0) + 1;
}

console.log(`Fresh grant re-derivation (as of ${new Date().toISOString()})\n`);
console.log(`Flagged tables (public schema, anon or authenticated with at least one of TRUNCATE/REFERENCES/TRIGGER/DELETE/UPDATE):\n`);
console.log("table                                anon                                     authenticated");
console.log("-".repeat(120));
for (const t of flaggedTables) {
  console.log(
    t.table.padEnd(37),
    (t.anon.join(",") || "(none)").padEnd(41),
    t.authenticated.join(",") || "(none)"
  );
}
console.log("");
console.log(`Total flagged tables: ${flaggedTables.length}`);
console.log("");
console.log("Per-privilege count (# of tables that grant it to anon and/or authenticated):");
for (const [p, n] of Object.entries(perPrivCount)) {
  console.log(`  ${p.padEnd(12)} ${n}`);
}
console.log("");

// Compare vs the audit's 35 tables named in docs/audits/GRANT_HYGIENE_2026-07-29.md
const AUDIT_TABLES = new Set([
  "documents", "document_relationships", "document_surfaces",
  "document_issues", "document_pins", "document_content", "document_chunks",
  "vendors", "vendor_aliases", "vendor_accounts",
  "invoice_submissions", "invoice_rejections", "ai_line_items", "gl_codes",
  "inventory_items", "item_aliases", "storage_locations",
  "count_sessions", "count_items", "price_history", "review_queue",
  "merge_history", "merge_history_items",
  "sc_service_groups", "sc_services", "sc_service_prices",
  "sc_daily_projections", "sc_daily_actuals", "sc_day_metadata",
  "sc_daily_actuals_history", "sc_homestand_schedule",
  "sc_day_note_entries", "sc_config_changelog",
  "sc_labor_budgets", "sc_fee_schedule",
]);

const nowNames = new Set(flaggedTables.map((t) => t.table));
const addedSinceAudit = [...nowNames].filter((n) => !AUDIT_TABLES.has(n)).sort();
const removedSinceAudit = [...AUDIT_TABLES].filter((n) => !nowNames.has(n)).sort();

console.log(`Delta vs the 2026-07-29 audit's 35 tables:`);
console.log(`  audit total:       ${AUDIT_TABLES.size}`);
console.log(`  live total now:    ${nowNames.size}`);
console.log(`  added since audit: ${addedSinceAudit.length}  ${addedSinceAudit.length > 0 ? addedSinceAudit.join(", ") : "(none)"}`);
console.log(`  cleaned / gone:    ${removedSinceAudit.length}  ${removedSinceAudit.length > 0 ? removedSinceAudit.join(", ") : "(none)"}`);
console.log("");

// Emit JSON for downstream consumption / audit doc update
console.log("---JSON---");
console.log(JSON.stringify({ probed_at: new Date().toISOString(), flagged_tables: flaggedTables, per_privilege_count: perPrivCount, delta: { audit_total: AUDIT_TABLES.size, live_total: nowNames.size, added_since_audit: addedSinceAudit, cleaned_since_audit: removedSinceAudit } }, null, 2));
