# SC STL - FL away-dining build report

**Date:** 2026-08-05
**Branch:** `feat/sc-stl-fl-away-dining`
**Scope:** STL - FL only. Jupiter (JUP, team 479) + St. Lucie (SLU, team 507) only.
**Structure:** two commits, gated separately.

---

## Operational fact this ships

The Palm Beach Cardinals share Roger Dean Stadium with the Jupiter Hammerheads,
and St. Lucie is a short bus ride from home. On MLB Stats API "away" days
against JUP or SLU the club still eats at the PDC, so those days are service
days for STL - FL - not away days.

Owner's rulings from the shape recon (all binding):
1. **Option B + F fold-in.** Load all 70 away games; annual reseed becomes
   home + away, single API pull, home filter removed. Non-qualifying away
   opponents stay invisible via a per-account opponent-ID map.
2. **Key on team ID.** 479 JUP, 507 SLU. Carry `opponent_team_id` on the
   row - backfilled on the existing home rows too.
3. **sc-17's header gets a dated append, not an edit to the body.**
4. **12 SLU dates project like JUP already does:** Pre-game=50, Post-Game=50.
   Two Sundays (Apr 26, May 24) also drop MiLB Breakfast + Lunch to 0.
5. **Do not gate on the period lock.** Numbers get corrected from actuals
   once the app is in use.

---

## Commit 1 - schedule + pill (SHIPPED)

**Commit:** `1d06b18 feat(sc): STL - FL away-dining schedule + copper Meals@Home pill`
**Push line:**
```
To https://github.com/KitchFix-Intranet/kitchfix-intranet.git
 * [new branch]      feat/sc-stl-fl-away-dining -> feat/sc-stl-fl-away-dining
```

### Files

- `docs/migrations/sc-28-stl-fl-away-dining.sql` **(new, 248 lines)**
  - Adds `opponent_team_id INTEGER` column to `sc_homestand_schedule`.
  - Backfills STL - FL + TBJ - FL home rows via FSL abbrev to team_id CASE.
  - Inserts 64 unique STL - FL AWAY rows for the 2026 FSL season (70 games
    minus 6 doubleheader-collapse duplicates - one row per date, sc-17
    convention).
  - Same `ON CONFLICT (account_key, service_date) DO UPDATE` as sc-17 so
    postponement shadow + DH-compression rules carry.
  - Verification query at file end asserts total=130, home=66, away=64,
    null_team_id=0, slu_away=12, jup_away=11, dh_rows=3.
- `src/app/service-calendar/v2/homeDiningAwayOpponents.js` **(new)**
  - `HOME_DINING_AWAY_OPPONENTS = Map<accountKey, Set<team_id>>`.
  - Follows `MLB_HOMESTAND_SURFACE_ACCOUNTS` precedent shape - explicit set,
    not a derived property, so future accounts opt in loud not silent.
- `src/lib/dataStore/serviceCalendar.js` **(loadScheduleOverlay widened)**
  - Reads GAME rows always + AWAY rows filtered by (account, opponent_team_id)
    map membership.
  - For accounts NOT in the map: byte-identical to pre-sc-28
    (`.eq("day_type", "GAME")`).
  - Return map carries new fields: `opponentTeamId`, `isAwayHomeDining`.
- `src/app/service-calendar/season/PeriodWorkspace.js` **(fee-no-dollar branch)**
  - Forwards `isAwayHomeDining` to `buildLargeContent` return payload.
- `src/app/service-calendar/DaySquare.js` **(renderFeeNoDollar)**
  - Chip copy switches: `at OPP - Meals@Home` (copper) when
    `isAwayHomeDining`, else `vs OPP` (blue) - existing home shape.
- `src/app/service-calendar/DaySquare.css` **(new copper-chip variant)**
  - `.sc-daysq-mid-opponent--away-home-dining` mirrors the home
    `--away` chip's geometry, swaps to copper tokens.
- `src/app/tokens.css` **(copper wash + line tokens)**
  - `--sc2-accent-copper-wash: #f9efe9;`
  - `--sc2-accent-copper-line: #e3c4b1;`
- `docs/migrations/sc-17-stl-fl-home-overlay.sql` **(dated append; body
  unmodified)**
  - Names the away-dining operational fact.
  - Points to sc-28 as the mechanism.
  - States the "non-qualifying AWAY rows stay invisible via the map"
    invariant so a future reader does not confuse home-overlay scope
    with schedule-overlay scope.

### 2026-08-05 syntax + count re-verification (owner review)

**Syntax fix.** The original sc-28 had `;` after the last `VALUES` tuple
followed by `ON CONFLICT (...)`. That terminated the INSERT and made
`ON CONFLICT` parse as a new statement (syntax error). Fix landed:
final `);` -> `)`, with the `;` now at the end of the
`WHERE sc_homestand_schedule.day_type IN ('GAME', 'AWAY');` line.

**Dedup reconciliation.** 70 raw AWAY games -> 64 unique service_dates.
6 collapses across THREE rules (not two doubleheaders alone):

| Rule | Date | Opp | Raw rows | What collapsed | Rows lost |
|---|---|---|---|---|---|
| A. Doubleheader compression | 2026-06-21 | JUP | 2 | game 1 + game 2, both gameDate 6/21 | 1 |
| A. Doubleheader compression | 2026-07-02 | LAK | 2 | game 1 + game 2, both gameDate 7/2 | 1 |
| B. Postponement shadow | 2026-06-21 | JUP | +1 | 6/20 original game postponed onto 6/21 as officialDate | 1 |
| B. Postponement shadow | 2026-07-02 | LAK | +1 | 7/1 original game postponed onto 7/2 as officialDate | 1 |
| C. Suspended-game duplicate | 2026-06-19 | JUP | 2 | suspension + resumption rows both officialDate 6/19 | 1 |
| C. Suspended-game duplicate | 2026-07-12 | DBT | 2 | suspension + resumption rows both officialDate 7/12 | 1 |

Totals: A(2) + B(2) + C(2) = 6. 70 - 6 = 64. Matches migration row
count exactly.

**Owner's June 20 / July 1 question, answered explicitly.**

- **2026-06-20** vs JUP: **postponed into the 2026-06-21 doubleheader.**
  API row: `officialDate=2026-06-21, gameDate=2026-06-20T20:05:00Z,
  status=Postponed, doubleHeader=N, gameNumber=1`. 6/20 is NOT a
  service day for STL - FL. Service surfaces on 6/21 as an
  `is_doubleheader=true` AWAY row.
- **2026-07-01** vs LAK: **postponed into the 2026-07-02 doubleheader.**
  API row: `officialDate=2026-07-02, gameDate=2026-07-01T22:30:00Z,
  status=Postponed, doubleHeader=N, gameNumber=1`. 7/1 is NOT a
  service day for STL - FL. Service surfaces on 7/2 as an
  `is_doubleheader=true` AWAY row.

Both correctly absent from the sc-28 INSERT list. Grep confirms:
`grep '2026-06-20' docs/migrations/sc-28-stl-fl-away-dining.sql`
returns nothing outside the comment block; same for `2026-07-01`.

**Header count re-verification against the actual VALUES.**

Count run against the migration file (post-fix):

```
$ grep -cE "'AWAY', 'SLU'" docs/migrations/sc-28-stl-fl-away-dining.sql
12
$ grep -cE "'AWAY', 'JUP'" docs/migrations/sc-28-stl-fl-away-dining.sql
11
$ grep -cE "'AWAY',.*true" docs/migrations/sc-28-stl-fl-away-dining.sql
2       # both DH away rows: 2026-06-21 JUP + 2026-07-02 LAK
$ grep -cE "^  \('STL - FL', '2026-" docs/migrations/sc-28-stl-fl-away-dining.sql
64
```

| Header claim | Value | Source |
|---|---|---|
| `total 130` | 130 | pre-sc-28 66 home + sc-28 64 away = 130 ✓ |
| `home 66` | 66 | sc-17 rows unchanged ✓ |
| `away 64` | 64 | INSERT VALUES tuple count ✓ |
| `null_team_id 0` | 0 | Step-2 backfill covers all STL - FL + TBJ - FL opponents; Step-3 INSERT populates opponent_team_id inline ✓ |
| `slu_away 12` | 12 | grep of INSERT VALUES ✓ |
| `jup_away 11` | 11 | grep of INSERT VALUES ✓ |
| `dh_rows 3` | 3 | sc-17 home DH 2026-05-13 (1) + sc-28 away DH 2026-06-21 (1) + sc-28 away DH 2026-07-02 (1) ✓ |

The header's `dh_rows 3` breakdown reads correctly: `2026-05-13 home +
2026-06-21 away + 2026-07-02 away`.

### Blast radius (unchanged from original)

Only three consumers read the schedule overlay for STL - FL:
- `loadScheduleOverlay` (this branch widens it)
- `PeriodWorkspace.buildLargeContent` (fee-no-dollar branch)
- `DaySquare.renderFeeNoDollar`

Other accounts + other kinds do not read the overlay - `.eq("day_type",
"GAME")` predicate is preserved for accounts NOT in the map.

**Gate before applying sc-28:**
- [ ] sc-28 pasted + applied in Studio.
- [ ] Verification query returns the expected shape (total=130, home=66,
      away=64, null_team_id=0, slu_away=12, jup_away=11, dh_rows=3).
- [ ] Owner posts the canonical confirmation phrase on the PR to flip
      the Migration gate green.

---

## Commit 2 - SLU projections

**Files (this commit):**
- `docs/migrations/sc-29-stl-fl-slu-away-projections.sql` **(new)**

**Structure follows sc-27 pattern:**
1. `CREATE TABLE IF NOT EXISTS sc_bak_stl_fl_slu_away_projections_2026`
   - Captures the 4-service x 12-date footprint (24 rows) so restore is
     byte-perfect and re-run is a no-op on the backup.
   - Load-bearing `IF NOT EXISTS`: re-run must not overwrite the undo
     with already-written values.
2. `INSERT` Palm Beach Cardinals Pre-game = 50 on the 12 SLU dates,
   `NOT EXISTS` guarded. Expected: 12 rows inserted.
3. `INSERT` Palm Beach Cardinals Post-Game = 50 on the 12 SLU dates,
   `NOT EXISTS` guarded. Expected: 12 rows inserted.
4. `UPDATE` MiLB Breakfast to 0 on Apr 26 + May 24 (defensive - already 0).
5. `UPDATE` MiLB Lunch to 0 on Apr 26 + May 24 (defensive - already 0).
6. `COMMIT` inside single BEGIN transaction.

**Service IDs used (by ID, never by name; sc-27 discipline):**
- PBC Pre-game: `2b6f20df-4a93-44af-89ea-ae750057efbc`
- PBC Post-Game: `834105fa-8832-4d35-95a7-aa483255ce17`
- MiLB Breakfast: `4a5c9241-1b54-4506-bcf7-d0e9d957c879`
- MiLB Lunch: `70a1e573-8757-44bb-a7e9-12ed6883fb22`

### Pre-write verification (read-only, ran against prod)

**JUP away needs nothing here (Ruling 1):** 11/11 JUP away dates
already carry Palm Beach Cardinals Pre-game=50 + Post-Game=50 on
STL - FL - the home projection stream already covered them because
Roger Dean is the Palm Beach Cardinals home venue.

```
=== JUP away (verify already-projected) ===
  2026-05-05  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-06  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-07  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-08  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-09  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-10  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: (all 0)  <- Sunday
  2026-06-16  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-06-17  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-06-18  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-06-19  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-06-21  PBC: Pre-game=50, Post-Game=50  MiLB-nonzero: (all 0)  <- Sunday
```

**SLU away is the write target (Ruling 4):** 0/12 SLU away dates
carry any Palm Beach Cardinals projection. Sunday MiLB shape already
applied on Apr 26 + May 24 (Breakfast + Lunch at 0).

```
=== SLU away (verify empty, expected write target) ===
  2026-04-21  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-04-22  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-04-23  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-04-24  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-04-25  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-04-26  PBC: (none)  MiLB-nonzero: (all 0)  <- Sunday, MiLB already zeroed
  2026-05-19  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-20  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-21  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-22  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-23  PBC: (none)  MiLB-nonzero: Breakfast=70, Lunch=70
  2026-05-24  PBC: (none)  MiLB-nonzero: (all 0)  <- Sunday, MiLB already zeroed
```

### Expected effects (on paste-and-run)

- **24 rows inserted** into `sc_daily_projections`:
  12 PBC Pre-game + 12 PBC Post-Game, all at 50, all tagged
  `updated_by = 'sc-29-slu-away-dining'`.
- **0 rows changed** on MiLB Breakfast + Lunch on the two Sundays
  (they are already at 0). The UPDATE runs anyway - it is what enforces
  the shape - but `IS DISTINCT FROM 0` short-circuits the write.
- **Backup table** `sc_bak_stl_fl_slu_away_projections_2026` created
  with 24 rows (the 24 MiLB rows in the footprint; PBC rows do not exist
  pre-write, so they are captured as an absence).

### Post-apply verification (V-blocks at end of sc-29.sql)

- **V1:** 24 rows returned, all `projected_count=50` on PBC services.
- **V2:** 4 rows per Sunday (Apr 26, May 24): MiLB Bkfst=0, MiLB Lunch=0,
  PBC Pre-game=50, PBC Post-Game=50.
- **V3:** JUP dates (11) untouched by sc-29 (`updated_by` NOT
  `sc-29-slu-away-dining`).
- **V4:** Backup rowcount = 24.

**Gate before applying sc-29:**
- [ ] sc-28 applied first (sc-29 does not depend on the schema, but the
      operational meaning of the projections depends on the schedule
      side being in place).
- [ ] sc-29 pasted + applied in Studio.
- [ ] V1-V4 return the expected shape.
- [ ] Owner posts the canonical confirmation phrase on the PR to flip
      the Migration gate green.

---

## What did NOT change

- No other accounts touched (STL - FL only).
- No other opponents extended into the map (JUP + SLU only for STL - FL).
- No actuals writes anywhere.
- No `has_homestand_schedule` flag changes.
- No `has_schedule_overlay` flag change on STL - FL (already true from sc-17).
- No period-lock gating change - the sc-29 write happens regardless of
  period status per Ruling 5, mirroring sc-27's one-time exception with
  the same reason.
- No JUP projection touches - already at 50/50.
- No Sunday MiLB touches on the current data - already at 0. The
  defensive `UPDATE ... WHERE projected_count IS DISTINCT FROM 0` clause
  makes this a documented no-op rather than a silent one.

---

## Standing labels

- `[ran]` - the read-only recon queries against prod (via probe script,
  deleted post-run).
- `needs-gate` - both sc-28 and sc-29 are Migration-gate-blocked; PR
  opens as DRAFT until owner applies + confirms in Studio.
