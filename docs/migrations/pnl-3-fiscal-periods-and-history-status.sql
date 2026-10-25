-- ═══════════════════════════════════════════════════════════════════
-- pnl-3-fiscal-periods-and-history-status.sql
-- FIN-2027 W1 Stage 2 - fiscal_periods table + FY2024/FY2025
-- kpi_period_status seeds + FY2026 P9 closed_at backfill
-- 2026-09-17
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships one new table and two seed extensions that stand up the
-- multi-year fiscal calendar the FIN-2027 program needs:
--
--   1. fiscal_periods       - one row per (fiscal_year, period_no)
--                             with start_date + end_date. 52 rows
--                             seeded (FY2024, FY2025, FY2026, FY2027).
--                             FY2023 is PARKED (ruling R-10) and NOT
--                             seeded. Table is the canonical calendar
--                             the historical loader consumes (Stage 2
--                             load_pnl_history.mjs) and the general
--                             multi-year replacement for the FY2026-
--                             only client-side periods.js formula
--                             (client rewrite deferred; see W0 §13).
--
--   2. kpi_period_status    - 26 new rows: (2024, 1..13) and (2025,
--                             1..13). closed_at seeded from the
--                             fiscal calendar (period end + 23:59:59Z);
--                             verified_* NULL until load_pnl_history
--                             lands the workbook. Same shape as the
--                             pnl-1 FY2026 seed.
--
--   3. kpi_period_status    - one UPDATE: FY2026 P9 closed_at =
--                             2026-09-06T23:59:59Z. Period 9 was left
--                             NULL by pnl-1 seed because it was still
--                             open at ship time; the fiscal-calendar
--                             close has since passed. Ruling R-17
--                             restricts this migration to metadata-
--                             only touches on FY2026 - no value
--                             writes anywhere.
--
-- Governing brief: CC_BRIEF_FIN2027_W1_HISTORY_LOAD.md §5.1.
-- Governing rulings: R-10 (FY2023 parked); R-17 (FY2026 closed to
-- the program - closed_at metadata stamp is the only FY2026 touch).
--
-- Row-4 dates verified against the four supplied workbooks in the
-- W0 report §11 (probe _probe_fin2027_workbook_shape.mjs):
--   FY2024 P1 start = 2024-01-01   P13 end = 2024-12-29
--   FY2025 P1 start = 2024-12-30   P13 end = 2025-12-28
--   FY2026 P1 start = 2025-12-29   P13 end = 2026-12-27
--   FY2027 P1 start = 2026-12-28   P13 end = 2027-12-26
-- All 13 x 28 = 364 days per year, contiguous, no 53-week year.
--
-- ─── Apply discipline ──────────────────────────────────────────────
--
-- One statement at a time in Supabase Studio's SQL editor. Two
-- BEGIN/COMMIT blocks so a mid-file failure leaves the schema in a
-- coherent state at whichever block finished last.
--
-- After apply, run scripts/_probe_fin2027_pnl3_verify.mjs to confirm
--   (a) fiscal_periods has 52 rows across FY2024..FY2027;
--   (b) boundary dates match the four values above;
--   (c) FY2023 rows are absent (R-10);
--   (d) kpi_period_status has (2024,1..13) + (2025,1..13) + (2026,1..13);
--   (e) (2024, ...) and (2025, ...) rows have closed_at set + verified_at NULL;
--   (f) (2026, 9) has closed_at = 2026-09-06T23:59:59Z + verified_at
--       still non-NULL (from the P9 loader run in Stage 0).
-- Then merge PR-B and run load_pnl_history.mjs for FY2024 and FY2025.
--
-- Governing docs:
--   docs/audits/FIN2027_ORIENTATION_2026-09-17.md §11 (workbook shape)
--   docs/PAST_FUTURE_FINANCE_MASTER_SCOPE.md (rulings ledger)
--   docs/migrations/pnl-1-actuals-and-status.sql (house-style anchor)
--
-- ═══════════════════════════════════════════════════════════════════


-- ─── Table 1: fiscal_periods ───────────────────────────────────────
BEGIN;

-- Pre-flight: no collision, and the two dependent surfaces exist.
DO $$
DECLARE
  n_kps INTEGER;
BEGIN
  IF to_regclass('public.fiscal_periods') IS NOT NULL THEN
    RAISE NOTICE 'pnl-3 pre-flight [fiscal_periods]: table already exists (idempotent re-apply)';
  END IF;
  IF to_regclass('public.kpi_period_status') IS NULL THEN
    RAISE EXCEPTION 'pnl-3 pre-flight [fiscal_periods]: kpi_period_status missing (pnl-1 not applied)';
  END IF;
  SELECT COUNT(*) INTO n_kps FROM kpi_period_status WHERE fiscal_year = 2026;
  -- pnl-1 seeded FY2026 P1..P13 (13 rows). If that seed did not
  -- land, the block-3 backfill below would silently no-op.
  IF n_kps < 13 THEN
    RAISE EXCEPTION 'pnl-3 pre-flight [fiscal_periods]: kpi_period_status FY2026 rows = %, expected 13 (pnl-1 seed missing)', n_kps;
  END IF;
END $$;

-- One row per (fiscal_year, period_no). start_date and end_date are
-- calendar dates - no timezone. end_date is inclusive (the last
-- calendar day of the period). Every period is 28 days, so
-- end_date = start_date + 27 days by definition; the CHECK below
-- enforces the invariant.
CREATE TABLE IF NOT EXISTS fiscal_periods (
  fiscal_year   INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2050),
  period_no     INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  CONSTRAINT fiscal_periods_28_day_span CHECK (end_date = start_date + INTERVAL '27 days'),
  PRIMARY KEY (fiscal_year, period_no)
);

-- Helpful non-unique index for date-range lookups
-- (e.g. "which fiscal period contains 2026-04-15?").
CREATE INDEX IF NOT EXISTS fiscal_periods_start_idx
  ON fiscal_periods (start_date);

-- Grants. service_role only. The calendar is read at load time by
-- scripts/load_pnl_history.mjs; the client-side periods.js still
-- computes FY2026 boundaries locally per the deferred-rewrite ruling.
GRANT SELECT, INSERT, UPDATE ON fiscal_periods TO service_role;
-- No DELETE grant: a fiscal period is a calendar fact, not a mutable row.

-- Seed FY2024, FY2025, FY2026, FY2027 (52 rows).
-- FY2023 is PARKED per R-10 and NOT seeded here.
-- Each fiscal year gets 13 periods; start_date = fy_start + (n-1)*28,
-- end_date = start_date + 27. Verified against workbook row-4 dates
-- in the W0 report §11.
--
-- ON CONFLICT DO NOTHING so a re-apply does not clobber any manual
-- correction (defensive; a corrected calendar would be reviewed
-- separately, never silently overwritten).
WITH fy_starts (fiscal_year, fy_start) AS (VALUES
  (2024, DATE '2024-01-01'),
  (2025, DATE '2024-12-30'),
  (2026, DATE '2025-12-29'),
  (2027, DATE '2026-12-28')
)
INSERT INTO fiscal_periods (fiscal_year, period_no, start_date, end_date)
SELECT
  fy.fiscal_year,
  p::int AS period_no,
  (fy.fy_start + ((p - 1) * 28))::date AS start_date,
  (fy.fy_start + ((p - 1) * 28) + 27)::date AS end_date
FROM fy_starts fy
CROSS JOIN generate_series(1, 13) AS p
ON CONFLICT (fiscal_year, period_no) DO NOTHING;

-- Post-flight: table + indexes + grants + seed rows.
DO $$
DECLARE
  n_rows      INTEGER;
  n_2024      INTEGER;
  n_2025      INTEGER;
  n_2026      INTEGER;
  n_2027      INTEGER;
  n_2023      INTEGER;
  fy26_p1_start DATE;
  fy26_p13_end  DATE;
  fy24_p1_start DATE;
  fy27_p13_end  DATE;
BEGIN
  IF to_regclass('public.fiscal_periods') IS NULL THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: table did not materialise';
  END IF;
  -- Column existence guard (a typo in the CREATE TABLE would surface here).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_periods'
      AND column_name IN ('fiscal_year','period_no','start_date','end_date')
    GROUP BY () HAVING COUNT(*) = 4
  ) THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: expected 4 columns not all present';
  END IF;
  -- Grants that the historical loader will hit at request time.
  IF NOT has_table_privilege('service_role', 'public.fiscal_periods', 'SELECT') THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: service_role missing SELECT';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.fiscal_periods', 'INSERT') THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: service_role missing INSERT';
  END IF;
  -- Row-count invariants.
  SELECT COUNT(*) INTO n_rows FROM fiscal_periods;
  IF n_rows < 52 THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: total rows = %, expected >= 52 (13 x 4 fiscal years)', n_rows;
  END IF;
  SELECT COUNT(*) INTO n_2024 FROM fiscal_periods WHERE fiscal_year = 2024;
  SELECT COUNT(*) INTO n_2025 FROM fiscal_periods WHERE fiscal_year = 2025;
  SELECT COUNT(*) INTO n_2026 FROM fiscal_periods WHERE fiscal_year = 2026;
  SELECT COUNT(*) INTO n_2027 FROM fiscal_periods WHERE fiscal_year = 2027;
  SELECT COUNT(*) INTO n_2023 FROM fiscal_periods WHERE fiscal_year = 2023;
  IF n_2024 <> 13 OR n_2025 <> 13 OR n_2026 <> 13 OR n_2027 <> 13 THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: expected 13 rows per FY (2024=%, 2025=%, 2026=%, 2027=%)', n_2024, n_2025, n_2026, n_2027;
  END IF;
  -- R-10: FY2023 must be absent from the seed.
  IF n_2023 <> 0 THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: FY2023 rows = %, expected 0 (R-10 parked)', n_2023;
  END IF;
  -- Boundary spot-checks (belt-and-suspenders vs the seed math).
  SELECT start_date INTO fy24_p1_start FROM fiscal_periods WHERE fiscal_year = 2024 AND period_no = 1;
  IF fy24_p1_start <> DATE '2024-01-01' THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: FY2024 P1 start = %, expected 2024-01-01', fy24_p1_start;
  END IF;
  SELECT start_date INTO fy26_p1_start FROM fiscal_periods WHERE fiscal_year = 2026 AND period_no = 1;
  IF fy26_p1_start <> DATE '2025-12-29' THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: FY2026 P1 start = %, expected 2025-12-29', fy26_p1_start;
  END IF;
  SELECT end_date INTO fy26_p13_end FROM fiscal_periods WHERE fiscal_year = 2026 AND period_no = 13;
  IF fy26_p13_end <> DATE '2026-12-27' THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: FY2026 P13 end = %, expected 2026-12-27', fy26_p13_end;
  END IF;
  SELECT end_date INTO fy27_p13_end FROM fiscal_periods WHERE fiscal_year = 2027 AND period_no = 13;
  IF fy27_p13_end <> DATE '2027-12-26' THEN
    RAISE EXCEPTION 'pnl-3 post-flight [fiscal_periods]: FY2027 P13 end = %, expected 2027-12-26', fy27_p13_end;
  END IF;
  RAISE NOTICE 'pnl-3 post-flight [fiscal_periods] OK: 52 rows, FY2024..FY2027, FY2023 absent, boundaries verified';
END $$;

COMMIT;


-- ─── Section 2: kpi_period_status seeds + FY2026 P9 backfill ───────
BEGIN;

-- Pre-flight: pnl-1 seed present, no partial FY2024/FY2025 seed
-- already applied.
DO $$
DECLARE
  n_2024_pre  INTEGER;
  n_2025_pre  INTEGER;
  n_fp        INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_2024_pre FROM kpi_period_status WHERE fiscal_year = 2024;
  SELECT COUNT(*) INTO n_2025_pre FROM kpi_period_status WHERE fiscal_year = 2025;
  IF n_2024_pre > 0 OR n_2025_pre > 0 THEN
    RAISE NOTICE 'pnl-3 pre-flight [kpi_period_status]: FY2024 pre-rows = %, FY2025 pre-rows = % (idempotent re-apply)', n_2024_pre, n_2025_pre;
  END IF;
  SELECT COUNT(*) INTO n_fp FROM fiscal_periods WHERE fiscal_year IN (2024, 2025);
  IF n_fp <> 26 THEN
    RAISE EXCEPTION 'pnl-3 pre-flight [kpi_period_status]: fiscal_periods FY2024+FY2025 rows = %, expected 26 (block 1 seed must run first)', n_fp;
  END IF;
END $$;

-- Seed FY2024 + FY2025 kpi_period_status rows. closed_at = end of
-- the period's last day (Sunday 23:59:59 UTC). verified_at NULL:
-- the historical loader will UPDATE it when the workbook lands
-- (same pattern the FY2026 loader used for P1..P8).
--
-- SELECT-from-fiscal_periods so the closed_at values follow from
-- the calendar we just seeded rather than being hand-typed twice.
INSERT INTO kpi_period_status (fiscal_year, period_no, closed_at, verified_at, verified_by, source_ref)
SELECT
  fp.fiscal_year,
  fp.period_no,
  ((fp.end_date::text || 'T23:59:59Z')::timestamptz) AS closed_at,
  NULL AS verified_at,
  NULL AS verified_by,
  NULL AS source_ref
FROM fiscal_periods fp
WHERE fp.fiscal_year IN (2024, 2025)
ON CONFLICT (fiscal_year, period_no) DO NOTHING;

-- FY2026 P9 closed_at backfill. R-17 permits this metadata stamp -
-- P9's fiscal-calendar close has passed (2026-09-06 Sunday). The
-- WHERE guard ensures we only fill NULL: if the value was already
-- set by any prior process, we leave it alone.
UPDATE kpi_period_status
SET closed_at = '2026-09-06T23:59:59Z'::timestamptz,
    updated_at = now()
WHERE fiscal_year = 2026
  AND period_no = 9
  AND closed_at IS NULL;

-- Post-flight: FY2024 + FY2025 seed sizes, closed_at populated on
-- every seeded row, verified_at NULL on every seeded row, and the
-- FY2026 P9 stamp.
DO $$
DECLARE
  n_2024        INTEGER;
  n_2025        INTEGER;
  n_2024_closed INTEGER;
  n_2025_closed INTEGER;
  n_2024_verified INTEGER;
  n_2025_verified INTEGER;
  p9_closed_at  TIMESTAMPTZ;
  fy24_p1_close TIMESTAMPTZ;
  fy25_p13_close TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*) INTO n_2024 FROM kpi_period_status WHERE fiscal_year = 2024;
  SELECT COUNT(*) INTO n_2025 FROM kpi_period_status WHERE fiscal_year = 2025;
  IF n_2024 <> 13 OR n_2025 <> 13 THEN
    RAISE EXCEPTION 'pnl-3 post-flight [kpi_period_status]: FY2024 = %, FY2025 = %, expected 13 each', n_2024, n_2025;
  END IF;
  SELECT COUNT(*) INTO n_2024_closed FROM kpi_period_status WHERE fiscal_year = 2024 AND closed_at IS NOT NULL;
  SELECT COUNT(*) INTO n_2025_closed FROM kpi_period_status WHERE fiscal_year = 2025 AND closed_at IS NOT NULL;
  IF n_2024_closed <> 13 OR n_2025_closed <> 13 THEN
    RAISE EXCEPTION 'pnl-3 post-flight [kpi_period_status]: closed_at populated = FY2024:%, FY2025:%, expected 13 each', n_2024_closed, n_2025_closed;
  END IF;
  -- verified_at must be NULL on the seeded rows so the loader owns the flip.
  SELECT COUNT(*) INTO n_2024_verified FROM kpi_period_status WHERE fiscal_year = 2024 AND verified_at IS NOT NULL;
  SELECT COUNT(*) INTO n_2025_verified FROM kpi_period_status WHERE fiscal_year = 2025 AND verified_at IS NOT NULL;
  IF n_2024_verified <> 0 OR n_2025_verified <> 0 THEN
    RAISE NOTICE 'pnl-3 post-flight [kpi_period_status]: FY2024 verified = %, FY2025 verified = % (already loaded; re-apply)', n_2024_verified, n_2025_verified;
  END IF;
  -- Boundary spot-checks (2024-01-28 P1 close, 2025-12-28 P13 close).
  SELECT closed_at INTO fy24_p1_close FROM kpi_period_status WHERE fiscal_year = 2024 AND period_no = 1;
  IF fy24_p1_close IS DISTINCT FROM '2024-01-28T23:59:59Z'::timestamptz THEN
    RAISE EXCEPTION 'pnl-3 post-flight [kpi_period_status]: FY2024 P1 closed_at = %, expected 2024-01-28T23:59:59Z', fy24_p1_close;
  END IF;
  SELECT closed_at INTO fy25_p13_close FROM kpi_period_status WHERE fiscal_year = 2025 AND period_no = 13;
  IF fy25_p13_close IS DISTINCT FROM '2025-12-28T23:59:59Z'::timestamptz THEN
    RAISE EXCEPTION 'pnl-3 post-flight [kpi_period_status]: FY2025 P13 closed_at = %, expected 2025-12-28T23:59:59Z', fy25_p13_close;
  END IF;
  -- FY2026 P9 stamp.
  SELECT closed_at INTO p9_closed_at FROM kpi_period_status WHERE fiscal_year = 2026 AND period_no = 9;
  IF p9_closed_at IS DISTINCT FROM '2026-09-06T23:59:59Z'::timestamptz THEN
    RAISE EXCEPTION 'pnl-3 post-flight [kpi_period_status]: FY2026 P9 closed_at = %, expected 2026-09-06T23:59:59Z', p9_closed_at;
  END IF;
  RAISE NOTICE 'pnl-3 post-flight [kpi_period_status] OK: FY2024+FY2025 seeded (26 rows, closed_at populated, verified_at NULL); FY2026 P9 closed_at stamped';
END $$;

COMMIT;
