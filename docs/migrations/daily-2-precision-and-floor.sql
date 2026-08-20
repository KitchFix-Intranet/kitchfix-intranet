-- ═══════════════════════════════════════════════════════════════════
-- daily-2-precision-and-floor.sql
--
-- Follow-up to daily-1. Two independent changes bundled because they
-- both drop into place while labor_actuals_daily has no consumers
-- (pr-2 lands the range resolver later).
--
-- Change A - dollars precision NUMERIC(14,2) -> NUMERIC(14,4)
-- ────────────────────────────────────────────────────────────
-- The D3 probe measured CIN - OH week 06/29 sum as $4,328.26
-- through the daily path vs the weekly sentinel $4,328.27. Cause:
-- per-day rounding to 2dp is fine per row but sub-cent drift
-- compounds when summed across the week's workers (each of 5
-- workers is $0.002 short, total $0.01). Kevin ruling 2026-08-20:
-- fix it, do not accept it. The artifact scales - $0.01 on one
-- week is roughly $1 across 18 weeks, so a quarter-length range
-- would be off by dollars. Weekly sentinel stays at $4,328.27;
-- the daily path now matches it exactly.
--
-- The stored values still make sense at 2dp for display; the extra
-- precision only matters when summed. Hours columns stay at
-- NUMERIC(10,2) (integer-ish input from Rippling; no drift risk).
--
-- Change B - documentation of the data-derived day-grain floor
-- ─────────────────────────────────────────────────────────────
-- Kevin ruling 2026-08-20: the day-grain floor is the earliest week
-- where labor_actuals.week_source = 'sc_day_metadata'. Weeks before
-- that were backfilled from a Rippling REPORT export (totals-only,
-- no per-segment breakdown, retention already passed for the
-- underlying segments). They are a permanent grain boundary, not a
-- gap we can fill. As of 2026-08-20 the floor is 2026-04-20.
--
-- Enforcement lives in the DERIVE (scripts/derive_labor_actuals_daily.mjs
-- reads the floor from labor_actuals at run time and rejects any
-- segment with segment_date < floor). No CHECK constraint here
-- because the floor is data-derived; a static CHECK would bake in
-- a magic date and break silently when the floor advances.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio.
-- 2. The ALTER TABLE below is a metadata change on an empty-ish
--    table (~4,520 rows today); should complete in seconds.
-- 3. After apply, re-run scripts/derive_labor_actuals_daily.mjs
--    --source=backfill --window=fytd once so existing rows are
--    rewritten at 4dp precision and any sub-floor rows are swept.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Change A - dollars precision ──────────────────────────────────
ALTER TABLE labor_actuals_daily
  ALTER COLUMN dollars_regular        TYPE NUMERIC(14,4),
  ALTER COLUMN dollars_overtime       TYPE NUMERIC(14,4),
  ALTER COLUMN dollars_double_time    TYPE NUMERIC(14,4),
  ALTER COLUMN dollars_premium_other  TYPE NUMERIC(14,4),
  ALTER COLUMN amount                 TYPE NUMERIC(14,4);

-- ─── Post-state (paste in the attestation) ─────────────────────────
--   SELECT column_name, numeric_precision, numeric_scale
--     FROM information_schema.columns
--    WHERE table_name = 'labor_actuals_daily'
--      AND column_name IN ('dollars_regular','dollars_overtime',
--                          'dollars_double_time','dollars_premium_other',
--                          'amount')
--    ORDER BY column_name;
-- expected: all 5 rows show precision=14, scale=4.


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
