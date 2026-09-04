-- worker-dept-history-seed-bailey.sql
--
-- Kevin R-70 Stage 2 (2026-09-04): first seed of worker_dept_history.
-- Bailey only. The other 11 salaried TED candidates (see
-- docs/salary-mover-annotation.md) wait for Kevin's facts.
--
-- Bailey moved TBR - FL -> CIN - KY on 2026-03-09 (per Rippling
-- title_effective_date + finance's P3 part-period on both accounts).
--
-- Two rows per the spell-coverage rule: one for his opening spell
-- at TBR - FL from FY start through the day before the move, and
-- one for his current spell at CIN - KY from the move onward.
--
-- The whole-week accrual convention in derive_salary_actuals.mjs
-- assigns each week to whichever account owns its Monday. 2026-03-09
-- is a Monday, so the week 2026-03-09..2026-03-15 accrues to CIN - KY
-- in full. Finance's P3 part-period ($3,307 CIN + $19,062 TBR) is a
-- mid-week proration; our whole-week accrual will land close but not
-- exact. Kevin's ruling: report the residual, do not force the match.
--
-- Idempotent: ON CONFLICT on (worker_id, effective_from) DO NOTHING
-- so re-applying the migration is safe.

BEGIN;

INSERT INTO worker_dept_history
  (worker_id, effective_from, end_date, account_key, source, note)
VALUES
  ('62b618f3c44ba8b9fb4221d2', '2025-12-29', '2026-03-08', 'TBR - FL',
   'kevin_manual',
   'Bailey opening spell · Executive Chef TBR - FL · FY26 recon 2026-09-04'),
  ('62b618f3c44ba8b9fb4221d2', '2026-03-09', NULL,         'CIN - KY',
   'kevin_manual',
   'Bailey move to CIN - KY per finance P3 · title_effective_date 2026-03-09')
ON CONFLICT (worker_id, effective_from) DO NOTHING;

COMMIT;
