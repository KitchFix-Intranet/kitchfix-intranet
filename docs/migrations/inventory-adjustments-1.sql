-- inventory-adjustments-1.sql
--
-- Kevin R-61 (2026-09-03): per-period inventory adjusting journal
-- entries. Sebastian produces `Period_Inventory.xlsx` at each period
-- close; Kevin uploads it and runs `scripts/load_inventory_
-- adjustments.mjs`. The board then reads the JEs and renders every
-- finalised period the way finance measures cost: what was USED, not
-- what was BOUGHT.
--
--   adjusted cost = purchases - adjusting_je
--
--   +JE  inventory rose  = you bought more than you used
--                        -> cost is LOWER than purchases
--   -JE  inventory fell  = you used more than you bought
--                        -> cost is HIGHER than purchases
--
-- Primary key = (account_key, fiscal_year, period_no, category).
-- Re-uploading a period upserts on the PK - no duplicates, no orphan
-- rows from a prior load.
--
-- Scope: 3200 (food) + 3400 (packaging + supplies). Labour + vehicle
-- carry no inventory; their gaps are unrelated. NO JE means NO
-- adjustment (absent-vs-zero rule); zero rows are never invented for
-- accounts that carry no inventory (CIN - OH, STL - FL, STL - MO -
-- management-fee / pass-through where food is billed back).

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  account_key      TEXT        NOT NULL,
  fiscal_year      INTEGER     NOT NULL,
  period_no        INTEGER     NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  category         TEXT        NOT NULL CHECK (category IN ('food', 'packaging', 'supplies')),
  gl_line_code     TEXT        NOT NULL,
  adjusting_je     NUMERIC(14, 2) NOT NULL,
  prior_balance    NUMERIC(14, 2),
  closing_balance  NUMERIC(14, 2),
  source_label     TEXT        NOT NULL,
  source_ref       TEXT        NOT NULL,
  loaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_key, fiscal_year, period_no, category)
);

-- Indexes for the resolver's per-range read: sum(adjusting_je)
-- grouped by (account_key, gl_line_code) across periods.
CREATE INDEX IF NOT EXISTS inventory_adjustments_by_range
  ON inventory_adjustments (fiscal_year, period_no, account_key);

CREATE INDEX IF NOT EXISTS inventory_adjustments_by_line
  ON inventory_adjustments (fiscal_year, account_key, gl_line_code);

COMMIT;
