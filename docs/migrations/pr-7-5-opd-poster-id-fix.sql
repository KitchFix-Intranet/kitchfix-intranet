-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-5-opd-poster-id-fix.sql
-- Project OPD · PR 7.5 · rename POST-003 → POSTER-001 (atomic, with FK fanout)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The catalog seed (pr-7-2) used 'POST-003' for the Big Rules poster row;
-- the authoritative document id is 'POSTER-001'. This migration corrects
-- the catalog to match the source-of-truth doc id.
--
-- documents.id is the TEXT primary key. The FKs on document_relationships
-- (from_doc, to_doc) and document_surfaces (doc_id) all reference
-- documents(id) ON DELETE CASCADE - but NOT ON UPDATE CASCADE (schema
-- confirmed in pr-7-1-opd-schema.sql, lines 110-111, 140). Updating the
-- parent id directly would either fail (NO ACTION) or orphan children, so
-- the rename has to be done as a 5-step atomic transaction:
--
--   1. INSERT a new POSTER-001 row that copies every column from POST-003
--      (including the bilingual columns added in pr-7-4).
--   2. UPDATE document_relationships.from_doc 'POST-003' → 'POSTER-001'.
--   3. UPDATE document_relationships.to_doc   'POST-003' → 'POSTER-001'.
--   4. UPDATE document_surfaces.doc_id        'POST-003' → 'POSTER-001'.
--   5. DELETE FROM documents WHERE id = 'POST-003'. All children now point
--      at POSTER-001 so the ON DELETE CASCADE has nothing to cascade.
--
-- The whole thing is wrapped in BEGIN/COMMIT so a failure at any step
-- rolls back to the original POST-003 state. Idempotency: if POST-003
-- no longer exists, every step is a 0-row no-op and the transaction
-- commits clean.
--
-- Prerequisite: pr-7-4-opd-bilingual-columns.sql must be applied first.
-- This script references source_drive_id_es and storage_path_es in the
-- column list of the INSERT...SELECT.
--
-- Apply via Studio paste, then run:
--   node --env-file=.env.local scripts/apply-pr-7-5-poster-id-fix.mjs
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Step 1: insert POSTER-001 as a column-for-column copy of POST-003.
-- Explicit column list (not INSERT ... SELECT *) so the new id is the only
-- value substituted and updated_at gets refreshed to now().
INSERT INTO documents (
  id, title, doc_class, status, version, shelf,
  card_line, summary, keywords,
  owner, approver,
  source_drive_id, storage_path,
  source_drive_id_es, storage_path_es,
  pinned, print_required, critical, sort_order,
  audience, classification,
  effective_date, last_reviewed, next_review,
  is_historical, data_provenance,
  created_at, updated_at
)
SELECT
  'POSTER-001', title, doc_class, status, version, shelf,
  card_line, summary, keywords,
  owner, approver,
  source_drive_id, storage_path,
  source_drive_id_es, storage_path_es,
  pinned, print_required, critical, sort_order,
  audience, classification,
  effective_date, last_reviewed, next_review,
  is_historical, data_provenance,
  created_at, now()
FROM documents WHERE id = 'POST-003';

-- Step 2 + 3: repoint every relationship edge that touched POST-003.
-- uq_relationship UNIQUE(from_doc, to_doc, rel_type) is preserved because
-- POSTER-001 didn't exist as an endpoint before this migration.
UPDATE document_relationships SET from_doc = 'POSTER-001' WHERE from_doc = 'POST-003';
UPDATE document_relationships SET to_doc   = 'POSTER-001' WHERE to_doc   = 'POST-003';

-- Step 4: repoint surfaces.
UPDATE document_surfaces SET doc_id = 'POSTER-001' WHERE doc_id = 'POST-003';

-- Step 5: drop the old row. All children now point at POSTER-001 so the
-- ON DELETE CASCADE on documents(id) cascades to zero rows.
DELETE FROM documents WHERE id = 'POST-003';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-5. Verify via apply-pr-7-5-poster-id-fix.mjs.
-- ─────────────────────────────────────────────────────────────────────────────
