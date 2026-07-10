# sc-13 - MLB Stats API feasibility investigation

**Generated:** 2026-07-10
**Scope:** READ-ONLY. Hit the public MLB Stats API to inspect its response shape and coverage; write NOTHING to Postgres. Deliverable is this doc; Kevin + Chat decide load-once vs live-sync from it.
**Prior context:**
- `docs/audits/SC_13_SCHEMA_REVIEW_2026-07-10.md` recommends Option 1 (extend `sc_homestand_schedule` in place) for the schema. This doc feeds the source-of-data decision that pairs with that schema call.
- sc-12 (PR #385, merged) reconciled DB to the 4 official MLB promo PDFs and seeded the first EXHIBITION rows.
- Kevin's ruling on external sources: MLB Stats API is APPROVED as a *planned-schedule* source. Take date + home team + away team + venue + scheduled time + stable game id ONLY. Ignore scores / results / live-status. A postponed game still lives at its originally-scheduled slot - take the plan, not the outcome.

---

## TL;DR

1. **The API cleanly returns exactly what we need.** 162 games per team (81 home + 81 away), stable per-game identifier (`gamePk`), unambiguous home/away distinction, opponent identity as MLB `team.id`. No auth, no rate limit surfaced under normal use, well-established endpoint.
2. **API cross-checks the sc-12 reconciliation independently.** STL and TXR: zero home-date diff, zero opponent diff vs the current `sc_homestand_schedule` seed. CIN: the ONE date diff (6/22 vs 6/25 MIL) is exactly the sc-12 R3 correction. This is a strong data-trust signal - the API-published planned schedule and the PDF-derived seed agree row for row.
3. **The API DOES carry the TXR spring-training KC exhibitions** we hand-seeded (`gameType='S'` at Globe Life Field, both dates match, both vs Kansas City Royals). If sc-13 goes live, the EXHIBITION seed becomes derivable, not hand-maintained.
4. **Postponements are handled with a "shadow entry" pattern** the API preserves at the ORIGINAL date. Combined with makeup entries, they de-duplicate to the planned schedule cleanly - the load logic is simple (`~10 lines of Python/JS`). This survives Kevin's "take the plan, not the outcome" rule.
5. **Recommendation:** ship the **load-once path first** (Phase 1), add `gamePk` as a nullable column now so Phase 2 has the seat waiting, defer live-sync until an operational case forces it. The API validates our seed and the 2026 schedule is now stable through October; live-sync buys future-proofing but not immediate ops value. Phase 2 (sync + review queue) is ~3-5x the work of Phase 1 and its riskiest surface is "how do we handle a MLB-vs-DB disagreement without silently overwriting Kevin's ops truth."
6. **Blocking question for Kevin (blast radius answer, but timing decision is yours):** are you willing to introduce `gamePk` as a nullable column in `sc_homestand_schedule` NOW, or defer until Phase 2? Adding it now is cheap (one ALTER, one field in the load path) and future-proofs the schema. Deferring costs a second migration later.

---

## Task 1 - The API, verified hands-on

Endpoint used: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026&teamId={id}&gameType=R`

Fetched 2026-07-10, cached to `/tmp/sc-13-api/team_{113,138,140}_R.json`. Teams:
- 113 = Cincinnati Reds (CIN account)
- 138 = St. Louis Cardinals (STL account)
- 140 = Texas Rangers (TXR - both H and V accounts)

Spring training pulled separately with `gameType=S`.

### 1.1 - Response shape

Top-level: `{ copyright, totalItems, totalGames, dates: [...] }`. Games are nested inside `dates[].games[]`. Per-game keys (30+ fields):

```
gamePk           gameGuid         link             gameType         season
gameDate         officialDate     status           teams            venue
content          isTie            gameNumber       publicFacing     doubleHeader
gamedayType      tiebreaker       calendarEventID  seasonDisplay    dayNight
description      scheduledInnings reverseHomeAwayStatus inningBreakLength
gamesInSeries    seriesGameNumber seriesDescription recordSource   ifNecessary
ifNecessaryDescription
```

Schedule/plan fields WE USE (Kevin's ruling):

| Field | Type | What it is | We use it for |
|---|---|---|---|
| `gamePk` | integer | Stable per-game identifier. Documented invariant across the API. | Stable-key column (see Task 2). |
| `gameGuid` | UUID | Secondary stable identifier. | Redundant; `gamePk` is the primary. |
| `officialDate` | `YYYY-MM-DD` | Current scheduled date. | `service_date` for the "as-currently-scheduled" plan. |
| `date` (bucket key) | `YYYY-MM-DD` | The date bucket the entry lives in. Diverges from `officialDate` for postponements. | The ORIGINAL date when combined with `status='Postponed'`. |
| `gameDate` | ISO 8601 UTC | Current scheduled start time. | Optional game_time on `sc_day_metadata` (venue-local via `venue.id` timezone). |
| `teams.home.team.id` / `teams.away.team.id` | integer | MLB team IDs (30 clubs). | Determines home vs away; opponent identity. |
| `teams.*.team.name` | string | Full club name. | Human display; NOT used as key (map via `team.id`). |
| `venue.id` / `venue.name` | integer / string | Ballpark. | Home-vs-neutral distinction for exhibitions. |
| `gameType` | `'R'` / `'S'` / `'E'` / `'P'` etc. | R=regular, S=spring training, E=exhibition, P=postseason. | Maps to `day_type`. |
| `dayNight` | `'day'` / `'night'` | Scheduled slot. | Optional metadata (currently already carried on `sc_day_metadata.game_type` for MiLB). |
| `doubleHeader` | `'N'` / `'S'` / `'Y'` | Doubleheader flag. `S`=split, `Y`=traditional. | Used ONLY to detect the shadow-entry pattern (see 1.4). |
| `description` | string | Free-text ("Makeup of 5/22 PPD", "Reds Home Opener"). | Used to detect makeup entries (skip). |
| `status.detailedState` | `'Postponed'` / `'Final'` / `'Scheduled'` / etc. | Current game status. | Used ONLY to detect Postponed shadow entries. WE DO NOT read `Final`/`In Progress` for their result meaning. |

Schedule/plan fields WE IGNORE (per Kevin):
- `status.abstractGameState`, `status.codedGameState`, `status.statusCode` (result-adjacent)
- `teams.home.score`, `teams.away.score`, `teams.*.isWinner`, `teams.*.leagueRecord` (results)
- Anything under `content` (media/results)

### 1.2 - Stable game identity

Confirmed: `gamePk` is unique per scheduled game and stable across the season. Even when a game moves (PPD → makeup), the makeup entry carries the ORIGINAL `gamePk`, not a new one. Example CIN:

- `gamePk=824514`: original 5/24, PPD, moved to 8/17 as split-DH game 1. Same `gamePk` in both the shadow entry (at 5/24) and the makeup entry (at 8/17).

Also confirmed: no rate limit surfaced under bulk-fetch (3 teams x ~230KB each in under 1 second, no throttling headers observed). MLB has not published a hard rate limit for the schedule endpoint. Standard practice from the ecosystem (see `github.com/toddrob99/MLB-StatsAPI`) is polite polling (single-digit req/sec). Auth: NONE required for the schedule endpoint. Response shape: stable for many years; documented by ecosystem tooling even without official MLB docs.

### 1.3 - Home vs away, clean

For each returned game, `teams.home.team.id` and `teams.away.team.id` are populated. Determining home/away for a given team is a single boolean compare:

```python
is_home = game['teams']['home']['team']['id'] == team_id
```

This is the whole point vs the PDFs (which showed away as bare cells with no reliable identity). The API resolves the identity we needed.

### 1.4 - Postponements: the "shadow entry" pattern

The API preserves postponement history via TWO entries per PPD'd game:

- **Shadow entry** at the ORIGINAL date bucket, with `status.detailedState='Postponed'`. Its `officialDate` field points to the NEW date (post-move).
- **Makeup entry** at the NEW date bucket, with `status.detailedState='Final'`/`'Scheduled'`, `doubleHeader='S'` (Split DH), and `description` starting with `"Makeup of ..."`.

Both entries carry the SAME `gamePk`.

For our purpose (planned schedule), the derivation rule is:

1. For each `gamePk`, if a shadow entry (status=Postponed) exists, use ITS date bucket key as the game's planned `service_date`.
2. Else use the sole entry's `officialDate`.
3. Never insert makeup entries as separate games (they double-count).

I applied this rule to all three teams' data:

| Team | Raw entries | Unique gamePks | Plan-of-record games (post-dedupe) | Home | Away |
|---|---:|---:|---:|---:|---:|
| CIN (id=113) | 164 | 162 | 162 | 81 | 81 |
| STL (id=138) | 166 | 162 | 162 | 81 | 81 |
| TXR (id=140) | 162 | 162 | 162 | 81 | 81 |

Every team resolves to 162 = 81 + 81 exactly, matching the MLB regular-season invariant.

CIN and STL both share the same postponement history via cross-team dupes (a Cardinals-Reds series had PPDs; both teams' schedules show the same `gamePk`s). TXR had zero postponements at time of fetch.

### 1.5 - Cross-check: API home schedule vs current DB

Compared API's planned home slate (per team) against the current `sc_homestand_schedule` GAME rows (per account) from `/tmp/sc-audit/hs_dump.csv` (dated pre-sc-12; sc-12 applied to prod on merge).

| Account | DB GAME rows | API home dates | Symmetric diff (dates) | Opponent mismatches |
|---|---:|---:|---:|---:|
| CIN - OH | 81 | 81 | 2 (API adds 6/22, DB has 6/25) | Same 2 (6/22 MIL, 6/25 MIL) |
| STL - MO | 81 | 81 | **0** | **0** |
| TXR - TX - H | 81 | 81 | **0** | **0** |

The single CIN diff is exactly the sc-12 R3 correction that just landed in prod: the API-and-PDF-published planned schedule has MIL on 6/22 (game start of series), our pre-sc-12 seed had MIL on 6/25 (wrong end of series). sc-12 fixed the DB to match. **Post-sc-12 DB and the API should now agree row-for-row on CIN too.**

Opponent-code normalization required (per R6 from sc-12):
- API returns full team NAME (`"Milwaukee Brewers"`) and MLB `team.id`. DB uses codes (`MIL`).
- Team-id-to-code lookup fits in a static 30-row map. Codes match DB canonical for ARI (not AZ), ATH (not OAK), and all others verified against `hs_dump.csv`'s opponent distribution.

### 1.6 - Exhibitions

Fetched separately with `gameType=S` (spring training). TXR: 30 spring-training games total. Venue distribution:

| Venue | Count |
|---|---:|
| Surprise Stadium (TXR's AZ spring complex) | 15 |
| Various visitor complexes | 13 |
| **Globe Life Field (TXR's regular-season home ballpark)** | **2** |

The 2 games at Globe Life Field: `2026-03-23` and `2026-03-24`, both `Kansas City Royals` as visitor, both `gameType='S'`, both with `description='at Globe Life Field'`.

**These are exactly the 2 EXHIBITION rows sc-12 hand-seeded.** If sc-13 goes live-sync, the EXHIBITION classification is derivable from a rule: `gameType='S' AND venue.id = team's regular-home venue.id → EXHIBITION`. No more hand-seeding.

### 1.7 - Fragility / risk assessment

- **Endpoint stability:** MLB Stats API has been stable for 5+ years. Well-known field names. Broad ecosystem depends on it (mlb.com's own website, MLB app, third-party sabermetrics tools).
- **Auth:** None required for the schedule endpoint. If MLB ever adds it, we get a 401 and cron logs surface the issue.
- **Rate limit:** No published limit. Ecosystem convention is single-digit req/sec. For our use (~3 teams x 1 fetch per day/week), this is ~0.001 req/sec average.
- **Response schema drift:** MLB adds fields over time (recent additions: `calendarEventID`, `reverseHomeAwayStatus`). Additive changes are safe. Field REMOVAL would be the risk - none observed historically for the schedule/plan subset.
- **Playoff/postseason coverage:** `gameType='P'` returns postseason. Not needed for our current scope but the API carries it if we ever want to.

---

## Task 2 - API → sc_homestand_schedule mapping

### 2.1 - Field-by-field mapping (Option 1 schema from the schema review)

Given the recommended `ALTER TABLE`s from the schema review (add `'AWAY'` to CHECK, drop NOT NULL on `homestand_id`), the field mapping is:

| DB column | API source | Notes |
|---|---|---|
| `account_key` | (constant per fetch) | Load script iterates the 4 accounts; account_key is fixed for each. |
| `service_date` | shadow-preferred `date` bucket key, else `officialDate` | See 1.4. |
| `day_of_week` | Derived from `service_date` | JS/Python one-liner. |
| `day_type` | Derived: `gameType='R'` + is_home → `'GAME'`; `'R'` + !is_home → `'AWAY'`; `'S'` + at home venue → `'EXHIBITION'`. | The classifier rule. |
| `opponent` | `teams.{away if is_home else home}.team.id` → static team-id-to-code map | Applies R6 opponent normalization at load time. |
| `homestand_id` | NOT sourced from API | Kept nullable per Option 1. Home game rows carry the existing HS-prefixed IDs from the current seed process; away rows carry NULL. If Kevin wants automatic homestand grouping later, derive by clustering consecutive home dates (out of sc-13 scope). |
| `gamePk` (NEW, nullable) | `gamePk` | Recommended new column. See 2.2. |
| `created_at` | `now()` | Default. |

### 2.2 - The stable-key question (the important one)

**Should `sc_daily_projections` and `sc_daily_actuals` key on `gamePk` instead of (account_key, service_date)?**

Short answer: **No, don't refactor the existing tables. Add `gamePk` as a nullable column to `sc_homestand_schedule` instead. Human data stays date-keyed; game identity travels alongside.**

Reasoning:

1. **Meal counts are attached to a KITCHEN service day, not a baseball game.** When Kevin records "we served 180 meals on 5/22," the record is about the kitchen's Friday shift. If MLB later moves the game to 5/23, the 5/22 shift's meal count still describes what actually happened on 5/22. It should NOT auto-migrate to follow the game.
2. **Kevin's ops-domain ruling covers this exactly.** From sc-12: "Rainouts, postponements (PPD), and doubleheaders. These are weather exceptions Kevin manages in ops, OFF the service calendar." Live-sync must respect this - a PPD announcement should NOT reshuffle historical meal records without Kevin's say-so.
3. **Refactoring `sc_daily_projections` to key on `gamePk` breaks the current PREP/OPEN/CLOSE model.** Non-game days have no `gamePk`. The table would need a nullable game reference plus a fallback (`gamePk_or_null OR (account, date)`) which is a multi-column-must-agree anti-pattern (matching sc-1's stated aversion to "two columns that must agree").
4. **What we DO need `gamePk` for:** dedupe on subsequent syncs (an idempotent load key), matching a specific game's history across schedule changes, and giving human ops a stable identifier when Kevin wants to write a note like "moved 5/22 → 8/17."

**Recommendation:** in sc-13b, add `gamePk BIGINT` to `sc_homestand_schedule` (nullable so the pre-load rows and any human-entered rows without a MLB game reference remain valid). Add `UNIQUE (account_key, gamePk) WHERE gamePk IS NOT NULL` as a partial unique so a live sync can idempotent-upsert on `gamePk`. This adds ~3 lines to the migration.

If a future need arises for game-keyed service data (unlikely per point 1 above), we can add a nullable `gamePk` FK on `sc_daily_projections` at that time. Not now.

### 2.3 - Field-ownership split

Concrete columns split cleanly by owner:

**Sync owns (schedule facts):**
- `sc_homestand_schedule`:
  - `day_type` (GAME/AWAY/EXHIBITION - the classifier's output)
  - `opponent` (opponent code)
  - `gamePk` (proposed new column)
  - Optional: `game_time_utc` if we add it (currently NOT stored on this table; would be a new column or would go to `sc_day_metadata.game_time`)
- `sc_day_metadata.game_time` (if we wire the sync there)
- `sc_day_metadata.game_type` (day/night from `dayNight`, if we wire it)

**Human owns (all non-schedule data):**
- `sc_homestand_schedule`:
  - `day_type` for the non-GAME/non-AWAY/non-EXHIBITION values (PREP, OPEN, CLOSE, CLEAN)
  - `homestand_id`
- All of `sc_daily_projections` (meal counts)
- All of `sc_daily_actuals`
- All of `sc_day_note_entries`
- `sc_day_metadata` fields not listed above (period, week_label, event_label, notes)

**The two ownership sets don't overlap on any column.** Sync writes only to a well-bounded subset; human data is untouched by a sync run. This is the failure-isolation guarantee we need (Task 3.4).

---

## Task 3 - Effort + risk for the LIVE-SYNC path

### 3.1 - Where the sync job runs on THIS stack

Vercel cron via `vercel.json`. Already used in the codebase (existing crons: `/api/cron/daily`, `/api/cron/incident-reminders`, `/api/cron/backup-sheets`). Adding a new cron:

```json
{
  "path": "/api/cron/sync-mlb-schedule",
  "schedule": "0 9 * * *"  // 9am UTC / 4am ET / 3am CT daily
}
```

Route handler at `src/app/api/cron/sync-mlb-schedule/route.js` that:
1. Fetches API for each home-team account.
2. Applies the shadow-preferred derivation (1.4).
3. Reads current `sc_homestand_schedule` rows for the same range.
4. Computes {adds, updates, removes} diff.
5. Applies adds and idempotent updates automatically; queues non-additive diffs for human review.
6. Logs summary + any queued items.

**Not recommended:** Supabase pg_cron. Two reasons - (a) the codebase's ops posture is "Vercel is the front door; Supabase is the durable store," so putting business logic in Supabase functions breaks the mental model, (b) fetching an external HTTP endpoint from a PG function is more setup than value.

**Cadence recommendation:** daily is over-frequent for a schedule that changes at most weekly. Weekly would be enough. Daily is fine if we want early rainout awareness. Bias toward once per day at 4am ET so the fresh schedule is in place before the ops team's morning routine.

### 3.2 - Reschedule migration logic

Kevin's ops-domain rule dictates: **the sync NEVER auto-migrates human-owned data (projections/actuals/notes) when a game moves.** So the "reschedule migration" is really "schedule-facts diff + human notification."

Sketch:

1. For each `gamePk` in the API snapshot:
   - Look up existing DB row by `(account_key, gamePk)` if `gamePk` column is populated, else by `(account_key, service_date)` for legacy rows.
   - If no DB row exists: **INSERT** the schedule fact. Emit event `SCHEDULE_ADDED`.
   - If DB row exists and matches: **NO-OP**. Idempotent.
   - If DB row exists and `service_date` differs: this is a move. Emit event `SCHEDULE_MOVED` with `{gamePk, from_date, to_date}`. Update the row's `service_date` to the new date. Emit a **separate notification** if any of `sc_daily_projections`, `sc_daily_actuals`, `sc_day_note_entries` reference the old date - "Note: 3 projection rows exist on old-date; not auto-migrated."
   - If DB row exists and `opponent` differs: **UPDATE** the fact. Emit event `SCHEDULE_OPPONENT_CHANGED` (rare; would suggest MLB corrected a data-entry error or a re-scheduled series reshuffled).
2. For each DB row not present in the API snapshot (removed games): emit event `SCHEDULE_REMOVED`. Do NOT auto-delete without human review.

### 3.3 - Conflict UX (human edit + sync disagrees)

The current DB has `day_type='PREP'` (human ops decision) at date X. Next sync sees the API classifies X as a `GAME`. Conflict.

Options for handling:
- **Silent overwrite:** sync wins, human ops loses. Bad - undermines Kevin's "PDF-as-truth" trust model since Kevin might have manually corrected something the API doesn't know about.
- **Silent skip:** human wins, but the drift never surfaces. Bad - a real MLB schedule change never lands.
- **Review queue (recommended):** conflict emits a row into a `sc_sync_review_queue` table with `{account, date, current_value, api_value, detected_at, resolved_by, resolved_at, resolution}`. Admin console surfaces unresolved entries. Kevin decides per case. Sync run continues without stomping.

The review queue is ~50 lines of table + admin UI. Non-trivial but well-scoped.

### 3.4 - Failure isolation

Confirmed by the ownership split (2.3): the sync writes only to `sc_homestand_schedule` and optionally `sc_day_metadata.game_time`/`game_type`. The calendar's read path (`sc_daily_revenue` view + `loadHomestandContext`) is untouched by sync-quality issues.

**API outage effect:** the daily cron fails → cron logs the failure → the calendar reads yesterday's `sc_homestand_schedule` snapshot unchanged → operators see no visible degradation. Fine.

**Partial-response effect:** the API returns a truncated snapshot (only 100 games instead of 162) → the diff logic thinks 62 games were removed → the review queue floods. Mitigation: sync run validates `totalGames >= 160` per team before applying any diffs; skip with alert if the count is suspect.

**MLB adds a new field / removes a field:** the sync's field extraction is defensive (`g.get('officialDate')`, etc.). A missing field on ONE entry logs + skips that entry; doesn't break the whole run.

Nothing in the current read path blocks this failure-isolation model. **Sync can be added as a purely additive concern.**

### 3.5 - Effort estimate

**Phase 1 - load-once + `gamePk` column** (RECOMMENDED FIRST):

- `docs/migrations/sc-13-away-schedule-load.sql`:
  - ALTER `day_type` CHECK to add `'AWAY'`
  - ALTER `homestand_id` DROP NOT NULL
  - ADD COLUMN `gamePk BIGINT` (nullable)
  - CREATE UNIQUE INDEX partial `(account_key, gamePk) WHERE gamePk IS NOT NULL`
  - INSERT ~324 AWAY rows + backfill `gamePk` on existing HOME rows from a JSON extraction script
  - COMMENT ON TABLE
- Extraction script (~150 lines): fetch API, apply shadow-preferred derivation, team-id-to-code normalization, output SQL INSERTs.
- Reader deltas following PR #386's EXHIBITION pattern (~50 lines across classifier, atom, aggregates, legend).
- **Estimate: 4-8 focused hours.** Fast because the shape of the change is already proven by sc-12 + PR #386.

**Phase 2 - live-sync + review queue**:

- Vercel cron route + fetch + derivation logic (~150 lines).
- Diff-and-classify logic (~100 lines).
- `sc_sync_review_queue` table + migration (~20 lines).
- Admin console page to review + resolve queue entries (~200 lines).
- Failure-isolation tests + observability (~100 lines).
- **Estimate: 16-30 focused hours.** Larger because the review queue's UX is new-surface work, not a copy of an existing pattern.
- **Riskiest surface: the review queue's resolution UI.** Getting it wrong means Kevin loses trust in the sync ("it keeps asking me things"). Getting it right means the calendar becomes actively self-healing.

### 3.6 - What live-sync buys vs load-once (honest breakdown)

| Scenario | Load-once | Live-sync |
|---|---|---|
| 2026 schedule is loaded correctly today | Yes | Yes |
| MLB adds a doubleheader (post-PPD) mid-season | Kevin manually adjusts | Sync catches it, queues for review |
| MLB changes a game's start time (TV move) | Not tracked | `game_time` auto-updates |
| MLB adds a tiebreaker/163rd game (rare) | Kevin manually adds row | Sync catches it |
| Kevin discovers a seed error mid-season | Kevin fixes in Studio | Same, plus review queue confirms sync agrees |
| MLB updates the following year's schedule | Kevin manually re-runs load-once | Sync automatically starts including 2027 |
| Historical seasons (2024, 2025) needed | Kevin runs load-once per year | Same - live sync only helps for FUTURE |

The live-sync's ops value is real but **incremental, not transformational.** For 2026 specifically, load-once + a manual re-pull mid-season (if PPDs stack up) covers ~95% of the value.

---

## Task 4 - Recommendation

**Ship load-once first (Phase 1). Do NOT build live-sync yet. Add `gamePk` as a nullable column in Phase 1 so Phase 2 has the seat waiting.**

### Reasoning

1. **The load-once path already delivers the architectural goal.** "All schedule data in Postgres" is achieved the moment sc-13b ships. Live-sync is a Phase 2 concern, not a blocker.

2. **The 2026 season is 40% complete already** (regular season started 3/26, we're at 7/10 = ~106 days into a ~183-day season). Live-sync's compounding value is highest at the START of a season, when reschedule volume is highest. We're past that peak. Waiting for 2027's Nov/Dec schedule release to ship live-sync captures the value cleanly.

3. **The API validated the sc-12 seed independently.** STL/TXR: zero diffs. CIN: the one diff is the exact sc-12 R3 correction. This means we can trust the LOAD-ONCE data as high-confidence today. We don't need the live-sync insurance to feel safe about the initial load.

4. **Phase 2's cost is 3-5x Phase 1's cost.** The review queue UX is the most expensive piece and the one Kevin cares most about getting right (it interfaces directly with his ops trust). Rushing it to ship alongside Phase 1 forces UX decisions before we know how many conflicts a real season generates.

5. **Adding `gamePk` NOW costs almost nothing** (one column + one partial unique index + one field in the load script). Deferring it costs a full second migration and a backfill later. This is the "cheap now, expensive later" case.

### Staged plan

**Phase 1 (this quarter):** sc-13a extraction + sc-13b migration + PR. Load 2026 away games. Add `gamePk` column. Ship. Watch for one season.

**Phase 2 (next off-season, Nov 2026 - Feb 2027):** build the live-sync cron + review queue. Test against 2027's newly-released schedule. Watch the review queue in flight for a month. Cut over when Kevin trusts it.

**Phase 3 (if needed):** deeper integrations - homestand-id auto-derivation from consecutive home dates, road-trip clustering into `road_trip_id`, integration with a hypothetical Ops Dashboard for PPD alerts. All optional. All easier once Phase 2 has proven the read/write cycle.

### If Kevin prefers to build both phases together

The sequencing shifts but the recommendations don't:

- Add `gamePk` in Phase 1 regardless (cheap now, insurance for later).
- Build the review queue as its own PR IN BETWEEN Phase 1 and Phase 2 - don't collapse it into either. It's the highest-UX-risk surface and deserves its own review cycle.
- Live-sync ships against a fully-loaded DB, so the first sync's diff should be empty (or nearly so). That's the acceptance test.

### Explicitly NOT recommended

- Refactoring `sc_daily_projections` to key on `gamePk`. See Task 2.2.
- Ingesting scores/results/live-status. Kevin's ruling stands.
- Auto-migrating human-owned data when a game moves. Would break the ops-domain trust boundary.
- Silent auto-resolve on schedule conflicts. Review queue or nothing.

---

## Data appendix

Reproduce the cross-check numbers with:

```
mkdir -p /tmp/sc-13-api && cd /tmp/sc-13-api
for team in 113 138 140; do
  curl -s "https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026&teamId=$team&gameType=R" -o "team_${team}_R.json"
done
```

Then the derivation + diff scripts in `/tmp/sc-13-api/` (see the Task 1 code blocks above). Output verified 2026-07-10; regenerate any time - the API is stable.
