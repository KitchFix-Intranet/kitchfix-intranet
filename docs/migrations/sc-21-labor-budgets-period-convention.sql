-- ═══════════════════════════════════════════════════════════════════
-- sc-21-labor-budgets-period-convention.sql
-- Service Calendar - M-1 correction: sc_labor_budgets.period joins
-- sc_day_metadata.period, which stores BARE NUMERIC ("4", "5", ...).
--
-- WHY
-- The sc-20 seed inserted period as "P4", "P5", ..., "P10" and the
-- CHECK constraint enforced ^P([1-9]|1[0-3])$. That mismatched the
-- house convention: sc_day_metadata.period is bare numeric ("4"..."10")
-- and the URL contract is `?period=8` (no prefix). deriveLaborBudgets
-- joins on the raw string; the P-vs-bare mismatch caused every
-- homestand envelope to emit null with "no live sc_labor_budgets row
-- for 4" at gate.
--
-- Owner ruling: fix the convention, not the join. A normalization
-- helper hides a disagreement rather than removing it, and the next
-- person to join these tables hits it again with no warning. The
-- table holds 28 rows and is a day old - the cheapest this
-- correction will ever be.
--
-- WHAT THIS FILE DOES
-- 1. UPDATE all sc_labor_budgets rows to strip the "P" prefix from
--    `period`. Idempotent - no-op after first apply (the regex on
--    the WHERE clause misses bare-numeric values).
-- 2. UPDATE TXR-TX-H P10's hourly_budget from 15714.29 to 15714.26.
--    Root cause: $15,714.29 × 7 = $110,000.03; owner spec named the
--    rounded per-period figure but demands an exact season total.
--    Six rows stay at 15714.29; P10 (row #7) absorbs the 3¢ drift
--    so the season sums to $110,000.00 exactly. Comment records the
--    reason so nobody later "corrects" the odd row back to uniform.
-- 3. DROP the P-anchored CHECK, ADD a bare-numeric CHECK that
--    matches sc_day_metadata's convention.
--
-- POST-APPLY VERIFY
--   SELECT account_key, period, hourly_budget FROM sc_labor_budgets ORDER BY 1, 2;
--   (28 rows, period in {'4','5','6','7','8','9','10'}, TXR-TX-H P10
--    = 15714.26, no P-prefix anywhere)
--
--   node --env-file=.env.local scripts/_probe_labor_budget_acceptance.mjs
--   (headline check: every account sums to P&L season total EXACTLY)
--
-- Apply in Supabase Studio.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Strip P-prefix on existing rows ─────────────────────────────
-- REGEXP_REPLACE only fires for rows that still have a P; a re-apply
-- is a no-op. Preserves the id + effective_from + change trail.
UPDATE sc_labor_budgets
   SET period = REGEXP_REPLACE(period, '^P', '')
 WHERE period ~ '^P[0-9]';

-- ─── 2. TXR-TX-H P10 drift correction ───────────────────────────────
-- Owner-anchored: seven periods × $15,714.29 = $110,000.03 (3¢ drift).
-- Owner ruling: nudge P10 (the last chronological slot) to $15,714.26
-- so the season sums to $110,000.00 exactly. Do NOT restore the
-- uniform value; the intent is a per-period figure that respects the
-- season constraint. Idempotent - re-apply is a no-op if already .26.
UPDATE sc_labor_budgets
   SET hourly_budget = 15714.26
 WHERE account_key = 'TXR - TX - H'
   AND period       = '10'
   AND hourly_budget = 15714.29;

-- ─── 3. CHECK - swap P-anchored for bare-numeric ────────────────────
-- Detect by constraint name so re-applies are idempotent. Same
-- pattern lesson as sc-20's DO-block correction (fix/sc-20-do-block):
-- match on NAME + a NOT-LIKE on the definition text; do NOT match on
-- the literal `IN` token (Postgres normalises to `= ANY (ARRAY[...])`
-- on storage).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'sc_labor_budgets'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%^P(%'
  ) THEN
    -- The CHECK was named implicitly at CREATE TABLE time; look it up
    -- by column + regex signature rather than a guessed name.
    EXECUTE (
      SELECT format('ALTER TABLE sc_labor_budgets DROP CONSTRAINT %I', c.conname)
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'sc_labor_budgets'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%^P(%'
      LIMIT 1
    );
    ALTER TABLE sc_labor_budgets
      ADD CONSTRAINT sc_labor_budgets_period_check
        CHECK (period ~ '^([1-9]|1[0-3])$');
  END IF;
END $$;

COMMENT ON COLUMN sc_labor_budgets.period IS
  'Fiscal period identifier. BARE NUMERIC ("4", "5", ..., "10") to '
  'match sc_day_metadata.period, which is the house convention. '
  'Display formats add a "P" prefix at render (admin: "P" + period). '
  'sc-20 originally stored "P4"..."P10"; sc-21 corrected the value + '
  'CHECK to remove the divergence.';
