-- R-114 follow-up · load three missing finance-only line actuals
--
-- Discovered during the R-114 PR 2 audit (2026-09-17) - pnl_actuals
-- carried three line items that never reached purchasing_actuals
-- because they are not billed through bill.com and not on the Rippling
-- card. Same shape as the 3500.2 vehicle-insurance load in R-114 PR 2
-- (item 6): finance-loaded rows sourced from pnl_actuals, tagged
-- `source = 'upload'` because the purchasing_actuals_source_check
-- constraint has no better value. See
-- docs/backlog/migration-gate-mcp-path-reword.md and
-- docs/backlog/r114-purchasing-actuals-source-pnl-finance-load.md for
-- the follow-up that adds a real `pnl_finance_load` source value.
--
-- Rows loaded (all figures verified against pnl_actuals · Kevin
-- confirmed 2026-09-17):
--
--   account   period  line    amount    label
--   TBJ - FL  P9      3400.1  $150.00   Packaging (finance)
--   TBR - FL  P1      3500.1  $96.33    Delivery Mileage Reimbursement (finance)
--   TBR - FL  P9      3500.5  $1,000.00 Vehicle Repair & Maintenance (finance)
--
-- Idempotent via unique (source, source_line_id). Rerunning updates
-- amount + txn_date to whatever the row currently carries; on future
-- finance loads the SELECT block in R-114 PR 2's item 6 migration
-- picks these lines up automatically and this file becomes redundant.

BEGIN;

INSERT INTO purchasing_actuals (
  source, source_bill_id, source_line_id,
  account_key, excluded, gl_line_code, gl_bucket,
  txn_date, posting_date, amount, vendor_or_merchant, paid,
  approx_date, derived_at
) VALUES
  ('upload', 'pnl_actuals::TBJ - FL::FY2026::P9', 'TBJ - FL::FY2026::P9::3400.1',
   'TBJ - FL', false, '3400.1', 'pl_cogs',
   '2026-09-06'::date, '2026-09-06'::date, 150.00,
   'Packaging (finance)', true, false, now()),
  ('upload', 'pnl_actuals::TBR - FL::FY2026::P1', 'TBR - FL::FY2026::P1::3500.1',
   'TBR - FL', false, '3500.1', 'pl_cogs',
   '2026-01-25'::date, '2026-01-25'::date, 96.33,
   'Delivery Mileage Reimbursement (finance)', true, false, now()),
  ('upload', 'pnl_actuals::TBR - FL::FY2026::P9', 'TBR - FL::FY2026::P9::3500.5',
   'TBR - FL', false, '3500.5', 'pl_cogs',
   '2026-09-06'::date, '2026-09-06'::date, 1000.00,
   'Vehicle Repair & Maintenance (finance)', true, false, now())
ON CONFLICT (source, source_line_id) DO UPDATE
  SET amount     = EXCLUDED.amount,
      txn_date   = EXCLUDED.txn_date,
      derived_at = EXCLUDED.derived_at;

COMMIT;

-- Verification:
--
--   SELECT account_key, gl_line_code, txn_date, amount, vendor_or_merchant
--   FROM purchasing_actuals
--   WHERE source_line_id IN (
--     'TBJ - FL::FY2026::P9::3400.1',
--     'TBR - FL::FY2026::P1::3500.1',
--     'TBR - FL::FY2026::P9::3500.5'
--   )
--   ORDER BY account_key, gl_line_code, txn_date;
--
-- Expected: three rows, amounts 150.00 / 96.33 / 1000.00.
