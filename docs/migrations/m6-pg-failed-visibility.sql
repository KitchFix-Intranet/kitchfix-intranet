-- ════════════════════════════════════════════════════════════════════════════
-- Module 6 dual-write silent gap - visibility fix
-- ════════════════════════════════════════════════════════════════════════════
-- Adds a distinct status for "Sheets write succeeded, PG insert threw" so the
-- silent gap is impossible to recur silently. Also adds a TEXT column to
-- capture the actual PG throw reason for triage.
--
-- The dual-write orchestrator in src/lib/dataStore/invoice.js does:
--   1. Sheets write (unconditional)
--   2. PG write (conditional via isDualWrite)
-- If PG throws after Sheets succeeds, the caller catches and marks
-- ai_scan_status='failed' - which is indistinguishable from "OCR itself
-- failed" so the gap (line items in Sheets, none in PG) goes silent.
--
-- This migration:
--   1. Drops the old CHECK constraint on ai_scan_status
--   2. Re-adds the constraint including the new 'pg_failed' value
--   3. Adds invoice_submissions.ai_scan_error TEXT (nullable) to record
--      the precise throw message for the next failure
--
-- After this lands, the code change in src/lib/invoiceActions.js
-- (markScanStatus catch handler) starts using 'pg_failed' + writing the
-- error message into ai_scan_error.
--
-- SAFETY
--   - Additive on the column side (nullable TEXT).
--   - The CHECK swap is a known PG pattern. Reads are unaffected. Writes
--     using only the existing four values keep passing.
--   - Existing 'failed' rows stay 'failed' (no data migration).
--   - ai_scan_complete GENERATED column is keyed on 'complete' literal,
--     so 'pg_failed' correctly evaluates to false there.
--
-- USAGE
--   Supabase Studio SQL editor: paste this whole file, run.
--   Verify with: node --env-file=.env.local scripts/_verify_m6_pg_failed_visibility.mjs
-- ════════════════════════════════════════════════════════════════════════════

-- ── Step 1: drop the existing CHECK constraint ────────────────────────────
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'invoice_submissions'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%ai_scan_status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invoice_submissions DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- ── Step 2: re-add the CHECK with 'pg_failed' included ────────────────────
ALTER TABLE invoice_submissions
  ADD CONSTRAINT invoice_submissions_ai_scan_status_check
  CHECK (ai_scan_status IS NULL OR ai_scan_status IN
    ('pending', 'complete', 'failed', 'photo-only', 'pg_failed'));

-- ── Step 3: add ai_scan_error column ──────────────────────────────────────
ALTER TABLE invoice_submissions
  ADD COLUMN IF NOT EXISTS ai_scan_error TEXT;

COMMENT ON COLUMN invoice_submissions.ai_scan_error IS
  'PG insert error message when ai_scan_status=pg_failed. Set when the '
  'dual-write PG side throws after a successful Sheets write. NULL on success '
  'and on Sheets-only OCR failures (ai_scan_status=failed).';
