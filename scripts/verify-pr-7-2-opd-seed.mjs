// scripts/verify-pr-7-2-opd-seed.mjs
// Post-seed verification for pr-7-2-opd-seed.sql against live Supabase.
//
// Reports the 6 metrics the Architect requires before greenlighting PR 7.3:
//   • 41 documents      (total row count)
//   • 36 relationships  (total row count)
//   • 10 surfaces       (total row count)
//   • status distribution    : 22 Pending / 15 Draft / 1 Placeholder / 3 Retired
//   • audience distribution  : 5 internal / 5 slt / 28 operator / 3 null
//   • is_historical / data_provenance : all rows TRUE / 'batch_rebuild'
//
// Usage:
//   node --env-file=.env.local scripts/verify-pr-7-2-opd-seed.mjs

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let failures = 0;
const ok   = (m) => console.log(`  ok   ${m}`);
const bad  = (m) => { console.error(`  FAIL ${m}`); failures++; };

async function countRows(table) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count;
}

async function rowCountCheck(table, expected) {
  const n = await countRows(table);
  n === expected
    ? ok(`${table} row count = ${n}`)
    : bad(`${table} row count = ${n} (expected ${expected})`);
}

async function groupCounts(table, col) {
  // No GROUP BY in PostgREST — pull the column for all rows and count in JS.
  // 41 rows is trivial size; no pagination needed.
  const { data, error } = await sb.from(table).select(col);
  if (error) throw new Error(`select ${col} from ${table}: ${error.message}`);
  const map = new Map();
  for (const r of data) {
    const key = r[col];
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

console.log("verify pr-7-2-opd-seed (post-apply, against live Supabase)");
console.log();

// ── [1] row counts ───────────────────────────────────────────────────────
console.log("[1] row counts");
await rowCountCheck("documents",              41);
await rowCountCheck("document_relationships", 36);
await rowCountCheck("document_surfaces",      10);

// ── [2] documents.status distribution ─────────────────────────────────────
console.log("\n[2] documents.status distribution");
const expectedStatus = { Pending: 22, Draft: 15, Placeholder: 1, Retired: 3 };
const statusMap = await groupCounts("documents", "status");
for (const [key, expN] of Object.entries(expectedStatus)) {
  const got = statusMap.get(key) || 0;
  got === expN
    ? ok(`status='${key}' count = ${got}`)
    : bad(`status='${key}' count = ${got} (expected ${expN})`);
}
const extraStatus = [...statusMap.keys()].filter((k) => !(k in expectedStatus));
if (extraStatus.length) bad(`unexpected status values: ${extraStatus.join(", ")}`);

// ── [3] documents.audience distribution ───────────────────────────────────
console.log("\n[3] documents.audience distribution");
const audMap = await groupCounts("documents", "audience");
const audChecks = [
  ["internal",  5, audMap.get("internal")  || 0],
  ["slt",       5, audMap.get("slt")       || 0],
  ["operator", 28, audMap.get("operator")  || 0],
  ["null",      3, audMap.get(null)        || 0],
];
for (const [name, expN, got] of audChecks) {
  got === expN
    ? ok(`audience=${name === "null" ? "NULL" : `'${name}'`} count = ${got}`)
    : bad(`audience=${name === "null" ? "NULL" : `'${name}'`} count = ${got} (expected ${expN})`);
}
const extraAud = [...audMap.keys()].filter((k) => !["internal","slt","operator",null].includes(k));
if (extraAud.length) bad(`unexpected audience values: ${extraAud.map((x) => x === null ? "NULL" : x).join(", ")}`);

// ── [4] is_historical / data_provenance (closing UPDATEs landed) ──────────
console.log("\n[4] is_historical + data_provenance landed on every row");
for (const t of ["documents", "document_relationships", "document_surfaces"]) {
  const { count: hist, error: e1 } = await sb.from(t)
    .select("*", { count: "exact", head: true })
    .eq("is_historical", true);
  const { count: prov, error: e2 } = await sb.from(t)
    .select("*", { count: "exact", head: true })
    .eq("data_provenance", "batch_rebuild");
  const total = await countRows(t);
  if (e1 || e2) { bad(`${t}: ${e1?.message || e2?.message}`); continue; }
  hist === total
    ? ok(`${t}: is_historical=TRUE on all ${total} rows`)
    : bad(`${t}: is_historical=TRUE on ${hist} of ${total} rows`);
  prov === total
    ? ok(`${t}: data_provenance='batch_rebuild' on all ${total} rows`)
    : bad(`${t}: data_provenance='batch_rebuild' on ${prov} of ${total} rows`);
}

console.log();
console.log(failures === 0
  ? "PASS — pr-7-2 seed verified clean (41 docs · 36 rels · 10 surfaces · status 22/15/1/3 · audience 5/5/28/3)."
  : `FAIL — ${failures} check(s).`);
process.exit(failures === 0 ? 0 : 1);
