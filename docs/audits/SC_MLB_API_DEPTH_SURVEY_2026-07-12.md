# MLB Stats API depth survey - PDC phases + adjacent ops capability (2026-07-12)

> **Frozen historical record.** Investigation completed 2026-07-12. Findings frozen at that date. Promoted from `/tmp` into the audits folder so the report has a durable home; the source-of-truth for phase boundaries remains `src/app/service-calendar/season/phaseCalendar.js`. Em-dashes normalized to hyphens per repo convention; content otherwise verbatim.
>
> **Consumers**: [`SC_STATUS.md`](../SC_STATUS.md) "January 2027 queue" cites this survey; [`modules/SERVICE_CALENDAR.md`](../modules/SERVICE_CALENDAR.md) references it under the phase integration section.

---

Read-only investigation. All findings against the live public API. Anchored on the question: can the API date/power the PDC year-phase framework already recorded in `phaseCalendar.js`, and what else does it offer beyond what sc-13->sc-18 already pulls?

## Task 0 - Phase representation IN the repo today

**A full phase framework already ships in-code.** Files:

- `src/app/service-calendar/season/phaseCalendar.js` - 8 canonical phases with tints + alias map + hardcoded per-account 2026 boundaries.
- `src/app/service-calendar/season/phaseDerivation.js` - reads the data layer above.
- `docs/SC_PDC_PHASES.md` - the source-of-truth doc the code was seeded from.
- `docs/migrations/sc-11-phase-calendar.sql` - sc-11 phase-calendar migration (already merged).
- `PeriodHeaderNav.js:32-41` - renders the phase pill in the drill-in chrome bar via `derivePhaseTimeline` + `derivePeriodPhase`.

Canonical phases (all present):
`off, prep (Camps), spring-training, extended, complex-league (ACL/FCL), bridge, instructional, rehab, unknown`.

Per-account 2026 status (`PER_ACCOUNT_2026` in `phaseCalendar.js`):

| Account | Boundary source | Blocks |
|---|---|---|
| CIN - AZ | Recorded from Sheets "Camp Name" column | 13 |
| TXR - AZ | Recorded from Sheets | 11 (Feb 20 - Mar 22 collapsed) |
| TBR - FL | Recorded from Sheets | 9 |
| **TBJ - FL** | **Kevin-approved peer-anchored (2026-07)** - TBR-FL arc as skeleton + cover-signal boundaries | 8 |
| **STL - FL** | **Kevin-approved peer-anchored (2026-07)** - same posture as TBJ-FL | 8 |

So the anchor question ("can the API date the phases?") has a specific target: TBJ-FL and STL-FL boundaries are the ones currently derived from peer-inference, not from any live signal. Every other account records via internal Sheets.

## Task 1 - /seasons endpoint (official brackets)

`GET /api/v1/seasons?sportId=<n>&season=2026`. All four leagues return; every date field populated.

| Field | MLB (sportId=1) | AAA (11) | FSL (14) | FCL (16) |
|---|---|---|---|---|
| preSeasonStartDate | 2026-01-01 | 2026-01-01 | 2025-12-15 | 2026-01-01 |
| preSeasonEndDate | 2026-02-19 | 2026-03-26 | 2026-04-01 | 2026-05-01 |
| springStartDate | 2026-02-20 | *(absent)* | *(absent)* | *(absent)* |
| springEndDate | 2026-03-24 | *(absent)* | *(absent)* | *(absent)* |
| seasonStartDate | 2026-02-20 | 2026-03-27 | 2026-04-02 | 2026-05-02 |
| regularSeasonStartDate | 2026-03-25 | 2026-03-27 | 2026-04-02 | 2026-05-02 |
| regularSeasonEndDate | 2026-09-27 | 2026-09-20 | 2026-09-06 | 2026-08-18 |
| postSeasonStartDate | 2026-09-28 | 2026-09-22 | 2026-09-08 | 2026-07-25 |
| postSeasonEndDate | 2026-10-31 | 2026-09-27 | 2026-09-19 | 2026-08-31 |
| offseasonStartDate | 2026-11-01 | 2026-09-28 | 2026-09-20 | 2026-09-01 |
| offSeasonEndDate | 2026-12-31 | 2026-12-31 | 2026-12-31 | 2026-12-31 |

**What this endpoint gives us** (clean, official, no derivation):

- **MLB Spring Training bracket** - Feb 20 → Mar 24. Exactly the "ST" phase for STL-FL/TBJ-FL/CIN-AZ (spring-training boundaries are IDENTICAL across the three because Grapefruit + Cactus start on the same calendar cadence).
- **FSL regular-season bracket** - Apr 2 → Sep 6. This IS the STL-FL/TBJ-FL "FCL"-labeled block boundary in the current recorded calendar (Apr 27 → Jul 26 in the code, which is derived from TBR-FL's recorded arc; the API says the FSL itself runs longer, Apr 2 → Sep 6, which suggests the recorded "FCL" block for STL/TBJ is actually undercounting the meaningful summer window).
- **FCL regular-season bracket** - May 2 → Aug 18. This IS the actual complex-league window. Confirmed by Task 3 below: FCL Cardinals + Blue Jays both play Apr 2 → Jul 23 in the API pull (slightly narrower than the season bounds because their team schedules end mid-July). Sitting inside the FCL season bracket.
- **AAA regular-season bracket** - Mar 27 → Sep 20. This matches sc-16's Louisville/Buffalo schedules.

**What the endpoint does NOT expose**:

- Extended Spring - no dedicated field. Derivable as the gap between MLB `springEndDate` and FSL `regularSeasonStartDate`: Mar 25 → Apr 1 for our accounts. Consistent with STL-FL/TBJ-FL current Mar 23 → Apr 26 "Extended" block, though the code's Extended runs 3-4 weeks longer than the API's implied gap (the recorded label captures the operational "Extended" that continues past FSL open until FCL open on May 2).
- Instructional League - no `instructionalStartDate` / `instructionalEndDate`. See Task 4.
- Camps (Battery / Fantasy / Early) - no fields. Camps are pre-February. Not on the API's radar.
- Bridge / Rehab / Staff - no fields. These are private-camp phases; API is game-league focused.

## Task 2 - Spring training coverage at OUR three complexes

`gameType=S` per MLB team (sportId=1). All three parent orgs pulled cleanly:

| Team | Games | Home | Away | Date range | dayNight coverage | TBD | Home venue lock |
|---|---|---|---|---|---|---|---|
| STL Cardinals (138) | 28 | 14 | 14 | 2026-02-21 → 03-22 | 100% (26 day / 2 night) | 0 | 14/14 @ Roger Dean Chevrolet Stadium |
| TOR Blue Jays (141) | 28 | 14 | 14 | 2026-02-21 → 03-22 | 100% (27 day / 1 night) | 0 | 14/14 @ TD Ballpark |
| CIN Reds (113) | 31 | 14 | 17 | 2026-02-21 → 03-24 | 100% (25 day / 6 night) | 0 | 14/14 @ Goodyear Ballpark |

**Findings**:

- Coverage is **100% clean** across every field the sc-17 overlay depends on (gameDate, dayNight, venue). Zero TBD, zero missing.
- Home-venue lock is 100% - every home spring game is at the org's designated complex. venue IDs isolate our-complex games perfectly.
- Date range matches `/seasons` MLB `springStartDate` / `springEndDate` within 1-2 days.
- CIN has 3 extra away games vs STL/TOR (31 vs 28) - Cactus League away schedule quirk. Doesn't affect home overlay.
- STL and TOR home games are **on our PDC's complex** (Roger Dean and TD Ballpark respectively) - same venue overlay accounts (STL-FL, TBJ-FL) already use for FSL.
- CIN home spring games are at Goodyear - this maps to **CIN - AZ**, an account that TODAY has zero schedule data of any kind.

Feasibility: extending the sc-17 overlay to spring games is **very tractable**. Same shape as sc-17b (per-club HOME rows, `has_schedule_overlay` flag). Palm Beach + Dunedin already flagged; adding CIN-AZ + STL-FL/TBJ-FL spring rows on top is additive.

## Task 3 - FCL (complex league) coverage

Team ID discovery via `/api/v1/teams?sportId=16`:

- FCL Cardinals - id=1370, venue "Roger Dean Stadium Complex (STL)", parent = St. Louis Cardinals.
- FCL Blue Jays - id=1390, venue "Bobby Mattick Complex", parent = Toronto Blue Jays.
- Also present in the same sport: DSL Cardinals/Blue Jays (Dominican Summer League) - international, not KF-operated.

FCL 2026 pulls (regular-season):

| Team | Games | Home | Away | Date range | dayNight | Home venue |
|---|---|---|---|---|---|---|
| FCL Cardinals (1370) | 61 | 31 | 30 | 2026-05-02 → 07-23 | 100% (61 day / 0 night) | 28 @ Roger Dean Stadium Complex, 2 @ Palm Beaches CACTI, 1 @ Roger Dean Chevrolet |
| FCL Blue Jays (1390) | 61 | 31 | 30 | 2026-05-02 → 07-23 | 100% (59 day / 2 night) | 27 @ Bobby Mattick, 4 @ TD Ballpark |

**Findings**:

- Coverage 100% on gameDate + dayNight + venue. TBD = 0.
- All FCL games are day games (as expected - complex-league games are practice-style morning/early-afternoon slots).
- **Home-venue semantics is real but split**: FCL Cardinals plays 28 games at their own complex + 3 at other venues (WSH complex + Roger Dean main stadium for a specific series). FCL Blue Jays plays 27 at Bobby Mattick + 4 at TD Ballpark (probably parent-org showcase games).
- Date range (May 2 → Jul 23) matches the FCL `regularSeasonStartDate` (May 2) but ends earlier than the FCL `regularSeasonEndDate` (Aug 18). Explanation: the pull returns only games in the API's snapshot of their schedule; some series haven't been published yet or they play shorter than the full season window.
- **This IS the summer-camp / FCL phase for STL-FL and TBJ-FL**. The current phase code puts FCL at Apr 27 → Jul 26 for both. API says May 2 → Jul 23. The recorded Apr 27 start captures the pre-FCL Extended tail (Extended runs to Apr 26); the July 26 end matches FCL end closely.

Feasibility for FCL overlay: same shape as sc-17b. STL-FL would get FCL Cardinals home rows; TBJ-FL would get FCL Blue Jays home rows. Kevin previously deferred this - it's still tractable and clean when he wants it.

## Task 4 - Instructional League

`/api/v1/gameTypes` returns 12 codes: **S** Spring Training, **R** Regular Season, **F** Wild Card, **D** Division Series, **L** League Championship Series, **W** World Series, **C** Championship, **N** Nineteenth Century Series, **P** Playoffs, **A** All-Star Game, **I** Intrasquad, **E** Exhibition.

**There is no `INSTRUCTIONAL` game type.** Instructs are traditionally closed-door practice/scrimmage - the API classifies them as "I" (Intrasquad) if at all, but a full-year pull of both FCL clubs returns 0 games outside the May-Jul window (0 fall games under sportId=16 for either team). Confirmed via all-gameTypes fetch: `gameTypes: {'R': 61}` - no S, no E, no I recorded.

**Verdict**: **NOT COVERED**. Instructs (Sep-Nov) will remain a peer-anchored / operator-recorded phase. A phase the API cannot date is a finding, not a failure - Kevin's phase code's `instructional` label stays sourced from Sheets / manual entry.

## Task 5 - Venue-centric pulls

`/api/v1/venues?sportId=<n>` returns venue metadata including IDs. The relevant venues:

| Venue | ID | Present in sportId=1 (MLB) | Present in sportId=14 (FSL) |
|---|---|---|---|
| Roger Dean Chevrolet Stadium (Jupiter) | 2520 | ✓ | ✓ |
| TD Ballpark (Dunedin) | 2536 | ✓ | ✓ |
| Goodyear Ballpark (Cactus) | 3834 | ✓ | - (Cactus complex, not FSL) |
| CACTI Park of the Palm Beaches | 5000 | ✓ | - |
| Bobby Mattick Complex | *(FCL-only, sportId=16)* | - | - |

Venue-filtered schedule DOES work: `/api/v1/schedule?sportId=<n>&venueIds=<id>&season=<yr>` returns all games at that venue.

Roger Dean 2026 example:
- **sportId=1 (MLB spring):** 30 games. 28 spring training + 2 exhibitions. Home teams: **STL Cardinals 15, Miami Marlins 15**. The Marlins share the complex for spring - captures co-tenants Kevin's brief flagged.
- **sportId=14 (FSL regular):** 137 games. Home teams: **Palm Beach Cardinals 66, Jupiter Hammerheads 71**. Two clubs, two overlays. Both share the venue.

**What this adds beyond team-scoped pulls**:

- **Building-activity view**: "everything happening AT this venue this season" - captures the Marlins spring games (STL-FL kitchen implication: increased venue foot traffic even on days that aren't Cardinals games), Jupiter Hammerheads' 71 FSL games (STL-FL kitchen operates on Hammerheads days too?), Cleveland's spring games at Goodyear (CIN-AZ implication same shape).
- Not a phase-boundary source, but potentially a **secondary overlay layer** - "our club has a home game" vs "the venue is active vs "the venue is dark today".

The kitchen decision - does STL-FL crew serve on days the venue is active but the Cardinals aren't home? - is domain knowledge Kevin has, not something the API answers. But the DATA to power that decision is fully queryable.

## Task 6 - Field/endpoint sweep (schedule game object)

A single schedule game (via hydrate=game,content,team,seriesStatus) has 30 top-level fields. The following are potentially ops-relevant BEYOND what sc-13→sc-18 already uses:

**Kitchen-adjacent, potentially useful**:

- **`scheduledInnings`**: 9 (standard) or 7 (DH twinbill). Distribution on PBC 2026: 127 × 9-inning, 9 × 7-inning. A 7-inning game = shorter service window; late-post-game meal earlier. Could feed a "shift-length" hint on DH days if kitchen ops needs it.
- **`gamesInSeries`**: PBC 2026 distribution: 6 (130 games) or 3 (6 games). "3" = a 3-game series. "6" is unusual - suggests longer FSL-scheduled series or the API's counting mid-series (needs verification). Could feed a "series-length" indicator for supply planning.
- **`seriesGameNumber`**: which game IN the series (1, 2, 3…). Would let the calendar mark "opening night of the series" vs "series finale" without further derivation.
- **`seriesDescription`**: "Regular Season", "Spring Training", etc. Redundant with gameType but human-readable.
- **`status.detailedState`**: distribution on PBC 2026 finished games: `Final` 84, `Postponed` 3, `Completed Early` 3, `Scheduled` 46. **`Completed Early`** is new - likely weather-shortened games (rain-out early). If the kitchen ops team needs to distinguish "went to 9 innings" vs "called after 5" (waste vs planned), this field distinguishes them retrospectively.
- **`officialDate`**: the DB-authoritative date. Typically matches `gameDate[:10]` but can differ across time zones. sc-13's extractor uses `bucketDate` from the `dates[]` wrapper which already handles this; noting it in case of edge-case.
- **`reverseHomeAwayStatus`**: rare flag (0 for STL-FL); indicates games where the "home" team is playing at the "away" venue (e.g., natural-disaster relocation). Non-issue in our accounts but worth knowing exists.
- **`ifNecessary`** + **`ifNecessaryDescription`**: playoff-adjacent - flags playoff games that only happen if the series requires them. Not relevant for FSL/AAA regular season (all "Normal Game" today). Would matter if Kevin ever adds MLB playoff overlays.

**Team-level metadata** (from `/api/v1/teams`):

- **`springLeague`**: e.g. `{name: "Grapefruit League", abbreviation: "GL"}` - distinguishes Grapefruit vs Cactus without inference.
- **`springVenue`**: `{id: 2520}` - the ORG's spring venue. **This directly maps the parent orgs to our PDC complexes** without any manual configuration: STL's springVenue.id = 2520 (Roger Dean = STL-FL); TOR's springVenue.id = 2536 (TD Ballpark = TBJ-FL); CIN's springVenue.id = 3834 (Goodyear = CIN-AZ). Any future PDC could be onboarded by fetching the parent org and reading `springVenue.id` - no docs lookup needed.

**Explicitly skipped per brief** (verified no ops leak):

- Standings, stats, players, broadcasts, tickets - all confirmed absent from operational usefulness for this survey.

**Rosters - honest paragraph**:

There ARE roster endpoints (`/api/v1/teams/<id>/roster`) returning names + positions + statuses. In principle, "40-man expanded during instructs" could hint at more bodies on-site. In practice, this is deeply disconnected from the KitchFix headcount signal: rosters don't include kitchen staff, don't include extended-camp bodies, don't distinguish rehab/injured (they'd list as "injured list" - meaningless for bodies-in-building), and even the total-org "how many players are around" is dwarfed by coaching / support-staff variance the API doesn't touch. **Default skeptical stance holds** - rosters are for player-facing tools, not ops-facing headcount planning. Only value would be a very-rough "roster count > N" as an ambient signal, and even then only if Kevin has a specific hypothesis about a phase where the roster count actually predicts kitchen volume.

---

# DELIVERABLE

## Phase-mapping table (per-phase, API dating capability)

| Phase | API can date? | Source | Evidence |
|---|---|---|---|
| Off-season (year-end) | Partial | `/seasons` `offseasonStartDate` / `offSeasonEndDate` | MLB Nov 1 → Dec 31; but "off" from an account perspective bleeds into December pre-camp. Approximate. |
| Camps (Battery / Fantasy / Early) | **Not covered** | - | Pre-February private-camp phase; API doesn't touch closed-door org activities. Stays Sheets-recorded. |
| Spring Training | **Yes, exactly** | `/seasons` MLB `springStartDate`/`EndDate` OR `gameType=S` team schedule | Feb 20 → Mar 24 (or 22 for teams whose ST closes 2 days early). 100% coverage on STL/TOR/CIN. |
| Extended Spring | Derivable | Gap between MLB `springEndDate` and FSL `regularSeasonStartDate` | Mar 25 → Apr 1 (API) vs current recorded Mar 23 → Apr 26. API brackets shorter - operational Extended lasts longer than the API-visible gap. |
| Complex League (FCL) | **Yes, well** | FCL `/schedule` for team OR FCL `/seasons` regularSeason bounds | FCL Cards + Jays: May 2 → Jul 23 game data, May 2 → Aug 18 season bounds. Matches current recorded FCL block closely (Apr 27 → Jul 26). |
| Bridge | **Not covered** | - | Between FCL end and Instructs start; no game-based signal. Stays Sheets-recorded / peer-anchored. |
| Instructional | **Not covered** | - | No game type, no fall dates surface in FCL sportId=16 pull. See Task 4. Stays Sheets-recorded. |
| Rehab / Staff | **Not covered** | - | Purely internal org activity. No API surface. |

**Anchor answer**: for STL-FL / TBJ-FL specifically - the API can date **2 of the 8** phase boundaries cleanly (Spring Training + Complex League). The remaining 6 stay peer-anchored / Sheets-recorded. That's a real reduction in guesswork for the two peer-inferred accounts but doesn't fully solve the phase-derivation problem.

## Capability list ranked by ops value

1. **Spring overlay for STL-FL / TBJ-FL / CIN-AZ** - **highest value, smallest lift** (small effort). Same shape as sc-17b. STL + TOR spring games at Roger Dean / TD Ballpark are additive-only on top of the existing sc-17b overlay flag. CIN-AZ would be a NEW account onto the overlay system - same migration + code shape as sc-17. Evidence: 100% coverage, 100% home-venue lock, 0 TBD, matches existing overlay architecture 1:1. Would give the two Kevin-approved-peer-anchored accounts their FIRST live-data-sourced phase boundary and give CIN-AZ its first schedule data ever.

2. **FCL overlay layer for STL-FL / TBJ-FL** - **medium value, small lift** (small effort). Same shape again. FCL Cardinals + Blue Jays home games only (Roger Dean Complex / Bobby Mattick). This layers a "there's a game today" signal on top of the FSL PBC / Dunedin schedule that STL-FL / TBJ-FL already carry. Adds granularity to the peer-derived "FCL" phase block. Evidence: 100% coverage, 31 home games each per season, day-only.

3. **Springvenue.id → account auto-mapping** - **low-friction cleanup** (tiny effort). Right now `docs/SC_SPREADSHEET_MAPPING.md` + `docs/SC_PDC_PHASES.md` carry the venue → account mapping manually. Reading `/api/v1/teams` at build/etl time and matching `springVenue.id` gives a data-driven mapping. Nice-to-have; not blocking.

4. **DH detection via `scheduledInnings === 7`** - **incremental fidelity** (tiny effort). Would let the calendar surface "7-inning DH game" as a shorter-service-window hint without needing operator input. Additive on top of the existing `is_doubleheader` flag from sc-16. Only useful if kitchen ops distinguishes 7-inning-DH shifts.

5. **Venue-activity view (co-tenants at Roger Dean / TD Ballpark / Goodyear)** - **medium value, medium lift** (medium effort). Would surface Miami Marlins spring at Roger Dean, Jupiter Hammerheads FSL season, Cleveland spring at Goodyear. Whether the kitchen serves on those days is Kevin's operational call, but the data supports the question. A second overlay layer distinct from "our team plays" - would need its own UI treatment (not the same as the sc-17 chip; more like "venue busy" ambient signal). Deferred until Kevin surfaces the ops question.

6. **`status.detailedState` post-game categorization** - **retrospective only** (small effort). Distinguishes "Final" (played to completion) vs "Postponed" vs "Completed Early" (rain-shortened). Would matter for after-action review of kitchen waste vs planned yield - Kevin decides if that's a report he wants.

7. **`seriesGameNumber` / `gamesInSeries`** - **calendar polish** (small effort). Enables "Game 1 of 3" markers on tiles without deriving. Nice for chef planning ("we're prepping for the series opener today"). Low priority.

8. **Rosters** - **skeptical** as flagged; would need a Kevin hypothesis before building. Default: no.

## What the API cannot do

- **Cannot date Camps** (Battery / Fantasy / Early) - pre-season closed-door org events don't show up.
- **Cannot date Bridge / Rehab / Staff / Extended-past-Apr 1** - the API's season bounds don't distinguish "operational extended" from "past-my-club's-FCL". Requires ops signal.
- **Cannot date Instructional League at all** - no game type, no fall game data. This is a real absence; instructs will stay Sheets-recorded indefinitely (unless the API adds it, which seems unlikely given traditional privacy).
- **Cannot see kitchen-relevant staff / rehab / extended-camp headcount** - rosters miss 90% of bodies-in-building; the API is player-facing.
- **Cannot distinguish "our kitchen serves" from "the team is home"** - this decision remains operational judgment. API gives the game facts; the "do we serve" call remains Kevin's + site-lead's.
- **Cannot handle DSL / international teams as PDC signals** - teams like DSL Cardinals / DSL Blue Jays exist in sportId=16 but play in the Dominican and don't touch our kitchens.

The negative space is real, and the phase framework already accommodates it - those Sheets-recorded phases don't need API replacement, they need to STAY recorded.
