// Grant-state re-derivation for a grant audit.
// Read-only against information_schema. Reports every public.table_name
// that grants any of TRUNCATE / REFERENCES / TRIGGER / DELETE / UPDATE to
// anon or authenticated.
//
// Run: node --env-file=.env.local scripts/_probe-grant-hygiene.mjs
//
// Referenced from docs/audits/GRANT_HYGIENE_2026-07-29.md.
//
// ─── Known limitation (2026-07-31) ────────────────────────────────────────
// PostgREST does NOT project information_schema by default. This script
// therefore returns PGRST106 against production Supabase and its error
// branch prints the Studio query as fallback. The Studio query is the
// primary path; this script is a convenience wrapper for the day PostgREST
// exposes information_schema (or the day this repo lands an SQL-executing
// RPC that surfaces the catalog to app code).
//
// **Do not use migration-file grep as a fallback for this question.**
// The pre-apply re-derivation on 2026-07-31 fell back to file grep after
// this script's PGRST106 and produced 36 tables. The catalog held 59.
// The 23-table blind spot is exactly the class of table created directly
// in Supabase without a migration file (accounts, contacts, hero_images,
// and twenty others). See GRANT_HYGIENE_2026-07-29.md §9 for the standing
// lesson and SOUSAI_AGENT_PLAN.md §22 for the plan-level rule.

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

// No hardcoded baseline for the delta. The catalog is the primary source; a
// hardcoded set from migration files is exactly the blind spot the 2026-07-31
// correction exists to record. Compare against a prior JSON dump of this
// same script if a delta view is wanted.

// Emit JSON for downstream consumption / audit doc update.
console.log("---JSON---");
console.log(JSON.stringify({ probed_at: new Date().toISOString(), flagged_tables: flaggedTables, per_privilege_count: perPrivCount }, null, 2));
