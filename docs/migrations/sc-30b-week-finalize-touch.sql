-- ═══════════════════════════════════════════════════════════════════
-- sc-30b: BEFORE UPDATE trigger to bump sc_week_finalize.changed_at
-- 2026-08-07
-- ═══════════════════════════════════════════════════════════════════
--
-- Fixes the sc-30 finding surfaced during Chat-Claude's SQL review:
-- `changed_at TIMESTAMPTZ NOT NULL DEFAULT now()` only fires on INSERT.
-- PostgreSQL never re-evaluates DEFAULT on UPDATE, so a status
-- transition (finalized -> reverted; PR-C: finalized -> push_failed,
-- finalized -> billed, push_failed -> billed) leaves changed_at
-- stale at the row's original INSERT timestamp.
--
-- [ran]-verified 2026-08-07 with an owner-authorized probe against
-- prod (row: TXR - AZ / 2029-12-31, probe@kitchfix.com identity, now
-- in reverted state):
--   INSERT: changed_at = 2026-08-07T19:11:34.671827+00:00
--   UPDATE: changed_at = 2026-08-07T19:11:34.671827+00:00 (unchanged)
--
-- Kevin's ruling (2026-08-07): trigger over application-set. Rationale:
-- PR-C will add 3+ more UPDATE paths (push_failed, billed, retry->
-- billed). A trigger protects every current AND future code path
-- without requiring the caller to remember. The alternative (explicit
-- `changed_at: new Date().toISOString()` on every UPDATE payload)
-- works today with the single sc-revert-finalize choke-point but
-- silently rots the day the QBO adapter forgets it. Same discipline
-- as sc-25's sc_daily_actuals audit trigger.
--
-- What this migration adds:
--   1. `sc_week_finalize_touch()` - trivial plpgsql that sets
--      NEW.changed_at := now() and returns NEW.
--   2. `sc_week_finalize_touch_trigger` BEFORE UPDATE trigger on
--      sc_week_finalize, calling the touch function.
--
-- Idempotency: CREATE OR REPLACE on the function + DROP TRIGGER IF
-- EXISTS then CREATE TRIGGER. Same pattern sc-25 uses for the
-- sc_daily_actuals audit trigger. Re-apply is safe.
--
-- Retroactive effect: ZERO on data. Only new UPDATEs after this
-- migration applies bump changed_at. Rows already in the table keep
-- their current changed_at until the next UPDATE touches them.
-- Kevin's probe row (TXR - AZ / 2029-12-31 / reverted / probe@) is
-- one such row; deleting it via the cleanup step (see this PR's
-- report CLEANUP section) is the recommended path.
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Touch function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sc_week_finalize_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END;
$$;

-- ─── 2. Trigger ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sc_week_finalize_touch_trigger ON sc_week_finalize;
CREATE TRIGGER sc_week_finalize_touch_trigger
  BEFORE UPDATE ON sc_week_finalize
  FOR EACH ROW
  EXECUTE FUNCTION sc_week_finalize_touch();

-- ─── 3. Grant ───────────────────────────────────────────────────────
-- service_role must be able to execute the function since it owns
-- the UPDATE writes. Anon/authenticated do not need EXECUTE.
GRANT EXECUTE ON FUNCTION sc_week_finalize_touch() TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Function exists.
--
-- SELECT proname, prosrc
-- FROM pg_proc
-- WHERE proname = 'sc_week_finalize_touch';


-- V2. Trigger exists and is BEFORE UPDATE on sc_week_finalize.
--
-- SELECT trigger_name, event_manipulation, action_timing, action_statement
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table = 'sc_week_finalize'
--   AND trigger_name = 'sc_week_finalize_touch_trigger';


-- V3. End-to-end: on the existing probe row (TXR - AZ / 2029-12-31),
--     an UPDATE now bumps changed_at. Pick a harmless field to touch
--     since the row is already reverted. This SELECT captures the
--     changed_at BEFORE + AFTER the UPDATE for comparison.
--
-- -- Before:
-- SELECT id, status, changed_at
-- FROM sc_week_finalize
-- WHERE account_key = 'TXR - AZ' AND week_start = '2029-12-31';
--
-- -- Trigger fire (touch reverted_reason to something equivalent):
-- UPDATE sc_week_finalize
-- SET revert_reason = revert_reason
-- WHERE account_key = 'TXR - AZ' AND week_start = '2029-12-31';
--
-- -- After: changed_at should have advanced to now().
-- SELECT id, status, changed_at
-- FROM sc_week_finalize
-- WHERE account_key = 'TXR - AZ' AND week_start = '2029-12-31';
