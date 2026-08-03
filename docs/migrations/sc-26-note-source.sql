-- ═══════════════════════════════════════════════════════════════════
-- sc-26: bulk-note discriminator column
-- 2026-08-03
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships the discriminator for the bulk batch-note feature.
--
-- What this migration adds:
--   1. sc_day_note_entries.source TEXT NULL column with a CHECK
--      constraint restricting values to (NULL, 'bulk'). NULL means
--      the note was authored one day at a time via sc-add-note or
--      via the mark-no-service audit-trail literal - the pre-2026-
--      08-03 shape. 'bulk' means the note was authored as a batch
--      note on sc-bulk-submit and reaches N days with the same
--      author, text, and timestamp by construction.
--
-- Owner ruling this codifies (2026-08-03, PR #603 follow-up on the
-- bulk-surface work):
--   - The bulk-note P2-item-2 fence at route.js is resolved not
--     deleted. The original refusal was correct: a single day-
--     specific note leaking across N days blurs its scope. Owner's
--     shape resolves the objection - the note is ABOUT THE BATCH
--     and each day says so via a distinct ledger row type that
--     carries a `Bulk entered` marker. Nothing claims to be day-
--     specific.
--   - The discriminator MUST be a column, not a text-prefix
--     convention. The note text is operator-authored; any prefix
--     we match on is a string a person can type, and the day
--     someone writes a note beginning with our marker the ledger
--     lies about provenance. A nullable column defaulting to null
--     is smaller and more honest than a string convention that
--     cannot be enforced.
--   - Nullable + defaulting to null means every existing row is
--     'not from a batch' by construction. Zero backfill.
--   - CHECK on the value set defends against typos ('blk', 'BULK'
--     etc.) silently inserting. Extending the set later takes a
--     one-line migration; the value space is fixed today at one
--     known kind and one implicit kind (null).
--   - Loader emits `source` on the noteEntries pass-through so the
--     client's groupActivity bucketing can distinguish 'note'
--     from 'bulk-entered' at render time. No new history-entry
--     synthesis path - a bulk note IS a note, per Ruling 4.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Add the column.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE sc_day_note_entries
  ADD COLUMN IF NOT EXISTS source TEXT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 2. CHECK constraint on the value set.
--
-- Named for future-proofing: dropping + re-adding to extend the value
-- set is a one-line ALTER pair.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_day_note_entries_source_check'
  ) THEN
    ALTER TABLE sc_day_note_entries
      ADD CONSTRAINT sc_day_note_entries_source_check
      CHECK (source IS NULL OR source IN ('bulk'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Column comment for schema readers.
-- ═══════════════════════════════════════════════════════════════════

COMMENT ON COLUMN sc_day_note_entries.source IS
  'Provenance of the note. NULL = authored one day at a time (sc-add-note or mark-no-service audit line). ''bulk'' = authored as a batch note on sc-bulk-submit (2026-08-03, sc-26). Extend the CHECK constraint when adding a new kind.';

-- ═══════════════════════════════════════════════════════════════════
-- Verify probe (read-only, safe to run against prod):
--   SELECT source, COUNT(*) FROM sc_day_note_entries GROUP BY source;
-- Expected before any bulk note is written: one row, source=NULL,
-- count = total note rows.
-- ═══════════════════════════════════════════════════════════════════
