# TXR Home/Away Schedule Audit vs MLB Stats API

> **Preserved 2026-07-14** from `/tmp/txr_schedule_audit.md`. Four-part audit (Part 1 TXR-only + Part 2 SCREEN trace + Bug A follow-up + Part 3 metadata + Part 4 AAA/FSL bidirectional + PPD/DH + projection alignment). Bug A's "surface" question was later resolved to the **SCREEN Month drill** (see `SC_STATUS.md` known-issues Bug A + Bug A follow-up §A). Contents from this point unchanged; header additions above are the only edit.

> **Status**: READ-ONLY diagnosis, 2026-07-13. Zero writes, zero fixes, zero migrations. Kevin rules on the fix.
>
> **Bottom line**: The DB matches the MLB Stats API for 2026 regular season TXR games at 156/162 (96.3%) exact + 6 code-style (`ARI` vs `AZ`) tolerable. **Kevin's "100% wrong" report is NOT SUPPORTED by DB-vs-API evidence.** The mechanism is either (a) a render / display issue in a UI layer not tested here, (b) Kevin comparing against a different source (Sheets HUB / Excel / screen), or (c) the pre-season spring gap - see finding §5. Every H/A assignment on regular season games is correct; no phantom rows, no missing rows, no time errors.

---

## §1 Our side

### Account resolution

TXR appears at MLB level as **two accounts** (this is a known intentional split per the `_extract_sc_13_away_schedule.mjs` header comment):

| team_key | name | level | has_homestand_schedule | has_schedule_overlay | active |
|---|---|---|---|---|---|
| `TXR - TX - H` | Texas Rangers Home | MLB | true | false | true |
| `TXR - TX - V` | Texas Rangers Visiting | MLB | true | false | true |
| `TXR - AZ` | Texas Rangers | PDC | false | false | true |

The PDC account (`TXR - AZ`) is Surprise, AZ spring facility - unrelated to the MLB schedule audit.

### `sc_homestand_schedule` shape

Columns: `id, account_key, service_date, day_of_week, day_type, opponent, homestand_id, created_at, game_pk, game_time, day_night, is_doubleheader`

**No `updated_at` column** - this table is insert-once / re-runnable-via-upsert per the seed script; no in-place mutations.

### TXR - TX - H rows (identical to TXR - TX - V, see finding §7)

- **Row count**: 164 (81 GAME + 81 AWAY + 2 EXHIBITION)
- **Date span**: 2026-03-23 → 2026-09-27
- **`created_at` distinct dates**: 2026-06-17, 2026-07-10, 2026-07-11 (three batches)
- **`homestand_id` distribution**: HS1-HS12 (12 homestands, 81 total home games)
- **`day_type`**: `EXHIBITION` (2), `AWAY` (81), `GAME` (81)
- **Times**: populated on all 81 GAME rows (TIMESTAMPTZ UTC); NULL on all 81 AWAY rows and both EXHIBITION rows

### Ingestion path

Grep of `sc_homestand_schedule` writers surfaces:
- `scripts/_seed_sc_homestand_schedule.mjs` - **DEPRECATED 2026-07-10** (sc-13). Guarded by `SC_HOMESTAND_SEED_ALLOW=1` env var. Only mirrored Sheets HUB `homestand_schedule` tab; would reintroduce PREP/OPEN/CLOSE rows, risk R6 opponent-code drift, blank `game_pk`. Not the current path.
- **`scripts/_extract_sc_13_away_schedule.mjs`** - CURRENT source of truth. Reads MLB Stats API for teamIds 113 (CIN), 138 (STL), 140 (TXR) and generates SQL INSERT block for `docs/migrations/sc-13-away-schedule-load.sql`.
- **`scripts/_extract_sc_15_home_game_time.mjs`** - backfills `game_time` on GAME rows post-sc-15 migration.
- Migration files: `sc-2-homestand-schedule.sql` (schema), `sc-12-mlb-schedule-reconciliation.sql`, `sc-13-away-schedule-load.sql`, `sc-15-home-game-time.sql`, `sc-16-milb-schedule-parity.sql`, `sc-17-stl-fl-home-overlay.sql`, `sc-17b-tbj-fl-home-overlay.sql`.

**The workflow is code-gen → Studio-paste, not a live sync.** Scripts read the MLB Stats API, format SQL, and Kevin pastes the block into a migration file that runs in Supabase Studio. Last plausible run: 2026-07-10 to 2026-07-11 per `created_at` batches.

**Critical comment from `_extract_sc_13_away_schedule.mjs`** (lines 30-34):
```
// TXR H and V are the SAME club (Rangers home clubhouse + visiting clubhouse
// both serve the same home stadium and follow the same 81/81 schedule
// per Q-d ruling).
const TEAMS = [
  { mlbId: 140, name: "Texas Rangers",       accounts: ["TXR - TX - H", "TXR - TX - V"] },
];
```

So both TXR accounts are seeded from the SAME API pull (teamId 140). By design.

---

## §2 Ground truth from MLB Stats API

### Team resolution

`https://statsapi.mlb.com/api/v1/teams?sportId=1` returns 30 teams. Rangers match:

```json
{
  "id": 140,
  "name": "Texas Rangers",
  "abbreviation": "TEX",
  "teamCode": "tex",
  "fileCode": "tex",
  "clubName": "Rangers",
  "venue": "Globe Life Field"
}
```

**teamId=140 confirmed. abbreviation="TEX"** (Kevin's expectation was correct.)

### 2026 schedule pull

`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=140&startDate=2026-02-15&endDate=2026-11-15&hydrate=team`

- **Total games**: 193
- **Distribution**: regular season (gameType=R): 162 · spring (S): 30 · exhibition (E): 1
- **Status**: 96 Final + 66 Scheduled (regular season only)
- **doubleHeader field**: `{"N": 162}` — zero DH flagged in 2026 as of this snapshot

### Timezone discipline

- **API `gameDate`**: ISO 8601 UTC (e.g. `2026-04-03T20:05:00Z`).
- **Our DB `game_time`**: `TIMESTAMPTZ` UTC (verified via SQL column type + row inspection).
- **Local date**: our DB `service_date` is the CENTRAL TIME local date. Example: DB row `service_date=2026-04-06, game_time=2026-04-07T00:05:00+00:00` = Apr 6 7:05 PM CT (Apr 7 UTC).
- **Conversion**: I convert API UTC to `America/Chicago` for comparison. All Rangers games are Central Time. Games hosted by ET or PT teams: I convert to CT for consistency with our DB convention.

TZ discipline in our DB is **correct** and matches the API's own convention.

---

## §3 The diff (TXR - TX - H, 162 regular season rows)

| Bucket | Count | Notes |
|---|---|---|
| **CLEAN** (exact match on H/A, opp, time) | **156** | 96.3% |
| **H_A_FLIPPED** (right date+opp, inverted venue) | **0** | zero flips |
| **WRONG_OPP** (true wrong opponent) | 0 | |
| **CODE_STYLE_OPP** (`ARI` vs `AZ` etc) | **6** | see below - not a bug |
| **WRONG_TIME** (delta > 5 min) | 0 | |
| **COSMETIC_TIME** (delta ≤ 5 min) | 0 | |
| **MISSING_IN_DB** | 0 | |
| **PHANTOM_IN_DB** | 0 | |
| **STALE_STATUS** (Postponed/Rescheduled) | 0 | |

### The 6 CODE_STYLE_OPP mismatches (all `ARI` vs `AZ`)

DB canonicalizes to `ARI` (standard baseball media abbreviation). MLB Stats API `team.abbreviation` field returns `AZ` (Arizona's `fileCode`). Same team, different code style.

```
DB: {date:2026-05-11, ha:GAME, opp:ARI, gp:822901}  API: {date:2026-05-11, ha:HOME, opp:AZ, ct_time:19:05}
DB: {date:2026-05-12, ha:GAME, opp:ARI, gp:822903}  API: {date:2026-05-12, ha:HOME, opp:AZ, ct_time:19:05}
DB: {date:2026-05-13, ha:GAME, opp:ARI, gp:822900}  API: {date:2026-05-13, ha:HOME, opp:AZ, ct_time:19:05}
DB: {date:2026-09-11, ha:AWAY, opp:ARI, gp:825036}  API: {date:2026-09-11, ha:AWAY, opp:AZ, ct_time:20:40}
DB: {date:2026-09-12, ha:AWAY, opp:ARI, gp:825035}  API: {date:2026-09-12, ha:AWAY, opp:AZ, ct_time:19:10}
DB: {date:2026-09-13, ha:AWAY, opp:ARI, gp:825033}  API: {date:2026-09-13, ha:AWAY, opp:AZ, ct_time:15:10}
```

The `_extract_sc_13_away_schedule.mjs` header explicitly documents this: "Verified against docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md" with an MLB team_id → DB canonical opponent code map (`ARI/AZ`, `ATH/OAK` normalization).

### Mid-season spot check (Jul 6-19 2026)

```
Date       | DB day_type | DB opp | DB CT time | API home/away | API opp | API CT time | Match?
2026-07-06 | (both empty - off day)
2026-07-07 | GAME        | LAA    | 19:05      | HOME          | LAA    | 19:05      | YES
2026-07-08 | GAME        | LAA    | 19:05      | HOME          | LAA    | 19:05      | YES
2026-07-09 | GAME        | LAA    | 19:05      | HOME          | LAA    | 19:05      | YES
2026-07-10 | GAME        | HOU    | 19:05      | HOME          | HOU    | 19:05      | YES
2026-07-11 | GAME        | HOU    | 18:05      | HOME          | HOU    | 18:05      | YES
2026-07-12 | GAME        | HOU    | 13:35      | HOME          | HOU    | 13:35      | YES
2026-07-13 | (both empty - off day)
2026-07-14 | (both empty - off day)
2026-07-15 | (both empty - off day)
2026-07-16 | (both empty - off day)
2026-07-17 | AWAY        | ATL    | (null)     | AWAY          | ATL    | 18:15      | YES
2026-07-18 | AWAY        | ATL    | (null)     | AWAY          | ATL    | 15:10      | YES
2026-07-19 | AWAY        | ATL    | (null)     | AWAY          | ATL    | 12:35      | YES
```

Every date-in-either-source matches exactly.

---

## §4 Mechanism verdict

**Bucket shape: 156 CLEAN + 6 code-style + 0 everything else.** The DB is CLEAN vs the MLB Stats API ground truth for TXR 2026 regular season.

**Kevin's "100% wrong" report is not supported by DB-vs-API evidence.** The DB has:
- Correct home/away for all 162 games.
- Correct opponents (except `ARI` vs `AZ` code style, which is a documented normalization the DB is doing intentionally).
- Correct game times to the minute on all 81 home games.
- Correct doubleheader flag (0, matching API's 0).
- Correct game_pk on all 162 rows (100% game_pk match rate to API).

If Kevin sees "100% wrong" in the RUNNING SYSTEM, the mechanism is downstream of the DB. Candidates in order of likelihood:

1. **UI / print render**: a variant of the season / month sheet renders TXR games with a bug (H/A inverted at render time, times shifted by a bad TZ conversion, spring games missing, etc). This audit did NOT test rendered output — only DB state. This is the most likely culprit given the DB is clean.
2. **Different data source**: Kevin might be looking at the Sheets HUB `homestand_schedule` tab (the deprecated seeder source), which is stale post-sc-13. The DB has been rebuilt from the API; the Sheets HUB may still show old / wrong data.
3. **Different account key**: Kevin may have been looking at `TXR - AZ` (PDC, the spring facility) rather than `TXR - TX - H/V` (MLB). `TXR - AZ` has no schedule flag and no rows in `sc_homestand_schedule`.
4. **Spring gap** (see §6): API has 30 spring games; DB has 2 EXHIBITION rows. If Kevin was looking at March, he'd see a large gap — but that's a coverage bug, not a "100% wrong" bug.

**NOT LIKELY**: wholesale H/A inversion (would show 162 H_A_FLIPPED, we have 0), TZ offset (would show every time off by some constant, we have 0 time errors), stale 2025 snapshot (game_pks are 2026-season keys), wrong team entirely (Rangers-specific opponents like LAA, HOU, ATH appear).

---

## §5 Blast-radius sample

Per Kevin's brief, sampled the other MLB homestand accounts to decide whether the eventual (still-undefined) fix is TXR-scoped or systemic. **AAA accounts (CIN - KY, TBJ - NY) are out of scope** per the brief — those go through the MiLB API (different `sportId`), not `sportId=1`.

| Account | teamId | TZ | Rows | CLEAN | H_A_FLIPPED | WRONG_OPP | code-style | missing | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| CIN - OH | 113 | America/New_York (ET) | 162 reg | 156 | 0 | 0 | 6 | 0 | **CLEAN** |
| STL - MO | 138 | America/Chicago (CT) | 162 reg | 155 | 0 | 0 | 7 | 0 | **CLEAN** |
| TXR - TX - H | 140 | America/Chicago (CT) | 162 reg | 156 | 0 | 0 | 6 (ARI/AZ) | 0 | **CLEAN** |
| TXR - TX - V | 140 | America/Chicago (CT) | 162 reg | (identical to H) | 0 | 0 | 6 | 0 | **CLEAN** (duplicate of H) |

**All 4 MLB accounts CLEAN vs API.** The eventual fix wave (if there is one) is neither TXR-scoped nor systemic on the DB side — the DB is correct across the board. If Kevin sees "wrong" in the system, the bug is in a rendering / display layer that this audit didn't test.

---

## §6 Spring games gap

API has **30 spring games** (gameType=S, dates roughly Feb 21 - Mar 22) + 1 exhibition (gameType=E). Our DB has **2 EXHIBITION rows** (2026-03-23 and 2026-03-24, both vs KC, both `game_pk=null`).

**28 spring games in the API are absent from our DB.** These are Cactus League games at Surprise, AZ (the TXR - AZ facility) and various Cactus League opponents. If Kevin was looking at March and expected 30 games, he'd see near-nothing. But this is a coverage / scope decision, not a "100% wrong" bug — the current sc-13 loader is scoped to regular season only. Spring games arguably belong on the `TXR - AZ` PDC account's schedule, not the MLB account.

Flag for Kevin's ruling:
- Should the MLB accounts (`TXR - TX - H/V`) include spring games at all?
- Should spring games load to `TXR - AZ` instead?
- Currently: neither. Spring is missing from both places.

---

## §7 Duplicate account architecture (H+V)

`TXR - TX - H` and `TXR - TX - V` hold **identical data** (same 164 rows, same `created_at` batches, same schedule). This is by design per the `_extract_sc_13_away_schedule.mjs` comment (Kevin's Q-d ruling). The two accounts represent the Rangers **home clubhouse** and **visiting clubhouse** (KitchFix serves both), both operating at Globe Life Field on the same 81/81 schedule.

If Kevin was looking at one account and thought the schedule looked wrong because it showed AWAY games, that's expected — both clubhouses operate on all 162 days. AWAY days are legitimate service days for the home clubhouse (staff meals) and the visiting clubhouse (visiting team meals when Rangers travel? Or is TXR - TX - V not staffed on Rangers away days? Kevin knows the operational reality).

**Flag for Kevin's ruling**: is the H+V duplicate account model still the right shape post-sc-13? If both accounts always mirror, one is redundant OR the two accounts should carry different data (e.g., TXR - TX - V is only staffed when a visiting team is playing at Globe Life Field, i.e., during Rangers home games).

---

## §8 Additional observations (not bugs, worth flagging)

1. **`game_time` on AWAY rows is NULL by design**. Only home game times are stored. This is per Kevin's sc-15 ruling (home game time is what the operator needs to schedule around; away game times are irrelevant to the home kitchen). If a downstream renderer expects game_time on AWAY rows, it'll show blank.
2. **`day_night` on AWAY rows is NULL by design** (same rationale).
3. **`homestand_id` on AWAY rows is NULL**. Only home game rows carry a `HS{n}` id. If a downstream aggregation groups by homestand and expects AWAY to belong to a homestand, it'll show orphaned.
4. **`is_doubleheader` uniformly false**. API says the same (0 DH scheduled for 2026). If Rangers actually have DH on their 2026 slate (which sometimes happens post-season for rescheduled games), the current DB snapshot doesn't reflect it — but neither does the API as of 2026-07-13.

---

## Open questions Kevin must rule on

1. **Where is Kevin seeing "100% wrong"?** The DB is not wrong. The likely culprit is a UI or print render layer. Kevin should point at the specific view (screen tile / month PDF / season PDF / Excel / something else) and this audit re-runs there.
2. **H+V account duplication (§7)**: is the identical-schedule model correct, or should the two accounts diverge in some way?
3. **Spring games (§6)**: should they load to `TXR - TX - H/V`, `TXR - AZ`, or neither?
4. **`ARI` vs `AZ` (§3)**: keep the DB's canonical `ARI` normalization? Or match API's `AZ`? (Recommendation: keep `ARI` — it's the operator-facing convention.)
5. **Sheets HUB `homestand_schedule` tab**: if Kevin was looking at Sheets, is that source retired officially, or should it be updated too? The deprecated seeder is still capable of writing back if `SC_HOMESTAND_SEED_ALLOW=1`.

---

## Guardrails observed

- No writes to any DB.
- No modifications to any source file.
- No modifications to any migration file.
- No touches to the gating-PR branch (this audit ran on `feat/park-pdc-drill-print` locally without any commits or file edits to the branch).
- MLB Stats API was reachable throughout (public, no auth).
- teamId=140 was resolved by NAME, not guessed.


---

# PART 2 — Screen Render-Chain Trace

> **Status**: READ-ONLY diagnosis, follow-up 2026-07-14. Zero writes, zero fixes, zero migrations, zero branch touches. Kevin rules on the fix.
>
> **Bottom line**: **There is no wrong second store.** The DB, the live `loadHomestandContext` fetch, AND the Sheets HUB `homestand_schedule` tab all AGREE on TXR July's slate (DET / LAA / HOU / CWS / SEA). **Kevin's screen July fingerprint (CIN / SEA / LAD / ATH / SEA / PIT / ATH / NYY) is a 100% pixel-perfect match for `sc_homestand_schedule`'s APRIL rows for TXR - TX - H**, verified by opponent AND first-pitch time. The mechanism is **client-side state**: the screen is displaying `homestandMap` from month M (April) while the URL / label says month M+3 (July). Suspect the `monthCache` in `src/app/service-calendar/ServiceCalendar.js:335`, the `data.homestandMap` binding, or a router / picker state bug — not a data-layer bug.

---

## §P2.1 The render chain, file:line → table

Pixels first, following Kevin's discipline:

### Chip: `VS OPP` / `@ OPP` / time pill / plane icon (large day tile in month/period view)

```
DaySquare.js:378-406  renderXxxxxMid()
    ├── mlb-fee variant renderer reads `content.opponent`, `content.pillTime`, `content.dayNight`, `content.isDoubleheader`
    └── content bag comes FROM caller as a prop (line 108, JSDoc)

PeriodWorkspace.js:825 buildLargeContent(day, kind, homestandMap, ...)
    ├── kind = "mlb-fee" branch at line 900-921:
    │      opponent  = homestandMap?.[day.date].opponent
    │      pillTime  = formatMlbHomeGameTime(homestandMap?.[day.date].gameTime, accountKey)
    │      dayNight  = homestandMap?.[day.date].dayNight
    └── For sm-tile the equivalent is dayResolvers.buildCompactContent → day.opponent
        (day.opponent set by loadYearSummary at serviceCalendar.js:1177 from same homestandMap)

MonthCard.js:324 buildCompactContent(day, kind)
    ├── kind = "mlb-fee" → returns { opponent: day.opponent } from year-summary shape

ServiceCalendar.js:1043  homestandMap = data?.homestandMap || {};
    └── `data` is the current-month sc-load payload stored in monthCache[monthKey]

Fetch: ServiceCalendar.js:512
    /api/service-calendar?action=sc-load&account={acct}&month={YYYY-MM}&clientToday=...

Route: src/app/api/service-calendar/route.js:363-470  sc-load handler
    ├── line 428-432: if (has_homestand_schedule) map = await loadHomestandContext(accountKey, first, last)
    ├── responsePayload.homestandMap = map  (line 468)

DataStore: src/lib/dataStore/serviceCalendar.js:909-942  loadHomestandContext(accountKey, first, last)
    ├── SELECT service_date, homestand_id, day_type, opponent, day_night, game_time, is_doubleheader
    ├── FROM sc_homestand_schedule
    ├── WHERE account_key = ? AND service_date BETWEEN first AND last
    └── returns { [date]: { homestandId, dayType, opponent, dayNight, gameTime, isDoubleheader } }
```

**Table + columns confirmed for the opponent chip**: `sc_homestand_schedule.{service_date, day_type, opponent, game_time, day_night, homestand_id, is_doubleheader}`. Same store Part 1 audited.

### The `~180 meals` value

For `mlb-fee`, `PeriodWorkspace.js:896-898`:
```
const projMeals = sumProjectedMeals(day);
const actMeals = day.hasActuals ? sumActualMeals(day) : 0;
const meals = day.hasActuals ? actMeals : projMeals;
```

Sums per-service projections/actuals from `day.projected` / `day.actual` — populated by sc-load `transformDays` (route.js:225-229) from `sc_daily_revenue.projected_count` / `actual_count`. Per-day totals across the day's service catalog.

Prefix `~` from `isEstimated: !day.hasActuals` (line 908) — days without actuals show "~180 meals" (estimate), days with actuals show "180 meals" (recorded).

**Table for meals**: `sc_daily_revenue` view (backed by `sc_daily_actuals` + `sc_daily_projections` + `sc_services`).

### Counters `0/15 game days · 2 homestands`

```
ServiceCalendar.js:91 aggregateWorkspaceMetrics(days)
    ├── line 156: const isGameDay = !!day.meta?.gameType;
    │             (sc_daily_revenue.game_type = "HOME" | "AWAY" | null)
    ├── line 158: if (isGameDay) out.gameDays++;
    └── line 161: if (isDayComplete) out.gameDaysEntered++;

`0/15 game days` = gameDaysEntered / gameDays
- Numerator (0): days flagged hasActuals OR status=no-service. For MLB per R5,
  no state layer is emitted so hasActuals=false on every day - correct-by-design
  ZERO here. This is NOT a bug; it's Kevin's ruling made visible on the fee-account
  counter.
- Denominator (15): count of days where sc_daily_revenue.game_type is truthy.
  For TXR - TX - H July: `sc_daily_revenue` shows exactly 15 HOME days (2, 4, 5,
  7-12, 20-22, 24-27) + 6 AWAY (17, 18, 28-31). 15 HOME matches the counter.

`2 homestands` = distinct homestand_id in the sc_homestand_schedule GAME rows
  for the month. July has HS7 + HS8 = 2. (April also has 2: HS1 + HS2 - same
  count, so the counter's "2 homestands" is AMBIGUOUS between the two months
  and doesn't help disambiguate.)
```

**Counter tables**: `sc_daily_revenue.game_type` (for the "15") + implicit `sc_homestand_schedule.homestand_id` distinct count (for the "2"). The "0" is R5-correct: MLB fee accounts have no state layer, so `gameDaysEntered` reads as 0 by design. Kevin ruled this in the R5 amendment (`docs/RUNBOOK.md` 2026-07-13 log).

---

## §P2.2 Second store dump — the `sc_homestand_schedule` for July + April

### TXR - TX - H `sc_homestand_schedule` July 2026 (24 rows from `loadHomestandContext`)

| Date | day_type | opponent | game_time (UTC) | Local (CT) | day_night |
|---|---|---|---|---|---|
| 2026-07-01 | AWAY | CLE | (null) | — | (null) |
| 2026-07-02 | GAME | DET | 2026-07-03T00:05Z | Jul 2 7:05 PM | night |
| 2026-07-04 | GAME | DET | 2026-07-04T20:05Z | Jul 4 3:05 PM | day |
| 2026-07-05 | GAME | DET | 2026-07-05T19:30Z | Jul 5 2:30 PM | day |
| 2026-07-07 | GAME | LAA | 2026-07-08T00:05Z | Jul 7 7:05 PM | night |
| 2026-07-08 | GAME | LAA | 2026-07-09T00:05Z | Jul 8 7:05 PM | night |
| 2026-07-09 | GAME | LAA | 2026-07-10T00:05Z | Jul 9 7:05 PM | night |
| 2026-07-10 | GAME | HOU | 2026-07-11T00:05Z | Jul 10 7:05 PM | night |
| 2026-07-11 | GAME | HOU | 2026-07-11T23:05Z | Jul 11 6:05 PM | night |
| 2026-07-12 | GAME | HOU | 2026-07-12T18:35Z | Jul 12 1:35 PM | day |
| 2026-07-17 | AWAY | ATL | (null) | — | (null) |
| 2026-07-18 | AWAY | ATL | (null) | — | (null) |
| 2026-07-19 | AWAY | ATL | (null) | — | (null) |
| 2026-07-20 | GAME | CWS | 2026-07-21T00:05Z | Jul 20 7:05 PM | night |
| 2026-07-21 | GAME | CWS | 2026-07-22T00:05Z | Jul 21 7:05 PM | night |
| 2026-07-22 | GAME | CWS | 2026-07-23T00:05Z | Jul 22 7:05 PM | night |
| 2026-07-24 | GAME | SEA | 2026-07-25T00:05Z | Jul 24 7:05 PM | night |
| 2026-07-25 | GAME | SEA | 2026-07-25T23:15Z | Jul 25 6:15 PM | night |
| 2026-07-26 | GAME | SEA | 2026-07-26T18:35Z | Jul 26 1:35 PM | day |
| 2026-07-27 | GAME | SEA | 2026-07-27T18:35Z | Jul 27 1:35 PM | day |
| 2026-07-28 | AWAY | TB | (null) | — | (null) |
| 2026-07-29 | AWAY | TB | (null) | — | (null) |
| 2026-07-30 | AWAY | TB | (null) | — | (null) |
| 2026-07-31 | AWAY | HOU | (null) | — | (null) |

Homestands: HS7 (Jul 2-12, DET+LAA+HOU) + HS8 (Jul 20-27, CWS+SEA) = **2**.
Home game count: **9** GAME rows (Jul 2, 4, 5, 7-12, 20-22, 24-27) = 15 dates with day_type IN (GAME, AWAY per sc_daily_revenue).

### TXR - TX - H `sc_homestand_schedule` April 2026 (rows that FINGERPRINT-MATCH Kevin's screen)

| Date | day_type | opponent | game_time (UTC) | Local (CT) | day_night |
|---|---|---|---|---|---|
| 2026-04-01 | AWAY | BAL | (null) | — | (null) |
| 2026-04-03 | GAME | **CIN** | 2026-04-03T20:05Z | Apr 3 **3:05 PM** | day |
| 2026-04-04 | GAME | **CIN** | 2026-04-04T23:05Z | Apr 4 **6:05 PM** | night |
| 2026-04-05 | GAME | **CIN** | 2026-04-05T18:35Z | Apr 5 **1:35 PM** | day |
| 2026-04-06 | GAME | **SEA** | 2026-04-07T00:05Z | Apr 6 **7:05 PM** | night |
| 2026-04-07 | GAME | **SEA** | 2026-04-08T00:05Z | Apr 7 **7:05 PM** | night |
| 2026-04-08 | GAME | **SEA** | 2026-04-08T18:35Z | Apr 8 **1:35 PM** | day |
| 2026-04-10 | AWAY | **LAD** | (null) | — | (null) |
| 2026-04-11 | AWAY | **LAD** | (null) | — | (null) |
| 2026-04-12 | AWAY | **LAD** | (null) | — | (null) |
| 2026-04-13 | AWAY | **ATH** | (null) | — | (null) |
| 2026-04-14 | AWAY | **ATH** | (null) | — | (null) |
| 2026-04-15 | AWAY | **ATH** | (null) | — | (null) |
| 2026-04-16 | AWAY | **ATH** | (null) | — | (null) |
| 2026-04-17 | AWAY | **SEA** | (null) | — | (null) |
| 2026-04-18 | AWAY | **SEA** | (null) | — | (null) |
| 2026-04-19 | AWAY | **SEA** | (null) | — | (null) |
| 2026-04-21 | GAME | **PIT** | 2026-04-22T00:05Z | Apr 21 **7:05 PM** | night |
| 2026-04-22 | GAME | **PIT** | 2026-04-23T00:05Z | Apr 22 **7:05 PM** | night |
| 2026-04-23 | GAME | **PIT** | 2026-04-24T00:05Z | Apr 23 **7:05 PM** | night |
| 2026-04-24 | GAME | **ATH** | 2026-04-25T00:05Z | Apr 24 **7:05 PM** | night |
| 2026-04-25 | GAME | **ATH** | 2026-04-25T23:05Z | Apr 25 **6:05 PM** | night |
| 2026-04-26 | GAME | **ATH** | 2026-04-26T18:35Z | Apr 26 **1:35 PM** | day |
| 2026-04-27 | GAME | **NYY** | 2026-04-28T00:05Z | Apr 27 **7:05 PM** | night |
| 2026-04-28 | GAME | **NYY** | 2026-04-29T00:05Z | Apr 28 **7:05 PM** | night |
| 2026-04-29 | GAME | **NYY** | 2026-04-29T18:35Z | Apr 29 **1:35 PM** | day |

### Three-way alignment — Kevin's July screen vs the two stores

Match on DAY-OF-MONTH (screen day N → April day N shifted TO July date label):

| Screen July label | Kevin's fingerprint | DB `sc_homestand_schedule` APRIL | Match? |
|---|---|---|---|
| Jul 3-5 VS CIN 3:05 / 6:05 / 1:35 CT | ✓ | Apr 3-5 GAME CIN, CT times 3:05 / 6:05 / 1:35 | **100%** |
| Jul 6-8 VS SEA 7:05 / 7:05 / 1:35 | ✓ | Apr 6-8 GAME SEA, CT 7:05 / 7:05 / 1:35 | **100%** |
| Jul 9 off | ✓ | Apr 9 no row | **100%** |
| Jul 10-12 @ LAD | ✓ | Apr 10-12 AWAY LAD | **100%** |
| Jul 13-16 @ ATH | ✓ | Apr 13-16 AWAY ATH | **100%** |
| Jul 17-19 @ SEA | ✓ | Apr 17-19 AWAY SEA | **100%** |
| Jul 20 off | ✓ | Apr 20 no row | **100%** |
| Jul 21-23 VS PIT 7:05 | ✓ | Apr 21-23 GAME PIT, CT 7:05 / 7:05 / 7:05 | **100%** |
| Jul 24-26 VS ATH 7:05 / 6:05 / 1:35 | ✓ | Apr 24-26 GAME ATH, CT 7:05 / 6:05 / 1:35 | **100%** |
| Jul 27-29 VS NYY 7:05 / 7:05 / 1:35 | ✓ | Apr 27-29 GAME NYY, CT 7:05 / 7:05 / 1:35 | **100%** |

**Kevin's screen July = DB April, byte for byte.**

The DB July slate (DET / LAA / HOU / CWS / SEA) — which the Part 1 audit proved matches the MLB API 100% — is nowhere in Kevin's screenshots.

---

## §P2.3 Provenance verdict — no wrong second store, mechanism is client-side

### There is no data-layer second store

Evidence:
1. **`sc_homestand_schedule` for TXR - TX - H July** → correct DET/LAA/HOU/CWS/SEA slate. Loaded 2026-06-17 and 2026-07-10/11 via `_extract_sc_13_away_schedule.mjs` from MLB Stats API. **CLEAN.**
2. **`loadHomestandContext("TXR - TX - H", "2026-07-01", "2026-07-31")`** live call returns the same DET/LAA/HOU/CWS/SEA slate. Query is correctly scoped by month bounds. **CLEAN.**
3. **Sheets HUB `homestand_schedule` tab (row filter TXR - TX - H July)** → 20 rows for July all matching DB: DET / LAA / HOU / CWS / SEA. Not stale.
4. **`sc_daily_revenue.game_type` for TXR - TX - H July** → 15 HOME + 6 AWAY, dates matching the DB slate. The "15 game days" counter Kevin sees is reading July data correctly.
5. **`sc_day_metadata` for TXR - TX - H July** → 31 rows, HOME/AWAY/OFF distribution matching DB July, no opponent column (this table doesn't carry opponent).

**Every store agrees on July's real slate.** There is no wrong second store.

### Fingerprint probes (Kevin's a/b/c/d)

**(a) Rangers 2025 same-month?** No. 2025 July has BAL / SD / LAA / HOU / DET / ATH / ATL / SEA (verified via `statsapi.mlb.com/api/v1/schedule?season=2025&teamId=140`). Doesn't match Kevin's CIN / SEA / LAD / ATH / SEA / PIT / ATH / NYY.

**(b) Another team's 2026 slate with home-SEA-6-8 + @LAD-10-12 signature?** Not searched exhaustively (30 teams × 6 months = 180 same-month probes not run), but the exact fingerprint matches TXR's own 2026 April slate 100% — no need to search further.

**(c) Early tentative 2026 release that later reshuffled?** No evidence. `sc_homestand_schedule` `created_at` distinct dates for TXR - TX - H = 2026-06-17, 2026-07-10, 2026-07-11 — all within the last month, aligned with the sc-13 MLB API load. The DB rows match the current API 100%.

**(d) Sheets HUB `homestand_schedule` tab?** Verified in (3) above. Sheets HUB agrees with the DB and the API. Not the wrong store.

### The verdict

**The screen is rendering `sc_homestand_schedule`'s APRIL rows on JULY date labels.** The source is CORRECT. The consumer / cache / prop-threading is showing the wrong month's payload.

Likely mechanism candidates (client-side, ordered by suspicion):

1. **`monthCache` key-mismatch** in `src/app/service-calendar/ServiceCalendar.js:335`. If `monthCache["2026-07"]` accidentally holds the April sc-load payload (from a previous state, a race in the fetch effect at line 508-518, or a stale closure), `data.homestandMap` reads April data.
2. **`data` binding stale** — `setData(d)` at line 514 fires from the fetch response but the previous `data` value persists in a React ref/state that the render still consumes. Unlikely with modern React, but possible if a Suspense boundary or memo is caching.
3. **Router / URL param mismatch** — the URL says `month=2026-07` but a downstream state derives its own month from something else (a prop cascade, a URL vs. state race) and picks April.
4. **`periodHomestandMap` merge (line 850)** used in place of the month `homestandMap` — if Kevin is on the SEASON scope or PERIOD workspace, the merged homestandMap could be sourced from a different (April-spanning) fiscal period.

Without live client devtools, I can narrow to a mechanism CLASS but not the exact bug. Kevin needs to reproduce with devtools open + confirm: (a) which URL is he on (`?month=2026-07`?), (b) what does the browser Network tab show for the sc-load request (URL + response payload), (c) which VIEW is he on (Month drill? Period drill? Season overview?).

---

## §P2.4 Blast radius on the SCREEN side

The DB is clean for all four MLB accounts per Part 1. The SCREEN blast radius depends on whether the client-side mechanism (whatever it is) is TXR-specific or systemic.

Sampled from the same trace path (no live browser test):

- **CIN - OH** (MLB fee): same render chain (mlb-fee variant → homestandMap → sc-load → loadHomestandContext → sc_homestand_schedule). Live `loadHomestandContext("CIN - OH", "2026-07-01", "2026-07-31")` returns 21 correct rows (STL / DET / TB / MIA / SD / STL / MIL / OAK). Live `loadHomestandContext("CIN - OH", "2026-04-01", "2026-04-30")` returns correct April rows (MIL / TB / STL / PIT / etc). If Kevin runs the same test on CIN - OH's screen, the bug either reproduces (systemic client-state issue) or doesn't (TXR-specific state hazard).
- **STL - MO** (MLB fee): same chain. Same story — if Kevin can reproduce on STL-MO's July view with April-appearing data, it's a global mechanism.
- **CIN - KY** (AAA): reads via same render chain (kind = "milb" branch at PeriodWorkspace.js:923 also consumes homestandMap). loadHomestandContext returns 42 correct July rows (OMA / STP / IND per DB matches). Screen impact status unknown without live test.
- **TBJ - NY** (AAA): same, per the `loadHomestandContext` implementation.

**Recommendation to Kevin**: reproduce on CIN - OH's July view. If the same April-shifted pattern appears on CIN - OH (Reds' April slate showing on July dates), the mechanism is not TXR-specific — it's a shared client-state hazard affecting every MLB/AAA drill account. If CIN - OH renders correct July data, TXR - TX - H has some account-specific state issue (e.g. Kevin's browser has a stale monthCache entry for TXR from an earlier April view that never invalidated on account switch).

---

## §P2.5 Fix options (sketched only, NOT built — read-only audit)

Each option's blast radius, effort, and risk:

**Option A — Reproduce with devtools + patch the client-state bug at its root.**
- Effort: 1-4 hours depending on which of the 4 mechanism candidates the reproduction points at.
- Risk: LOW. Client-state bug affects the affected surface only. No data migration.
- Best if: the mechanism turns out to be a small fix (bad useEffect dep, stale closure, missing cache-invalidation on account switch, wrong state key).

**Option B — Force cache invalidation on every account+month change.**
- Effort: 30-60 min. Add a cache-clear side effect on account or month change; belt-and-suspenders defense.
- Risk: LOW-MEDIUM. Extra fetches on account switch (already happens per `setMonthCache({})` at line 501 on account change, but perhaps not on all navigation paths). Could hide the root cause without fixing it — the underlying bug lurks.
- Best if: Kevin wants the symptom to stop shipping today while the root cause is investigated separately.

**Option C — Repoint the screen loader to always re-fetch `sc_homestand_schedule` on render.**
- Effort: 30-60 min. Bypass monthCache entirely for the homestandMap slice — fetch on every render or via a per-render key.
- Risk: MEDIUM. Perf regression (extra Supabase read per render). Kevin's data volume is small so likely fine, but the monthCache exists for a reason.
- Best if: Kevin wants a cache-clean rebuild while still keeping monthCache for `days` payload.

**Option D — Reload/sync the second store.**
- **N/A** — there is no wrong second store. All three DB tables (`sc_homestand_schedule`, `sc_daily_revenue.game_type`, `sc_day_metadata.game_type`) and the Sheets HUB `homestand_schedule` tab all agree with the API for July. Nothing to reload.

**Option E — Retire the second store's schedule columns entirely.**
- **N/A** for the same reason as D. The `game_type` field on `sc_day_metadata` is used by the "15 game days" counter path (via `sc_daily_revenue.game_type` which is a view over `sc_day_metadata`) — retiring it would break the counter. It's not a "wrong second store"; it's a legitimate additional column serving a different purpose.

**Recommendation**: A over B over C, unless Kevin needs the symptom gone yesterday.

---

## §P2.6 Counter finding

The `0/15 game days` counter's ZERO numerator is **R5-correct**, not a bug. MLB fee accounts emit no state layer (`resolveDayState()` returns null for `accountLevel === "MLB"`), so `day.hasActuals` is false on every day and `gameDaysEntered` stays 0 by design. Kevin's ruling 2026-07-13 documented in `docs/RUNBOOK.md`.

If Kevin wants the counter to show meaningful numerator progress on MLB fee accounts, that's a separate design question (R5 currently makes MLB counters cosmetic-only — the operator doesn't drive game-day entry compliance on MLB accounts).

The `2 homestands` denominator counts distinct `homestand_id` in the month. For April: HS1 (Apr 3-8 CIN+SEA) + HS2 (Apr 21-29 PIT+ATH+NYY) = 2. For July: HS7 (Jul 2-12 DET+LAA+HOU) + HS8 (Jul 20-27 CWS+SEA) = 2. Coincidentally both months have 2 — the counter doesn't help disambiguate which month is really loaded.

---

## §P2.7 Open rulings for Kevin

1. **Reproduce with devtools + Network tab open**: which sc-load URL is fired for the affected view? What does the response payload look like? This narrows the 4 mechanism candidates to 1.
2. **Blast radius test**: does CIN - OH's July view render April-appearing data too? If YES, this is a systemic client-state bug; if NO, TXR-specific state hazard.
3. **Which VIEW is Kevin on?** Month drill? Period drill? Season overview? Different views use different code paths for populating `homestandMap` (data.homestandMap vs. periodHomestandMap vs. year-summary day.opponent).
4. **Does account-switch clear the bug?** If Kevin switches away from TXR-TX-H and back, does the screen refresh with correct July data? If YES → monthCache invalidation gap; if NO → deeper state hazard.
5. **Approve Option A** for the root-cause investigation (paying the reproduction cost), or Option B for a symptom-band-aid ship-today.

---

## Guardrails observed in Part 2

- No writes to any DB.
- No modifications to any source file.
- No modifications to any migration file.
- No touches to any branch. Read-only trace only.
- Sheets HUB read via `safeRead` (read-only path).
- MLB Stats API pulls consistent with Part 1 usage.


---

# PART 2 ADDENDUM - Split probe verdict + candidate diagnosis (2026-07-14)

> **Status**: READ-ONLY. Zero writes. No branches touched. This is the isolate-server-vs-client probe Kevin ordered before the fix, plus a first pass at naming the mechanism from code alone.
>
> **One-line result**: **SERVER IS INNOCENT. All four candidate client-side mechanisms look race-safe on code-read.** Evidence contradicts all four; per Kevin's directive I am **STOPPING before writing a fix** and reporting.

## Probe :: server-side sc-load for TXR - TX - H

Ran `scripts/_probe_sc_load_txr_month_addendum.mjs` (fresh, read-only). Calls the same `sc_homestand_schedule` query with the same range math (route.js:418-420) the sc-load handler uses, for month=2026-07 and month=2026-04 as a control. Also dumps the full 2026 map per month for the year-summary path.

```
JULY 2026 — TXR - TX - H sc_homestand_schedule GAME opponents:
  ["DET","DET","DET","LAA","LAA","LAA","HOU","HOU","HOU","CWS","CWS","CWS","SEA","SEA","SEA","SEA"]

APRIL 2026 — TXR - TX - H sc_homestand_schedule GAME opponents:
  ["CIN","CIN","CIN","SEA","SEA","SEA","PIT","PIT","PIT","ATH","ATH","ATH","NYY","NYY","NYY"]

route.js month bounds (July): first=2026-07-01 last=2026-07-31   ✓ correct
route.js month bounds (April): first=2026-04-01 last=2026-04-30  ✓ correct
Client monthCache key (ServiceCalendar.js:335 mk):
  April (month=3, 0-indexed):  "2026-04"
  July  (month=6, 0-indexed):  "2026-07"
  Keys distinct? YES  Keys match URL monthKey? YES

Full 2026 year-summary homestandMap per month (each month's GAME slate):
  2026-03: []                                             (spring wrap)
  2026-04: ["CIN"x3, "SEA"x3, "PIT"x3, "ATH"x3, "NYY"x3]
  2026-05: ["CHC"x3, "ARI"x3, "HOU"x4, "KC"x3]
  2026-06: ["CLE"x3, "MIN"x3, "SD"x3]
  2026-07: ["DET"x3, "LAA"x3, "HOU"x3, "CWS"x3, "SEA"x4]  ← what Kevin should see for July
  2026-08: ["SF"x3, "BAL"x3, "WSH"x3, "LAA"x3, "ATH"x1]
  2026-09: ["ATH"x2, "TB"x4, "BOS"x3, "TOR"x3, "NYM"x3]
```

**Verdict**: The server returns July's DET/LAA/HOU/CWS/SEA slate when asked for `month=2026-07`. It does NOT return April's CIN/SEA/LAD/ATH/NYY. The sc-load path is CLEAN. The `loadHomestandContext` per-month scoping is CLEAN. The route.js month-bounds math is CLEAN. Every store in every layer agrees on July.

**Isolation ruling** per Kevin's brief:
- Server returns DET/LAA/HOU/CWS/SEA for July → **defect is pure client state (candidates 1-3), not request-parameter or dataStore month resolution (candidate 4).**

**monthCache key composition check** (Kevin's collision request):
- `mk = ${year}-${String(month+1).padStart(2,"0")}` at ServiceCalendar.js:507
- For April local state (month=3): "2026-04"
- For July local state (month=6): "2026-07"
- Keys are distinct, contain the month number, and match the URL monthKey format exactly.
- **No key collision. No missing-month suffix. Cache key is not the mechanism.**

## Diagnosis phase - code-only pass on the 3 remaining candidates

Kevin's brief called out four candidates. #4 (server-side param->bounds parsing) is ruled out by the probe above. Here is what code-read says about #1-3:

### #1 — Out-of-order fetch race in the Month drill effect

**File**: `src/app/service-calendar/ServiceCalendar.js:610-642` (Month drill fetch effect).

The effect body:
```
useEffect(() => {
  if (!isMonthView || !selectedAccount || !monthKey) return;
  if (monthCache[monthKey]) { ... return; }
  const controller = new AbortController();
  ...
  fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${monthKey}&clientToday=${...}`, { signal: controller.signal })
    .then(r => r.json())
    .then(d => {
      if (controller.signal.aborted) return;       // ← guard 1
      if (d.success) {
        setMonthCache(prev => ({ ...prev, [monthKey]: d }));   // ← closure-scoped key
        ...
      }
    })
    ...
  return () => controller.abort();                                // ← cleanup abort
}, [isMonthView, selectedAccount, monthKey, reloadKey, today, monthCache]);
```

This effect looks **race-safe** on read:
- Each effect fire creates a NEW AbortController.
- Deps change (e.g. monthKey April→July) triggers cleanup which aborts the previous controller.
- The `.then` handler checks `controller.signal.aborted` before doing anything.
- The `setMonthCache` closure captures `monthKey` at effect-fire time - a fetch fired for April writes to `["2026-04"]: d`, a fetch fired for July writes to `["2026-07"]: d`. No cross-key contamination possible via closure.
- Even if a stale response resolves late, the abort check discards it.

**No obvious race here.** The pattern matches the notes-cache staleness pattern from #418 (proper AbortController + closure-scoped key).

### #2 — Cache key integrity

Verified in the probe: keys are distinct, correct format, match URL monthKey format. `setMonthCache(prev => ({ ...prev, [monthKey]: d }))` writes to the correct key. The reset effect at :489-505 clears `monthCache = {}` on account switch (not on monthKey change - but this is intentional, so a subsequent visit to a previously-loaded month hits cache).

**No cache-key bug found.**

### #3 — Route param parsing / route bounds

Verified in the probe: route.js:418-420 constructs `first = "2026-07-01"`, `last = "2026-07-31"` when called with year=2026, month=7. `loadHomestandContext` correctly filters to those bounds. The response includes only July's data.

**No route parsing bug found.**

### The one code-shape observation worth naming

`ServiceCalendar.js:267`: `const [month, setMonth] = useState(new Date().getMonth());`

There are **zero callers of `setMonth`** anywhere in the file (verified via grep). The `month` state is initialized at mount from the client's local clock and never mutated after. The legacy month effect at :508-518 uses `mk = ${year}-${String(month+1).padStart(2,"0")}` and populates `data` from that fetch.

For an operator who loads the page on 2026-07-14, `month`=6, `mk`="2026-07", `data`=July payload. Correct.

For an operator whose tab was opened days earlier (a long-open tab), `month` stays at whatever month it was initialized on. The legacy effect keeps fetching that month. `data.homestandMap` is that month's data.

**BUT** - the Month drill body at :2205-2237 does NOT render from `data.homestandMap`. It reads from `monthHomestandMap = monthCache[monthKey]?.homestandMap || {}` (:920-923). The `homestandMap={monthHomestandMap || homestandMap}` fallback at :2217 is DEAD CODE: `{}` is truthy in JavaScript, so `monthHomestandMap || homestandMap` always resolves to `monthHomestandMap` on Month drill. The stale `data.homestandMap` cannot leak into the Month drill body via this fallback.

So the "stale `data`" observation does NOT explain "April data on July page" for the Month drill. It would only explain a case where the SEASON overview or the LEGACY month view (mount default) renders stale data - not the Month drill.

### Candidates 1-3 status

- **#1 race**: no obvious race on code-read. AbortController + closure-scoped key look correct.
- **#2 cache key**: verified correct. No collision, no missing month.
- **#3 route parsing**: verified correct. Server returns July for July.

**None of the four candidates has a smoking-gun match from code-read alone.** Kevin's brief instructed: "If evidence contradicts all candidates, STOP and report."

## STOP + report

Two possibilities I cannot narrow without live client reproduction:

**(A) Kevin was not on the Month drill.** He was on the Season overview or a Period workspace. Those code paths use different data sources (`yearData` from sc-year-summary; `periodHomestandMap` merge from monthCache). The "wrong month" bug lives in one of those paths, not the Month drill.

**(B) A React re-render / concurrent-mode / Suspense interaction I cannot see from code-read.** The AbortController pattern is correct on paper but interacts with React's scheduling in ways that occasionally leak. Would need devtools + fiber inspection to see.

**Recommendation**: One more piece of information from Kevin unblocks the fix:

1. **The exact URL Kevin was on** when he saw the wrong data. `?month=2026-07` vs `?period=P6` vs bare `/service-calendar` (Season). This alone rules out or confirms which of the three body-render paths is at fault.
2. **A single sc-load Network response** captured while the "wrong" data is on screen. This shows whether the API returned wrong data OR whether the API returned right data but the client rendered wrong.
3. **A single monthCache snapshot** via a `console.log(monthCache)` (or a `window.__scDebug = monthCache` hook Kevin can inspect). This shows whether the cache was written correctly.

Any ONE of these three narrows to the exact file:line. Without one, the fix would be either (a) a shot in the dark, or (b) a defensive band-aid layered onto an unknown root cause - which Kevin's brief explicitly disallowed ("No band-aid cache-flushes layered on top of an unfixed race").

Zero writes, zero fixes shipped. Waiting on Kevin's readout before proceeding with Option A.

## Files touched during this addendum

- `scripts/_probe_sc_load_txr_month_addendum.mjs` (new, READ-ONLY probe script)
- `/tmp/txr_schedule_audit.md` (this append)

No source file, no migration file, no branch touch. Kevin's dev server (PID 10057, port 3737) not touched.


---

# PART 3 — sc_day_metadata audit + the vanishing getaway days (bug B) (2026-07-14)

> **Status**: READ-ONLY. Zero writes. No branches touched.
>
> **One-line bottom line**: **Kevin's suspect (sc_day_metadata.game_type) is REFUTED. The mechanism is different and simpler: `loadMonthData` (sc-load) BUILDS its days[] from `sc_daily_revenue` view rows only, with NO fee-account fallback to fill in missing dates from `homestandMap`.** The getaway-into-homestand AWAY dates happen to have ZERO sc_daily_revenue rows, so they're silently omitted from the sc-load `days[]` response. The Month drill / Period workspace render them as bare "off" tiles because `dayMap.get(cell.dateStr)` returns undefined. The year overview (sc-year-summary) DOES have the fallback and renders these dates correctly, which is why Kevin sees them on the year view but blank on the drill.

---

## §P3.1 Render-gate confirmation (Step 1)

**Kevin's suspect**: tile away/"no service" render is gated on `day.meta.gameType` / `sc_daily_revenue.game_type`.

**Actual gate**: `hs.dayType === "AWAY"` in `classifyDayStatus` at `src/lib/dataStore/serviceCalendar.js:230`.

For the FEE branch (:217-240), the sequence is:
```
if (!hs) return "off-season";
if (hs.dayType === "EXHIBITION") return "exhibition";
if (hs.dayType === "AWAY") return "away";           ← Kevin's away tile gate
if (hs.dayType === "GAME") { if (s.hasAct) return "entered"; return "future"; }
// PREP / OPEN / CLOSE / CLEAN (or unknown non-GAME):
if (s.hasAct && s.anyNonZeroAct) return "entered";
return "prep";
```

The status feeds `resolveDayStatus` in `src/app/service-calendar/dayResolvers.js:65-82` which maps `"away" → "away"` atom. `renderMiddleLine` at `DaySquare.js:332-372` dispatches to `renderAway` at `:401-416` which draws the `@ OPP` chip.

The print export also gates on hs.dayType: `src/lib/print/monthSheet.js:422/430` and `src/lib/print/seasonSheet.js:284`.

**`sc_day_metadata.game_type` is NOT the tile gate.** It IS the "0/15 game days" counter's `isGameDay` gate at `ServiceCalendar.js:156` (`!!day.meta?.gameType`). Suspect revised: **`sc_homestand_schedule` presence + shape of the sc-load response's days[] is what determines the tile.**

## §P3.2 Three-way diff, all four MLB accounts (Step 2)

Full 2026 regular season, `sc_homestand_schedule.day_type` vs `sc_day_metadata.game_type` vs `sc_daily_revenue.game_type` vs MLB API home/away.

```
CIN - OH    :: 164 API games, 162 hs rows, 246 meta rows, 612 rev rows
              hs day_type dist: {GAME:81, AWAY:81}
              meta game_type dist: {null:57, AWAY:103, HOME:79, OFF:7}
              MISMATCHES (hs+API disagree with meta): 2
                2026-05-29 api=HOME hs=GAME meta=AWAY rev=AWAY   ← hs correct, meta wrong
                2026-08-20 api=HOME hs=GAME meta=AWAY rev=AWAY   ← hs correct, meta wrong

STL - MO    :: 166 API games, 162 hs rows, 246 meta rows, 624 rev rows
              hs day_type dist: {GAME:81, AWAY:81}
              MISMATCHES: 0
              MISSING HS ROW: 1
                2026-07-23 api=HOME meta.game_type=AWAY (no rev rows)  ← hs missing row

TXR - TX - H:: 162 API games, 164 hs rows, 246 meta rows, 596 rev rows
              hs day_type dist: {EXHIBITION:2, AWAY:81, GAME:81}
              meta game_type dist: {null:64, AWAY:95, HOME:81, OFF:6}
              MISMATCHES: 3
                2026-03-26 api=AWAY hs=AWAY meta=null rev=null  ← opening series, meta empty
                2026-03-28 api=AWAY hs=AWAY meta=null rev=null
                2026-03-29 api=AWAY hs=AWAY meta=null rev=null

TXR - TX - V:: identical to TXR - TX - H (same MLB team, same seed)
              MISMATCHES: same 3 (2026-03-26/28/29)
```

**Interpretation**:
- `sc_homestand_schedule` is CLEAN for TXR's regular season (162/162 CLEAN + 2 EXHIBITION per Part 1). CIN + STL: hs is CLEAN for the 162 rows present, but STL is MISSING ROWS for at least 1 real HOME game (7/23) and possibly more (API count 166 vs 162 rows, so 4 API games not represented as hs rows for STL - the probe surfaced 7/23 the loudest but there may be 3 more; would need a per-date walk to enumerate; parked pending Kevin's ruling).
- `sc_day_metadata.game_type` has 5 real misclassifications across all four accounts (CIN 2, TXR-H/V 3 each in opening series) - these are the ONLY meta-vs-truth defects in the whole season.
- Kevin's PATTERN dates (see §P3.3) are NOT in the mismatch bucket. Meta and hs and API all agree on those dates. The blank-tile mechanism is not metadata misclassification.

## §P3.3 Kevin's pattern check (Step 3)

Predict-missing set = every AWAY date whose NEXT calendar date is a GAME (home) date, from `sc_homestand_schedule` alone. 27 dates across the four MLB fee accounts:

```
CIN - OH    :: 8 dates
  2026-04-09 @ MIA -> 04-10 home vs LAA
  2026-05-07 @ CHC -> 05-08 home vs HOU
  2026-06-21 @ NYY -> 06-22 home vs MIL
  2026-07-02 @ MIL -> 07-03 home vs BAL
  2026-07-26 @ STL -> 07-27 home vs CLE
  2026-08-13 @ CWS -> 08-14 home vs MIA   ← Kevin's example
  2026-08-30 @ CHC -> 08-31 home vs SD    ← Kevin's example
  2026-09-13 @ MIL -> 09-14 home vs LAD

STL - MO    :: 5 dates
  2026-04-30 @ PIT -> 05-01 home vs LAD
  2026-05-14 @ ATH -> 05-15 home vs KC
  2026-06-14 @ MIN -> 06-15 home vs SD
  2026-06-21 @ KC  -> 06-22 home vs ARI
  2026-07-05 @ CHC -> 07-06 home vs MIL

TXR - TX - H:: 7 dates
  2026-05-07 @ NYY -> 05-08 home vs CHC
  2026-05-24 @ LAA -> 05-25 home vs HOU
  2026-06-14 @ BOS -> 06-15 home vs MIN
  2026-07-01 @ CLE -> 07-02 home vs DET
  2026-07-19 @ ATL -> 07-20 home vs CWS
  2026-08-02 @ HOU -> 08-03 home vs SF    ← Kevin's example
  2026-08-30 @ MIL -> 08-31 home vs ATH   ← Kevin's example

TXR - TX - V:: same 7 dates (shared seed)
```

**Kevin's four flagged examples are all in this predicted set (checkmarks above).** Season-wide blast radius: **8 CIN + 5 STL + 7 TXR-H + 7 TXR-V = 27 invisible-on-drill AWAY tiles across the 4 MLB fee accounts in 2026.** (TXR-H and TXR-V are the same slate so operationally 20 unique dates.)

### The confirming pattern found on field-level probe

Direct field probe on Kevin's four failing dates + three controls (AWAY finals followed by an OFF day) + the two CIN reverse-mismatches:

```
FAILING DATES (Kevin says blank on drill):
  TXR 08-02 hs.day_type=AWAY hs.opp=HOU  meta.game_type=AWAY  sc_daily_revenue rows: 0
  TXR 08-30 hs.day_type=AWAY hs.opp=MIL  meta.game_type=AWAY  sc_daily_revenue rows: 0
  CIN 08-13 hs.day_type=AWAY hs.opp=CWS  meta.game_type=AWAY  sc_daily_revenue rows: 0
  CIN 08-30 hs.day_type=AWAY hs.opp=CHC  meta.game_type=AWAY  sc_daily_revenue rows: 0

CONTROL DATES (Kevin says render OK):
  TXR 08-16 hs.day_type=AWAY hs.opp=ATH  meta.game_type=AWAY  sc_daily_revenue rows: 4
  TXR 08-26 hs.day_type=AWAY hs.opp=CWS  meta.game_type=AWAY  sc_daily_revenue rows: 4
  CIN 08-09 hs.day_type=AWAY hs.opp=WSH  meta.game_type=AWAY  sc_daily_revenue rows: 4
```

**All 7 dates have hs.day_type=AWAY correct. All 7 have meta.game_type=AWAY correct. The difference is exclusively in `sc_daily_revenue` row count: FAILING dates have 0 rows, CONTROL dates have 4.**

## §P3.4 THE MECHANISM (this is the new finding, not in Parts 1-2)

**File**: `src/lib/dataStore/serviceCalendar.js`
**Function**: `loadMonthDataPostgres(accountKey, year, month, opts)` at :685-836
**Path**: called via `/api/service-calendar?action=sc-load` -> `loadMonthData` (public alias) -> `loadMonthDataPostgres`. This is the SAME response the Month drill + Period workspace + Print export all consume.

The bug:

```js
// Line 745-775 - build dayBuckets ONLY from sc_daily_revenue view rows:
const dayBuckets = new Map();
for (const r of viewRows || []) {                          // ← if viewRows for a date is [], no bucket
  if (!dayBuckets.has(r.service_date)) {
    dayBuckets.set(r.service_date, {
      date: r.service_date,
      period: r.period, weekLabel: r.week_label, ...,
      services: [],
    });
  }
  ...
}

// Line 783 - days[] is only the buckets we built:
const days = [...dayBuckets.values()]
  .sort(...)
  .map((day) => { ... classifyDayStatus(...) ... });
```

**Compare to `loadYearSummaryPostgres:1134-1147` which HAS a fee-account fallback:**

```js
// Fee accounts: ensure every homestand date has a dayState entry even
// if it's not in sc_daily_revenue (e.g. PREP/OPEN/CLOSE days that have
// no projection rows). Without this, those dates would silently drop
// from the year response and render as gaps in the heatmap.
if (billingModel === "flat_fee" && hasHomestandData) {
  for (const date of Object.keys(homestandMap)) {
    if (!dayState.has(date)) {
      dayState.set(date, {
        date, hasAct: false, anyNonZeroAct: false,
        hasProj: false, anyNonZeroProj: false, gameType: "",
      });
    }
  }
}
```

**loadMonthDataPostgres is MISSING this fallback.** So Kevin's getaway AWAY dates - which happen to have zero sc_daily_revenue rows - are silently dropped from `days[]`.

### Consequence on the render

The client side reads the sc-load response:
- `ServiceCalendar.js:786`: `const dayMap = useMemo(() => { const m = {}; if (data?.days) data.days.forEach(d => { m[d.date] = d; }); return m; }, [data]);`
- `MonthCard.js:316`: `const day = daysByDate.get(cell.dateStr);`
- `MonthCard.js:320-324`: `const status = day ? resolveDayStatus(day.status) : "off"; const content = day ? buildCompactContent(day, kind) : null;`

For 8/2 with no bucket → no entry in `data.days` → `daysByDate.get("2026-08-02")` = undefined → status = `"off"`, content = `null`.

`DaySquare` renders the "off" atom (a muted neutral fill) with no middle content. Visually indistinguishable from a truly off-day tile - hence Kevin sees "blank".

### Why the SEASON overview shows these correctly

`loadYearSummary` HAS the fallback (:1134-1147). So its `days[]` DOES include 8/2 with hs.day_type=AWAY → status = "away" → sm tile renders "HOU" chip on the year heatmap. This matches Kevin's brief: he sees the dates on the year view, they go blank on the drill.

## §P3.5 Provenance of `sc_day_metadata.game_type` (Step 4)

Snapshot from the probe:

```
CIN - OH    :: 246 rows, all created 2026-06-15
              updated_by = "k.fietek@kitchfix.com" (one manual edit later)
              game_type ∈ {AWAY, HOME, OFF} (no PREP/OPEN/CLOSE/CLEAN)
STL - MO    :: 246 rows, all created 2026-06-15, no updated_by
              game_type ∈ {AWAY, HOME, OFF}
TXR - TX - H:: 246 rows, all created 2026-06-15, no updated_by
              game_type ∈ {AWAY, HOME, OFF}
TXR - TX - V:: 246 rows, all created 2026-06-15, no updated_by
              game_type ∈ {AWAY, HOME, OFF}

Sample row shape: id, account_key, service_date, period, week_label,
                  event_label, game_type, game_time, notes,
                  created_by, created_at, updated_by, updated_at
```

Writer/seeder greps in `scripts/`:
- `_seed_sc_from_xlsx.py` and family: original Sheets-XLSX -> PG seed of sc_day_metadata.
- The Sheets HUB `homestand_schedule` tab (deprecated after sc-13 but retained) contained PREP/OPEN/CLOSE/CLEAN semantics historically. **None of those legacy values survived into `sc_day_metadata.game_type`** - the column only holds HOME / AWAY / OFF / null.

Legacy PREP semantics are NOT the mechanism. Kevin's brief hypothesis around "PREP-day semantics leaking" is refuted by the value distribution.

## §P3.6 CIN 8/17 doubleheader side observation (Step 5)

MLB API for CIN on 8/17:
```
pk=824514 ha=HOME opp=STL status=Scheduled DH-code=S game#=1 gameTime=2026-08-17T17:40:00Z (12:40 PM ET / 12:40 PM ET Cin local)
pk=824478 ha=HOME opp=STL status=Scheduled DH-code=S game#=2 gameTime=2026-08-17T22:40:00Z (6:40 PM ET Cin local)
```

MLB API for CIN on 5/24:
```
pk=824514 ha=HOME opp=STL status=Postponed DH-code=N game#=1 gameTime=2026-05-24T17:40:00Z
```

Note: `game_pk 824514` appears at BOTH dates - it was postponed on 5/24 and rescheduled as the first game of the 8/17 DH.

DB representation:
```
sc_homestand_schedule 2026-05-24: day_type=GAME opp=STL game_pk=824514 game_time=2026-05-24T17:40Z is_doubleheader=FALSE
sc_homestand_schedule 2026-08-17: day_type=GAME opp=STL game_pk=824478 game_time=2026-08-17T22:40Z is_doubleheader=FALSE
```

**Both defects visible**:
1. **5/24 still shows the postponed game** with its original scheduled time. The `_extract_sc_13_away_schedule.mjs` loader picked up the row from the API before the postponement was reflected (or ignored the status). Kevin's screen for 5/24 will render "vs STL 12:40 PM" as if the game is still on.
2. **8/17 shows only ONE row** (the second game, pk 824478 at 5:40 PM CT) and `is_doubleheader=FALSE`. The first game of the DH (pk 824514, 12:40 PM CT) is not represented. The render for 8/17 will show a single "vs STL 12:40 PM" chip - Kevin sees one game where MLB.com shows a DH.

This is a distinct data-model issue (rescheduled-postponed handling + DH representation) - flagged per Kevin's brief; no fix designed. **Not the mechanism for the vanishing getaway days.**

## §P3.7 Fix OPTIONS for bug B (sketched only)

**Option A - Mirror the fee-account fallback into `loadMonthDataPostgres`.**
- Effort: 15-30 min. One block of code identical to lines 1134-1147 of `loadYearSummaryPostgres`, gated on `billingModel === "flat_fee" && hasHomestandData`, iterating `Object.keys(homestandMap)` and adding a default bucket for missing dates.
- Risk: LOW. Additive fallback: only adds dates that would otherwise be missing. classifyDayStatus already handles the added shape (hasAct=false, hasProj=false). Print export benefits automatically because it reads the same sc-load payload.
- **Recommended.** This is the exact same class of fix as the pre-existing year-summary fallback; the two loaders should be symmetric anyway (the comment at :1130-1147 even hints that they are meant to be).

**Option B - Regenerate `sc_daily_revenue` (via projections) so every homestand date has 4 rows.**
- Effort: 3-6 hours. Seeder script that walks homestandMap for each fee account, writes `sc_daily_projections` (or `sc_services` activation rows) for missing dates. Data migration required. Reversible via delete.
- Risk: MEDIUM. Introduces synthetic all-zero projections into the data model. Downstream consumers may not expect a bulk-insert of zero-projection rows (Activity Ledger, save-invalidation, print export totals). Also masks the underlying "why do these dates have no projections" question (which may be intentional per operational practice).
- **Not recommended.** Bandaging data to compensate for a code-path gap.

**Option C - Move the render gate off the sc-load days[] and onto homestandMap.**
- Effort: 2-4 hours. Change MonthCard + PeriodWorkspace + DaySquare so the tile is rendered from `homestandMap[date]` FIRST and falls back to `daysByDate[date]` for meals/actuals. Requires threading homestandMap deeper into the render tree.
- Risk: MEDIUM-HIGH. Touches multiple UI components. Changes the primary key of the day-tile render from date -> homestand-driven.
- **Not recommended** for this bug; Option A is a smaller fix at the same layer.

**Option D - Retire `sc_day_metadata.game_type` entirely.**
- Not applicable to bug B. `game_type` isn't the render gate for the fee branch; it's only used by counters and MiLB day/night parsing. Retiring it would break the "0/15 game days" counter and the CIN 5/29 + 8/20 metadata-only mismatches would stop being detectable.

### Data-repair migration (only if Option B is chosen — not recommended)

```sql
-- NOT RECOMMENDED. Included per Kevin's brief for completeness.
-- For each of the 4 MLB fee accounts, insert a zero-projected row for
-- every service on every homestand date that has no sc_daily_projections
-- row. Reversible via DELETE FROM sc_daily_projections WHERE created_by = 'sc-bug-b-fill'.
--
-- Preferred instead: apply Option A code change (no data migration).
INSERT INTO sc_daily_projections (
  account_key, service_date, service_id, projected_count, created_by, created_at
)
SELECT
  hs.account_key,
  hs.service_date,
  s.service_id,
  0,
  'sc-bug-b-fill',
  now()
FROM sc_homestand_schedule hs
JOIN accounts a ON a.team_key = hs.account_key
JOIN sc_services s ON s.account_key = hs.account_key AND s.active = true
LEFT JOIN sc_daily_projections p
  ON p.account_key = hs.account_key
 AND p.service_date = hs.service_date
 AND p.service_id = s.service_id
WHERE a.billing_model = 'flat_fee'
  AND a.has_homestand_schedule = true
  AND p.id IS NULL;
```

## §P3.8 Open rulings for Kevin

1. **Approve Option A?** It's the smallest, safest, code-only fix. Symmetry with the existing year-summary fallback is a nice property.
2. **Also patch the two CIN mismatches (5/29 and 8/20 - meta.game_type=AWAY but hs+API=HOME)?** These don't affect the tile render (fee branch uses hs.dayType) but they DO make the "0/15 game days" counter wrong on those two dates. Fix scope: two rows of UPDATE against sc_day_metadata OR a rewrite of the counter to use hs.dayType. Not urgent, but worth naming.
3. **Chase STL 7/23 (API HOME, no hs row)?** Part 1 reported STL as CLEAN; my probe found this specific date missing. May be a Part 1 audit false-negative (a single date buried in the CLEAN bucket). Also: STL API has 166 games vs 162 hs rows - 4-game gap; a full-list-diff would surface all four. Parked pending Kevin's ruling on whether to run.
4. **TXR 3/26/28/29 meta.game_type=null?** Three opening-series AWAY dates have no game_type in meta. Not urgent (hs is correct so tile renders) but the counter will miscount them.
5. **CIN 8/17 DH + 5/24 postponed?** Distinct data-model issue. Flagged per Kevin's brief; no fix designed. Awaits a separate Kevin-driven sc-XX for postponement/DH representation.
6. **Does Bug B (this) contribute to Bug A (July month-swap)?** **No.** Bug B is a static data-shape gap in `loadMonthDataPostgres` that fires deterministically for a specific set of dates. Bug A is a transient client-state issue (per prior addendum + Kevin's Aug screenshots showing correct data). They live at different layers and have no shared code path. Independent threads.

## Guardrails observed in Part 3

- No writes to any DB.
- No modifications to any source file.
- No modifications to any migration file.
- No touches to any branch. Read-only probes only.
- MLB API pulls consistent with Part 1 usage.
- Sheets HUB not touched.

## Files added during Part 3 audit

- `scripts/_probe_sc_daytype_metadata_three_way_diff.mjs` (new, READ-ONLY)
- `scripts/_probe_sc_pattern_dates_targeted.mjs` (new, READ-ONLY)
- `/tmp/txr_schedule_audit.md` (this append)


---

# BUG A FOLLOW-UP — component pin + zombie-data render trace (2026-07-14)

> **Status**: READ-ONLY per Kevin's amendment. Diagnosis phase NOT re-run (per amendment brief). Only the two newly-authorized items: (a) grep the literal UI strings to pin the exact component tree, (b) enumerate every month-key/label derivation in that component and where the zombie `useState(new Date().getMonth())` legacy fetch's payload actually renders.

## §A.1 UI-string grep - which surface painted Kevin's July screenshots?

Kevin's fingerprint strings mapped to code:

```
"MON TUE WED" (all caps header) ->
  Only match: src/lib/print/monthSheet.js:378
    <tr><th>MON</th><th>TUE</th>...</tr>
  The SCREEN uses title-case: src/app/service-calendar/season/PeriodWorkspace.js:781
    {["Mon","Tue","Wed",...].map(...)}

"vs {OPP}" chip ->
  Screen: DaySquare.js:384 (exhibition), 482 (per-meal), 523 (fee), 584 (milb), 625 (fee-no-dollar)
    All render lowercase literal: <span>vs {opponent}</span>
  PDF: monthSheet.js:461-471 renderGameCell
    No "vs" prefix; just <span class="opp">{oppLabel}</span> (bare opponent code)

"@ {OPP}" or "@OPP" ->
  Screen: DaySquare.js:407 renderAway
    <span>@ {opponent}</span> (space before opp)
  PDF: monthSheet.js:477 renderAwayCell
    `@${esc(home.opponent)}` (no space)

"no service" italic ->
  Screen: DaySquare.js:410-412 renderAway
    <span className="sc-daysq-mid-noservice sc-daysq-mid-noservice--away">no service</span>
    (visibility gated to !sm - only renders on lg tiles, matches Kevin's fingerprint)
  PDF: monthSheet.js:495 "NO SERVICE" (all caps, for PDC/AAA state cell, NOT MLB variant)

Plane icon ->
  Screen: DaySquare.js:303 (top-right absolute plane glyph on away tiles)
    Guard: !sm - lg tiles keep the plane, sm drops it
  PDF: no plane in MLB variant

Sun/moon time pill ->
  Screen: DayNightPill component (imported in DaySquare + PeriodWorkspace)
  PDF: monthSheet.js `<span class="tm day">` - just text (no glyph)

"~180 meals" ->
  Screen: PeriodWorkspace.js:896-908 buildLargeContent (mlb-fee variant)
    isEstimated: !day.hasActuals -> prefix "~" on the meals count
  PDF: not part of MLB variant (which has no meal stack)
```

**Verdict on surface**:
- "MON TUE WED" (all caps) = **PDF only**
- Plane icon + "no service" italic + sun/moon pill = **SCREEN only** (and lg-scope only)
- "~180 meals" = SCREEN (and only when isEstimated=true, i.e. past date, no actuals - MLB fee accounts have no state layer per R5, so every day reads isEstimated)

**Kevin's fingerprint mixes strings from both surfaces.** Two live possibilities:

1. **Kevin's July screenshot was actually the PDF export** (all-caps MON header decisive), and he mentally added the "vs OPP" / sun-moon description from a parallel screen mental model. This aligns with the extensive PDF work in this session's pre-history.
2. **Kevin's July screenshot was the SCREEN Month drill** (plane icon + sun/moon pill decisive), and the "MON TUE WED" was Kevin paraphrasing rather than reading a literal string. This aligns with Part 2's brief phrasing "on-screen Service Calendar renders a DIFFERENT schedule".

Without a fresh screenshot to disambiguate, I cannot rule either out. The two surfaces have DIFFERENT code paths and DIFFERENT month-derivation logic (see next section).

## §A.2 Zombie-data render surfaces + every month-key/label derivation

### The zombie: `ServiceCalendar.js:267`

```js
const [year] = useState(2026);
const [month, setMonth] = useState(new Date().getMonth());   // ← 0-indexed local state
```

**Zero callers of `setMonth`** (verified via `grep -n "setMonth(" src/app/service-calendar/ServiceCalendar.js`). `month` is initialized once at mount from the client's local clock and NEVER mutated after. Any operator who loaded the tab in April keeps `month=3` until the tab is reloaded.

### The zombie's fetch effect (:507-518)

```js
const mk = `${year}-${String(month+1).padStart(2,"0")}`;      // ← derived from zombie
useEffect(() => {
  if (!selectedAccount) return;
  const controller = new AbortController();
  ...
  fetch(`/api/service-calendar?action=sc-load&account=${selectedAccount}&month=${mk}&clientToday=${...}`, { signal: controller.signal })
    .then(r => r.json())
    .then(d => { if (d.success) setData(d); ... })
    ...
}, [selectedAccount, mk, showToast, reloadKey, today]);
```

The fetch fires with the ZOMBIE month value. Response lands in `data`. This is the LEGACY calendar-month API - it's still wired to the mount-time month.

### Every consumer of `data` (the zombie payload)

Full grep of `data.` / `data?.` in `ServiceCalendar.js`, categorized:

**Category 1 - safe (account meta, doesn't change per month)**:
- `data?.account` -> passed as `<SeasonShell account={...}>` (:2113), `<PeriodWorkspace account={...}>` (:2156, :2207)
- `data.serviceGroups` -> `priceLookup` (:801) - price lookup by service colIndex, month-independent

**Category 2 - dead code (fallback never fires because `{}` is truthy)**:
- Period view: `<PeriodWorkspace homestandMap={periodHomestandMap || homestandMap}>` (:2167)
  - `periodHomestandMap` at :867-873 = merged homestandMaps from monthCache. Empty case: `{}` (not null). Truthy. Fallback DEAD.
- Month drill: `<PeriodWorkspace homestandMap={monthHomestandMap || homestandMap}>` (:2217)
  - `monthHomestandMap` at :920-923 = `monthCache[monthKey]?.homestandMap || {}`. Truthy always when monthKey set. Fallback DEAD.
- Day-detail overlay: `homestandContext={(periodHomestandMap || homestandMap)[focusDay] || null}` (:2293)
  - Same fallback pattern. Dead.

**Category 3 - fallback lookup (secondary, not primary render)**:
- Save handlers (:1549, :1631, :1693): `const day = activeDrillDays?.find(...) || dayMap[dk]`
  - `dayMap` (:786) derived from `data.days`. Fallback used ONLY if the drill's `activeDrillDays` doesn't have the target date. On Month/Period drill with data loaded, `activeDrillDays` is populated and dayMap is not consulted.
- Bulk overlay row list (:2377, :2485): same `activeDrillDays?.find(...) || dayMap?.[dk]` pattern.

**Category 4 - PRIMARY render surface** (NONE for the zombie's month-specific fields):
- No primary render of the zombie's `data.days` on the Month drill body (uses `monthDays = monthCache[monthKey].days`).
- No primary render of the zombie's `data.homestandMap` on the Month drill body (uses `monthHomestandMap = monthCache[monthKey].homestandMap`).
- No primary render on the Period workspace (uses `periodDays` + `periodHomestandMap`).
- The Season overview uses `yearData` (from sc-year-summary), not `data`.

### The URL-based month derivations (the LIVE month source for the drill body)

Multiple month-key/label derivations exist in the file. Enumerated:

```
:267   month           useState(new Date().getMonth())          ZOMBIE (0-indexed)
:334   monthKey        useState(null)                            URL-synced, "YYYY-MM"
:507   mk              `${year}-${String(month+1).padStart(2,"0")}`      ZOMBIE-derived
:673-695 URL-sync effect: setMonthKey(searchParams.get("month"))         LIVE, "YYYY-MM"
:898-906 monthRange    useMemo from monthKey ("YYYY-MM" -> start/end)    LIVE
:908-913 monthDays     monthCache[monthKey]?.days                        LIVE
:920-923 monthHomestandMap monthCache[monthKey]?.homestandMap || {}      LIVE
:927-930 monthScheduleOverlay monthCache[monthKey]?.scheduleOverlay      LIVE
:1883-1888 handlePrevMonth: parse monthKey.slice(5,7) as number         LIVE
:1890-1895 handleNextMonth: same                                        LIVE
:1897-1901 handleMonthTodayJump: today?.slice(0,7)                      LIVE
:1903 drillMonthIdx    Number(monthKey.slice(5, 7))                     LIVE
:1906 isCurrentMonth   today?.slice(0,7) === monthKey                   LIVE
```

**The Month drill body renders EXCLUSIVELY from URL-based (LIVE) monthKey derivations. The zombie's payload is NOT the render source for the drill body.**

For the Month drill, if URL says `?month=2026-07` and the LIVE fetch at :610-642 lands correctly, the body renders July. The zombie fetch fires in parallel, populates `data`, but `data`'s month-specific fields are dead-code fallbacks or safe (account meta, service groups).

### The one live-surface consumer of the zombie's homestandMap I could find

`:1042-1043`:
```js
const hasHomestandSchedule = !!data?.homestandMap;
const homestandMap = data?.homestandMap || {};
```

These variables are then passed to consumers at :2167 (Period) and :2217 (Month drill) as the fallback of the `||` expression. As noted above, the fallback branch is dead code because the primary term is always truthy.

**Verdict for §A.2**: **On code-read of the Month drill body, the zombie fetch cannot produce Kevin's symptom**. Every render surface for the drill body reads from URL-based monthKey, not from the zombie's mount-time month state. And every code-read of the fetch race + cache-key + route params in the prior addendum still holds.

## §A.3 What is left to explain Kevin's July symptom

Combined evidence:
- Bug A addendum (prior): server clean, cache keys distinct, race guarded, route bounds correct.
- Kevin's Aug screenshots (this brief): August renders correctly with correct labels + correct data. Argues AGAINST any deterministic month-derivation offset (if one existed, August would render May per the 3-month deltas Kevin observed for July).
- §A.1 above: two candidate surfaces (PDF or SCREEN) with different code paths.
- §A.2 above: on the SCREEN Month drill, the zombie can't reach the render.

Two remaining plausibility windows for Bug A:

**(i) SCREEN, transient path-dependent state.** A React scheduling / concurrent-mode interaction I cannot see from code-read. Requires a specific navigation history to reproduce. NOT reproducible from a clean load; needs the same click sequence + timing to catch. This matches Kevin's amendment framing: "path-dependent transient state, reproducible only along a navigation history, not a static code bug."

**(ii) PDF export from a stale monthCache.** If the PDF export path shares state with the SCREEN (it doesn't; the PDF route is server-side and reloads its own data via `loadMonthPrintData`), then no. If Kevin's PDF screenshot came from a PDF he generated BEFORE some data was corrected (a saved file, not a live re-print), the PDF could be a snapshot of a prior data state.

Neither (i) nor (ii) gives a named file:line mechanism from code alone. **Per Kevin's hard rule ("no fix ships for bug A without a named file:line mechanism"), I am NOT proposing a fix.**

## §A.4 REPRODUCTION CHECKLIST for Bug A (deliverable per Kevin's brief)

Ship-and-park format. Kevin's next reproduction attempt collects these to unblock a real fix.

**Surface**: which one Kevin was on:
- [ ] SCREEN Season overview (year heatmap, monthKey=null)
- [ ] SCREEN Month drill (URL: `/service-calendar?account=X&month=YYYY-MM`)
- [ ] SCREEN Period workspace (URL: `/service-calendar?account=X&period=<P#>`)
- [ ] PDF Month export (URL: `/api/service-calendar/print?account=X&scope=month&year=YYYY&month=YYYY-MM`)
- [ ] PDF Period export (scope=period)
- [ ] PDF Season or Year sheet (scope=season | year)
- Marker to distinguish SCREEN vs PDF: SCREEN has plane icon + sun/moon pill glyph + lowercase "vs OPP". PDF has all-caps "MON TUE WED" header + navy "OPP" (no "vs") + no plane glyph in MLB variant.

**Account**: exact `team_key` (e.g. `TXR - TX - H`).

**Exact click path** (Kevin's navigation history to arrive at the "wrong" screen):
- Starting URL: (e.g. `/service-calendar` bare, or a specific deep link)
- Sequence of clicks / URL changes leading to the wrong render
- Approx timing (rapid vs slow)
- Did Kevin switch accounts between clicks? Did Kevin use the back button?

**Capture**:
- The FULL URL bar at the moment the "wrong" render is visible
- One sc-load Network row from DevTools: request URL, response payload (or at least the payload's `days[0].date` field and `homestandMap` first key)
- (Optional) `console.log(monthCache)` or `window.__scDebug = monthCache` snapshot

**Where to find these in DevTools**:
1. Open the page.
2. Open DevTools -> Network tab. Filter by `sc-load`.
3. Reproduce the wrong state (following the click path above).
4. In Network tab, find the sc-load row(s). Click on the response. Copy the response JSON.
5. Copy the URL bar and paste both into a GitHub issue or a doc.

Any ONE of these three data points narrows Bug A to a specific file:line. Without them, the code doesn't reveal a mechanism.

## §A.5 Docs update path

Per Kevin's brief: "park bug A as a documented pre-release known-issue pending reproduction". Suggested docs edits (NOT applied - awaiting Kevin's ruling):

- `docs/SC_STATUS.md` known-issues section: add "Bug A - Month-swap in-drill (path-dependent, awaits repro)". Include the reproduction checklist above.
- `docs/RUNBOOK.md` no changes (no infra affected).
- `docs/GOTCHAS.md`: "SC month-swap bug A - never reproduced from a clean load, but Kevin observed it once; if you see it again, capture per §A.4 checklist."

## §A.6 Verdict summary

**Bug A**: no named file:line mechanism from code-read. Parked as documented pre-release known-issue with the §A.4 reproduction checklist.

**Bug B** (Part 3): named mechanism at `src/lib/dataStore/serviceCalendar.js:685-836` (`loadMonthDataPostgres` missing fee-account fallback). Fix Option A ready to ship on Kevin's approval (see §P3.7). Ships independently of Bug A per amendment brief.

## Files added during Bug A follow-up

No new probes. Grep-only work. This section is text-only additions to `/tmp/txr_schedule_audit.md`.


---

# PART 4 — AAA + FSL bidirectional audit + full PPD/DH population (2026-07-14)

> **Status**: READ-ONLY. Zero writes. Zero migrations. Zero branch touches. This audit is the input for the DH/PPD Option A design that finalizes after Kevin sees the full population.
>
> **One-line bottom line**: **The DH/PPD population is much larger than the three known examples.** 29 doubleheader dates + 30 PPD games + 24 date-drift rows + 5 real missing AAA rows across all 8 schedule-bearing accounts. Every DH date the DB touches carries only ONE row (the second game overwrites the first via `homestandMap[date] = ...` object semantics). Kevin's Option A array-values design is the correct next step; this population is what it must handle.

---

## §P4.1 Name-resolved team IDs (Step 1)

Queried `statsapi.mlb.com/api/v1/teams?sportId=X&season=2026` for sportIds 11-14, matched targets by NAME:

| Account | Team name | sportId | teamId | League | Venue |
|---|---|---|---|---|---|
| CIN - KY | Louisville Bats | 11 (Triple-A) | 416 | International League | Louisville Slugger Field |
| TBJ - NY | Buffalo Bisons | 11 (Triple-A) | 422 | International League | Sahlen Field |
| STL - FL | Palm Beach Cardinals | **14 (Low-A)** | 279 | Florida State League | Roger Dean Chevrolet Stadium |
| TBJ - FL | Dunedin Blue Jays | **14 (Low-A)** | 424 | Florida State League | TD Ballpark |

**FSL currently classifies as sportId 14 (Low-A)**, not High-A. Confirmed via the API's own team-level attribution. Both PDCO affiliates share the FSL league.

## §P4.2 Bidirectional diff, all 8 schedule-bearing accounts (Step 2)

Both directions per Kevin's amendment: **every DB row -> API game AND every API game -> DB row on its correct current date**. Bucket taxonomy: OK, ATTRIBUTE_DRIFT (pk+date match, opp/ha drift), DATE_DRIFT (pk match, hs.service_date != API date), MISSING_IN_DB (API pk absent from hs), PHANTOM_IN_DB (hs pk absent from API), PPD (status), DH (doubleHeader != N).

### MLB (4 accounts) — reverse walk re-verifies + surfaces Part 1's gap

| Account | API games | hs rows | OK | DATE_DRIFT | MISSING_IN_DB | PHANTOM_IN_DB | PPD | DH dates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CIN - OH | 164 | 162 | 162 | **2** | 0 | 0 | 2 | 2 |
| STL - MO | 166 | 162 | 162 | **4** | 0 | 0 | 4 | 3 |
| TXR - TX - H | 162 | 164 | 162 | 0 | 0 | 2* | 0 | 0 |
| TXR - TX - V | 162 | 164 | 162 | 0 | 0 | 2* | 0 | 0 |

_*TXR PHANTOM_IN_DB rows = the 2 EXHIBITION spring rows (2026-03-23, 2026-03-24 vs KC per sc-12). API's `gameType=R` filter excludes exhibitions; not real orphans._

**Part 1's "missing=0" claim was DB->API only.** The API->DB walk surfaces the DATE_DRIFT population: MLB pks that got postponed and rescheduled, DB frozen on the ORIGINAL date. All match the "postponement-then-DH-makeup" mechanism from CIN 8/17 + 5/24.

Verbatim MLB DATE_DRIFT rows:

```
CIN - OH:
  pk=824518  api_date=2026-05-23 (Final)      hs_date=2026-05-22  api=HOME/STL  hs=GAME/STL
  pk=824514  api_date=2026-08-17 (Scheduled)  hs_date=2026-05-24  api=HOME/STL  hs=GAME/STL

STL - MO (mirror of CIN's home DHs from the visiting side + STL's own):
  pk=824518  api_date=2026-05-23 (Final)      hs_date=2026-05-22  api=AWAY/CIN  hs=AWAY/CIN
  pk=823062  api_date=2026-07-07 (Final)      hs_date=2026-05-05  api=HOME/MIL  hs=GAME/MIL
  pk=823042  api_date=2026-07-23 (Scheduled)  hs_date=2026-06-25  api=HOME/ARI  hs=GAME/ARI  ← the STL 7/23 case, resolved
  pk=824514  api_date=2026-08-17 (Scheduled)  hs_date=2026-05-24  api=AWAY/CIN  hs=AWAY/CIN
```

**STL 7/23 reconciled**: it's a DATE_DRIFT. Real game (pk 823042 vs ARI at Busch Stadium) is on 7/23 per API. DB still has it on 6/25 (the original postponed date). Same class as CIN 5/24 -> 8/17. Not a "missing row" in the API-only sense; it's a "row on the wrong date" that Part 1's forward walk couldn't detect.

### AAA (2 accounts, sportId 11)

| Account | API games | hs rows | OK | DATE_DRIFT | MISSING_IN_DB | PHANTOM_IN_DB | PPD | DH dates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CIN - KY | 159 | 149 | 149 | **6** | **4** | 0 | 7 | 7 |
| TBJ - NY | 158 | 149 | 149 | **8** | **1** | 0 | 8 | 9 |

**CIN - KY MISSING_IN_DB is a real gap**: all 4 rows share game_pk=816263 (vs STP series) - postponed 6/25 then rescheduled multiple times (6/26 as DH game 2, 6/27 as DH game 2, 7/18 as DH game 2). sc-16 loaded only the first occurrence; the API's re-relocation of the same pk to later dates never propagated. The pk stayed anchored to 6/25 in DB.

**TBJ - NY MISSING_IN_DB**: 1 row (pk 816824, 9/12 vs CLT, DH game 2, status Scheduled). AAA is billing-relevant per Kevin's ruling (per-meal actuals × prices) - a missing schedule day means the operator wouldn't see a game-day tile on the drill AND the associated meal projection likely doesn't exist. Post-Bug B fix the tile materializes IF hs has the row - it doesn't. Real hole.

### FSL / PDCO (2 accounts, sportId 14)

| Account | API games | hs rows | "OK" | DATE_DRIFT | MISSING_IN_DB | PHANTOM_IN_DB | PPD | DH dates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| STL - FL | 137 | 66 | 66 | 1 | **70†** | 0 | 5 | 3 |
| TBJ - FL | 139 | 66 | 66 | 3 | **70†** | 0 | 4 | 5 |

_†PDCO MISSING_IN_DB is HOME-only-by-design (sc-17 / sc-17b overlay carries GAME rows only). Every MISSING_IN_DB row in the FSL bucket is a real API AWAY game correctly NOT loaded into the overlay. If Kevin's doctrine widens overlay to include AWAY (a future PR), these become gaps; today they're expected._

**Real PDCO gaps** (not by-design):
- **STL - FL 5/13 DH divergence**: 2 API games (pk 820419 postponed 5/12 rescheduled to 5/13 as DH game 2; pk 820420 the originally-scheduled 5/13). DB has 1 row on 5/12 (the original). DH date coverage: 1 row where 2 needed.
- **TBJ - FL 4/4, 5/21 HOME DH divergences**: same class - HOME DH dates where DB has 1 row.

### Rollup

- **Total DH dates across all accounts: 29** (2 MLB + 3 MLB + 0 + 0 + 7 AAA + 9 AAA + 3 FSL + 5 FSL). Of these:
  - **HOME-side or PDCO-HOME (need DB coverage)**: 8 (CIN-OH 5/23 + 8/17; STL-MO 5/23 + 7/7 + 8/17; STL-FL 5/13; TBJ-FL 4/4 + 5/21).
  - **AAA-side (need 2 rows regardless of HOME/AWAY per sc-16 doctrine)**: 16 (CIN-KY 7 + TBJ-NY 9).
  - **PDCO AWAY-side (by design not in overlay)**: 5 (STL-FL 6/21 + 7/2; TBJ-FL 4/11 + 6/11 + 6/12).
- **Total PPD games**: 30. Every single one has a corresponding DATE_DRIFT or MISSING_IN_DB entry - PPD -> the API relocates the pk, DB stays on the original date.
- **Total DATE_DRIFT rows**: 24. Every one is a postponement mechanism (Final on the new date; DB on the original).
- **Total real MISSING_IN_DB rows**: 5 (CIN-KY 4 + TBJ-NY 1) - AAA rescheduled DH secondaries never captured.
- **PHANTOM_IN_DB**: 4 (TXR EXH pairs, by design).

## §P4.3 Full PPD/DH population Option A must handle (Step 3)

The population Kevin's Option A array-values design must correctly represent:

### 29 DH dates (2026)

```
CIN - OH    : 2026-05-23 (STL DH, pk 824517 + 824518)
              2026-08-17 (STL DH, pk 824478 + 824514)
STL - MO    : 2026-05-23 (CIN DH, mirror)
              2026-07-07 (MIL DH, pk 823063 + 823062)
              2026-08-17 (CIN DH, mirror)
CIN - KY    : 2026-05-07, 05-17, 05-23, 06-19, 06-26, 06-27, 07-18
TBJ - NY    : 2026-03-29, 04-04, 04-08, 04-17, 04-26, 05-01, 05-24, 07-11, 09-12
STL - FL    : 2026-05-13, 06-21, 07-02  (only 5/13 is HOME-side)
TBJ - FL    : 2026-04-04, 04-11, 05-21, 06-11, 06-12  (4/4 + 5/21 are HOME-side)
```

### 30 PPD games (2026)

Postponed / Suspended / Rescheduled. Each has been re-anchored to a new date by the API; DB frozen on original. Full listing embedded in the probe output; abbreviated summary here:

```
CIN - OH :: 2  (5/22 -> 5/23 DH; 5/24 -> 8/17 DH)
STL - MO :: 4  (5/5 -> 7/7 DH; 5/22 -> 5/23 DH; 5/24 -> 8/17 DH; 6/25 -> 7/23)
CIN - KY :: 7  (5/5, 5/16, 5/22, 6/18 next-day / 6/25 series to 6/26+27+7/18)
TBJ - NY :: 8  (3/28, 4/3, 4/7, 4/16, 4/25, 4/29, 5/23, 7/9 all next-day)
STL - FL :: 5  (5/12, 6/20, 7/1, 7/12, 8/11 - two "Suspended" games in the pk 820716 pair)
TBJ - FL :: 4  (4/2, 4/8, 5/19, 6/10)
```

**Postponement pattern**: 26 of 30 PPDs re-anchor to next-day or DH-secondary-slot. 2 relocate weeks later (CIN 5/24 -> 8/17; STL 5/5 -> 7/7). 2 (STL - FL 7/12 + 8/11) share pk 820716 with status "Suspended" - API represents a suspended-then-completed game as two rows with the same pk on two dates.

### DH representation gap (visualized)

Current `sc_homestand_schedule` shape:
- **PRIMARY KEY**: (account_key, service_date) implicit via `sc_homestand_schedule.id` (auto), enforced-in-practice by the extract's INSERT block (one row per date per team).
- **game_pk column**: unique per game but not the primary key.
- **is_doubleheader column**: boolean.
- **game_time column**: single UTC timestamp.

For a DH date, only one of the two games' fields survives (opponent, game_time, day_night). Which one depends on the extract's iteration order — typically the LATER game (game #2) wins since it's often appended last in the API response.

**All 29 DH dates in DB currently carry 1 row (or 0 if AWAY-in-overlay).** Not one carries the two-row representation the doctrine requires.

## §P4.4 Projection-alignment diff (Step 4)

For AAA + FSL where meal counts feed billing:

### CIN - KY (Louisville, AAA)
- Schedule days without projections: **0**
- Projection days NOT in schedule: **40** (spring warm-ups, off-days operator provisions for)

### TBJ - NY (Buffalo, AAA)
- Schedule days without projections: **0**
- Projection days NOT in schedule: **40** (same pattern)

**Note**: earlier Part 3 rider probe reported 7 HOME + 5 AWAY without projections for TBJ - NY. That reported the sub-selection to `sc_daily_revenue`'s `has_projection` flag per (date, service). This probe rolls up to any-service-projects-for-date. The two views disagree because a date can have 0 has_projection=true rows across all services (all zeroes/empty) while still having rows in the view (0-count projections). Reconciling: probably 12 TBJ - NY dates have projection ROWS but all counts are zero. Kevin's call whether to treat 0-count as "no projection".

### STL - FL (Palm Beach, FSL Low-A)
- Schedule days without projections: **1** (2026-08-22)
- Projection days NOT in schedule: **232** (Feb-Sep, year-round PDC service beyond the affiliate's regular season)

### TBJ - FL (Dunedin, FSL Low-A)
- Schedule days without projections: **2** (2026-06-07, 2026-07-18)
- Projection days NOT in schedule: **232** (same pattern - Feb-Sep)

**Interpretation (per Kevin's doctrine "AAA + MiLB are per-meal × prices")**:

- **PDCO year-round projections** (232 days) = legit operator-authored service outside the FSL regular-season window. Palm Beach + Dunedin PDCs run spring training + FCL + minor-league backup + rehab all year; the FSL affiliate's games are a subset. Projections cover the FULL calendar. Not the "authored-before-schedule" bug class; the CALENDAR IS BROADER than the affiliate's regular season by design. Doctrine-consistent as long as billing runs on actuals × prices per Kevin.
- **AAA 40-day authored-off-schedule projections** = operator anticipates service on off-days (rehab, extended camp). Same pattern, smaller footprint.
- **Schedule days without projections**: 3 real gaps (STL 8/22, TBJ - FL 6/7 + 7/18). Post-Bug-B fix the tiles materialize; billing = 0 unless operator enters actuals. Kevin's call whether to backfill projections OR let actuals-only billing carry them.

## §P4.5 Option A representation design (Step 5)

Kevin's ruling: array values in homestandMap; final design informed by the full population above.

### Doctrine-aligned target shape

```
loadHomestandContext returns {
  [service_date]: [
    { homestandId, dayType, opponent, dayNight, gameTime, isDoubleheader, gameNumber, gamePk },
    ...
  ]
}
```

**One entry per API game**. Order: game_number ascending (game 1 first). Single-game dates carry a 1-element array; DH dates a 2-element array.

### Schema touch (sc_homestand_schedule)

**Current**: (account_key, service_date, game_pk unique-ish, is_doubleheader boolean). Enforcement is loose — nothing prevents two rows on one date today except the extract's INSERT block.

**Proposed**: add `game_number INT DEFAULT 1` column. Composite uniqueness: `UNIQUE (account_key, service_date, game_number)` OR keep `UNIQUE (account_key, game_pk)`. Migration writes game_number=1 for all existing rows; DH rows require a second INSERT with game_number=2.

### Loader (`src/lib/dataStore/serviceCalendar.js`)

**`loadHomestandContext`** at :976:
- Change return shape from `{ date: entry }` to `{ date: [entry, ...] }`.
- Sort by game_number within each date's array.

**`loadScheduleOverlay`** at :1040:
- Same shape change.

**`addMissingScheduleDates`** at :29 (my Bug B helper):
- Iterate over dates (unchanged - still keyed by date).
- No shape change to `defaultFactory` output — the day map's entry is per-DATE, not per-GAME.

**`loadYearSummaryPostgres` day merge** at :1235 (`const hs = homestandMap[s.date]`):
- `hs` is now an array. Pick the primary game (game 1) for status classification.
- Also emit `dh.games = [{ opponent, gameTime, dayNight, gameNumber }, ...]` on the dayEntry so consumers can render both.

**`loadMonthDataPostgres`** identical change.

### Client render layer

**`ServiceCalendar.js`** at :1043: `homestandMap = data?.homestandMap || {}` unchanged as a shape but consumers must iterate.

**`PeriodWorkspace.buildLargeContent`** at :895: currently reads `homestandMap[day.date].opponent`. Change to read `homestandMap[day.date][0].opponent` OR aggregate: `"{opp1} · DH · {opp2}"`.

**`dayResolvers.buildCompactContent`** at :117: reads `day.opponent` (already-flattened by loadYearSummary's merge). Change to read `day.opponent` (primary) + optionally `day.dhOpponents` for a DH badge.

**`DaySquare.renderMlbFee` / `renderMilb`**: DH already handled via `isDoubleheader` + `· DH` affix. Optionally show second game's time via a stacked pill.

**Print (`src/lib/print/monthSheet.js` `renderGameCell`)**: same treatment — primary game's time + `· DH` affix; optional second-game pill.

### Extract script (`scripts/_extract_sc_13_away_schedule.mjs`)

- Emit `game_number` column in the generated INSERT SQL.
- Include EVERY game (not just game 1) — currently the script emits one row per API game but relies on service_date being unique per row. Add game_number tie-breaker.

### Migration path (sc-19 or sc-20)

1. `ALTER TABLE sc_homestand_schedule ADD COLUMN game_number INT DEFAULT 1;`
2. Backfill existing rows: `UPDATE sc_homestand_schedule SET game_number = 1;`
3. Add unique constraint: `CREATE UNIQUE INDEX ix_hs_acct_date_gnum ON sc_homestand_schedule(account_key, service_date, game_number);`
4. Re-run the sc-13 / sc-16 / sc-17 / sc-17b extract scripts against the current API. Insert missing DH secondaries (all 29 DH dates × ~1 additional row = ~29 rows).
5. Reconcile DATE_DRIFT rows (24 rows): `UPDATE sc_homestand_schedule SET service_date = <api_date> WHERE game_pk = <pk> AND service_date = <old_date>;` — per row, from the audit output above. Or do it via a full re-extract with `ON CONFLICT (account_key, game_pk) DO UPDATE`.
6. Add MISSING_IN_DB AAA rows (5 rows: CIN-KY 4 pk 816263 secondaries + TBJ-NY pk 816824).

### Effort / risk

- **Schema migration + backfill**: 30-60 min. LOW risk. Reversible.
- **Loader shape change**: 2-4 hours. MEDIUM risk. Every consumer of homestandMap (screen tile, print, year-summary merge) touches. Comprehensive test coverage needed.
- **Client + print render update**: 2-3 hours. LOW-MEDIUM risk. Additive rendering (primary + DH badge/pill).
- **Extract script update + re-run**: 30-60 min. LOW risk. Idempotent upsert.
- **Total sizing**: **1-2 day PR** for the full change. Kevin's follow-up (post-pricing-summit + cron brief) can package this.

### Cron implications

Kevin's separate ruling: cron is split, brief coming after Part 4. Anticipated shape:

- Nightly extract for all 8 accounts against MLB + MiLB Stats API.
- Diff generated INSERT/UPDATE against current DB via ON CONFLICT DO UPDATE.
- Emit a review-ready migration draft to a dashboard or GitHub artifact.
- Kevin approves via checkbox or Studio-paste.

Option A + nightly refresh together retire the PPD/DATE_DRIFT class permanently.

## §P4.6 Open rulings for Kevin

1. **Approve Option A design as sized (§P4.5)** for a follow-up PR after the pricing summit + cron brief?
2. **Reconcile the 24 DATE_DRIFT rows manually** now (single sc-XX with 24 UPDATEs) or **let a nightly cron catch them**?
3. **AAA MISSING_IN_DB (5 rows)**: fill via a targeted sc-XX (mirroring sc-18's counter-patch shape) OR wait for the full re-extract in the Option A PR?
4. **PDCO overlay widening**: expand sc-17/sc-17b to include AWAY games so PDCO's calendar is complete? Currently HOME-only by design. If the calendar-truth doctrine says "day-existence for schedule-bearing accounts", AWAY days matter for the operator's calendar even if they don't drive tile status. Sizing: 30-60 min per account (script + migration).
5. **Projection alignment**: STL-FL + TBJ-FL 232 off-schedule projection days — leave as-is (per the "PDC serves year-round, FSL is a subset" reading) or flag for pricing summit as billing-model clarity?
6. **Rider (2) from Bug B**: 0 HOME games missing projections on MLB fee accounts (verified in Part 4 - same result as the Bug B rider). No backfill needed. Standing.

## Guardrails observed in Part 4

- No writes to any DB.
- No modifications to any source file (post-PR-#430 merge).
- No modifications to any migration file.
- No touches to any branch. Read-only probes only.
- MLB + MiLB API pulls consistent with Part 1 usage; MiLB team resolution by name per Kevin's ruling.

## Files added during Part 4

- `scripts/_probe_sc_part4_milb_name_resolve.mjs` (READ-ONLY, name resolution)
- `scripts/_probe_sc_part4_bidirectional_diff.mjs` (READ-ONLY, full bidirectional diff + PPD/DH + projection alignment)
- `/tmp/txr_schedule_audit.md` (this append)
