// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/index.js
// SousAI · Pipeline orchestrator · extract -> chunk -> embed -> store
// ─────────────────────────────────────────────────────────────────────────────
//
// Single callable entry point for embedding (or re-embedding) one document.
// No triggers, no queues, no event handlers - the spec's "STANDALONE callable
// unit" framing keeps the pipeline a function the API layer or a CLI can
// invoke directly. Auto-triggering on upload becomes a Layer 4+ concern.
//
// What this function guarantees on success: document_chunks contains exactly
// the chunks produced by re-extracting + re-chunking the Drive file as of
// the moment this function was called, with non-null 1536-dim embeddings on
// every row.
//
// What it does NOT do:
//   - retry transient OpenAI failures (fail-loud; the caller decides retry)
//   - schedule itself (no cron, no trigger)
//   - update documents.* (chunks are derived; the catalog row is canon)
//   - notify on success/failure (caller handles surfacing)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { extractGoogleDoc } from "./extract.js";
import { chunkSections } from "./chunk.js";
import { embedTexts } from "./embed.js";
import { replaceChunksForDoc } from "./store.js";

/**
 * Embed one document end-to-end. Idempotent: re-running fully replaces
 * the existing chunks for (docId, language).
 *
 * @param {object} opts
 * @param {string} opts.docId          document_chunks.doc_id - must exist in documents
 * @param {string} opts.driveFileId    Google Drive file ID for the Doc
 * @param {string} [opts.language]     defaults to "en"
 * @returns {Promise<{
 *   docId: string,
 *   docTitle: string,
 *   driveFileId: string,
 *   language: string,
 *   chunkingPath: 'structure-aware' | 'size-based-fallback',
 *   chunksReplaced: { deleted: number, inserted: number },
 * }>}
 *
 * Throws if:
 *   - documents.{id} doesn't exist (the FK on document_chunks.doc_id would
 *     fail at insert anyway; we surface the issue earlier with a clearer error)
 *   - extraction fails (Drive permission, Doc API not enabled, etc)
 *   - embedding fails (OPENAI_API_KEY missing, 401, 429, dim mismatch)
 *   - the delete-then-insert step fails partway through (chunks may be in
 *     an inconsistent state - re-run to recover)
 */
export async function embedDocument({ docId, driveFileId, language = "en" }) {
  if (!docId) throw new Error("embedDocument: docId is required");
  if (!driveFileId) throw new Error("embedDocument: driveFileId is required");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // ── 1. Resolve canonical title from the catalog ──────────────────────────
  // documents.title is the operator-facing citation text Sous will surface
  // (e.g. "Allergen Playbook"), not the Drive filename. The chunker uses
  // this on every chunk's contextual header.
  const { data: docRow, error: docErr } = await supabase
    .from("documents")
    .select("id, title")
    .eq("id", docId)
    .single();
  if (docErr || !docRow) {
    throw new Error(
      `embedDocument: documents catalog lookup failed for ${docId}: ${docErr?.message || "not found"}`
    );
  }
  const docTitle = docRow.title;

  // ── 2. Extract ────────────────────────────────────────────────────────────
  const extracted = await extractGoogleDoc(driveFileId);

  // ── 3. Chunk ──────────────────────────────────────────────────────────────
  const { path, chunks } = chunkSections(extracted, {
    docId,
    docTitle,
    language,
  });
  if (chunks.length === 0) {
    throw new Error(
      `embedDocument: extraction + chunking produced 0 chunks for ${docId} - aborting before destructive delete`
    );
  }

  // ── 4. Embed ──────────────────────────────────────────────────────────────
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedTexts(texts);
  if (embeddings.length !== chunks.length) {
    // Defensive - embedTexts itself throws on this, but the invariant matters
    // before we touch document_chunks so re-assert here.
    throw new Error(
      `embedDocument: embedding count mismatch (${embeddings.length} embeddings for ${chunks.length} chunks)`
    );
  }

  // ── 5. Build rows + store ────────────────────────────────────────────────
  const rows = chunks.map((chunk, i) => ({
    doc_id: docId,
    chunk_index: chunk.chunk_index,
    section: chunk.section,
    language: chunk.language,
    content: chunk.content,
    token_count: chunk.token_count,
    embedding: embeddings[i],
    is_historical: false,
    data_provenance: "app_scan",
  }));

  const chunksReplaced = await replaceChunksForDoc(supabase, docId, language, rows);

  return {
    docId,
    docTitle,
    driveFileId,
    language,
    chunkingPath: path,
    chunksReplaced,
  };
}
