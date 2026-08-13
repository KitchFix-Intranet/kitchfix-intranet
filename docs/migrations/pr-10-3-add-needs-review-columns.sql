-- pr-10-3: add needs_review + review_reason columns to ai_line_items
--
-- Purpose: land Task 3 Fix 1 validation gate (Phase 2c, 2026-08-13).
-- Adds two NEW columns (not overwrites) so the OCR pipeline can tag rows
-- that fail arithmetic sanity checks (extended_price vs qty * unit_price
-- per-row, and invoice-line-sum vs header-total per-invoice). Phase 3
-- reconciliation filters WHERE needs_review = false to exclude tagged
-- rows without deleting or mutating source data.
--
-- Idempotent: pre-check throws if either column already exists so a
-- re-run in Studio surfaces the collision instead of silently no-op'ing.
--
-- Follow-up: after apply, run scripts/_task3_backfill_needs_review.mjs
-- to tag the 417 historical over-extracted rows identified in Phase 2b.

BEGIN;

-- Pre-check: fail loud if either column already exists.
DO $$
DECLARE
  existing int;
BEGIN
  SELECT COUNT(*) INTO existing
  FROM information_schema.columns
  WHERE table_name = 'ai_line_items'
    AND column_name IN ('needs_review', 'review_reason');
  IF existing > 0 THEN
    RAISE EXCEPTION 'pr-10-3: needs_review/review_reason already exist on ai_line_items (found % of 2)', existing;
  END IF;
END $$;

ALTER TABLE ai_line_items
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN review_reason text;

-- Partial index for Phase 3 filter performance. Most rows will have
-- needs_review = false; indexing only the true minority keeps the index
-- small and the WHERE needs_review = false scan uses the table.
CREATE INDEX ai_line_items_needs_review_idx
  ON ai_line_items (needs_review)
  WHERE needs_review = true;

-- Post-check: confirm both columns present.
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM information_schema.columns
  WHERE table_name = 'ai_line_items'
    AND column_name IN ('needs_review', 'review_reason');
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'pr-10-3: expected 2 new columns, got %', cnt;
  END IF;
  RAISE NOTICE 'pr-10-3: needs_review + review_reason added, indexed';
END $$;

COMMIT;
