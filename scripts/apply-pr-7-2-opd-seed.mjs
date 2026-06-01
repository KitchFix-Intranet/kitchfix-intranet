// scripts/apply-pr-7-2-opd-seed.mjs
// IMPORTANT: THIS script — not the .sql file — is the executable re-seed path (parses the SQL VALUES tuples and inserts via supabase-js; the .sql is for Studio paste only).
// Apply pr-7-2-opd-seed.sql to live Supabase via the supabase-js client.
//
// The supabase-js client has no raw-SQL primitive; this script parses the
// VALUES tuples from the committed seed file using a SQL-aware paren-balanced
// + quote-aware scanner (same parser that passed the 15-value pre-flight
// check), translates each tuple to a JS object, and inserts via
// .from(table).insert(rows). Closing UPDATEs in the SQL set is_historical =
// TRUE / data_provenance = 'batch_rebuild' on every row; this script folds
// those values into the insert payload so the end state is byte-identical
// to the SQL file's outcome.
//
// Usage:
//   node --env-file=.env.local scripts/apply-pr-7-2-opd-seed.mjs
//
// Not idempotent — re-running on an already-seeded DB will hit PK violations,
// which is the same behavior as running the SQL file twice in Studio. To
// re-apply: TRUNCATE the 4 OPD tables first.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEED_PATH = "docs/migrations/pr-7-2-opd-seed.sql";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── SQL value parser ─────────────────────────────────────────────────────
function parseSQLValue(raw) {
  const s = raw.trim();
  if (s === "NULL" || s === "null") return null;
  if (s === "true" || s === "TRUE") return true;
  if (s === "false" || s === "FALSE") return false;
  if (s.startsWith("'") && s.endsWith("'")) {
    const inner = s.slice(1, -1).replace(/''/g, "'");
    // PG array literal '{a,b,c}' -> JS string[]
    if (inner.startsWith("{") && inner.endsWith("}")) {
      const body = inner.slice(1, -1);
      if (!body) return [];
      return body.split(",").map((x) => x.trim());
    }
    return inner;
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  throw new Error(`Cannot parse SQL value: ${JSON.stringify(s)}`);
}

// Top-level comma split (string + paren aware)
function splitTupleValues(inner) {
  const out = [];
  let cur = "", depth = 0, inString = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString) {
      cur += ch;
      if (ch === "'") {
        if (inner[i + 1] === "'") { cur += "'"; i++; continue; }
        inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; cur += ch; continue; }
    if (ch === "(") { depth++; cur += ch; continue; }
    if (ch === ")") { depth--; cur += ch; continue; }
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Extract each VALUES tuple (text between matched outer parens)
function extractTuples(block) {
  const tuples = [];
  let depth = 0, inString = false, cur = "";
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (inString) {
      cur += ch;
      if (ch === "'") {
        if (block[i + 1] === "'") { cur += "'"; i++; continue; }
        inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; cur += ch; continue; }
    if (ch === "(") {
      if (depth === 0) cur = ""; else cur += ch;
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) { tuples.push(cur); cur = ""; }
      else cur += ch;
      continue;
    }
    if (depth > 0) cur += ch;
  }
  return tuples;
}

function findInsertBlock(sql, table) {
  // Strip line comments so a semicolon inside an SQL "-- ... ;" comment
  // doesn't truncate the block prematurely (the Finance shelf comment had
  // this issue with the manifest dump parser earlier).
  const stripped = sql.replace(/--[^\n]*/g, "");
  const start = stripped.indexOf(`INSERT INTO ${table}`);
  if (start < 0) throw new Error(`Could not find INSERT INTO ${table}`);
  const valuesStart = stripped.indexOf("VALUES", start) + "VALUES".length;
  const end = stripped.indexOf(";", valuesStart);
  return stripped.slice(valuesStart, end);
}

// ─── Column layouts (15 / 3 / 2) ──────────────────────────────────────────
const DOC_COLS = [
  "id", "title", "doc_class", "status", "version", "shelf", "audience",
  "card_line", "owner", "approver", "pinned", "print_required",
  "critical", "keywords", "summary",
];
const REL_COLS = ["from_doc", "to_doc", "rel_type"];
const SUR_COLS = ["doc_id", "surface"];

function tupleToRow(tupleInner, cols, table) {
  const values = splitTupleValues(tupleInner);
  if (values.length !== cols.length) {
    throw new Error(
      `[${table}] tuple has ${values.length} values, expected ${cols.length}: ${tupleInner.slice(0, 120)}...`
    );
  }
  const row = {};
  cols.forEach((c, i) => { row[c] = parseSQLValue(values[i]); });
  // Closing UPDATEs in the SQL set these on every row — fold them in here.
  row.is_historical = true;
  row.data_provenance = "batch_rebuild";
  return row;
}

// ─── Parse + apply ────────────────────────────────────────────────────────
const sql = fs.readFileSync(SEED_PATH, "utf8");

const docTuples = extractTuples(findInsertBlock(sql, "documents"));
const relTuples = extractTuples(findInsertBlock(sql, "document_relationships"));
const surTuples = extractTuples(findInsertBlock(sql, "document_surfaces"));

const docs = docTuples.map((t) => tupleToRow(t, DOC_COLS, "documents"));
const rels = relTuples.map((t) => tupleToRow(t, REL_COLS, "document_relationships"));
const surs = surTuples.map((t) => tupleToRow(t, SUR_COLS, "document_surfaces"));

console.log(`Parsed: ${docs.length} documents · ${rels.length} relationships · ${surs.length} surfaces`);
console.log();

async function applyTable(table, rows) {
  console.log(`  inserting ${rows.length} rows into ${table}...`);
  const { error, count } = await sb.from(table).insert(rows, { count: "exact" });
  if (error) {
    console.error(`  FAILED on ${table}: code=${error.code} message=${error.message}`);
    if (error.details) console.error(`  details: ${error.details}`);
    if (error.hint) console.error(`  hint: ${error.hint}`);
    process.exit(1);
  }
  console.log(`  ok — ${table} inserted (server count=${count ?? "n/a"})`);
}

await applyTable("documents", docs);

// Class-weighted sort_order curation — mirrors the seed's closing UPDATE
// (see docs/migrations/pr-7-2-opd-seed.sql). The INSERT above does not set
// sort_order; this assigns curated values per class so the cards within each
// shelf read in importance order (STD first, CHK last) rather than falling
// through to title-ASC. Keeps the live DB in lockstep with the seed's final
// state when re-applied via supabase-js.
const CLASS_SORT_ORDER = {
  STD:  10,
  SOP:  20,
  POL:  30,
  AGR:  40,
  PB:   50,
  REF:  60,
  TPL:  70,
  FORM: 80,
  POST: 90,
  CHK:  95,
};

async function applyClassWeightedSortOrder() {
  console.log("  applying class-weighted sort_order to documents...");
  for (const [cls, weight] of Object.entries(CLASS_SORT_ORDER)) {
    const { error } = await sb
      .from("documents")
      .update({ sort_order: weight })
      .eq("doc_class", cls);
    if (error) {
      console.error(`  FAILED setting sort_order=${weight} for class=${cls}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`  ok — sort_order curated for ${Object.keys(CLASS_SORT_ORDER).length} doc classes`);
}

await applyClassWeightedSortOrder();

await applyTable("document_relationships", rels);
await applyTable("document_surfaces", surs);

console.log();
console.log("pr-7-2 seed applied successfully.");
console.log("Next: node --env-file=.env.local scripts/verify-pr-7-2-opd-seed.mjs");
