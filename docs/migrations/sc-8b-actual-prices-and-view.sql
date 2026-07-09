-- ═══════════════════════════════════════════════════════════════════
-- SUPERSEDED 2026-07-09 by sc-8c-remove-double-discounted-actuals.sql.
--
-- The BACKFILL half of this migration (the INSERT block below)
-- assumed sc_service_prices 'projected' rows still held the workbook
-- sticker price. That assumption was already stale when this migration
-- ran on 2026-06-24: Kevin's out-of-band SQL correction on 2026-06-16
-- had moved 'projected' rows to the post-SF invoice rate (per Price
-- Review v3, Joe-reviewed). The x factor here then applied a SECOND
-- SF discount, landing 'actual' rows at ~49% (CIN-AZ), 64% (TXR-AZ),
-- 56% (TBR-FL MiLB) of sticker instead of the intended 70%/80%/75%.
-- Every entered CIN-AZ day since this migration read ~30% too low on
-- actual_revenue.
--
-- sc-8c deletes the DATA half (all rows this INSERT wrote). The VIEW
-- half of this migration - the two-LATERAL price join in
-- sc_daily_revenue - is CORRECT infrastructure and stays. Under sc-8c,
-- the view's COALESCE(pr_act.price, pr_proj.price) falls back to
-- pr_proj (post-SF invoice rate) for every account, which is the
-- intended math.
--
-- Root-cause GOTCHAS: "shifted-input backfill trap" and "out-of-band
-- Supabase corrections need same-day capture." See docs/GOTCHAS.md.
-- Timeline: docs/SC_MONEY_ALIGNMENT_REPORT.md Part 4. Model authority:
-- docs/SC_MONEY_MODEL.md.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- sc-8b-actual-prices-and-view.sql
-- Service Calendar - pricing-fix step 2 (data backfill + view recreate)
--
-- THE DANGEROUS STEP. sc_daily_revenue is the revenue source of truth.
-- This migration changes WHAT the view computes for actual_revenue.
-- A wrong recreate here silently changes every revenue number in the
-- app at once.
--
-- DO NOT APPLY until sc-8a is applied AND the matching JS deploy is
-- live (the JS adds .eq("price_kind","projected") to dataStore reads
-- so the planning price is read deterministically once 'actual' rows
-- exist). See the APPLY ORDER section in sc-8a for the full sequence.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES
-- ═══════════════════════════════════════════════════════════════════
-- TWO categories of change, applied in one transaction:
--
-- 1. BACKFILL: insert 'actual'-kind price rows for the three per-meal
--    accounts that bill actuals at a contracted discount off the
--    planning/sticker rate:
--      - CIN - AZ: all groups at 0.70 (30% off)
--      - TXR - AZ: all groups at 0.80 (20% Annual Deposit discount)
--      - TBR - FL: Minor League only at 0.75 (25% MiLB amortization);
--                   Major League SKIPPED (no contracted discount)
--    Within each discounted scope, services flagged is_flat_fee = true
--    OR is_tax_free = true are SKIPPED (no actual row) - they pass
--    through at factor 1.00, and the view's COALESCE fallback handles
--    them. This includes CIN-AZ's Coffee Service / Fountain Bev
--    (tax-free beverages), TBR-FL's Extra Protein flat-fee add-ons,
--    and TXR-AZ's flat-fee items.
--
--    Per-meal accounts WITHOUT a contracted discount (TBJ-FL, CIN-KY,
--    TBJ-NY) get NO backfill rows - their factor is 1.00 across the
--    board, and the view's COALESCE handles them.
--
--    Flat-fee accounts (STL-FL, CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V)
--    are explicitly excluded - their revenue comes from sc_fee_schedule,
--    not from per-meal math, and their per-meal prices are either $0
--    by design (STL-FL flipped 2026-06-16) or CPI-inflated planning
--    values that do not apply to billing.
--
--    The backfill is IDEMPOTENT via ON CONFLICT DO NOTHING. Re-runs
--    are safe; the UNIQUE on (service_id, effective_date, price_kind)
--    catches re-inserts.
--
-- 2. VIEW RECREATE: sc_daily_revenue is recreated with TWO LATERAL
--    price lookups (one for each kind) instead of one. projected_revenue
--    multiplies by the 'projected' price; actual_revenue multiplies by
--    the 'actual' price (with COALESCE fallback to projected so
--    non-discounted services / accounts continue to bill at factor 1.00
--    without needing explicit 'actual' rows).
--
--    Three additions to the view's column set (no removals, no renames):
--      - price_at_date: KEPT, still the projected/planning price
--        (the column the route + dataStore + DayDetail read today).
--      - actual_price_at_date: NEW, the billing/contracted price.
--      - actual_price_effective_date: NEW, the as-of date for the
--        actual price (mirrors price_effective_date for projected).
--    The route's response shape DOES NOT break because price_at_date
--    keeps its name AND its semantic (planning price). Downstream code
--    that reads price_at_date sees the same numbers as before.
--
--    sc_month_summary is recreated BYTE-IDENTICAL to sc-6b. Its body
--    reads sc_daily_revenue, so it inherits the new actual-revenue
--    math automatically. It is re-created in this file only because
--    of the drop order (sc_month_summary depends on sc_daily_revenue;
--    we must drop it first; therefore we must re-create it after).
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THE TWO-LATERAL APPROACH
-- ═══════════════════════════════════════════════════════════════════
-- Forking the existing single LATERAL into two per-kind LATERALs is
-- cleaner than embedding a CASE inside one LATERAL. Two LATERALs
-- preserve the existing index strategy
-- (service_id, price_kind, effective_date DESC) for both lookups, and
-- the optimizer plans each independently. A single LATERAL with a
-- CASE on price_kind would still need both rows on the same page;
-- the two-lateral shape makes the intent obvious in the SQL.
--
-- The COALESCE(pr_act.price, pr_proj.price, 0) for actual_revenue
-- means: use the actual-kind price if one exists for this service +
-- date; otherwise fall back to the projected-kind price (factor 1.00);
-- otherwise 0 (no price configured). This handles every case without
-- requiring an 'actual' row for every per-meal service - only the
-- discounted ones need explicit rows.
--
-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION (do not consider this migration done without it)
-- ═══════════════════════════════════════════════════════════════════
-- After applying, run:
--   node --env-file=.env.local scripts/_verify-pricing-fix.mjs
-- All 6 checks must PASS. The headline check is CIN-AZ period 3 SUM
-- (actual_revenue) landing at ~$320K (matches the P&L 2400.1 Meal
-- Service line). The pre-fix view gave $467K.
--
-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK PROCEDURE
-- ═══════════════════════════════════════════════════════════════════
-- Both halves are independently reversible.
--
-- VIEW ROLLBACK: drop the new sc_daily_revenue + sc_month_summary and
-- paste the sc-6b VERBATIM definitions back. The sc-6b file has its
-- own ROLLBACK FALLBACK section (lines 90-163) carrying the full
-- pre-pricing-fix view body for paste-and-run restore.
--
-- BACKFILL ROLLBACK: delete the inserted 'actual' rows.
--   BEGIN;
--   DELETE FROM sc_service_prices
--   WHERE price_kind = 'actual' AND created_by = 'sc-8b-backfill';
--   COMMIT;
-- This is safe because the 'actual' rows are uniquely identified by
-- created_by = 'sc-8b-backfill' (no other process inserts with this
-- marker).
--
-- Schema (sc-8a) does not need rollback; the column + constraint
-- with a 'projected' default is forward-compatible with the
-- pre-pricing-fix view and the pre-update JS.
-- ═══════════════════════════════════════════════════════════════════


BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Backfill 'actual'-kind price rows for the discounted services
--    in the three discounted accounts.
--
-- The CTE builds the (service, factor, note) set with a single
-- account-and-group-aware CASE. Skip predicate excludes is_flat_fee
-- and is_tax_free services (they pass through at factor 1.00 via the
-- view's COALESCE). TBR-FL Major League is excluded entirely (factor
-- 1.00); only Minor League gets the 0.75 discount.
--
-- The INSERT writes one 'actual' row per existing 'projected' row,
-- preserving the same effective_date (the discount applies from the
-- contract Term start, which is the projected row's own date - the
-- spreadsheet audit confirmed no mid-year change).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO sc_service_prices
  (service_id, price, effective_date, price_kind, created_by, notes)
SELECT
  src.service_id,
  ROUND(src.projected_price * src.factor, 5) AS price,
  src.effective_date,
  'actual' AS price_kind,
  'sc-8b-backfill' AS created_by,
  src.note AS notes
FROM (
  SELECT
    p.service_id,
    p.price          AS projected_price,
    p.effective_date AS effective_date,
    CASE
      WHEN s.account_key = 'CIN - AZ' THEN 0.70
      WHEN s.account_key = 'TXR - AZ' THEN 0.80
      WHEN s.account_key = 'TBR - FL' AND g.group_name = 'Minor League' THEN 0.75
    END AS factor,
    CASE
      WHEN s.account_key = 'CIN - AZ'
        THEN 'actual = projected * 0.70 (CIN-AZ contracted rate, 30% Service Charges line on P&L)'
      WHEN s.account_key = 'TXR - AZ'
        THEN 'actual = projected * 0.80 (TXR-AZ 20% Annual Deposit discount)'
      WHEN s.account_key = 'TBR - FL' AND g.group_name = 'Minor League'
        THEN 'actual = projected * 0.75 (TBR-FL 25% MiLB amortization discount)'
    END AS note
  FROM sc_service_prices p
  JOIN sc_services s        ON s.id = p.service_id
  JOIN sc_service_groups g  ON g.id = s.group_id
  WHERE p.price_kind = 'projected'
    AND s.account_key IN ('CIN - AZ', 'TXR - AZ', 'TBR - FL')
    -- Skip flat-fee and tax-free services (factor 1.00, view fallback handles them)
    AND NOT s.is_flat_fee
    AND NOT s.is_tax_free
    -- Skip TBR-FL groups that are NOT Minor League (no discount on Major League;
    -- Boys & Girls Club is a community service, not contracted PDC billing)
    AND NOT (s.account_key = 'TBR - FL' AND g.group_name <> 'Minor League')
    -- Defensive: skip services flagged as deleted
    AND s.deleted_at IS NULL
    AND g.deleted_at IS NULL
) src
ON CONFLICT (service_id, effective_date, price_kind) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Drop the dependent + dependency views in order so the recreate
--    cleanly swaps both bodies.
-- ─────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS sc_month_summary;
DROP VIEW IF EXISTS sc_daily_revenue;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Recreate sc_daily_revenue with TWO per-kind LATERAL price lookups.
--
-- Differences from sc-6b (line-by-line):
--   - The single pr LATERAL is replaced by pr_proj (price_kind =
--     'projected') and pr_act (price_kind = 'actual'). Same WHERE +
--     ORDER + LIMIT shape; the only addition is the price_kind filter.
--   - projected_revenue multiplies projected_count by pr_proj.price.
--   - actual_revenue multiplies actual_count by COALESCE(pr_act.price,
--     pr_proj.price, 0) so the actual side falls back to the projected
--     price for non-discounted services.
--   - Two columns ADDED: actual_price_at_date and
--     actual_price_effective_date. price_at_date + price_effective_date
--     KEPT and unchanged - they continue to surface the projected
--     (planning) price, which is what the route's priceAtDate field
--     and the DayDetail entry UI consume.
--   - All other columns (group_name, is_flat_fee, etc.), the
--     service_days CTE, the catalog JOINs (with active_until handling
--     inherited verbatim from sc-6b), and the metadata join are
--     BYTE-IDENTICAL to sc-6b.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sc_daily_revenue AS
WITH service_days AS (
  SELECT account_key, service_id, service_date FROM sc_daily_projections
  UNION
  SELECT account_key, service_id, service_date FROM sc_daily_actuals
)
SELECT
  sd.account_key,
  sd.service_id,
  sd.service_date,
  s.service_name,
  s.is_flat_fee,
  s.is_tax_free,
  s.is_non_revenue,
  g.group_name,
  proj.projected_count,
  act.actual_count,
  -- Planning/sticker price columns. KEPT (name + meaning) for route +
  -- dataStore + DayDetail consumers that read priceAtDate today.
  COALESCE(pr_proj.price, 0) AS price_at_date,
  pr_proj.price_effective_date,
  -- Billing/contracted price columns. NEW. Falls back to projected when
  -- no 'actual' row exists (non-discounted accounts + skip-predicate
  -- services within discounted accounts).
  COALESCE(pr_act.price, pr_proj.price, 0) AS actual_price_at_date,
  pr_act.price_effective_date              AS actual_price_effective_date,
  -- Revenue: each side uses its own price.
  COALESCE(proj.projected_count, 0) * COALESCE(pr_proj.price, 0) AS projected_revenue,
  COALESCE(act.actual_count, 0)     * COALESCE(pr_act.price, pr_proj.price, 0) AS actual_revenue,
  act.actual_count IS NOT NULL  AS has_actuals,
  proj.projected_count IS NOT NULL AS has_projection,
  meta.period,
  meta.week_label,
  meta.event_label,
  meta.game_type,
  meta.game_time,
  meta.notes AS day_notes
FROM service_days sd
JOIN sc_services s ON s.id = sd.service_id
  AND s.deleted_at IS NULL
  AND (s.active_until IS NULL OR sd.service_date <= s.active_until)
JOIN sc_service_groups g ON g.id = s.group_id
  AND g.deleted_at IS NULL
  AND (g.active_until IS NULL OR sd.service_date <= g.active_until)
LEFT JOIN sc_daily_projections proj
  ON proj.account_key = sd.account_key
  AND proj.service_id = sd.service_id
  AND proj.service_date = sd.service_date
LEFT JOIN sc_daily_actuals act
  ON act.account_key = sd.account_key
  AND act.service_id = sd.service_id
  AND act.service_date = sd.service_date
LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id
    AND price_kind = 'projected'
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr_proj ON TRUE
LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id
    AND price_kind = 'actual'
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr_act ON TRUE
LEFT JOIN sc_day_metadata meta
  ON meta.account_key = sd.account_key
  AND meta.service_date = sd.service_date;

COMMENT ON VIEW sc_daily_revenue IS
  'Core billing view. Joins projections + actuals + per-kind price-at-date '
  '+ metadata. Revenue is always calculated, never stored. '
  'projected_revenue uses the "projected" (planning/sticker) price; '
  'actual_revenue uses the "actual" (contracted/billed) price with COALESCE '
  'fallback to projected for services / accounts without a contracted '
  'discount. For actuals_drive_invoice accounts: actual_revenue is the '
  'invoice number. For projections_drive_invoice accounts: projected_revenue '
  'is the invoice number. Rows where is_non_revenue is true represent '
  'operational counts not billable; callers must exclude them from any '
  'revenue rollup. Catalog JOINs filter on '
  '(active_until IS NULL OR service_date <= active_until) so archived '
  'services drop out for dates AFTER archive, but historical days at or '
  'before active_until still appear with full revenue values.';


-- ─────────────────────────────────────────────────────────────────────
-- 4. Recreate sc_month_summary BYTE-IDENTICAL to sc-6b. Its body reads
--    sc_daily_revenue, so it inherits the corrected actual-revenue
--    math automatically. No change to its SELECT, GROUP BY, or FILTER.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sc_month_summary AS
SELECT
  account_key,
  DATE_TRUNC('month', service_date)::DATE AS month,
  COUNT(DISTINCT service_date) AS total_service_days,
  COUNT(DISTINCT service_date) FILTER (WHERE has_actuals) AS days_with_actuals,
  SUM(projected_count) AS total_projected_meals,
  SUM(actual_count) FILTER (WHERE has_actuals) AS total_actual_meals,
  SUM(projected_revenue) FILTER (WHERE NOT is_non_revenue) AS total_projected_revenue,
  SUM(actual_revenue) FILTER (WHERE has_actuals AND NOT is_non_revenue) AS total_actual_revenue,
  SUM(actual_revenue - projected_revenue) FILTER (WHERE has_actuals AND NOT is_non_revenue) AS revenue_variance
FROM sc_daily_revenue
GROUP BY account_key, DATE_TRUNC('month', service_date);

COMMENT ON VIEW sc_month_summary IS
  'Monthly rollup for the Service Calendar dashboard. '
  'Feeds the metrics strip and year heatmap view. '
  'Revenue totals exclude is_non_revenue services (Fun Money, etc.). '
  'Meal-count totals include all services. '
  'revenue_variance is the per-day (actual - projected) sum across revenue-bearing '
  'services on days where actuals exist; with the pricing-fix in place this '
  'is now measured at the actual-contracted rate vs the projected-sticker '
  'rate, which is the right framing for the variance signal.';


-- ─────────────────────────────────────────────────────────────────────
-- 5. GRANTs - re-issued verbatim because DROP+CREATE does not preserve
--    them (unlike CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────
GRANT SELECT ON sc_daily_revenue  TO service_role;
GRANT SELECT ON sc_month_summary  TO service_role;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- DONE. Run scripts/_verify-pricing-fix.mjs and confirm all 6 checks
-- PASS before considering the migration finished. If the headline
-- CIN-AZ period 3 ~$320K check fails, roll back per the ROLLBACK
-- PROCEDURE section above.
-- ═══════════════════════════════════════════════════════════════════
