-- ─────────────────────────────────────────────────────────────────────────────
-- pr-8-1-sousai-chunks.sql
-- SousAI Layer 1: pgvector + document_chunks
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds the chunk storage table for SousAI's retrieval pipeline. Character
-- contract lives in docs/SOUSAI_CHARACTER_SPEC.md; pipeline parking lot in
-- docs/archive/specs/SPEC_INTRANET_AI_SEARCH.md.
--
-- Locked tech choices (from the L1-3 build task):
--   • pgvector in the existing Supabase
--   • OpenAI text-embedding-3-small, 1536-dim
--   • HNSW index for cosine similarity (the right distance for normalized
--     OpenAI embeddings)
--
-- House style mirrors pr-7-1-opd-schema:
--   • is_historical + data_provenance on every table (Module 6 convention).
--     For chunks, ongoing pipeline writes default to 'app_scan' (the closest
--     fit in the existing 4-value enum - chunks are an automated extraction).
--     Manual re-seeds get 'batch_rebuild'. 'manual_entry' is reserved.
--   • RLS disabled - service-role bypasses it. Auth boundary is app-layer
--     (the API gates which docs reach the retrieval step in the first place).
--   • GRANT blocks mandatory - PostgREST returns "permission denied" without
--     them even with RLS off.
--   • Idempotent (IF NOT EXISTS) so re-pasting is a no-op.
--
-- One uniqueness wrinkle: (doc_id, chunk_index, language). The language part
-- exists because POSTER-001 (bilingual) needs EN and ES chunks side by side,
-- with chunk_index 0 legitimately existing for both languages of the same
-- doc.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid (already in pr-7-1; harmless re-declare)

-- ─────────────────────────────────────────────────────────────────────────────
-- document_chunks - retrieval-pipeline storage
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  section          TEXT,                                     -- heading text the chunk belongs to; NULL when extraction couldn't find structure and fell back to size-based chunking
  language         TEXT NOT NULL DEFAULT 'en',
  content          TEXT NOT NULL,                            -- chunk text WITH the "From: {title} ({doc_id}), Section: {heading}" contextual header prepended (what gets embedded)
  token_count      INTEGER,                                  -- estimate; char-based heuristic until tiktoken is wired
  embedding        vector(1536),                             -- OpenAI text-embedding-3-small; nullable so L2 can stage rows before L3 embeds
  is_historical    BOOLEAN NOT NULL DEFAULT false,
  data_provenance  TEXT NOT NULL DEFAULT 'app_scan',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_chunks_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  ),
  CONSTRAINT uq_chunk_per_doc_lang UNIQUE (doc_id, chunk_index, language)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
--   doc_idx: btree on doc_id for "load all chunks for doc X" and per-doc
--   re-embed (delete-then-insert by doc_id).
--
--   hnsw_idx: HNSW on embedding with cosine ops. The retrieval index. Default
--   m + ef_construction are fine for the current corpus size (~40 docs, ~400
--   chunks initial); revisit if the corpus crosses ~100k chunks.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS document_chunks_doc_idx
  ON document_chunks (doc_id);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE document_chunks DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON document_chunks TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON document_chunks TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-8-1. Verify via:
--   node --env-file=.env.local scripts/apply-pr-8-1-sousai-chunks.mjs
-- ─────────────────────────────────────────────────────────────────────────────
