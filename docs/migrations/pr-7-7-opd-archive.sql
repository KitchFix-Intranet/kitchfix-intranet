-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-7-opd-archive.sql
-- Project OPD · PR 7.7 · documents.archived + atomic archive RPC
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this adds:
--   1. documents.archived BOOLEAN (default false) + documents.archived_at
--      TIMESTAMPTZ. Orthogonal to status: a Live doc and a Pending doc are
--      both archivable, and both keep their status so restore returns them
--      to where they were.
--   2. A partial index on (archived_at DESC) WHERE archived = true - the
--      archive view queries the minority (probably <20% of the catalog
--      long-term), so a partial index is right-sized. Active-view queries
--      scan ~40 rows and don't need a separate index.
--   3. archive_document(p_doc_id TEXT) function - the SOUS-INTEGRITY
--      guarantee. Flips archived=true AND deletes ALL document_chunks for
--      the doc in ONE transaction. Either both succeed or both fail; never
--      a half-state where Sous can still cite a doc that's hidden from
--      operators, or where operators see a doc that Sous can't find.
--
-- RESTORE is INTENTIONALLY NOT an RPC. Restore re-embeds via OpenAI (seconds
-- of async work) and must dispatch on doc_class (POSTER -> stub path,
-- everything else -> full extract+chunk+embed). The orchestration lives in
-- the API route, which sets archived=false LAST (after re-embed succeeds)
-- so we never have a "visible-but-not-embedded" half-state on the way back.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE
-- OR REPLACE FUNCTION. Re-pasting is safe.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS documents_archived_idx
  ON documents (archived_at DESC) WHERE archived = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- archive_document(p_doc_id) - atomic archive
--
-- Returns one row with (document_id, archived, chunks_deleted):
--   - On a doc that existed and was active: archived=true, chunks_deleted=N
--   - On a doc that was already archived:    archived=true, chunks_deleted=0
--   - On a doc that doesn't exist:           returns 0 rows (caller 404s)
--
-- Note: chunks_deleted is the count from THIS call. It's 0 on the
-- already-archived path because the UPDATE matches 0 rows, so the DELETE
-- branch is skipped. To distinguish "just archived" from "was already
-- archived" by the count, callers should treat chunks_deleted>0 as
-- "archive happened this call" and chunks_deleted=0 with archived=true
-- as "no-op (already archived OR doc had 0 chunks)".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_document(p_doc_id TEXT)
RETURNS TABLE (document_id TEXT, archived BOOLEAN, chunks_deleted INT)
LANGUAGE plpgsql
AS $$
-- The OUT parameter `archived` from RETURNS TABLE shadows the
-- documents.archived column name. Without this directive, plpgsql can't
-- decide whether `archived = false` in the UPDATE's WHERE refers to the
-- column or the OUT param and errors with 42702 (ambiguous reference).
-- `use_column` tells plpgsql: when a name collision exists, prefer the
-- column. The OUT param is still assignable via RETURN QUERY at the end.
#variable_conflict use_column
DECLARE
  v_deleted INT := 0;
BEGIN
  UPDATE documents
  SET archived = true,
      archived_at = now(),
      updated_at = now()
  WHERE id = p_doc_id AND archived = false;

  IF FOUND THEN
    DELETE FROM document_chunks WHERE doc_id = p_doc_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN QUERY
    SELECT d.id::TEXT, d.archived, v_deleted
    FROM documents d
    WHERE d.id = p_doc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION archive_document(TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-7. Verify via:
--   node --env-file=.env.local scripts/verify-pr-7-7-opd-archive.mjs
-- ─────────────────────────────────────────────────────────────────────────────
