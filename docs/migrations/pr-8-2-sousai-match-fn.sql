-- ─────────────────────────────────────────────────────────────────────────────
-- pr-8-2-sousai-match-fn.sql
-- SousAI · vector retrieval RPC for document_chunks
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Postgres function that returns the top-N most similar chunks for a
-- query embedding via HNSW cosine. Callable from supabase-js as
-- supabase.rpc('match_document_chunks', { query_embedding, match_count }).
--
-- Why a function rather than a raw query: PostgREST's query builder doesn't
-- expose the pgvector <=> operator, so retrieval has to go through an RPC.
-- This also gives retrieval a single, named entry point the app code will
-- keep calling forever - the function IS the retrieval contract.
--
-- Similarity vs distance: pgvector's <=> returns cosine DISTANCE (lower =
-- better). The function returns SIMILARITY (1 - distance, higher = better)
-- because that's the natural framing for "how confident is this match" in
-- caller code. The ORDER BY still uses distance ascending so the HNSW index
-- can be used (vector_cosine_ops).
--
-- Idempotent via CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  doc_id text,
  chunk_index int,
  section text,
  content text,
  token_count int,
  language text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id AS chunk_id,
    doc_id,
    chunk_index,
    section,
    content,
    token_count,
    language,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_document_chunks(vector(1536), int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-8-2. Verify by calling from the harness:
--   node --env-file=.env.local scripts/sousai-retrieval-test.mjs
-- ─────────────────────────────────────────────────────────────────────────────
