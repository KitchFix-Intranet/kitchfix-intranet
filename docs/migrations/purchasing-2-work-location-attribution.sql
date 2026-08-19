-- purchasing-2-work-location-attribution.sql
-- KPI PURCHASING PHASE 1 - work_location attribution rewrite.
-- Owner ruling 2026-08-18: at KitchFix a manager who travels codes the
-- spend to the location they are travelling TO. work_location is a
-- DECISION the buyer made; department is merely the payroll bucket of
-- whoever holds the card. Therefore work_location IS the attribution
-- axis. There is NO department fallback anywhere.
--
-- Consequences (all intended):
--   - a CORP Ops card coded "Jupiter, FL (STL-FL)" is STL - FL cost.
--   - a site manager card coded "Remote" is NOT that site cost; it is
--     a policy miss and gets counted in miscoded_card_lines, not summed.
--   - spend_department_site_map is deleted (kept a wrong-axis map that
--     looked authoritative - actively dangerous).
--
-- ─── WHY DROP THEN CREATE ────────────────────────────────────────────
-- The map that was landing in purchasing-1 was keyed on department_id
-- and had 28 candidate rows with account_key NULL (no labels applied
-- yet). Repurposing that table would require both a rename AND a key
-- change; a clean drop + create keeps the migration statement per
-- statement legible and lets Kevin see exactly what is going in.
-- The dropped rows were candidates only, never populated with mappings.
--
-- ─── WHY SEED EXPLICIT (id, label) PAIRS ─────────────────────────────
-- Kevin's rule: do NOT parse the parenthesised suffix at runtime.
-- Three labels (TXR-HOME, TXR-VISITOR, TBJ-BUF) do not equal our
-- account keys, so any parser is wrong for those three. Explicit rows
-- also cover the case where a single label carries multiple ids: the
-- observed data shows 12 distinct work_location_id values that all
-- render as label "Remote" (Rippling appears to mint per-worker Remote
-- entries). Every one of them must seed as excluded=TRUE or the raw
-- work_location_id -> account_key lookup misses on the other 11.
--
-- ─── APPLY DISCIPLINE ────────────────────────────────────────────────
-- Kevin applies statement by statement in Supabase Studio. Every CREATE
-- uses IF NOT EXISTS. INSERT is ON CONFLICT DO NOTHING. REVOKE is
-- idempotent. DROP is guarded with IF EXISTS. Re-apply is a no-op.
--
-- The VERIFY block at the tail is READ-ONLY (no BEGIN/UPDATE/ROLLBACK).
--
-- ─── NO MONEY, NO NAMES, NO MERCHANTS IN THIS FILE ───────────────────
-- Seed rows carry (work_location_id, work_location_label, account_key,
-- excluded, note) only. Labels are site labels like "Jupiter, FL
-- (STL-FL)" which are fine (site name, not client name). No cardholder
-- names anywhere. No merchant names anywhere.


-- ═══════════════════════════════════════════════════════════════════
-- 1. DROP spend_department_site_map                       (wrong axis)
-- ═══════════════════════════════════════════════════════════════════
-- Populated by purchasing_rippling_sync as CANDIDATES with NULL
-- account_key on every row (Kevin never labelled any of them - and
-- rightly so per the owner ruling). Keeping an authoritative-looking
-- map that is wrong is a trap. Cascade catches any lingering FK
-- references (there are none in the schema today; belt-and-braces).

DROP TABLE IF EXISTS spend_department_site_map CASCADE;


-- ═══════════════════════════════════════════════════════════════════
-- 2. CREATE spend_work_location_site_map               (owner-maintained)
-- ═══════════════════════════════════════════════════════════════════
-- Owner-maintained. Keyed on work_location_id (Rippling opaque id).
-- work_location_label carried alongside for Kevin's convenience but is
-- NOT the join key at runtime.
--
-- account_key NULL + excluded=FALSE is the "unattributed - awaiting
-- label" state (used for the 3 null-work_location raw rows).
-- account_key NULL + excluded=TRUE is Remote / Corporate / HQ.
-- account_key non-NULL + excluded=FALSE is the labelled site row.
-- account_key non-NULL + excluded=TRUE is rejected by the check
-- constraint.

CREATE TABLE IF NOT EXISTS spend_work_location_site_map (
  work_location_id     TEXT PRIMARY KEY,
  work_location_label  TEXT,
  account_key          TEXT,
  excluded             BOOLEAN NOT NULL DEFAULT FALSE,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spend_work_location_site_map_excluded_shape
    CHECK (NOT (excluded = TRUE AND account_key IS NOT NULL))
);


-- ═══════════════════════════════════════════════════════════════════
-- 3. Index spend_work_location_site_map by label       (report join aid)
-- ═══════════════════════════════════════════════════════════════════
-- Non-unique - see above (12 ids share label "Remote").

CREATE INDEX IF NOT EXISTS spend_work_location_site_map_label_idx
  ON spend_work_location_site_map (work_location_label);


-- ═══════════════════════════════════════════════════════════════════
-- 4. Grants                                             (service_role)
-- ═══════════════════════════════════════════════════════════════════
-- SELECT + INSERT + UPDATE - Kevin labels, sync populates. No DELETE.

GRANT SELECT, INSERT, UPDATE ON spend_work_location_site_map TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 5. REVOKE TRUNCATE                                (standing lesson)
-- ═══════════════════════════════════════════════════════════════════
-- Money-adjacent map (attribution axis). Same fence as purchasing-1
-- placed on the raw + actuals tables. Idempotent.

REVOKE TRUNCATE ON spend_work_location_site_map FROM anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 6. Seed spend_work_location_site_map                  (owner rulings)
-- ═══════════════════════════════════════════════════════════════════
-- 13 labels observed today + 12 Remote id variants = 26 rows total.
-- ON CONFLICT DO NOTHING so re-apply is a no-op.
--
-- work_location_id values are the opaque Rippling ids observed in
-- rippling_raw_spend_lines_latest on 2026-08-19.
-- account_key values are KitchFix account keys per spec.
--
-- Note the three labels whose parenthesised suffix does NOT equal our
-- account key:
--   Arlington, TX (TXR-HOME)             -> TXR - TX - H
--   Arlington, TX Visitor (TXR-VISITOR)  -> TXR - TX - V
--   Buffalo, NY (TBJ-BUF)                -> TBJ - NY
-- A runtime parser would produce "TXR-HOME" / "TXR-VISITOR" / "TBJ-BUF"
-- and miss the map. Explicit seed avoids that class of bug.

INSERT INTO spend_work_location_site_map
  (work_location_id, work_location_label, account_key, excluded, note) VALUES
  ('5fd0ff0083480900d2098801', 'Englewood, FL/Port Charlotte, FL (TBR-FL)',   'TBR - FL',     FALSE, 'owner ruling 2026-08-18'),
  ('61953763dc6af3048edd1698', 'Surprise, AZ (TXR-AZ)',                       'TXR - AZ',     FALSE, 'owner ruling 2026-08-18'),
  ('69179ad8210e99f5ca378716', 'Jupiter, FL (STL-FL)',                        'STL - FL',     FALSE, 'owner ruling 2026-08-18'),
  ('5c13e4086ab9e235e4e707be', 'Dunedin, FL (TBJ-FL)',                        'TBJ - FL',     FALSE, 'owner ruling 2026-08-18'),
  ('601c9f2805fa6f9640978ef7', 'Goodyear, AZ (CIN-AZ)',                       'CIN - AZ',     FALSE, 'owner ruling 2026-08-18'),
  ('5e3ecb7c8a9f4e35f4b22c6a', 'Arlington, TX (TXR-HOME)',                    'TXR - TX - H', FALSE, 'owner ruling 2026-08-18 - label suffix TXR-HOME resolves to TXR - TX - H'),
  ('67a52de4d8c6991431b36df2', 'St. Louis, MO (STL-MO)',                      'STL - MO',     FALSE, 'owner ruling 2026-08-18'),
  ('66a3b7c7c6e4b91ff923a5fa', 'Cincinnati, OH (CIN-OH)',                     'CIN - OH',     FALSE, 'owner ruling 2026-08-18'),
  ('6881444a5dadb8e1598c7a68', 'Arlington, TX Visitor (TXR-VISITOR)',         'TXR - TX - V', FALSE, 'owner ruling 2026-08-18 - label suffix TXR-VISITOR resolves to TXR - TX - V'),
  ('65dcfc120d15b3daa1037c1e', 'Louisville, KY (CIN-KY)',                     'CIN - KY',     FALSE, 'owner ruling 2026-08-18'),
  ('5c9a224d92dabb4cbe24a781', 'Buffalo, NY (TBJ-BUF)',                       'TBJ - NY',     FALSE, 'owner ruling 2026-08-18 - label suffix TBJ-BUF resolves to TBJ - NY'),
  ('674f7561bdd0f54665237b26', 'Corporate (CORP)',                             NULL,          TRUE,  'owner ruling 2026-08-18 - excluded by construction'),
  ('5c05aa61d2a5f837ee651c1e', 'Headquarters & Chicago Commissary Kitchen',   NULL,          TRUE,  'owner ruling 2026-08-18 - excluded by construction'),
  ('688142741ac512185a155f36', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('688141f90f7d769a5e9454d9', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('68814218178ce31372432089', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('6937146cfee99b45793fd7e5', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('619535efa5d797bee1ec9ac3', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('6881417367f1b1677b1fc4eb', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('6a356e58e3fbd29781d88739', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('643978713ca2f6c8a9c8fb5f', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('688141a0c4d26deefbbfacc3', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('686fcc8b707a6b7fb3457282', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('642c85e0aa29ccb6b3382cc4', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site'),
  ('68814132e69bbd42ff431fd9', 'Remote',                                       NULL,          TRUE,  'owner ruling 2026-08-18 - Remote is not a site')
ON CONFLICT (work_location_id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
-- 7. Table comment                              (self-documenting)
-- ═══════════════════════════════════════════════════════════════════

COMMENT ON TABLE spend_work_location_site_map IS
  'The attribution axis for Rippling card spend (owner ruling 2026-08-18). '
  'work_location_id -> account_key. Excluded rows (Remote, Corporate, HQ) carry '
  'account_key NULL - they never sum into a site. Multiple ids can share a label '
  '(12 Remote ids observed today); the id is the key, the label is a convenience.';


-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
--                    (READ-ONLY: no BEGIN/UPDATE/ROLLBACK)
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
-- V1. Old map is gone. Expected: zero rows.
--
-- SELECT c.relname
-- FROM pg_class c
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public' AND c.relname = 'spend_department_site_map';
--
-- V2. New map exists.
--
-- SELECT c.relname
-- FROM pg_class c
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public' AND c.relname = 'spend_work_location_site_map';
--
-- V3. Seed rows landed. Expected: 25 rows.
--     13 labelled (11 sites + 2 site-mapped-with-non-standard-suffix, all
--     account_key non-null) + 3 excluded-by-label (Remote/Corporate/HQ)
--     one row each ... but note Remote is 12 rows because 12 ids share the
--     label. So the expected row count breakdown is:
--       11 sites with account_key non-null (mapped)
--       12 Remote rows excluded (all 12 distinct ids)
--        1 Corporate row excluded
--        1 HQ/Chicago row excluded
--     -----
--       25 total, 11 mapped (account_key non-null), 14 excluded
--
-- SELECT COUNT(*) AS total,
--        COUNT(account_key) AS mapped,
--        SUM(CASE WHEN excluded THEN 1 ELSE 0 END) AS excluded_count
-- FROM spend_work_location_site_map;
--
-- V4. Check constraint holds. Expected: zero rows.
--
-- SELECT work_location_id, account_key, excluded
-- FROM spend_work_location_site_map
-- WHERE excluded = TRUE AND account_key IS NOT NULL;
--
-- V5. REVOKE TRUNCATE landed. Expected: zero rows.
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'spend_work_location_site_map'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'TRUNCATE';
--
-- V6. Coverage of the observed axis. Expected: every non-null
--     work_location_id in rippling_raw_spend_lines_latest is present
--     in the map (zero unmapped).
--
-- SELECT COUNT(DISTINCT work_location_id) AS raw_ids,
--        COUNT(DISTINCT s.work_location_id) AS mapped_ids,
--        COUNT(DISTINCT work_location_id) - COUNT(DISTINCT s.work_location_id) AS gap
-- FROM rippling_raw_spend_lines_latest r
-- LEFT JOIN spend_work_location_site_map s USING (work_location_id)
-- WHERE r.work_location_id IS NOT NULL;
--
-- V7. Re-apply is a no-op. Run this file a second time in Studio.
--     DROP IF EXISTS + CREATE IF NOT EXISTS + INSERT ON CONFLICT DO
--     NOTHING + GRANT (already-held) + REVOKE (already-not-held). Note
--     the DROP branch will not fire on re-apply because the table
--     already exists again from the first apply. Expected: no errors,
--     no row-count change.


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills below AFTER applying (one statement at a time) in
-- Supabase Studio. The migration-gate check on the PR looks for the
-- phrase `applied in Studio: YES` in a comment from an OWNER account.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- notes:              <optional - any statement that needed manual attention>
