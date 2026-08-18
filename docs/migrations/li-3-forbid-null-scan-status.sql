-- ════════════════════════════════════════════════════════════════════════════
-- li-3: forbid NULL on invoice_submissions.ai_scan_status
-- ════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP to li-2. DO NOT APPLY until the li-a1 backfill has fully drained
-- and the precondition query below returns 0 rows. This file is checked in
-- BEFORE it can be safely applied so the follow-up is on the schedule
-- instead of on a mental checklist. An unbooked follow-up is one that never
-- happens.
--
-- ─── Context ─────────────────────────────────────────────────────────────
--
-- li-2 (feat/li-a1-durable-extraction) keeps NULL admissible on
-- invoice_submissions.ai_scan_status. The rationale, from the li-2 header:
-- forbidding NULL there would require the migration to write 552 existing
-- NULL rows to a non-NULL value inside the same Studio session, which
-- couples schema + data changes into one atomic paste. The backfill script
-- owns those writes (staggered by rank) so li-2 stays idempotent and
-- side-effect-free.
--
-- The consequence: the PR's central invariant - "NULL is impossible for
-- new submissions" - lives only in application code. Any bypass (a manual
-- INSERT into invoice_submissions from Studio, a schema-drift regression,
-- a future PR that forgets to write ai_scan_status) can silently re-create
-- the same silent-strand class li-a1 was written to eliminate. A NOT NULL
-- constraint at the schema layer is the durable form.
--
-- ─── When to apply ───────────────────────────────────────────────────────
--
-- 1. The li-a1 backfill has finished draining (both the initial 160-row
--    eligible set AND any historical Phase F work if that has been run
--    by then). Every row in invoice_submissions has a non-NULL
--    ai_scan_status.
-- 2. New submissions have been observed writing ai_scan_status = 'queued'
--    at insert time for at least 30 days without regression (the flip
--    landed 2026-08-1x with A1; wait to 2026-09-1x minimum).
-- 3. The PRECONDITION query below returns 0 rows.
--
-- Kevin decides when to schedule this; there is no auto-apply trigger.
--
-- ─── PRECONDITION (READ-ONLY - run in Studio before applying) ────────────
--
-- SELECT COUNT(*) AS null_rows
-- FROM invoice_submissions
-- WHERE ai_scan_status IS NULL;
--
-- Expected: 0. If non-zero, DO NOT PROCEED. Investigate the source of the
-- NULLs (a leaked code path? a Studio manual insert?), fix the source,
-- backfill those rows, then re-check.
--
-- ─── The migration ───────────────────────────────────────────────────────

BEGIN;

-- 1. Belt-and-suspenders: fail loudly if the precondition slipped between
--    the manual check and the ALTER. This ROLLBACK is idempotent and
--    non-destructive.
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM invoice_submissions
  WHERE ai_scan_status IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'li-3 precondition violated: % rows still have NULL ai_scan_status. Backfill first.', null_count;
  END IF;
END $$;

-- 2. Update the existing CHECK to remove the "IS NULL OR ..." branch. The
--    current constraint (from m6-pg-failed-visibility.sql) is:
--     CHECK (
--       ai_scan_status IS NULL OR ai_scan_status = ANY (ARRAY[
--         'pending', 'complete', 'failed', 'photo-only', 'pg_failed'
--       ])
--     )
--   li-a1 added the 'queued' value (via the same CHECK's replacement in
--   li-2). Drop the OR-NULL branch AND add NOT NULL. The two-step here is
--   deliberate: the NOT NULL rejection catches direct-INSERT bypasses,
--   and the CHECK expresses the set of allowed values without the NULL
--   wart.
ALTER TABLE invoice_submissions
  DROP CONSTRAINT IF EXISTS invoice_submissions_ai_scan_status_check;

ALTER TABLE invoice_submissions
  ADD CONSTRAINT invoice_submissions_ai_scan_status_check
  CHECK (
    ai_scan_status IN (
      'queued',
      'pending',      -- legacy pre-li-a1; kept for row-history compatibility
      'complete',
      'failed',
      'photo-only',
      'pg_failed'
    )
  );

ALTER TABLE invoice_submissions
  ALTER COLUMN ai_scan_status SET NOT NULL;

-- 3. Set a default so future direct-INSERT paths (unlikely, but not
--    architecturally forbidden) land on 'queued' instead of failing hard.
--    The app-layer path in upsertInvoiceSubmissionPostgres already writes
--    'queued' explicitly, so this default is a defense-in-depth line.
ALTER TABLE invoice_submissions
  ALTER COLUMN ai_scan_status SET DEFAULT 'queued';

COMMIT;

-- ─── VERIFY (READ-ONLY, per the A0 lesson) ────────────────────────────────
--
-- V1. Constraint still exists with the tightened set:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'invoice_submissions'::regclass
--   AND conname = 'invoice_submissions_ai_scan_status_check';
--
-- V2. Column is NOT NULL:
-- SELECT column_name, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'invoice_submissions'
--   AND column_name = 'ai_scan_status';
-- Expected: is_nullable='NO', column_default='queued'::text
--
-- V3. All rows have a valid status (should still return 0 - the precondition
--     was verified, and the migration did not alter data):
-- SELECT COUNT(*)
-- FROM invoice_submissions
-- WHERE ai_scan_status IS NULL;
-- Expected: 0
--
-- V4. Distribution across the allowed set for sanity:
-- SELECT ai_scan_status, COUNT(*)
-- FROM invoice_submissions
-- GROUP BY ai_scan_status
-- ORDER BY 2 DESC;
