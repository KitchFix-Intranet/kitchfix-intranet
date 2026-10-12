-- ═══════════════════════════════════════════════════════════════════
-- admin-drift-log.sql
-- Stage 4b of the Directory Admin Panel arc.
--
-- Persistent drift / fallback log for the dual-read validation window.
-- Vercel log retention is too short to accumulate a two-week signal
-- across many request paths, so each `[admin] DRIFT` event is also
-- written to this table. Service-account-only; no user-facing reads.
--
-- Rows are written fire-and-forget by src/lib/admin.js:logDrift().
-- The caller never awaits the insert, so a Supabase hiccup cannot
-- block a request response.
--
-- RETENTION: Stage 5 (after the dual-read window closes) purges rows
-- older than the window and drops the table. No per-row expiry today.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_drift_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  email           TEXT NOT NULL,
  permission      TEXT NOT NULL,
  event_type      TEXT NOT NULL DEFAULT 'drift' CHECK (event_type IN ('drift', 'fallback', 'probe')),
  db_value        BOOLEAN,
  hardcoded_value BOOLEAN,
  error_msg       TEXT,
  consumer        TEXT
);

CREATE INDEX IF NOT EXISTS idx_drift_log_created
  ON admin_drift_log (created_at);

COMMENT ON TABLE admin_drift_log IS
  'Append-only drift log for the Stage 4 dual-read window. Writes '
  'fire-and-forget from src/lib/admin.js:logDrift(). Service-role only '
  'for both read and write. Dropped at Stage 5.';

-- ═══════════════════════════════════════════════════════════════════
-- RLS + grants: service-role-only. The admin.js logDrift writes
-- via the service client; nothing else reads this table during the
-- validation window. event_type CHECK includes 'probe' so the Stage
-- 4b verify probe can round-trip an insert without poisoning the
-- drift signal.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE admin_drift_log ENABLE ROW LEVEL SECURITY;

-- Service role gets everything. Policy name matches the sc-4 pattern.
DROP POLICY IF EXISTS "service_role_all" ON admin_drift_log;
CREATE POLICY "service_role_all" ON admin_drift_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON admin_drift_log TO service_role;
GRANT USAGE ON SEQUENCE admin_drift_log_id_seq TO service_role;
GRANT REFERENCES, TRIGGER ON admin_drift_log TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying the file in Supabase Studio.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional>
