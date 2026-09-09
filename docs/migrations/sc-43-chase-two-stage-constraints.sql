-- ═══════════════════════════════════════════════════════════════════
-- sc-43: sc_week_chase_sent constraints for the two-stage chase
-- 2026-09-09
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   The chase ladder is being rebuilt from three stages (N3.1 Fri
--   12:00 / N3.2 Mon 12:00 / N3.3 Tue 9:00) to two (N3.reminder
--   Sun 18:00 / N3.urgent Mon 15:00) per KF_CHASE_EMAILS_RENDER +
--   the CC_PROMPT_CHASE_REBUILD.md brief. The rebuild is code-only
--   for recipients, copy, and cadence - but three CHECK constraints
--   on sc_week_chase_sent hardcode the old stage vocabulary and
--   would reject every write from the new code.
--
-- Constraints touched:
--   1. sc_week_chase_sent_stage_check
--        current: stage IN ('N3.1', 'N3.2', 'N3.3')
--        new:     stage IN ('N3.1', 'N3.2', 'N3.3', 'N3.reminder', 'N3.urgent')
--        (additive - historical ledger rows keep validating)
--
--   2. sc_week_chase_sent_check (slack_ok NOT NULL only on N3.3)
--        current: (stage = 'N3.3' AND slack_ok NOT NULL)
--              OR (stage <> 'N3.3' AND slack_ok NULL)
--        new:     slack_ok NOT NULL for every stage that Slacks.
--                 Both new stages Slack + N3.3 kept for history.
--                 (stage IN ('N3.3','N3.reminder','N3.urgent') AND slack_ok NOT NULL)
--              OR (stage IN ('N3.1','N3.2') AND slack_ok NULL)
--
--   3. sc_week_chase_sent_email_result_check
--        current: email_result NULL OR email_result IN ('sent', 'failed')
--        new:     add 'skipped_no_recipients' to the set. This is the
--                 label the new Sunday reminder writes when live-mode
--                 salaried_manager_emails is empty (Slack still fires,
--                 email is deliberately skipped) - see the noSiteRecipient
--                 branch in chaseNotifications.js.
--
-- Rationale (CC, not owner-ruled):
--   Additive keeps historical ledger rows with N3.1/N3.2/N3.3
--   valid, so no data cleanup and no risk to the audit trail. The
--   old code path is removed in this same PR, so nothing will write
--   the old values again - but the values themselves stay legal so
--   a rollback would work without touching the ledger. Kevin did
--   not rule on this specifically; the additive choice is the
--   safer default. If the preference is instead to hard-cut the
--   old vocab (only N3.reminder + N3.urgent legal), delete the old
--   values from the CHECK arrays here + delete every existing
--   ledger row with the old stage before applying.
--
-- Fences:
--   - Additive only. No existing row invalidated. No column dropped.
--     The unique index on (account_key, week_start, stage) is
--     untouched.
--   - Constraints replaced (DROP + ADD) rather than modified in
--     place - Postgres has no ALTER CONSTRAINT, so DROP+ADD is the
--     idiomatic path. Both operations run inside a single BEGIN/COMMIT
--     so an ADD failure rolls back the DROP.
--   - Verified against pg_constraint on 2026-09-09; all three
--     conname values match production exactly.
--
-- Apply order:
--   BLOCK A applies. BLOCK B verifies. There is no data-migration
--   block (no data changes).
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: constraint swap (single transaction)
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- (1) stage: additive - old + new values both legal.
ALTER TABLE sc_week_chase_sent
  DROP CONSTRAINT IF EXISTS sc_week_chase_sent_stage_check;

ALTER TABLE sc_week_chase_sent
  ADD CONSTRAINT sc_week_chase_sent_stage_check
  CHECK (stage IN ('N3.1', 'N3.2', 'N3.3', 'N3.reminder', 'N3.urgent'));

-- (2) slack_ok invariant: NOT NULL on any stage that Slacks;
--     NULL on the retired-and-non-slacking N3.1/N3.2.
ALTER TABLE sc_week_chase_sent
  DROP CONSTRAINT IF EXISTS sc_week_chase_sent_check;

ALTER TABLE sc_week_chase_sent
  ADD CONSTRAINT sc_week_chase_sent_check
  CHECK (
       (stage IN ('N3.3', 'N3.reminder', 'N3.urgent') AND slack_ok IS NOT NULL)
    OR (stage IN ('N3.1', 'N3.2')                    AND slack_ok IS NULL)
  );

-- (3) email_result: add 'skipped_no_recipients'.
ALTER TABLE sc_week_chase_sent
  DROP CONSTRAINT IF EXISTS sc_week_chase_sent_email_result_check;

ALTER TABLE sc_week_chase_sent
  ADD CONSTRAINT sc_week_chase_sent_email_result_check
  CHECK (
    email_result IS NULL
    OR email_result IN ('sent', 'failed', 'skipped_no_recipients')
  );

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: verify (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Query 1: confirm the three CHECK constraints exist with the new
-- definitions.
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.sc_week_chase_sent'::regclass
  AND conname IN (
    'sc_week_chase_sent_stage_check',
    'sc_week_chase_sent_check',
    'sc_week_chase_sent_email_result_check'
  )
ORDER BY conname;

-- Expected 3 rows:
--   sc_week_chase_sent_check                | CHECK ((((stage = ANY ...))))
--   sc_week_chase_sent_email_result_check   | CHECK (((email_result IS NULL) OR (email_result = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped_no_recipients'::text]))))
--   sc_week_chase_sent_stage_check          | CHECK ((stage = ANY (ARRAY['N3.1'::text, 'N3.2'::text, 'N3.3'::text, 'N3.reminder'::text, 'N3.urgent'::text])))
--
-- The stage check MUST include 'N3.reminder' AND 'N3.urgent'. If
-- either is missing the code will fail on first fire with a
-- constraint violation.


-- Query 2: confirm no existing rows were invalidated (should be
-- impossible under an additive change, but verify anyway).
SELECT stage, COUNT(*) AS row_count
FROM sc_week_chase_sent
GROUP BY stage
ORDER BY stage;

-- Expected: every existing stage value is one of N3.1/N3.2/N3.3
-- (production has no rows for the new values yet). No error thrown.


-- Query 3: confirm the unique index on (account_key, week_start,
-- stage) still exists. Migration did not touch it - this is a
-- guard against accidental drop.
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'sc_week_chase_sent'
  AND indexname = 'uq_sc_week_chase_sent_stage';

-- Expected 1 row: uq_sc_week_chase_sent_stage on (account_key, week_start, stage).

-- The first live chase fire (Sun 18:00 or Mon 15:00 in an account's
-- local tz) is the real acceptance test for the new stage vocabulary
-- + slack_ok invariant. No dry-insert probe here - Studio has run
-- statements independently in past sessions, and a partial paste
-- that skipped a ROLLBACK would leave junk rows in the ledger.


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed - do not run in normal flow)
-- ═══════════════════════════════════════════════════════════════════
--
-- The old constraints can be restored by dropping the new ones
-- and re-adding the pre-sc-43 shape. Any new-vocabulary rows
-- (N3.reminder / N3.urgent) written after sc-43 lands would need
-- to be deleted or re-labeled first, since the pre-sc-43 stage
-- CHECK rejects them. In practice the rollback path is: revert
-- the code PR (stops writing new values), delete any new-value
-- rows from sc_week_chase_sent, then apply this block.
--
-- BEGIN;
--   DELETE FROM sc_week_chase_sent WHERE stage IN ('N3.reminder', 'N3.urgent');
--
--   ALTER TABLE sc_week_chase_sent
--     DROP CONSTRAINT IF EXISTS sc_week_chase_sent_stage_check;
--   ALTER TABLE sc_week_chase_sent
--     ADD CONSTRAINT sc_week_chase_sent_stage_check
--     CHECK (stage IN ('N3.1', 'N3.2', 'N3.3'));
--
--   ALTER TABLE sc_week_chase_sent
--     DROP CONSTRAINT IF EXISTS sc_week_chase_sent_check;
--   ALTER TABLE sc_week_chase_sent
--     ADD CONSTRAINT sc_week_chase_sent_check
--     CHECK (
--          (stage = 'N3.3' AND slack_ok IS NOT NULL)
--       OR (stage <> 'N3.3' AND slack_ok IS NULL)
--     );
--
--   ALTER TABLE sc_week_chase_sent
--     DROP CONSTRAINT IF EXISTS sc_week_chase_sent_email_result_check;
--   ALTER TABLE sc_week_chase_sent
--     ADD CONSTRAINT sc_week_chase_sent_email_result_check
--     CHECK (email_result IS NULL OR email_result IN ('sent', 'failed'));
-- COMMIT;
