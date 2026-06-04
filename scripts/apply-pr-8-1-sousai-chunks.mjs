// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-8-1-sousai-chunks.mjs
// SousAI Layer 1 verify - after pasting pr-8-1-sousai-chunks.sql in Studio.
//
// Studio-then-verify pattern, same as pr-7-4 / pr-7-5. Supabase has no
// exec_sql RPC, so DDL goes through Studio; this script confirms what
// landed by exercising the table from the supabase-js side:
//
//   1. document_chunks table exists + readable
//   2. vector(1536) column round-trips a 1536-dim vector
//   3. FK to documents(id) is enforced (orphan insert rejected)
//   4. uq_chunk_per_doc_lang is enforced (duplicate insert rejected)
//   5. cleanup leaves no test rows behind
//
// What this script CANNOT verify directly: index existence. PostgREST doesn't
// expose pg_indexes by default. The script prints a Studio query at the end
// that the user can paste to eyeball the index list, plus the expected names.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let failures = 0;
const ok   = (m) => console.log(`  ok   ${m}`);
const bad  = (m) => { console.error(`  FAIL ${m}`); failures++; };

// A real Live doc the FK can reference. AGR-001 is Live with a Drive file
// per the PR 7.6 upload batch; using it keeps the FK probe representative.
const PROBE_DOC = "AGR-001";

console.log("verify pr-8-1-sousai-chunks (post-Studio)\n");

// ── [1] table exists ────────────────────────────────────────────────────────
console.log("[1] table exists + readable");
{
  const { error } = await sb.from("document_chunks").select("id").limit(1);
  if (error) {
    if (error.code === "42P01" || /relation .* does not exist/i.test(error.message || "")) {
      bad(`document_chunks table NOT FOUND - paste pr-8-1-sousai-chunks.sql in Studio first`);
      console.log();
      console.log("FAIL — table missing. Apply via Studio, then re-run.");
      process.exit(1);
    }
    bad(`select probe failed: ${error.code || "?"}: ${error.message}`);
  } else {
    ok("document_chunks readable");
  }
}

// ── [2] vector(1536) column round-trip ──────────────────────────────────────
console.log("\n[2] vector(1536) column round-trip");
// Build a 1536-dim vector. Values themselves don't matter; we just need the
// type cast and the storage round-trip to work.
const probeVec = Array.from({ length: 1536 }, (_, i) => (i % 7) * 0.01);
const probeRow = {
  doc_id: PROBE_DOC,
  chunk_index: 999999,           // sentinel; cleaned up below
  language: "_test",             // sentinel language so we don't collide with real chunks
  content: "[pr-8-1 verify probe — should be deleted by this script]",
  token_count: 16,
  embedding: probeVec,
  data_provenance: "manual_entry",
};
{
  const { data, error } = await sb.from("document_chunks").insert(probeRow).select("id, embedding").single();
  if (error) {
    bad(`probe insert failed: ${error.code || "?"}: ${error.message}`);
  } else {
    // PostgREST returns the vector as a string like "[0,0.01,...]" - just verify it's there.
    const got = data?.embedding;
    if (got == null) {
      bad("probe insert returned NULL embedding (column may not be vector type)");
    } else {
      const parsed = typeof got === "string" ? JSON.parse(got) : got;
      if (Array.isArray(parsed) && parsed.length === 1536) {
        ok(`inserted + read back 1536-dim vector (got length ${parsed.length})`);
      } else {
        bad(`embedding came back as ${typeof got} length ${Array.isArray(parsed) ? parsed.length : "?"}`);
      }
    }
  }
}

// ── [3] FK enforced ─────────────────────────────────────────────────────────
console.log("\n[3] FK to documents(id) enforced");
{
  const { error } = await sb.from("document_chunks").insert({
    doc_id: "ZZ-NOPE-9999",
    chunk_index: 0,
    language: "_test",
    content: "should fail",
  });
  if (!error) {
    bad("orphan doc_id insert was ACCEPTED - FK constraint missing?");
  } else if (error.code === "23503" || /foreign key/i.test(error.message || "")) {
    ok(`orphan doc_id rejected (${error.code})`);
  } else {
    bad(`unexpected error on FK probe: ${error.code || "?"}: ${error.message}`);
  }
}

// ── [4] uq_chunk_per_doc_lang enforced ──────────────────────────────────────
console.log("\n[4] UNIQUE (doc_id, chunk_index, language) enforced");
{
  const { error } = await sb.from("document_chunks").insert({
    doc_id: PROBE_DOC,
    chunk_index: 999999,
    language: "_test",
    content: "duplicate of the probe row above",
  });
  if (!error) {
    bad("duplicate (doc_id, chunk_index, language) insert was ACCEPTED - unique constraint missing?");
  } else if (error.code === "23505" || /unique|duplicate key/i.test(error.message || "")) {
    ok(`duplicate rejected (${error.code})`);
  } else {
    bad(`unexpected error on uniqueness probe: ${error.code || "?"}: ${error.message}`);
  }
}

// ── [5] cleanup ─────────────────────────────────────────────────────────────
console.log("\n[5] cleanup probe rows");
{
  const { error, count } = await sb
    .from("document_chunks")
    .delete({ count: "exact" })
    .eq("language", "_test");
  if (error) {
    bad(`cleanup delete failed: ${error.code || "?"}: ${error.message}`);
  } else {
    ok(`cleaned up ${count ?? "?"} probe row(s)`);
  }
}

console.log();
if (failures === 0) {
  console.log("PASS — pr-8-1 table + FK + uniqueness + vector(1536) all verified.");
  console.log();
  console.log("Index existence isn't probeable via PostgREST (no pg_indexes exposure).");
  console.log("Paste this in Supabase Studio to eyeball:");
  console.log();
  console.log("  SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' ORDER BY indexname;");
  console.log();
  console.log("Expected 4 rows:");
  console.log("  document_chunks_doc_idx              (btree on doc_id)");
  console.log("  document_chunks_embedding_hnsw_idx   (HNSW on embedding, vector_cosine_ops)");
  console.log("  document_chunks_pkey                 (PK on id)");
  console.log("  uq_chunk_per_doc_lang                (UNIQUE on doc_id, chunk_index, language)");
  process.exit(0);
} else {
  console.log(`FAIL — ${failures} check(s).`);
  process.exit(1);
}
