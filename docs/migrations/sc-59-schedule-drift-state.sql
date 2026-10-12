-- ═══════════════════════════════════════════════════════════════════
-- sc-59: sc_schedule_drift_state
-- 2026-10-12
-- ═══════════════════════════════════════════════════════════════════
--
-- Backs the weekly change-only recap for the SC schedule-drift watch.
-- Each row records one open DATE_DRIFT / PHANTOM_IN_DB signature; the
-- cron reads the table to compute NEW / CLEARED / carry-open against
-- the current run, then reconciles. A clean week (no NEW and no
-- CLEARED) posts nothing - that is the whole point of the rework.
--
-- Signature is a stable fingerprint of "this exact drift":
--   DATE_DRIFT    "{account}|{game_pk}|DATE_DRIFT|{scDate}|{apiDate}"
--   PHANTOM_IN_DB "{account}|{game_pk}|PHANTOM_IN_DB|{scDate}"
-- When a game moves to another date, apiDate changes -> new signature
-- -> re-alerts as NEW (correctly).
--
-- display stores the rendered plain-English line so CLEARED items can
-- be shown in Slack even after the drift is gone from the current
-- diff. We only replay what we previously said.
--
-- Grants mirror sc-32 (sibling sc_* table, same access shape):
-- service_role gets SELECT / INSERT / UPDATE / DELETE (the cron
-- reconciles every run); anon + authenticated get the harmless
-- REFERENCES / TRIGGER grants the family uses.
--
-- Three-block Studio pattern. Idempotent via IF NOT EXISTS.
-- Kevin applies in Studio. One block at a time.

-- ============================================================
-- BLOCK A - preflight (read-only, safe to re-run).
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'sc_schedule_drift_state';
-- EXPECT: zero rows the first time; one row on re-run (IF NOT EXISTS
-- made Block B a no-op). If one row AND the cron has not deployed yet,
-- STOP and report rather than running Block B blind.

-- ============================================================
-- BLOCK B - main (one transaction).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS sc_schedule_drift_state (
  signature    TEXT PRIMARY KEY,
  account_key  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('DATE_DRIFT', 'PHANTOM_IN_DB')),
  display      TEXT NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  sc_schedule_drift_state IS
  'sc-59 (2026-10-12): open schedule-drift signatures persisted across weekly cron runs. One row per open DATE_DRIFT / PHANTOM_IN_DB. Reconciled every Monday by /api/cron/schedule-drift: inserts NEW signatures, bumps last_seen on carry-over, deletes CLEARED signatures. The display column replays the posted line for CLEARED entries.';
COMMENT ON COLUMN sc_schedule_drift_state.signature IS
  'Stable fingerprint. DATE_DRIFT: "{account}|{game_pk}|DATE_DRIFT|{scDate}|{apiDate}". PHANTOM_IN_DB: "{account}|{game_pk}|PHANTOM_IN_DB|{scDate}". A new target date changes the signature so the next run posts a fresh NEW line.';
COMMENT ON COLUMN sc_schedule_drift_state.display IS
  'Rendered plain-English line as it was posted. Reused verbatim in the Cleared-section recap.';

-- GRANTs mirror sc-32: cron needs read + full reconcile.
GRANT SELECT, INSERT, UPDATE, DELETE ON sc_schedule_drift_state TO service_role;
GRANT REFERENCES, TRIGGER            ON sc_schedule_drift_state TO anon, authenticated;

COMMIT;

-- ============================================================
-- BLOCK C - postflight (read-only, safe to re-run).
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'sc_schedule_drift_state';
-- EXPECT: one row.

SELECT count(*) AS seed_row_count FROM sc_schedule_drift_state;
-- EXPECT: 0 (first run of the cron will seed the baseline NEW rows).

SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'sc_schedule_drift_state'
  AND grantee IN ('service_role', 'anon', 'authenticated')
GROUP BY grantee
ORDER BY grantee;
-- EXPECT:
--   anon            REFERENCES, TRIGGER
--   authenticated   REFERENCES, TRIGGER
--   service_role    DELETE, INSERT, SELECT, UPDATE
