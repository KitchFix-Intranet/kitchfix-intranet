-- ═══════════════════════════════════════════════════════════════════
-- sc-8a-price-kind-column.sql
-- Service Calendar - pricing-fix step 1 (schema only)
--
-- THE FIRST OF TWO MIGRATION FILES in the pricing-fix series. This one
-- is schema-only and safe to apply at any time; the data backfill and
-- view recreate live in sc-8b which must be applied AFTER the matching
-- application JS deploy.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS MIGRATION EXISTS
-- ═══════════════════════════════════════════════════════════════════
-- sc_daily_revenue currently multiplies BOTH projected_count and
-- actual_count by the same single price from sc_service_prices (see
-- sc-6b view body lines 218-219). That works when projected and actual
-- billing rates are equal, but the per-meal contract for CIN-AZ
-- (30% off), TXR-AZ (20% off), and TBR-FL MiLB (25% off) bills actuals
-- at a CONTRACTED rate that is lower than the planning/sticker rate.
-- The empirical mismatch was confirmed against the P&L: CIN-AZ period 3
-- live view total is $467K at sticker; the P&L 2400.1 Meal Service line
-- is $320K - exactly the 70% rate. Same shape for TBR-FL MiLB.
--
-- The fix needs sc_service_prices to carry TWO prices per service: a
-- "projected" price (planning/sticker) and an "actual" price (billed).
-- The view then forks: projected_revenue = projected_count * projected
-- price; actual_revenue = actual_count * actual price.
--
-- This file does the SCHEMA half: adds the price_kind discriminator
-- column with DEFAULT 'projected' (so every existing row becomes a
-- 'projected' row), upgrades the UNIQUE constraint, and refreshes the
-- index. No data changes. No view changes. Existing application reads
-- continue to work (they ignore the new column).
--
-- ═══════════════════════════════════════════════════════════════════
-- APPLY ORDER (do not skip)
-- ═══════════════════════════════════════════════════════════════════
-- 1. APPLY THIS FILE (sc-8a) in Supabase Studio. Verifies as a no-op
--    on read paths since every existing row gets price_kind='projected'.
-- 2. MERGE THE PR carrying the application JS updates that add the
--    .eq("price_kind", "projected") filter to dataStore reads and the
--    price_kind: 'projected' marker to admin upserts. Vercel deploys.
-- 3. APPLY sc-8b in Supabase Studio (the backfill + view recreate).
-- 4. Run scripts/_verify-pricing-fix.mjs against the live view and
--    confirm all 6 verification checks PASS (CIN-AZ period 3 ~$320K is
--    the headline).
--
-- If verification fails after sc-8b, ROLLBACK sc-8b only (the view
-- recreate is reversible via the sc-8b rollback section). sc-8a does
-- not need rollback: adding a column with DEFAULT 'projected' is
-- forward-only and harmless.
--
-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK PROCEDURE (sc-8a only)
-- ═══════════════════════════════════════════════════════════════════
-- If for any reason you need to remove the column (do not, but for the
-- record):
--   BEGIN;
--   ALTER TABLE sc_service_prices
--     DROP CONSTRAINT IF EXISTS uq_sc_service_prices_service_date_kind;
--   ALTER TABLE sc_service_prices
--     ADD CONSTRAINT uq_sc_service_prices_service_date
--     UNIQUE (service_id, effective_date);
--   DROP INDEX IF EXISTS idx_sc_service_prices_lookup;
--   CREATE INDEX idx_sc_service_prices_lookup
--     ON sc_service_prices (service_id, effective_date DESC);
--   ALTER TABLE sc_service_prices DROP COLUMN IF EXISTS price_kind;
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. Add price_kind column with default and CHECK constraint.
--    DEFAULT 'projected' means every existing row becomes a projected
--    row (correct: every existing row is the planning/sticker price).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE sc_service_prices
  ADD COLUMN IF NOT EXISTS price_kind TEXT NOT NULL DEFAULT 'projected'
  CHECK (price_kind IN ('projected', 'actual'));


-- ─────────────────────────────────────────────────────────────────────
-- 2. Upgrade UNIQUE: (service_id, effective_date) is no longer enough -
--    a service must be able to carry both 'projected' and 'actual'
--    rows on the same effective_date. The pre-fix diagnostic probe
--    confirmed zero existing duplicates of (service_id, effective_date),
--    so the constraint swap is a clean upgrade.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE sc_service_prices
  DROP CONSTRAINT IF EXISTS uq_sc_service_prices_service_date;

ALTER TABLE sc_service_prices
  ADD CONSTRAINT uq_sc_service_prices_service_date_kind
  UNIQUE (service_id, effective_date, price_kind);


-- ─────────────────────────────────────────────────────────────────────
-- 3. Refresh the lookup index. The view's LATERAL subqueries filter by
--    (service_id, price_kind) and ORDER BY effective_date DESC. Putting
--    price_kind in the index supports both per-kind lookups efficiently.
-- ─────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_sc_service_prices_lookup;

CREATE INDEX IF NOT EXISTS idx_sc_service_prices_lookup
  ON sc_service_prices (service_id, price_kind, effective_date DESC);


-- ─────────────────────────────────────────────────────────────────────
-- 4. Update the table comment so the new schema is self-documenting.
-- ─────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN sc_service_prices.price_kind IS
  '"projected" = planning/sticker price the chef plans and sees in the entry UI. '
  '"actual" = contracted/billed price for actual_revenue (typically post-discount). '
  'The same (service_id, effective_date) can carry both kinds. Missing "actual" row '
  'means no contracted discount applies; the view''s COALESCE falls back to the '
  '"projected" price for actual_revenue in that case (factor 1.00).';

COMMENT ON TABLE sc_service_prices IS
  'Price ledger. To find the planning price active on a given date: '
  'SELECT price FROM sc_service_prices '
  'WHERE service_id = $1 AND price_kind = ''projected'' AND effective_date <= $2 '
  'ORDER BY effective_date DESC LIMIT 1. '
  'For the billed/actual price, substitute price_kind = ''actual'' and COALESCE to '
  'the projected price when the actual lookup returns no row.';
