-- ═══════════════════════════════════════════════════════════════════
-- sc-36: per-week chase-ladder send ledger + pilot salaried-manager
--        recipient seed (PR-G of the SC -> QBO billing arc)
-- 2026-08-14
-- ═══════════════════════════════════════════════════════════════════
--
-- Ships the storage that makes the N3.1 / N3.2 / N3.3 chase cron
-- idempotent, plus the salaried_manager_emails seed for the two
-- pilots. Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5
-- (test/live), §A6 (matrix + RDO cc on N3.3), §A6b (Slack channel),
-- and the render at docs/design/KF_NOTIFICATION_RENDERS.html for
-- copy. If this migration and the addendum disagree, the addendum
-- wins - STOP and flag it, do not silently reconcile.
--
-- What this migration adds:
--
--   1. `sc_week_chase_sent` table - append-only fact ledger. One row
--      per (account_key, week_start, stage) tuple. UNIQUE index on
--      that tuple is the idempotency key: a second cron fire on the
--      same tuple is a no-op via ON CONFLICT DO NOTHING. Captures
--      the actual recipients_to / recipients_cc arrays that went
--      out (audit trail for resolveRecipients output), email_result,
--      slack_ok (N3.3 only), and sent_at.
--
--   2. UPDATE sc_qbo_account_map.salaried_manager_emails for both
--      pilots to the owner-confirmed lists (Kevin's ruling 2026-08-14,
--      recon step 1 of PR-G brief).
--
--   3. Paired sc_config_changelog rows for each pilot's UPDATE.
--      NOT EXISTS guarded on the reason string so re-apply is a
--      no-op.
--
-- ─── OWNER CONFIRMATIONS BAKED INTO THIS FILE ─────────────────────
--
-- Salaried manager rosters (Kevin's ruling 2026-08-14):
--   TXR - AZ: Adam Lacy (Sous Chef, a.lacy@kitchfix.com),
--             Elizabeth Randall (Hospitality Manager, e.randall@kitchfix.com)
--   CIN - AZ: Jennifer Trible (General Manager, j.trible@kitchfix.com),
--             Michael Decanio (Chef De Cuisine, m.decanio@kitchfix.com)
--
-- Both pilots' rdo_email stays NULL. RDO resolution auto-derives
-- from accounts.region -> REGIONAL_DIRECTORS at send time (both
-- pilots have region='West' -> Ryan Moore, r.moore@kitchfix.com).
-- sc_qbo_account_map.rdo_email is treated as a NON-NULL override
-- that wins; leaving it NULL keeps the region derivation.
--
-- ─── LIVE COLUMN DUMPS (SR-23 discipline, verified 2026-08-14) ────
--
-- sc_qbo_account_map (probed SELECT * limit 1, TXR - AZ row -
--   sc-35's shape confirmed still in effect):
--     account_key             text          NOT NULL PK
--     qbo_customer_id         text          NOT NULL
--     qbo_customer_name       text          NOT NULL
--     qbo_taxcode_id          text          NOT NULL
--     cadence                 text          NOT NULL
--     biweekly_anchor         date          NULL
--     active                  boolean       NOT NULL DEFAULT true
--     created_at              timestamptz   NOT NULL DEFAULT now()
--     changed_at              timestamptz   NOT NULL DEFAULT now()
--     qbo_mode                text          NOT NULL DEFAULT 'test'
--                                           CHECK (qbo_mode IN ('test','live'))
--     salaried_manager_emails text[]        NOT NULL DEFAULT '{}'
--     rdo_email               text          NULL
--
-- sc_config_changelog (probed SELECT * limit 1 - unchanged since
--   sc-35's dump):
--     id             uuid          NOT NULL (has DEFAULT)
--     account_key    text          NOT NULL
--     entity_type    text          NOT NULL
--                                  (CHECK includes 'qbo_account_map',
--                                   confirmed 3 rows already exist)
--     entity_id      uuid          NULL
--     entity_label   text          NULL
--     change_type    text          NOT NULL
--     old_value      jsonb         NULL
--     new_value      jsonb         NULL
--     effective_date date          NULL
--     reason         text          NOT NULL
--     requested_by   text          NULL
--     changed_by     text          NOT NULL
--     changed_at     timestamptz   NOT NULL (has DEFAULT)
--
-- accounts (probed SELECT * limit 1 - .region and .timezone are
--   live-populated fields):
--     team_key                text          NOT NULL
--     name                    text          NOT NULL
--     ... (many mostly-descriptive columns omitted)
--     timezone                text          NULL   (e.g. 'America/Phoenix')
--     region                  text          NULL   (e.g. 'West' / 'East' / 'CORP')
--     billing_model           text          NULL
--     has_homestand_schedule  boolean       NOT NULL DEFAULT false
--     has_schedule_overlay    boolean       NOT NULL DEFAULT false
--     pnl_tab_name            text          NULL
--
-- sc_week_chase_sent probe (2026-08-14): table does NOT exist.
--   Error: "Could not find the table 'public.sc_week_chase_sent'
--   in the schema cache". Fresh create.
--
-- sc-35 changelog rows: BOTH pilots have the sc-35: reason string
--   already (rows changed_at 2026-08-13). Confirms the NOT EXISTS
--   guard shape.
--
-- ─── GRANT hygiene (post-sc-34 template) ──────────────────────────
--
-- Post-sc-34 the postgres role's DEFAULT PRIVILEGES record grants
-- REFERENCES + TRIGGER to anon + authenticated on every new table
-- but NO LONGER grants TRUNCATE. Per docs/migrations/_GRANT_TEMPLATE.md:
--   - Skip the redundant `GRANT REFERENCES, TRIGGER TO anon,
--     authenticated` line (default already covers it).
--   - Keep the belt-and-suspenders REVOKE TRUNCATE on money-adjacent
--     tables. This ledger records notifications about invoices; it
--     is money-adjacent.
--
-- ─── Idempotency + retroactive effect ─────────────────────────────
--
-- Table create: CREATE TABLE IF NOT EXISTS + guarded CHECK adds +
-- CREATE INDEX IF NOT EXISTS. Re-apply is a no-op.
--
-- salaried_manager_emails UPDATE: guarded WHERE array is empty so a
-- re-run does NOT clobber a hand-edit Kevin makes in Studio.
--
-- Changelog INSERTs: NOT EXISTS on the reason string. Re-apply is
-- a no-op.
--
-- Retroactive effect: ZERO for the table itself (starts empty). The
-- salaried_manager_emails UPDATE writes lists per Kevin's ruling.
--
-- ─── Apply order ──────────────────────────────────────────────────
--
--   1. Paste in Supabase Studio.
--   2. Single BEGIN/COMMIT.
--   3. Verify with the V1-V7 block at the bottom (COMMENTED, run
--      each SELECT separately).
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. TABLE: sc_week_chase_sent ─────────────────────────────────
--
-- One row per (account_key, week_start, stage) chase attempt. The
-- cron writes this row BEFORE sending; the UNIQUE index catches a
-- duplicate fire and the send loop skips. Post-send UPDATE stamps
-- email_result and slack_ok so failures are visible in the ledger
-- without a re-send.
--
-- Stage enum matches src/lib/billing/recipients.js NOTIFICATION_TYPES
-- values ('N3.1','N3.2','N3.3'). Kept as TEXT + CHECK rather than
-- a native enum to keep string alignment with the JS constant obvious
-- - the recipients.js contract is authoritative.

CREATE TABLE IF NOT EXISTS sc_week_chase_sent (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity. account_key regex mirrors sc_week_finalize (sc-30)
  -- and sc_homestand_closeout so the string shape is consistent.
  account_key              TEXT NOT NULL CHECK (
                             account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                           ),

  -- Week identity. Mon-Sun weeks only; week_start is always a Monday.
  -- Same CHECK shape as sc_week_finalize.
  week_start               DATE NOT NULL CHECK (
                             extract(isodow from week_start) = 1
                           ),

  -- Which stage in the ladder. TEXT + CHECK to keep the alignment
  -- with src/lib/billing/recipients.js NOTIFICATION_TYPES visible.
  stage                    TEXT NOT NULL CHECK (
                             stage IN ('N3.1', 'N3.2', 'N3.3')
                           ),

  -- Actual recipients that went out. Audit surface for the
  -- resolveRecipients output on the day of send. NOT the config
  -- source (that lives in sc_qbo_account_map). Both arrays default
  -- to empty rather than NULL so consumers do not have to null-guard.
  recipients_to            TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  recipients_cc            TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

  -- Send outcome. email_result mirrors sendEmailSA's return shape
  -- ('sent' | 'failed'); NULL until the UPDATE lands post-send.
  -- slack_ok is meaningful ONLY on stage='N3.3'; NULL on N3.1/N3.2.
  email_result             TEXT CHECK (
                             email_result IS NULL
                             OR email_result IN ('sent', 'failed')
                           ),
  slack_ok                 BOOLEAN,

  -- Test-mode flag captured at send time so the ledger explains its
  -- own recipients_to (which will be [KEVIN_EMAIL] when true, per
  -- the addendum §A5 structural override).
  is_test                  BOOLEAN NOT NULL,

  -- Provenance.
  sent_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The idempotency invariant, enforced structurally rather than
  -- application-side: N3.3 must carry a slack_ok value (true or
  -- false) and N3.1/N3.2 must not. Prevents a send loop from
  -- misclassifying a stage.
  CHECK (
    (stage = 'N3.3' AND slack_ok IS NOT NULL)
    OR
    (stage != 'N3.3' AND slack_ok IS NULL)
  )
);

-- ─── 2. INDEXES ───────────────────────────────────────────────────
--
-- The one that matters: unique on (account_key, week_start, stage)
-- is the idempotency key. INSERT ... ON CONFLICT (account_key,
-- week_start, stage) DO NOTHING is the cron's send-guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_week_chase_sent_stage
  ON sc_week_chase_sent (account_key, week_start, stage);

-- Read shape: for a given (account, week) surface the send history
-- newest-first. Useful for support triage ("why did they get a
-- N3.3 last week?").
CREATE INDEX IF NOT EXISTS idx_sc_week_chase_sent_history
  ON sc_week_chase_sent (account_key, week_start, sent_at DESC);

-- ─── 3. GRANTs ────────────────────────────────────────────────────
--
-- service_role gets SELECT + INSERT + UPDATE. No DELETE by design:
-- the ledger IS the audit trail; a DELETE would erase it. anon +
-- authenticated get REFERENCES + TRIGGER via the postgres role's
-- DEFAULT PRIVILEGES (post-sc-34); no need to re-grant here.
GRANT SELECT, INSERT, UPDATE ON sc_week_chase_sent TO service_role;

-- Belt-and-suspenders REVOKE per _GRANT_TEMPLATE.md - this ledger
-- records notifications about invoice-adjacent state, treat it as
-- money-adjacent.
REVOKE TRUNCATE ON sc_week_chase_sent FROM anon, authenticated;

-- ─── 4. Seed salaried_manager_emails for both pilots ──────────────
--
-- Kevin's ruling 2026-08-14 (recon step 1 of PR-G brief). Guarded
-- WHERE array is empty so a re-run does NOT clobber a hand-edit
-- Kevin makes in Studio later - if he prunes or adds a name via
-- the Studio UI, sc-36 re-apply leaves that alone.

UPDATE sc_qbo_account_map
   SET salaried_manager_emails = ARRAY[
         'a.lacy@kitchfix.com',
         'e.randall@kitchfix.com'
       ]::TEXT[],
       changed_at = now()
 WHERE account_key = 'TXR - AZ'
   AND cardinality(salaried_manager_emails) = 0;

UPDATE sc_qbo_account_map
   SET salaried_manager_emails = ARRAY[
         'j.trible@kitchfix.com',
         'm.decanio@kitchfix.com'
       ]::TEXT[],
       changed_at = now()
 WHERE account_key = 'CIN - AZ'
   AND cardinality(salaried_manager_emails) = 0;

-- ─── 5. Paired changelog rows ─────────────────────────────────────
--
-- One row per pilot. NOT EXISTS guarded on the reason string so
-- re-apply is a no-op. Documents the seed for audit.

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  am.account_key,
  'qbo_account_map',
  NULL,
  am.account_key,
  'update',
  jsonb_build_object('salaried_manager_emails', to_jsonb(ARRAY[]::TEXT[])),
  jsonb_build_object('salaried_manager_emails', to_jsonb(am.salaried_manager_emails)),
  CURRENT_DATE,
  'sc-36: seed salaried_manager_emails per addendum A6 recon (PR-G, Kevin ruling 2026-08-14)',
  'sc-36-seed-salaried-managers'
FROM sc_qbo_account_map am
WHERE am.account_key IN ('TXR - AZ', 'CIN - AZ')
  AND NOT EXISTS (
    SELECT 1 FROM sc_config_changelog c
    WHERE c.entity_type = 'qbo_account_map'
      AND c.account_key = am.account_key
      AND c.reason LIKE 'sc-36:%'
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
--   Everything above the COMMIT ran as one transaction. Everything
--   below is a read-only SELECT you paste and run separately in
--   Studio to confirm the shape.
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Table exists with the expected column set.
--     Expected: 11 rows in the column list; names + types match the
--     CREATE TABLE above.
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'sc_week_chase_sent'
-- ORDER BY ordinal_position;


-- V2. CHECK constraints. Expected: 4 constraint rows -
--     account_key regex, week_start ISO Monday, stage enum,
--     email_result enum, plus the N3.3-must-have-slack_ok invariant.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.sc_week_chase_sent'::regclass
--   AND contype = 'c'
-- ORDER BY conname;


-- V3. Both indexes present. Expected: uq_sc_week_chase_sent_stage
--     UNIQUE on (account_key, week_start, stage);
--     idx_sc_week_chase_sent_history on (account_key, week_start,
--     sent_at DESC).
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename  = 'sc_week_chase_sent'
-- ORDER BY indexname;


-- V4. GRANTs. Expected: service_role has SELECT/INSERT/UPDATE
--     (no DELETE). anon + authenticated: 0 rows for
--     TRUNCATE / DELETE / UPDATE.
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name   = 'sc_week_chase_sent'
-- ORDER BY grantee, privilege_type;
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name   = 'sc_week_chase_sent'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type IN ('TRUNCATE', 'DELETE', 'UPDATE');


-- V5. Row count zero (retroactive effect is zero).
--
-- SELECT COUNT(*) FROM sc_week_chase_sent;


-- V6. Salaried recipient lists are populated. Expected: TXR - AZ
--     shows the two Adam/Elizabeth addresses, CIN - AZ shows the
--     two Jennifer/Michael addresses.
--
-- SELECT account_key, salaried_manager_emails, rdo_email, qbo_mode
-- FROM sc_qbo_account_map
-- WHERE account_key IN ('TXR - AZ', 'CIN - AZ')
-- ORDER BY account_key;


-- V7. Changelog rows land. Expected: two rows, one per pilot,
--     reason LIKE 'sc-36:%'.
--
-- SELECT account_key, entity_type, reason, changed_at
-- FROM sc_config_changelog
-- WHERE reason LIKE 'sc-36:%'
-- ORDER BY account_key;


-- V8. Idempotency smoke test. Run in scratch env only. Expected:
--     first INSERT succeeds, second one no-ops via ON CONFLICT.
--
-- INSERT INTO sc_week_chase_sent
--   (account_key, week_start, stage, email_result, slack_ok, is_test)
-- VALUES ('TXR - AZ', '2026-08-10', 'N3.1', 'sent', NULL, true)
-- ON CONFLICT (account_key, week_start, stage) DO NOTHING;
--
-- INSERT INTO sc_week_chase_sent
--   (account_key, week_start, stage, email_result, slack_ok, is_test)
-- VALUES ('TXR - AZ', '2026-08-10', 'N3.1', 'sent', NULL, true)
-- ON CONFLICT (account_key, week_start, stage) DO NOTHING;
--
-- SELECT COUNT(*) FROM sc_week_chase_sent
-- WHERE account_key='TXR - AZ' AND week_start='2026-08-10' AND stage='N3.1';
-- -- Expect: 1
--
-- DELETE FROM sc_week_chase_sent
-- WHERE account_key='TXR - AZ' AND week_start='2026-08-10' AND stage='N3.1';
