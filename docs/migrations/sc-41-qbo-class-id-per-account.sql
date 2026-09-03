-- ═══════════════════════════════════════════════════════════════════
-- sc-41: add qbo_class_id to sc_qbo_account_map, seed the four
--        currently mapped accounts, then NOT NULL
-- 2026-09-03
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Sebastian's real QBO invoices carry a per-line ClassRef pointing
--   at the account's QBO Class (PFS:CIN - AZ (REDS), PFS:TXR - AZ,
--   PFS:TBR - FL, PFS:TBJ - FL). Our builder does not emit ClassRef;
--   QBO does not echo the Item's default class onto the line either
--   (Chat-Claude probed Items 3293/3295/3297 - all carry a default
--   ClassRef but QBO ignores it on write). Result: every invoice we
--   have posted from PR-F on lands unclassed, orphaning revenue on
--   Kevin's class-segmented P&L.
--
--   Class is per account, not per service (verified: CIN main + CIN
--   rehab share one class id; TXR week 0720 + week 0727 share one).
--   Home for the id is sc_qbo_account_map (one row per account),
--   not sc_qbo_service_map (many rows per account).
--
-- Owner rulings this codifies (Kevin 2026-09-03):
--
--   Ruling 1: STAGE THE SEQUENCE as ADD nullable / seed / NOT NULL.
--     Standard schema-add pattern - lets Studio commit the column
--     before the seed populates it, and the NOT NULL constraint
--     enforces the invariant after seed for every future row.
--
--   Ruling 2: ADAPTER GUARD FOR PARITY.
--     src/lib/billing/qboAdapter.js:373 already carries a live-mode
--     NOT NULL guard on qbo_customer_id and a matching pattern for
--     qbo_taxcode_id. Add the same guard for qbo_class_id so a live
--     POST cannot silently fall through to a NULL class value.
--
-- Fences:
--   - Schema change: one ADD COLUMN + one ALTER SET NOT NULL,
--     both on sc_qbo_account_map. No other tables touched.
--   - Seed: four UPDATE statements with idempotent WHERE guards
--     (WHERE qbo_class_id IS NULL restricts to unset rows;
--      re-running is a no-op).
--   - Rollback path documented at bottom.
--
-- Apply order (per the Studio batch-parse gotcha 2026-09-02):
--   FIVE separate paste-and-run blocks:
--     BLOCK A - preflight (SELECTs, read first)
--     BLOCK B - ADD COLUMN (schema change only, commits immediately)
--     BLOCK C - seed (BEGIN/COMMIT with UPDATEs + postflight)
--     BLOCK D - NOT NULL constraint (ALTER, commits immediately)
--     BLOCK E - external verify (SELECTs, read last)
--   Block B must commit before Block C runs (Studio parses each
--   block independently; a single-paste that references the new
--   column in the same transaction as ADD COLUMN would fail).
--   Block D must not run until Block C succeeds (a nullable seed
--   is fine; a NOT NULL constraint against unseeded rows aborts).
--
-- Related note for the PR body (Kevin 2026-09-03):
--   Any test invoices already sitting in QBO for TXR - AZ, CIN - AZ,
--   TBR - FL, TBJ - FL from PR-F through today carry no ClassRef.
--   These must be VOIDED, not reclassed - QBO's Invoice edit path
--   does not offer per-line ClassRef backfill in a way that matches
--   what a fresh POST would produce. The seed here only affects new
--   invoices generated post-deploy of the accompanying builder code.
--
-- TO ROLLBACK:
--   BEGIN;
--   ALTER TABLE sc_qbo_account_map
--     ALTER COLUMN qbo_class_id DROP NOT NULL;
--   ALTER TABLE sc_qbo_account_map
--     DROP COLUMN qbo_class_id;
--   COMMIT;
--   (also revert the builder + adapter code before or in the same
--    revert PR so they stop referencing the dropped column)
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A - preflight (standalone SELECTs, paste + read first)
-- ═══════════════════════════════════════════════════════════════════
--
-- Query 1: confirm sc_qbo_account_map currently has no qbo_class_id
-- column (0 rows expected).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'qbo_class_id';

-- Query 2: confirm four rows on sc_qbo_account_map (the four
-- currently mapped accounts). Any missing account here would leave
-- BLOCK C's UPDATE without a row to touch, and BLOCK D's NOT NULL
-- would abort.
SELECT
  account_key,
  qbo_customer_id,
  qbo_customer_name,
  qbo_mode
FROM sc_qbo_account_map
ORDER BY account_key;
-- Expected: CIN - AZ, TBJ - FL, TBR - FL, TXR - AZ (4 rows).


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B - ADD COLUMN (single ALTER, commits immediately)
-- ═══════════════════════════════════════════════════════════════════
--
-- Nullable at add so BLOCK C's UPDATEs can populate before BLOCK D
-- enforces NOT NULL. Text (not int) because QBO class ids are 19-20
-- character opaque strings, not integers.

ALTER TABLE sc_qbo_account_map
  ADD COLUMN qbo_class_id text;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C - seed (BEGIN/COMMIT with UPDATEs + postflight)
-- ═══════════════════════════════════════════════════════════════════
--
-- Four UPDATEs, one per mapped account. Class ids sourced from:
--   CIN - AZ: __fixtures__/qbo_K300168899_cin_pair_0713_main.json
--             + qbo_K300168900_cin_pair_0713_rehab.json (both share)
--   TXR - AZ: __fixtures__/qbo_K300168897_txr_wk_0720.json
--             + qbo_K300168954_txr_wk_0727.json (both share)
--   TBR - FL: Chat-Claude direct QBO probe (2026-09-03)
--   TBJ - FL: Chat-Claude direct QBO probe (2026-09-03)
--
-- WHERE qbo_class_id IS NULL restricts to unset rows - idempotent.

BEGIN;

UPDATE sc_qbo_account_map
SET qbo_class_id = '1200000000000130911'  -- PFS:CIN - AZ (REDS)
WHERE account_key = 'CIN - AZ'
  AND qbo_class_id IS NULL;

UPDATE sc_qbo_account_map
SET qbo_class_id = '1200000000000411132'  -- PFS:TXR - AZ
WHERE account_key = 'TXR - AZ'
  AND qbo_class_id IS NULL;

UPDATE sc_qbo_account_map
SET qbo_class_id = '1200000000000091984'  -- PFS:TBR - FL
WHERE account_key = 'TBR - FL'
  AND qbo_class_id IS NULL;

UPDATE sc_qbo_account_map
SET qbo_class_id = '1200000000000081313'  -- PFS:TBJ - FL
WHERE account_key = 'TBJ - FL'
  AND qbo_class_id IS NULL;

-- Postflight: raise if any of the four rows still has a NULL
-- qbo_class_id after the four UPDATEs. Catches the case where a
-- concurrent Studio edit set the value between Block A and Block C.
DO $$
DECLARE
  bad int;
BEGIN
  SELECT COUNT(*) INTO bad FROM sc_qbo_account_map
    WHERE account_key IN ('CIN - AZ', 'TXR - AZ', 'TBR - FL', 'TBJ - FL')
      AND qbo_class_id IS NULL;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'sc-41 HALT: % row(s) still have qbo_class_id=NULL after seed. Do NOT run BLOCK D. Re-run BLOCK A to inspect.', bad;
  END IF;

  RAISE NOTICE 'sc-41: 4 accounts seeded with qbo_class_id. Ready for BLOCK D (NOT NULL).';
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK D - NOT NULL constraint (single ALTER, commits immediately)
-- ═══════════════════════════════════════════════════════════════════
--
-- Do NOT run this block until BLOCK C's postflight RAISE NOTICE
-- appears in Studio's output. NOT NULL against an unseeded row
-- aborts and leaves the constraint unapplied - not destructive, but
-- signals a real issue that should be diagnosed rather than retried.

ALTER TABLE sc_qbo_account_map
  ALTER COLUMN qbo_class_id SET NOT NULL;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK E - external verify (SELECTs, paste + read last)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm column exists, is text, is NOT NULL, and all four rows
-- carry the expected values.
SELECT
  account_key,
  qbo_customer_id,
  qbo_class_id,
  qbo_mode
FROM sc_qbo_account_map
ORDER BY account_key;
-- Expected:
--   CIN - AZ, 17752, 1200000000000130911, test
--   TBJ - FL, 16971, 1200000000000081313, test
--   TBR - FL, 17860, 1200000000000091984, test
--   TXR - AZ, 19000, 1200000000000411132, test

-- Confirm constraint is in place.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'qbo_class_id';
-- Expected: qbo_class_id, text, NO
