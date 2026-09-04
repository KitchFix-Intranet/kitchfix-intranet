-- ═══════════════════════════════════════════════════════════════════
-- notify-1: notification_recipients table + backfill from Sheets
-- Wave 2 of the Sheets-retirement sequence.
-- 2026-09-03
-- ═══════════════════════════════════════════════════════════════════
--
-- Purpose:
--   Retire the HUB / notifications Sheets tab that people/route.js:88
--   reads via `getNotificationRecipients(actionKey)`. The Sheets read
--   silently returns [] on ANY error (Sheets API quota, transient
--   network, permissions change), which drops admin recipients from
--   the admin pipeline in notify() at people/route.js:337. On
--   2026-09-03 a Sheets read-quota error caused a real PAF submission
--   (TITLE_CHANGE, Anna Hughes, TXR - AZ) to notify Slack but silently
--   drop the email to Kevin + Mariela who were the configured admins.
--   Postgres does not have per-minute read quotas.
--
--   This migration creates the notification_recipients table + seeds
--   it from the current Sheets tab. Application repoint to
--   this table is a follow-on code PR that ships alongside the
--   migration confirmation (per migration-gated-PR discipline).
--
-- Owner rulings this codifies (Kevin 2026-09-03):
--
--   Ruling 1: LEGITIMATE-EMPTY vs READ-FAILURE ARE DIFFERENT SIGNALS.
--     Zero rows for an action_key is a legitimate config state
--     (nobody wants an email for that action). A read error is a
--     bug. The reader-side must throw on error and return [] only
--     for genuinely empty configs. This survives the migration -
--     the defect that caused the 2026-09-03 outage must not
--     survive the fix.
--
--   Ruling 2: SIMPLE ROW-PER-RECIPIENT SHAPE, NOT SLOT-BASED.
--     The Sheets tab used 4 (enabled, csv-emails) slot pairs per
--     row - an artifact of Sheets' fixed-column layout. Postgres
--     has no such constraint. One row per (action_key, email) is
--     natural, unique-constrainable, and lets adding a recipient
--     be an INSERT rather than a slot search.
--
--   Ruling 3: BACKFILL FROM CURRENT SHEETS TAB (dedupe TBD).
--     Preserve current config verbatim except for the duplicate
--     k.fietek@ entries on 7 action_keys (added twice in slots 3
--     and 4). Dedupe silently on INSERT (the UNIQUE constraint
--     enforces this at the DB level).
--
--   Ruling 4: SHEETS TAB STAYS IN PLACE AS FALLBACK REFERENCE.
--     Do not delete or archive the Sheets tab in this migration.
--     Retirement is a later PR after a few PAFs have landed
--     correctly against the new PG-backed path.
--
--   Ruling 5: THIS IS AN ADMIN CONFIG TABLE, NOT USER DATA.
--     Small (13 rows today), read-often on every notification,
--     written rarely. No RLS needed - service-role-only per the
--     intranet's standing pattern.
--
--   Ruling 6: READER MUST DISTINGUISH UNKNOWN-KEY FROM EMPTY-CONFIG.
--     A new PAF action_key added in code without a matching seed
--     here would return zero rows from the recipients query, and
--     silently skip the admin pipeline - the exact failure this
--     migration is meant to eliminate, reappearing in a new form.
--     The repointed getNotificationRecipients() MUST check whether
--     the action_key has ANY row (enabled or not) before treating
--     an empty enabled-set as legitimate. Unknown key -> log.warn
--     naming the key. Does not need to throw, but must not be
--     silent. This is a reader-side contract, not a schema
--     constraint - documented here so the schema's shape assumes
--     it. See the code PR for the reader's implementation.
--
-- Fences:
--   - Zero touches on any other table.
--   - Zero touches on any existing PG data. Additive.
--   - Sheets tab NOT deleted. Both stores populated after apply;
--     the reader code chooses which to consult (post-apply code PR
--     will point at PG).
--
-- Apply order (Studio batch-parse-gotcha safe):
--   THREE separate paste-and-run blocks.
--     BLOCK A - preflight (schema + parity SELECTs, read first)
--     BLOCK B - CREATE TABLE + seed inserts (BEGIN/COMMIT)
--     BLOCK C - external verify (SELECTs, read last)
--
-- TO ROLLBACK:
--   BEGIN;
--   DROP TABLE IF EXISTS notification_recipients;
--   DROP FUNCTION IF EXISTS notification_recipients_touch();
--   COMMIT;
--   (DROP TABLE cascades to the trigger; the function is a separate
--   object and survives table drop, so drop it explicitly. No data
--   anywhere else depends on this table pre-code-PR.)
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A - preflight (standalone SELECTs, paste + read first)
-- ═══════════════════════════════════════════════════════════════════
--
-- Query 1: confirm notification_recipients does NOT already exist.
--          (0 rows expected)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'notification_recipients';

-- Query 2: cross-check for any existing table that could conflict
--          with the intended name. (0 rows expected)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   IN ('notification_recipients', 'notifications');


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B - schema + seed (BEGIN/COMMIT; paste + run only after
--                          BLOCK A confirms table does not exist)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Schema ─────────────────────────────────────────────────────
CREATE TABLE notification_recipients (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key   text        NOT NULL,
  email        text        NOT NULL,
  enabled      boolean     NOT NULL DEFAULT TRUE,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  created_by   text,
  notes        text,

  -- One row per (action_key, email). Prevents the double-k.fietek
  -- pattern the Sheets tab currently carries on 7 action_keys.
  -- If the same email appears twice in the seed, only the first
  -- INSERT lands; the second raises 23505 and the whole txn aborts.
  -- Handled below by the ON CONFLICT DO NOTHING clause.
  CONSTRAINT notification_recipients_action_email_uniq
    UNIQUE (action_key, email),

  -- Basic sanity: reject empty strings + non-email-shaped values.
  CONSTRAINT notification_recipients_email_shape
    CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  CONSTRAINT notification_recipients_action_key_nonempty
    CHECK (length(trim(action_key)) > 0)
);

-- Index for the reader query `WHERE action_key = $1 AND enabled = TRUE`
CREATE INDEX notification_recipients_action_key_enabled_idx
  ON notification_recipients (action_key, enabled);

-- ─── updated_at touch trigger ────────────────────────────────────
-- Without this, updated_at defaults to NOW() on INSERT and never
-- moves - a timestamp that silently never changes is a small
-- instance of the "signal that cannot fail" pattern this repo has
-- been hunting. Same shape as sc-30b's sc_week_finalize_touch
-- (idempotent CREATE OR REPLACE + DROP IF EXISTS + CREATE).
CREATE OR REPLACE FUNCTION notification_recipients_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_recipients_touch_trigger
  ON notification_recipients;
CREATE TRIGGER notification_recipients_touch_trigger
  BEFORE UPDATE ON notification_recipients
  FOR EACH ROW
  EXECUTE FUNCTION notification_recipients_touch();

GRANT EXECUTE ON FUNCTION notification_recipients_touch() TO service_role;

COMMENT ON TABLE notification_recipients IS
  'Wave 2 of Sheets retirement (2026-09-03). Replaces HUB / notifications tab. Reader lives at src/app/api/people/route.js getNotificationRecipients. One row per (action_key, email). UNIQUE constraint enforces the dedupe the Sheets pipeline was doing silently in code. Service-role only; no RLS (matches standing intranet pattern for admin config).';

COMMENT ON COLUMN notification_recipients.action_key IS
  'Matches the form action type submitted via people/route.js:1010 notify(). Known keys at seed time: separation, reclassification, rate_change, title_change, status_change, add_gratuity, add_deduction, add_cell_phone, add_bonus, travel_reimbursement, other_reimbursement, new_hire, help_request_hr. New action types added by writing new rows.';

COMMENT ON COLUMN notification_recipients.enabled IS
  'FALSE means the recipient is on file but not receiving today. Reader query filters WHERE enabled = TRUE. Removes the need to delete + re-add a recipient during a temporary vacation, etc.';

-- ─── Seed from current Sheets tab ────────────────────────────────
--
-- Arithmetic: 5 keys x 3 recipients + 1 key (help_request_hr) x 1
-- recipient + 7 keys x 4 recipients (Sheets carried k.fietek twice
-- on those 7) = 15 + 1 + 28 = 44 raw pairs; 44 - 7 duplicates = 37
-- distinct (action_key, email) rows.
--
-- The 37 rows in the VALUES list below are already deduped in the
-- SQL literal - the ON CONFLICT clause is belt-and-suspenders in
-- case a future edit re-adds a duplicate. Zero conflicts expected
-- on this apply.
--
-- sort_order preserves the slot ordering the operator laid out in
-- Sheets (m.chavez was always slot 1, a.wasserman was slot 2,
-- k.fietek slot 3) so the reader's response has a stable ordering.
--
-- help_request_hr has Kevin only per Kevin's ruling 2026-09-03; do
-- NOT add m.chavez in this migration.

INSERT INTO notification_recipients (action_key, email, enabled, sort_order, created_by, notes) VALUES
  -- separation
  ('separation',           'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('separation',           'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('separation',           'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  -- reclassification
  ('reclassification',     'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('reclassification',     'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('reclassification',     'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  -- rate_change (Sheets had k.fietek twice; deduped in this literal)
  ('rate_change',          'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('rate_change',          'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('rate_change',          'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- title_change
  ('title_change',         'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('title_change',         'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('title_change',         'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  -- status_change
  ('status_change',        'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('status_change',        'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('status_change',        'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  -- add_gratuity (Sheets had k.fietek twice; deduped)
  ('add_gratuity',         'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_gratuity',         'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_gratuity',         'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- add_deduction (Sheets had k.fietek twice; deduped)
  ('add_deduction',        'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_deduction',        'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_deduction',        'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- add_cell_phone (Sheets had k.fietek twice; deduped)
  ('add_cell_phone',       'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_cell_phone',       'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_cell_phone',       'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- add_bonus (Sheets had k.fietek twice; deduped)
  ('add_bonus',            'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_bonus',            'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('add_bonus',            'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- travel_reimbursement (Sheets had k.fietek twice; deduped)
  ('travel_reimbursement', 'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('travel_reimbursement', 'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('travel_reimbursement', 'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- other_reimbursement (Sheets had k.fietek twice; deduped)
  ('other_reimbursement',  'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('other_reimbursement',  'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('other_reimbursement',  'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Sheets had duplicate; deduped)'),
  -- new_hire
  ('new_hire',             'm.chavez@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('new_hire',             'a.wasserman@kitchfix.com', TRUE, 2, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  ('new_hire',             'k.fietek@kitchfix.com',    TRUE, 3, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03'),
  -- help_request_hr (Kevin only, per owner ruling 2026-09-03; do
  -- not add m.chavez in this migration)
  ('help_request_hr',      'k.fietek@kitchfix.com',    TRUE, 1, 'migration:notify-1', 'backfill from Sheets HUB/notifications 2026-09-03 (Kevin-only per owner ruling)')
ON CONFLICT (action_key, email) DO NOTHING;

-- Postflight: expected row count matches the deduped seed shape.
-- 13 action_keys x (3 recipients typical + 1 for help_request_hr) =
-- 12*3 + 1 = 37. Raw insert was 37 rows (dedupe already applied
-- in the VALUES list above; no actual conflicts).
DO $$
DECLARE
  cnt int;
  keys int;
BEGIN
  SELECT COUNT(*)                    INTO cnt  FROM notification_recipients;
  SELECT COUNT(DISTINCT action_key)  INTO keys FROM notification_recipients;
  IF cnt IS DISTINCT FROM 37 THEN
    RAISE EXCEPTION 'notify-1 HALT: notification_recipients row count is %, expected 37 (backfill seed). Investigate before running BLOCK C.', cnt;
  END IF;
  IF keys IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION 'notify-1 HALT: distinct action_key count is %, expected 13. Investigate before running BLOCK C.', keys;
  END IF;
  RAISE NOTICE 'notify-1: notification_recipients created + seeded. % rows across % action_keys.', cnt, keys;
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C - external verify (READ-ONLY - all SELECTs, safe to re-run)
-- ═══════════════════════════════════════════════════════════════════
--
-- No mutations in this block. A re-run reads the same state twice.
-- Constraint + trigger existence proved via pg_constraint /
-- pg_trigger metadata, not by attempting a write.

-- Query 1: full per-action_key recipient list. Compare against the
-- pre-migration Sheets probe output to confirm parity.
SELECT
  action_key,
  ARRAY_AGG(email ORDER BY sort_order, email) AS recipients,
  COUNT(*) AS n
FROM notification_recipients
WHERE enabled = TRUE
GROUP BY action_key
ORDER BY action_key;

-- Query 2: reader-query shape (same query the repointed
-- getNotificationRecipients() will run):
SELECT email
FROM notification_recipients
WHERE action_key = 'title_change'
  AND enabled = TRUE
ORDER BY sort_order, email;
-- Expected: 3 rows - m.chavez, a.wasserman, k.fietek.

-- Query 3: constraint + trigger metadata. Confirms the UNIQUE, the
-- two CHECK constraints, and the BEFORE UPDATE trigger all landed.
-- No INSERT / UPDATE required; the catalog tells us they exist.
SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,   -- u = unique, c = check
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'notification_recipients'
ORDER BY con.conname;
-- Expected 4 rows:
--   notification_recipients_pkey                  (p) primary key on id
--   notification_recipients_action_email_uniq     (u) UNIQUE (action_key, email)
--   notification_recipients_action_key_nonempty   (c) CHECK length(trim(action_key)) > 0
--   notification_recipients_email_shape           (c) CHECK email ~ '^...$'

SELECT
  tgname AS trigger_name,
  pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'notification_recipients'::regclass
  AND NOT tgisinternal
ORDER BY tgname;
-- Expected 1 row: notification_recipients_touch_trigger, BEFORE UPDATE.

-- Query 4: created_by provenance sanity. Every seed row should carry
-- 'migration:notify-1'; any NULL means the seed lost provenance.
SELECT
  created_by,
  COUNT(*) AS n
FROM notification_recipients
GROUP BY created_by
ORDER BY created_by NULLS FIRST;
-- Expected 1 row: created_by = 'migration:notify-1', n = 37.
