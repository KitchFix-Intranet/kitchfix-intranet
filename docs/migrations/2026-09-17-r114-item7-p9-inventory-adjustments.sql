-- R-114 PR 2 · item 7 · P9 inventory adjustments load
--
-- Kevin's ruling 2026-09-17 with the workbook values below. Sign
-- convention (verified against P1-P8): `adjusting_je =
-- closing_balance - prior_balance`. Negative JE means inventory fell,
-- cost is higher than purchases per R-61.
--
-- Counted 4 accounts × 3 categories (12 rows) with real workbook JE.
-- Not-counted 4 accounts × 3 categories (12 rows) with adjusting_je =
-- 0 and source_label 'not counted · P9' so the LEFT JOIN in the
-- resolver reads a real row rather than silently carrying P8 forward.
-- prior/closing on not-counted rows carry P8's closing forward on
-- all four (state unchanged over the period we did not measure). For
-- TXR - TX - H that closing is 0 - the account was zeroed out mid-P8
-- (JE -17,850 against a $17,850 prior), so P9 opens and closes at 0.
--
-- Idempotent via PRIMARY KEY (account_key, fiscal_year, period_no,
-- category). ON CONFLICT updates the JE and balances so re-running
-- with corrected figures is safe.
--
-- 2026-09-17 revision: Kevin caught that his original workbook line
-- gave "3400 packaging + supplies" as a combined figure per account,
-- which I placed on the packaging row alone. Per-category values now
-- straight from the workbook, all reconciling prior + JE = closing
-- with closing >= 0.

BEGIN;

INSERT INTO inventory_adjustments (
  account_key, fiscal_year, period_no, category, gl_line_code,
  adjusting_je, prior_balance, closing_balance,
  source_label, source_ref, loaded_at
) VALUES
  -- ── TBJ - FL · counted ───────────────────────────────────────────
  ('TBJ - FL',  2026, 9, 'food',      '3200',  -331.06,  8058.41, 7727.35,
    '1255 Inventory- TBJ, Food DUN',       'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBJ - FL',  2026, 9, 'packaging', '3400',   -60.29,    60.29,    0.00,
    '1256 Inventory - TBJ, Packaging DUN', 'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBJ - FL',  2026, 9, 'supplies',  '3400',  -763.12,  2347.55, 1584.43,
    '1256.1 Inventory - TBJ Supplies DUN', 'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),

  -- ── TBR - FL · counted ───────────────────────────────────────────
  -- Note: packaging JE positive - inventory rose over the period.
  ('TBR - FL',  2026, 9, 'food',      '3200', -2321.34, 15605.37, 13284.03,
    '1280 Inventory - TBR Food',           'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBR - FL',  2026, 9, 'packaging', '3400',    99.01,  3688.67, 3787.68,
    '1281 Inventory - TBR Packaging',      'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBR - FL',  2026, 9, 'supplies',  '3400',  -113.76,  2023.03, 1909.27,
    '1281.1 Inventory - TBR Supplies',     'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),

  -- ── CIN - AZ · counted ───────────────────────────────────────────
  ('CIN - AZ',  2026, 9, 'food',      '3200', -1380.18,  9109.74, 7729.56,
    '1275 Inventory - REDS Food',          'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('CIN - AZ',  2026, 9, 'packaging', '3400',  -299.36,  2563.07, 2263.71,
    '1275.2 Inventory - REDS Packaging',   'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('CIN - AZ',  2026, 9, 'supplies',  '3400',  -138.02,  1932.05, 1794.03,
    '1275.3 Inventory - REDS Supplies',    'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),

  -- ── TBJ - NY · counted (JE = 0) ──────────────────────────────────
  -- Workbook explicitly reports all zeros for TBJ - NY P9. Preserving
  -- the counted status via source_label matching the account's own
  -- inventory ledger (not "not counted").
  ('TBJ - NY',  2026, 9, 'food',      '3200',     0.00,  1200.00, 1200.00,
    '1257.3 Inventory - TBJ BUFood',       'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBJ - NY',  2026, 9, 'packaging', '3400',     0.00,   200.00,  200.00,
    '1257.4 Inventory - TBJ BUF Packaging','R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),
  ('TBJ - NY',  2026, 9, 'supplies',  '3400',     0.00,   300.00,  300.00,
    '1257.5 Inventory - TBJ BUF Supplies', 'R-114 PR 2 · Kevin workbook P9 · 2026-09-17', now()),

  -- ── TXR - AZ · not counted ───────────────────────────────────────
  -- prior/closing carry P8 closing forward (state unchanged for a
  -- period we did not measure). JE = 0 keeps R-61's adjusted-cost
  -- math untouched.
  ('TXR - AZ',  2026, 9, 'food',      '3200',     0.00, 11583.11, 11583.11,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - AZ',  2026, 9, 'packaging', '3400',     0.00,  5448.04, 5448.04,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - AZ',  2026, 9, 'supplies',  '3400',     0.00,  1926.70, 1926.70,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),

  -- ── CIN - KY · not counted ───────────────────────────────────────
  ('CIN - KY',  2026, 9, 'food',      '3200',     0.00,  1200.00, 1200.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('CIN - KY',  2026, 9, 'packaging', '3400',     0.00,   800.00,  800.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('CIN - KY',  2026, 9, 'supplies',  '3400',     0.00,   300.00,  300.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),

  -- ── TXR - TX - H · not counted ───────────────────────────────────
  -- The account was zeroed out in P8 (JE -17,850 against a $17,850
  -- prior). P8's closing_balance column was left null but the
  -- reconciled state was $0. Carrying that state forward: P9 opens
  -- and closes at 0 on every category.
  ('TXR - TX - H', 2026, 9, 'food',      '3200',  0.00,     0.00,    0.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - TX - H', 2026, 9, 'packaging', '3400',  0.00,     0.00,    0.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - TX - H', 2026, 9, 'supplies',  '3400',  0.00,     0.00,    0.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),

  -- ── TXR - TX - V · not counted ───────────────────────────────────
  ('TXR - TX - V', 2026, 9, 'food',      '3200',  0.00, 13375.00, 13375.00,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - TX - V', 2026, 9, 'packaging', '3400',  0.00,  2000.64,  2000.64,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now()),
  ('TXR - TX - V', 2026, 9, 'supplies',  '3400',  0.00,  1261.66,  1261.66,
    'not counted · P9', 'R-114 PR 2 · Kevin ruling 2026-09-17 (uncounted)', now())
ON CONFLICT (account_key, fiscal_year, period_no, category) DO UPDATE
  SET adjusting_je    = EXCLUDED.adjusting_je,
      prior_balance   = EXCLUDED.prior_balance,
      closing_balance = EXCLUDED.closing_balance,
      source_label    = EXCLUDED.source_label,
      source_ref      = EXCLUDED.source_ref,
      loaded_at       = EXCLUDED.loaded_at;

COMMIT;

-- Verification queries:
--
-- 1. 24 rows for P9, 8 accounts × 3 categories.
--
--    SELECT account_key, COUNT(*) FROM inventory_adjustments
--    WHERE fiscal_year=2026 AND period_no=9
--    GROUP BY account_key ORDER BY account_key;
--
-- 2. Sign invariant `prior + JE = closing` holds on EVERY row (no
--    null balances after this migration - all 24 rows are numeric).
--    Closing >= 0 holds on every row (an inventory ledger cannot
--    hold a negative balance; a fail here means the workbook figure
--    is wrong before it lands on the board).
--
--    SELECT account_key, category, adjusting_je,
--           prior_balance + adjusting_je AS derived_closing,
--           closing_balance,
--           closing_balance - (prior_balance + adjusting_je) AS drift
--    FROM inventory_adjustments
--    WHERE fiscal_year=2026 AND period_no=9
--    ORDER BY account_key, category;
--
--    Expected drift = 0 on every row. Expected closing >= 0 on every row.
--
-- 3. All 4 uncounted accounts carry source_label 'not counted · P9':
--
--    SELECT account_key, COUNT(*) FROM inventory_adjustments
--    WHERE fiscal_year=2026 AND period_no=9
--      AND source_label = 'not counted · P9'
--    GROUP BY account_key ORDER BY account_key;
--
--    Expected: 4 accounts × 3 categories = 12 rows total.
