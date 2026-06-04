// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/store.js
// SousAI · Layer 3 · document_chunks storage (delete-then-insert per doc)
// ─────────────────────────────────────────────────────────────────────────────
//
// The single write path for SousAI's retrieval corpus. Re-runnable: every
// call to replaceChunksForDoc fully replaces the (doc_id, language) row
// set in document_chunks. Re-embedding a doc produces the same end state
// every time, regardless of how the chunk count changes across runs.
//
// Why delete-then-insert vs upsert (the L1 schema header documents this
// too): upsert by (doc_id, chunk_index, language) can't shrink. If a
// re-embed produces N-2 chunks where the previous run produced N, the
// last two chunk_index slots become orphans. Delete-then-insert keeps the
// row set exactly aligned to the current extraction.
//
// Not transactional - supabase-js doesn't expose SQL-level transactions.
// During the gap between delete and insert, a retrieval query for this
// doc would see zero chunks. Acceptable because no user-facing path is
// reading while we embed; the pipeline runs out-of-band.
// ─────────────────────────────────────────────────────────────────────────────

// Tuned for supabase-js / PostgREST. The vector(1536) payload is ~7 KB per
// row encoded as JSON, so a 50-row batch is ~350 KB - well under any sane
// HTTP body limit and well above the typical OPD doc's chunk count.
const INSERT_BATCH_SIZE = 50;

/**
 * Replace all document_chunks rows for (docId, language) with the given chunks.
 *
 * @param {ReturnType<typeof import('@supabase/supabase-js').createClient>} supabase
 *   service-role supabase-js client. Caller manages the client lifecycle.
 * @param {string} docId       document id (e.g. "PB-002") - must exist in `documents`
 * @param {string} language    e.g. "en", "es"
 * @param {object[]} rows      already-built rows ready to insert. Each row must
 *   include: doc_id, chunk_index, section, language, content, token_count,
 *   embedding (1536-dim array). is_historical + data_provenance optional
 *   (default to false + 'app_scan' via the schema).
 * @returns {Promise<{ deleted: number, inserted: number }>}
 *
 * Throws on any delete or insert failure. Idempotent within a single call:
 * a re-run produces identical state.
 */
export async function replaceChunksForDoc(supabase, docId, language, rows) {
  // ── delete ────────────────────────────────────────────────────────────────
  const { error: delErr, count: deletedCount } = await supabase
    .from("document_chunks")
    .delete({ count: "exact" })
    .eq("doc_id", docId)
    .eq("language", language);
  if (delErr) {
    throw new Error(
      `replaceChunksForDoc: delete failed for ${docId}/${language}: ${delErr.code || "?"} ${delErr.message}`
    );
  }

  // ── insert ────────────────────────────────────────────────────────────────
  if (!Array.isArray(rows) || rows.length === 0) {
    return { deleted: deletedCount ?? 0, inserted: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error: insErr } = await supabase.from("document_chunks").insert(batch);
    if (insErr) {
      throw new Error(
        `replaceChunksForDoc: insert batch [${i}..${i + batch.length - 1}] failed: ${insErr.code || "?"} ${insErr.message}`
      );
    }
    inserted += batch.length;
  }

  return { deleted: deletedCount ?? 0, inserted };
}
