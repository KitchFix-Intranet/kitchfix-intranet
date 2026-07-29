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
-- WHAT THIS FILE DOES (order matters - see next paragraph)
-- 1. DROP the P-anchored CHECK. This has to come FIRST: sc-20's
--    constraint enforces ^P([1-9]|1[0-3])$, so any UPDATE that writes
--    a bare "4" is rejected while the constraint is live. First
--    apply of this file with the DROP after the UPDATE fails with
--    "value violates check constraint" and rolls back the whole
--    migration.
-- 2. UPDATE all sc_labor_budgets rows to strip the "P" prefix from
--    `period`. Idempotent - the WHERE clause matches only rows that
--    still have a P.
-- 3. UPDATE TXR-TX-H P10's hourly_budget from 15714.29 to 15714.26.
--    Root cause: $15,714.29 × 7 = $110,000.03; owner spec named the
--    rounded per-period figure but demands an exact season total.
--    Six rows stay at 15714.29; P10 (row #7) absorbs the 3¢ drift
--    so the season sums to $110,000.00 exactly. Comment records the
--    reason so nobody later "corrects" the odd row back to uniform.
-- 4. ADD the bare-numeric CHECK. Comes LAST for symmetry with step 1
--    and because the row values have to be in the new shape before
--    the new constraint gets validated.
--
-- Every step is idempotent - re-applying this file after a partial
-- or complete apply is a no-op.
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

-- ─── 1. DROP the P-anchored CHECK ──────────────────────────────────
-- Detect by regex signature on pg_get_constraintdef, not by a guessed
-- name (the sc-20 CHECK was named implicitly at CREATE TABLE time).
-- Same lesson as fix/sc-20-do-block: match on definition, never on
-- the literal `IN` token (Postgres normalises to `= ANY (ARRAY[...])`
-- on storage). Idempotent - the block is a no-op after the drop.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'sc_labor_budgets'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%^P(%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sc_labor_budgets DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- ─── 2. Strip P-prefix on existing rows ─────────────────────────────
-- REGEXP_REPLACE only fires for rows that still have a P; a re-apply
-- is a no-op. Preserves the id + effective_from + change trail.
UPDATE sc_labor_budgets
   SET period = REGEXP_REPLACE(period, '^P', '')
 WHERE period ~ '^P[0-9]';

-- ─── 3. TXR-TX-H P10 drift correction ───────────────────────────────
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

-- ─── 4. ADD bare-numeric CHECK ──────────────────────────────────────
-- Only add if a bare-numeric CHECK isn't already present. Detect by
-- the same regex-signature technique as step 1 (this time positive:
-- look for the bare-numeric anchor).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'sc_labor_budgets'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%^([1-9]%'
  ) THEN
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
