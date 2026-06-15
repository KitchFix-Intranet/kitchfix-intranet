-- ═══════════════════════════════════════════════════════════════════
-- sc-1b-add-non-revenue-flag.sql
-- Patch on top of sc-1-service-calendar-schema.sql.
--
-- Adds the is_non_revenue flag to sc_services and updates the two
-- views to handle it correctly.
--
--   sc_daily_revenue:
--     Exposes is_non_revenue in the row payload but does NOT filter
--     non-revenue services out. The dashboard / API decides when to
--     hide or roll them up.
--
--   sc_month_summary:
--     Excludes is_non_revenue services from the three revenue totals
--     (total_projected_revenue, total_actual_revenue, revenue_variance).
--     Meal-count totals continue to include all services because
--     non-revenue services like "Fun Money" still represent operational
--     activity worth counting.
--
-- Idempotent. Safe to re-apply.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Schema change: is_non_revenue column on sc_services
-- ─────────────────────────────────────────────────────────────────────
-- Already added in Studio before this file existed; ADD COLUMN IF NOT
-- EXISTS makes the file the canonical record of the change.
ALTER TABLE sc_services
  ADD COLUMN IF NOT EXISTS is_non_revenue BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sc_services.is_non_revenue IS
  'TRUE for services that track operational counts without contributing '
  'to billing (e.g. "Fun Money", "Fun $$$$ Allocated"). '
  'sc_month_summary excludes these rows from revenue totals; meal-count '
  'totals continue to include them. Default FALSE.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. Recreate sc_daily_revenue to expose is_non_revenue
-- ─────────────────────────────────────────────────────────────────────
-- Body is identical to the sc-1 version with the single addition of
-- s.is_non_revenue in the SELECT list. The view does NOT filter on it -
-- non-revenue services still appear in the row stream so the dashboard
-- can show their counts. Consumers that compute their own revenue from
-- this view must check is_non_revenue themselves.
--
-- DROP VIEW first because CREATE OR REPLACE VIEW cannot reorder existing
-- columns. The new is_non_revenue column sits between is_tax_free and
-- group_name (not appended at the end), which CREATE OR REPLACE rejects.
-- sc_month_summary depends on sc_daily_revenue, so we drop it first to
-- avoid a dependency error.
DROP VIEW IF EXISTS sc_month_summary;
DROP VIEW IF EXISTS sc_daily_revenue;

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
JOIN sc_services s ON s.id = sd.service_id AND s.deleted_at IS NULL
JOIN sc_service_groups g ON g.id = s.group_id AND g.deleted_at IS NULL
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
  'Rows where has_actuals is true and has_projection is false flag ad-hoc service days.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. Recreate sc_month_summary to exclude is_non_revenue from revenue
-- ─────────────────────────────────────────────────────────────────────
-- Three revenue fields get FILTER (WHERE NOT is_non_revenue) added.
-- Meal-count totals stay as-is - non-revenue services still represent
-- activity for the operational view.
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
-- GRANTs
-- ─────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE VIEW preserves existing grants, but re-issuing them
-- keeps the file self-contained and matches the sc-1 pattern.
GRANT SELECT ON sc_daily_revenue TO service_role;
GRANT SELECT ON sc_month_summary TO service_role;

-- Base-table RLS is unchanged (sc_services RLS was already DISABLED in
-- sc-1). Views inherit their RLS posture from base tables; no action
-- required here.
