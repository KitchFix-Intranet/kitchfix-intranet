-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-8-opd-status-set.sql
-- Project OPD · Phase A re-point · status vocabulary tighten
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Tightens the documents.status enum from the 7-set
--   Live | In Build | Draft | Pending | Placeholder | Blocked | Retired
-- to the 6-set
--   Live | In Build | Pending | Placeholder | Blocked | Retired
--
-- The MDX foundation does not use 'Draft' (it uses 'In Build' for the same
-- semantic state - the doc has body content but is not yet approved Live).
-- The cutover decision: drop 'Draft' and migrate the 10 existing Draft rows
-- to 'In Build' so MDX is canonical and the schema enforces the projection's
-- output set. 'Blocked' stays in the schema for the "blocked on legal /
-- counsel / SLT" case Kevin called out in the audit's open questions.
--
-- WHAT this does:
--   1. Migrate every documents.status = 'Draft' to 'In Build' (10 rows
--      observed in prod 2026-06-15).
--   2. Tighten chk_documents_status to the 6-set above.
--
-- IDEMPOTENT:
--   Re-running is safe. The UPDATE has nothing to do on second run. The
--   constraint drop+recreate uses IF EXISTS.
--
-- ROLLBACK:
--   - Restore the old 7-set CHECK constraint:
--       ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_status;
--       ALTER TABLE documents ADD CONSTRAINT chk_documents_status CHECK (
--         status IN ('Live','In Build','Draft','Pending','Placeholder','Blocked','Retired')
--       );
--   - The Draft -> In Build data migration is NOT individually reversible
--     once committed. The rows lose their Draft attribution. This is
--     acceptable per the cutover decision (Draft and In Build are the same
--     operational state - the rename consolidates a confusing duplicate).
--   - If the projection later needs Draft back as a distinct state, the
--     fix is to add a new column (e.g., editorial_state) rather than
--     unmerge from In Build.
--
-- COORDINATION:
--   The route's VALID_STATUSES set in src/app/api/playbook/route.js must
--   drop 'Draft' from the 7-value list once this migration is applied.
--   AdminClient.js STATUS_EDIT_OPTIONS must also drop 'Draft'. The
--   PlaybookClient.js STATUS_CHIP_ORDER list must drop 'Draft'. All three
--   are app-side and ride in the same PR as this migration.
--
-- VERIFY (after apply):
--   SELECT status, count(*) FROM documents GROUP BY status ORDER BY status;
--   -- expected: no 'Draft' row; In Build count = prior In Build + 10
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE documents
SET status = 'In Build', updated_at = now()
WHERE status = 'Draft';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_status;

ALTER TABLE documents ADD CONSTRAINT chk_documents_status CHECK (
  status IN ('Live', 'In Build', 'Pending', 'Placeholder', 'Blocked', 'Retired')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-8. Next: pr-7-9 (document_pins overlay).
-- ─────────────────────────────────────────────────────────────────────────────
