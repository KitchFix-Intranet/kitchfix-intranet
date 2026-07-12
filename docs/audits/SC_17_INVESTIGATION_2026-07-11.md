# sc-17 investigation — FSL PDC home-game overlays for STL - FL + TBJ - FL (2026-07-11)

Read-only investigation done before any code / migration was written. Kevin's brief (revised to two accounts) locks scope tight: STL - FL AND TBJ - FL each get HOME games shown as `[vs OPP] + [day/night time pill]` on lg drill-down tiles, and nothing else changes.

## Task 1 — Data verification (fold-in)

### Account keys and billing models

| Account key | Description | billing_model | Rendered kind today |
|---|---|---|---|
| `STL - FL` | St. Louis Cardinals PDC, Palm Beach FL | `flat_fee` | `fee-no-dollar` (via `resolveDayKind`) |
| `TBJ - FL` | Toronto Blue Jays PDC, Dunedin FL | `actuals_drive_invoice` | `per-meal` (default fallthrough) |

Both verified against `docs/SC_SPREADSHEET_MAPPING.md:251+` (STL - FL) and `:373+` (TBJ - FL). **The two accounts render as different kinds today**, which means the sc-17 code changes touch BOTH `renderFeeNoDollar` (for STL - FL) AND `renderPerMeal` (for TBJ - FL), plus the corresponding `buildLargeContent` branches. See "Task 5 render coverage" at the bottom.

### API team IDs + parent orgs
- `sportId=14` — Florida State League (Single-A). Confirmed via `/api/v1/teams?sportId=14&season=2026` returning 30 teams.
- `teamId=279` — Palm Beach Cardinals. `parentOrgName = "St. Louis Cardinals"`. `abbreviation = "PMB"`. Venue: Roger Dean Chevrolet Stadium.
- `teamId=424` — Dunedin Blue Jays. `parentOrgName = "Toronto Blue Jays"`. `abbreviation = "DUN"`. Venue: TD Ballpark.

### 2026 schedule stats (post shadow-preferred dedup + DH compression)

| Metric | STL - FL | TBJ - FL |
|---|---|---|
| Raw HOME games | 67 | 66 |
| Postponement shadow dupes | 4 | 4 |
| HOME dayNight coverage | 100% (14 day / 53 night) | 100% (13 day / 53 night) |
| HOME gameDate populated | 100% | 100% |
| HOME startTimeTBD | 0 | 0 |
| HOME DH-flagged | 3 | 4 |
| **Unique HOME dates (final DB rows)** | **66** | **66** |
| Raw AWAY (NOT loaded) | ~66 | ~66 |

Neither account has TBD games in this pull, so a mid-season re-run isn't required for either - but the extractor stays re-runnable for parity with the AAA clubs.

Both venues host multiple teams (Roger Dean also hosts the Jupiter Hammerheads MIA affiliate; TD Ballpark also hosts the Blue Jays spring training) - the API's home/away designation is authoritative and independent of venue. Verified no cross-contamination.

**Same-league opponents**: PBC (STL - FL) and Dunedin (TBJ - FL) are both FSL, so they play each other. `DUN` appears as an opponent code on TBJ - FL's home slate; PBC (`PMB`) appears on STL - FL's home slate. Expected, no special handling.

## Task 2 — CRITICAL investigation: rowless-day behavior on a flagged account

This is the make-or-break question. The sc-16 reader (`has_homestand_schedule=true`) has TWO branches that would each break either account's operational behavior.

### For STL - FL (`billing_model = flat_fee`)

**Break #1 — `resolveDayKind`** (dayResolvers.js:100):
```js
if (hasHomestandSchedule && billingModel === "flat_fee") return "mlb-fee";
if (billingModel === "flat_fee") return "fee-no-dollar";
```
Flipping `has_homestand_schedule=true` routes STL - FL to `"mlb-fee"` kind → drops the "N served" no-$ discipline → renders as fee-account. Contract broken.

**Break #2 — `classifyDayStatus`** (dataStore serviceCalendar.js:210):
```js
if (ctx.billingModel === "flat_fee" && ctx.hasHomestandData) {
  if (!hs) return "off-season";
  ...
}
```
STL - FL has ~65 GAME rows on ~140 operational days. The other ~75 rowless days flip to `"off-season"` — catastrophic for a PDC that serves DAILY.

**Break #3 — counter semantics (post-#409)**: `off-season` days drop out of both the actionable-day numerator and denominator. Operator sees "5 of 65" instead of "5 of 140". Wrong.

### For TBJ - FL (`billing_model = actuals_drive_invoice`)

TBJ - FL doesn't have `billing_model = flat_fee`, so the fee-branch classifier at `serviceCalendar.js:210` and the mlb-fee kind at `dayResolvers.js:100` are BOTH skipped. But `has_homestand_schedule=true` STILL misfires here because:

**Break — `loadHomestandContext` fetch** (dataStore serviceCalendar.js:731-735):
```js
if (hasHomestandScheduleFlag) {
  homestandMap = await loadHomestandContext(accountKey, first, last);
}
```
This fires unconditionally on the flag, and populates `hs` with schedule rows. Then `hasHomestandData` becomes true. Downstream, the per-meal branch of `classifyDayStatus` (which handles per-meal accounts including TBJ - FL today) has an AWAY early-return at `if (hs?.dayType === "AWAY") return "away"` added in sc-16. TBJ - FL has zero AWAY rows in sc-17 - fine there. But GAME rows would flow through as normal, and downstream renders that key on `homestandMap[date]` (which the paired-PR reader threads to per-meal accounts too via the sc-16 wiring for CIN - KY / TBJ - NY) would try to render `mlb-fee`-shaped opponent chips through the milb / per-meal code paths. That's a mess of coupling.

**Verdict for both accounts**: the sc-16 `has_homestand_schedule` flag is inseparable from the fee-branch and MiLB-branch semantics that were purpose-built for CIN-OH/STL-MO/TXR-TX/CIN-KY/TBJ-NY. Overloading it for a "just display the chip and pill" case would either break the account or force conditional guard logic that trades correctness at one axis for complexity at another.

### Design proposal: `has_schedule_overlay` — the minimal guard

Add a NEW column `accounts.has_schedule_overlay BOOLEAN NOT NULL DEFAULT false`. Semantics:

- **Signals**: this account has schedule rows for INFORMATIONAL DISPLAY only.
- **Does NOT** touch `resolveDayKind` (both accounts stay in their current kind — STL - FL fee-no-dollar, TBJ - FL per-meal).
- **Does NOT** touch `classifyDayStatus` (both accounts keep the daily-service semantics they use today).
- **Does NOT** feed `aggregateWorkspaceMetrics` (counters unchanged byte-for-byte).
- **DOES** cause the API to fetch just the GAME rows and thread them into a `scheduleOverlay` field on the payload.
- **DOES** cause the `fee-no-dollar` AND `per-meal` tile renders on lg drill-down to conditionally prepend `[vs OPP] + [day/night pill]` above their existing content WHEN the overlay has a row for that date.

`has_homestand_schedule` stays FALSE for both accounts. `has_schedule_overlay` is set TRUE for both. The two flags are orthogonal:

| Account | has_homestand_schedule | has_schedule_overlay | Kind | Rowless-day classify |
|---|---|---|---|---|
| CIN - OH (MLB fee) | true | false | mlb-fee | off-season |
| STL - MO (MLB fee) | true | false | mlb-fee | off-season |
| TXR - TX - H (MLB fee) | true | false | mlb-fee | off-season |
| TXR - TX - V (MLB fee) | true | false | mlb-fee | off-season |
| CIN - KY (AAA MiLB) | true | false | milb | (uses per-meal branch) |
| TBJ - NY (AAA MiLB) | true | false | milb | (uses per-meal branch) |
| **STL - FL (FSL PDC)** | **false** | **true** | **fee-no-dollar** | **(unchanged, per-meal branch)** |
| **TBJ - FL (FSL PDC)** | **false** | **true** | **per-meal** | **(unchanged, per-meal branch)** |
| All others | false | false | (per current) | (unchanged) |

### Verification of rowless-day identity (both accounts)

Under the proposed design, for BOTH accounts:

**Rowless date** (post-sc-17):
- `has_homestand_schedule=false` → skips `loadHomestandContext` (unchanged from today).
- `has_schedule_overlay=true` → `loadScheduleOverlay` fetches; returned map HAS NO ENTRY for this date.
- `classifyDayStatus` runs the same branch as today. Zero change to status.
- `resolveDayKind` returns `fee-no-dollar` (STL - FL) or `per-meal` (TBJ - FL). Zero change.
- Tile render reads overlay bag, sees no entry, renders exactly as today.

**GAME-row date** (post-sc-17):
- `has_schedule_overlay=true` → overlay map has an entry for this date.
- Classify + kind identical to today (no change).
- `renderFeeNoDollar` (STL - FL) OR `renderPerMeal` (TBJ - FL) reads overlay bag, sees entry, prepends `[vs OPP] + [DayNightPill]` above their existing content ADDITIVELY.

**No AWAY rows are ever inserted for either account**, so no `away` classification path can fire.

**Counter math**: overlay data never enters classify or aggregateWorkspaceMetrics. `entered / actionable` ratios byte-identical to pre-sc-17.

### Task 5 render coverage (both kinds)

Because the two accounts render as different kinds today, sc-17 touches BOTH:

| Path | STL - FL (`fee-no-dollar`) | TBJ - FL (`per-meal`) |
|---|---|---|
| `buildLargeContent` branch (`PeriodWorkspace.js`) | `if (kind === "fee-no-dollar")` — reads overlay | `default per-meal fallthrough` — reads overlay |
| Tile render function (`DaySquare.js`) | `renderFeeNoDollar` — chip + pill prepended above "N served" | `renderPerMeal` — chip + pill prepended above meals-first stacked block |
| No-service short-circuit guard | N/A (fee-no-dollar has none) | Added: `if (!meals && !opponent)` returns "No service"; overlay-present future GAME days render the chip + pill instead of misleading "No service" (matches the sc-16 milb-branch fix) |
| Sm compact bag | UNCHANGED (Kevin's ruling: sm stays as today) | UNCHANGED |

## Task 3-5 plan (built from these findings)

- **Task 3 migration**: adds the `has_schedule_overlay` column + flags BOTH accounts + inserts 132 HOME rows (66 per club).
- **Task 4 extractor**: extends `_extract_milb_schedule.mjs` with a HOME-ONLY mode for `sportId=14 / teamId=279` (STL - FL) and `teamId=424` (TBJ - FL).
- **Task 5 reader/renderer**:
  - `loadScheduleOverlay(accountKey, first, last)` in dataStore.
  - Account SELECTs gain `has_schedule_overlay`.
  - API response gains `scheduleOverlay: {date: {opponent, dayNight, gameTime, isDoubleheader}}` when flag is TRUE.
  - `buildLargeContent` `fee-no-dollar` AND `per-meal` branches both read overlay.
  - `renderFeeNoDollar` AND `renderPerMeal` in DaySquare.js conditionally prepend chip + pill.
  - `ACCOUNT_HOME_TZ` in `gameTimeFormat.js` gains STL - FL and TBJ - FL (both America/New_York, "ET" - ET year-round in the SC's simple-label convention).

## What this design explicitly does NOT do

- No `has_homestand_schedule` flip on either account.
- No changes to `classifyDayStatus`.
- No changes to `resolveDayKind` gate.
- No changes to `aggregateWorkspaceMetrics`.
- No AWAY rows inserted (Kevin's ruling; migration comment states this).
- No game-day green border on either account (that's a `mlb-fee` treatment).
- No sm-tile changes (Kevin's ruling; sm stays exactly as today).
- No " · DH" affix beyond the existing chip logic (which now emits "vs OPP · DH" when `isDoubleheader` is set - free from the sc-16 chip render).
- No teal / AWAY / EXHIBITION treatment on either account ever.

If the chip + pill on lg looks orphaned without the game-day border (Kevin's contingency), the PR body will flag it with a screenshot and defer to Kevin's ruling instead of adding the border unilaterally.
