// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-7-5-poster-id-fix.mjs
// Project OPD · PR 7.5 · verify atomic rename POST-003 → POSTER-001.
//
// Same Studio-then-verify pattern as pr-7-4 — the SQL is a multi-statement
// transaction (BEGIN...COMMIT) and supabase-js can't dispatch that through
// PostgREST. Apply the .sql in Studio first, then this script confirms:
//   - 1 row in documents with id='POSTER-001'
//   - 0 rows anywhere referencing POST-003
//     (documents, document_relationships, document_surfaces, document_issues)
//   - Each post-rename relationship that previously involved POST-003 now
//     resolves to POSTER-001 (sample check: AGR-001's "Source for" edge).
//
// Idempotent. Safe to re-run.
//
// Usage:
//   1. Paste docs/migrations/pr-7-5-opd-poster-id-fix.sql into Supabase
//      Studio and run.
//   2. node --env-file=.env.local scripts/apply-pr-7-5-poster-id-fix.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const OLD_ID = "POST-003";
const NEW_ID = "POSTER-001";

let failures = 0;
const ok   = (m) => console.log(`  ok   ${m}`);
const bad  = (m) => { console.error(`  FAIL ${m}`); failures++; };

async function rowCount(table, filterFn) {
  const q = filterFn(sb.from(table).select("*", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

console.log("apply pr-7-5-opd-poster-id-fix (verify-after-Studio)\n");

// ── [1] POST-003 fully gone ──────────────────────────────────────────────────
console.log("[1] zero references to POST-003 anywhere");
const oldDocs = await rowCount("documents",              (q) => q.eq("id", OLD_ID));
const oldFrom = await rowCount("document_relationships", (q) => q.eq("from_doc", OLD_ID));
const oldTo   = await rowCount("document_relationships", (q) => q.eq("to_doc",   OLD_ID));
const oldSurf = await rowCount("document_surfaces",      (q) => q.eq("doc_id",   OLD_ID));
const oldIss  = await rowCount("document_issues",        (q) => q.eq("doc_id",   OLD_ID));
oldDocs === 0 ? ok(`documents              has 0 rows with id=${OLD_ID}`)       : bad(`documents              still has ${oldDocs} rows with id=${OLD_ID}`);
oldFrom === 0 ? ok(`document_relationships has 0 rows with from_doc=${OLD_ID}`) : bad(`document_relationships still has ${oldFrom} rows with from_doc=${OLD_ID}`);
oldTo   === 0 ? ok(`document_relationships has 0 rows with to_doc=${OLD_ID}`)   : bad(`document_relationships still has ${oldTo} rows with to_doc=${OLD_ID}`);
oldSurf === 0 ? ok(`document_surfaces      has 0 rows with doc_id=${OLD_ID}`)   : bad(`document_surfaces      still has ${oldSurf} rows with doc_id=${OLD_ID}`);
oldIss  === 0 ? ok(`document_issues        has 0 rows with doc_id=${OLD_ID}`)   : bad(`document_issues        still has ${oldIss} rows with doc_id=${OLD_ID}`);

// ── [2] POSTER-001 row landed ────────────────────────────────────────────────
console.log("\n[2] POSTER-001 row present in documents");
const { data: newRow, error: newErr } = await sb
  .from("documents")
  .select("id, title, doc_class, shelf, version, status")
  .eq("id", NEW_ID)
  .maybeSingle();
if (newErr) { bad(`documents.id=${NEW_ID} read failed: ${newErr.message}`); }
else if (!newRow) { bad(`documents.id=${NEW_ID} not found`); }
else {
  ok(`POSTER-001 found: ${newRow.title} · ${newRow.doc_class} · ${newRow.shelf} · ${newRow.status} · ${newRow.version || "(no version)"}`);
}

// ── [3] sample relationship resolves to POSTER-001 ───────────────────────────
console.log("\n[3] relationships repointed to POSTER-001");
const { data: rels, error: relsErr } = await sb
  .from("document_relationships")
  .select("from_doc, to_doc, rel_type")
  .or(`from_doc.eq.${NEW_ID},to_doc.eq.${NEW_ID}`);
if (relsErr) { bad(`relationships read failed: ${relsErr.message}`); }
else {
  ok(`${rels.length} relationship row(s) now reference POSTER-001`);
  for (const r of rels) {
    console.log(`       ${r.from_doc} --${r.rel_type}--> ${r.to_doc}`);
  }
  // Explicit PRESENCE assertion - the BEFORE snapshot showed exactly one
  // edge touching POST-003: POST-003 --derived_from--> AGR-001 (which the
  // catalog renders as "Source for POSTER-001" when viewing AGR-001). The
  // rename's correctness hinges on that edge being repointed to POSTER-001,
  // not just on POST-003 being absent. Assert the edge exists with the
  // correct shape (from/to/type) rather than inferring from absence.
  const edge = rels.find(
    (r) => r.from_doc === NEW_ID && r.to_doc === "AGR-001" && r.rel_type === "derived_from"
  );
  edge
    ? ok(`PRESENCE check: POSTER-001 --derived_from--> AGR-001 is in the table`)
    : bad(`PRESENCE check: POSTER-001 --derived_from--> AGR-001 NOT found (the AGR-001 'Source for' edge should have been repointed)`);
}

// ── [4] sample surface check ────────────────────────────────────────────────
console.log("\n[4] surfaces repointed to POSTER-001");
const { data: surfs, error: surfsErr } = await sb
  .from("document_surfaces")
  .select("surface")
  .eq("doc_id", NEW_ID);
if (surfsErr) { bad(`surfaces read failed: ${surfsErr.message}`); }
else if (surfs.length === 0) console.log(`  note POSTER-001 has 0 surface rows (seed may have none for this doc)`);
else {
  ok(`POSTER-001 surfaces: ${surfs.map((s) => s.surface).join(", ")}`);
}

console.log();
console.log(failures === 0
  ? `PASS — pr-7-5 rename verified. POST-003 fully retired, POSTER-001 present.`
  : `FAIL — ${failures} issue(s). Paste docs/migrations/pr-7-5-opd-poster-id-fix.sql in Studio and re-run.`);
process.exit(failures === 0 ? 0 : 1);
