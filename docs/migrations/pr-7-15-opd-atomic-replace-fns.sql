-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-15-opd-atomic-replace-fns.sql
-- Project OPD · PR 7.15 · atomic delete-all-then-insert for relationships +
-- surfaces (failure-safety hardening for the projection apply step 3 + 4)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this adds:
--   1. replace_document_relationships(p_rows jsonb) RETURNS INT
--   2. replace_document_surfaces(p_rows jsonb) RETURNS INT
--
-- WHY:
--   The projection's apply was doing DELETE-ALL then INSERT for these two
--   tables from JS (scripts/content/project-catalog.mjs steps 3 + 4). The
--   Supabase REST client cannot run BEGIN/COMMIT, so a failure in the INSERT
--   half left the table empty until the next successful re-run. Sub-second
--   window, but real - and B1's whole point is making the projection safe
--   to run unattended (B2 wires the auto-trigger).
--
--   A PL/pgSQL function body executes as a single implicit transaction:
--   either every statement commits, or every statement rolls back. By moving
--   the swap into the function, an insert failure cleanly reverts the
--   delete - the table is never left in a half-state.
--
-- RETURN value:
--   Each function returns INT = the number of rows successfully inserted.
--   The projection compares this against its planned count and halts on
--   mismatch (runtime self-check). Mismatch can never happen in normal
--   operation, but the guard protects against future schema drift / anomalies
--   no test anticipated.
--
-- INPUT shape (matches the existing per-row JS map):
--   replace_document_relationships:
--     [{ "from_doc": "PB-001", "to_doc": "POL-007", "rel_type": "references" }, ...]
--   replace_document_surfaces:
--     [{ "doc_id": "AGR-001", "surface": "new-hire-onboarding" }, ...]
--   Defaults fire for is_historical / data_provenance / created_at / id (uuid).
--
-- SECURITY:
--   LANGUAGE plpgsql, default SECURITY INVOKER (mirrors archive_document
--   from pr-7-7). The projection uses the service-role client which already
--   has INSERT/DELETE on both tables via the existing GRANTs.
--
-- IDEMPOTENT:
--   CREATE OR REPLACE. Re-pasting in Studio is safe.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS replace_document_relationships(jsonb);
--   DROP FUNCTION IF EXISTS replace_document_surfaces(jsonb);
--   The projection app-side change must be reverted in lockstep (it now
--   calls these functions; reverting the SQL alone leaves the script
--   calling a function that does not exist).
--
-- COORDINATION:
--   Apply this migration in Studio BEFORE the next `--apply` run of the
--   projection. The projection app-side change ships in the same PR; once
--   merged, `--apply` calls these RPCs and will fail with "function does
--   not exist" if the migration has not been pasted yet. Same silent-gap
--   discipline as pr-9-1.
--
-- VERIFY (after apply):
--   node --env-file=.env.local scripts/verify-opd-atomic-replace.mjs
--   See header of that script. It crafts a failing payload and confirms
--   the DELETE rolled back (row count unchanged).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION replace_document_relationships(p_rows jsonb)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- TRUNCATE instead of DELETE: Supabase's REST gateway rejects naked
  -- DELETE-without-WHERE even inside RPC function bodies ("DELETE requires
  -- a WHERE clause"). TRUNCATE is not subject to that guard, is fully
  -- transactional inside a function body (rollback semantics identical),
  -- and faster for full-table swaps. service_role's GRANT in pr-7-1 already
  -- includes TRUNCATE.
  TRUNCATE TABLE document_relationships;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO document_relationships (from_doc, to_doc, rel_type)
  SELECT x.from_doc, x.to_doc, x.rel_type
  FROM jsonb_to_recordset(p_rows) AS x(from_doc TEXT, to_doc TEXT, rel_type TEXT);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_document_relationships(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION replace_document_surfaces(p_rows jsonb)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- See replace_document_relationships above for the TRUNCATE rationale.
  TRUNCATE TABLE document_surfaces;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO document_surfaces (doc_id, surface)
  SELECT x.doc_id, x.surface
  FROM jsonb_to_recordset(p_rows) AS x(doc_id TEXT, surface TEXT);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_document_surfaces(jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-15. Verify via:
--   node --env-file=.env.local scripts/verify-opd-atomic-replace.mjs
-- Then the next `--apply` of the projection is safe.
-- ─────────────────────────────────────────────────────────────────────────────
