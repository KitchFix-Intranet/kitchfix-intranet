-- ═══════════════════════════════════════════════════════════════════
-- academy-4-obligations-rpc.sql
--
-- Two RPCs that let scripts/content/project-catalog.mjs write
-- obligations from MDX frontmatter into academy_obligations
-- atomically and clean up rows for documents removed from the
-- corpus.
--
-- No tables created. No schema shape changes. This is glue between
-- the projection script and the academy_obligations table created
-- by academy-3-assignment-layer.sql.
--
-- Functions authored
-- ──────────────────
--   replace_document_obligations(p_doc_id TEXT, p_rows JSONB)
--       RETURNS INT   -- rows inserted
--
--   sweep_orphan_obligations(p_live_doc_ids TEXT[])
--       RETURNS INT   -- rows deleted
--
-- Why these are RPCs (not two statements from JS)
-- ───────────────────────────────────────────────
-- The Supabase REST client cannot run BEGIN/COMMIT. A crash between
-- a per-doc DELETE and its follow-up INSERTs from application code
-- would leave the table with removed obligations lingering
-- indefinitely, and an obligation that no longer exists in the
-- content must NOT be able to issue requirements later. A plpgsql
-- function body runs as one implicit transaction: either every
-- statement commits or every statement rolls back. Same reasoning
-- as pr-7-15-opd-atomic-replace-fns.sql, which established the
-- pattern for replace_document_relationships +
-- replace_document_surfaces.
--
-- Why scoped DELETE, not TRUNCATE
-- ───────────────────────────────
-- pr-7-15 uses TRUNCATE because those two tables are swapped
-- whole-corpus per apply. academy_obligations is different in two
-- ways: (a) the write is per-document, so a scoped DELETE ...
-- WHERE doc_id = ... is the correct unit; (b) academy-3 revoked
-- TRUNCATE from service_role explicitly to guard the sibling
-- academy_requirements ledger, and touching TRUNCATE here would
-- undo that discipline. A DELETE with a WHERE clause is safe from
-- the "Supabase REST rejects naked DELETE-without-WHERE" guard
-- (pr-7-15:73-78) because the WHERE is present.
--
-- SECURITY
-- ────────
-- LANGUAGE plpgsql, default SECURITY INVOKER (mirrors
-- replace_document_relationships from pr-7-15 and archive_document
-- from pr-7-7). The projection uses the service-role client which
-- already has SELECT / INSERT / UPDATE / DELETE on
-- academy_obligations via academy-3-assignment-layer.sql:329.
--
-- IDEMPOTENT
-- ──────────
-- CREATE OR REPLACE FUNCTION on both. Re-pasting in Studio is safe.
--
-- ROLLBACK
-- ────────
--   DROP FUNCTION IF EXISTS replace_document_obligations(TEXT, JSONB);
--   DROP FUNCTION IF EXISTS sweep_orphan_obligations(TEXT[]);
--
-- COORDINATION
-- ────────────
-- Apply this migration in Studio BEFORE the projection script
-- extension merges. The script's step 6 calls these RPCs and will
-- fail with "function does not exist" if the migration has not been
-- pasted yet. Same silent-gap discipline as pr-9-1 and pr-7-15.
-- ═══════════════════════════════════════════════════════════════════


-- ─── replace_document_obligations ──────────────────────────────────
-- Atomic per-document swap. Deletes every row in academy_obligations
-- for p_doc_id, then inserts the supplied set. Returns the inserted
-- count so the caller can compare against its planned count and
-- halt on drift (same runtime guard as replace_document_relationships).
--
-- Input shape (from JS):
--   [
--     {
--       "obligation_key": "big-rules-annual",
--       "doc_version":    "1.1",
--       "type":           "training",
--       "cadence":        "annual",
--       "owner":          "People Operations",
--       "source_section": null,
--       "description":    "...",
--       "est_minutes":    12,
--       "next_due":       null,
--       "applies_to":     { "worker_class": "all" },   -- OR "company-wide"
--       "source_hash":    "sha256hex..."
--     },
--     ...
--   ]
--
-- applies_to may be either a JSON string ("company-wide") or a JSON
-- object; both are valid per the frontmatter schema oneOf. The
-- column is JSONB, so both round-trip unchanged.
--
-- p_doc_id must exist in documents(id) or the INSERT fails on the
-- FK (academy_obligations.doc_id REFERENCES documents(id)); the
-- caller is expected to have UPSERTed the documents row earlier in
-- the same apply run.
CREATE OR REPLACE FUNCTION replace_document_obligations(p_doc_id TEXT, p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  -- Scoped delete: safe from the Supabase REST "naked DELETE" guard
  -- because the WHERE clause is present. Removes only this document's
  -- obligations; other documents are untouched.
  DELETE FROM academy_obligations WHERE doc_id = p_doc_id;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO academy_obligations (
    doc_id,
    obligation_key,
    doc_version,
    type,
    cadence,
    owner,
    source_section,
    description,
    est_minutes,
    applies_to,
    next_due,
    source_hash
  )
  SELECT
    p_doc_id,
    x.obligation_key,
    x.doc_version,
    x.type,
    x.cadence,
    x.owner,
    x.source_section,
    x.description,
    x.est_minutes,
    COALESCE(x.applies_to, '{}'::JSONB),
    x.next_due,
    x.source_hash
  FROM jsonb_to_recordset(p_rows) AS x(
    obligation_key TEXT,
    doc_version    TEXT,
    type           TEXT,
    cadence        TEXT,
    owner          TEXT,
    source_section TEXT,
    description    TEXT,
    est_minutes    INTEGER,
    applies_to     JSONB,
    next_due       DATE,
    source_hash    TEXT
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION replace_document_obligations(TEXT, JSONB) TO service_role;


-- ─── sweep_orphan_obligations ──────────────────────────────────────
-- Deletes every academy_obligations row whose doc_id is NOT in the
-- supplied array. Called once per apply, at the end of step 6, with
-- the full list of doc_ids currently parsed from the MDX corpus.
--
-- The FK on academy_obligations.doc_id -> documents(id) is
-- ON DELETE CASCADE, but archive_document (pr-7-7) only flips a
-- flag - it does not DELETE the parent row - so cascade NEVER fires
-- on archive. This sweep is the only mechanism that clears an
-- archived document's obligations (an archived doc is absent from
-- the projected MDX corpus because the projection reads only the
-- filesystem, and the archive path removes the file from the corpus
-- semantically even when the row survives).
--
-- If p_live_doc_ids is NULL or empty, the sweep would delete ALL
-- rows. That is legitimate (the corpus really is empty) but rare;
-- either way the WHERE clause is present so the Supabase REST guard
-- does not object.
CREATE OR REPLACE FUNCTION sweep_orphan_obligations(p_live_doc_ids TEXT[])
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF p_live_doc_ids IS NULL OR array_length(p_live_doc_ids, 1) IS NULL THEN
    -- Empty corpus: sweep everything. Rare but valid.
    DELETE FROM academy_obligations WHERE TRUE;
  ELSE
    DELETE FROM academy_obligations
    WHERE doc_id <> ALL (p_live_doc_ids);
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION sweep_orphan_obligations(TEXT[]) TO service_role;


-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K
--
--   P1 + P2 run cleanly and are safe on every apply.
--
--   P3 + P4 are commented-out probes Kevin runs DELIBERATELY - they
--   are DML wrapped in BEGIN / ROLLBACK, so they never leave data
--   behind, but they still touch the table and belong outside the
--   automatic apply so a rerun is a conscious act.
--
-- ═══════════════════════════════════════════════════════════════════

-- P1. Both functions exist and are executable by service_role.
-- Expected: 2 rows.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('replace_document_obligations', 'sweep_orphan_obligations')
ORDER BY p.proname;

-- P2. Grants: service_role can EXECUTE both.
-- Expected: 2 rows, both grantee=service_role.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('replace_document_obligations', 'sweep_orphan_obligations')
  AND privilege_type = 'EXECUTE'
ORDER BY routine_name, grantee;


-- ─── P3 (probe, run deliberately) ──────────────────────────────────
-- replace_document_obligations round-trips both applies_to shapes
-- and returns the correct count. Uses PB-014 as the FK anchor
-- (existing Live doc). Runs in BEGIN/ROLLBACK so no state persists.
--
-- Expected on run:
--   inserted_first  = 2
--   final_count     = 1   (second call replaced the first)
--   final_applies_to     = '"company-wide"'::jsonb   (string form)
--
--   BEGIN;
--   SELECT replace_document_obligations('PB-014', $j$[
--     {
--       "obligation_key": "p3-a",
--       "doc_version":    "p3",
--       "type":           "training",
--       "cadence":        "annual",
--       "owner":          "probe",
--       "applies_to":     { "worker_class": "salaried" },
--       "source_hash":    "p3-hash-a"
--     },
--     {
--       "obligation_key": "p3-b",
--       "doc_version":    "p3",
--       "type":           "training",
--       "cadence":        "on-hire",
--       "owner":          "probe",
--       "applies_to":     "company-wide",
--       "source_hash":    "p3-hash-b"
--     }
--   ]$j$::jsonb) AS inserted_first;
--
--   SELECT replace_document_obligations('PB-014', $j$[
--     {
--       "obligation_key": "p3-c",
--       "doc_version":    "p3",
--       "type":           "training",
--       "cadence":        "annual",
--       "owner":          "probe",
--       "applies_to":     "company-wide",
--       "source_hash":    "p3-hash-c"
--     }
--   ]$j$::jsonb) AS inserted_second;
--
--   SELECT count(*) AS final_count, applies_to AS final_applies_to
--   FROM academy_obligations
--   WHERE doc_id = 'PB-014' AND owner = 'probe'
--   GROUP BY applies_to;
--
--   ROLLBACK;


-- ─── P4 (probe, run deliberately) ──────────────────────────────────
-- sweep_orphan_obligations. Inserts 2 sentinel rows on two different
-- docs, sweeps with only one in the live list, expects 1 deletion.
--
-- Expected on run: swept = 1, remaining = 1 (only PB-014's row).
--
--   BEGIN;
--   SELECT replace_document_obligations('PB-014', $j$[
--     {"obligation_key":"p4","doc_version":"p4","type":"training","cadence":"annual","owner":"probe","source_hash":"p4"}
--   ]$j$::jsonb);
--   SELECT replace_document_obligations('PB-006', $j$[
--     {"obligation_key":"p4","doc_version":"p4","type":"training","cadence":"annual","owner":"probe","source_hash":"p4"}
--   ]$j$::jsonb);
--   SELECT sweep_orphan_obligations(ARRAY['PB-014']) AS swept;
--   SELECT count(*) AS remaining FROM academy_obligations WHERE owner = 'probe';
--   ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file in Studio. The
-- migration-gate check on this PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account and
-- re-emits the check_run on the current SHA.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- p1_functions:       <expected 2 rows>
-- p2_grants:          <expected 2 rows, both service_role>
-- p3_replace_probe:   <run probe; expected inserted_first=2, inserted_second=1, final applies_to = "company-wide">
-- p4_sweep_probe:     <run probe; expected swept=1, remaining=1>
-- notes:              <optional>
