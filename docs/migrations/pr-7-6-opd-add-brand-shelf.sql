-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-6-opd-add-brand-shelf.sql
-- Add 'Brand & Standards' shelf + reshelve the 4 STD docs into it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this does:
--   1. Expands the documents.shelf CHECK constraint to allow a 7th value,
--      'Brand & Standards', positioned between Culinary and Finance in the
--      app's locked render order.
--   2. Moves STD-001, STD-002, STD-004, STD-005 from Operations to the new
--      Brand & Standards shelf in a single UPDATE.
--
-- WHY:
--   STD-001 (Documentation Format Standard), STD-002 (Visual Communication
--   Standard), STD-004 (Documentation Repository Standard), and STD-005
--   (Project OPD Playbook) are meta/brand docs - how KitchFix documents and
--   presents itself - not kitchen operations. They don't belong on the
--   Operations shelf alongside SOPs and playbooks.
--
-- CHUNK IMPACT: NONE.
--   document_chunks has no shelf column, and chunk content (the "From: ..."
--   contextual header) does not include shelf. STD-001's 66 existing chunks
--   stay exactly as they are; no re-embedding required.
--
-- IDEMPOTENT:
--   DROP CONSTRAINT IF EXISTS handles re-runs. The UPDATE is naturally
--   idempotent (running twice with the same target value is a no-op).
--
-- COORDINATION:
--   The app side (src/app/api/playbook/route.js · SHELVES array) must
--   include 'Brand & Standards' for the bootstrap API to surface the new
--   shelf to clients. That change ships in the same commit as this migration.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_shelf;

ALTER TABLE documents ADD CONSTRAINT chk_documents_shelf CHECK (
  shelf IS NULL OR shelf IN (
    'Safety',
    'Operations',
    'HR & People',
    'Culinary',
    'Brand & Standards',
    'Finance',
    'Site & Client'
  )
);

UPDATE documents
SET shelf = 'Brand & Standards',
    updated_at = now()
WHERE id IN ('STD-001', 'STD-002', 'STD-004', 'STD-005');

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-6. Verify via:
--   - constraint accepts 'Brand & Standards' (an UPDATE to a sentinel works)
--   - the 4 STD docs all show shelf = 'Brand & Standards'
--   - STD-001's document_chunks count is still 66 (metadata-only proof)
-- ─────────────────────────────────────────────────────────────────────────────
