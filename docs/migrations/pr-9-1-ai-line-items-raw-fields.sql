-- ════════════════════════════════════════════════════════════════════════════
-- PR 9-1 (Stage A of the inventory extraction rebuild)
-- ai_line_items: add 9 nullable columns to capture raw labeled invoice fields
-- invoice_submissions: widen type CHECK to include 'cc_receipt'
-- ════════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
--   The cron's arithmetic gate is correctly catching extraction errors
--   produced upstream by Claude conflating PACK/inner-count columns with
--   the Cases/SHIPPED column (700 of 893 review_queue rows are
--   arithmetic_fail, concentrated in Ben E Keith / Cheney Brothers /
--   Kuna distributor invoices). The rebuild architecture: ask Claude for
--   RAW labeled invoice columns faithfully (Cases, Pack Size, UOM,
--   Weight sub-line, etc.); derive the inventory/pricing values in CODE,
--   not in the prompt.
--
--   This migration adds the storage surface. The Stage A prompt change
--   in the same PR begins populating these columns. Existing 13
--   Claude-populated columns (line_num, description, quantity, unit,
--   unit_price, extended_price, category, confidence, raw_json) stay
--   exactly as they are — cron continues to read them at the same
--   positions. All new columns are nullable so historical rows + any
--   transitional rows where Claude doesn't return a field don't 23502.
--
-- ALSO (folded in here so the latent silent-insert-failure doesn't sit
--       waiting for someone to step on it):
--   The app's invoiceActions.js accepts `formType` values of
--   'invoice' | 'credit' | 'cc_receipt' (typeMap at lines 388-395), but
--   the PG CHECK only allows ('invoice','credit'). A 'cc_receipt'
--   submission today hits a CHECK violation on PG insert (silent
--   inconsistency between Sheets and PG). Widen the constraint.
--
--   Note: the Stage 0 credit filter only skips type='credit' (refunds);
--   cc_receipt = credit-card receipts representing actual purchases,
--   continue to be ingested into inventory as before.
--
-- USAGE
--   Paste the whole file into Supabase Studio's SQL editor and run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Widen invoice_submissions.type CHECK to accept 'cc_receipt' ──
-- The inline CHECK was named by PG using the predictable convention
-- <table>_<column>_check. Drop + re-add with the widened value list.

ALTER TABLE invoice_submissions
  DROP CONSTRAINT IF EXISTS invoice_submissions_type_check;

ALTER TABLE invoice_submissions
  ADD CONSTRAINT invoice_submissions_type_check
  CHECK (type IN ('invoice', 'credit', 'cc_receipt'));

-- ── 2. Add 9 raw-extraction columns to ai_line_items ──
-- All nullable. No CHECK that rejects NULL. Safe to apply against
-- historical data — old rows stay NULL across the new fields.

ALTER TABLE ai_line_items
  ADD COLUMN IF NOT EXISTS item_number          TEXT,
  ADD COLUMN IF NOT EXISTS pack_size            TEXT,
  ADD COLUMN IF NOT EXISTS ordered_count        NUMERIC,
  ADD COLUMN IF NOT EXISTS shipped_count        NUMERIC,
  ADD COLUMN IF NOT EXISTS uom_raw              TEXT,
  ADD COLUMN IF NOT EXISTS amount               NUMERIC,
  ADD COLUMN IF NOT EXISTS weight_line_value    NUMERIC,
  ADD COLUMN IF NOT EXISTS catch_weight_marker  TEXT,
  ADD COLUMN IF NOT EXISTS raw_columns          JSONB;

-- ── 3. Constrain catch_weight_marker to the two real values ──
-- Done as a separate ALTER so the column add above stays idempotent.

ALTER TABLE ai_line_items
  DROP CONSTRAINT IF EXISTS ai_line_items_catch_weight_marker_check;

ALTER TABLE ai_line_items
  ADD CONSTRAINT ai_line_items_catch_weight_marker_check
  CHECK (catch_weight_marker IS NULL OR catch_weight_marker IN ('*CS', '*EA'));

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run after applying)
-- ────────────────────────────────────────────────────────────────────────────
--
-- 1. Confirm the 9 new columns exist on ai_line_items + all are nullable:
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'ai_line_items'
--     AND column_name IN ('item_number','pack_size','ordered_count','shipped_count',
--                         'uom_raw','amount','weight_line_value','catch_weight_marker',
--                         'raw_columns')
--   ORDER BY ordinal_position;
--
--   Expected: 9 rows, all is_nullable = 'YES'.
--
-- 2. Confirm catch_weight_marker CHECK rejects invalid values:
--
--   INSERT INTO ai_line_items
--     (invoice_uuid, account_key, vendor_name, vendor_id, line_num, description,
--      catch_weight_marker)
--   VALUES
--     ('00000000-0000-0000-0000-000000000000', 'STL - MO', 'TEST', 'VND-TEST',
--      9999, 'probe row, will rollback', '*BAD');
--   -- Expected: ERROR 23514 check violation. Roll back.
--
--   (Use a real invoice_uuid + vendor_id if you want to dry-run without
--    hitting the FK; the CHECK fires before the FK so '*BAD' will error
--    first either way.)
--
-- 3. Confirm cc_receipt now accepted by invoice_submissions.type:
--
--   -- Don't actually insert; just check the constraint definition:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'invoice_submissions_type_check';
--
--   Expected: CHECK (type IN ('invoice', 'credit', 'cc_receipt'))
--
-- ────────────────────────────────────────────────────────────────────────────
