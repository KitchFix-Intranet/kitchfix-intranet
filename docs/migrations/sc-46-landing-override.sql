-- ═══════════════════════════════════════════════════════════════════
-- sc-46-landing-override
--
-- Per-email landing override for SC. Pre-training punch list item 2
-- (Kevin ruling 2026-09-17). Lets an RDO whose people.account_key is
-- CORP land on a specific operational account without mutating the
-- Rippling-sourced people row (which drives payroll + org chart).
--
-- BACKGROUND
-- Today the SC's default landing account resolves via
-- user_accounts_derived, a UNION of people ACTIVE rows and the
-- user_accounts_manual overlay. Both sources emit one row per email
-- and both key on account_key. For a CORP user (Ryan Moore, Shane
-- Lynch) the derived row is CORP - which is not a real operational
-- account. Opening SC lands them on nothing useful.
--
-- WHY OPTION 3 (this shape) INSTEAD OF THE ALTERNATIVES
--   Option 1 - flip people.account_key to CIN-AZ / TBJ-FL. Rejected
--     by Kevin: payroll and org-chart derivation read that field
--     and would incorrectly classify Ryan as a TXR employee and
--     Shane as a TBJ employee.
--   Option 2 - user_accounts_manual overlay row per RDO. Rejected:
--     conflicts with the overlay's own semantics ("no Rippling
--     worker record" reason), and the overlay UNION would still
--     duplicate the derived CORP row.
--   Option 3 - a dedicated per-email override table read at
--     landing-resolution time. Kevin ruling 2026-09-17: "an explicit
--     row exists because someone decided it, and a derived default
--     should never beat a deliberate choice." Override wins.
--
-- CONSUMERS
-- Exactly one read site: src/app/api/service-calendar/route.js
-- sc-accounts handler (around line 420-448). Reads override in
-- parallel with the existing user_accounts_derived + contacts
-- queries. When override hits, uses its account_key as
-- defaultAccount. When absent, falls back to
-- user_accounts_derived.account as today.
--
-- CASE INVARIANT (Kevin ruling 2026-09-17, follow-up on v1)
-- v1 paired a case-sensitive TEXT PK with an ILIKE handler read.
-- That would silently accept R.Moore@ and r.moore@ as separate
-- rows AND match both on read, returning an arbitrary one at
-- landing time - the silent-failure shape recent PRs have been
-- full of. Fix: normalize on write, match exactly on read.
--   1. CHECK (email = lower(email)) enforces the invariant at the
--      DB layer. Impossible to insert R.Moore@ even from Studio.
--   2. Seed values are lowercase.
--   3. The handler lookup uses .eq() on lowercased input, not
--      .ilike(). See the sc-46 code change in the same PR.
-- One canonical form, one row, deterministic. The other tables
-- that use ILIKE (user_accounts_derived, contacts) do so precisely
-- because they lack this guarantee across their union sources.
--
-- SEED
-- Two rows for the two RDOs. Email + account_key + reason confirmed
-- by 2026-09-17 probe: both are people ACTIVE, CORP, salaried,
-- titled "Regional Director of Operations - West" (Ryan) and
-- "Regional Director of Operations - East" (Shane).
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B guards against re-inserts on (email).
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the table does NOT exist yet (pre-apply state).
-- Expected: zero rows.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'sc_landing_override';

-- Confirm the two seed emails exist as people ACTIVE and are keyed
-- to CORP today. If either returns zero rows, DO NOT apply -
-- something about the seed inputs has drifted since 2026-09-17.
SELECT display_name, work_email, account_key, status, title
FROM people
WHERE work_email IN ('r.moore@kitchfix.com', 's.lynch@kitchfix.com')
  AND status = 'ACTIVE';

-- Confirm CIN - AZ and TBJ - FL exist in accounts (the FK targets).
SELECT team_key
FROM accounts
WHERE team_key IN ('CIN - AZ', 'TBJ - FL')
ORDER BY team_key;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS sc_landing_override (
  email        TEXT NOT NULL PRIMARY KEY
               CHECK (email = lower(email)),
  account_key  TEXT NOT NULL REFERENCES accounts(team_key),
  reason       TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by     TEXT NOT NULL
);

COMMENT ON TABLE sc_landing_override IS
  'Per-email SC landing account override. Read by the sc-accounts handler; when an email has a row here, its account_key wins over user_accounts_derived for defaultAccount resolution. Used for RDOs whose people.account_key is CORP but who should land on an operational account. sc-46 (2026-09-17).';

COMMENT ON COLUMN sc_landing_override.email IS
  'Canonical lower-case only, enforced by CHECK (email = lower(email)). The sc-accounts handler reads with .eq() on lowercased input, not .ilike() - one casing, one row, deterministic. Studio inserts must supply lower(email).';

COMMENT ON COLUMN sc_landing_override.reason IS
  'Human note (never displayed) explaining why this override exists. Studio-maintained.';

-- Seed. ON CONFLICT DO NOTHING so a re-apply is a no-op if Kevin
-- has edited these rows in Studio after the initial insert.
INSERT INTO sc_landing_override (email, account_key, reason, added_by) VALUES
  ('r.moore@kitchfix.com', 'CIN - AZ', 'RDO - West region; CORP in people, needs operational landing', 'kevin@sc-46-seed-2026-09-17'),
  ('s.lynch@kitchfix.com', 'TBJ - FL', 'RDO - East region; CORP in people, needs operational landing', 'kevin@sc-46-seed-2026-09-17')
ON CONFLICT (email) DO NOTHING;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the table exists with the expected shape.
-- Expected: one row for each column, PK on email, FK on account_key.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_landing_override'
ORDER BY ordinal_position;

-- Confirm the lowercase CHECK constraint exists. Expected: one row,
-- constraint_name ending in _check or matching sc_landing_override_
-- email_check depending on the deferred-name policy.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'sc_landing_override'::regclass
  AND contype  = 'c'
ORDER BY conname;

-- Confirm the two seed rows landed with the correct account_key
-- AND satisfy the lowercase invariant (email = lower(email)).
-- Expected:
--   r.moore@kitchfix.com -> CIN - AZ
--   s.lynch@kitchfix.com -> TBJ - FL
--   both rows: email_is_lower = true
SELECT email, account_key, reason, added_by,
       (email = lower(email)) AS email_is_lower
FROM sc_landing_override
ORDER BY email;

-- Rows Kevin will add later (via Studio) look like:
--   INSERT INTO sc_landing_override (email, account_key, reason, added_by)
--   VALUES (lower('some.email@kitchfix.com'), 'ACCOUNT - KEY',
--           'human reason', 'kevin@studio-YYYY-MM-DD')
--   ON CONFLICT (email) DO UPDATE
--     SET account_key = EXCLUDED.account_key,
--         reason      = EXCLUDED.reason,
--         added_by    = EXCLUDED.added_by,
--         added_at    = now();
--
-- The lower() wrap on the literal is belt-and-suspenders; the CHECK
-- constraint would reject any non-lowercase value with a hard error
-- naming the row. Studio-typed emails should be lowercase already.
