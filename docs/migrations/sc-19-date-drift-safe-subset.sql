-- ═══════════════════════════════════════════════════════════════════
-- sc-19-date-drift-safe-subset.sql
-- Service Calendar - reconcile the collision-free + actuals-free subset
-- of Part 4's DATE_DRIFT bucket (see /tmp/txr_schedule_audit.md §P4.2).
--
-- Kevin's ruling (2026-07-14): fix DATE_DRIFT now with a split -
--   1. Rows whose corrected date is FREE           -> UPDATE now (this file).
--   2. Rows whose move creates a two-games-one-date -> wait for Option A.
--   3. GUARD: any drifted date carrying operator actuals -> SKIP + report.
--
-- The AAA MISSING_IN_DB rows (CIN - KY pk 816263 -> 2026-07-18 DH game #2;
-- TBJ - NY pk 816824 -> 2026-09-12 DH game #2) both target dates already
-- occupied by another hs row - Option A (array-valued homestandMap +
-- game_number column) is prerequisite. See §P4.5.
--
-- Classification input: scripts/_probe_sc_19_collision_check.mjs. Rerun
-- to verify assumptions still hold before applying (guard: date-drift
-- state may shift as MLB / MiLB publishes further postponements).
--
-- SAFE_NOW subset (this file): 1 row.
-- WAIT_OPTION_A subset (documented below, not applied): 13 rows.
-- GUARDED subset (documented below, not applied): 12 rows.
--
-- ── Why so few?
-- Per-meal accounts (AAA: CIN - KY, TBJ - NY; FSL: STL - FL, TBJ - FL)
-- have operators entering actuals every service day - so every date the
-- API postponed away from ALREADY carries actuals rows in
-- sc_daily_actuals. Kevin's guard rightly stops those from being silent-
-- rewrites; they need operator-ops review before any date rewrite.
-- MLB fee accounts have no per-day actuals (R5), but 5 of the 6 MLB
-- date-drifts collide with existing DH-partner rows on the target date.
-- The one that doesn't collide is the STL 7/23 case that hid in Part 1.
--
-- Migration-gate: single table, no schema change. Kevin runs in Studio.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- SAFE_NOW subset: 1 UPDATE
-- ────────────────────────────────────────────────────────────────────

-- STL - MO pk=823042 (Cardinals HOME vs ARI at Busch Stadium)
--   Original scheduled date: 2026-06-25 (Postponed).
--   Current API state:        2026-07-23 (Scheduled).
--   Target 2026-07-23 verified FREE (no other hs row for STL - MO on
--   that date; no sc_daily_actuals rows on 6/25 or 7/23).
--   This is the "STL 7/23" row that Part 1's DB->API walk missed and
--   Part 3's targeted probe surfaced. Moving to its API-current date
--   makes the tile land on the correct calendar day.
UPDATE sc_homestand_schedule
   SET service_date = '2026-07-23'
 WHERE account_key = 'STL - MO'
   AND game_pk = 823042
   AND service_date = '2026-06-25';    -- guard: only touch if still on the pre-fix date

COMMIT;

-- ── WAIT_OPTION_A subset (13 rows, NOT applied here) ────────────────
--
-- These rows' target dates already have another hs row for the same
-- account. Moving them today creates a two-games-one-date state that
-- sc_homestand_schedule cannot cleanly represent under the current shape
-- (single row per (account_key, service_date)). Option A introduces
-- game_number and array-valued homestandMap; the follow-up PR handles
-- these together with the DH secondaries and the AAA missing pks.
--
-- Format: account | pk | old_date -> new_date | ha/opp | collision partner
--
-- CIN - OH pk=824518 2026-05-22 -> 2026-05-23 HOME/STL   (partner pk=824516)
-- CIN - OH pk=824514 2026-05-24 -> 2026-08-17 HOME/STL   (partner pk=824478)
-- STL - MO pk=824518 2026-05-22 -> 2026-05-23 AWAY/CIN   (partner pk=824516)
-- STL - MO pk=823062 2026-05-05 -> 2026-07-07 HOME/MIL   (partner pk=823035)
-- STL - MO pk=824514 2026-05-24 -> 2026-08-17 AWAY/CIN   (partner pk=824478)
-- TBJ - NY pk=815998 2026-04-03 -> 2026-04-04 AWAY/OMA   (partner pk=815996)
-- TBJ - NY pk=815912 2026-04-16 -> 2026-04-17 AWAY/ROC   (partner pk=815917)
-- TBJ - NY pk=815840 2026-04-29 -> 2026-05-01 AWAY/SWB   (partner pk=815841)
-- TBJ - NY pk=815675 2026-05-23 -> 2026-05-24 AWAY/SYR   (partner pk=815674)
-- TBJ - NY pk=816932 2026-07-09 -> 2026-07-11 HOME/SWB   (partner pk=816935)
-- TBJ - FL pk=820655 2026-07-10 -> 2026-07-11 HOME/LAK   (partner pk=820651)
--
-- ── GUARDED subset (12 rows, NOT applied here) ──────────────────────
--
-- These rows have operator actuals on the source date, target date, or
-- both. Rewriting service_date under actuals silently reassigns the
-- operator's entries; refuses to do that without an ops review. Kevin
-- decides per-row whether the actuals should stay on the old date
-- (event happened there and just misclassified) or migrate to the new
-- date (event actually happened there per the API).
--
-- Format: account | pk | old_date -> new_date | ha/opp | (old_actuals, new_actuals)
--
-- CIN - KY pk=816286 2026-05-05 -> 2026-05-07 HOME/NAS   (5 old + 5 new)
-- CIN - KY pk=816276 2026-05-16 -> 2026-05-17 HOME/IND   (5 old + 5 new)
-- CIN - KY pk=816810 2026-05-19 -> 2026-05-20 AWAY/COL   (5 old + 5 new)
-- CIN - KY pk=816802 2026-05-22 -> 2026-05-23 AWAY/COL   (5 old + 5 new)
-- CIN - KY pk=816638 2026-06-16 -> 2026-06-17 AWAY/GWN   (5 old + 5 new)
-- CIN - KY pk=816643 2026-06-18 -> 2026-06-19 AWAY/GWN   (5 old + 5 new)
-- TBJ - NY pk=816975 2026-03-28 -> 2026-03-29 HOME/SWB   (6 old + 6 new)
-- TBJ - NY pk=816974 2026-04-07 -> 2026-04-08 HOME/SYR   (6 old + 6 new)
-- TBJ - NY pk=816964 2026-04-25 -> 2026-04-26 HOME/COL   (6 old + 6 new)
-- STL - FL pk=820419 2026-05-12 -> 2026-05-13 HOME/DBT   (3 old + 3 new)
-- TBJ - FL pk=820698 2026-04-02 -> 2026-04-04 HOME/BRD   (6 old + 5 new)
-- TBJ - FL pk=820676 2026-05-19 -> 2026-05-21 HOME/FTM   (6 old + 5 new)

-- ── Verify probes (run AFTER commit) ────────────────────────────────
--
-- (a) The one SAFE_NOW row should now be on 2026-07-23. Expect 1 row.
-- SELECT service_date, day_type, opponent, game_pk
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - MO' AND game_pk = 823042;
--
-- (b) The pre-fix date should no longer carry this pk. Expect 0 rows.
-- SELECT service_date, day_type, opponent, game_pk
--   FROM sc_homestand_schedule
--  WHERE account_key = 'STL - MO'
--    AND service_date = '2026-06-25' AND game_pk = 823042;
--
-- (c) Re-run scripts/_probe_sc_19_collision_check.mjs and confirm the
--   SAFE_NOW rollup drops to 0 rows (or reports whatever the API now says).
