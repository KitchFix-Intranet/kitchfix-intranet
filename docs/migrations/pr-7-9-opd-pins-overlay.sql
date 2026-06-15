-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-9-opd-pins-overlay.sql
-- Project OPD · Phase A re-point · pin moves to its own overlay table
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pin is UI state, not document metadata. It is a user-chosen "float this
-- card to the top of its shelf" affordance - orthogonal to status, owner,
-- version, etc. Keeping it on documents.pinned coupled UI state to the
-- catalog row, which then meant the MDX -> Postgres projection had to either
-- (a) clobber operator pin choices on every projection run, or (b) carry
-- pin in MDX frontmatter (where it does not belong).
--
-- This migration creates document_pins as the canonical store: presence of
-- a row means the doc is pinned; absence means it is not. Sort order
-- (pinned DESC) reads from a LEFT JOIN in listDocuments. The projection
-- never touches this table - operator pin choices survive every projection.
--
-- documents.pinned stays in place (this migration does NOT drop the column)
-- but becomes unread/unwritten after the app code in this PR redirects the
-- read and write paths to the overlay. The column drop happens in a later
-- PR (Phase A2 or B) once the read/write path has been live long enough
-- that a regression is detectable.
--
-- WHAT this does:
--   1. CREATE TABLE document_pins.
--   2. Backfill: insert one row per documents row where pinned = true.
--   3. RLS disabled + service_role grants matching the other four OPD
--      tables (pr-7-1 pattern).
--
-- IDEMPOTENT:
--   CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING. Re-running
--   is safe.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS document_pins;  -- safe (no FK targets it)
--   The app code revert restores reads + writes from documents.pinned.
--   documents.pinned was preserved precisely to make rollback non-destructive.
--
-- COORDINATION:
--   The app side (src/lib/dataStore/opd.js listDocuments + src/app/api/playbook
--   /route.js update-document action) reads + writes the overlay after this
--   PR. Both changes ride in this same PR; the migration must apply BEFORE
--   the code deploys so the backfill is in place when the new read path
--   queries it.
--
-- VERIFY (after apply):
--   SELECT count(*) FROM document_pins;
--   -- expected: equal to (SELECT count(*) FROM documents WHERE pinned = true);
--   SELECT count(*) FROM documents WHERE pinned = true
--     AND id NOT IN (SELECT doc_id FROM document_pins);
--   -- expected: 0 (every pinned doc has an overlay row)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_pins (
  doc_id      TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  pinned_by   TEXT,                                       -- session email at the time of the pin

  -- Provenance fields per the post-Module-6 house style. Pin actions are
  -- always individual user actions (no batch import scenario expected).
  is_historical    BOOLEAN NOT NULL DEFAULT false,
  data_provenance  TEXT NOT NULL DEFAULT 'manual_entry',

  CONSTRAINT chk_pin_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  )
);

CREATE INDEX IF NOT EXISTS document_pins_pinned_at_idx ON document_pins (pinned_at DESC);

ALTER TABLE document_pins DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON document_pins TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON document_pins TO anon, authenticated;

-- Backfill: every currently-pinned doc gets an overlay row. ON CONFLICT
-- DO NOTHING so a re-run after a partial apply is safe. pinned_by is
-- unknown for the backfill set (we did not capture who pinned what
-- historically); leave NULL and mark provenance batch_rebuild.
INSERT INTO document_pins (doc_id, pinned_at, pinned_by, is_historical, data_provenance)
SELECT id, updated_at, NULL, true, 'batch_rebuild'
FROM documents
WHERE pinned = true
ON CONFLICT (doc_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-9. Next: pr-7-10 (document_content rendered HTML store).
-- ─────────────────────────────────────────────────────────────────────────────
