-- ═══════════════════════════════════════════════════════════════════
-- sc-49-invoice-slot-code
--
-- Deterministic SC invoice DocNumbers, Kevin ruling 2026-09-26 after
-- the 2026-09-26 KF000000005 collision (QBO error 6140). Sebastian
-- created an invoice manually in the QBO UI; QBO auto-filled the
-- next number from our last saved invoice (KF000000004), silently
-- consuming KF000000005 before Liz's TXR-AZ week-of-9/21 push tried
-- to use it.
--
-- The design flaw: our sequence and QBO's auto-increment share one
-- namespace with no coordination. Every manual QBO invoice created
-- after one of ours silently takes our next number.
--
-- The fix: stop drawing from a counter. Derive the DocNumber from
-- the invoice's own identity: KF + account code + YYMMDD week +
-- slot code + optional revision. See docs/GOTCHAS.md for the full
-- rationale.
--
-- WHAT THIS MIGRATION ADDS
-- sc_qbo_service_map.slot_code: 2-3 uppercase chars, unique within
-- an account. Application concatenates it into the DocNumber. Test
-- mode continues to use the KFT sequence (sc-48); only the live
-- KF path becomes deterministic.
--
-- Live sequence sc_invoice_number_seq is RETIRED after this ships
-- but NOT dropped - it is the only record of how KF000000001..004
-- were issued. Retirement is expressed via a COMMENT ON SEQUENCE
-- in Block B.
--
-- CONSUMERS
-- src/lib/billing/qboAdapter.js:buildInvoiceDocNumber (pure function).
-- src/lib/scWeekFinalize.js reads slot_code + computes revision
-- before calling postInvoiceDraft; qboAdapter never queries for
-- slot_code itself (reservation-seam discipline: no I/O at the seam).
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B's ADD COLUMN IF NOT EXISTS, DO $$ BEGIN ...
-- and CREATE INDEX IF NOT EXISTS are no-ops after the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm sc_qbo_service_map exists (guardrail).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'sc_qbo_service_map';

-- Confirm slot_code column does NOT exist yet. Expected: zero rows.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_service_map'
  AND column_name  = 'slot_code';

-- Confirm the partial unique index does NOT exist yet. Expected: zero rows.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'sc_qbo_service_map'
  AND indexname  = 'sc_qbo_service_map_slot_code_uniq';

-- Show the 16 (account_key, invoice_slot) pairs the seed will cover.
-- Expected exactly these 16 rows on 2026-09-26 (Chat-Claude verified).
-- Adding a row to sc_qbo_service_map after this preflight but before
-- Block B's UPDATE means the postflight NULL-slot_code check will fail;
-- re-run this preflight if the count differs from 16.
SELECT account_key, invoice_slot, COUNT(*) AS active_rows
FROM sc_qbo_service_map
WHERE active = true
GROUP BY account_key, invoice_slot
ORDER BY account_key, invoice_slot;

-- Account-code prefix guard preview. Computed here so we can eyeball
-- it before Block B and so Block C can re-run the same check as an
-- assertion. Expected: zero rows returned (no code is a prefix of any
-- other code in the current 14 account_keys).
WITH codes AS (
  SELECT DISTINCT
         account_key,
         upper(regexp_replace(account_key, '[^A-Za-z0-9]', '', 'g')) AS code
  FROM sc_qbo_account_map
)
SELECT a.account_key AS a_key, a.code AS a_code,
       b.account_key AS b_key, b.code AS b_code
FROM codes a
JOIN codes b
  ON a.account_key <> b.account_key
 AND b.code LIKE a.code || '%';


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add the column. Nullable during backfill; NOT NULL is not
-- enforced at column level because a new sc_qbo_service_map row
-- inserted before someone assigns its slot_code would then fail on
-- INSERT; instead the postflight asserts every active row is filled
-- and the application refuses to invoice a slot with a NULL code
-- (fail-loudly upstream of the reservation seam).
ALTER TABLE sc_qbo_service_map
  ADD COLUMN IF NOT EXISTS slot_code TEXT;

-- 2. CHECK constraint: 2-3 uppercase letters. Idempotent via
-- pg_constraint lookup - repeat runs are no-ops.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sc_qbo_service_map_slot_code_shape'
  ) THEN
    ALTER TABLE sc_qbo_service_map
      ADD CONSTRAINT sc_qbo_service_map_slot_code_shape
      CHECK (slot_code IS NULL OR slot_code ~ '^[A-Z]{2,3}$');
  END IF;
END $$;

-- 3. Partial unique index. Uniqueness is per account and only
-- applies when slot_code is set (nullable during backfill windows).
CREATE UNIQUE INDEX IF NOT EXISTS sc_qbo_service_map_slot_code_uniq
  ON sc_qbo_service_map (account_key, slot_code)
  WHERE slot_code IS NOT NULL;

-- 4. Seed the 16 currently-active (account, invoice_slot) pairs.
-- Codes repeat across accounts (MN on three; MIL/MLB on two each) -
-- that is intended, uniqueness is per-account. UPDATE not INSERT so
-- re-running Block B is a no-op after the first apply.
UPDATE sc_qbo_service_map SET slot_code = 'MN'  WHERE account_key = 'TXR - AZ' AND invoice_slot = 'main'        AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MN'  WHERE account_key = 'CIN - AZ' AND invoice_slot = 'main'        AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'RH'  WHERE account_key = 'CIN - AZ' AND invoice_slot = 'rehab'       AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MN'  WHERE account_key = 'TBR - FL' AND invoice_slot = 'main'        AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MIL' WHERE account_key = 'TBR - FL' AND invoice_slot = 'milb'        AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MLB' WHERE account_key = 'TBR - FL' AND invoice_slot = 'mlb'         AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'CAT' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'catering'    AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'FLO' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'florida-ops' AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MED' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'media-meals' AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MIL' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'milb'        AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MIP' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'milb-pantry' AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MLB' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'mlb'         AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'MLP' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'mlb-pantry'  AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'SCT' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'scout-meals' AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'SGA' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'single-a'    AND active = true AND slot_code IS NULL;
UPDATE sc_qbo_service_map SET slot_code = 'SSM' WHERE account_key = 'TBJ - FL' AND invoice_slot = 'ssm'         AND active = true AND slot_code IS NULL;

-- 5. Column comment naming the consumers.
COMMENT ON COLUMN sc_qbo_service_map.slot_code IS
  'Slot code appended to the SC-generated DocNumber (sc-49). 2-3 uppercase letters, unique per account_key. Feeds src/lib/billing/qboAdapter.js:buildInvoiceDocNumber. Nullable to allow adding a slot then assigning a code in Studio; qboAdapter refuses to invoice a slot with a NULL code.';

-- 6. Mark the live sequence retired. sc-48's sc_invoice_number_seq
-- stays in place because it is the only record of how KF000000001..004
-- were issued; the retirement is a comment, not a DROP.
COMMENT ON SEQUENCE sc_invoice_number_seq IS
  'RETIRED 2026-09-26 (sc-49). Live SC invoice DocNumbers now derive from (account_key, week_start, slot_code, revision) via src/lib/billing/qboAdapter.js:buildInvoiceDocNumber. This sequence issued KF000000001..004; the values remain in sc_export_ledger for audit. sc_invoice_test_number_seq is still in active use for KFT test-mode pushes (Kevin ruling: test mode stays counter-based; see docs/GOTCHAS.md).';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Column present + nullable.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_service_map'
  AND column_name  = 'slot_code';

-- CHECK constraint present with the expected regex.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conname = 'sc_qbo_service_map_slot_code_shape';

-- Partial unique index present.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'sc_qbo_service_map'
  AND indexname  = 'sc_qbo_service_map_slot_code_uniq';

-- Every active row now has a slot_code. Expected: zero rows.
SELECT account_key, invoice_slot, id
FROM sc_qbo_service_map
WHERE active = true
  AND slot_code IS NULL
ORDER BY account_key, invoice_slot;

-- Uniqueness within an account holds. Expected: zero rows.
SELECT account_key, slot_code, COUNT(*) AS n
FROM sc_qbo_service_map
WHERE active = true
  AND slot_code IS NOT NULL
GROUP BY account_key, slot_code
HAVING COUNT(*) > 1
ORDER BY account_key, slot_code;

-- Full slot_code inventory for review.
SELECT account_key, invoice_slot, slot_code
FROM sc_qbo_service_map
WHERE active = true
ORDER BY account_key, invoice_slot;

-- Account-code prefix guard (assertion form). No code should be a
-- prefix of another. Expected: zero rows.
WITH codes AS (
  SELECT DISTINCT
         account_key,
         upper(regexp_replace(account_key, '[^A-Za-z0-9]', '', 'g')) AS code
  FROM sc_qbo_account_map
)
SELECT a.account_key AS a_key, a.code AS a_code,
       b.account_key AS b_key, b.code AS b_code
FROM codes a
JOIN codes b
  ON a.account_key <> b.account_key
 AND b.code LIKE a.code || '%';

-- Confirm sc_invoice_number_seq is still in place (retirement is a
-- comment, not a DROP) so audit continues to name a real object.
SELECT sequence_name, last_value
FROM (
  SELECT 'sc_invoice_number_seq'      AS sequence_name, last_value FROM sc_invoice_number_seq
  UNION ALL
  SELECT 'sc_invoice_test_number_seq',                    last_value FROM sc_invoice_test_number_seq
) s
ORDER BY sequence_name;

-- Confirm the retired-sequence comment took.
SELECT obj_description('sc_invoice_number_seq'::regclass, 'pg_class') AS comment;
