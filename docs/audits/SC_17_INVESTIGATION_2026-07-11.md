# sc-17 investigation — STL - FL + TBJ - FL home-game overlays (2026-07-11)

Read-only investigation done before any code / migration was written. Kevin's brief was revised to two accounts mid-day 2026-07-11. The initial sc-17 shipped covering STL - FL only; TBJ - FL adds via **sc-17b** as an extension of the same design.

Kevin's brief locks scope tight: both accounts get HOME games shown as `[vs OPP] + [day/night time pill]` on lg drill-down tiles, nothing else changes.

## Task 1 — Data verification (fold-in, both accounts)

### Account keys and billing models

| Account key | Description | billing_model | Rendered kind today |
|---|---|---|---|
| `STL - FL` | St. Louis Cardinals PDC, Palm Beach FL | `flat_fee` | `fee-no-dollar` (via `resolveDayKind`) |
| `TBJ - FL` | Toronto Blue Jays PDC, Dunedin FL | `actuals_drive_invoice` | `per-meal` (default fallthrough) |

Both verified against `docs/SC_SPREADSHEET_MAPPING.md`. **The two accounts render as different kinds today**, which means sc-17b's code changes touch BOTH `renderFeeNoDollar` (unchanged from initial sc-17 for STL - FL) AND `renderPerMeal` (new for TBJ - FL), plus both corresponding `buildLargeContent` branches.

### API team IDs + parent orgs

- `sportId=14` — Florida State League (Single-A). Confirmed via `statsapi.mlb.com/api/v1/teams?sportId=14&season=2026` returning 30 teams.
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

Neither account has TBD games in this pull, so a mid-season re-run isn't required for either — but the extractor stays re-runnable for parity with the AAA clubs.

Both venues host multiple teams (Roger Dean also hosts the Jupiter Hammerheads MIA affiliate; TD Ballpark also hosts the Blue Jays spring training) — the API's home/away designation is authoritative and independent of venue. Verified no cross-contamination.

**Same-league opponents**: PBC (STL - FL) and Dunedin (TBJ - FL) are both FSL, so they play each other. `PMB` (Palm Beach's API abbreviation) appears as an opponent code on TBJ - FL's home slate. Expected, no special handling.

## Task 2 — CRITICAL investigation: rowless-day behavior on a flagged account

This is the make-or-break question. The sc-16 reader (`has_homestand_schedule=true` + `billing_model='flat_fee'`) has TWO branches that would EACH break STL - FL's operational behavior:

### Break #1 — `resolveDayKind` (dayResolvers.js:100)

```js
if (hasHomestandSchedule && billingModel === "flat_fee") return "mlb-fee";
if (billingModel === "flat_fee") return "fee-no-dollar"; // STL-FL path today
```

Flipping `has_homestand_schedule=true` for STL - FL routes it to `"mlb-fee"` kind. That kind:
- Drops the "N served" no-$ discipline (STL - FL's whole point)
- Renders as fee-account with opponent chip and headcount
- Would require the operator to see a completely different tile shape on all days

**Verdict**: Cannot flip `has_homestand_schedule` for STL - FL without breaking the fee-no-dollar contract.

### Break #2 — `classifyDayStatus` (dataStore serviceCalendar.js:210)

```js
if (ctx.billingModel === "flat_fee" && ctx.hasHomestandData) {
  if (!hs) return "off-season";  // rowless date -> INVISIBLE tile
  if (hs.dayType === "EXHIBITION") return "exhibition";
  if (hs.dayType === "AWAY") return "away";
  if (hs.dayType === "GAME") { ... }
  return "prep"; // non-game homestand day
}
```

STL - FL has NO PREP/OPEN/CLOSE rows and NO AWAY rows and only ~65 GAME rows on the ~140 operational days (April-Sept). The other ~75 rowless days would all return `"off-season"` and render as invisible off-season tiles - which is catastrophically wrong because STL - FL SERVES DAILY (this is the whole point of the operational-only flat-fee account).

**Verdict**: Cannot flip `has_homestand_schedule` for STL - FL without breaking daily-service classification.

### Break #3 — counter semantics (post-#409)

`aggregateWorkspaceMetrics` excludes `off-season / away / exhibition / prep / no-service` from actionable-day counts. If STL - FL's rowless days flipped to `off-season`, the denominator would collapse from ~140 to ~65 and the numerator would only count entered GAME days. Operator sees "5 of 65" instead of "5 of 140". Wrong.

**Verdict**: Even if the tile render broke were somehow patched, the actionable-day math would still be broken by the `off-season` reclassification.

### Design proposal: `has_schedule_overlay` — the minimal guard

Add a NEW column `accounts.has_schedule_overlay BOOLEAN NOT NULL DEFAULT false`. Semantics:

- **Signals**: this account has schedule rows for INFORMATIONAL DISPLAY only.
- **Does NOT** touch `resolveDayKind` (STL - FL stays `fee-no-dollar`).
- **Does NOT** touch `classifyDayStatus` (STL - FL stays on its per-meal branch semantics for daily service).
- **Does NOT** feed `aggregateWorkspaceMetrics` (counters unchanged).
- **DOES** cause the API to fetch just the GAME rows and thread them into a new `scheduleOverlay` field on the payload.
- **DOES** cause the `fee-no-dollar` tile render on lg drill-down to conditionally prepend `[vs OPP] + [day/night pill]` above the "N served" line WHEN the overlay has a row for that date.

`has_homestand_schedule` stays FALSE for STL - FL. `has_schedule_overlay` is set TRUE. The two flags are orthogonal:

| Account | has_homestand_schedule | has_schedule_overlay | Kind | Rowless-day classify |
|---|---|---|---|---|
| CIN - OH (MLB fee) | true | false | mlb-fee | off-season |
| STL - MO (MLB fee) | true | false | mlb-fee | off-season |
| TXR - TX - H (MLB fee) | true | false | mlb-fee | off-season |
| TXR - TX - V (MLB fee) | true | false | mlb-fee | off-season |
| CIN - KY (AAA MiLB) | true | false | milb | (uses per-meal branch) |
| TBJ - NY (AAA MiLB) | true | false | milb | (uses per-meal branch) |
| **STL - FL (PDC Single-A)** | **false** | **true** | **fee-no-dollar** | **(uses per-meal branch, unchanged)** |
| All others | false | false | (per current) | (unchanged) |

### Verification of rowless-day identity

Under the proposed design:

**Rowless date on STL - FL** (post-sc-17):
- `has_homestand_schedule=false` → skips `loadHomestandContext` (unchanged from today).
- `has_schedule_overlay=true` → `loadScheduleOverlay` fetches, returns overlay map that HAS NO ENTRY for this date.
- `classifyDayStatus` runs the same branch as today (per-meal + STL-FL flat_fee path). Zero change to status.
- `resolveDayKind` returns `fee-no-dollar` (unchanged - the gate is unchanged).
- Tile render reads overlay bag, sees no entry, renders exactly as today.

**GAME-row date on STL - FL** (post-sc-17):
- `has_schedule_overlay=true` → overlay map has an entry for this date.
- Classify + kind identical to today (no change).
- `renderFeeNoDollar` reads overlay bag, sees entry, prepends `[vs OPP] + [DayNightPill]` above the "N served" line ADDITIVELY.

**No AWAY rows are ever inserted for STL - FL**, so no `away` classification path can fire.

**Counter math**: overlay data never enters classify or aggregateWorkspaceMetrics. `entered / actionable` ratios byte-identical to pre-sc-17.

## Task 3-5 plan (built from these findings)

- **Task 3 migration**: adds the `has_schedule_overlay` column + flags STL - FL + inserts HOME rows only.
- **Task 4 extractor**: extends `_extract_milb_schedule.mjs` with a HOME-ONLY mode for `sportId=14 / teamId=279`.
- **Task 5 reader**:
  - `loadScheduleOverlay(accountKey, first, last)` in dataStore.
  - Account SELECTs gain `has_schedule_overlay`.
  - API response gains `scheduleOverlay: {date: {opponent, dayNight, gameTime, isDoubleheader}}` (only when the flag is TRUE and the fetch is non-empty).
  - `buildLargeContent` `fee-no-dollar` branch reads overlay from the workspace prop.
  - `renderFeeNoDollar` in DaySquare.js conditionally prepends the chip + pill.
  - `ACCOUNT_HOME_TZ` in `gameTimeFormat.js` gains `STL - FL` (America/New_York, "ET" - Jupiter FL, ET year-round in the SC's simple-label convention).

## What this design explicitly does NOT do

- No `has_homestand_schedule` flip.
- No changes to `classifyDayStatus`.
- No changes to `resolveDayKind` gate.
- No changes to `aggregateWorkspaceMetrics`.
- No AWAY rows inserted (Kevin's ruling; migration comment states this).
- No game-day green border on STL - FL (that's a `mlb-fee` treatment).
- No sm-tile changes (Kevin's ruling; sm stays exactly as today).
- No " · DH" affix unless it emerges free from the existing opponent-chip logic.
- No teal / AWAY / EXHIBITION treatment on STL - FL ever.

If the chip + pill on lg looks orphaned without the game-day border (Kevin's contingency), the PR body will flag it with a screenshot and defer to Kevin's ruling instead of adding the border unilaterally.
