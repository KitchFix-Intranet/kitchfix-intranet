-- user-accounts-derived.sql
--
-- 2026-08-27 owner ruling. Dashboard access must follow Rippling
-- automatically. The current `user_accounts` table is hand-maintained
-- and drifting - as of this migration, Grant Lawson has been
-- TERMINATED for 46 days and still holds access to TXR - TX - H;
-- Claire Parry has been an ACTIVE Performance Chef at TBJ - FL for
-- 17 days and has no access.
--
-- #863 fixed the roster - `people` updates nightly from Rippling.
-- This migration builds the derived access surface on top of it.
-- The old `user_accounts` table stays in place until owner has seen
-- the diff live and cut the read site over. Removing an access
-- table is not reversible on a Friday.
--
-- ─── Design ─────────────────────────────────────────────────────────
--
-- SHAPE = view (not a table, not a nightly job).
--
-- A view because:
--   1. Live. Reads always current with people. No cron to fail; no
--      stale-directory defect one table over (see #863 note on
--      Derive people decoupling).
--   2. Cheap. `people` is ~1,100 rows; filtered output is ~35 rows.
--      The one read site (src/app/api/service-calendar/route.js:408)
--      queries by email once per session. Sub-millisecond.
--   3. No new schedule to break. If perf ever matters, materialize
--      later.
--
-- CASE-INSENSITIVE MATCHING. The current read site uses
-- `ilike("email", email)`. A user with mixed-case input still matches
-- a lowercase stored email. The view returns emails in whatever case
-- `people` stores them (typically lowercase from Rippling). Readers
-- keep `ilike`. Behaviour identical to today.
--
-- MANUAL OVERLAY. A separate table `user_accounts_manual` for
-- owner-level access that will never come from Rippling. Explicit
-- reason column so someone in a year sees why three rows are
-- hand-held. Additive, obvious, greppable. Not a flag buried on
-- people (owner ruling).
--
-- The view UNIONs from both. The manual overlay's NOT EXISTS clause
-- guards against a manual row shadowing a person who later gets
-- added to Rippling - the Rippling row wins in that case.
--
-- ─── The view ───────────────────────────────────────────────────────

-- Manual overlay table. Three known owner-level emails seeded below.
CREATE TABLE IF NOT EXISTS user_accounts_manual (
  email       TEXT PRIMARY KEY,
  account     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by    TEXT
);

COMMENT ON TABLE user_accounts_manual IS
  'Owner-level access overlay for emails without a Rippling worker record. Every row must carry a reason column. Any row that duplicates an ACTIVE people.work_email is silently ignored by user_accounts_derived - the Rippling row wins.';

-- Seed the three known owner-level emails. INSERT ... ON CONFLICT
-- DO NOTHING so re-applying this migration is idempotent. The
-- reason column is populated on every row so someone in a year
-- sees why the three are hand-held without having to ask (owner
-- rule 2026-08-27).
INSERT INTO user_accounts_manual (email, account, reason, added_by) VALUES
  ('joe@kitchfix.com',      'CORP', 'owner-level access, no Rippling worker record', 'kevin@migration'),
  ('k.fietek@kitchfix.com', 'CORP', 'founder, no Rippling worker record',             'kevin@migration'),
  ('m.chavez@kitchfix.com', 'CORP', 'owner-level access, no Rippling worker record', 'kevin@migration')
ON CONFLICT (email) DO NOTHING;

-- The derived view. Two sources:
--   1. Every ACTIVE person in people with a work_email and an
--      account_key. Filter ACTIVE picks the current spell of a
--      seasonal rehire and drops the terminated ones automatically -
--      worker_id is per spell, email is the person key.
--   2. Every row in user_accounts_manual whose email is NOT already
--      covered by (1). Case-insensitive comparison via lower() so a
--      manual row for `k.fietek@kitchfix.com` is correctly shadowed
--      by an ACTIVE `K.Fietek@kitchfix.com` if Rippling ever adds
--      the person.
--
-- UNION (not UNION ALL) - dedupes by (email, account). Rehires
-- processed before their prior spell is terminated in Rippling
-- would otherwise produce two ACTIVE rows for one email; the read
-- site's ilike behaviour on two rows is unknown. Cost is nothing
-- at ~35 rows.
CREATE OR REPLACE VIEW user_accounts_derived AS
  SELECT
    work_email AS email,
    account_key AS account
  FROM people
  WHERE status = 'ACTIVE'
    AND work_email IS NOT NULL
    AND account_key IS NOT NULL
  UNION
  SELECT
    m.email,
    m.account
  FROM user_accounts_manual m
  WHERE NOT EXISTS (
    SELECT 1 FROM people p
    WHERE p.status = 'ACTIVE'
      AND p.work_email IS NOT NULL
      AND LOWER(p.work_email) = LOWER(m.email)
  );

COMMENT ON VIEW user_accounts_derived IS
  'Derived access surface. UNION of ACTIVE people (work_email + account_key) and user_accounts_manual (owner-level overlay). Replaces the hand-maintained user_accounts table. Read via ilike("email", $input) to preserve case-insensitive matching (unchanged from current call site at src/app/api/service-calendar/route.js:408).';

-- ─── Grants ─────────────────────────────────────────────────────────
-- The Next.js API layer connects as service_role. Without these
-- grants, every read after the migration would fail with permission
-- denied. Every comparable object in this schema (user_accounts,
-- labor_actuals_latest, v_purchasing_actuals_billcom_named) carries
-- the equivalent; matching that convention is what keeps the app
-- from breaking silently at deploy time.
GRANT SELECT ON public.user_accounts_derived TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_accounts_manual TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
-- Runs after every apply. Fails the migration loud if:
--   - the view or manual table is missing
--   - seed rows did not land
--   - service_role cannot read the view or manage the manual table
--
-- The grant checks are the important half. Object-existence checks
-- confirm the objects were created; they do NOT confirm anything
-- can read them. A guard that passes while the thing it guards is
-- broken is exactly the class of defect we have hit repeatedly
-- this week (Rippling-sync path fix's dropped grant analogue,
-- guards-need-coverage etc). Belt AND suspenders.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_accounts_manual') THEN
    RAISE EXCEPTION 'post-flight: user_accounts_manual table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_accounts_derived') THEN
    RAISE EXCEPTION 'post-flight: user_accounts_derived view missing';
  END IF;
  IF (SELECT COUNT(*) FROM user_accounts_manual) < 3 THEN
    RAISE EXCEPTION 'post-flight: user_accounts_manual has fewer than 3 seed rows';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_accounts_derived', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on user_accounts_derived';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_accounts_manual', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on user_accounts_manual';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_accounts_manual', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on user_accounts_manual';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_accounts_manual', 'UPDATE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing UPDATE on user_accounts_manual';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.user_accounts_manual', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing DELETE on user_accounts_manual';
  END IF;
END $$;
