-- user-accounts-table-drop.sql
--
-- 2026-08-28. Drops the hand-maintained `user_accounts` table now that
-- `user_accounts_derived` (view over `people` ACTIVE rows + the
-- `user_accounts_manual` overlay) has been the read source in production
-- since 2026-08-27 (see `user-accounts-derived.sql` and #866).
--
-- Owner verified live 2026-08-28 before this drop was drafted:
--   35 rows in the derived view
--   g.lawson@ absent (terminated, correctly dropped from access)
--   c.parry@ present at TBJ - FL (active, correctly gained access)
--   K.GILMAN@KitchFix.com mixed-case resolves to TBJ - NY
--   3 seasonal rehires retained
--   3 CORP overlay rows present (from user_accounts_manual)
--
-- What stays:
--   user_accounts_derived  the view - unchanged
--   user_accounts_manual   the owner overlay - unchanged, still writable
--   people                 the Rippling-sourced roster
--
-- What goes:
--   user_accounts          the hand-maintained table this replaces
--
-- Blast radius:
--   Zero live code reads or writes user_accounts. Final grep 2026-08-28
--   confirmed the only production read site
--   (src/app/api/service-calendar/route.js) already reads
--   user_accounts_derived. Probes reference user_accounts in historical
--   comments (drift-audit context in _probe_rehire_double_count_canary.mjs);
--   no runtime dependency.
--
--   docs/migrations/salary-1c-kpi-roles.sql references user_accounts
--   in its pre-flight and site-rows seed. That migration ALREADY RAN
--   in production - the reference is historical. A fresh-env re-run of
--   migrations in order would fail at salary-1c's pre-flight; that is
--   not a supported operation today. Noted here for the record.
--
-- Reversibility:
--   The drop is IF EXISTS + no CASCADE. If a dependency shows up that
--   the pre-flight missed, the migration fails cleanly without dropping.
--   To recover the hand-maintained rows: they live in git history at
--   docs/migrations/sc-3-user-accounts-seed.sql (2026 seed) and the
--   derived view now covers every ACTIVE Rippling worker automatically.
--   If a specific historical email needs the old access back, add it to
--   user_accounts_manual with a reason column.

-- ─── Pre-flight ─────────────────────────────────────────────────────
-- Never drop the old table without confirming the replacement is live
-- AND populated AND readable by the app. Every check that would have
-- caught a swap-and-forget defect goes here, not in a runbook.
DO $$
DECLARE
  derived_count INT;
BEGIN
  -- 1. user_accounts exists (idempotent guard: re-running after drop
  --    should succeed as a no-op).
  IF to_regclass('public.user_accounts') IS NULL THEN
    RAISE NOTICE 'user_accounts already dropped - migration is a no-op';
    RETURN;
  END IF;

  -- 2. Replacement view exists.
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_accounts_derived') THEN
    RAISE EXCEPTION 'pre-flight: user_accounts_derived view missing - cannot drop old table without a live replacement';
  END IF;

  -- 3. Manual overlay table exists (the view UNIONs it).
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_accounts_manual') THEN
    RAISE EXCEPTION 'pre-flight: user_accounts_manual overlay missing - view would be incomplete';
  END IF;

  -- 4. Derived view is actually populated. Owner-verified 35 rows on
  --    2026-08-28; require at least 20 as the lower bound the pre-flight
  --    should enforce (an empty view would silently deny everyone).
  SELECT COUNT(*) INTO derived_count FROM user_accounts_derived;
  IF derived_count < 20 THEN
    RAISE EXCEPTION 'pre-flight: user_accounts_derived has only % rows - refusing to drop legacy table with an under-populated replacement', derived_count;
  END IF;

  -- 5. service_role can read the view. A grant that lapsed silently
  --    would strand the app on deploy.
  IF NOT has_table_privilege('service_role', 'public.user_accounts_derived', 'SELECT') THEN
    RAISE EXCEPTION 'pre-flight: service_role missing SELECT on user_accounts_derived - dropping the old table would break the app';
  END IF;

  -- 6. service_role can manage the manual overlay (writes to it are
  --    the ONLY way to add non-Rippling access post-drop).
  IF NOT has_table_privilege('service_role', 'public.user_accounts_manual', 'INSERT') THEN
    RAISE EXCEPTION 'pre-flight: service_role missing INSERT on user_accounts_manual - post-drop overlay would be read-only';
  END IF;

  -- 7. No foreign keys point at user_accounts. If any exist, CASCADE
  --    would drop dependents silently - refuse and let owner review.
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'user_accounts'
  ) THEN
    RAISE EXCEPTION 'pre-flight: user_accounts has inbound foreign keys - review before dropping';
  END IF;

  -- 8. No views depend on user_accounts (would fail silently on DROP
  --    without CASCADE, but the resulting error message is opaque).
  IF EXISTS (
    SELECT 1 FROM information_schema.view_table_usage
    WHERE table_name = 'user_accounts'
  ) THEN
    RAISE EXCEPTION 'pre-flight: user_accounts is referenced by at least one view - review before dropping';
  END IF;
END $$;

-- ─── The drop ───────────────────────────────────────────────────────
-- IF EXISTS so re-running is safe (post-flight is authoritative on
-- absence). No CASCADE - if a dependency shows up the pre-flight
-- missed, this fails loud and nothing gets destroyed.
DROP TABLE IF EXISTS public.user_accounts;

-- ─── Post-flight ────────────────────────────────────────────────────
-- Assert what stayed AND what left. Every claim the migration makes
-- (drop happened; view still works; overlay still writable) gets a
-- check that would have caught it going wrong. Same discipline as
-- the derived-view migration's post-flight (guards need coverage).
DO $$
DECLARE
  derived_count INT;
BEGIN
  -- 1. user_accounts is gone.
  IF to_regclass('public.user_accounts') IS NOT NULL THEN
    RAISE EXCEPTION 'post-flight: user_accounts still exists after DROP';
  END IF;

  -- 2. The view still exists and still returns rows (regression check
  --    against a "drop rewrote a dependent view" scenario).
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_accounts_derived') THEN
    RAISE EXCEPTION 'post-flight: user_accounts_derived view is missing';
  END IF;
  SELECT COUNT(*) INTO derived_count FROM user_accounts_derived;
  IF derived_count < 20 THEN
    RAISE EXCEPTION 'post-flight: user_accounts_derived returned % rows - drop appears to have affected the replacement', derived_count;
  END IF;

  -- 3. Manual overlay untouched.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_accounts_manual') THEN
    RAISE EXCEPTION 'post-flight: user_accounts_manual is missing';
  END IF;
  IF (SELECT COUNT(*) FROM user_accounts_manual) < 3 THEN
    RAISE EXCEPTION 'post-flight: user_accounts_manual has fewer than 3 rows - overlay may have been affected';
  END IF;

  -- 4. Grants still resolve for service_role. Same shape as the
  --    derived-view migration's post-flight (belt AND suspenders).
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
