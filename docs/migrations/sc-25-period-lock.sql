-- ═══════════════════════════════════════════════════════════════════
-- sc-25: period lock + delete-audit trail
-- 2026-08-01
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships the server side of the "undo + period lock" feature.
--
-- What this migration adds:
--   1. sc_daily_actuals_history.change_type column (nullable-safe
--      default 'update'), so a delete-audit row is distinguishable
--      from a save-of-zero.
--   2. sc_daily_actuals BEFORE DELETE trigger + audit function that
--      writes a history row on every deletion. Without this, a
--      DELETE removes rows silently and undo has no receipt.
--   3. sc_is_period_closed(account_key TEXT, period TEXT) - the
--      isolated "is this period closed" test.
--   4. sc_is_day_locked(account_key TEXT, service_date DATE) -
--      the day-level lock. Resolves the day's period, delegates
--      the closed decision to sc_is_period_closed.
--
-- Owner rulings this codifies:
--   - SLT override = SC_ADMIN_EMAILS. Enforced application-side
--     (route handlers short-circuit before calling sc_is_day_locked
--     when the caller is in SC_ADMIN_EMAILS).
--   - Notes stay open on a locked period. sc-add-note write path
--     does NOT consult this function.
--   - Unknown days fail safe: LOCKED. A day the system cannot
--     place in a period is a day nobody can confirm AP has not
--     already pulled.
--   - The "closed" test is the swap point. v1 = period end has
--     passed. v2 (future) = whether AP has pulled the period.
--     Isolated as sc_is_period_closed so the swap touches one
--     function, not every write path.
--   - P13 is a 3-week period ending 2026-12-20 per doc + workbook
--     data. Nothing here backfills or trims metadata.
--
-- Idempotency:
--   - ADD COLUMN IF NOT EXISTS gates the schema change.
--   - CREATE OR REPLACE on functions.
--   - DROP TRIGGER IF EXISTS then CREATE TRIGGER, so re-apply is
--     safe.
--
-- Read-only-until-called: creating the functions does NOT lock any
-- write path. Enforcement lives in the route handlers, which are
-- deployed with this migration. Applying the migration without the
-- route changes is a no-op. Applying the route changes without the
-- migration would 500 on the RPC calls - see MIGRATION_STATUS.md
-- + the migration gate on the PR.
--
-- Retroactive effect (owner acknowledged 2026-08-01):
--   The moment this migration + the route changes land, every past
--   period closes for every non-SLT caller. All of the owner's test
--   data from January through 2026-08 (P1-P7) becomes read-only
--   for anyone outside SC_ADMIN_EMAILS the instant the deploy goes
--   green. The current period (P8 as of the write date) stays open,
--   plus the 3-day grace window (see sc_is_period_closed below).
--   Intended behavior: no operator has access yet, and the lock is
--   what the seeding + rollout are gating on. Not gradual, not
--   obvious - stated here so it does not get rediscovered as a
--   surprise.
--
-- SCOPE OF THE LOCK - what it protects and what it does NOT:
--
-- What sc_is_day_locked + assertDaysUnlockedForWrite protect:
--   Writes to sc_daily_actuals. Every path that upserts an actual
--   count into a closed period gets a 403 with code=PERIOD_LOCKED.
--   Wired at:
--     sc-submit-day       - route.js single-day save
--     sc-bulk-submit      - route.js bulk save
--     sc-submit-closeout  - route.js MLB homestand close-out
--     sc-reset-day        - route.js delete of a day's actuals
--
-- What the lock does NOT protect (2026-08-04, admin PR 1):
--   Admin catalog writes bypass this lock entirely. sc-config-update
--   (price) and sc-admin-fee-set (fee) never call
--   assertDaysUnlockedForWrite. A backdated price or fee change with
--   allowBackdate=true inserts a new sc_service_prices or
--   sc_fee_schedule row keyed by (id, effective_date). Because
--   sc_daily_revenue resolves its per-day price via a LATERAL that
--   picks the newest row with effective_date <= service_date at
--   query time, a backdated write silently rewrites what
--   sc_daily_revenue reports for every day from the new
--   effective_date forward - closed periods included, on the next
--   read.
--
--   Owner ruling 2026-08-04 (admin PR 1): warn and record, do not
--   block. The population that can reach admin (SC_ADMIN_EMAILS,
--   eight callers) is the same population the day-lock's SLT
--   override already exists for. Blocking them at the admin surface
--   would just move contract corrections into SQL, where they leave
--   no reason field, no author, and no history. So the edits stay
--   allowed and become impossible to do accidentally: the panel
--   shows the closed periods + the revenue delta before the operator
--   confirms, and the changelog reason gets a server-composed prose
--   prefix naming what was touched. See:
--     src/lib/scBackdateReport.js     - describeBackdateImpact +
--                                       composeBackdateReason
--     src/app/api/service-calendar/route.js
--                                     - sc-admin-backdate-preview
--                                     - prefix wired inside
--                                       sc-config-update + sc-admin-fee-set
--     src/app/service-calendar/admin/PriceEditPanel.js
--     src/app/service-calendar/admin/FeeEditPanel.js
--                                     - the two-phase Save (preview +
--                                       confirm) with the closed-period
--                                       modal
--
--   The parallel path (backdate reporter) is deliberately separate
--   from this file's assert-and-refuse helper - conflating them
--   would weaken the day lock. If a future policy wants price /
--   fee backdates BLOCKED on closed periods (not just recorded),
--   that is a new ruling; do not silently escalate the reporter
--   into a refuser.
--
-- Re-apply safety: all statements are idempotent.
--   - ADD COLUMN IF NOT EXISTS
--   - DO $$ block that inspects pg_constraint before adding the CHECK
--   - CREATE OR REPLACE FUNCTION for both functions (signatures
--     unchanged across revisions; body + LANGUAGE may change)
--   - DROP TRIGGER IF EXISTS + CREATE TRIGGER
-- Second pass runs cleanly against a database that already has
-- sc-25. Verified against the current schema after the first apply.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. sc_daily_actuals_history.change_type
-- ─────────────────────────────────────────────────────────────────
--
-- Convention: 'update' for the pre-existing BEFORE UPDATE trigger
-- row, 'delete' for the new BEFORE DELETE trigger row. A reader
-- distinguishing "operator saved 0" from "day was reset" reads this
-- column directly; new_count is not the distinguisher (both cases
-- can store 0). Default 'update' back-fills every historic row that
-- exists before this migration as coming from the UPDATE trigger,
-- which is the only path that wrote history until now.
ALTER TABLE sc_daily_actuals_history
  ADD COLUMN IF NOT EXISTS change_type TEXT NOT NULL DEFAULT 'update';

-- Add the CHECK constraint separately + guardedly so re-applying
-- this migration on a system that already has it does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_daily_actuals_history_change_type_check'
  ) THEN
    ALTER TABLE sc_daily_actuals_history
      ADD CONSTRAINT sc_daily_actuals_history_change_type_check
      CHECK (change_type IN ('update', 'delete'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 2. Recreate the update-audit function to write change_type
-- ─────────────────────────────────────────────────────────────────
--
-- Byte-identical to sc-1:295-309 except the INSERT now sets
-- change_type = 'update'. The trigger definition (sc-1:312-317)
-- does not change - re-declaring the function is enough since the
-- trigger calls it by name.
CREATE OR REPLACE FUNCTION sc_daily_actuals_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sc_daily_actuals_history (
    actual_id, account_key, service_id, service_date,
    old_count, new_count, changed_by, change_type
  ) VALUES (
    OLD.id, OLD.account_key, OLD.service_id, OLD.service_date,
    OLD.actual_count, NEW.actual_count,
    COALESCE(NEW.updated_by, NEW.created_by),
    'update'
  );
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. Delete-audit function + trigger
-- ─────────────────────────────────────────────────────────────────
--
-- Fires on every DELETE. Writes one history row per row deleted.
-- new_count is set to 0 (not NULL - the column is NOT NULL from
-- sc-1); the reader distinguishes delete from save-of-zero via
-- change_type = 'delete', not via the value.
--
-- changed_by uses updated_by || created_by (the same COALESCE the
-- update trigger uses). A raw DELETE from the database console
-- would inherit whatever the row's last actor was; the app-layer
-- sc-reset-day action also appends a note entry naming who did
-- the reset, so history + notes together tell a coherent story.
CREATE OR REPLACE FUNCTION sc_daily_actuals_delete_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sc_daily_actuals_history (
    actual_id, account_key, service_id, service_date,
    old_count, new_count, changed_by, change_type
  ) VALUES (
    OLD.id, OLD.account_key, OLD.service_id, OLD.service_date,
    OLD.actual_count, 0,
    COALESCE(OLD.updated_by, OLD.created_by),
    'delete'
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS sc_daily_actuals_delete_trigger ON sc_daily_actuals;
CREATE TRIGGER sc_daily_actuals_delete_trigger
  BEFORE DELETE ON sc_daily_actuals
  FOR EACH ROW
  EXECUTE FUNCTION sc_daily_actuals_delete_audit();

-- ─────────────────────────────────────────────────────────────────
-- 4. sc_is_period_closed - the swap point
-- ─────────────────────────────────────────────────────────────────
--
-- SWAP POINT. This is the whole reason the lock is split into two
-- functions rather than baked into every route. When AP starts
-- pulling periods, replace this function's body to consult a
-- `sc_period_locks` table (or equivalent) instead of the date
-- comparison. Zero caller changes required.
--
-- v1 input (2026-08-01):
--   "The period's last date has passed, PLUS a 3-day grace window
--   for operators to enter yesterday's counts." The period is
--   closed on day (MAX(service_date) + c_grace_days + 1).
--   Metadata is derived per-account (each account's sc_day_metadata
--   is the source), so P13 for TBR - FL ending 2026-12-29 and P13
--   for the other 10 accounts ending 2026-12-20 are respected
--   independently.
--
-- Grace window (c_grace_days = 3):
--   Operators enter the prior day's counts the following morning.
--   Without a grace window, a period ending on Sunday closes the
--   Monday morning an operator sits down to enter Sunday's counts -
--   the last day of every period becomes their first experience of
--   a "closed" refusal, in their training week. Three days covers a
--   Sunday-close entered Monday plus a missed day. Named constant
--   here so a future adjustment lives in one place.
--
--   THE GRACE WINDOW DISAPPEARS UNDER v2. Once AP has actually pulled
--   a period, "closed" is closed with no grace math - the pull IS
--   the confirmation the period is settled. The v2 body reads
--   sc_period_locks EXISTS and returns without the grace constant.
--   Delete c_grace_days when you swap; the constant is an artifact
--   of the date proxy, not part of the concept.
--
-- Fail-safe direction:
--   Unknown period (no rows in sc_day_metadata for the pair) returns
--   TRUE. Matches sc_is_day_locked's own unknown-day fail-safe -
--   both functions locked in the same direction so a direct caller
--   of sc_is_period_closed (nothing today; possible future admin
--   surface) does not stumble into an "unknown reads as open" trap.
--
-- Future input (v2, for the reader who will make the swap):
--   "AP has pulled this period" - a row in a new sc_period_locks
--   table with (account_key, period, locked_at) marks the closure.
--   The function body becomes:
--     BEGIN
--       RETURN EXISTS (
--         SELECT 1 FROM sc_period_locks
--         WHERE account_key = p_account_key AND period = p_period
--       );
--     END;
--   No other change needed anywhere. Delete c_grace_days.
CREATE OR REPLACE FUNCTION sc_is_period_closed(
  p_account_key TEXT,
  p_period      TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c_grace_days CONSTANT INT := 3;
  v_max_date DATE;
BEGIN
  SELECT MAX(service_date) INTO v_max_date
  FROM sc_day_metadata
  WHERE account_key = p_account_key
    AND period = p_period;

  IF v_max_date IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN (v_max_date + c_grace_days) < CURRENT_DATE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 5. sc_is_day_locked - the day-level entry point
-- ─────────────────────────────────────────────────────────────────
--
-- Contract:
--   - Returns TRUE when writing to this (account, date) should be
--     refused for a non-SLT caller.
--   - Returns FALSE when the day is currently open.
--
-- Behavior:
--   1. Resolve the day's period from sc_day_metadata for the
--      given (account, date).
--   2. No metadata row OR period IS NULL -> return TRUE.
--      Unknown days fail safe. AP might have already pulled a
--      period this day should have been in; we cannot prove
--      otherwise, and locking is recoverable (SLT overrides).
--      Leaving it open is not - a subsequent write would land
--      after AP has closed the books.
--   3. Otherwise delegate to sc_is_period_closed for the resolved
--      period.
--
-- SLT override does NOT live here. The route handler checks
-- isScAdmin(email) BEFORE calling this function; SLT bypasses
-- the RPC entirely. Keeping the override in application code
-- means the function does not need to know about session identity.
CREATE OR REPLACE FUNCTION sc_is_day_locked(
  p_account_key   TEXT,
  p_service_date  DATE
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period TEXT;
BEGIN
  SELECT period INTO v_period
  FROM sc_day_metadata
  WHERE account_key = p_account_key
    AND service_date = p_service_date
  LIMIT 1;

  IF v_period IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN sc_is_period_closed(p_account_key, v_period);
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 6. Grants
-- ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION sc_is_day_locked(TEXT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION sc_is_period_closed(TEXT, TEXT) TO service_role;

-- Delete grant on sc_daily_actuals is needed for the sc-reset-day
-- action. Preserved for anon/authenticated per the sc-1 pattern.
GRANT DELETE ON sc_daily_actuals TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- Verify (run manually in Studio after apply; not part of the txn):
--
--   SELECT sc_is_period_closed('CIN - AZ', '1');
--     -> TRUE (P1 ended 2026-01-25, well past today + 3-day grace)
--
--   SELECT sc_is_period_closed('CIN - AZ', 'nonexistent-period');
--     -> TRUE (unknown period; fail-safe aligned with sc_is_day_locked)
--
--   SELECT sc_is_day_locked('CIN - AZ', '2026-01-15');
--     -> TRUE (in P1, closed)
--
--   SELECT sc_is_day_locked('CIN - AZ', CURRENT_DATE);
--     -> FALSE (assuming current-period day; P8 as of 2026-08-01)
--
--   SELECT sc_is_day_locked('CIN - AZ', '2029-01-01');
--     -> TRUE (no metadata row; fail safe)
--
--   -- Grace window verification: assume today is 2026-08-13.
--   -- P8 ends 2026-08-09 for CIN - AZ. + 3 grace = 2026-08-12.
--   -- Closed on 2026-08-13 (when 2026-08-12 < CURRENT_DATE).
--   SELECT sc_is_period_closed('CIN - AZ', '8');
--     -> On 2026-08-12: FALSE  (still in grace)
--     -> On 2026-08-13: TRUE   (grace expired the morning of)
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'sc_daily_actuals_history'
--     AND column_name = 'change_type';
--     -> ('change_type', 'text', 'NO')
-- ═══════════════════════════════════════════════════════════════════
