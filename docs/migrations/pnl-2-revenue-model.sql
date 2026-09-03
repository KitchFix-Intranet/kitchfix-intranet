-- pnl-2-revenue-model.sql
--
-- Kevin ruling 2026-09-03 (R-58, R-59): every account belongs to one
-- of three revenue models, and the Overview must switch its "adjusted
-- budget" surface behaviour on the model.
--
--   sc_driven       Revenue fluctuates with actual meal counts recorded
--                   in the Service Calendar.
--                   Accounts: TBR - FL, TBJ - FL, TBJ - NY, CIN - AZ,
--                             CIN - KY, TXR - AZ
--   management_fee  Revenue is contractual and locked; changes only
--                   for a one-off catering event. `adjusted budget`
--                   equals `period budget` by construction, so the
--                   envelope delta is always $0 - the card + cost-
--                   lines table drop the "Adjusted" framing entirely
--                   and read "P{N} budget" instead.
--                   Accounts: STL - FL, STL - MO, CIN - OH, TXR - TX - H
--   sales_based     Revenue is sales against budget - similar to SC
--                   but a different pipeline (TXR - TX - V).
--
-- Column lives on kpi_account_flags because that table already carries
-- the "sc_revenue_live" per-account operational lever - same shape,
-- same lifecycle, one row per account. Backfill is deterministic
-- from Kevin's ruling (three lists above). A hard-coded array in code
-- would drift the first time an account changes model; the column is
-- the source of truth.

BEGIN;

ALTER TABLE kpi_account_flags
  ADD COLUMN IF NOT EXISTS revenue_model TEXT
    CHECK (revenue_model IN ('sc_driven', 'management_fee', 'sales_based'));

-- Backfill.
UPDATE kpi_account_flags SET revenue_model = 'sc_driven'
  WHERE account_key IN ('TBR - FL', 'TBJ - FL', 'TBJ - NY', 'CIN - AZ', 'CIN - KY', 'TXR - AZ');

UPDATE kpi_account_flags SET revenue_model = 'management_fee'
  WHERE account_key IN ('STL - FL', 'STL - MO', 'CIN - OH', 'TXR - TX - H');

UPDATE kpi_account_flags SET revenue_model = 'sales_based'
  WHERE account_key IN ('TXR - TX - V');

-- Every account row must have a model post-backfill.
DO $$
DECLARE
  v_missing INT;
BEGIN
  SELECT COUNT(*) INTO v_missing FROM kpi_account_flags WHERE revenue_model IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'pnl-2 migration: % account(s) still have NULL revenue_model - refusing to enforce NOT NULL', v_missing;
  END IF;
END $$;

ALTER TABLE kpi_account_flags
  ALTER COLUMN revenue_model SET NOT NULL;

-- Record.
UPDATE kpi_account_flags
  SET set_at = NOW(),
      set_by = 'pnl-2-revenue-model-2026-09-03'
  WHERE revenue_model IS NOT NULL
    AND set_by NOT LIKE 'kevin-golive%';

COMMIT;

-- Verify (read-only after commit):
--   SELECT account_key, revenue_model, sc_revenue_live FROM kpi_account_flags ORDER BY account_key;
