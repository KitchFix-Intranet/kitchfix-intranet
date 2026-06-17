-- ═══════════════════════════════════════════════════════════════════
-- sc-2-homestand-schedule.sql
-- Service Calendar - homestand schedule table (Module SC, Bundle 2)
--
-- Adds sc_homestand_schedule: a per-(account, date) mirror of the HUB
-- spreadsheet's homestand_schedule tab. The Season Tracker
-- (src/app/api/ops/route.js, action=labor-bootstrap) keeps reading
-- from Sheets unchanged. This PG copy is additive, populated by:
--   scripts/_seed_sc_homestand_schedule.mjs  (sheets -> PG upsert)
--
-- The Service Calendar fee-account year-view redesign needs per-day
-- homestand context (homestand_id, day_type, opponent) to group
-- visuals, suppress off-day urgency between homestands, and surface
-- delivery metrics in place of revenue. Reading from Sheets at request
-- time would couple SC reads to the HUB sheet quota; mirroring to PG
-- keeps SC's read path local.
--
-- Apply in Supabase Studio. Verify via probe:
--   SELECT account_key, COUNT(*) AS rows,
--          COUNT(DISTINCT homestand_id) AS homestands
--   FROM sc_homestand_schedule GROUP BY account_key ORDER BY account_key;
-- Expected after seed:
--   STL - MO     ~95 rows   13 homestands
--   CIN - OH     ~95 rows   13 homestands
--   TXR - TX - H ~85 rows   12 homestands
--   TXR - TX - V ~85 rows   12 homestands  (mirror of TXR - TX - H)
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sc_homestand_schedule (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_key  TEXT NOT NULL,
  service_date DATE NOT NULL,
  day_of_week  TEXT NOT NULL,
  day_type     TEXT NOT NULL CHECK (day_type IN ('GAME', 'PREP', 'OPEN', 'CLOSE', 'CLEAN')),
  opponent     TEXT,
  homestand_id TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_key, service_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_homestand_account_date
  ON sc_homestand_schedule (account_key, service_date);

-- Matches every other sc_* table's RLS posture (service role only).
ALTER TABLE sc_homestand_schedule DISABLE ROW LEVEL SECURITY;
