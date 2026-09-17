-- R-115 · worker_dept_history · add annual_comp column
--
-- Kevin ruling 2026-09-17. Some workers who cross accounts also
-- change rate as part of that move (the same person, different
-- place, different rate). Rippling's `_latest` comp record reflects
-- the current place + current rate, and our snapshot table only
-- catches history for raises that occur AFTER we started walking -
-- neither carries the historical rate for a role-and-account change
-- that predates our sync. Manual seed is the only reliable source
-- for those cases.
--
-- worker_dept_history already handles the account attribution
-- (R-70). This column extends it: when present, the salary loader
-- uses annual_comp for weeks inside the spell instead of consulting
-- rippling_raw_compensations at all. When NULL (the default),
-- behaviour is unchanged - the loader falls through to the raw
-- compensations table with the raise-restatement rule.
--
-- Not a synthetic Rippling snapshot. This is a spell-scoped rate
-- override on the same table that already scopes spells by account.

-- Idempotency posture (Kevin catch 2026-09-17):
--
--   ADD COLUMN IF NOT EXISTS  -  re-run does not abort on the schema
--                                change if the column already exists.
--   INSERT ... SELECT ... WHERE NOT EXISTS  -  guards on the DATA,
--                                not on a unique constraint that
--                                does not exist on this table.
--
-- worker_dept_history's only unique constraint today is the auto-
-- generated PK on `id`. There is no unique index on
-- (worker_id, effective_from), so an ON CONFLICT DO NOTHING clause
-- has nothing to conflict against and would silently insert a
-- duplicate row on every re-run. Follow-up backlog entry
-- docs/backlog/worker-dept-history-unique-index.md tracks adding
-- one; until it lands, every seed migration on this table must use
-- the WHERE NOT EXISTS pattern below.

BEGIN;

ALTER TABLE worker_dept_history
  ADD COLUMN IF NOT EXISTS annual_comp numeric NULL;

COMMENT ON COLUMN worker_dept_history.annual_comp IS
  'Annual compensation to use for this spell instead of the Rippling comp record. NULL means the loader falls through to rippling_raw_compensations (raise-restatement rule). Kevin ruling 2026-09-17.';

-- R-115 seed · Ryan Moore's TXR - AZ spell before the CORP OPS move.
-- Rippling shows him CORP OPS with a $110k comp record effective
-- 2026-05-04; the prior TXR - AZ role + rate are not in our raw
-- comp snapshots (sync started 2026-08-06, months after the move).
-- Kevin ruling 2026-09-17: seed the spell manually with annual_comp
-- so the salary calculation lands the correct pre-move rate on
-- TXR - AZ without any change to Rippling data.
INSERT INTO worker_dept_history
  (worker_id, effective_from, end_date, account_key, source, annual_comp, note)
SELECT '619534b78b87cf5e27f17c00', '2025-12-29', '2026-05-03', 'TXR - AZ',
       'kevin_manual', 92520,
       'Exec Chef TXR - AZ until the RDO West move 2026-05-04'
WHERE NOT EXISTS (
  SELECT 1 FROM worker_dept_history
  WHERE worker_id = '619534b78b87cf5e27f17c00'
    AND account_key = 'TXR - AZ'
    AND effective_from = '2025-12-29'
);

COMMIT;

-- Verification:
--
-- 1. Column added:
--
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='worker_dept_history'
--      AND column_name='annual_comp';
--
--    Expected: annual_comp | numeric | YES
--
-- 2. Ryan seeded:
--
--    SELECT worker_id, effective_from, end_date, account_key, annual_comp, source, note
--    FROM worker_dept_history
--    WHERE worker_id = '619534b78b87cf5e27f17c00';
--
--    Expected: one row · 2025-12-29 .. 2026-05-03 · TXR - AZ · $92,520 · kevin_manual
