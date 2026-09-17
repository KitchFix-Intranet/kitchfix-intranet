-- ═══════════════════════════════════════════════════════════════════
-- sc-47-historical-service-calendar
--
-- Two tables holding 2022-2026 Service Calendar actuals + projections
-- from the workbooks under scripts/billing/inputs/historical-sc/. See
-- CC_PROMPT_HISTORICAL_SC_LOAD.md and scripts/billing/seed-historical-
-- sc.mjs for the loader.
--
-- HARD RULE: these tables MUST NOT surface in the Service Calendar UI.
-- No SC read joins them, no SC route reads them, no SC component
-- fetches them. If a future PR touches these tables from a SC-adjacent
-- file, stop and re-scope. Kevin's governing constraint (per prompt):
-- historical data is for financial audit, reporting, and planning
-- only. If it appears next to a live count anywhere in the UI, three-
-- year-old data will read as current and a decision will be made on
-- it.
--
-- WHY SEPARATE TABLES INSTEAD OF sc_daily_{actuals,projections} WITH
-- A FLAG: adding a flag would force every SC consumer (grid, period
-- rail, sc_daily_revenue, KPI dashboard, export, finalize gate, B&G
-- report) to add a date floor. One consumer missed = three-year-old
-- data appears somewhere it should not. Separate tables cannot leak.
--
-- SHAPE PER ROW
--   account_key         text     e.g. 'TBR - FL'
--   stream              text     see the B&G split below
--   service_date        date
--   service_name        text     verbatim from workbook header
--   group_name          text     verbatim from row-1 group band; NULL
--                                for BG-SINGLE tabs which have no
--                                bands
--   count               numeric  cover count (NULL for BG-SINGLE where
--                                the workbook stores revenue directly)
--   rate                numeric  from workbook's own header cell
--                                (e.g. $6.50 for Lunch); the rate that
--                                was actually billed - this is what an
--                                audit needs, not sc_service_prices
--   revenue             numeric  computed = count * rate for STANDARD
--                                / TBR-STD tabs; sourced from col F
--                                Total Revenue for BG-SINGLE tabs
--                                (BG bills flat weekly revenue, not
--                                per-cover)
--   source_period       text     from col C where present. PREFIX
--                                `source_` is deliberate. The workbook
--                                labels do NOT come from a single
--                                canonical fiscal calendar - see
--                                COMMENT below for the 2026-09-17
--                                divergence audit. Anyone grouping by
--                                period across accounts or years must
--                                treat this as a per-workbook opinion,
--                                not a canonical value. sc_day_metadata
--                                covers 2025-12-29 onward only; for
--                                historical years there is no
--                                canonical source.
--   source_week_label   text     from col D where present. Same
--                                caveat as source_period.
--   source_file         text     workbook filename (matches
--                                scripts/billing/inputs/historical-sc/
--                                SHA256SUMS.txt entry)
--   source_tab          text     tab name inside the workbook
--   loaded_at           timestamptz
--
-- THE B&G SPLIT (stream column)
-- Kevin's ruling: TBR - FL is the only account with two revenue
-- streams (TBR and Boys & Girls Club) that share one P&L. The default
-- view sums them; a query for "how much revenue was B&G in month X
-- year Y" must be answerable.
--   TBR - FL rows carry 'TBR' or 'B&G'
--   Every other account carries its own account_key as the stream
-- Roll-up by account_key groups both TBR streams naturally; split by
-- stream=`B&G` answers Kevin's example.
--
-- SERVICE NAMES + RATES ARE NOT RECONCILED
-- service_name stays free text (not FK to sc_services). The catalog
-- has changed across three years - services renamed, added, archived
-- - and for an audit the workbook is the record. A reconciled name
-- would assert something the source does not say.
-- rate comes from the workbook, not sc_service_prices. Prices in
-- Postgres only go back to 2026-01-01. Historical files carry their
-- own rates in the header cell.
--
-- CALENDAR-YEAR SHIFT ON 10 TABS
-- Ten tabs had col-B dates that lagged their intended year (template
-- was cloned but dates were never advanced; day-label diagnostic
-- proved it uniformly per Kevin ruling 2026-09-17). The loader
-- applies +1 to eight tabs and +2 to two tabs before emitting
-- service_date. See seed-historical-sc.mjs YEAR_SHIFT_OVERRIDES.
--
-- PERIOD-OVERRIDE ON TWO TABS
-- REDS AZ 2024 Projected Numbers and TXR AZ 2024 Projections have
-- projections labels that do not match the sibling actuals labels
-- (different fiscal scheme in the same workbook). Kevin ruling
-- Option B: for those two tabs only, override source_period +
-- source_week_label from the sibling actuals tab keyed on the
-- shifted date. When no match exists (1 boundary date per file),
-- emit NULL for both.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B is a no-op after the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the tables do NOT exist yet. Expected: zero rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('sc_historical_actuals', 'sc_historical_projections');


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS sc_historical_actuals (
  id                 BIGSERIAL PRIMARY KEY,
  account_key        TEXT        NOT NULL,
  stream             TEXT        NOT NULL,
  service_date       DATE        NOT NULL,
  service_name       TEXT        NOT NULL,
  group_name         TEXT,
  count              NUMERIC(12, 2),
  rate               NUMERIC(12, 4),
  revenue            NUMERIC(14, 2),
  source_period      TEXT,
  source_week_label  TEXT,
  source_file        TEXT        NOT NULL,
  source_tab         TEXT        NOT NULL,
  loaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uniqueness on (source_file, source_tab, service_date, service_name,
  -- group_name, stream). group_name is nullable so the PK uses a
  -- coalesced form via an expression index below.
  CONSTRAINT sc_historical_actuals_no_future_dates
    CHECK (service_date >= DATE '2022-01-01' AND service_date <= DATE '2027-12-31')
);

CREATE UNIQUE INDEX IF NOT EXISTS sc_historical_actuals_uq
  ON sc_historical_actuals (
    source_file, source_tab, service_date, service_name,
    COALESCE(group_name, '(none)'), stream
  );

CREATE INDEX IF NOT EXISTS sc_historical_actuals_by_date
  ON sc_historical_actuals (account_key, service_date);
CREATE INDEX IF NOT EXISTS sc_historical_actuals_by_stream_date
  ON sc_historical_actuals (stream, service_date);


CREATE TABLE IF NOT EXISTS sc_historical_projections (
  id                 BIGSERIAL PRIMARY KEY,
  account_key        TEXT        NOT NULL,
  stream             TEXT        NOT NULL,
  service_date       DATE        NOT NULL,
  service_name       TEXT        NOT NULL,
  group_name         TEXT,
  count              NUMERIC(12, 2),
  rate               NUMERIC(12, 4),
  revenue            NUMERIC(14, 2),
  source_period      TEXT,
  source_week_label  TEXT,
  source_file        TEXT        NOT NULL,
  source_tab         TEXT        NOT NULL,
  loaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sc_historical_projections_no_future_dates
    CHECK (service_date >= DATE '2022-01-01' AND service_date <= DATE '2027-12-31')
);

CREATE UNIQUE INDEX IF NOT EXISTS sc_historical_projections_uq
  ON sc_historical_projections (
    source_file, source_tab, service_date, service_name,
    COALESCE(group_name, '(none)'), stream
  );

CREATE INDEX IF NOT EXISTS sc_historical_projections_by_date
  ON sc_historical_projections (account_key, service_date);
CREATE INDEX IF NOT EXISTS sc_historical_projections_by_stream_date
  ON sc_historical_projections (stream, service_date);


COMMENT ON TABLE sc_historical_actuals IS
  'Service Calendar actuals for 2022-2026 loaded from workbook archives. Financial-audit-only; MUST NOT be joined by any Service Calendar UI code path. See docs/migrations/sc-47-historical-service-calendar.sql and scripts/billing/seed-historical-sc.mjs. sc-47 (2026-09-17).';

COMMENT ON TABLE sc_historical_projections IS
  'Service Calendar projections for 2022-2026 loaded from workbook archives. Financial-audit-only; MUST NOT be joined by any Service Calendar UI code path. sc-47 (2026-09-17).';

COMMENT ON COLUMN sc_historical_actuals.source_period IS
  'Period label VERBATIM from the workbook cell. NOT a canonical fiscal period - the 2026-09-17 divergence audit showed 9 of 20 paired workbook (actuals, projections) tabs disagree on period or week labels. sc_day_metadata (the canonical fiscal calendar) covers 2025-12-29 onward only; for historical years there is no canonical source. Queries grouping by source_period across accounts or years mix schemes and MAY return silently-wrong totals. Use for single-account, single-year audit inspection only.';

COMMENT ON COLUMN sc_historical_actuals.source_week_label IS
  'Week label VERBATIM from the workbook cell. Same caveat as source_period - NOT a canonical fiscal week.';

COMMENT ON COLUMN sc_historical_actuals.stream IS
  'TBR - FL only has two streams (TBR and B&G) that share one P&L per Kevin ruling. Every other account carries its own account_key as the stream value so roll-up by account_key sums TBR + B&G naturally.';

COMMENT ON COLUMN sc_historical_projections.source_period IS
  'Same as sc_historical_actuals.source_period - workbook-verbatim, not canonical.';

COMMENT ON COLUMN sc_historical_projections.source_week_label IS
  'Same as sc_historical_actuals.source_week_label - workbook-verbatim, not canonical.';

COMMENT ON COLUMN sc_historical_projections.stream IS
  'Same as sc_historical_actuals.stream - TBR/B&G split, account_key elsewhere.';


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm both tables exist with correct shape.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('sc_historical_actuals', 'sc_historical_projections')
ORDER BY table_name, ordinal_position;

-- Confirm indexes.
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('sc_historical_actuals', 'sc_historical_projections')
ORDER BY tablename, indexname;

-- Both tables should be empty until the loader runs.
SELECT 'sc_historical_actuals' AS tbl, count(*) AS rows FROM sc_historical_actuals
UNION ALL
SELECT 'sc_historical_projections', count(*) FROM sc_historical_projections;

-- Loader command (dry-run first):
--   node --env-file=.env.local scripts/billing/seed-historical-sc.mjs --dry-run
--   node --env-file=.env.local scripts/billing/seed-historical-sc.mjs --write
