-- ═══════════════════════════════════════════════════════════════════
-- people-3-changelog.sql
-- Directory Admin Panel - people permission changelog (Stage 3)
--
-- Append-only audit table for permission/role changes made through
-- the admin panel. One row per column change per person.
--
-- DESIGN
-- - NO foreign keys to people. Status changes must never cascade
--   into deleting change history. person_email and person_name
--   denormalize the human identifiers so history remains readable
--   after a person leaves or email changes. Same principle as
--   sc_config_changelog's `entity_id` not being a FK.
-- - reason is NOT NULL because every change must carry a why. The
--   route layer enforces non-empty + trimmed + length cap; the
--   schema has a defense-in-depth CHECK on length(trim(reason)) > 0
--   and a 280-char cap.
-- - column_name is CHECK-constrained to the 19 known permission
--   columns from people-2-admin-columns.sql so code-level enum
--   drift is caught at the DB.
--
-- GRANTS - intentionally tighter than full-CRUD service_role (same
-- pattern as sc_config_changelog). service_role gets SELECT + INSERT
-- only - no UPDATE, no DELETE, no TRUNCATE. The orchestrator only
-- ever inserts into this table; a code bug or compromised key cannot
-- rewrite history.
--
-- Apply in Supabase Studio. Verify via
--   scripts/probes/people-changelog-verify.mjs
-- before the Stage 3 code that writes to this table merges.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS people_changelog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_email    TEXT NOT NULL,
  person_name     TEXT,
  column_name     TEXT NOT NULL CHECK (
                    column_name IN (
                      'is_ops_leadership',
                      'is_sc_access',
                      'is_sc_admin',
                      'is_sc_lock_override',
                      'is_labor_admin',
                      'is_invoice_admin',
                      'is_inv_manager',
                      'kpi_role',
                      'kpi_scope',
                      'can_see_salary',
                      'is_kpi_preview',
                      'opd_access_tier',
                      'is_playbook_owner',
                      'is_sous_preview',
                      'is_hr_admin',
                      'paf_always_cc',
                      'incident_notify',
                      'region',
                      'sc_default_account'
                    )
                  ),
  old_value       JSONB,
  new_value       JSONB,
  reason          TEXT NOT NULL CHECK (
                    length(trim(reason)) > 0 AND length(reason) <= 280
                  ),
  changed_by      TEXT NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_people_changelog_person_recent
  ON people_changelog (person_email, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_people_changelog_column
  ON people_changelog (column_name, changed_at DESC);

COMMENT ON TABLE people_changelog IS
  'Append-only audit log for people permission/role changes. One row '
  'per column change. NO FKs to people - status changes must never '
  'cascade into history. person_email and person_name denormalize so '
  'history reads cleanly after a person leaves. Tamper-evident by '
  'GRANT - service_role has SELECT + INSERT only.';

ALTER TABLE people_changelog DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- GRANTs: audit log pattern (matches sc_config_changelog).
-- service_role only gets SELECT + INSERT. UPDATE/DELETE/TRUNCATE are
-- deliberately withheld so a code bug or compromised service-role key
-- cannot rewrite history. The orchestrator never updates or deletes
-- changelog rows.
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON people_changelog TO service_role;

-- anon/authenticated get REFERENCES + TRIGGER only (no TRUNCATE - same
-- audit-integrity reason as above). Matches sc-4's pattern.
GRANT REFERENCES, TRIGGER ON people_changelog TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- DONE
-- Verify with scripts/probes/people-changelog-verify.mjs.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file in Supabase Studio.
-- The migration-gate check on the PR looks for the phrase
-- `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional>
