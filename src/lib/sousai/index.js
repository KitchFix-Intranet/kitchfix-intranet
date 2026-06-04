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

// Doc classes that are visual references (posters, wall postings) rather
// than text documents. These get a single stub chunk via embedPosterStub
// instead of going through the Google Docs API extraction path. PDFs in
// these classes can't be read by the Docs API and the visual layout
// doesn't survive flat-text extraction in a useful way - we point to the
// upstream text source (see SOUSAI_CHARACTER_SPEC.md decision log) and
// keep retrieval focused on the prose-bearing docs.
export const SKIP_TEXT_EXTRACTION_CLASSES = ["POST"];

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
 *   - documents.{id}.doc_class is in SKIP_TEXT_EXTRACTION_CLASSES (use
 *     embedPosterStub instead - a 0-section extraction from a poster PDF
 *     is harder to debug than a clear up-front error)
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

  // ── 1. Resolve canonical title + class guard from the catalog ────────────
  // documents.title is the operator-facing citation text Sous will surface
  // (e.g. "Allergen Playbook"), not the Drive filename. The chunker uses
  // this on every chunk's contextual header.
  //
  // doc_class is pulled for the SKIP_TEXT_EXTRACTION_CLASSES guard - posters
  // route through embedPosterStub, not text extraction.
  const { data: docRow, error: docErr } = await supabase
    .from("documents")
    .select("id, title, doc_class")
    .eq("id", docId)
    .single();
  if (docErr || !docRow) {
    throw new Error(
      `embedDocument: documents catalog lookup failed for ${docId}: ${docErr?.message || "not found"}`
    );
  }
  if (SKIP_TEXT_EXTRACTION_CLASSES.includes(docRow.doc_class)) {
    throw new Error(
      `embedDocument: ${docId} has doc_class '${docRow.doc_class}' which is a visual reference - use embedPosterStub instead`
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

// Char-based token estimate, matching chunk.js's CHARS_PER_TOKEN. Kept
// inlined here rather than imported because it's a single Math.ceil and
// not worth a dependency between files just for sharing the constant.
const POSTER_STUB_CHARS_PER_TOKEN = 4;

/**
 * Embed a poster (or other visual-reference doc) as a single stub chunk.
 *
 * This is the SKIP_TEXT_EXTRACTION_CLASSES path: the doc is a PDF wall
 * posting, the Docs API can't read it, and the visual layout doesn't
 * survive text extraction usefully anyway. Instead of trying to extract
 * the content, we write a single chunk that says "this thing exists,
 * here's its metadata, here's where the source text actually lives" -
 * so retrieval queries about the poster surface a useful citation
 * pointer instead of either silently missing or polluting results with
 * extracted-PDF garbage.
 *
 * The stub content embeds:
 *   - the contextual `From: {title} ({docId})` header (no Section: -
 *     the stub has no section structure)
 *   - the "this is a wall posting" disclaimer (so the embedding itself
 *     teaches the model this is a meta-stub, not real content)
 *   - the catalog's card_line if present
 *   - the catalog's summary if present (this is the load-bearing line:
 *     it's where the upstream source doc reference lives, e.g.
 *     "EN+ES wall posting derived from AGR-001.")
 *
 * @param {object} opts
 * @param {string} opts.docId        documents.id for a poster/visual-reference doc
 * @param {string} [opts.language]   defaults to "en". One stub row per doc
 *                                   regardless of the poster's bilingual status -
 *                                   the stub is meta-information, not translatable content.
 * @returns {Promise<{
 *   docId: string,
 *   docTitle: string,
 *   docClass: string,
 *   language: string,
 *   isStub: true,
 *   chunksReplaced: { deleted: number, inserted: number },
 * }>}
 *
 * Throws if:
 *   - docId not in documents
 *   - documents.doc_class is NOT in SKIP_TEXT_EXTRACTION_CLASSES (this
 *     function is only for visual-reference docs; text docs go through
 *     embedDocument)
 *   - embedding fails (auth, rate-limit, dim mismatch)
 *   - the delete-then-insert step fails
 */
export async function embedPosterStub({ docId, language = "en" }) {
  if (!docId) throw new Error("embedPosterStub: docId is required");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: docRow, error: docErr } = await supabase
    .from("documents")
    .select("id, title, doc_class, card_line, summary")
    .eq("id", docId)
    .single();
  if (docErr || !docRow) {
    throw new Error(
      `embedPosterStub: documents catalog lookup failed for ${docId}: ${docErr?.message || "not found"}`
    );
  }
  if (!SKIP_TEXT_EXTRACTION_CLASSES.includes(docRow.doc_class)) {
    throw new Error(
      `embedPosterStub: ${docId} has doc_class '${docRow.doc_class}', not in SKIP_TEXT_EXTRACTION_CLASSES [${SKIP_TEXT_EXTRACTION_CLASSES.join(", ")}]. Use embedDocument for text docs.`
    );
  }

  // Build stub content. Order: contextual header, blank line, disclaimer,
  // then card_line + summary lines (each omitted if null so we never print
  // "Card description: null").
  const lines = [
    `From: ${docRow.title} (${docId})`,
    "",
    "This is a wall posting (visual reference). It is not indexed for text retrieval.",
  ];
  if (docRow.card_line) lines.push(`Card description: ${docRow.card_line}`);
  if (docRow.summary) lines.push(`Summary: ${docRow.summary}`);
  const content = lines.join("\n");

  const [embedding] = await embedTexts([content]);

  const row = {
    doc_id: docId,
    chunk_index: 0,
    section: null,
    language,
    content,
    token_count: Math.ceil(content.length / POSTER_STUB_CHARS_PER_TOKEN),
    embedding,
    is_historical: false,
    data_provenance: "app_scan",
  };

  const chunksReplaced = await replaceChunksForDoc(supabase, docId, language, [row]);

  return {
    docId,
    docTitle: docRow.title,
    docClass: docRow.doc_class,
    language,
    isStub: true,
    chunksReplaced,
  };
}
