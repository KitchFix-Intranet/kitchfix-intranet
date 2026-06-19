-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-11-opd-access-level.sql
-- Project OPD · 3-tier access gate · adds documents.access_level + extends the
-- SousAI retrieval RPC to filter by it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds a hierarchical access_level enum to documents so restricted and
-- SLT-only docs can live in the OPD + SousAI without being visible to every
-- @kitchfix.com session. The gate is hierarchical (a higher tier sees its own
-- level + every level below):
--
--   unrestricted  - any authenticated @kitchfix.com session (all current 101 docs)
--   restricted    - the Restricted group + the SLT group
--   slt           - the SLT group only
--
-- Membership (Restricted, SLT) lives as hardcoded lowercased lists in
-- src/lib/opdAcl.js - explicit + auditable; changing membership is a code
-- edit + deploy. The DB only knows the document's required tier; the viewer's
-- tier is resolved app-side from the authenticated session email.
--
-- WHAT this does:
--   1. Add documents.access_level TEXT NOT NULL DEFAULT 'unrestricted' with a
--      CHECK constraint to the 3-value set. Index it for the bootstrap-filter
--      JOIN path that the SousAI retrieval RPC uses.
--   2. CREATE OR REPLACE match_document_chunks() so it accepts an optional
--      allowed_levels TEXT[] argument and JOINs to documents to enforce
--      access_level ∈ allowed_levels. Callers (SousAI A5) pass the resolved
--      set for the viewer's tier; the test harness can pass NULL to mean
--      "no filter" (the harness is service-role local-only).
--   3. The existing 1-arg call signature is preserved (defaults allowed_levels
--      to NULL = no filter) so existing scripts keep working.
--
-- ROW-LEVEL DEFAULT:
--   All 101 docs currently in production projected at A4 inherit
--   'unrestricted'. The projection (scripts/content/project-catalog.mjs)
--   maps frontmatter access_level into the row at upsert time; absent or
--   null frontmatter -> 'unrestricted'. Re-running the projection apply
--   after Kevin tags any doc 'restricted'/'slt' in MDX promotes it.
--
-- IDEMPOTENT:
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT with
--   IF EXISTS-then-drop pattern, CREATE OR REPLACE on the RPC.
--
-- ROLLBACK:
--   - Restore the prior 1-arg match_document_chunks (the body without the
--     JOIN to documents - see pr-7-2-sousai-match-fn.sql for the original):
--       (re-apply the prior CREATE OR REPLACE)
--   - Drop the column:
--       ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_access_level;
--       ALTER TABLE documents DROP COLUMN IF EXISTS access_level;
--   - The app code revert restores the pre-gate enforcement.
--
-- COORDINATION:
--   The dependent app code (opdAcl resolver + the three enforcement call
--   sites) is in the same PR; the projection script change is in the same
--   PR too. **Apply this migration in Studio FIRST**, then ship the code
--   merge. Same silent-gap discipline as pr-9-1 noted in MIGRATION_PROJECT_CLOSEOUT.
--
-- VERIFY (after apply):
--   -- Column + constraint exist
--   SELECT column_name, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'documents' AND column_name = 'access_level';
--
--   -- Every row defaulted to 'unrestricted'
--   SELECT access_level, count(*) FROM documents GROUP BY access_level;
--   -- expected: 'unrestricted' = (total row count); no other values
--
--   -- RPC signature
--   \df match_document_chunks
--   -- expected: 3 args (query_embedding vector, match_count int, allowed_levels text[])
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'unrestricted';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_access_level;
ALTER TABLE documents ADD CONSTRAINT chk_documents_access_level CHECK (
  access_level IN ('unrestricted', 'restricted', 'slt')
);

CREATE INDEX IF NOT EXISTS documents_access_level_idx ON documents (access_level);

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend match_document_chunks to filter by access_level.
-- The original 1-arg + 2-arg signatures are preserved by giving the new
-- allowed_levels arg a default of NULL = "no filter" (back-compat for the
-- existing test harness).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  allowed_levels text[] DEFAULT NULL
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
    c.id AS chunk_id,
    c.doc_id,
    c.chunk_index,
    c.section,
    c.content,
    c.token_count,
    c.language,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM document_chunks c
  JOIN documents d ON d.id = c.doc_id
  WHERE c.embedding IS NOT NULL
    AND d.archived = false
    AND (allowed_levels IS NULL OR d.access_level = ANY(allowed_levels))
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_document_chunks(vector(1536), int, text[]) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-11. Next: app code (in this PR) consumes documents.access_level
-- at the bootstrap filter, the detail handler, and (when A5 wires retrieval)
-- via the allowed_levels argument to match_document_chunks.
-- ─────────────────────────────────────────────────────────────────────────────
