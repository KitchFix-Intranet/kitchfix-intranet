-- ═══════════════════════════════════════════════════════════════════
-- sc-33: TRUNCATE fence + qbo_line_description rename
-- 2026-08-11
-- ═══════════════════════════════════════════════════════════════════
--
-- Bundles two owner-graded findings into one migration:
--
--   1. **TRUNCATE fence**. Kevin's V4 verify on sc-32 (2026-08-11)
--      surfaced that sc_week_finalize, sc_qbo_service_map, and
--      sc_export_ledger grant TRUNCATE to anon + authenticated
--      despite our SQL never writing that grant. sc_qbo_account_map
--      is included preemptively (same shape, same likely mechanism).
--      REVOKE on the four tables to reset live state.
--
--   2. **qbo_item_name -> qbo_line_description**. Owner ruling
--      2026-08-10 (post retro-shadow round 2): the field's semantic
--      is Sebastian's typed invoice-line description, not the QB
--      item's registered Name (e.g. sc_qbo_service_map carries
--      "Pre-Game Snack" while the QB item is "REDS MiLB/MLB - Snack").
--      Rename the column to match the semantic.
--
-- ─── MECHANISM ANALYSIS (owner ask: which is it?) ─────────────────
--
-- Every GRANT statement in sc-30, sc-31, sc-32 that touches anon /
-- authenticated reads:
--     GRANT REFERENCES, TRIGGER ON <table> TO anon, authenticated;
-- No TRUNCATE keyword appears in the grant list to those roles in
-- any of the three files.
--     [ran] grep -n "GRANT.*anon\|GRANT.*authenticated" \
--       docs/migrations/sc-30-week-finalize.sql \
--       docs/migrations/sc-31-qbo-maps.sql \
--       docs/migrations/sc-32-export-ledger.sql
--
-- Therefore the TRUNCATE grant did NOT come from our GRANT lines.
-- The only remaining mechanism in Postgres is `ALTER DEFAULT
-- PRIVILEGES` set on the `public` schema (or on a specific grantor
-- role) that grants TRUNCATE on newly-created tables to
-- anon + authenticated by default. That default privilege was set
-- outside this repo's migration tree - likely in Supabase's project
-- bootstrap (per `docs/audits/GRANT_HYGIENE_2026-07-29.md` §4-5,
-- which noted the pattern originator was the pr-7-1 per-table
-- template used by Supabase Studio at project creation).
--
-- Implication: a plain REVOKE fixes CURRENT tables but the NEXT new
-- table will re-inherit TRUNCATE unless the default_privileges
-- record is also cleaned up. This migration does the REVOKE; the
-- verify block below includes a pg_default_acl probe that reveals
-- the exact grantor role + object-type + ACL string so a follow-up
-- can decide whether to add
--     ALTER DEFAULT PRIVILEGES FOR ROLE <grantor> IN SCHEMA public
--       REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
-- to this file (or a separate one) before merging. Left as a probe
-- for two reasons: (a) we do not yet know the grantor role name from
-- the app side; (b) altering DEFAULT PRIVILEGES for a role that owns
-- other tables can surprise other subsystems (Vendor / Invoice /
-- OPD migrations, all listed in the 2026-07-29 audit). Kevin runs
-- the probe, decides, and either adds the ALTER line here or ships
-- a follow-up sc-34.
--
-- The `docs/migrations/_GRANT_TEMPLATE.md` note added in this PR
-- covers the interim: every new SC migration MUST include an
-- explicit REVOKE TRUNCATE line after its GRANT block, so a future
-- table does not silently re-inherit even if default_privileges is
-- never fixed.
--
-- ─── LIVE COLUMN DUMP (SR-23 discipline, verified 2026-08-11) ─────
--
-- sc_qbo_service_map (via probe SELECT + sc-31 DDL cross-check):
--   service_id       uuid            NOT NULL
--   account_key      text            NOT NULL
--   qbo_item_id      text            NOT NULL
--   qbo_item_name    text            NOT NULL   -- renamed by this migration
--   aggregate_group  text            NULL
--   invoice_slot     text            NOT NULL
--   tax_override     text            NULL
--   line_desc_style  text            NULL
--   active           boolean         NOT NULL DEFAULT true
--   created_at       timestamptz     NOT NULL DEFAULT now()
--   changed_at       timestamptz     NOT NULL DEFAULT now()
--
-- sc_config_changelog (verified 2026-08-10 during sc-31, unchanged):
--   [see sc-31 header]
--
-- ─── RE-APPLY SAFETY ──────────────────────────────────────────────
--
-- REVOKEs are idempotent (a no-op when the privilege is not held).
-- RENAME COLUMN uses IF EXISTS via a DO block so a second apply
-- silently succeeds. The changelog INSERT is NOT-EXISTS guarded on
-- the reason string.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- PART A: TRUNCATE fence
-- ═══════════════════════════════════════════════════════════════════
--
-- REVOKE TRUNCATE on the four tables from both anon and authenticated.
-- Idempotent: REVOKE is a no-op when the grantee does not hold the
-- privilege, so a re-apply after Kevin's 2026-07-31 catalog-driven
-- revoke (or after this migration itself) touches zero rows.

REVOKE TRUNCATE ON sc_week_finalize    FROM anon, authenticated;
REVOKE TRUNCATE ON sc_qbo_account_map  FROM anon, authenticated;
REVOKE TRUNCATE ON sc_qbo_service_map  FROM anon, authenticated;
REVOKE TRUNCATE ON sc_export_ledger    FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PART B: rename qbo_item_name -> qbo_line_description
-- ═══════════════════════════════════════════════════════════════════
--
-- Straight RENAME COLUMN. Postgres updates every dependent object
-- automatically (indexes, constraints, RLS policies, views). We have
-- no views / policies on sc_qbo_service_map today. Indexes live on
-- (account_key) and (account_key, aggregate_group) - neither
-- references qbo_item_name, so nothing else needs touching.
--
-- Guarded by an information_schema check so a second apply is a
-- no-op even if a future migration writes the same column name again.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'sc_qbo_service_map'
      AND column_name  = 'qbo_item_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'sc_qbo_service_map'
      AND column_name  = 'qbo_line_description'
  ) THEN
    EXECUTE 'ALTER TABLE sc_qbo_service_map RENAME COLUMN qbo_item_name TO qbo_line_description';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PART C: changelog rows documenting the rename
-- ═══════════════════════════════════════════════════════════════════
--
-- One row per affected service_id. Historic sc-31 + sc-31a rows keep
-- their `qbo_item_name` jsonb keys as an audit fingerprint of the
-- pre-rename shape; these new rows document the shape shift.

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  sm.account_key,
  'qbo_service_map',
  sm.service_id,
  s.service_name,
  'update',
  jsonb_build_object('column', 'qbo_item_name'),
  jsonb_build_object('column', 'qbo_line_description', 'value', sm.qbo_line_description),
  CURRENT_DATE,
  'sc-33: column rename qbo_item_name -> qbo_line_description (owner ruling 2026-08-10)',
  'sc-33-rename'
FROM sc_qbo_service_map sm
JOIN sc_services         s  ON s.id = sm.service_id
WHERE NOT EXISTS (
  SELECT 1 FROM sc_config_changelog c
  WHERE c.entity_type = 'qbo_service_map'
    AND c.entity_id   = sm.service_id
    AND c.reason LIKE 'sc-33:%'
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

-- V1. TRUNCATE no longer held by anon / authenticated on any of the
--     four fenced tables. Expected: zero rows.
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('sc_week_finalize', 'sc_qbo_account_map',
--                      'sc_qbo_service_map', 'sc_export_ledger')
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'TRUNCATE';

-- V2. Reveal the DEFAULT PRIVILEGES source. If any row shows a
--     grantor + object-type + ACL that includes TRUNCATE for
--     anon/authenticated, THAT is the mechanism a follow-up must
--     clean up with:
--         ALTER DEFAULT PRIVILEGES FOR ROLE <grantor>
--           IN SCHEMA public
--           REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
--     Expected: at least one row exposing which grantor role sets
--     the default. Zero rows means the mechanism is elsewhere (e.g.
--     project-level Supabase config) and this can only be fixed at
--     that layer.
--
-- SELECT d.defaclrole::regrole      AS grantor,
--        d.defaclnamespace::regnamespace AS schema,
--        d.defaclobjtype             AS obj_type,
--        d.defaclacl                 AS default_acl
-- FROM pg_default_acl d
-- WHERE d.defaclnamespace = 'public'::regnamespace::oid
-- ORDER BY d.defaclrole::regrole::text, d.defaclobjtype;

-- V3. Column rename landed. Expected: qbo_line_description present,
--     qbo_item_name absent.
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'sc_qbo_service_map'
--   AND column_name IN ('qbo_item_name', 'qbo_line_description');

-- V4. Live values after rename. Expected: 13 rows (all sc-31 seeds),
--     with the 4 CIN - AZ solo values matching sc-31a's Sebastian-
--     typed convention: Pre-Game Snack / Coffee Service / Fountain
--     Beverages / Continental Plus. TXR + CIN aggregate rows keep
--     their registered QB item names.
--
-- SELECT account_key, qbo_item_id, qbo_line_description, line_desc_style
-- FROM sc_qbo_service_map
-- WHERE active = true
-- ORDER BY account_key, qbo_item_id, qbo_line_description;

-- V5. Changelog rows for the rename. Expected: 13 new rows tagged
--     'sc-33:%'.
--
-- SELECT count(*) FROM sc_config_changelog WHERE reason LIKE 'sc-33:%';

-- V6. Re-apply is a no-op. Running this file a second time in Studio
--     changes zero rows: REVOKEs on already-revoked privileges no-op;
--     the DO-block RENAME is skipped because qbo_item_name no longer
--     exists AND qbo_line_description does; the changelog INSERT is
--     NOT EXISTS - guarded on the reason string.
