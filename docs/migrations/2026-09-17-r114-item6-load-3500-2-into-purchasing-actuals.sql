-- R-114 PR 2 · item 6 · load 3500.2 vehicle insurance into purchasing_actuals
--
-- Kevin ruling 2026-09-17 (route A). "R-73 defines actuals as bill.com +
-- Rippling + inventory + credits; insurance is a monthly finance line
-- and must arrive as data." So we load it as data rather than a
-- resolver-layer fallback out of pnl_actuals.
--
-- The board's vehicle bucket reads
--   purchasing_actuals WHERE gl_line_code LIKE '3500%'
-- (via GL_PREFIX_FOR_BUCKET.vehicle in src/app/kpi/purchasing/lib/board.js).
-- Today only 3500.4 fuel lands in that table; 3500.2 insurance sits in
-- pnl_actuals unread. This loads the P1-P8 pnl_actuals values into
-- purchasing_actuals and adds a manual P9 row for TBJ - FL (Kevin's
-- confirmed value; finance P9 P&L not yet loaded to pnl_actuals).
--
-- ─── SOURCE PROVENANCE (READ THIS) ───────────────────────────────────
-- These rows are FINANCE-LOADED 3500.2 vehicle insurance from
-- `pnl_actuals`. They are tagged `source = 'upload'` because the
-- purchasing_actuals_source_check constraint currently only allows
-- {billcom, billcom_credit, rippling_spend, upload} - none of which
-- describes "finance load from pnl_actuals". Semantic identifiers
-- landed in adjacent columns:
--   source_bill_id       'pnl_actuals::<account>::FY<yy>::P<n>'
--   source_line_id       '<account>::FY<yy>::P<n>::3500.2'
--   vendor_or_merchant   'Vehicle Insurance (finance)'
-- A follow-up task extends the constraint to add a real
-- 'pnl_finance_load' value; tracked at
-- docs/backlog/r114-purchasing-actuals-source-pnl-finance-load.md.
-- Until that lands, `upload` is the working substitute and this
-- migration is the reference for what these rows are.
-- ─────────────────────────────────────────────────────────────────────
--
-- Idempotent via the unique (source, source_line_id) index. Rerunning
-- updates amount + txn_date to the pnl_actuals figure of record;
-- everything else is stable.
--
-- P9 CIN - KY 3500.2 is NOT loaded here — CIN-KY had P1-P8 insurance
-- (~$273/period) but finance has not published P9 yet and Kevin has
-- not confirmed a P9 figure. Flag for the next finance load.

BEGIN;

INSERT INTO purchasing_actuals (
  source, source_bill_id, source_line_id,
  account_key, excluded, gl_line_code, gl_bucket,
  txn_date, posting_date, amount, vendor_or_merchant, paid,
  approx_date, derived_at
)
SELECT
  'upload'                                                           AS source,
  'pnl_actuals::' || account_key || '::FY' || fiscal_year || '::P' || period_no AS source_bill_id,
  account_key || '::FY' || fiscal_year || '::P' || period_no || '::3500.2' AS source_line_id,
  account_key,
  false                                                              AS excluded,
  '3500.2'                                                           AS gl_line_code,
  'pl_cogs'                                                          AS gl_bucket,
  -- txn_date = period end (FY2026 P{n} ends on 2025-12-29 + 28n - 1 days)
  ('2025-12-29'::date + (period_no * 28 - 1) * INTERVAL '1 day')::date AS txn_date,
  ('2025-12-29'::date + (period_no * 28 - 1) * INTERVAL '1 day')::date AS posting_date,
  actual                                                             AS amount,
  'Vehicle Insurance (finance)'                                      AS vendor_or_merchant,
  true                                                               AS paid,
  false                                                              AS approx_date,
  now()                                                              AS derived_at
FROM pnl_actuals
WHERE line_code = '3500.2'
  AND actual IS NOT NULL AND actual <> 0
ON CONFLICT (source, source_line_id) DO UPDATE
  SET amount    = EXCLUDED.amount,
      txn_date  = EXCLUDED.txn_date,
      derived_at = EXCLUDED.derived_at;

-- Manual P9 bootstrap for TBJ - FL only. Finance has not loaded P9
-- P&L to pnl_actuals yet, so this row seeds the value directly from
-- Sebastian's P9 sheet (row 51 of the P9 block): $611.41. This is
-- NOT a pattern match against P8 - it is finance's actual for P9.
-- YTD through P9 is $5,511.50.
-- Once finance loads P9 to pnl_actuals in the normal cadence, the
-- SELECT block above will find the same (account, period, line)
-- combination and this row will UPDATE cleanly via the ON CONFLICT
-- clause. amount will overwrite to whatever pnl_actuals carries -
-- expected same value, but the finance load is the source of truth
-- once it runs.
-- P9 manual bootstrap · Sebastian P9 sheet row 51 · $611.41
-- (YTD $5,511.50) · Kevin ruling 2026-09-17. No `reason` column -
-- the check constraint reserves reason for excluded=true rows;
-- provenance is in the header block above + this comment + the
-- source_bill_id / source_line_id / vendor_or_merchant fields.
--
-- NOTE (2026-09-17 apply-time): finance loaded P9 to pnl_actuals in
-- the same window this PR ran, at exactly $611.41 (matching this
-- bootstrap). The SELECT block above now picks up P9 without help,
-- so this block is idempotent no-op via the ON CONFLICT clause. Kept
-- in the migration for the record + as a safety net for the next
-- time the shape recurs (P10 lands before finance loads).
INSERT INTO purchasing_actuals (
  source, source_bill_id, source_line_id,
  account_key, excluded, gl_line_code, gl_bucket,
  txn_date, posting_date, amount, vendor_or_merchant, paid,
  approx_date, derived_at
)
VALUES (
  'upload',
  'pnl_actuals::TBJ - FL::FY2026::P9',
  'TBJ - FL::FY2026::P9::3500.2',
  'TBJ - FL',
  false,
  '3500.2',
  'pl_cogs',
  '2026-09-06'::date,
  '2026-09-06'::date,
  611.41,
  'Vehicle Insurance (finance)',
  true,
  false,
  now()
)
ON CONFLICT (source, source_line_id) DO UPDATE
  SET amount    = EXCLUDED.amount,
      txn_date  = EXCLUDED.txn_date,
      derived_at = EXCLUDED.derived_at;

COMMIT;

-- Verification queries (run these after the migration):
--
-- 1. Expected row count: pnl_actuals has 16 rows with 3500.2 non-zero
--    (TBJ - FL P1-P8, CIN - KY P1-P8) + 1 P9 TBJ - FL manual = 17 total.
--
--    SELECT COUNT(*) FROM purchasing_actuals
--    WHERE source = 'pnl_finance_load' AND gl_line_code = '3500.2';
--
--    Expected: 17
--
-- 2. TBJ - FL P9 vehicle total should read $611.41 + $124.19 fuel = $735.60.
--
--    SELECT gl_line_code, SUM(amount) FROM purchasing_actuals
--    WHERE account_key = 'TBJ - FL'
--      AND gl_line_code LIKE '3500%'
--      AND txn_date BETWEEN '2026-08-10' AND '2026-09-06'
--      AND NOT excluded
--    GROUP BY gl_line_code;
--
--    Expected: 3500.2 → $611.41, 3500.4 → $124.19
--
-- 3. YTD (P1-P9) 3500.2 for TBJ - FL should read $5,511.50 - matches
--    Sebastian's YTD figure on the P9 sheet.
--
--    SELECT SUM(amount) FROM purchasing_actuals
--    WHERE account_key = 'TBJ - FL'
--      AND gl_line_code = '3500.2'
--      AND source = 'pnl_finance_load';
--
--    Expected: $5,511.50 (P1-P8 sum $4,900.09 + P9 bootstrap $611.41)
