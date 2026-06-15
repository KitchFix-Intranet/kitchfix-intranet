-- ═══════════════════════════════════════════════════════════════════
-- sc-1-service-calendar-schema.sql
-- Service Calendar - Postgres schema (Module SC)
--
-- Follows patterns from inv-1-smart-inventory-schema.sql:
--   UUID PKs, account_key TEXT + CHECK regex, email-based created_by,
--   idempotent DDL, RLS disabled, explicit GRANTs, partial indexes.
--
-- Apply in Supabase Studio first, verify via probe, then ship code.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════════════════════════════
-- ENUM: billing_model
-- Named by what the billing process does, not by account tier
-- (account tier is already on accounts.level).
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE billing_model AS ENUM (
    'actuals_drive_invoice',     -- measured count * price = invoice
    'flat_fee',                  -- fixed fee per period, SC tracks data only
    'projections_drive_invoice'  -- projected count * price = invoice; actuals are internal data
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- ALTER accounts: add billing_model column
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN billing_model billing_model;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN accounts.billing_model IS
  'How this account is billed. actuals_drive_invoice = measured count * price. '
  'flat_fee = fixed fee, data-only tracking. '
  'projections_drive_invoice = projected count * price, actuals for internal intelligence.';

-- Seed billing_model values for the 11 active accounts.
-- AND billing_model IS NULL guards re-apply: if anyone has reassigned an
-- account in the admin UI, re-running this file won't silently revert it.
UPDATE accounts SET billing_model = 'actuals_drive_invoice'
  WHERE team_key IN ('CIN - AZ', 'TXR - AZ', 'TBJ - FL', 'TBR - FL', 'TBJ - NY')
    AND billing_model IS NULL;

UPDATE accounts SET billing_model = 'flat_fee'
  WHERE team_key = 'STL - FL'
    AND billing_model IS NULL;

UPDATE accounts SET billing_model = 'projections_drive_invoice'
  WHERE team_key IN ('TXR - TX - H', 'TXR - TX - V', 'STL - MO', 'CIN - OH', 'CIN - KY')
    AND billing_model IS NULL;


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_service_groups
-- Organizational containers: "Major League", "Minor League", "Rehab"
-- Each account defines its own groups.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_service_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key   TEXT NOT NULL CHECK (
                  account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                  OR account_key = 'CORP'
                ),
  group_name    TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,

  CONSTRAINT uq_sc_service_groups_account_name
    UNIQUE (account_key, group_name)
);

CREATE INDEX IF NOT EXISTS idx_sc_service_groups_account_active
  ON sc_service_groups (account_key, sort_order)
  WHERE active = TRUE AND deleted_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_services
-- Individual billable items: "Minor League Breakfast", "Coffee Service"
-- Each belongs to a group, has its own price history.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key   TEXT NOT NULL CHECK (
                  account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                  OR account_key = 'CORP'
                ),
  group_id      UUID NOT NULL REFERENCES sc_service_groups(id),
  service_name  TEXT NOT NULL,
  is_tax_free   BOOLEAN NOT NULL DEFAULT FALSE,
  is_flat_fee   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,

  CONSTRAINT uq_sc_services_account_group_name
    UNIQUE (account_key, group_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_sc_services_account_active
  ON sc_services (account_key, sort_order)
  WHERE active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sc_services_group
  ON sc_services (group_id)
  WHERE deleted_at IS NULL;


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_service_prices
-- Price ledger with effective dates. Current price = max(effective_date).
-- No end_date column - avoids "two columns that must agree" anti-pattern.
-- Revenue is always calculated at read time by joining price active on
-- the service_date being queried.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_service_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES sc_services(id),
  price           NUMERIC(12,5) NOT NULL CHECK (price >= 0),
  effective_date  DATE NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,

  CONSTRAINT uq_sc_service_prices_service_date
    UNIQUE (service_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_service_prices_lookup
  ON sc_service_prices (service_id, effective_date DESC);

COMMENT ON TABLE sc_service_prices IS
  'Price ledger. To find the price active on a given date: '
  'SELECT price FROM sc_service_prices '
  'WHERE service_id = $1 AND effective_date <= $2 '
  'ORDER BY effective_date DESC LIMIT 1';


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_daily_projections
-- Corporate forecasts: one row per service per day.
-- Built annually by Joe, imported via template or entered in-tool.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_daily_projections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key       TEXT NOT NULL CHECK (
                      account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                      OR account_key = 'CORP'
                    ),
  service_id        UUID NOT NULL REFERENCES sc_services(id),
  service_date      DATE NOT NULL,
  projected_count   INTEGER NOT NULL CHECK (projected_count >= 0),
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_sc_daily_projections_service_date
    UNIQUE (account_key, service_id, service_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_daily_projections_account_month
  ON sc_daily_projections (account_key, service_date);

CREATE INDEX IF NOT EXISTS idx_sc_daily_projections_service
  ON sc_daily_projections (service_id, service_date);


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_daily_actuals
-- System of record for billing (actuals_drive_invoice accounts).
-- One row per service per day. Upsert on conflict.
-- actual_count >= 0 enforced. Row absence = not yet entered.
-- All updates that change actual_count are captured in
-- sc_daily_actuals_history via the BEFORE UPDATE trigger below.
--
-- Write pattern:
--   INSERT INTO sc_daily_actuals (account_key, service_id, service_date,
--     actual_count, created_by)
--   VALUES ($1, $2, $3, $4, $5)
--   ON CONFLICT (account_key, service_id, service_date)
--   DO UPDATE SET
--     actual_count = EXCLUDED.actual_count,
--     updated_by   = EXCLUDED.created_by,
--     updated_at   = now();
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_daily_actuals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL CHECK (
                    account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    OR account_key = 'CORP'
                  ),
  service_id      UUID NOT NULL REFERENCES sc_services(id),
  service_date    DATE NOT NULL,
  actual_count    INTEGER NOT NULL CHECK (actual_count >= 0),
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_sc_daily_actuals_service_date
    UNIQUE (account_key, service_id, service_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_daily_actuals_account_month
  ON sc_daily_actuals (account_key, service_date);

CREATE INDEX IF NOT EXISTS idx_sc_daily_actuals_service
  ON sc_daily_actuals (service_id, service_date);


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_day_metadata
-- Per-day context that varies by account type.
-- PDC: period, week, camp/event name
-- MLB: period, week, game_type, game_time
-- MiLB: period, week, homestand, game_type
-- One row per account per day.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_day_metadata (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL CHECK (
                    account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    OR account_key = 'CORP'
                  ),
  service_date    DATE NOT NULL,
  period          TEXT,
  week_label      TEXT,
  event_label     TEXT,
  game_type       TEXT,
  game_time       TEXT,
  notes           TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_sc_day_metadata_account_date
    UNIQUE (account_key, service_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_day_metadata_account_month
  ON sc_day_metadata (account_key, service_date);


-- ═══════════════════════════════════════════════════════════════════
-- TABLE: sc_daily_actuals_history
-- Audit trail for actual_count corrections.
-- Populated automatically by the BEFORE UPDATE trigger on
-- sc_daily_actuals; one row per value-changing UPDATE.
--
-- First writes are NOT captured here - the originating row in
-- sc_daily_actuals carries created_by + created_at + the initial
-- actual_count, which is sufficient evidence of the first value.
-- This table answers "what was the value before the last edit"
-- across the full edit chain, which is what billing-dispute
-- forensics needs.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sc_daily_actuals_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actual_id       UUID NOT NULL,                -- intentionally NOT a FK: row may outlive a hard-deleted actual
  account_key     TEXT NOT NULL,
  service_id      UUID NOT NULL,
  service_date    DATE NOT NULL,
  old_count       INTEGER NOT NULL,
  new_count       INTEGER NOT NULL,
  changed_by      TEXT NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_daily_actuals_history_actual
  ON sc_daily_actuals_history (actual_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_daily_actuals_history_lookup
  ON sc_daily_actuals_history (account_key, service_id, service_date, changed_at DESC);


-- ═══════════════════════════════════════════════════════════════════
-- TRIGGER: sc_daily_actuals_audit
-- BEFORE UPDATE on sc_daily_actuals. Fires only when actual_count
-- actually changes (WHEN clause skips no-op upserts). Writes one row
-- to sc_daily_actuals_history capturing old/new values + actor.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sc_daily_actuals_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sc_daily_actuals_history (
    actual_id, account_key, service_id, service_date,
    old_count, new_count, changed_by
  ) VALUES (
    OLD.id, OLD.account_key, OLD.service_id, OLD.service_date,
    OLD.actual_count, NEW.actual_count, COALESCE(NEW.updated_by, NEW.created_by)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sc_daily_actuals_audit_trigger ON sc_daily_actuals;
CREATE TRIGGER sc_daily_actuals_audit_trigger
  BEFORE UPDATE ON sc_daily_actuals
  FOR EACH ROW
  WHEN (OLD.actual_count IS DISTINCT FROM NEW.actual_count)
  EXECUTE FUNCTION sc_daily_actuals_audit();


-- ═══════════════════════════════════════════════════════════════════
-- VIEW: sc_daily_revenue
-- The core billing view. For each (account, service, date) with a
-- projection OR an actual: projected revenue, actual revenue, price used.
-- Revenue is NEVER stored - always derived at read time.
--
-- The UNION CTE ensures actuals-without-projections (ad-hoc service days)
-- still appear in billing. has_projection lets the dashboard flag
-- "actual entered with no projection" as a data-quality signal.
-- ═══════════════════════════════════════════════════════════════════

-- Defensive cleanup: an earlier draft of this file defined sc_price_at_date.
-- This DROP is a no-op on a fresh apply.
DROP VIEW IF EXISTS sc_price_at_date;

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
  'Rows where has_actuals is true and has_projection is false flag ad-hoc service days.';


-- ═══════════════════════════════════════════════════════════════════
-- VIEW: sc_month_summary
-- Aggregated monthly metrics per account for the dashboard.
-- revenue_variance compares actual vs projected only on the days where
-- actuals have been entered - mid-month variance reflects measured-day
-- performance, not the full-month projection vs partial entry.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW sc_month_summary AS
SELECT
  account_key,
  DATE_TRUNC('month', service_date)::DATE AS month,
  COUNT(DISTINCT service_date) AS total_service_days,
  COUNT(DISTINCT service_date) FILTER (WHERE has_actuals) AS days_with_actuals,
  SUM(projected_count) AS total_projected_meals,
  SUM(actual_count) FILTER (WHERE has_actuals) AS total_actual_meals,
  SUM(projected_revenue) AS total_projected_revenue,
  SUM(actual_revenue) FILTER (WHERE has_actuals) AS total_actual_revenue,
  SUM(actual_revenue - projected_revenue) FILTER (WHERE has_actuals) AS revenue_variance
FROM sc_daily_revenue
GROUP BY account_key, DATE_TRUNC('month', service_date);

COMMENT ON VIEW sc_month_summary IS
  'Monthly rollup for the Service Calendar dashboard. '
  'Feeds the metrics strip and year heatmap view. '
  'revenue_variance is the per-day (actual - projected) sum across days where '
  'actuals exist - it reflects measured performance, not partial-entry artifacts.';


-- ═══════════════════════════════════════════════════════════════════
-- RLS: disabled (access gated at Next.js route layer)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE sc_service_groups        DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_services              DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_service_prices        DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_daily_projections     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_daily_actuals         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_day_metadata          DISABLE ROW LEVEL SECURITY;
ALTER TABLE sc_daily_actuals_history DISABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════
-- GRANTs: required - Supabase default privileges not configured
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_service_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_services TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_service_prices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_daily_projections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_daily_actuals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_day_metadata TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_daily_actuals_history TO service_role;

GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_service_groups        TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_services              TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_service_prices        TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_daily_projections     TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_daily_actuals         TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_day_metadata          TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_daily_actuals_history TO anon, authenticated;

-- Views inherit from their base tables; grant SELECT for explicit access
GRANT SELECT ON sc_daily_revenue  TO service_role;
GRANT SELECT ON sc_month_summary  TO service_role;

-- Trigger function needs EXECUTE to fire under any role; the trigger
-- itself runs in the table-owner's context, but explicit grant matches
-- the merge_vendors / match_document_chunks pattern.
GRANT EXECUTE ON FUNCTION sc_daily_actuals_audit() TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════════
-- Next steps:
-- 1. Apply this SQL in Supabase Studio
-- 2. Run verify probe to confirm:
--    - 7 tables (6 SC + 1 history)
--    - 2 views (sc_daily_revenue, sc_month_summary)
--    - 1 trigger function + 1 trigger
--    - billing_model enum present with 3 values
--    - 11 accounts have billing_model set
-- 3. Import service config from spreadsheets (groups, services, prices)
-- 4. Import projections from spreadsheets
-- 5. Build src/lib/dataStore/serviceCalendar.js
-- 6. Rewire src/app/api/service-calendar/route.js to read/write PG
-- 7. Add SC tables to DUAL_WRITE_TABLES + READ_FROM_POSTGRES_OPS
