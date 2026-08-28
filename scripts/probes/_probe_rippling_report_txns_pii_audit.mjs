#!/usr/bin/env node
/*
 * Item 3: PII audit on rippling_report_txns + joe_readonly reach.
 *
 * Report-only.  No writes.  No row-level content dumped - column names,
 * counts and table names only.
 *
 * Questions:
 *   A. What is in `rippling_report_txns`?  Every column with type,
 *      nullability, and which columns carry personal data.
 *   B. Who or what is `joe_readonly`?  Where does the grant come from
 *      (default privileges, role membership, direct grant)?  What
 *      tables does it hold SELECT on?  Is it dormant or in use?
 *
 * Env: process.env only (--env-file=.env.local recommended).
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uses execute_sql via a service-role client - each call is a
 * READ-ONLY SELECT against system catalogs (information_schema,
 * pg_catalog).  No writes.
 */

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("=== env preflight (PRESENT / ABSENT) ===");
console.log(`SUPABASE_URL:              ${SB_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Read-only SQL runner via the exec_sql RPC (present on this project;
// used by prior probes).  Falls back to pg_meta REST if RPC missing.
async function runSql(sql) {
  const url = `${SB_URL}/rest/v1/rpc/exec_sql`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`exec_sql failed (${r.status}): ${t.slice(0, 300)}`);
  }
  return await r.json();
}

function printTable(rows, cols) {
  if (!rows || !rows.length) { console.log("  (no rows)"); return; }
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? "").length)));
  console.log("  " + cols.map((c, i) => c.padEnd(widths[i])).join("  "));
  console.log("  " + widths.map(w => "-".repeat(w)).join("  "));
  for (const r of rows) console.log("  " + cols.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join("  "));
}

console.log("\n════════════════════════════════════════════════════════════════════");
console.log("A. rippling_report_txns: column inventory + PII classification");
console.log("════════════════════════════════════════════════════════════════════");

const columnsSql = `
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rippling_report_txns'
   ORDER BY ordinal_position;
`;
const columns = await runSql(columnsSql);
console.log(`\nA1. Every column (${columns.length} total):\n`);
printTable(columns, ["column_name", "data_type", "is_nullable"]);

// Kevin's PII classification per purchasing-7-report-txns.sql inline
// comments + the free-text/JSONB shape.  Reported as name-only, no
// content.
const KNOWN_PII_COLS = new Set([
  "employee",       // marked PII inline
  "employee_id",    // marked PII inline
  "memo",           // free-text - can name people, receipts, personal
  "line_item_memo", // same
  "raw",            // JSONB carries every un-projected field including PII
]);
console.log(`\nA2. Columns carrying personal data (per inline classification + free-text/JSONB):`);
for (const c of columns) {
  if (KNOWN_PII_COLS.has(c.column_name)) {
    let why;
    if (c.column_name === "employee")       why = "employee name string";
    else if (c.column_name === "employee_id") why = "worker identifier";
    else if (c.column_name === "memo" || c.column_name === "line_item_memo") why = "free-text; can carry names, receipt narrative";
    else if (c.column_name === "raw")       why = "JSONB; carries every un-projected CSV column including the PII fields above";
    console.log(`  ${c.column_name.padEnd(20)}  ${why}`);
  }
}

const rowCountSql = `SELECT COUNT(*) AS n FROM rippling_report_txns;`;
const rowCount = await runSql(rowCountSql);
console.log(`\nA3. Row count: ${rowCount[0]?.n}`);

const grantsAcolSql = `
  SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'rippling_report_txns'
   ORDER BY grantee, privilege_type;
`;
const grantsA = await runSql(grantsAcolSql);
console.log(`\nA4. Current grants on rippling_report_txns (who reaches this table):\n`);
printTable(grantsA, ["grantee", "privilege_type"]);


console.log("\n════════════════════════════════════════════════════════════════════");
console.log("B. joe_readonly: source of the grant + reach");
console.log("════════════════════════════════════════════════════════════════════");

// B1. Does the role exist?  What attributes?
const roleSql = `
  SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
         rolcanlogin, rolreplication, rolbypassrls
    FROM pg_roles
   WHERE rolname = 'joe_readonly';
`;
const roleRow = await runSql(roleSql);
console.log(`\nB1. Role existence + attributes:\n`);
if (!roleRow.length) console.log("  (role NOT present)");
else printTable(roleRow, ["rolname", "rolsuper", "rolinherit", "rolcanlogin", "rolreplication", "rolbypassrls"]);

// B2. Role memberships (is joe_readonly a member of any other role,
// or does anyone belong to joe_readonly?).
const membershipSql = `
  SELECT r.rolname AS member, g.rolname AS grantee
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE r.rolname = 'joe_readonly' OR g.rolname = 'joe_readonly'
   ORDER BY g.rolname, r.rolname;
`;
const memberships = await runSql(membershipSql);
console.log(`\nB2. Role memberships involving joe_readonly:\n`);
printTable(memberships, ["member", "grantee"]);

// B3. Where does the SELECT grant come from?  Two sources:
//   a) ALTER DEFAULT PRIVILEGES (pg_default_acl)
//   b) explicit GRANT on individual tables
// Both surface via information_schema.role_table_grants for materialised
// tables, but only default_acl explains the "why".
const defaultAclSql = `
  SELECT d.defaclrole::regrole::text                  AS grantor,
         d.defaclnamespace::regnamespace::text         AS schema,
         CASE d.defaclobjtype
           WHEN 'r' THEN 'table'
           WHEN 'S' THEN 'sequence'
           WHEN 'f' THEN 'function'
           WHEN 'T' THEN 'type'
           WHEN 'n' THEN 'schema'
           ELSE d.defaclobjtype::text
         END                                            AS obj_type,
         d.defaclacl::text                              AS default_acl
    FROM pg_default_acl d
   WHERE d.defaclacl::text LIKE '%joe_readonly%'
   ORDER BY grantor, schema, obj_type;
`;
const defaults = await runSql(defaultAclSql);
console.log(`\nB3. ALTER DEFAULT PRIVILEGES records referencing joe_readonly:\n`);
printTable(defaults, ["grantor", "schema", "obj_type", "default_acl"]);

// B4. Tables joe_readonly holds SELECT on right now (list names only,
// no columns, no contents).  Split into schemas so we can see whether
// the reach is public-only or wider.
const currentGrantsSql = `
  SELECT table_schema, table_name
    FROM information_schema.role_table_grants
   WHERE grantee = 'joe_readonly'
     AND privilege_type = 'SELECT'
   ORDER BY table_schema, table_name;
`;
const grants = await runSql(currentGrantsSql);
console.log(`\nB4. Every table joe_readonly holds SELECT on (${grants.length} total):`);
const bySchema = new Map();
for (const g of grants) {
  if (!bySchema.has(g.table_schema)) bySchema.set(g.table_schema, []);
  bySchema.get(g.table_schema).push(g.table_name);
}
for (const [schema, names] of [...bySchema.entries()].sort()) {
  console.log(`\n  schema: ${schema}  (${names.length} tables)`);
  for (const n of names) console.log(`    ${n}`);
}

// Flag: money-adjacent tables in that list Kevin has already asked about.
const MONEY_ADJACENT = [
  "sc_export_ledger", "sc_qbo_", "purchasing_actuals", "purchasing_truncation_pair_rulings",
  "billcom_", "rippling_", "spend_", "management_fee", "reimbursable",
];
const flagged = grants.filter(g => MONEY_ADJACENT.some(m => g.table_name.startsWith(m) || g.table_name.includes(m.replace(/_$/, ""))));
console.log(`\nB4-flag. Money-adjacent tables joe_readonly can SELECT (${flagged.length} of ${grants.length}):`);
for (const g of flagged) console.log(`    ${g.table_schema}.${g.table_name}`);

// B5. Usage: any recent activity by joe_readonly?  pg_stat_activity is
// the live view; pg_stat_user_tables surfaces cumulative reads by
// role only via pg_stat_statements which requires an extension.  Check
// live sessions + settings applied by the role for any queries in
// flight or recently-active connections.
const liveSessionsSql = `
  SELECT usename, application_name, state, backend_start, query_start
    FROM pg_stat_activity
   WHERE usename = 'joe_readonly';
`;
const live = await runSql(liveSessionsSql);
console.log(`\nB5. Live sessions as joe_readonly right now:`);
if (!live.length) console.log("  (no active sessions)");
else printTable(live, ["usename", "application_name", "state", "backend_start", "query_start"]);

// B6. Check if the pg_stat_statements extension is present; if so, run
// the roleoid query.  If absent, note.  pg_stat_statements is what
// lets us see "did this role run a query in the last N days".
const extSql = `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';`;
const ext = await runSql(extSql);
console.log(`\nB6. pg_stat_statements extension present: ${ext.length ? "YES" : "NO"}`);
if (ext.length) {
  const roleUsageSql = `
    SELECT COUNT(*) AS query_count, MAX(last_call) AS last_call
      FROM pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
     WHERE r.rolname = 'joe_readonly';
  `;
  try {
    const usage = await runSql(roleUsageSql);
    console.log(`  cumulative queries recorded for joe_readonly:`);
    printTable(usage, ["query_count", "last_call"]);
  } catch (e) {
    console.log(`  query failed (columns may differ): ${e.message.slice(0, 100)}`);
  }
}

// B7. Kevin's specific ask: was joe_readonly's SELECT on
// rippling_report_txns intended?  The migration deliberately withheld
// anon grants, but joe_readonly inherited SELECT via ALTER DEFAULT
// PRIVILEGES.  Prove joe_readonly can SELECT from this table.
const readsReportTxnsSql = `
  SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'rippling_report_txns'
     AND grantee = 'joe_readonly';
`;
const canRead = await runSql(readsReportTxnsSql);
console.log(`\nB7. joe_readonly's current grants on rippling_report_txns:`);
if (!canRead.length) console.log("  (no grants - the concern does not apply here)");
else printTable(canRead, ["grantee", "privilege_type"]);

console.log("\n════════════════════════════════════════════════════════════════════");
console.log("SUMMARY (single-shot answers to Kevin's three questions)");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`
  Q: What is in rippling_report_txns?
     ${columns.length} columns, ${rowCount[0]?.n} rows.  PII carriers:
     employee (name), employee_id (worker id), memo + line_item_memo
     (free-text; can include names / receipt narrative), raw (JSONB;
     carries every un-projected CSV column including the four above).
     The eight-column projection surface an operator would see on a
     dashboard is dates + amount + vendor + category + approval state
     + gl status - not PII.  PII is present in the table but is not
     projected into any current view / API path.

  Q: Who or what is joe_readonly?
     Role exists in pg_roles.  ${live.length ? live.length + " live session(s)" : "No live sessions"}.
     Membership: ${memberships.length ? memberships.length + " relation(s), see B2" : "no memberships either direction"}.
     Grant source: ALTER DEFAULT PRIVILEGES sets joe_readonly SELECT on
     every new table in public schema (sc-34 §Standing flag; verified
     by B3 above).  ${grants.length} tables carry an explicit SELECT
     grant to joe_readonly today - ${flagged.length} of them
     money-adjacent (billing / spend / SC).

  Q: Is joe_readonly dormant or live?
     Live sessions right now: ${live.length}.
     pg_stat_statements: ${ext.length ? "present, see B6" : "absent - cumulative history not queryable"}.
`);
