-- ═══════════════════════════════════════════════════════════════════
-- sc-35: qbo_mode + owner-supplied notification recipients on
--         sc_qbo_account_map (PR-F of the SC -> QBO billing arc)
-- 2026-08-13
-- ═══════════════════════════════════════════════════════════════════
--
-- Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5 (test/live
-- switch) + §A6 (notification matrix) + §A8 (owner-supplied config
-- for RDO + salaried-manager gaps).
--
-- What this migration adds, in one ALTER pass to keep the atomic
-- semantics tight:
--
--   1. qbo_mode                     - the per-account test/live
--                                     switch that gates the adapter
--                                     fence + the recipient resolver.
--                                     Default 'test' so any new row
--                                     is safe by construction.
--   2. salaried_manager_emails      - TEXT[], owner-populated per
--                                     addendum §A8 principle. The
--                                     codebase has no authoritative
--                                     per-person "salaried" flag, so
--                                     Kevin fills the array via
--                                     Studio when an account needs
--                                     N1/N3.x recipients. Empty
--                                     default = no site-leader cc
--                                     on live mode (safe until Kevin
--                                     writes the list).
--   3. rdo_email                    - TEXT nullable. Reuses the
--                                     existing region -> RDO map at
--                                     src/lib/incidentSchema.js:267
--                                     when Kevin can supply the SC
--                                     account -> region link;
--                                     otherwise Kevin sets rdo_email
--                                     directly. NULL = no RDO cc on
--                                     N3.3 / N4 until populated.
--
-- Both pilot rows (TXR - AZ, CIN - AZ) land as qbo_mode='test' with
-- empty salaried_manager_emails and NULL rdo_email. Kevin fills the
-- recipient columns via Studio when either pilot graduates.
--
-- ─── LIVE COLUMN DUMP (SR-23 discipline, verified 2026-08-13) ─────
--
-- sc_qbo_account_map (probed via SELECT * limit 1, TXR - AZ row):
--   account_key        text            NOT NULL PK
--   qbo_customer_id    text            NOT NULL
--   qbo_customer_name  text            NOT NULL
--   qbo_taxcode_id     text            NOT NULL
--   cadence            text            NOT NULL
--   biweekly_anchor    date            NULL
--   active             boolean         NOT NULL DEFAULT true
--   created_at         timestamptz     NOT NULL DEFAULT now()
--   changed_at         timestamptz     NOT NULL DEFAULT now()
--
-- sc_config_changelog (verified live 2026-08-13 - same shape as
-- sc-31's dump 2026-08-10; entity_id uuid, new_value jsonb, etc.):
--   id             uuid           NOT NULL (has DEFAULT)
--   account_key    text           NOT NULL
--   entity_type    text           NOT NULL (CHECK includes 'qbo_account_map' after sc-31)
--   entity_id      uuid           NULL
--   entity_label   text           NULL
--   change_type    text           NOT NULL
--   old_value      jsonb          NULL
--   new_value      jsonb          NULL
--   effective_date date           NULL
--   reason         text           NOT NULL
--   requested_by   text           NULL
--   changed_by     text           NOT NULL
--   changed_at     timestamptz    NOT NULL (has DEFAULT)
--
-- Both dumps confirm sc-35 references land on real column shapes.
--
-- ─── GRANT hygiene (no per-table REVOKE needed) ───────────────────
--
-- sc-34 landed the ALTER DEFAULT PRIVILEGES fix for the postgres
-- role's public schema record - TRUNCATE no longer inherits to
-- anon/authenticated on new tables. This migration ADDs COLUMNs on
-- an existing table (sc_qbo_account_map) so per-table grant hygiene
-- is unchanged. Per docs/migrations/_GRANT_TEMPLATE.md post-sc-34:
-- REVOKE TRUNCATE line NOT required for column-add migrations.
--
-- ─── Re-apply safety ──────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS + guarded CHECK adds + NOT EXISTS on
-- changelog inserts. Running this file a second time in Studio
-- changes zero rows.

BEGIN;

-- ─── 1. ADD COLUMNs ───────────────────────────────────────────────

ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS qbo_mode TEXT NOT NULL DEFAULT 'test';

-- CHECK guarded so re-apply is a no-op: DROP IF EXISTS + add.
ALTER TABLE sc_qbo_account_map
  DROP CONSTRAINT IF EXISTS sc_qbo_account_map_qbo_mode_check;
ALTER TABLE sc_qbo_account_map
  ADD CONSTRAINT sc_qbo_account_map_qbo_mode_check
  CHECK (qbo_mode IN ('test', 'live'));

ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS salaried_manager_emails TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS rdo_email TEXT;

-- ─── 2. Seed the pilots ───────────────────────────────────────────
--
-- Both pilots default to qbo_mode='test'. The DEFAULT clause on the
-- ADD COLUMN already assigns 'test' to the two existing rows. The
-- explicit UPDATE below is a re-apply-safe no-op guaranteeing state
-- (guarded WHERE qbo_mode IS DISTINCT FROM 'test' skips a re-run
-- once the value is settled).
UPDATE sc_qbo_account_map
   SET qbo_mode = 'test'
 WHERE account_key IN ('TXR - AZ', 'CIN - AZ')
   AND qbo_mode IS DISTINCT FROM 'test';

-- salaried_manager_emails + rdo_email left at DEFAULT '{}' / NULL.
-- Kevin populates via Studio when either pilot graduates. Adding
-- the values here would require inferring identities the codebase
-- does not carry - refused per addendum §A8.

-- ─── 3. Changelog rows for each affected pilot ────────────────────
--
-- One changelog row per pilot, NOT EXISTS-guarded on the reason
-- string so re-apply is a no-op. Documents the shape shift.
INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  am.account_key,
  'qbo_account_map',
  NULL,
  am.account_key,
  'update',
  jsonb_build_object('note', 'pre-sc-35 shape: no qbo_mode / salaried_manager_emails / rdo_email columns'),
  jsonb_build_object(
    'qbo_mode',                am.qbo_mode,
    'salaried_manager_emails', to_jsonb(am.salaried_manager_emails),
    'rdo_email',               am.rdo_email
  ),
  CURRENT_DATE,
  'sc-35: add qbo_mode + owner-supplied notification recipient columns (addendum A5/A6/A8)',
  'sc-35-add-mode-recipients'
FROM sc_qbo_account_map am
WHERE am.account_key IN ('TXR - AZ', 'CIN - AZ')
  AND NOT EXISTS (
    SELECT 1 FROM sc_config_changelog c
    WHERE c.entity_type = 'qbo_account_map'
      AND c.account_key = am.account_key
      AND c.reason LIKE 'sc-35:%'
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Columns landed with correct types + defaults.
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'sc_qbo_account_map'
--   AND column_name IN ('qbo_mode', 'salaried_manager_emails', 'rdo_email')
-- ORDER BY column_name;
-- Expect:
--   qbo_mode                 text          NO   'test'::text
--   rdo_email                text          YES  NULL
--   salaried_manager_emails  ARRAY         NO   '{}'::text[]

-- V2. CHECK constraint present.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.sc_qbo_account_map'::regclass
--   AND contype  = 'c'
--   AND conname  = 'sc_qbo_account_map_qbo_mode_check';
-- Expect one row: CHECK ((qbo_mode = ANY (ARRAY['test'::text, 'live'::text])))

-- V3. Pilots seeded as test.
--
-- SELECT account_key, qbo_mode, salaried_manager_emails, rdo_email
-- FROM sc_qbo_account_map
-- WHERE account_key IN ('TXR - AZ', 'CIN - AZ')
-- ORDER BY account_key;
-- Expect:
--   CIN - AZ   test   {}   NULL
--   TXR - AZ   test   {}   NULL

-- V4. Changelog rows present.
--
-- SELECT account_key, new_value
-- FROM sc_config_changelog
-- WHERE reason LIKE 'sc-35:%'
-- ORDER BY account_key;
-- Expect 2 rows, one per pilot.

-- V5. Re-apply is a no-op. Running this file a second time in Studio
--     changes zero rows: ADD COLUMN IF NOT EXISTS skips; DROP IF
--     EXISTS + ADD CHECK re-declares identical constraint; UPDATE
--     WHERE qbo_mode IS DISTINCT FROM 'test' skips (already 'test');
--     INSERT NOT EXISTS on 'sc-35:%' reason skips.
