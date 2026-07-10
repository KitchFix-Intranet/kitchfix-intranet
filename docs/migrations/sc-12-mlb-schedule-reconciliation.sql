-- ═══════════════════════════════════════════════════════════════════
-- sc-12-mlb-schedule-reconciliation.sql
-- Service Calendar - reconcile sc_homestand_schedule to the 2026 MLB
-- promo PDFs + seed TXR spring-training exhibitions.
--
-- **Trust model (established 2026-07-10 addendum):** the 4 official MLB
-- promo-schedule PDFs are the plan of record. The Postgres seed was
-- outdated in two spots. Rainouts, postponements, doubleheaders, and
-- makeup dates are ops-domain and NOT encoded on the calendar.
--
-- Scope:
--   1. Expand day_type CHECK to include 'EXHIBITION' (R7).
--   2. CIN-OH 6/22-6/25 MIL series: DB was shifted +1 day (R3).
--   3. Seed TXR spring-training exhibitions 3/23 + 3/24 vs KC for
--      BOTH TXR-TX-H and TXR-TX-V per Q-d (R7).
--
-- Every other row in sc_homestand_schedule already matches the PDFs
-- under the PDF-as-truth trust model (verified 2026-07-10 via
-- /tmp/sc-audit/run_diff.py). See the reconciled per-account ledgers
-- in that audit dir for row-level evidence.
--
-- Apply in Supabase Studio (repo convention: migrations don't
-- auto-run on deploy). After paste + run, verify with the probe
-- block at the bottom (commented; uncomment to execute).
--
-- References:
--   - Trust-model brief:      2026-07-10 P3-A PDF-AS-TRUTH addendum
--   - Rulings R1-R7:          same brief, Section 2
--   - Prior audit report:     /tmp/sc-audit/SC_MLB_SCHEDULE_AUDIT_2026.md
--   - Per-account ledgers:    /tmp/sc-audit/{CIN-OH, STL-MO,
--                             TXR-TX-H, TXR-TX-V}_2026_home.md
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. day_type CHECK expansion (R7 prerequisite) ────────────────
-- The existing constraint was defined inline in sc-2-homestand-
-- schedule.sql without an explicit name, so PostgreSQL auto-named it
-- (typically sc_homestand_schedule_day_type_check). Look it up by
-- table + column at drop time rather than guessing the name.
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  WHERE conrelid = 'sc_homestand_schedule'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%day_type%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sc_homestand_schedule DROP CONSTRAINT %I', cons_name);
    RAISE NOTICE 'Dropped constraint %', cons_name;
  ELSE
    RAISE NOTICE 'No matching day_type CHECK found - assuming already dropped or renamed';
  END IF;
END $$;

ALTER TABLE sc_homestand_schedule
  ADD CONSTRAINT sc_homestand_schedule_day_type_check
  CHECK (day_type IN ('GAME','PREP','OPEN','CLOSE','CLEAN','EXHIBITION'));


-- ─── 2. CIN 6/22-6/25 MIL series: correct the 1-day shift (R3) ────
-- PDF's planned MIL series is Mon 6/22 - Wed 6/24 (3 games). DB was
-- seeded as 6/23-6/25 with 6/22 as PREP (with 180 covers pre-projected
-- + HOME/TBD meta - someone knew 6/22 was the game day but set day_type
-- wrong). Correction: swap the PREP and the 3rd GAME.
--
-- Apply as an atomic pair - either alone leaves the schedule
-- internally inconsistent (only 2 or 4 MIL games in HS8 instead of 3).

UPDATE sc_homestand_schedule
   SET day_type = 'GAME',
       opponent = 'MIL'
 WHERE account_key = 'CIN - OH'
   AND service_date = '2026-06-22'
   AND day_type = 'PREP';   -- idempotency guard: no-op if already GAME

UPDATE sc_homestand_schedule
   SET day_type = 'PREP',
       opponent = NULL
 WHERE account_key = 'CIN - OH'
   AND service_date = '2026-06-25'
   AND day_type = 'GAME'
   AND opponent = 'MIL';    -- idempotency guard: no-op if already PREP

-- Related sc_daily_projections rows may need re-attribution when the
-- day_type flips. Not touching them here - projected_total already
-- exists on both dates (6/22 has 180 covers per proj_gap.csv, 6/25 has
-- its own). If P3 needs a projections rebalance, it goes in a follow-
-- up migration; the day_type + opponent fix here is the load-bearing
-- calendar correction.


-- ─── 3. TXR exhibitions 3/23 + 3/24 vs KC, H + V (R7) ─────────────
-- Q-d: both clubhouses serve on Rangers home days (H = Rangers, V =
-- visiting team). Exhibitions are billed as separate catering outside
-- the contract; front-end will render them subtly distinct from GAME
-- and exclude them from contract-game rollups/KPIs (P3 front-end
-- requirement, not built here).
--
-- Homestand ID: EXH1 (distinct from HS1/HS2/... which are regular-
-- season homestands). Prevents accidental inclusion in per-homestand
-- rollups that filter on HS-prefixed IDs.

INSERT INTO sc_homestand_schedule
  (account_key, service_date, day_of_week, day_type, opponent, homestand_id)
VALUES
  ('TXR - TX - H', '2026-03-23', 'Monday',  'EXHIBITION', 'KC', 'EXH1'),
  ('TXR - TX - H', '2026-03-24', 'Tuesday', 'EXHIBITION', 'KC', 'EXH1'),
  ('TXR - TX - V', '2026-03-23', 'Monday',  'EXHIBITION', 'KC', 'EXH1'),
  ('TXR - TX - V', '2026-03-24', 'Tuesday', 'EXHIBITION', 'KC', 'EXH1')
ON CONFLICT (account_key, service_date) DO NOTHING;
-- ON CONFLICT: makes the seed idempotent. If any of these 4 rows
-- already exists (e.g. a partial run), the INSERT no-ops for that row.

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- POST-APPLY PROBES (commented; uncomment individually to run)
-- ═══════════════════════════════════════════════════════════════════
--
-- Probe A: verify the CIN 6/22-6/25 MIL shift landed
--
-- SELECT service_date, day_of_week, day_type, opponent, homestand_id
--   FROM sc_homestand_schedule
--  WHERE account_key = 'CIN - OH'
--    AND service_date BETWEEN '2026-06-22' AND '2026-06-25'
--  ORDER BY service_date;
--
-- Expected 4 rows:
--   2026-06-22  Monday    GAME  MIL   HS8   ← was PREP null before
--   2026-06-23  Tuesday   GAME  MIL   HS8
--   2026-06-24  Wednesday GAME  MIL   HS8
--   2026-06-25  Thursday  PREP  null  HS8   ← was GAME MIL before
--
--
-- Probe B: verify the TXR exhibitions seeded on BOTH accounts
--
-- SELECT account_key, service_date, day_of_week, day_type, opponent, homestand_id
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('TXR - TX - H', 'TXR - TX - V')
--    AND day_type = 'EXHIBITION'
--  ORDER BY account_key, service_date;
--
-- Expected 4 rows (2 per account, mirrored):
--   TXR - TX - H  2026-03-23  Monday   EXHIBITION  KC  EXH1
--   TXR - TX - H  2026-03-24  Tuesday  EXHIBITION  KC  EXH1
--   TXR - TX - V  2026-03-23  Monday   EXHIBITION  KC  EXH1
--   TXR - TX - V  2026-03-24  Tuesday  EXHIBITION  KC  EXH1
--
--
-- Probe C: Q-d parity for TXR H/V holds (symmetric-diff = 0)
--
-- WITH h AS (
--   SELECT service_date, day_type, opponent
--     FROM sc_homestand_schedule WHERE account_key = 'TXR - TX - H'
-- ),
-- v AS (
--   SELECT service_date, day_type, opponent
--     FROM sc_homestand_schedule WHERE account_key = 'TXR - TX - V'
-- )
-- SELECT 'H-only' AS side, service_date FROM h
--   EXCEPT SELECT 'H-only', service_date FROM v
-- UNION ALL
-- SELECT 'V-only', service_date FROM v
--   EXCEPT SELECT 'V-only', service_date FROM h;
--
-- Expected: zero rows returned.
--
--
-- Probe D: aggregate counts per account per day_type
--
-- SELECT account_key, day_type, COUNT(*)
--   FROM sc_homestand_schedule
--  WHERE account_key IN ('CIN - OH', 'STL - MO', 'TXR - TX - H', 'TXR - TX - V')
--  GROUP BY account_key, day_type
--  ORDER BY account_key, day_type;
--
-- Expected after migration:
--   CIN - OH     GAME=81, PREP=20, OPEN=2, CLOSE=2  (unchanged total; 6/22 flip is internal)
--   STL - MO     GAME=81, PREP=16, OPEN=2, CLOSE=2  (unchanged)
--   TXR - TX - H GAME=81, PREP=17, OPEN=1, CLOSE=2, EXHIBITION=2  (+2 EXH)
--   TXR - TX - V GAME=81, PREP=17, OPEN=1, CLOSE=2, EXHIBITION=2  (+2 EXH)
