-- ═══════════════════════════════════════════════════════════════════
-- sc-7-changelog-latest-view.sql
-- Service Calendar - aggregate view: latest changed_at per account.
--
-- Replaces an unbounded read on sc_config_changelog in the admin
-- overview's load path (loadAllAccountsConfig). The orchestrator was
-- pulling every changelog row ordered by changed_at DESC and walking
-- it in JS to derive MAX(changed_at) per account_key. PostgREST
-- silently caps at 1000 rows; once the changelog crosses that, any
-- account whose latest write fell past row 1000 silently reports a
-- stale "last updated" date in the admin overview.
--
-- This view does the aggregation in Postgres. One row per account that
-- has ever been written to changelog (bounded by account count, ~31
-- today). The orchestrator reads the view and feeds its existing
-- per-account fallback chain unchanged:
--   (1) changelog last_changed_at (from this view), else
--   (2) latest sc_service_prices effective_date (lastPricedByAccount).
-- The fallback is preserved exactly so accounts with no changelog row
-- still render their seeded price date.
--
-- INDEX SUPPORT
-- sc_config_changelog already has the composite index
--   idx_sc_config_changelog_account_recent (account_key, changed_at DESC)
-- from sc-4. The planner can satisfy MAX(changed_at) GROUP BY
-- account_key via a loose index scan; no new index needed.
--
-- IDEMPOTENT - safe to re-apply. Uses CREATE OR REPLACE VIEW.
--
-- ROLLBACK
--   DROP VIEW IF EXISTS sc_changelog_latest_by_account;
-- The view is pure additive. Nothing in production depends on it until
-- the orchestrator switch ships (this PR's code change), so the
-- rollback is trivial.
--
-- Apply in Supabase Studio. No verify probe needed - the view is a
-- single aggregate over an existing audited table; correctness is
-- self-evident on inspection. After apply, merge the orchestrator PR
-- and the admin overview will read aggregated last-updated dates
-- instead of paginating through changelog history.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW sc_changelog_latest_by_account AS
SELECT
  account_key,
  MAX(changed_at) AS last_changed_at
FROM sc_config_changelog
GROUP BY account_key;

COMMENT ON VIEW sc_changelog_latest_by_account IS
  'Aggregate of sc_config_changelog: one row per account_key with the '
  'most recent changed_at. Feeds the admin overview''s "last updated" '
  'column. Replaces the prior unbounded all-rows read in '
  'loadAllAccountsConfig - PostgREST capped that read at 1000 rows, '
  'which would silently produce stale last-updated dates once the '
  'changelog grew past the cap.';

-- Match the GRANT pattern of sc_daily_revenue / sc_month_summary
-- (SELECT to service_role). The underlying sc_config_changelog table
-- already has SELECT for service_role from sc-4; the explicit view
-- grant keeps this migration file self-contained.
GRANT SELECT ON sc_changelog_latest_by_account TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- No verify probe. Pure additive view; nothing depends on it until
-- the orchestrator PR (loadAllAccountsConfig swap) merges.
-- ═══════════════════════════════════════════════════════════════════
