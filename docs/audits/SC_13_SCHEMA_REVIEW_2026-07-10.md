# sc-13 prep - Postgres schema review for the COMPLETE schedule

**Generated:** 2026-07-10
**Scope:** READ-ONLY audit + schema options analysis. No code, no SQL that runs. This document is the input Kevin + Chat use to decide sc-13's shape.
**Prior context:** sc-12 (PR #385, merged 2026-07-10) reconciled the DB seed to the 4 official MLB promo PDFs under the PDF-as-truth trust model and seeded the first-ever non-GAME/non-support day_type (`EXHIBITION`). The complete season (home + away) is still not represented in Postgres.

---

## TL;DR

1. **Away games do NOT exist in the audit ledgers.** All 4 `/tmp/sc-audit/*_2026_home.md` files are HOME-only (81 rows each, plus 2 EXH rows for TXR). The brief's premise that away games were catalogued during sc-12 is incorrect. The audit doc explicitly acknowledges "PDF promos are HOME-team truth, not road-slate truth."
2. **Recommendation: Option 1 (extend `sc_homestand_schedule` in place)** with three additive alterations - `AWAY` added to the `day_type` CHECK, `homestand_id` relaxed to nullable, and an optional `road_trip_id` column (nullable). Reader changes are small and follow the EXHIBITION pattern PR #386 already established.
3. **The table name (`sc_homestand_schedule`) becomes a misnomer** post-AWAY. Renaming is defensible but expensive (10+ reader sites). Recommend deferring the rename to a future dedicated PR; add a `COMMENT ON TABLE` capturing the semantic drift so the naming lie is at least documented.
4. **sc-13 has two workstreams**, and they should NOT collapse into one PR:
   - **sc-13a (data-acquisition)**: source, extract, normalize away schedules. Recommended source: MLB Stats API (`statsapi.mlb.com`) - free, scriptable, opponent codes match DB canonical after R6 normalization.
   - **sc-13b (schema + load + reader deltas)**: the migration file + reader updates. Runnable only after sc-13a produces a clean per-account CSV/JSON of the away slate.
5. **Blocking question for Kevin:** the sc-12 brief retired external played-results sources (BR/ESPN/MLB.com) for HOME reconciliation. Does the same restriction apply to *planned schedule* extraction for AWAY? MLB Stats API returns planned dates, not results - technically not a played-results source, but a fresh Kevin ruling is warranted before sc-13a spends effort.

---

## Task A - Schema survey of the current calendar data model

### A.1 - `sc_homestand_schedule` complete DDL (post-sc-12)

From `docs/migrations/sc-2-homestand-schedule.sql` (base) + `docs/migrations/sc-12-mlb-schedule-reconciliation.sql` (day_type CHECK widening):

```sql
CREATE TABLE sc_homestand_schedule (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_key  TEXT NOT NULL,
  service_date DATE NOT NULL,
  day_of_week  TEXT NOT NULL,
  day_type     TEXT NOT NULL
               CHECK (day_type IN ('GAME','PREP','OPEN','CLOSE','CLEAN','EXHIBITION')),
  opponent     TEXT,
  homestand_id TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_key, service_date)
);

CREATE INDEX idx_sc_homestand_account_date
  ON sc_homestand_schedule (account_key, service_date);

ALTER TABLE sc_homestand_schedule DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_homestand_schedule TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE
  ON sc_homestand_schedule TO anon, authenticated;
```

Constraints that matter for the sc-13 decision:
- **UNIQUE (account_key, service_date)**: one row per (account, date). Fits home OR away for a given date (a team is never both simultaneously). Preserved by any option below.
- **`homestand_id` is NOT NULL**: a hard block for AWAY rows under Option 1 without a schema alter (away has no homestand). Must be relaxed to nullable in sc-13.
- **`opponent` is nullable**: PREP/OPEN/CLOSE carry NULL; GAME/EXHIBITION carry codes. AWAY rows would carry codes.
- **No FKs**: `account_key` is not FK-enforced against `accounts.team_key` - a soft coupling. Any typo in the load ("TX" vs "TXR - TX - H") lands silently. Worth an FK add during sc-13 (out-of-scope but flag).
- **No CHECK on `opponent`**: R6 (opponent-code normalization) is enforced at load time, not by the DB. Fine if the load script is disciplined; brittle if not.

### A.2 - Every table the Service Calendar reads from

Traced via `grep -n ".from(\"sc_" src/lib/dataStore/serviceCalendar.js`:

| Table / View | Role | How SC uses it |
|---|---|---|
| `accounts` | Base account list (not sc-namespaced) | Reads `billing_model` per team. Gate for the homestand-driven classifier branch. |
| `sc_service_groups` | Service organizational containers | Referenced via `sc_daily_revenue` view. |
| `sc_services` | Individual billable items | Referenced via view; direct read in edit UI. |
| `sc_service_prices` | Price ledger with effective dates | Joined in `sc_daily_revenue` via LATERAL. |
| `sc_daily_projections` | Corporate forecasts (per service per day) | Read via `sc_daily_revenue` view; source of projected meals. |
| `sc_daily_actuals` | System of record for billing | Read via view; source of actual meals + hasActuals. |
| `sc_day_metadata` | Per-day context (period, week, game_type, game_time) | Joined in view; period ranges query drives Period lens. |
| `sc_day_note_entries` | Append-only note ledger (SC-079) | Batched by date range in month load. |
| `sc_daily_actuals_history` | Audit trail for corrections | Feeds Activity ledger EDIT rows. |
| `sc_homestand_schedule` | **This audit's subject.** Per-day home shape (game / prep / open / close / clean / exh) + opponent + homestand_id. | Only loaded for `billing_model = flat_fee` accounts. Used to classify GAME days (entered/future), suppress off-day urgency, and drive rollups. |
| `sc_daily_revenue` | **VIEW.** Core billing join. | Primary read source for month/year loads. |
| `sc_month_summary` | **VIEW.** Monthly aggregate over sc_daily_revenue. | Year-heatmap month rows. |
| `sc_phase_calendar` | PDC phase date ranges (sc-11) | BY-PHASE export block. Not touched by the calendar UI today. |
| `sc_changelog_latest_by_account` | Config changelog | Admin console. |

**Key observation for sc-13:** `sc_daily_revenue` (the view most of SC reads) unions rows from `sc_daily_projections` and `sc_daily_actuals`. Away days have NEITHER projections nor actuals (correct - no service, no billing). So AWAY rows added to `sc_homestand_schedule` would NOT accidentally leak into `sc_daily_revenue`. This is a happy accident that makes Option 1 tractable: adding AWAY rows to `sc_homestand_schedule` is invisible to every reader except the homestand-context loader (`loadHomestandContext`) and its downstream consumers, which are exactly the surfaces this doc is about.

### A.3 - Row counts per account per day_type (post-sc-12)

From the hs_dump.csv snapshot + sc-12 migration effects (probes D + B from `sc-12-mlb-schedule-reconciliation.sql`):

| account_key   | GAME | PREP | OPEN | CLOSE | EXHIBITION | Total |
|---------------|-----:|-----:|-----:|------:|-----------:|------:|
| CIN - OH      | 81   | 20   | 2    | 2     | -          | 105   |
| STL - MO      | 81   | 16   | 2    | 2     | -          | 101   |
| TXR - TX - H  | 81   | 17   | 1    | 2     | 2          | 103   |
| TXR - TX - V  | 81   | 17   | 1    | 2     | 2          | 103   |

The 81 GAME invariant is intact across all four accounts (an MLB team plays exactly 81 home games in a 162-game regular season). TXR H/V mirror perfectly per Q-d (symmetric-diff = 0 confirmed in sc-12 probes).

If AWAY loads at the standard 81 per team: each account grows to ~180-185 rows. Full calendar year is 365 days; remaining ~180 dates are true off-days (All-Star break, other MLB off-days, exhibition season pre-March-23 for non-TXR accounts).

### A.4 - How `homestand_id` is used

Load-bearing in three surfaces (verified in the code paths PR #386 patched):

1. **`serviceCalendar.js:1084`** - `homestandSummaryByMonth` aggregate: `homestandIds` Set → month card "N homestand(s)" footer. PR #386 added an `if (d.dayType === "EXHIBITION") continue;` skip before this.
2. **`homestandDerivation.js:51`** - `deriveHomestandSegments` (SeasonStepper input): buckets days by `homestandId`. PR #386 added the same EXH skip.
3. **`PeriodCard.js:196` + `:337`** - homestand count Set + `deriveHomestandSubtitle` ("HS8 vs ARI"). PR #386 filtered EXH here too.

**Implication for AWAY:** if we load AWAY rows with `homestand_id` = NULL (Option 1), every current consumer either already gates on `d.homestandId` truthiness (`if (!d.homestandId) continue;`) or on `d.dayType === "GAME"`. A quick audit of the three sites confirms: NULL homestand_id would be naturally filtered by the `!d.homestandId` guards, and dayType=AWAY would fall through the same `d.dayType === "GAME"` filters that already exclude PREP/OPEN/CLOSE from GAME-only rollups. Small deltas needed (mostly for the classifier + atom render), matching the EXH pattern.

If instead we want to GROUP road trips like we group homestands, we'd want a distinct `road_trip_id` column (RT1, RT2, ...) so a future "current road trip" widget or "N road trips" footer has a stable key.

### A.5 - What PREP/OPEN/CLOSE mean relative to games

From `sc-2-homestand-schedule.sql` seed comments + code usage:

- **PREP**: home-adjacent workflow day right before a homestand starts. Always at the home ballpark.
- **OPEN**: first day the ballpark opens for a homestand.
- **CLOSE**: last day the ballpark is open during/after a homestand.
- **CLEAN**: post-homestand cleanup.

These are all **home-ballpark, home-workflow** concepts. They only appear on dates when the team is at home (physically or immediately adjacent). A team on the road does not have PREP/OPEN/CLOSE - those are structurally home-only shapes.

**Implication for sc-13:** AWAY rows would be **structurally exclusive** with PREP/OPEN/CLOSE for a given date. A date is either:
- HOME game (GAME) - with surrounding PREP/OPEN/CLOSE optional
- AWAY game (AWAY) - no PREP/OPEN/CLOSE possible
- HOME exhibition (EXHIBITION) - see sc-12 semantics
- Nothing (row absent) - true off-day

The existing UNIQUE (account_key, service_date) enforces this exclusivity at the DB layer. Good.

---

## Task B - Away data quality audit

### B.1 - Coverage in the /tmp/sc-audit ledgers

Empirical row counts (`grep -c "^| 2026" /tmp/sc-audit/*_2026_home.md`):

| Ledger file | Table rows |
|---|---:|
| `CIN-OH_2026_home.md` | 81 |
| `STL-MO_2026_home.md` | 81 |
| `TXR-TX-H_2026_home.md` | 83 (81 GAME + 2 EXH) |
| `TXR-TX-V_2026_home.md` | 83 (81 GAME + 2 EXH) |

**Every row in every ledger is a HOME game.** Filenames end in `_home.md`. Content headers read "planned HOME games". Zero away rows exist in any ledger.

The audit's meta-report (`SC_MLB_SCHEDULE_AUDIT_2026.md`) is explicit about this on lines 232-236:

> Per the trust model, the CIN and STL PDFs are HOME-team promos - they authoritatively assert HOME facts, not the road slate. This section would list any DB rows that reflect an AWAY-game state (typically off-day / PREP / null) at odds with what the PDF might imply.
>
> After the full diff and R1-R7 application: **no away-drift to flag.** Every DB non-GAME date on a home-team calendar (PREP, OPEN, CLOSE) is consistent with the PDF's blank/off/travel cells for those dates.

And on line 272 (Section 8 - lessons learned):

> **PDF promos are HOME-team truth, not road-slate truth.** They authoritatively assert HOME facts. Away-schedule drift needs Kevin's eye - the SC can't auto-adjudicate it from a HOME promo.

The brief's premise ("Away games were catalogued in markdown ledgers") is **not correct**. The audit deliberately did NOT catalog away data because the source (HOME promos) could not authoritatively assert road facts. Two ledger ERRATA notes confirm this by exception (they mention specific date-cells the extractor initially misread as HOME, later re-classified as AWAY, then **dropped from the ledger entirely**):

- STL-MO ERRATA line 104: "8/01 TOR ... AWAY game. DB correctly lacks any 8/01 home row."
- TXR-TX-H ERRATA line 125: "2026-08-16 ATH ... R4 confirms 8/16 vs ATH is a planned AWAY game. Dropped from the ledger. DB correctly lacks it."

These are the closest thing to "away rows in the ledgers" - and both were removed, not added.

### B.2 - Home + away vs 162

MLB regular season = 162 games per team = 81 home + 81 away. Home is complete (81 in DB per account). Away = 0 in DB and 0 in ledgers. Gap = 81 rows per account = **~324 total away rows** needed (81 x 4 accounts, TXR H/V both need it per Q-d).

### B.3 - Opponent-code normalization

R6 from sc-12 (`SC_MLB_SCHEDULE_AUDIT_2026.md` line 191):

> **`opponent` is TEXT with no CHECK**: DB uses `ARI` (not `AZ`), `ATH` (not `OAK`). Ledger opponent codes were normalized to DB canonical per R6.

Whatever source we use for away data must apply the same normalization. Canonical mapping (extend as needed):

| Common code | DB canonical | Notes |
|---|---|---|
| AZ | ARI | Diamondbacks |
| OAK | ATH | Athletics (Sacramento relocation) |
| WAS | WSH | Nationals (some sources) |
| SFG | SF | Giants (some sources) |
| SDP | SD | Padres (some sources) |
| KCR | KC | Royals (some sources) |
| TBR | TB | Rays (some sources; note TBR is also KitchFix account_key for Tampa PDC) |

MLB Stats API uses 3-letter team codes that match DB canonical for AZ→ARI and OAK→ATH in the current season (both use the current team abbreviation). Should be low-friction.

### B.4 - Verdict on ledger-as-source

**The ledgers cannot be used to load AWAY data.** The signal simply is not there. sc-13 requires a fresh extraction from a source that authoritatively represents the road slate.

Recommended source: **MLB Stats API** (`https://statsapi.mlb.com/api/v1/schedule`). Endpoints exist for full-season per-team schedules. Free, no auth, JSON-native. Emits:
- `gameDate` (ISO)
- `teams.away.team.id` + `teams.home.team.id`
- Home/away distinction is unambiguous (which team is home flips per game)
- Opponent code accessible via team `abbreviation` field

An extraction script (`scripts/_fetch_mlb_away_schedule.mjs` - name for illustration only, not built here) would:
1. For each home-team account (CIN, STL, TXR), resolve the MLB team_id.
2. Fetch full 2026 regular-season schedule.
3. Filter to games where the home-team-account is the AWAY team.
4. Apply R6 opponent-code normalization.
5. Emit a per-account CSV consumed by sc-13b.

Alternate source (fallback if MLB API is deemed off-limits): individual team schedule pages on `mlb.com/{team}/schedule/2026` are HTML-scrapable. Higher friction than the API. Only if the API is ruled out.

**Blocking question for Kevin:** the sc-12 trust model retired BR/ESPN/MLB.com *played results* as sources of truth for the SC. Does this restriction extend to *planned schedule* extraction for the away slate? MLB Stats API returns the same league-published planned schedule the promo PDFs draw from - it is not a played-results source - but a Kevin ruling before sc-13a is warranted so we don't spend a load cycle only to have the data rejected.

---

## Task C - Schema options analysis

Four realistic models evaluated. Each row estimates migration cost (SQL + reader-code touch), blast radius (how many readers change), and how cleanly the current classifier absorbs it. **Recommendation follows.**

### Option 1 - Extend in place

- **SQL:** `ALTER TABLE sc_homestand_schedule` (a) drop day_type CHECK, re-add with `'AWAY'`; (b) `ALTER COLUMN homestand_id DROP NOT NULL`; (c) optionally add `road_trip_id TEXT` nullable for future road-trip grouping.
- **Data load:** INSERT ~324 AWAY rows across the four accounts (81 per, TXR H+V mirror per Q-d).
- **Reader deltas** (mirroring the EXHIBITION pattern PR #386 shipped):
  - `classifyDayStatus` → new `AWAY` branch returning `"away"` atom status.
  - `resolveDayStatus` → map `"away"` through.
  - `DaySquare` → new `--away` state: muted date + hollow `@ {opp}` + plane glyph + "no service" line. Non-interactive. (Original brief already designed this for a hypothetical Task 2 of the sc-cell-states PR.)
  - Aggregate loops that already skip `EXHIBITION` need to also skip `AWAY` (5-10 lines across `serviceCalendar.js`, `homestandDerivation.js`, `PeriodCard.js`, `ServiceCalendar.js aggregateWorkspaceMetrics`).
  - Legend row added under HOMESTAND, same shape as PR #386.
- **Blast radius:** small. Almost byte-identical to the sc-12 + PR #386 rollout. The consuming surfaces were literally just refactored to gate on dayType, so extending the gate list is a one-word change per site.
- **Table-name honesty:** the table is called `sc_homestand_schedule` but now stores AWAY rows too - a lie of naming. Mitigation: add `COMMENT ON TABLE` documenting the drift. Full rename deferred.
- **UNIQUE constraint:** holds unchanged (a date is home OR away, never both).
- **Query performance:** unchanged. Existing `idx_sc_homestand_account_date` covers the range scans the loaders use.

**Pros:** cheapest, smallest blast, immediately compatible with sc-12 + PR #386 patterns, invisible to `sc_daily_revenue` view (no projections/actuals ripple).
**Cons:** table name lies, `homestand_id` NULLABLE feels like a smell (though it's honest - away rows genuinely have no homestand).

### Option 2 - Rename/reframe the table

- **SQL:** rename `sc_homestand_schedule` → `sc_schedule` (or `sc_service_schedule`). Add a `venue` column (`'HOME' | 'AWAY'` CHECK). Keep `day_type` but rescope semantics: it now captures "shape of a home service day" (GAME/PREP/OPEN/CLOSE/CLEAN/EXHIBITION) OR is NULL for AWAY. Add `road_trip_id` alongside `homestand_id` (both nullable, exactly one populated).
- **Reader deltas:** every read site changes. `sc_homestand_schedule` appears in:
  - `src/lib/dataStore/serviceCalendar.js` (2 sites)
  - `src/lib/export/scWorkbook.js` (~10 sites)
  - `src/app/api/ops/route.js` (labor-bootstrap)
  - `src/app/ops/components/labor/SeasonPlanner.js`
  - `src/app/ops/components/labor/PeriodSnapshot.js`
  - `scripts/_seed_sc_homestand_schedule.mjs` (the Sheets → PG seeder; still active)
  - Docs referencing the table name.
- **Blast radius:** large. Every reader needs a coordinated update. Risk of a stale reader lingering somewhere (the seeder script especially).
- **Table-name honesty:** clean. The new name reflects the reality.
- **Migration cost:** the rename itself is one line (`ALTER TABLE ... RENAME`), but the fan-out across code is the load.

**Pros:** most honest model. Sets up future needs cleanly.
**Cons:** highest blast, highest risk of a stale reader. Kevin ships prod on `main` with no staging - a wide rename PR is more anxious than it needs to be for the immediate goal.

### Option 3 - Separate away table

- **SQL:** new `sc_road_schedule (account_key, service_date, opponent, road_trip_id, game_time, ...)`.
- **Reader deltas:** `loadHomestandContext` becomes `loadScheduleContext` (or similar) and issues two queries (or a UNION view). Every consumer of `homestandMap` becomes a consumer of a union map.
- **Blast radius:** medium. Fewer sites than Option 2 but more coordination than Option 1.
- **Sync surface:** two tables to keep in sync at app layer (INSERT paths, load paths, dev/prod cutover).
- **UNIQUE constraint:** each table's own UNIQUE (account_key, service_date), plus an app-level check that a given (account, date) doesn't collide across the two tables. Not enforceable in Postgres without a cross-table constraint (partial UNIQUE across a UNION view) - adds a class of subtle bug.

**Pros:** clean isolation - the home path stays byte-identical.
**Cons:** two tables, one logical dataset. Sync burden, potential for cross-table collision. Feels like premature separation.

### Option 4 - Kevin's "no bolted-on 'AWAY'" instinct, taken further

You (Kevin) explicitly flagged: "just bolting 'AWAY' onto the existing CHECK may or may not be the best model." This option is a middle ground that respects that instinct without paying Option 2's blast cost.

- **SQL:** Option 1's ALTERs, PLUS: replace `homestand_id` with `segment_id` and add `segment_type` (`'HOMESTAND' | 'ROAD_TRIP'`). Each home cluster becomes `(HS1, HOMESTAND)`; each road cluster becomes `(RT1, ROAD_TRIP)`. Column rename is disruptive but preserves the semantics you want (grouping days into meaningful trip-shaped clusters).
- **Reader deltas:** every reader that references `homestandId` becomes `segmentId` + `segmentType`. The three-site EXHIBITION skip filter becomes a two-axis filter: skip AWAY from home rollups; add road-trip rollups later if wanted.
- **Blast radius:** medium-high. Between Option 1 and Option 2.

**Pros:** honest naming (segment > homestand-that-sometimes-isn't). Sets up "current road trip" grouping cleanly.
**Cons:** column rename touches all three PR #386 sites plus scripts. If road-trip grouping isn't a near-term product need, this is over-investment.

### Recommendation: Option 1

Fastest path to the architectural goal ("all schedule data in Postgres"), lowest risk given prod-on-main + no-staging + solo-dev constraints, and immediately compatible with the sc-12 + PR #386 pattern.

Concretely:

- **sc-13a (data extraction, separate work item)**: pending Kevin's ruling on MLB Stats API. Produces four CSV files (`CIN-OH_2026_away.csv`, etc.) with columns `(service_date, opponent, game_time_ct)`. Opponent codes normalized to DB canonical per R6.
- **sc-13b (migration + reader updates, this is the sc-13 PR)**:
  1. `ALTER TABLE sc_homestand_schedule` drop-and-recreate day_type CHECK with `'AWAY'` added.
  2. `ALTER COLUMN homestand_id DROP NOT NULL`.
  3. INSERT 4 x 81 = ~324 AWAY rows from the CSVs (opponent set, homestand_id NULL).
  4. `COMMENT ON TABLE sc_homestand_schedule IS '...historically homestand-only; post-sc-13 also stores AWAY rows. Rename pending scope.'`
  5. Reader deltas following the EXHIBITION pattern:
     - `classifyDayStatus`: new `AWAY` branch returning `"away"`.
     - `resolveDayStatus`: pass `"away"` through.
     - `DaySquare`: `--away` render (muted date, hollow `@ OPP` tag, plane glyph top-right, "no service" muted line; non-interactive).
     - Aggregate skips: add `d.dayType === "AWAY"` to the same gates that skip `"EXHIBITION"` in `serviceCalendar.js:1080`, `homestandDerivation.js:52`, `PeriodCard.js:196` + `:341`, `ServiceCalendar.js aggregateWorkspaceMetrics`.
     - Legend row added under HOMESTAND (`{ mod: "away", icon: "", label: "AWAY", ... }`).
  6. Probes at the migration file's bottom for post-apply verification (row counts per account per day_type).

**Explicitly NOT in sc-13b:**
- Table rename. Belongs in its own dedicated PR when a broader restructure is scoped.
- `road_trip_id` column. Add when a product need appears (road-trip grouping widget, road-trip stepper). Load-time attribution can happen in that later migration; nothing today needs it.
- Backfill of pre-2026 data. Kevin's call whether historical seasons matter.
- FK from `sc_homestand_schedule.account_key` to `accounts.team_key`. Worth doing but should not block sc-13.

### Why not Option 2/3/4?

- **Option 2** buys naming honesty at the cost of the widest blast. Not the moment to spend that budget.
- **Option 3** creates two tables for one logical concept. The UNIQUE-across-a-union problem is real. Not worth the isolation benefit given how small Option 1's home-path delta is.
- **Option 4** is the intellectually right answer if road-trip grouping is a near-term product need. If it isn't, we're paying a rename cost for a hypothetical future. Kevin's call - if the answer is "yes, road-trip grouping is coming soon," bump to Option 4. Otherwise Option 1 today, Option 4 later.

---

## Aside: an inconsistency worth noting (not blocking)

`sc-1-service-calendar-schema.sql` line 52-54 seeds `TXR-TX-H`, `TXR-TX-V`, `STL-MO`, `CIN-OH` as `billing_model = 'projections_drive_invoice'`. But `classifyDayStatus` at `serviceCalendar.js:210` branches into the homestand path only when `billingModel === 'flat_fee' && hasHomestandData`. If the seed is still current, the four MLB accounts would NEVER get the homestand-driven classification - yet they demonstrably do render correctly in prod.

Two possibilities: (a) the accounts' `billing_model` was updated post-sc-1 in Studio to `flat_fee`, or (b) there's a runtime override I missed. Not affecting sc-13's decision; flagging so the accounts' actual billing_model is confirmed before sc-13b's classifier delta lands (so we don't add an AWAY branch under a condition that isn't firing).

**Suggested probe** (Kevin runs in Studio):
```sql
SELECT team_key, billing_model
FROM accounts
WHERE team_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V','STL - FL');
```

---

## sc-13 shape at a glance (assuming Option 1 approved)

1. **sc-13a** (data extraction, prerequisite):
   - Kevin ruling on MLB Stats API acceptability.
   - Script pulls 2026 planned schedule per home-team account.
   - Applies R6 opponent normalization.
   - Emits per-account CSVs at `docs/sc-13/{CIN-OH,STL-MO,TXR-TX-H,TXR-TX-V}_2026_away.csv`.

2. **sc-13b** (migration + reader updates, this is the sc-13 PR):
   - `docs/migrations/sc-13-away-schedule-load.sql`:
     - ALTER day_type CHECK to add `'AWAY'`.
     - ALTER `homestand_id` DROP NOT NULL.
     - INSERT AWAY rows from CSVs.
     - Idempotency guards (`ON CONFLICT ... DO NOTHING`).
     - Probes at bottom.
   - Reader deltas (front-end + classifier), following PR #386's EXHIBITION pattern.
   - Legend + atom render for `--away`.
   - PR body leads with a row-count-per-account-per-day_type table proving the load landed cleanly.

3. **NOT in sc-13**: table rename, road_trip_id column, FKs, historical-year backfill. All separate scopes.
