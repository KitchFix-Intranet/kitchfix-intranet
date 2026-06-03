-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-4-opd-bilingual-columns.sql
-- Project OPD · PR 7.4 · add EN/ES bilingual columns to documents
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds two nullable columns to the documents table so a single catalog row can
-- carry both the primary (EN) and secondary (ES) Drive file. Mirrors the
-- existing source_drive_id + storage_path conventions:
--
--   source_drive_id     -> source_drive_id_es      (Drive file id for the ES doc)
--   storage_path        -> storage_path_es         (reserved for SousAI ES text)
--
-- The first bilingual doc is POSTER-001 (The Big Rules poster), which has
-- separate EN and ES PDFs on Drive. Most docs will leave both _es columns NULL.
--
-- The reader (SlideOverReader.js) shows an EN/ES toggle only when both
-- source_drive_id AND source_drive_id_es are populated; otherwise the toggle
-- is suppressed and the reader behaves as before.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). House style matches pr-7-1-opd-schema
-- exactly. No new GRANTs needed - documents already has the full service_role
-- grant block, and ALTER TABLE ADD COLUMN inherits the table's existing
-- column-level privileges.
--
-- Apply via Studio paste, then run:
--   node --env-file=.env.local scripts/apply-pr-7-4-bilingual-columns.mjs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS source_drive_id_es TEXT,  -- Drive file id, ES variant
  ADD COLUMN IF NOT EXISTS storage_path_es    TEXT;  -- reserved (parallels storage_path)

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-4. Verify via the apply/verify script above.
-- ─────────────────────────────────────────────────────────────────────────────
