// ─────────────────────────────────────────────────────────────────────────────
// scripts/cp2-archive-create-demo.mjs
// CP2 demo: archive + restore + create-document end-to-end on sentinels.
// ─────────────────────────────────────────────────────────────────────────────
//
// Proves the FULL CHUNK ROUND-TRIP:
//   - archive deletes chunks (CP1 already proved this on a single sentinel;
//     here we show it on three with different doc_classes)
//   - restore re-embeds chunks back (the half CP1 couldn't test)
//
// Three sentinels demonstrate the three restore dispatch paths:
//   A: POSTER-991 (POST class)         → stub re-embed path
//   B: STD-992 (with Drive link)       → full extract+chunk+embed path
//   C: PB-993 (no Drive link)          → no-content restore path
//
// Plus create-document validator rejections (the negative cases the user
// specifically asked to see):
//   - malformed ID
//   - prefix↔doc_class mismatch (SOP-007 with doc_class=PB)
//   - duplicate ID
//
// Calls the underlying helpers directly (dataStore + sousai + the RPC), NOT
// through HTTP - so we don't need a logged-in browser session. The API
// actions are thin wrappers around these same helpers; this exercises the
// identical code paths.
//
// Run:
//   node --env-file=.env.local scripts/cp2-archive-create-demo.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import {
  embedDocument,
  embedPosterStub,
  restoreDocument,
} from "../src/lib/sousai/index.js";
import { validateCreatePayload } from "../src/lib/playbookValidation.js";

// NOTE: We don't import from src/lib/dataStore/opd.js here because that file
// uses Next.js's "@/lib/..." path alias which Node-direct can't resolve. The
// demo calls supabase-js directly for the doc CRUD. The route.js layer goes
// through dataStore in the actual app - that path is exercised by the API
// route at runtime, not by this CLI.

// Wrappers around supabase-js for symmetry with the dataStore API.
async function insertDoc(payload) {
  const { data, error } = await sb
    .from("documents")
    .insert(payload)
    .select()
    .single();
  if (error) {
    const err = new Error(`insert ${payload.id}: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  return data;
}

async function fetchDoc(id) {
  const { data, error } = await sb
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`fetch ${id}: ${error.message}`);
  return data;
}

const SENTINEL_A_ID = "POSTER-991";  // POST class -> stub path
const SENTINEL_B_ID = "STD-992";     // STD class with Drive -> full extract
const SENTINEL_C_ID = "PB-993";      // PB class no Drive -> no-content

// PB-002's Drive file ID - reused for sentinel B's source_drive_id. The
// service account already has Viewer on it (proven in L2/L3). The chunks
// produced will carry STD-992's doc_id but contain Allergen Playbook text,
// which is fine for a demo - they're clearly test data and get deleted
// at the end.
const PB_002_DRIVE_ID = "1oH7CNiBh1EQg-3QhBgpUYPFnGE1UnernCKrBXKbNVTk";

// Validation sets matching route.js. The validator is called directly here
// (not through the route), so we pass them in. These are intentionally a
// snapshot - if route.js's sets ever change, the demo's negative tests
// stay correct because the regex + prefix-class check don't depend on these.
const VALID_SHELVES_SET = new Set([
  "Safety", "Operations", "HR & People", "Culinary",
  "Finance", "Site & Client",
]);
const VALID_CLASSES = new Set([
  "PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK",
]);
const VALID_STATUSES = new Set([
  "Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired",
]);
const SETS = {
  validShelves: VALID_SHELVES_SET,
  validClasses: VALID_CLASSES,
  validStatuses: VALID_STATUSES,
};

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let failures = 0;
const ok  = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.error(`  FAIL  ${m}`); failures++; };

async function chunkCount(docId) {
  const { count } = await sb
    .from("document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("doc_id", docId);
  return count || 0;
}

async function cleanup(docId) {
  await sb.from("document_chunks").delete().eq("doc_id", docId);
  await sb.from("documents").delete().eq("id", docId);
}

console.log("CP2 demo: archive + restore + create + chunk round-trip\n");

// ── [0] Pre-cleanup ──────────────────────────────────────────────────────────
console.log("[0] pre-cleanup any sentinel residue");
for (const id of [SENTINEL_A_ID, SENTINEL_B_ID, SENTINEL_C_ID]) {
  await cleanup(id);
}
ok("cleanup complete (any stale sentinels removed)");

// ── [1] Validator rejections ─────────────────────────────────────────────────
console.log("\n[1] validateCreatePayload: rejection cases");

// Case 1.1: malformed ID
const r1 = validateCreatePayload({ id: "PB", title: "t", doc_class: "PB" }, SETS);
if (!r1.ok && /malformed/i.test(r1.error)) {
  ok(`malformed 'PB' rejected: "${r1.error.slice(0, 60)}..."`);
} else bad(`malformed 'PB' should be rejected, got: ${JSON.stringify(r1).slice(0, 100)}`);

// Case 1.2: prefix↔doc_class mismatch
const r2 = validateCreatePayload({ id: "SOP-007", title: "t", doc_class: "PB" }, SETS);
if (!r2.ok && /does not match|prefix.*implies/i.test(r2.error)) {
  ok(`SOP-007 with doc_class=PB rejected: "${r2.error.slice(0, 80)}..."`);
} else bad(`prefix mismatch should be rejected, got: ${JSON.stringify(r2).slice(0, 100)}`);

// Positive control: valid payload should pass
const r3 = validateCreatePayload({ id: "STD-994", title: "valid demo", doc_class: "STD" }, SETS);
if (r3.ok) ok(`valid payload (STD-994/STD) accepted, defaults: status=${r3.clean.status}, version=${r3.clean.version === null ? "null" : `'${r3.clean.version}'`}`);
else bad(`valid payload rejected: ${JSON.stringify(r3)}`);

// Version default check (per spec - null, not 'v0.1')
if (r3.ok && r3.clean.version === null) ok(`version defaults to null (honest blank for empty doc, per spec)`);
else bad(`version default failed: clean=${JSON.stringify(r3.clean)}`);

// ── [2] createDocument: 3 sentinels + duplicate ──────────────────────────────
console.log("\n[2] createDocument: 3 sentinels + duplicate-rejection");

await insertDoc({
  id: SENTINEL_A_ID,
  title: "CP2 Demo · Poster Stub",
  doc_class: "POST",
  status: "Pending",
  shelf: null,
  card_line: "Demo poster for CP2",
  summary: "Demonstrates the stub re-embed path on restore.",
});
ok(`created ${SENTINEL_A_ID} (POST class → stub path target)`);

await insertDoc({
  id: SENTINEL_B_ID,
  title: "CP2 Demo · Full Extract",
  doc_class: "STD",
  status: "Pending",
  shelf: null,
  source_drive_id: PB_002_DRIVE_ID,
});
ok(`created ${SENTINEL_B_ID} (STD class with Drive link → full extract path target)`);

await insertDoc({
  id: SENTINEL_C_ID,
  title: "CP2 Demo · No Content",
  doc_class: "PB",
  status: "Pending",
  shelf: null,
});
ok(`created ${SENTINEL_C_ID} (PB class no Drive link → no-content path target)`);

// Duplicate-id rejection at the PG layer
let dupErr = null;
try {
  await insertDoc({
    id: SENTINEL_A_ID,
    title: "duplicate attempt",
    doc_class: "POST",
    status: "Pending",
  });
} catch (e) {
  dupErr = e;
}
if (dupErr && /duplicate|already exists|unique|23505/i.test(dupErr.message)) {
  ok(`duplicate id ${SENTINEL_A_ID} rejected by PG: "${dupErr.message.slice(0, 80)}..."`);
} else if (dupErr) {
  bad(`duplicate produced wrong error: ${dupErr.message}`);
} else {
  bad(`duplicate id ${SENTINEL_A_ID} should have failed but didn't`);
}

// ── [3] Initial embed: build the chunks we'll later archive + restore ────────
console.log("\n[3] initial embed (giving each sentinel chunks to round-trip)");

const initA = await embedPosterStub({ docId: SENTINEL_A_ID });
ok(`${SENTINEL_A_ID} stub: ${initA.chunksReplaced.inserted} chunk(s)`);

const initB = await embedDocument({ docId: SENTINEL_B_ID, driveFileId: PB_002_DRIVE_ID });
ok(`${SENTINEL_B_ID} full extract: ${initB.chunksReplaced.inserted} chunks (${initB.chunkingPath})`);

ok(`${SENTINEL_C_ID} not embedded (correct: no Drive link, not POST class)`);

const beforeA = await chunkCount(SENTINEL_A_ID);
const beforeB = await chunkCount(SENTINEL_B_ID);
const beforeC = await chunkCount(SENTINEL_C_ID);
console.log(`  pre-archive chunk counts: A=${beforeA}, B=${beforeB}, C=${beforeC}`);

// ── [4] Archive each via archive_document RPC ────────────────────────────────
console.log("\n[4] archive via archive_document RPC (atomic flip + chunk delete)");

for (const [label, id] of [["A", SENTINEL_A_ID], ["B", SENTINEL_B_ID], ["C", SENTINEL_C_ID]]) {
  const { data, error } = await sb.rpc("archive_document", { p_doc_id: id });
  if (error) {
    bad(`${label} archive RPC failed: ${error.message}`);
    continue;
  }
  const r = data?.[0];
  ok(`${label} ${id}: archived=${r.archived}, chunks_deleted=${r.chunks_deleted}`);
}

const afterArchA = await chunkCount(SENTINEL_A_ID);
const afterArchB = await chunkCount(SENTINEL_B_ID);
const afterArchC = await chunkCount(SENTINEL_C_ID);
console.log(`  post-archive chunk counts: A=${afterArchA}, B=${afterArchB}, C=${afterArchC}`);

if (afterArchA === 0 && afterArchB === 0 && afterArchC === 0) {
  ok(`ALL 3 sentinels at 0 chunks - archive integrity confirmed across doc_classes`);
} else {
  bad(`expected 0/0/0, got A=${afterArchA}, B=${afterArchB}, C=${afterArchC}`);
}

// ── [5] Restore each via restoreDocument (the half CP1 couldn't test) ────────
console.log("\n[5] restore via restoreDocument (re-embed by doc_class, then flip)");

for (const [label, id] of [["A", SENTINEL_A_ID], ["B", SENTINEL_B_ID], ["C", SENTINEL_C_ID]]) {
  try {
    const r = await restoreDocument({ docId: id });
    ok(`${label} ${id}: path=${r.restorePath}, chunks_inserted=${r.chunksInserted}`);
  } catch (e) {
    bad(`${label} restore failed: ${e.message}`);
  }
}

const afterRestA = await chunkCount(SENTINEL_A_ID);
const afterRestB = await chunkCount(SENTINEL_B_ID);
const afterRestC = await chunkCount(SENTINEL_C_ID);
console.log(`  post-restore chunk counts: A=${afterRestA}, B=${afterRestB}, C=${afterRestC}`);

if (afterRestA === beforeA) ok(`A back to ${beforeA} chunks (matches pre-archive)`);
else bad(`A: pre=${beforeA}, post-restore=${afterRestA}`);
if (afterRestB === beforeB) ok(`B back to ${beforeB} chunks (matches pre-archive)`);
else bad(`B: pre=${beforeB}, post-restore=${afterRestB}`);
if (afterRestC === beforeC) ok(`C stayed at ${beforeC} (no-content path - no chunks expected)`);
else bad(`C: pre=${beforeC}, post-restore=${afterRestC}`);

// Verify archived flag flipped back on all 3
console.log("\n  post-restore archived state:");
for (const [label, id] of [["A", SENTINEL_A_ID], ["B", SENTINEL_B_ID], ["C", SENTINEL_C_ID]]) {
  const doc = await fetchDoc(id);
  if (doc.archived === false && doc.archived_at === null) {
    ok(`${label} ${id}: archived=false, archived_at=null`);
  } else {
    bad(`${label} ${id}: archived=${doc.archived}, archived_at=${doc.archived_at}`);
  }
}

// ── [6] Cleanup ──────────────────────────────────────────────────────────────
console.log("\n[6] cleanup sentinels");
for (const id of [SENTINEL_A_ID, SENTINEL_B_ID, SENTINEL_C_ID]) {
  await cleanup(id);
}
ok("3 sentinels deleted (catalog returned to pre-demo state)");

console.log();
if (failures === 0) {
  console.log("PASS - CP2 demo complete.");
  console.log("       Archive: 3 doc_classes, all chunks deleted atomically.");
  console.log("       Restore: 3 dispatch paths exercised, chunks rebuilt where applicable.");
  console.log("       Create: format + uniqueness + prefix↔class checks enforced.");
} else {
  console.log(`FAIL - ${failures} check(s) failed.`);
  process.exit(1);
}
