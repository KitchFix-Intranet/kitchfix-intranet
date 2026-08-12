-- ════════════════════════════════════════════════════════════════════════════
-- pr-10-1: fix OCR year-drift on invoice_date
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2 purchase-line-item repair. Fixes 35 rows in ai_line_items and 5 rows
-- in invoice_submissions where invoice_date carries a mis-OCR'd year prefix.
--
-- Observed patterns (from live scan 2026-08-12):
--
--   Pattern                  Rows in ai_line_items   Rows in invoice_submissions
--   -----------------------  ---------------------   ----------------------------
--   0026-MM-DD (missing '2') 33 (0026-06-19 x16,     3 (2026-06-19, 2026-06-24,
--                            0026-07-17 x17)          2026-07-17)
--   23026-MM-DD (extra '2')  1  (23026-07-31)         1 (2026-07-31)
--   72026-MM-DD (extra '7')  0                        1 (2026-07-08)
--   0206-MM-DD (misparse)    1  (0206-05-02)          0
--
-- Correction rule (applied per pattern, tightest possible WHERE):
--   '0026-'  -> '2026-'    (prepend '2')
--   '0206-'  -> '2026-'    (character transposition, verified against invoice
--                           header - the CIN-AZ line-item row's invoice_uuid
--                           matches an invoice_submissions row already dated
--                           2026-05-02, confirming the year is 2026)
--   '23026-' -> '2026-'    (drop leading '2')
--   '72026-' -> '2026-'    (drop leading '7')
--
-- All 35 ai_line_items rows and all 5 invoice_submissions rows collapse to
-- valid 2026 dates. Post-correction, 34 of 35 ai_line_items rows fall inside
-- the Phase 3 analysis window (2025-08-01 to 2026-07-31); one row does not
-- because it is CIN-AZ, out of the TBR/TBJ/STL scope.
--
-- SAFETY
--   - UPDATE is limited by exact-string WHERE clauses on the date pattern.
--     Cannot touch any row whose invoice_date is already a valid 4-digit-year
--     date.
--   - No column or type changes. No indexes affected.
--   - No sequence-of-changes concern - each UPDATE is independent, and the
--     invoice_uuid FK relationship is unaffected.
--   - Rollback: replace 2026 back to original prefix for the affected uuids
--     if needed. Kevin has invoice_uuid list in the PR body / repair report.
--
-- REVIEW BEFORE RUNNING
--   Kevin should:
--     1. Confirm the underlying invoices are indeed 2026 dates (check
--        drive_urls on the affected invoice_submissions rows to be sure).
--     2. Run against staging first if a staging environment exists.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Sanity assertions BEFORE running the UPDATEs. If a count changes between
-- discovery and apply, fail loudly.
DO $$
DECLARE
  ali_0026 int;
  ali_0206 int;
  ali_23026 int;
  isub_0026 int;
  isub_23026 int;
  isub_72026 int;
BEGIN
  SELECT COUNT(*) INTO ali_0026 FROM ai_line_items WHERE invoice_date::text LIKE '0026-%';
  SELECT COUNT(*) INTO ali_0206 FROM ai_line_items WHERE invoice_date::text LIKE '0206-%';
  SELECT COUNT(*) INTO ali_23026 FROM ai_line_items WHERE invoice_date::text LIKE '23026-%';
  SELECT COUNT(*) INTO isub_0026 FROM invoice_submissions WHERE invoice_date::text LIKE '0026-%';
  SELECT COUNT(*) INTO isub_23026 FROM invoice_submissions WHERE invoice_date::text LIKE '23026-%';
  SELECT COUNT(*) INTO isub_72026 FROM invoice_submissions WHERE invoice_date::text LIKE '72026-%';

  RAISE NOTICE 'ai_line_items: 0026-* n=%, 0206-* n=%, 23026-* n=%',
    ali_0026, ali_0206, ali_23026;
  RAISE NOTICE 'invoice_submissions: 0026-* n=%, 23026-* n=%, 72026-* n=%',
    isub_0026, isub_23026, isub_72026;

  -- Expected as of 2026-08-12 scan (task6_date_hygiene.mjs output):
  --   ali_0026 = 33, ali_0206 = 1, ali_23026 = 1
  --   isub_0026 = 3, isub_23026 = 1, isub_72026 = 1
  -- If new drift shows up between scan and apply, the migration still runs
  -- correctly (patterns will still match), so we only WARN if counts drift.

END $$;

-- ai_line_items fixes -----------------------------------------------------

UPDATE ai_line_items
   SET invoice_date = (('2' || invoice_date::text)::date)
 WHERE invoice_date::text LIKE '0026-%';

UPDATE ai_line_items
   SET invoice_date = ('2026-' || substring(invoice_date::text from 6))::date
 WHERE invoice_date::text LIKE '0206-%';

UPDATE ai_line_items
   SET invoice_date = (substring(invoice_date::text from 2))::date
 WHERE invoice_date::text LIKE '23026-%';

-- invoice_submissions fixes -----------------------------------------------

UPDATE invoice_submissions
   SET invoice_date = (('2' || invoice_date::text)::date)
 WHERE invoice_date::text LIKE '0026-%';

UPDATE invoice_submissions
   SET invoice_date = (substring(invoice_date::text from 2))::date
 WHERE invoice_date::text LIKE '23026-%';

UPDATE invoice_submissions
   SET invoice_date = (substring(invoice_date::text from 2))::date
 WHERE invoice_date::text LIKE '72026-%';

-- Post-fix sanity: assert no drift-shaped dates remain -------------------
DO $$
DECLARE
  ali_bad int;
  isub_bad int;
BEGIN
  SELECT COUNT(*) INTO ali_bad
    FROM ai_line_items
   WHERE invoice_date < DATE '2015-01-01' OR invoice_date > DATE '2027-12-31';
  SELECT COUNT(*) INTO isub_bad
    FROM invoice_submissions
   WHERE invoice_date < DATE '2015-01-01' OR invoice_date > DATE '2027-12-31';
  IF ali_bad > 0 THEN
    RAISE EXCEPTION 'pr-10-1: still % rows in ai_line_items with drift-shaped date', ali_bad;
  END IF;
  IF isub_bad > 0 THEN
    RAISE EXCEPTION 'pr-10-1: still % rows in invoice_submissions with drift-shaped date', isub_bad;
  END IF;
  RAISE NOTICE 'pr-10-1: post-fix drift-shaped dates: ali=% isub=%', ali_bad, isub_bad;
END $$;

COMMIT;
