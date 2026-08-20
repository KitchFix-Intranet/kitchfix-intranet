-- ═══════════════════════════════════════════════════════════════════
-- daily-1-labor-actuals-daily.sql
--
-- Day-grain rollup of pay-segment labor. Same input as labor_actuals
-- but bucketed by segment_date instead of fiscal week, so any range
-- from 1 to 21 days answers accurately.
--
-- Why this table exists
-- ─────────────────────
-- labor_actuals is worker-week grain (2,364 rows, zero daily
-- columns), so any request for a partial week silently returns the
-- whole week's money. Measured live 2026-08-19: ?start=2026-07-09
-- &end=2026-07-12 on CIN - AZ returned $3,798.97 for the whole week
-- 07/06-07/12 with nothing telling the reader the range was widened.
-- Pay segments carry segment_date and estimated_amount; verified
-- rebuilding CIN - OH week of 06/29 from daily segments returns
-- 156.21 hours / $4,328.27 to the cent.
--
-- Contract with the weekly fact
-- ──────────────────────────────
-- Sum of labor_actuals_daily over any (account_key, week) equals
-- the labor_actuals row for that week to the cent, on both dollars
-- and each hours bucket. Probe D1 in
-- scripts/_probe_daily_grain.mjs asserts this for every account
-- and every week; a single mismatch fails the run.
--
-- Rounding discipline
-- ────────────────────
-- Summing per-day rounded values loses a cent: CIN - OH week of
-- 06/29 sums to $4,328.26 from rounded dailies versus $4,328.27
-- unrounded. The derive carries full precision through the
-- accumulator and rounds ONLY at the end. This column stores the
-- rounded per-day value.
--
-- Apply discipline
-- ────────────────
-- 1. Kevin applies statements sequentially in Supabase Studio.
-- 2. Every statement is IF NOT EXISTS / OR REPLACE guarded so
--    re-application is safe.
-- 3. PR-1 code (scripts/derive_labor_actuals_daily.mjs) does not
--    run against prod until this migration is applied.
-- 4. Fill in the attestation block at the tail with the SHA the
--    apply matched.
-- ═══════════════════════════════════════════════════════════════════

-- ─── labor_actuals_daily ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_actuals_daily (
  account_key             TEXT           NOT NULL,
  worker_id               TEXT           NOT NULL,
  work_date               DATE           NOT NULL,
  line_code               TEXT           NOT NULL,

  hours_regular           NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_overtime          NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_double_time       NUMERIC(10,2)  NOT NULL DEFAULT 0,
  hours_premium_other     NUMERIC(10,2)  NOT NULL DEFAULT 0,

  dollars_regular         NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_overtime        NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_double_time     NUMERIC(14,2)  NOT NULL DEFAULT 0,
  dollars_premium_other   NUMERIC(14,2)  NOT NULL DEFAULT 0,

  amount                  NUMERIC(14,2)  NOT NULL DEFAULT 0,
  segment_count           INTEGER        NOT NULL DEFAULT 0,

  derived_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  source_run              TEXT,
  source                  TEXT,

  PRIMARY KEY (account_key, worker_id, work_date, line_code)
);

COMMENT ON TABLE labor_actuals_daily IS
  'Day-grain rollup of pay-segment labor. Sum over any (account_key,
   week) matches labor_actuals to the cent. Carries no coverage
   state or entry_count - those are weekly concepts. Rebuilt
   trailing 8 fiscal weeks each nightly run by
   scripts/derive_labor_actuals_daily.mjs.';

COMMENT ON COLUMN labor_actuals_daily.work_date IS
  'segment_date from the pay segment. Fiscal week boundary rules
   live in the callers, not here - this column is a plain date.';

-- ─── Indexes ───────────────────────────────────────────────────────
-- (account_key, work_date) is the primary read pattern for the
-- range resolver (PR-2). work_date alone supports cross-account
-- date-slice queries used by PR-2 sentinels.
CREATE INDEX IF NOT EXISTS labor_actuals_daily_account_date_idx
  ON labor_actuals_daily (account_key, work_date);
CREATE INDEX IF NOT EXISTS labor_actuals_daily_date_idx
  ON labor_actuals_daily (work_date);

-- ─── RLS + grants ──────────────────────────────────────────────────
-- Same posture as labor_actuals + labor_salary_actuals + people:
-- RLS disabled, service_role writes, anon + authenticated get the
-- non-data grants only. NO TRUNCATE for anyone but service_role.
ALTER TABLE labor_actuals_daily DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON labor_actuals_daily TO service_role;
REVOKE TRUNCATE ON labor_actuals_daily FROM anon, authenticated;
GRANT REFERENCES, TRIGGER ON labor_actuals_daily TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file (one statement at a
-- time) in Supabase Studio. This records the exact SHA the apply
-- matched. The migration-gate check on the PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
