-- ═══════════════════════════════════════════════════════════════════
-- notify-1a: table grants for notification_recipients
-- Hotfix for notify-1 (2026-09-04)
-- ═══════════════════════════════════════════════════════════════════
--
-- notify-1 created notification_recipients + seed + trigger but did
-- NOT explicitly grant service_role table privileges. Default
-- Supabase grants left service_role with REFERENCES + TRIGGER +
-- TRUNCATE only. The Wave 2 code PR's reader
-- (src/lib/notifications/getNotificationRecipients.js) got
-- `permission denied for table notification_recipients` on the
-- first probe run, which is the exact "new table needs an explicit
-- grant" pattern documented in docs/GOTCHAS.md (a migration that
-- creates a table nothing can read is a silent no-op).
--
-- This migration grants the standard app-writer set (SELECT +
-- INSERT + UPDATE + DELETE) to service_role. Matches the pattern
-- every other app-writable table in this codebase uses.
--
-- Owner rulings this codifies:
--
--   Ruling 1 (retroactive): service-role-only writes + reads.
--     The intranet's standing pattern per docs/GOTCHAS.md "A new
--     table needs an explicit grant" + the RLS-disabled-by-design
--     memory. anon + authenticated stay at their default (REFERENCES
--     + TRIGGER only, no data access) so a leaked publishable key
--     cannot touch this config.
--
-- Fences:
--   - Zero data changes. Grant-only.
--   - Additive to service_role, no touches on other roles.
--   - Idempotent: GRANT is a no-op if the privilege already exists.
--
-- TO ROLLBACK:
--   BEGIN;
--   REVOKE SELECT, INSERT, UPDATE, DELETE
--     ON notification_recipients FROM service_role;
--   COMMIT;
--   (After rollback, the code reader will `permission denied` again
--   until reissued.)
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A - preflight (READ-ONLY - inspect current grants)
-- ═══════════════════════════════════════════════════════════════════

-- Query 1: current per-role table privileges on
-- notification_recipients. Expected pre-1a shape:
--   anon           REFERENCES, TRIGGER
--   authenticated  REFERENCES, TRIGGER
--   postgres       DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   service_role   REFERENCES, TRIGGER, TRUNCATE
SELECT
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'notification_recipients'
GROUP BY grantee
ORDER BY grantee;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B - GRANT service_role the app-writer set (BEGIN/COMMIT)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON notification_recipients
  TO service_role;

-- Postflight: assert service_role now has all four privileges.
-- If any is missing, HALT before COMMIT so a partial grant does
-- not land silently.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(need, ', ') INTO missing
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS want(need)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema  = 'public'
      AND table_name    = 'notification_recipients'
      AND grantee       = 'service_role'
      AND privilege_type = want.need
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'notify-1a HALT: service_role still missing privilege(s): %', missing;
  END IF;
  RAISE NOTICE 'notify-1a: service_role now has SELECT + INSERT + UPDATE + DELETE on notification_recipients.';
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C - external verify (READ-ONLY - all SELECTs, safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Query 1: post-1a grants. Expected shape:
--   anon           REFERENCES, TRIGGER
--   authenticated  REFERENCES, TRIGGER
--   postgres       DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   service_role   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--                  (was REFERENCES + TRIGGER + TRUNCATE only)
SELECT
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'notification_recipients'
GROUP BY grantee
ORDER BY grantee;

-- Query 2: negative-space sanity - anon + authenticated must NOT
-- have SELECT / INSERT / UPDATE / DELETE. Expected 0 rows.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema  = 'public'
  AND table_name    = 'notification_recipients'
  AND grantee       IN ('anon', 'authenticated')
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
