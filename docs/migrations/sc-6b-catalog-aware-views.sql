-- ═══════════════════════════════════════════════════════════════════
-- sc-6b-catalog-aware-views.sql
-- Service Calendar - Bundle 2 Step 2 (catalog lifecycle, view recreate)
--
-- THE DANGEROUS STEP. sc_daily_revenue is what the entire calendar
-- reads for revenue (the thing Stage 1 made trustworthy).
-- sc_month_summary depends on sc_daily_revenue. A wrong recreate here -
-- a swapped alias, a missed COALESCE, a dropped column, a wrong filter -
-- silently breaks every account's revenue numbers at once.
--
-- Apply ONLY after the snapshot-diff probe runs through its before
-- phase. Do NOT apply unless Kevin has the snapshot files in hand.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES
-- ═══════════════════════════════════════════════════════════════════
-- DROPs and re-CREATEs the two SC views with EXACTLY ONE category
-- of change: the sc_services and sc_service_groups JOINs in
-- sc_daily_revenue gain an active_until-aware predicate.
--
-- Before (sc-1b):
--   JOIN sc_services s        ON s.id = sd.service_id AND s.deleted_at IS NULL
--   JOIN sc_service_groups g  ON g.id = s.group_id    AND g.deleted_at IS NULL
--
-- After (this file):
--   JOIN sc_services s        ON s.id = sd.service_id
--     AND s.deleted_at IS NULL
--     AND (s.active_until IS NULL OR sd.service_date <= s.active_until)
--   JOIN sc_service_groups g  ON g.id = s.group_id
--     AND g.deleted_at IS NULL
--     AND (g.active_until IS NULL OR sd.service_date <= g.active_until)
--
-- Effect: a service whose active_until is set to date X is included
-- in sc_daily_revenue for service_date <= X (HISTORY PRESERVED) and
-- excluded for service_date > X (FORWARD ARCHIVE).
--
-- Everything else - every SELECT column, every COALESCE, every alias,
-- every LATERAL, every LEFT JOIN, the UNION in service_days,
-- sc_day_metadata join, and the entire sc_month_summary body - is
-- BYTE-IDENTICAL to sc-1b. sc_month_summary inherits the new filtering
-- automatically by reading sc_daily_revenue; its body does not change.
-- It is re-created in this file only so the drop order works
-- (sc_month_summary depends on sc_daily_revenue, so we must drop it
-- first; therefore we must re-create it after).
--
-- deleted_at IS NULL is KEPT in both JOINs - active_until is ADDED
-- alongside it, not replacing it. Per the sc-6a header's three-way
-- clarification: archive uses active_until; deleted_at stays the
-- dormant hard-delete escape hatch.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THE SNAPSHOT DIFF MUST BE EMPTY
-- ═══════════════════════════════════════════════════════════════════
-- After sc-6a, every existing sc_services row and every existing
-- sc_service_groups row has active_until = NULL (probe-confirmed; no
-- backfill happened). For every existing row, the new predicate
-- (active_until IS NULL OR sd.service_date <= active_until)
-- evaluates TRUE because of the IS NULL branch. So every row that
-- the old view emitted is still emitted by the new view, with
-- identical column values - the predicate change has no observable
-- effect against the current data.
--
-- The diff between BEFORE snapshot and AFTER snapshot MUST be ZERO
-- rows for both views. ANY non-zero diff means the recreate
-- accidentally changed something other than the filter - and Kevin
-- must roll back via the procedure in the next section.
--
-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK PROCEDURE
-- ═══════════════════════════════════════════════════════════════════
-- A view recreate is reversible ONLY because the OLD DDL is captured.
-- The verbatim sc-1b view definitions are inlined below for paste-
-- and-run rollback. To roll back sc-6b in Studio:
--
--   BEGIN;
--   DROP VIEW IF EXISTS sc_month_summary;
--   DROP VIEW IF EXISTS sc_daily_revenue;
--
--   -- (paste the sc-1b verbatim definitions from the ROLLBACK FALLBACK
--   --  section below, then COMMIT)
--
--   COMMIT;
--
-- The sc-6a active_until column on the catalog tables can stay (it
-- is dormant under the rolled-back views). If the column itself needs
-- removing too, run ALTER TABLE ... DROP COLUMN active_until on both
-- tables AFTER confirming no other code reads it.
--
-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK FALLBACK - sc-1b view definitions VERBATIM
-- ═══════════════════════════════════════════════════════════════════
-- Source: docs/migrations/sc-1b-add-non-revenue-flag.sql (lines 55-144).
-- Paste this block in Studio to restore sc-1b view behavior after a
-- DROP of the new views.
--
-- CREATE OR REPLACE VIEW sc_daily_revenue AS
-- WITH service_days AS (
--   SELECT account_key, service_id, service_date FROM sc_daily_projections
--   UNION
--   SELECT account_key, service_id, service_date FROM sc_daily_actuals
-- )
-- SELECT
--   sd.account_key,
--   sd.service_id,
--   sd.service_date,
--   s.service_name,
--   s.is_flat_fee,
--   s.is_tax_free,
--   s.is_non_revenue,
--   g.group_name,
--   proj.projected_count,
--   act.actual_count,
--   COALESCE(pr.price, 0) AS price_at_date,
--   pr.price_effective_date,
--   COALESCE(proj.projected_count, 0) * COALESCE(pr.price, 0) AS projected_revenue,
--   COALESCE(act.actual_count,   0) * COALESCE(pr.price, 0) AS actual_revenue,
--   act.actual_count IS NOT NULL  AS has_actuals,
--   proj.projected_count IS NOT NULL AS has_projection,
--   meta.period,
--   meta.week_label,
--   meta.event_label,
--   meta.game_type,
--   meta.game_time,
--   meta.notes AS day_notes
-- FROM service_days sd
-- JOIN sc_services s ON s.id = sd.service_id AND s.deleted_at IS NULL
-- JOIN sc_service_groups g ON g.id = s.group_id AND g.deleted_at IS NULL
-- LEFT JOIN sc_daily_projections proj
--   ON proj.account_key = sd.account_key
--   AND proj.service_id = sd.service_id
--   AND proj.service_date = sd.service_date
-- LEFT JOIN sc_daily_actuals act
--   ON act.account_key = sd.account_key
--   AND act.service_id = sd.service_id
--   AND act.service_date = sd.service_date
-- LEFT JOIN LATERAL (
--   SELECT price, effective_date AS price_effective_date
--   FROM sc_service_prices
--   WHERE service_id = sd.service_id
--     AND effective_date <= sd.service_date
--   ORDER BY effective_date DESC
--   LIMIT 1
-- ) pr ON TRUE
-- LEFT JOIN sc_day_metadata meta
--   ON meta.account_key = sd.account_key
--   AND meta.service_date = sd.service_date;
--
-- CREATE OR REPLACE VIEW sc_month_summary AS
-- SELECT
--   account_key,
--   DATE_TRUNC('month', service_date)::DATE AS month,
--   COUNT(DISTINCT service_date) AS total_service_days,
--   COUNT(DISTINCT service_date) FILTER (WHERE has_actuals) AS days_with_actuals,
--   SUM(projected_count) AS total_projected_meals,
--   SUM(actual_count) FILTER (WHERE has_actuals) AS total_actual_meals,
--   SUM(projected_revenue) FILTER (WHERE NOT is_non_revenue) AS total_projected_revenue,
--   SUM(actual_revenue) FILTER (WHERE has_actuals AND NOT is_non_revenue) AS total_actual_revenue,
--   SUM(actual_revenue - projected_revenue) FILTER (WHERE has_actuals AND NOT is_non_revenue) AS revenue_variance
-- FROM sc_daily_revenue
-- GROUP BY account_key, DATE_TRUNC('month', service_date);
--
-- GRANT SELECT ON sc_daily_revenue TO service_role;
-- GRANT SELECT ON sc_month_summary TO service_role;
--
-- ═══════════════════════════════════════════════════════════════════
-- APPLY PROTOCOL (do not skip)
-- ═══════════════════════════════════════════════════════════════════
-- 1. Run the snapshot-diff probe's BEFORE phase:
--      node --env-file=.env.local \
--        scripts/_probe_sc6b_view_recreate_verify.mjs --phase=before
--    This writes before_daily.json + before_month.json. Confirm both
--    row counts in the output before proceeding.
-- 2. Apply THIS migration in Studio.
-- 3. Run the probe's DIFF phase:
--      node --env-file=.env.local \
--        scripts/_probe_sc6b_view_recreate_verify.mjs --phase=diff
--    Both diffs MUST be 0 rows. If non-zero, roll back via the
--    ROLLBACK FALLBACK section above and surface the differing rows.
-- 4. Run the probe's POSITIVE phase to prove the new behavior works:
--      node --env-file=.env.local \
--        scripts/_probe_sc6b_view_recreate_verify.mjs --phase=positive
--    Or run the equivalent Studio SQL block printed by the probe.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. DROP order: month_summary depends on daily_revenue, so drop it first.
-- ─────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS sc_month_summary;
DROP VIEW IF EXISTS sc_daily_revenue;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Recreate sc_daily_revenue with active_until-aware catalog JOINs.
-- ─────────────────────────────────────────────────────────────────────
-- Body is identical to sc-1b lines 55-105 with the ONLY change being
-- the two JOIN ON-clauses for sc_services and sc_service_groups
-- gaining (active_until IS NULL OR sd.service_date <= active_until).
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
  COALESCE(pr.price, 0) AS price_at_date,
  pr.price_effective_date,
  COALESCE(proj.projected_count, 0) * COALESCE(pr.price, 0) AS projected_revenue,
  COALESCE(act.actual_count,   0) * COALESCE(pr.price, 0) AS actual_revenue,
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
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr ON TRUE
LEFT JOIN sc_day_metadata meta
  ON meta.account_key = sd.account_key
  AND meta.service_date = sd.service_date;

COMMENT ON VIEW sc_daily_revenue IS
  'Core billing view. Joins projections + actuals + price-at-date + metadata. '
  'Revenue is always calculated, never stored. '
  'For actuals_drive_invoice accounts: actual_revenue is the invoice number. '
  'For projections_drive_invoice accounts: projected_revenue is the invoice number. '
  'Rows where is_non_revenue is true represent operational counts not billable; '
  'callers must exclude them from any revenue rollup. '
  'Rows where has_actuals is true and has_projection is false flag ad-hoc service days. '
  'Catalog JOINs filter on (active_until IS NULL OR service_date <= active_until) so '
  'archived services (active_until set) drop out for dates AFTER archive, but historical '
  'days at or before active_until still appear with full revenue values.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. Recreate sc_month_summary BYTE-IDENTICAL to sc-1b.
-- ─────────────────────────────────────────────────────────────────────
-- Body is verbatim from sc-1b lines 123-135. No change to SELECT,
-- GROUP BY, or any FILTER. It reads sc_daily_revenue, so it inherits
-- the new active_until filtering automatically.
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
  'services on days where actuals exist - it reflects measured performance, '
  'not partial-entry artifacts.';


-- ─────────────────────────────────────────────────────────────────────
-- 4. GRANTs (re-issued verbatim from sc-1b for self-contained-file
--    parity; CREATE OR REPLACE preserves existing grants but DROP +
--    CREATE does NOT, so this is required).
-- ─────────────────────────────────────────────────────────────────────
GRANT SELECT ON sc_daily_revenue TO service_role;
GRANT SELECT ON sc_month_summary TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- Verify with scripts/_probe_sc6b_view_recreate_verify.mjs in the
-- three-phase order: before -> apply (this file) -> diff -> positive.
-- The diff phase MUST be empty. If it is not, roll back using the
-- ROLLBACK FALLBACK section above.
-- ═══════════════════════════════════════════════════════════════════
