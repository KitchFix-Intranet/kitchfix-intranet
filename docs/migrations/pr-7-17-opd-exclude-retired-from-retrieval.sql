-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-17-opd-exclude-retired-from-retrieval.sql
-- Project OPD · exclude Retired documents from SousAI retrieval.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this does:
--   CREATE OR REPLACE match_document_chunks() to add `d.status <> 'Retired'`
--   to its WHERE clause. Everything else - signature, ordering, LIMIT,
--   access_level gate, archived gate, embedding-not-null gate - is preserved
--   byte-for-byte from pr-7-11-opd-access-level.sql (the last function body).
--
-- WHY:
--   The 2026-07-24 state audit found 16 documents with status='Retired' and
--   archived=false, together carrying 202 rows in document_chunks. Notably
--   REF-005-A and REF-005-B (fictitious SLA examples Kevin explicitly retired)
--   plus a handful of retired POL/SOP/REF docs whose chunks were never cleaned.
--
--   Retirement carries policy weight - the *SLA example* case is exactly
--   what retirement exists to prevent (a fictitious placeholder resurfacing
--   as an authoritative answer). Once SousAI retrieval ships, without this
--   filter, those chunks would be candidates for match_document_chunks() to
--   return.
--
--   Deleting the orphan chunks (pr-7-18 companion, in a separate PR) only
--   resets the clock; the next document Kevin retires without archiving
--   re-introduces the problem. This filter is the durable fix.
--
-- WHY NOT just check `archived = false`:
--   `archived` (pr-7-7) means "removed from the corpus," which triggers a
--   chunk purge as part of archive_document(). `status = 'Retired'` means
--   "superseded but the id remains resolvable so cross-references still work."
--   Retired-but-not-archived is a legitimate mid-state, and today's retire
--   flow leaves chunks in place. Adding this filter honors that separation:
--   ids remain resolvable, but the content is no longer retrieval-eligible.
--
-- SIGNATURE PRESERVED:
--   Same 3-arg signature: (query_embedding vector(1536), match_count int,
--   allowed_levels text[] DEFAULT NULL). All call sites (SousAI A5, the
--   test harness) continue to work with no code change.
--
-- OTHER READ PATHS AUDITED:
--   The only retrieval path over document_chunks is this function. The
--   other document_chunks readers are:
--     - src/app/api/playbook/route.js line 382: `.eq("doc_id", id)` - reads
--       chunk count for one explicit doc_id from an admin UI. Not a retrieval
--       surface; a status filter is not warranted here.
--     - src/lib/sousai/store.js: DELETE + INSERT for re-embedding a specific
--       doc. Write path, not read.
--     - scripts/_probe_phase2_recon.mjs: audit/probe script.
--   No other function or view reads document_chunks without a status filter.
--
-- IDEMPOTENT:
--   CREATE OR REPLACE. Can re-apply safely.
--
-- ROLLBACK:
--   Re-apply pr-7-11-opd-access-level.sql's function body verbatim to
--   restore the pre-filter behaviour. (Retrieval would again include Retired
--   content until the code catches up.)
--
-- COORDINATION:
--   Migration-only PR; no app code depends on this. SousAI retrieval (A5)
--   is not yet wired in, so no in-flight code path is affected. Applying
--   this in Studio can happen any time. Standard migration-gate discipline
--   from CLAUDE.md still applies for the PR flow.
--
-- VERIFY (after apply):
--   -- Function definition contains the Retired-exclusion clause
--   SELECT pg_get_functiondef('match_document_chunks(vector, int, text[])'::regprocedure)
--     ILIKE '%d.status <> ''Retired''%' AS filter_present;
--   -- expected: t
--
--   -- Smoke-test: a zero vector still returns rows for Live/In Build/etc.
--   -- (not Retired) and none from REF-005-A or the retired POL/SOP set.
--   SELECT d.status, count(*) AS rows_returned
--   FROM match_document_chunks(array_fill(0::real, ARRAY[1536])::vector, 200, NULL) m
--   JOIN documents d ON d.id = m.doc_id
--   GROUP BY d.status
--   ORDER BY d.status;
--   -- expected: no 'Retired' row in the result set.
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
    AND d.status <> 'Retired'
    AND (allowed_levels IS NULL OR d.access_level = ANY(allowed_levels))
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_document_chunks(vector(1536), int, text[]) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-17. Companion pr-7-18 (separate PR) deletes the 202 orphaned
-- chunks currently sitting on 16 Retired documents. This filter alone is
-- sufficient to close the retrieval-side gap; the chunk purge is one-time
-- storage tidy.
-- ─────────────────────────────────────────────────────────────────────────────
