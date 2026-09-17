-- ═══════════════════════════════════════════════════════════════════
-- 2026-09-17-drop-redundant-user-accounts-manual-overlays
--
-- Two of three rows in user_accounts_manual are now redundant. The
-- third stays and is load-bearing.
--
-- BACKGROUND
-- user_accounts_manual is the owner overlay UNIONed into
-- user_accounts_derived alongside people ACTIVE rows (see
-- docs/migrations/user-accounts-derived.sql). Three rows were seeded
-- on 2026-08-27 when the derived view cut over. At the time, none of
-- the three had Rippling worker records, so the overlay carried them.
-- Rippling has since caught up for two of the three.
--
-- CURRENT STATE (2026-09-17 probe)
--   joe@kitchfix.com          - people ACTIVE, salaried, CORP,
--                               VP of Operations, worker_id
--                               5c13e30129624856a64d4fa6.
--                               OVERLAY REDUNDANT - drop.
--   m.chavez@kitchfix.com     - people ACTIVE, salaried, CORP,
--                               People Operations Generalist,
--                               worker_id 6418ccb4b0d92d9fe4f6d77b.
--                               OVERLAY REDUNDANT - drop.
--   k.fietek@kitchfix.com     - founder, no Rippling worker record.
--                               people has no row for this email.
--                               OVERLAY LOAD-BEARING - keep. Without
--                               it, Kevin's user_accounts_derived
--                               row disappears and the intranet
--                               denies him a default landing account.
--
-- WHY DROP
-- Kevin ruling 2026-09-17: a stale overlay is a second source of
-- truth. Once Rippling carries the person, the overlay is at best
-- redundant and at worst a source of drift when the Rippling record
-- changes (e.g. status TERMINATED) while the overlay row lingers.
-- Keep only the truly-necessary founder row.
--
-- SAFETY
-- After this apply, user_accounts_derived resolves joe@ and
-- m.chavez@ via the people-ACTIVE arm of the UNION - identical
-- (email, account) tuples emit for both. The intranet cannot tell
-- the difference. If either worker's Rippling record ever goes
-- TERMINATED, the derived row disappears - which is the correct
-- behavior; if that happens, the fix is either to re-add the
-- overlay row explicitly OR to correct Rippling.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B is a no-op after the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected pre-fix contents (three rows, all added 2026-08-27):
--   joe@kitchfix.com          overlay, redundant  (to drop)
--   k.fietek@kitchfix.com     overlay, load-bearing (KEEP)
--   m.chavez@kitchfix.com     overlay, redundant  (to drop)
SELECT email, account, reason, added_at, added_by
FROM user_accounts_manual
ORDER BY email;

-- Confirm the two rows being dropped are truly redundant - each
-- must have an ACTIVE people row keyed on the same email. If either
-- assertion returns zero rows, DO NOT proceed with block B.
SELECT email, account_key, status, is_salaried, title
FROM people
WHERE work_email IN ('joe@kitchfix.com', 'm.chavez@kitchfix.com')
  AND status = 'ACTIVE';

-- Confirm k.fietek@ is NOT in people (that is why the overlay
-- stays). Expected: zero rows.
SELECT work_email, status
FROM people
WHERE work_email = 'k.fietek@kitchfix.com';


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════
--
-- Each DELETE guards on both the email AND the 2026-08-27 seeded
-- reason so a re-run cannot remove a row someone re-added later
-- under a different rationale. Explicit email list per row (no
-- IN(...) shortcut) so the diff makes both drops individually
-- visible in review.
BEGIN;

DELETE FROM user_accounts_manual
 WHERE email  = 'joe@kitchfix.com'
   AND reason = 'owner-level access, no Rippling worker record';

DELETE FROM user_accounts_manual
 WHERE email  = 'm.chavez@kitchfix.com'
   AND reason = 'owner-level access, no Rippling worker record';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Expected post-fix contents (one row):
--   k.fietek@kitchfix.com     founder, no Rippling worker record
SELECT email, account, reason, added_at, added_by
FROM user_accounts_manual
ORDER BY email;

-- Confirm joe@ and m.chavez@ still resolve through the derived
-- view via the people-ACTIVE arm of the UNION. Expected: two
-- rows, both mapped to CORP.
SELECT email, account
FROM user_accounts_derived
WHERE email IN ('joe@kitchfix.com', 'm.chavez@kitchfix.com')
ORDER BY email;

-- Confirm k.fietek@ still resolves through the overlay arm.
-- Expected: one row, CORP.
SELECT email, account
FROM user_accounts_derived
WHERE email = 'k.fietek@kitchfix.com';
