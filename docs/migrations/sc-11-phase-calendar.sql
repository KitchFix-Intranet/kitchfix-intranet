-- ═══════════════════════════════════════════════════════════════════════
-- sc-11-phase-calendar.sql (F6, 2026-07-10)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Adds sc_phase_calendar - a per-account, per-year table of PDC phase
-- date ranges. Deliberately minimal: this is the DATA FOUNDATION for
-- the BY PHASE export table (render Q, F6). No app UI, no classifier
-- involvement, no tile status changes - the phase lens in the SC app
-- stays parked until a future bundle wires it in.
--
-- Source of truth: docs/SC_PDC_PHASES.md (2026-07 recon + Kevin-approved
-- inferences). Only 5 accounts are PDC and get seeded here:
--   CIN-AZ  - Camp Name column, Projections + Actuals match (13 rows)
--   TXR-AZ  - Projections Camp Name column canonical (10 rows)
--   TBR-FL  - Projections Camp Name column canonical, cleanest (9 rows)
--   TBJ-FL  - Inferred simple calendar, KEVIN-APPROVED 2026-07-10 (8 rows)
--   STL-FL  - Inferred simple calendar, KEVIN-APPROVED 2026-07-10 (8 rows)
--                                                                   ---
--                                                             Total: 48
--
-- Phase names are stored VERBATIM as recorded (or, for the two inferred
-- accounts, as the Kevin-approved TBR-peer arc). The alias -> canonical
-- vocab in docs/SC_PDC_PHASES.md line 118 is explicitly "to finalize
-- when Stage 2 is scoped" - we do not preempt that decision here. The
-- BY PHASE export displays whatever the operator's spreadsheet used,
-- which reads correctly in their own language.
--
-- HOW TO APPLY:
--   1. Paste this entire file into Supabase Studio SQL editor.
--   2. Run the pre-verify SELECT block below FIRST to check current state
--      (expect: table does not exist / zero rows).
--   3. Run the CREATE TABLE + all INSERT blocks in one shot.
--   4. Run the post-verify SELECT block to check row counts + span
--      sanity (expected values annotated inline).
--
--   Danger-zone rule per docs/GOTCHAS.md: migrations DO NOT auto-apply
--   on deploy. Kevin runs this manually at merge time. If the SQL is
--   NOT applied and the code queries sc_phase_calendar (the export's
--   BY PHASE block), the block falls through the defensive omit branch
--   and the workbook is byte-identical to pre-F6 - a safe degradation
--   pattern shared with P3.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── PRE-VERIFY (run first; expect table missing / zero rows) ────────
-- SELECT COUNT(*) FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'sc_phase_calendar';
--   -- expect: 0 (table does not exist yet)


-- ─── SCHEMA ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_phase_calendar (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key  TEXT NOT NULL CHECK (
                 account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                 OR account_key = 'CORP'
               ),
  phase        TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_phase_calendar_account_dates
  ON sc_phase_calendar (account_key, start_date, end_date);

COMMENT ON TABLE sc_phase_calendar IS
  'PDC phase date-range calendar. F6 foundation. Populated from '
  'docs/SC_PDC_PHASES.md. Phase names stored as-recorded per the '
  'operator spreadsheets; canonical vocab is a Stage 2 concern.';

-- RLS disabled (matches the rest of sc_*; auth is at the Next.js route).
ALTER TABLE sc_phase_calendar DISABLE ROW LEVEL SECURITY;

GRANT SELECT ON sc_phase_calendar TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sc_phase_calendar TO service_role;


-- ─── SEED DATA ───────────────────────────────────────────────────────
-- All rows for fiscal 2026 (season straddles calendar year - starts
-- 2025-12-29 for OFF, ends 2026-12-20 for OFF). Ordered by start_date
-- per account.

-- CIN-AZ (Cincinnati Reds, Goodyear AZ) - 13 rows.
-- Camp Name column canonical; Projections and Actuals match exactly.
INSERT INTO sc_phase_calendar (account_key, phase, start_date, end_date) VALUES
  ('CIN - AZ', 'OFF',                '2025-12-29', '2026-01-03'),
  ('CIN - AZ', 'Battery Camp',       '2026-01-04', '2026-01-11'),
  ('CIN - AZ', 'Fantasy Camp',       '2026-01-12', '2026-01-18'),
  ('CIN - AZ', 'Early Camp',         '2026-01-19', '2026-02-08'),
  ('CIN - AZ', 'MLB ST',             '2026-02-09', '2026-03-22'),
  ('CIN - AZ', 'ST',                 '2026-03-23', '2026-04-01'),
  ('CIN - AZ', 'Extended',           '2026-04-02', '2026-05-17'),
  ('CIN - AZ', 'ACL',                '2026-05-18', '2026-07-15'),
  ('CIN - AZ', 'ACL/Draft',          '2026-07-16', '2026-07-20'),
  ('CIN - AZ', 'ACL',                '2026-07-21', '2026-07-26'),
  ('CIN - AZ', 'Bridge',             '2026-07-27', '2026-08-23'),
  ('CIN - AZ', 'Instructs/Camps',    '2026-08-24', '2026-11-15'),
  ('CIN - AZ', 'OFF',                '2026-11-16', '2026-12-20');

-- TXR-AZ (Texas Rangers, Surprise AZ) - 10 rows.
-- Projections tab canonical (Actuals lacks Camp Name column).
-- Note: the Feb 20 - Mar 22 window is recorded as per-day game-type
-- labels (Home game / Away game / Split squad / etc.). Per the doc's
-- line 60 ruling, treat that window as "ST Workouts" (a "Spring
-- Training" phase equivalent to CIN's "MLB ST"). The per-day labels
-- are operational overlay, not phase truth.
INSERT INTO sc_phase_calendar (account_key, phase, start_date, end_date) VALUES
  ('TXR - AZ', 'Staff/Rehab',        '2025-12-29', '2026-02-08'),
  ('TXR - AZ', 'ST Workouts',        '2026-02-09', '2026-02-19'),
  ('TXR - AZ', 'ST Workouts',        '2026-02-20', '2026-03-22'),
  ('TXR - AZ', 'Extended',           '2026-03-23', '2026-06-14'),
  ('TXR - AZ', 'ACL',                '2026-06-15', '2026-08-30'),
  ('TXR - AZ', 'Bridge',             '2026-08-31', '2026-09-27'),
  ('TXR - AZ', 'Instructs',          '2026-09-28', '2026-11-15'),
  ('TXR - AZ', 'OFF',                '2026-11-16', '2026-11-22'),
  ('TXR - AZ', 'Staff/Rehab',        '2026-11-23', '2026-12-13'),
  ('TXR - AZ', 'OFF',                '2026-12-14', '2026-12-20');

-- TBR-FL (Tampa Bay Rays, Port Charlotte FL) - 9 rows.
-- Cleanest calendar of all 5. Projections tab canonical.
INSERT INTO sc_phase_calendar (account_key, phase, start_date, end_date) VALUES
  ('TBR - FL', 'OFF',                '2025-12-29', '2026-01-04'),
  ('TBR - FL', 'Camps',              '2026-01-05', '2026-02-08'),
  ('TBR - FL', 'ST',                 '2026-02-09', '2026-03-29'),
  ('TBR - FL', 'Extended',           '2026-03-30', '2026-04-26'),
  ('TBR - FL', 'FCL',                '2026-04-27', '2026-07-26'),
  ('TBR - FL', 'Bridge',             '2026-07-27', '2026-09-27'),
  ('TBR - FL', 'Rehab',              '2026-09-28', '2026-10-11'),
  ('TBR - FL', 'Camps',              '2026-10-12', '2026-11-22'),
  ('TBR - FL', 'OFF',                '2026-11-23', '2026-12-20');

-- TBJ-FL (Toronto Blue Jays, Dunedin FL) - 8 rows.
-- Camp Name column mostly blank - inferred TBR-peer simple arc,
-- KEVIN-APPROVED 2026-07-10 via CC F6 gate question.
-- Known deviation folded into OFF: two ~5-day windows of ~100 weekday
-- covers in late Nov / early Dec are NOT surfaced here (revisit as
-- Staff/Rehab if the tint should reflect that activity).
INSERT INTO sc_phase_calendar (account_key, phase, start_date, end_date) VALUES
  ('TBJ - FL', 'OFF',                '2025-12-29', '2026-01-04'),
  ('TBJ - FL', 'Camps',              '2026-01-05', '2026-02-08'),
  ('TBJ - FL', 'ST',                 '2026-02-09', '2026-03-22'),
  ('TBJ - FL', 'Extended',           '2026-03-23', '2026-04-26'),
  ('TBJ - FL', 'FCL',                '2026-04-27', '2026-07-26'),
  ('TBJ - FL', 'Bridge',             '2026-07-27', '2026-09-27'),
  ('TBJ - FL', 'Camps',              '2026-09-28', '2026-11-22'),
  ('TBJ - FL', 'OFF',                '2026-11-23', '2026-12-20');

-- STL-FL (St Louis Cardinals, Jupiter FL) - 8 rows.
-- Flat-fee billing but operationally PDC-shaped; identical arc to
-- TBJ-FL (both accounts run the same TBR-peer shape at different
-- volumes). KEVIN-APPROVED 2026-07-10 via CC F6 gate question.
INSERT INTO sc_phase_calendar (account_key, phase, start_date, end_date) VALUES
  ('STL - FL', 'OFF',                '2025-12-29', '2026-01-04'),
  ('STL - FL', 'Camps',              '2026-01-05', '2026-02-08'),
  ('STL - FL', 'ST',                 '2026-02-09', '2026-03-22'),
  ('STL - FL', 'Extended',           '2026-03-23', '2026-04-26'),
  ('STL - FL', 'FCL',                '2026-04-27', '2026-07-26'),
  ('STL - FL', 'Bridge',             '2026-07-27', '2026-09-27'),
  ('STL - FL', 'Camps',              '2026-09-28', '2026-11-22'),
  ('STL - FL', 'OFF',                '2026-11-23', '2026-12-20');


-- ─── POST-VERIFY ────────────────────────────────────────────────────
-- Run this block AFTER the CREATE + INSERT blocks above.

-- Row counts per account (expected):
--   CIN - AZ = 13, TXR - AZ = 10, TBR - FL =  9,
--   TBJ - FL =  8, STL - FL =  8. Total: 48.
--
-- SELECT account_key, COUNT(*) AS rows
-- FROM sc_phase_calendar
-- GROUP BY account_key
-- ORDER BY account_key;

-- Overlap sanity: within each account, phase spans must not overlap.
-- Expect zero rows returned - any row here indicates a seed bug.
--
-- SELECT a.account_key, a.phase AS phase_a, a.start_date AS a_start, a.end_date AS a_end,
--        b.phase AS phase_b, b.start_date AS b_start, b.end_date AS b_end
-- FROM sc_phase_calendar a
-- JOIN sc_phase_calendar b
--   ON a.account_key = b.account_key
--  AND a.id < b.id
--  AND a.start_date <= b.end_date
--  AND a.end_date   >= b.start_date
-- ORDER BY a.account_key, a.start_date;

-- Contiguity sanity: within each account, adjacent phase spans should
-- BUTT (end_date of row N + 1 day = start_date of row N+1) unless the
-- gap is a legitimate off-season boundary (all 5 accounts start their
-- fiscal year on the 2025-12-29 OFF row and end on the 2026-12-20 OFF
-- row, so there should be NO internal gaps in fiscal 2026).
--
-- Expect zero rows returned:
--
-- SELECT account_key, prev_end, next_start,
--        (next_start - prev_end) AS gap_days
-- FROM (
--   SELECT account_key,
--          end_date AS prev_end,
--          LEAD(start_date) OVER (PARTITION BY account_key ORDER BY start_date) AS next_start
--   FROM sc_phase_calendar
-- ) t
-- WHERE next_start IS NOT NULL
--   AND next_start <> (prev_end + INTERVAL '1 day')::DATE
-- ORDER BY account_key, prev_end;

-- Season span sanity: each account's phase calendar should span
-- 2025-12-29 through 2026-12-20 exactly.
--
-- SELECT account_key,
--        MIN(start_date) AS season_start,
--        MAX(end_date)   AS season_end
-- FROM sc_phase_calendar
-- GROUP BY account_key
-- ORDER BY account_key;
-- -- expect: all 5 rows: season_start = 2025-12-29, season_end = 2026-12-20.
