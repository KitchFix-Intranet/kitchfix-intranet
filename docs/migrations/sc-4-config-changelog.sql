-- ═══════════════════════════════════════════════════════════════════
-- sc-4-config-changelog.sql
-- Service Calendar - reusable config change-log (Module SC, Bundle 4)
--
-- Append-only audit table for SC config writes. Stage 2 (price editor)
-- is the first writer; later stages (archive, fee schedule, fun money)
-- slot into the same table by entity_type.
--
-- DESIGN
-- - NO foreign keys to sc_services / sc_service_groups. Archive or
--   delete must never cascade into deleting change history. Same
--   principle as sc_daily_actuals_history (sc-1:270-280) - actual_id is
--   intentionally NOT a FK. entity_label denormalizes the human label
--   so history remains readable after a rename or archive.
-- - reason is NOT NULL because every change must carry a why. The
--   route layer enforces non-empty + trimmed + length cap; the schema
--   has a defense-in-depth CHECK on length(trim(reason)) > 0 and a
--   280-char cap.
-- - entity_type and change_type are CHECK-constrained so later writers
--   slot in cleanly without code-level enum drift.
--
-- GRANTS - intentionally tighter than sc-1's full-CRUD service_role
-- pattern. This is an audit log; rewriting history defeats its purpose.
-- service_role gets SELECT + INSERT only - no UPDATE, no DELETE, no
-- TRUNCATE. The orchestrator only ever inserts into this table.
--
-- Apply in Supabase Studio. Verify via
--   scripts/_probe-sc-4-changelog-verify.mjs
-- before the Stage 2 code that writes to this table merges.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sc_config_changelog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL CHECK (
                    account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    OR account_key = 'CORP'
                  ),
  entity_type     TEXT NOT NULL CHECK (
                    entity_type IN ('price', 'service', 'group', 'fee', 'fun_money')
                  ),
  entity_id       UUID,                            -- nullable for account-wide changes
  entity_label    TEXT,                            -- denormalized human label
  change_type     TEXT NOT NULL CHECK (
                    change_type IN ('create', 'update', 'archive', 'reactivate')
                  ),
  old_value       JSONB,
  new_value       JSONB,
  effective_date  DATE,
  reason          TEXT NOT NULL CHECK (
                    length(trim(reason)) > 0 AND length(reason) <= 280
                  ),
  requested_by    TEXT,
  changed_by      TEXT NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_config_changelog_account_recent
  ON sc_config_changelog (account_key, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sc_config_changelog_entity
  ON sc_config_changelog (entity_type, entity_id);

COMMENT ON TABLE sc_config_changelog IS
  'Append-only audit log for SC config writes. One row per change. '
  'NO FKs to entity tables - archive/delete must never cascade into '
  'history. entity_label denormalizes the human label so history reads '
  'cleanly after a rename or archive. Stage 2 (price editor) is the '
  'first writer; later stages slot in by entity_type. Tamper-evident '
  'by GRANT - service_role has SELECT + INSERT only.';

ALTER TABLE sc_config_changelog DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- GRANTs: tighter than sc-1's full-CRUD pattern. Audit integrity.
-- service_role only gets SELECT + INSERT. UPDATE/DELETE/TRUNCATE are
-- deliberately withheld so a code bug or compromised service-role key
-- cannot rewrite history. The orchestrator never updates or deletes
-- changelog rows.
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON sc_config_changelog TO service_role;

-- anon/authenticated get REFERENCES + TRIGGER only (no TRUNCATE - same
-- audit-integrity reason as above). Matches sc-1's pattern minus TRUNCATE.
GRANT REFERENCES, TRIGGER ON sc_config_changelog TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- Verify with scripts/_probe-sc-4-changelog-verify.mjs.
-- ═══════════════════════════════════════════════════════════════════
