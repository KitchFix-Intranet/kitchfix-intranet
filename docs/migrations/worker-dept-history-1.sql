-- worker-dept-history-1.sql
--
-- Kevin R-70 (2026-09-04): per-worker effective-dated account
-- attribution for the SALARY loader. The Rippling API exposes only
-- the CURRENT department (`worker.department_id`); no effective-
-- dated department history is retrievable from any endpoint with
-- our OAuth scope (R-70 recon 2026-09-04). The salary loader had
-- been applying today's department to every FY week, misattributing
-- transferred workers on every week of the year.
--
-- Reference case: Stephen Bailey transferred TBR - FL -> CIN - KY
-- on 2026-03-09. Before the fix his eight FY26 periods of salary
-- ($16,731 / period) landed on CIN - KY, putting +$16,538 on CIN
-- and stripping $13,773 from TBR against finance.
--
-- Kevin maintains this table by hand at each period close, same
-- moment as `inventory_adjustments`. 99% of workers never move -
-- for them the table stays empty and the loader falls back to
-- `worker.department_id`, so an empty table is the correct state
-- for a normal week.
--
-- ═══════════════════════════════════════════════════════════════
-- SPELL-COVERAGE RULE (LOAD-BEARING - break this and Bailey breaks)
-- ═══════════════════════════════════════════════════════════════
--
-- A worker in this table must have a row for every spell they lived
-- through in the fiscal year, INCLUDING their opening spell.
--
-- One row for a moved worker is always wrong. The resolver falls
-- back to `worker.department_id` when no history row matches, and
-- that fallback returns the worker's CURRENT department - which is
-- the destination, not the origin. So a single row for the
-- destination spell would make the origin weeks silently attribute
-- to the destination (via fallback), producing the exact defect the
-- table exists to fix.
--
-- Correct Bailey seeding:
--   INSERT ... ('62b618f3c44ba8b9fb4221d2', '2025-12-29', '2026-03-08', 'TBR - FL', ...)
--   INSERT ... ('62b618f3c44ba8b9fb4221d2', '2026-03-09', NULL,         'CIN - KY', ...)
--
-- Wrong Bailey seeding (single-row):
--   INSERT ... ('62b618f3c44ba8b9fb4221d2', '2026-03-09', NULL, 'CIN - KY', ...)
--   -> weeks before 2026-03-09 fall back to Rippling's current dept
--      (CIN - KY) and Bailey's TBR - FL months disappear again.
--
-- Enforcement: `_probe_r70_spell_coverage.mjs` asserts every worker
-- in this table has either a row with effective_from <= FY start,
-- or a Rippling worker.start_date after FY start (hired mid-year).
--
-- ═══════════════════════════════════════════════════════════════
-- COLUMNS
-- ═══════════════════════════════════════════════════════════════
--
--   worker_id       Rippling worker id, joins to labor_salary_actuals.
--   effective_from  First day this spell applies (inclusive).
--   end_date        Last day this spell applies (inclusive). NULL =
--                   still in force. Populate when the worker moves
--                   or leaves. If left NULL for a departed worker
--                   the loader keeps accruing on their last account
--                   (Kevin's Gordon Rouse III case).
--   account_key     Destination account for this spell.
--   source          "kevin_manual" today; leaves room for a future
--                   HRIS feed if Rippling ever exposes history.
--   note            Free-text (finance ref, ticket, "spring training").
--   set_at, set_by  Audit.
--
-- Resolver rule (scripts/lib/dept_history.mjs):
--   pick the row where effective_from <= week_start
--                  AND (end_date IS NULL OR week_start <= end_date)
--   if multiple match, pick the row with the greatest effective_from
--   if none match, fall back to worker.department_id

BEGIN;

CREATE TABLE IF NOT EXISTS worker_dept_history (
  id              BIGSERIAL   PRIMARY KEY,
  worker_id       TEXT        NOT NULL,
  effective_from  DATE        NOT NULL,
  end_date        DATE        NULL,
  account_key     TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  note            TEXT,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_by          TEXT        NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT worker_dept_history_range_valid
    CHECK (end_date IS NULL OR end_date >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_dept_history_uniq
  ON worker_dept_history (worker_id, effective_from);

-- Lookup pattern: "latest effective_from <= week_start". DESC index
-- lets the resolver scan the first matching row per worker.
CREATE INDEX IF NOT EXISTS worker_dept_history_by_worker
  ON worker_dept_history (worker_id, effective_from DESC);

-- Service-role only. Mirrors inventory_adjustments (loader + resolver
-- run under SUPABASE_SERVICE_ROLE_KEY; no anon read).
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_dept_history TO service_role;
GRANT USAGE ON SEQUENCE worker_dept_history_id_seq TO service_role;

COMMIT;
