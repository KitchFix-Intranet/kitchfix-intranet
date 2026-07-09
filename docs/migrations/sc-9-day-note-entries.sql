-- ═══════════════════════════════════════════════════════════════════
-- sc-9-day-note-entries.sql
--
-- Note: filename bumped from the brief's "sc-7" to "sc-9" because
-- sc-7 is already occupied by sc-7-changelog-latest-view.sql (the
-- last two SC migrations are sc-8a-price-kind-column.sql and
-- sc-8b-actual-prices-and-view.sql; sc-9 is the next free slot).
-- Content is exactly what the brief describes.
--
-- SC-079: append-only day-note ledger.
--
-- The pre-Round-3 shape stored a single `notes` TEXT column on
-- `sc_day_metadata` that got overwritten on every save. Owner review
-- flagged the accountability gap - no author, no history, and any
-- prior context vanished on the next write. This migration lands the
-- ledger table (one row per authored note) + backfills the existing
-- singleton notes as legacy entries (author NULL).
--
-- Additive-only. `sc_day_metadata.notes` stays in place but goes
-- DORMANT after this migration ships: no reader references it, no
-- writer touches it. A future schema tidy retires the column - the
-- code that used to read/write it is dropped in the same PR that runs
-- this file.
--
-- APPLY THIS BEFORE MERGING THE ROUND-3 CODE PR. The month load starts
-- selecting from `sc_day_note_entries` immediately after cutover; a
-- missing table = 400 on every month load.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sc_day_note_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL CHECK (
                    account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    OR account_key = 'CORP'
                  ),
  service_date    DATE NOT NULL,
  note            TEXT NOT NULL,
  -- Server-derived author name. Never client-supplied - the sc-add-note
  -- handler pulls from the session and inserts it. NULL is reserved for
  -- backfilled legacy entries (see INSERT below) so the UI can render
  -- the em-dash for unknown-author.
  author          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_day_note_entries_account_date
  ON sc_day_note_entries (account_key, service_date, created_at DESC);

-- Same disable-RLS + grant pattern as sc_day_metadata (see sc-1 file
-- footer). App reads via service_role.
ALTER TABLE sc_day_note_entries DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON sc_day_note_entries TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_day_note_entries TO anon, authenticated;

-- ── Backfill ───────────────────────────────────────────────────────
-- One entry per existing non-null sc_day_metadata.notes.
--   author       = NULL (legacy - UI renders "—")
--   created_at   = the metadata row's updated_at when present, else
--                  the row's created_at, else now()
--
-- Idempotent guard: skip if an entry with the same (account, date,
-- note) already exists. Lets us re-apply the migration in dev without
-- duplicating history.
INSERT INTO sc_day_note_entries (account_key, service_date, note, author, created_at)
SELECT
  m.account_key,
  m.service_date,
  m.notes,
  NULL,
  COALESCE(m.updated_at, m.created_at, now())
FROM sc_day_metadata m
WHERE m.notes IS NOT NULL
  AND btrim(m.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM sc_day_note_entries e
    WHERE e.account_key  = m.account_key
      AND e.service_date = m.service_date
      AND e.note         = m.notes
  );

-- ── Post-migration probe ───────────────────────────────────────────
-- Kevin runs after apply to verify the counts land as expected.
--
-- SELECT
--   (SELECT count(*) FROM sc_day_metadata WHERE notes IS NOT NULL AND btrim(notes) <> '') AS metadata_notes,
--   (SELECT count(*) FROM sc_day_note_entries WHERE author IS NULL)                        AS backfilled_entries,
--   (SELECT count(*) FROM sc_day_note_entries)                                              AS total_entries;
-- Expect metadata_notes == backfilled_entries on first apply.

COMMENT ON TABLE sc_day_note_entries IS
  'SC-079: append-only day-note ledger. One row per authored note. author=NULL flags backfilled legacy entries from sc_day_metadata.notes (dormant post-Round-3).';
COMMENT ON COLUMN sc_day_note_entries.author IS
  'Server-derived from the session on INSERT. NULL only for backfilled legacy entries; never accept a NULL author from the client.';
