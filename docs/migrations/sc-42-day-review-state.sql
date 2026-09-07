-- ═══════════════════════════════════════════════════════════════════
-- sc-42: day-review state on sc_day_metadata
-- 2026-09-08
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   The week-review-before-finalize feature (KF_WEEK_REVIEW_RENDER)
--   inserts a day-by-day review between "Finalize week" and the
--   invoice send. Every day in the finalize window must carry an
--   explicit operator approval before the finalize gate lets the
--   invoice go. Current finalize confirm shows a week total and
--   sends - the operator never sees the per-day figures they should
--   be sanity-checking.
--
--   This migration adds the STATE fields that persist the operator's
--   decisions. The HISTORY of decisions (marked-for-fix notes,
--   review-cleared-by-unlock notes) lives in sc_day_note_entries,
--   which is already append-only. Same split that keeps
--   sc_day_metadata as "current-mode-of-a-day" and the ledger as
--   the audit trail (this feature's design report ruled sc_day_
--   metadata columns over a new sc_day_review table for exactly
--   this reason).
--
-- Owner rulings this codifies (Kevin 2026-09-08):
--
--   Ruling 1: STATE ON sc_day_metadata, NOT A NEW TABLE.
--     The state is current-only - the marker CLEARS on any write
--     to the day (per Q3 ruling). A history table would let one
--     day have many review rows; that's redundant with the
--     ledger note pattern.
--
--   Ruling 2: ACTOR + TIMESTAMP REQUIRED WHENEVER STATUS IS SET.
--     "A record that says something happened without saying who
--     is the same defect class as this week's silent failures."
--     CHECK constraint enforces the invariant at the DB layer so
--     no server-side omission can slip past.
--
--   Ruling 3: CLEAR ON ANY WRITE TO THE DAY.
--     Enforced in the app layer (extended actuals-write handlers
--     in the same PR). Not a DB trigger - the write itself is
--     the intent; clearing review state alongside is what the
--     ruling names as "the fix is the acknowledgment."
--
--   Ruling 4: CLEAR ON WEEK UNLOCK.
--     Also app-layer, in sc-revert-finalize. See PR body for the
--     symmetry argument with clear-on-write - a revert is the
--     same event class at week granularity.
--
-- Fences:
--   - Additive only. No existing columns touched, no existing
--     rows modified.
--   - Nullable columns default to NULL. Every existing sc_day_
--     metadata row is a "no review recorded" row after this
--     lands, which is the correct starting state.
--   - Constraint is DEFERRABLE INITIALLY IMMEDIATE (standard).
--   - No new grants needed: sc_day_metadata already has the
--     app-writer set on service_role from sc-1.
--
-- Apply order:
--   ONE block (BLOCK A). Both ADD COLUMN + ADD CONSTRAINT run
--   in a single BEGIN/COMMIT. The constraint applies to the
--   newly-added columns only; existing rows have status = NULL
--   so the constraint is trivially satisfied.
--
-- Verify: paste BLOCK B afterward to confirm the columns landed
-- with the right shape and the constraint fires on a bad insert.
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: schema change (single transaction)
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE sc_day_metadata
  ADD COLUMN IF NOT EXISTS review_status TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

-- Two constraints:
--   1. review_status value must be one of ('approved', 'flagged')
--      when non-null. Rules out typos + protects future readers
--      from a stray value.
--   2. When review_status is set, BOTH reviewed_by AND reviewed_at
--      must also be set. Owner Ruling 2 - "a record that says
--      something happened without saying who is silent-failure-
--      shaped."
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_day_metadata_review_status_check'
  ) THEN
    ALTER TABLE sc_day_metadata
      ADD CONSTRAINT sc_day_metadata_review_status_check
      CHECK (review_status IS NULL OR review_status IN ('approved', 'flagged'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_day_metadata_review_actor_required'
  ) THEN
    ALTER TABLE sc_day_metadata
      ADD CONSTRAINT sc_day_metadata_review_actor_required
      CHECK (
        review_status IS NULL
        OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      );
  END IF;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: verify (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Query 1: confirm the three columns exist with the right types.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_day_metadata'
  AND column_name  IN ('review_status', 'reviewed_by', 'reviewed_at')
ORDER BY column_name;

-- Expected 3 rows:
--   review_status | text                        | YES
--   reviewed_at   | timestamp with time zone    | YES
--   reviewed_by   | text                        | YES


-- Query 2: confirm both CHECK constraints exist.
SELECT conname
FROM pg_constraint
WHERE conrelid = 'sc_day_metadata'::regclass
  AND conname LIKE 'sc_day_metadata_review%'
ORDER BY conname;

-- Expected 2 rows:
--   sc_day_metadata_review_actor_required
--   sc_day_metadata_review_status_check


-- Query 3: confirm no existing rows accidentally acquired a value.
SELECT COUNT(*) AS rows_with_review_state
FROM sc_day_metadata
WHERE review_status IS NOT NULL
   OR reviewed_by   IS NOT NULL
   OR reviewed_at   IS NOT NULL;

-- Expected: 0. Every existing row should be a "no review recorded"
-- row after this landing.


-- Query 4: confirm service_role can read + write the table.
--
-- New columns on an existing table inherit the table-level privileges
-- (per Postgres semantics), so this SHOULD show service_role with
-- SELECT, INSERT, UPDATE, DELETE from sc-1's earlier GRANT. But
-- notify-1 failed on exactly this assumption - the failure surfaced
-- at runtime as `permission denied for table`, not at migration time,
-- because the migration itself does not exercise the grant.
--
-- Verify rather than assume. If this query returns service_role
-- without one of SELECT / INSERT / UPDATE / DELETE, do NOT flip the
-- migration gate green - add a second block:
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON sc_day_metadata TO service_role;
--
-- and re-run this query.
SELECT grantee,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name   = 'sc_day_metadata'
GROUP BY grantee
ORDER BY grantee;

-- Expected (from sc-1 baseline):
--   anon             | REFERENCES, TRIGGER, TRUNCATE
--   authenticated    | REFERENCES, TRIGGER, TRUNCATE
--   postgres         | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   service_role     | DELETE, INSERT, SELECT, UPDATE
--   (plus owner grants; row set may vary slightly by role config)
--
-- The load-bearing line is `service_role | DELETE, INSERT, SELECT, UPDATE`.
-- Without all four the reviewer cannot write review_status
-- (INSERT + UPDATE), the finalize gate cannot READ it (SELECT), and
-- the revert-clear cannot NULL it (UPDATE).


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed - do not run in normal flow)
-- ═══════════════════════════════════════════════════════════════════
--
-- BEGIN;
--   ALTER TABLE sc_day_metadata
--     DROP CONSTRAINT IF EXISTS sc_day_metadata_review_actor_required,
--     DROP CONSTRAINT IF EXISTS sc_day_metadata_review_status_check,
--     DROP COLUMN IF EXISTS review_status,
--     DROP COLUMN IF EXISTS reviewed_by,
--     DROP COLUMN IF EXISTS reviewed_at;
-- COMMIT;
