-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-13-opd-a6-shelf-rename.sql
-- OPD A6 · re-shelve to the 6-domain taxonomy
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A6 dissolves the legacy 7-shelf rail (which had Finance at 1 doc, HR &
-- People at 41 docs, and didn't carry the Food Safety vs People Safety
-- consolidation that SOP-002's own framework already makes) and replaces it
-- with a 6-domain taxonomy that maps cleaner against the actual 101-doc corpus:
--
--   Safety                -> Safety, Health & Incident
--   Operations            -> Operations & Leadership
--   HR & People           -> People & Conduct
--   Culinary              -> Culinary & Kitchen Operations
--   Brand & Standards     -> Brand & Documentation Standards
--   Site & Client         -> Service Delivery & Client Accounts
--   Finance               -> Operations & Leadership (1 doc PB-009 folds in)
--
-- This migration is required because documents.shelf carries a CHECK
-- constraint (chk_documents_shelf, last touched in pr-7-6) that enforces the
-- old 7-set. The projection's UPSERT halts on the constraint until this
-- migration runs.
--
-- Order matters:
--   1. Drop the old constraint
--   2. Rewrite existing rows to the new shelf names (single transaction)
--   3. Re-add the constraint with the new 6-set
--
-- After this migration applies in Studio, the projection apply is a no-op
-- for shelf (DB already matches MDX) but still runs to surface any other
-- MDX changes.
--
-- IDEMPOTENT:
--   DROP CONSTRAINT IF EXISTS - safe to re-run.
--   UPDATE WHERE shelf IN (old-set) - re-runs match nothing on a second pass.
--   ADD CONSTRAINT - DROP first guarantees no duplicate.
--
-- ROLLBACK:
--   The reverse migration drops the new constraint, rewrites shelves back to
--   the old 7-set, and re-adds the old constraint. The 1-doc Finance shelf
--   (PB-009) becomes a separate UPDATE since the new -> old direction
--   doesn't distinguish it from Operations.
--
-- VERIFY (after apply):
--   SELECT shelf, count(*) FROM documents WHERE archived = false GROUP BY shelf;
--   Expected (active docs):
--     Safety, Health & Incident: 24
--     Operations & Leadership: 19
--     Service Delivery & Client Accounts: 7
--     People & Conduct: 41
--     Culinary & Kitchen Operations: 3
--     Brand & Documentation Standards: 4
--     null: 3
--   Total: 101 active.
--
--   Then re-run the projection:
--     node --env-file=.env.local scripts/content/project-catalog.mjs --apply
--   Expected output: 0 inserts, 0 archives. Updates happen for any docs
--   whose MDX changed beyond shelf (the A6 PR also adds the subshelf
--   frontmatter field on the 41 People & Conduct docs - the projection
--   does not project subshelf to PG today; it lives in MDX only until a
--   later PR adds the column + rail wiring).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_shelf;

UPDATE documents SET shelf = 'Safety, Health & Incident', updated_at = now()
  WHERE shelf = 'Safety';

UPDATE documents SET shelf = 'Operations & Leadership', updated_at = now()
  WHERE shelf IN ('Operations', 'Finance');

UPDATE documents SET shelf = 'People & Conduct', updated_at = now()
  WHERE shelf = 'HR & People';

UPDATE documents SET shelf = 'Culinary & Kitchen Operations', updated_at = now()
  WHERE shelf = 'Culinary';

UPDATE documents SET shelf = 'Brand & Documentation Standards', updated_at = now()
  WHERE shelf = 'Brand & Standards';

UPDATE documents SET shelf = 'Service Delivery & Client Accounts', updated_at = now()
  WHERE shelf = 'Site & Client';

ALTER TABLE documents ADD CONSTRAINT chk_documents_shelf CHECK (
  shelf IS NULL OR shelf IN (
    'Safety, Health & Incident',
    'Operations & Leadership',
    'Service Delivery & Client Accounts',
    'People & Conduct',
    'Culinary & Kitchen Operations',
    'Brand & Documentation Standards'
  )
);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-13. The new 6-set is now the source of truth in PG, matching the
-- MDX frontmatter values written in the same PR.
-- ─────────────────────────────────────────────────────────────────────────────
