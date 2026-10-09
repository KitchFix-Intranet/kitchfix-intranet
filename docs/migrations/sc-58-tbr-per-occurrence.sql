-- sc-58 - TBR - FL per-occurrence billing for Extended Day Labor + Extra Protein
-- Kevin ruling 2026-10-09: these bill once per day they actually occur, not as
-- a weekly flat fee. is_flat_fee=true made the builder emit one qty=1 line per
-- week regardless of actual_count (over-bills empty weeks, under-bills multi-day
-- weeks). Flipping to is_flat_fee=false routes them through the per-day meal
-- path: qty = actual_count per day, zero days = no line. tax_override and
-- line_desc_style are unaffected (both honored on the meal path). CIN - AZ
-- coffee/fountain remain flat-fee and are intentionally untouched.
-- Kevin applies in Studio. Three blocks, one at a time.

-- ============================================================
-- BLOCK A - preflight (read-only).
-- ============================================================
SELECT id::text AS service_id, account_key, service_name, is_flat_fee
FROM sc_services
WHERE id IN ('ef227171-0d60-4ff3-a5aa-d779e59da9a5',   -- Extended Day Labor (3392)
             '7d535c74-7184-4069-bad3-efbcabc16718')   -- Extra Protein Chicken/Pork MiLB (3369)
ORDER BY service_name;
-- EXPECT: exactly 2 rows, both TBR - FL, both is_flat_fee = true.
-- If not 2, or either is already false, STOP and report before Block B.

-- ============================================================
-- BLOCK B - main (one transaction).
-- ============================================================
BEGIN;
UPDATE sc_services
   SET is_flat_fee = false, updated_at = now()
 WHERE id IN ('ef227171-0d60-4ff3-a5aa-d779e59da9a5',
              '7d535c74-7184-4069-bad3-efbcabc16718')
   AND is_flat_fee = true;
-- EXPECT: UPDATE 2
COMMIT;

-- ============================================================
-- BLOCK C - postflight (read-only).
-- ============================================================
SELECT id::text AS service_id, service_name, is_flat_fee
FROM sc_services
WHERE id IN ('ef227171-0d60-4ff3-a5aa-d779e59da9a5',
             '7d535c74-7184-4069-bad3-efbcabc16718')
ORDER BY service_name;
-- EXPECT: both is_flat_fee = false.
