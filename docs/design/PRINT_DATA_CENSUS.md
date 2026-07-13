# SC print - ground-truth data census + four-bug diagnosis

> **Status**: READ-ONLY discovery, 2026-07-13. No code changes proposed here; every finding traces to a specific line + a specific field name + a specific database value. The design side realigns spec against this dossier; the fix brief lands after.
>
> **Author**: CC (`docs/print-data-census` branch, docs-only PR). Companion probe script preserved at `scripts/sc-print/census-probe.mjs` for reproduction.
>
> **What broke that motivated this**: v2 print spec (`docs/design/SC_PRINT_SPEC_v2.html`) was designed against invented sample data. Every place the invention diverges from the real database has surfaced as prod behaviour Kevin flagged: MLB month blank, MiLB month has states but zero games, TBJ - FL green dies after early July, PDF - season schedule menu item never appears for MLB/MiLB at overview. Sections A - I below are the ground truth; the four-bug table at the bottom traces each report to a specific evidence pointer + a proposed sentence-length fix + any ruling Kevin must make.

---

## A. Account census

Every column the print code reads, exact values from the `accounts` table, ordered by `team_key`. 12 rows (11 operating accounts + `CORP`, which the print system does not target but exists in the table).

| team_key | name | level | billing_model | has_homestand_schedule | has_schedule_overlay | active |
|---|---|---|---|---|---|---|
| `CIN - AZ` | `Cincinnati Reds` | `PDC` | `actuals_drive_invoice` | `false` | `false` | `true` |
| `CIN - KY` | `Louisville Bats` | `AAA` | `actuals_drive_invoice` | `true` | `false` | `true` |
| `CIN - OH` | `Cincinnati Reds` | `MLB` | `flat_fee` | `true` | `false` | `true` |
| `CORP` | `KitchFix Team` | `CORP` | `null` | `false` | `false` | `true` |
| `STL - FL` | `St Louis Cardinals` | `PDC` | `flat_fee` | `false` | `true` | `true` |
| `STL - MO` | `St Louis Cardinals` | `MLB` | `flat_fee` | `true` | `false` | `true` |
| `TBJ - FL` | `Toronto Blue Jays` | `PDC` | `actuals_drive_invoice` | `false` | `true` | `true` |
| `TBJ - NY` | `Buffalo Bisons` | `AAA` | `actuals_drive_invoice` | `true` | `false` | `true` |
| `TBR - FL` | `Tampa Bay Rays` | `PDC` | `actuals_drive_invoice` | `false` | `false` | `true` |
| `TXR - AZ` | `Texas Rangers` | `PDC` | `actuals_drive_invoice` | `false` | `false` | `true` |
| `TXR - TX - H` | `Texas Rangers Home` | `MLB` | `flat_fee` | `true` | `false` | `true` |
| `TXR - TX - V` | `Texas Rangers Visiting` | `MLB` | `flat_fee` | `true` | `false` | `true` |

**Findings and print-side assumption checks**:
- `level` values in the wild: `PDC`, `AAA`, `MLB`, `CORP`. `pickVariant()` in `src/lib/print/monthSheet.js` checks `account.level === "MLB"` - literal match holds.
- No column called `category` on `accounts` (my probe caught this: `column accounts.category does not exist`). If the design side speaks of "account category / class", it maps to `level`.
- `has_homestand_schedule` is authoritative for the "real MLB/AAA slate" case; `has_schedule_overlay` is authoritative for the FSL PDC overlay accounts (STL - FL + TBJ - FL). **CIN - AZ + TXR - AZ + TBR - FL carry neither flag** - they have no game schedule at all in the print's data path.
- Column set the print code reads today (in `src/lib/print/monthSheet.js:145`, `seasonSheet.js:95`, `opsCalendarSheet.js:45`): `team_key, name, level, billing_model, has_homestand_schedule, has_schedule_overlay`. Nothing more, nothing less.

---

## B. Service-name inventory + count magnitudes

Distinct service names per account, exactly as stored in `sc_daily_revenue`. Character count in parens. Flat-fee / tax-free / non-revenue flag values shown where non-default. Max projected + max actual across a 45-day sample (2026-05-01 → 2026-06-15) so the design side sees the true worst case for digit width.

**Non-revenue field name in the DB is `is_non_revenue`** (bool). No row in the sample carries `is_non_revenue = true` except one on TBJ - FL (`Fun $$$$ Allocated`). Every other service is revenue-bearing regardless of name. If the print code excludes anything by name (e.g. "beverage"), it is excluding revenue services.

### `CIN - AZ` (PDC · per_meal, SF% billing)
maxProjectedCount=`80` maxActualCount=`80`
- `Breakfast` (9)
- `Coffee Service (tax-free)` (25) - `is_flat_fee=true, is_tax_free=true`
- `Continental Plus` (16)
- `Dinner` (6)
- `Fountain Bev (tax-free)` (23) - `is_flat_fee=true, is_tax_free=true`
- `Lunch` (5)
- `Pre-Game Snack` (14)

### `CIN - KY` (AAA · per_meal)
maxProjectedCount=`45` maxActualCount=`45`
- `Breakfast` (9), `Lunch` (5), `Post-Game` (9), `Snack` (5), `Umpire` (6)

### `CIN - OH` (MLB · flat_fee) - **note**: no `Breakfast`/`Lunch`/`Dinner` at all
maxProjectedCount=`75` maxActualCount=`75`
- `Arrival` (7), `Post BP` (7), `Post-Game` (9), `Umpire` (6)

### `STL - FL` (PDC overlay · flat_fee)
maxProjectedCount=`70` maxActualCount=`138`
- `Breakfast` (9), `Breakfast - ST` (14) - the "- ST" suffix indicates the Spring Training variant service, distinct row
- `Lunch` (5), `Lunch - ST` (10)
- `Post-Game` (9), `Pre-game` (8) - note case: lowercase `g` in `Pre-game`
- `Snack` (5)

### `STL - MO` (MLB · flat_fee) - **zero actuals in the sample**
maxProjectedCount=`68` maxActualCount=`0`
- `Arrival` (7), `Post BP` (7), `Post-Game` (9), `Umpire` (6)

### `TBJ - FL` (PDC overlay · per_meal) - **the widest catalog in the system**, 13 distinct services
maxProjectedCount=`167` maxActualCount=`6645` (the 6645 is one anomaly row - see Part I)
- `Breakfast` (9)
- `Dinner` (6)
- `Florida Ops - PDC` (17)
- `Fun $$$$ Allocated` (18) - **the only `is_non_revenue = true` row I found in the sample window**, `is_flat_fee = true`
- `Lunch` (5)
- `MiLB G&G - Pantry` (17)
- `Post Game Meal` (14) - **note case**: no hyphen; distinct from `Post-Game`
- `Post-Game` (9)
- `Pre-Game` (8) - **note case**: capital `G`, distinct from STL - FL's `Pre-game`
- `Scout Meals` (11)
- `Snack` (5)
- `Stadium Staff Meals` (19)
- `Umpire` (6)

### `TBJ - NY` (AAA · per_meal)
maxProjectedCount=`45` maxActualCount=`55`
- `Breakfast` (9), `Lunch` (5), `Post-Game` (9), `Shake` (5), `Snack` (5), `Umpire` (6)

### `TBR - FL` (PDC · per_meal, SF% billing) - **holds the LONGEST NAME in the system**
maxProjectedCount=`125` maxActualCount=`240`
- `B&G Lunch` (9)
- `Breakfast` (9), `Breakfast - MiLB` (16), `Breakfast - MiLB ST` (19)
- `Dinner` (6)
- `Extended Day labor` (18)
- **`Extra Protein - Beef/Seafood` (28)** - **the longest**
- `Extra Protein - Chicken/Pork` (28) - tied
- `Lunch` (5), `Lunch - MiLB` (12), `Lunch - MiLB ST` (15)
- `MLB - Extra MTO - Lrg` (21), `MLB - Extra MTO - Med` (21), `MLB - Extra MTO - Sm` (20)
- `Road Sandwiches - MiLB` (22)
- `Umpire Meal` (11)

### `TXR - AZ` (PDC · per_meal, SF% billing)
maxProjectedCount=`100` maxActualCount=`120`
- `Breakfast` (9), `Continental Breakfast` (21), `Dinner` (6)
- `Extra Protein - Beef/Seafood` (28), `Extra Protein - Chicken/Pork` (28)
- `Lunch` (5), `Pre-Game Hot Snack` (18), `Regular Snack` (13)

### `TXR - TX - H` (MLB · flat_fee) + `TXR - TX - V` (MLB · flat_fee)
Both: `Arrival`, `Post BP`, `Post-Game`, `Umpire`. `maxActualCount = 0` for both in the sample window.

### Worst-case for print layout
- **Longest service name in the system: `Extra Protein - Beef/Seafood` (28 chars)**. If the meal-stack line format is `{FULL NAME} {count}`, the design side must budget for **34 chars** per line (28-char name + space + 3-digit count + space; wider if `is_doubleheader` days push counts to 4 digits, but the observed max is 240 = 3 digits).
- **TBJ - FL carries 13 distinct services**. If the meal stack "one line per service" rule renders every row, a single day cell must hold **up to 13 lines + total** vertically. Current cell height is 84px per `.cal td` in `src/lib/print/assets.js:104`.
- Case sensitivity is a real thing in the data: `Pre-game` (STL - FL) vs `Pre-Game` (TBJ - FL) vs `Pre-Game Snack` (CIN - AZ) vs `Pre-Game Hot Snack` (TXR - AZ) - four distinct strings, no normalization. Anything the print code does with names must preserve case exactly.

---

## C. Actuals + projection horizon per account

Latest date each account has real data in each store. Numbers pulled directly from `sc_daily_actuals` and `sc_daily_projections` order-by-desc-limit-1 per account.

| team_key | max actuals date | max projection date | Reads as |
|---|---|---|---|
| `CIN - AZ` | `2026-07-23` | `2026-12-20` | Actuals current; projections through year-end. |
| `CIN - KY` | `2026-06-28` | `2026-09-27` | Actuals stopped at end of June; projections to season end. |
| `CIN - OH` | `2026-07-12` | `2026-09-27` | Actuals through yesterday; projections to season end. |
| `CORP` | `(none)` | `(none)` | Not operated on the SC. |
| `STL - FL` | `2026-05-31` | `2026-12-20` | **Actuals stopped end of May**. Everything after is compliance-signal territory OR projected-only. |
| `STL - MO` | `(none)` | `2026-09-27` | **Zero actuals for the year.** Every entered day would render as PROJECTED-only. |
| `TBJ - FL` | `2026-06-27` | `2026-12-20` | **Actuals stopped end of June**. Kevin's "green dies after early July" observation lands here. |
| `TBJ - NY` | `2026-06-14` | `2026-09-27` | Actuals stopped mid-June. |
| `TBR - FL` | `2026-07-24` | `2026-12-29` | Actuals current. |
| `TXR - AZ` | `2026-06-14` | `2026-11-22` | Actuals stopped mid-June. |
| `TXR - TX - H` | `(none)` | `2026-09-25` | Zero actuals. |
| `TXR - TX - V` | `(none)` | `2026-09-25` | Zero actuals. |

**Horizon reads for the print system**: on today = `2026-07-13`, the print's `SERVED / PROJECTED / NO ACTUALS / NO SERVICE` state model has to describe (i) days with actuals (SERVED), (ii) past-without-actuals days (NO ACTUALS), (iii) future days with projections (PROJECTED), (iv) days marked no-service. For STL - FL / TBJ - FL / STL - MO / TXR - TX - * / TBJ - NY / TXR - AZ, "past-without-actuals" is a huge slab of the calendar. For CIN - OH / CIN - AZ / CIN - KY / TBR - FL, only the last few weeks fall into that state.

**TBJ - FL specifically at Jul 15 / Aug 1 / Sep 1** (per `loadMonthData("TBJ - FL", ...)` calls in the probe):

| date | day.status | services carrying projected>0 | day.hasActuals | day.hasProjection |
|---|---|---|---|---|
| `2026-07-15` | `"future"` | `Breakfast` proj=185, `Stadium Staff Meals` proj=20, `Post-Game` proj=50, `Pre-Game` proj=50, `Lunch` proj=185 | **`undefined`** | **`undefined`** |
| `2026-08-01` | `"future"` | `Breakfast` proj=160, `Pre-Game` proj=50, `Lunch` proj=160 | **`undefined`** | **`undefined`** |
| `2026-09-01` | `"future"` | `Breakfast` proj=75, `Stadium Staff Meals` proj=20, `Post-Game` proj=50, `Pre-Game` proj=50, `Lunch` proj=75 | **`undefined`** | **`undefined`** |

**This is Bug 4 (see summary table)**. The day-level object returned by `loadMonthData` does NOT include `hasActuals` or `hasProjection`. Those flags exist on the per-service rows (`day.services[i].hasActuals`, `hasProjection`) but never roll up to the day object. `resolveDayState` in `src/lib/print/assets.js:186` reads `day.hasProjection && !day.hasActuals` on the day-level state → both undefined → fallthrough returns `null` → the "future" status classifies as neither SERVED nor PROJECTED nor NO_ACTUALS → the cell renders default (soft) with no state fill. Green never lands past the actuals-horizon date.

Screen parity - I do not have SSO access to compare screen; **cannot confirm print vs screen parity for these dates from CC's environment**. The `classifyDayStatus()` at `serviceCalendar.js:184` used by both surfaces returns `"future"` for these dates (verified). The screen surface uses a different render path that likely DOES observe the per-service projection presence (it renders projected dollar figures per tile). Kevin's browser-side confirmation is the only source of truth for the screen behaviour.

**What data WOULD be needed to render "expected service" on far-future days**: nothing new. The data exists (`day.services[i].projectedCount > 0`). What's missing is the propagation into a day-level flag the print's state resolver can read. Two shapes possible:
1. Extend `loadMonthData` / `loadYearSummary` to emit `hasActuals` + `hasProjection` at the day level (mirror of `sc_daily_revenue` view aggregation).
2. Change `resolveDayState` to accept the per-day services array and derive `hasProjection` inline.
Not fixing here - reporting.

---

## D. Game / homestand data shape

### D.1 `sc_homestand_schedule` sample rows - exact shape as stored (Jun 1 - Jul 15 2026)

All representative account classes covered:

**`CIN - OH` (MLB · has_homestand_schedule)** - sample rows:
```json
{"service_date":"2026-06-01","day_of_week":"Monday","day_type":"GAME","opponent":"KC","game_time":"2026-06-01T23:10:00+00:00","day_night":"night","is_doubleheader":false,"homestand_id":"HS6","game_pk":824510}
{"service_date":"2026-06-05","day_of_week":"Friday","day_type":"AWAY","opponent":"STL","game_time":null,"day_night":null,"is_doubleheader":false,"homestand_id":null,"game_pk":823049}
{"service_date":"2026-06-13","day_of_week":"Saturday","day_type":"GAME","opponent":"ARI","game_time":"2026-06-13T20:10:00+00:00","day_night":"day","is_doubleheader":false,"homestand_id":"HS7","game_pk":824508}
```

**`CIN - KY` (AAA · has_homestand_schedule)** - sample rows:
```json
{"service_date":"2026-06-09","day_of_week":"Tuesday","day_type":"GAME","opponent":"IOW","game_time":"2026-06-09T22:35:00+00:00","day_night":"night","is_doubleheader":false,"homestand_id":null,"game_pk":816267}
{"service_date":"2026-06-19","day_of_week":"Friday","day_type":"AWAY","opponent":"GWN","game_time":null,"day_night":null,"is_doubleheader":true,"homestand_id":null,"game_pk":816644}
```

**`STL - FL` (PDC · has_schedule_overlay)** - sample rows (GAME rows only, per sc-17 HOME-only hard rule):
```json
{"service_date":"2026-06-09","day_of_week":"Tuesday","day_type":"GAME","opponent":"SLU","game_time":"2026-06-09T22:30:00+00:00","day_night":"night","is_doubleheader":false,"homestand_id":null,"game_pk":820407}
```

**`TBJ - FL` (PDC · has_schedule_overlay)** - sample rows (HOME only):
```json
{"service_date":"2026-07-11","day_of_week":"Saturday","day_type":"GAME","opponent":"LAK","game_time":"2026-07-11T22:53:00+00:00","day_night":"night","is_doubleheader":false,"homestand_id":null,"game_pk":820651}
```

**`TBJ - NY` (AAA · has_homestand_schedule)** - sample rows:
```json
{"service_date":"2026-06-16","day_of_week":"Tuesday","day_type":"GAME","opponent":"CLT","game_time":"2026-06-16T22:35:00+00:00","day_night":"night","is_doubleheader":false,"homestand_id":null,"game_pk":816945}
```

### D.2 Exact field names + types
- Field: `day_type` (snake_case in DB). **Enum values observed across every schedule account, Jun - Sep 2026: `["GAME", "AWAY"]`** and nothing else. No `HOME` string, no `OFF` string. If the print code checks `day_type === "HOME"`, it will never match (the correct match is `day_type === "GAME"`).
- Field: `opponent` - 3-letter code (MLB and AAA both use codes: `KC`, `STL`, `ARI`, `NYY`, `MIL`, `IOW`, `GWN`, `STP`, `MEM`, `SYR`, `CLT`, `WOR`). FSL overlay accounts also use 3-letter codes (`SLU`, `BRD`, `DBT`, `TAM`, `LAK`, `PMB`, `FTM`, `JUP`). No full-name strings.
- Field: `game_time` - `timestamptz` (TZ = UTC in storage). NULL on `day_type = "AWAY"` (verified across all accounts).
- Field: `day_night` - text, values `"day"` / `"night"` / `null`. NULL on all AWAY rows.
- Field: `is_doubleheader` - boolean, mostly false. **CIN - KY has one DH day in the sample (Jun 19 vs GWN, AWAY)**.
- Field: `homestand_id` - text or null. Populated for CIN - OH (`HS6`, `HS7`, `HS8`, ...) but NULL for CIN - KY / STL - FL / TBJ - FL / TBJ - NY (verified). If the print code uses this for anything other than CIN - OH grouping, it will drop other accounts.
- Field: `game_pk` - integer, always populated (MLB Stats API game key).

### D.3 What `loadMonthData` actually returns per day

Direct probe against `loadMonthData("TBJ - FL", 2026, 8)`:
```json
{"date":"2026-08-01","status":"future"}
{"date":"2026-08-02","status":"no-service"}
{"date":"2026-08-03","status":"future"}
```

**Only `date` and `status`**. **NO `dayType`, NO `opponent`, NO `gameTime`, NO `is_doubleheader`, NO `hasActuals`, NO `hasProjection`, NO `projectedCount`, NO `actualCount`.**

Where the print code (`src/lib/print/monthSheet.js:207-217`) does:
```js
for (const d of monthData?.days || []) {
  if (d.dayType) {
    homestandByDate[d.date] = {
      dayType:        d.dayType,
      opponent:       d.opponent || "",
      gameTime:       d.gameTime,
      dayNight:       d.dayNight,
      isDoubleheader: !!d.isDoubleheader,
    };
  }
}
```

`d.dayType` is **always undefined**. `homestandByDate` stays **empty** for every account except overlay-flagged ones (which populate via the separate `loadScheduleOverlay(...)` call at lines 165-172). **This is the root of Bug 1 (MLB month blank) AND Bug 2 (MiLB month has states but zero games).**

### D.4 `loadYearSummary` day shape - contrast

For comparison, `loadYearSummary("CIN - OH", 2026)` DOES emit `dayType`/`opponent`/`gameTime`:
```json
{"date":"2026-07-11","status":"entered","gameType":"HOME","actualMeals":0,"hasNoteEntries":true,"homestandId":"HS9","dayType":"GAME","opponent":"CHC","dayNight":"night","gameTime":"2026-07-11T23:10:00+00:00","isDoubleheader":false}
```

So the Ops Calendar (which uses `loadYearSummary`) HAS the homestand data. Games don't appear on the Ops Calendar because the spec says games do not appear there - correct behaviour.

**Same probe reveals a DIFFERENT gap in `loadYearSummary`**: `flag counts across year: { withStatus: 162, hasAct: 0, hasProj: 0 }`. Neither `hasActuals` nor `hasProjection` propagates to the day-level object. Same failure surface as `loadMonthData` for the state-fill fallthrough. Ops Calendar's `resolveDayState` fallthrough to PROJECTED never fires either.

### D.5 Wave 1 (#421-era) working mapping vs Wave 3 (#422) regression

The Wave 1 and Wave 2 code shipped in `#419` and `#420` also read `monthData?.days[i].dayType`. This has been broken **since Wave 1** - the MLB month sheet has never rendered games in the print system. The bug lived undetected because Kevin's Wave 1 browser click didn't test the CIN - OH month path; his verification set focused on STL - FL (overlay, populated via the separate call) and CIN - AZ / TBR - FL / etc. (per-meal PDC with no schedule at all). The regression didn't happen in Wave 3; **Wave 3 exposed a pre-existing latent bug** by generating the CIN - OH month PDF in the local `gen-all-pdfs.mjs` for the first time.

**The exact line where the data dies**: `src/lib/print/monthSheet.js:208` reads `if (d.dayType)` on days that never carry that key.

---

## E. Menu flag path - sc-load account payload

Direct simulation of what `src/app/api/service-calendar/route.js:446-458` builds for `CIN - OH` (from the probe, section J):
```json
{
  "key": "CIN - OH",
  "category": "MLB",
  "name": "Cincinnati Reds",
  "billingModel": "flat_fee",
  "hasScheduleOverlay": false,
  "spreadsheetId": ""
}
```

**`hasHomestandSchedule` is NOT emitted.** `hasScheduleOverlay` is emitted correctly.

`ExportControl.js:32-34` receives:
```js
hasHomestandSchedule = false,   // default prop
hasScheduleOverlay   = false,   // default prop
```

`ServiceCalendar.js:2020` wires:
```js
hasHomestandSchedule={!!data?.account?.hasHomestandSchedule}
hasScheduleOverlay={!!data?.account?.hasScheduleOverlay}
```

`data.account.hasHomestandSchedule` is `undefined` for **every schedule-carrying MLB and AAA account** in production (CIN - OH, STL - MO, TXR - TX - H, TXR - TX - V, CIN - KY, TBJ - NY). The prop resolves to `false`, so `buildMenuItems` at `ExportControl.js:284`:
```js
const hasSchedule = !!(hasHomestandSchedule || hasScheduleOverlay);
...
if (hasSchedule) {
  items.push(pdfSeasonItem({ year, accountKey }));
}
```
never adds the PDF - season schedule item. Only STL - FL and TBJ - FL (the two overlay accounts) get it - because `hasScheduleOverlay` IS emitted correctly.

**Has been broken since PR #419 (Wave 1 landed the season PDF gated on `hasSchedule`).** The item was NEVER reachable on prod for MLB/AAA schedule accounts. **This is Bug 3.**

**The exact line where the data dies**: `src/app/api/service-calendar/route.js:446-458` builds `responsePayload.account` without adding `hasHomestandSchedule: hasHomestandScheduleFlag`. That's a one-line omission on the server side.

---

## F. Classifier parity - every observed `day.status` value

Across 8 representative `loadMonthData(...)` calls (CIN - OH July, CIN - KY July, STL - FL March + July, TBJ - FL July + August, CIN - AZ February + July), the following distinct `day.status` values were observed:

```json
["away", "entered", "future", "needs-entry", "no-service", "overdue"]
```

Distribution (illustrative):
| account · month | days | status counts |
|---|---|---|
| `CIN - OH 2026-07` | 23 | `{"away":9,"entered":9,"future":5}` |
| `CIN - KY 2026-07` | 31 | `{"away":14,"no-service":7,"needs-entry":6,"future":4}` |
| `STL - FL 2026-03` | 31 | `{"no-service":3,"overdue":27,"entered":1}` |
| `STL - FL 2026-07` | 31 | `{"overdue":4,"no-service":2,"needs-entry":6,"future":19}` |
| `TBJ - FL 2026-07` | 31 | `{"overdue":4,"no-service":5,"needs-entry":5,"future":17}` |
| `TBJ - FL 2026-08` | 31 | `{"future":26,"no-service":5}` |
| `CIN - AZ 2026-02` | 28 | `{"no-service":3,"entered":25}` |
| `CIN - AZ 2026-07` | 31 | `{"entered":10,"no-service":6,"future":15}` |

`resolveDayState()` in `src/lib/print/assets.js:186` maps:
| classifier status | resolveDayState returns | Handling |
|---|---|---|
| `"entered"` | `"SERVED"` | Explicit case ✓ |
| `"no-service"` | `"NO_SERVICE"` | Explicit case ✓ |
| `"overdue"` | `"NO_ACTUALS"` | Explicit case ✓ (collapsed with needs-entry per Kevin's ruling) |
| `"needs-entry"` | `"NO_ACTUALS"` | Explicit case ✓ |
| `"future"` | falls through to `day.hasProjection && !day.hasActuals` check → **returns `null`** because those flags are never populated on the day (see Section D.4 and Section C findings) | **SILENTLY DROPS** |
| `"away"` | falls through same check → `null` | **SILENTLY DROPS** |

**`"future"` and `"away"` are silently dropped** by the print state resolver. `"future"` is the primary cause of Bug 4 (TBJ - FL green dies). `"away"` doesn't currently affect month sheets because the MLB variant handles away via `homestandByDate.dayType === "AWAY"` (which fails via Bug 1 anyway), so this failure hides another failure.

**The season loader (`seasonSheet.js`) uses `seasonServiceState()`** at `src/lib/print/assets.js:225` which only maps SERVED / PROJECTED / NO ACTUALS / NO SERVICE via resolveDayState + a collapse. Same fallthrough problem.

**The ops calendar loader uses `resolveDayState()`** directly on `loadYearSummary` day objects → same failure surface.

---

## G. Contact sheet - every proof PDF converted to PNG and viewed

Every PDF in the current `scripts/sc-print/artifacts/` set converted via `pdftoppm -png -r 96 -f 1 -l 1`. Each first-page PNG viewed in-session. Per-sheet observation vs `SC_PRINT_SPEC_v2.html`:

### `CIN-OH_Month_2026-07.pdf` (88 KB) - **COMPLETELY BLANK**
Only day numbers visible. No home fills, no away fills, no service state. Legend shows the three MLB legend items (HOME · FIRST PITCH ET, @AWAY, DAY GAME). **Every cell is empty white**. Spec Sheet 5 mandates home + away fills + opponent + time. Reality: nothing. This is Bug 1 rendered.

### `CIN-KY_Month_2026-07.pdf` (91 KB) - **states present, zero games**
NO ACTUALS copper cells visible for Jul 7-12 (past dates within lock cutoff). NO SERVICE soft cells for Jul 13-19 (mostly). No SERVED green, no PROJECTED green (no state cells for the future dates). **No HOME cells. No AWAY cells.** Yet `sc_homestand_schedule` has 41 GAME + 51 AWAY rows for CIN - KY across Jun - Sep. This is Bug 2.

### `STL-FL_Month_2026-03.pdf` (93 KB)
Spring copper title chip fires ✓. `NO ACTUALS` copper cells fill most of March (past + no actuals - matches Section C: STL - FL max actuals date = May 31, so March is fully past-without-actuals). One SERVED green cell on Wed Mar 18 with a meal stack: `B 200 / L 200 / PG 50 / 450`. No games (spec-correct - STL - FL FSL games start Apr 2). NO SERVICE cells on some Sundays.

### `CIN-AZ_Month_2026-02.pdf` (126 KB) - **the PDC meal-stack showcase**
`SPRING TRAINING` copper title chip fires ✓. Rich green SERVED cells across Feb 2-28 with per-service meal stacks. **Observed problem in Wave 3's meal stack**: labels come out as `B 25`, `L 25`, but multiple `B`/`L` lines appear because CIN - AZ has both a `Breakfast` service and other Breakfast-family services (e.g. `Continental Plus`, `Pre-Game Snack`) whose first-letter labels collide. Feb 15 shows `B 132 / D 80 / L 130 / L 118 / 460` - two L rows from two different services. The Wave 3 `shortLabel()` function in `monthSheet.js:340-350` collapses to first-letter, so distinct services with same first letter render as duplicate rows with no way to tell them apart. **Kevin's spec ruling** ("MLB Lunch 110") means full service names, and the invented sample data never carried collisions.

### `CIN-OH_Season.pdf` (300 KB) - **CLEAN, spec-faithful**
Home cells (navy) with opp + time. Away cells (grey) with opp code. Day numbers top-left. Ghost `MLB` right. Per-month counts `N H · N A`. March is a mixed slate + one AWAY block (BOS Mar 20-22). April - September dense home/away rendered accurately.

### `CIN-KY_Season.pdf` (289 KB) - **CLEAN, spec-faithful**
AAA ghost, home + away + day numbers all render. Ghost `AAA` right. DH affix appears on Aug 12 (`TOL 6:35 DH`).

### `TBJ-FL_Season.pdf` (231 KB) - **CLEAN, spec-faithful, blended variant**
Ghost renamed `SERVICE CALENDAR` ✓. Home cells (navy `LAK`, `PMB`, `TAM` etc) layer over a background of green SERVICE tiles across every operating day. No AWAY (correct - overlay accounts are home-only by design). `12 HOME`, `15 HOME`, `12 HOME`, `13 HOME`, `14 HOME` per month header. `SEASON ENDS AUG 30` trailer.

### `STL-FL_Period_P8.pdf` (91 KB)
Title `PERIOD 8` + fiscal range `JUL 13 - AUG 9` ✓. **From Jul 13 forward (today's date is Jul 13), every cell in the period is EMPTY white**. Should be PROJECTED green (data shows STL - FL projections through Dec 20). This is Bug 4 rendered on the period surface. Kevin's exact language "green dies after early July" reproducibly matches: last actual on May 31 → June/early July show NO ACTUALS copper → today forward shows nothing. Legend advertises SERVED / PROJECTED / NO ACTUALS / NO SERVICE, but PROJECTED never appears in the rendered grid.

### `STL-FL_OpsCalendar.pdf` (379 KB)
P1..P13 navy squares fire ✓. Spring dashed copper borders visible around Feb/Mar cells (interpreted as `.spb` bar at top of cell). April - June show a mix of green SERVED (past-with-actuals) and dashed copper NO ACTUALS (past-without-actuals). **July - September mostly empty** (should be PROJECTED for future dates with projections). M/F header chips render as small ink pills. Legend renders correctly with the six entries.

### `CIN-OH_OpsCalendar.pdf` (261 KB)
P1..P13 navy squares fire ✓. Jul 3, 4, 5, 8, 9, 10, 11, 12 render as SERVED green (matches actuals dates). Rest of year mostly empty. Should show NO ACTUALS on past dates without actuals (STL - MO / TXR - TX - * pattern would be even more extreme), and PROJECTED on future days with projections. Same silent drop of `future` status as STL - FL.

### `CIN-AZ_OpsCalendar.pdf` (268 KB)
P1..P13 render ✓. February shows dense green SERVED cells (matches Feb full-actuals pattern) + copper spring bars on the top of each spring-block cell. Rest of year mostly empty (CIN - AZ has projections through Dec 20 but they don't render because "future" status silently drops).

### Answer to Kevin's explicit ask
**Was `CIN-OH_Month_2026-07.pdf` blank in earlier proof runs?** The earlier `#420` (Wave 2) proof set from July 13 morning included `CIN-OH_Month_2026-07.pdf` at 86 KB - **the same byte size across runs**, roughly matching today's 88 KB blank output. **Yes, the sheet was almost certainly blank in every earlier run.** It was regenerated twice (once for Wave 2, once for Wave 3) and never opened to look at the pixels; the `gen-all-pdfs.mjs` script only reports byte size and file path, not visual content. **The Wave 1, Wave 2, Wave 3 proof cycles never actually looked at a rendered MLB month.**

---

## H. Opponent + label reality for season sheets

Every opponent string observed across all schedule accounts is a **3-letter uppercase code** (see Section D.2 for the full set). Length distribution is **exactly 3 chars** in every sample I pulled. Zero full-team-name strings. No dot / hyphen / space in any opponent string I saw.

**`is_doubleheader` DH affix**: currently added as `" DH"` (space + DH). Appears on:
- `CIN - KY` Aug 12 (`TOL 6:35 DH`) - home DH.
- `CIN - KY` Jun 19 (GWN AWAY DH).
- On CIN - OH's 2026 slate DH days exist (per the sc-16 audit) but none in my Jun - Jul 15 sample window.

**Cell content worst case for the season mini-grid** (per `SC_PRINT_SPEC_v2` `.sg .h`):
- `<em>OPP</em>` (3 chars) + `<i>H:MM ET DH</i>` (max ~11 chars including the DH affix and TZ label).
- Home cell height is 32px, columns 1/7 of the mini-month width. At A4 landscape ~910px/3 mo blocks, each mini-month is ~280px wide, so each column is ~40px. 11-char time label + DH at 6.5px font-size should fit but rides the edge - the design side needs to eyeball.

---

## I. Anything else that will bite

Discoveries surfaced during the probes that will bite the design side if left unnoticed:

1. **`STL - MO` and `TXR - TX - H/V` have ZERO actuals for the year.** Even though they carry `has_homestand_schedule = true`, no operator has entered a single day's actuals for those three accounts across 2026. Every day for those accounts renders as NO ACTUALS (copper) or whatever the fallthrough for "future" produces (currently silent drop). If the client bill export ever pulls from actuals for these accounts, it'll pull nothing.
2. **`CIN - OH` and the other MLB fee accounts have NO `Breakfast`/`Lunch`/`Dinner` services.** Their catalogs are `Arrival`, `Post BP`, `Post-Game`, `Umpire`. The Wave 3 meal-stack `shortLabel()` would map `Arrival` → `A`, `Post BP` → `P`, `Post-Game` → `P`, `Umpire` → `U` - two P collisions. Even if the meal stack rendered on MLB (which the current MLB variant excludes), the labels would collide.
3. **Case sensitivity in service names is unforgiving**: `Pre-game` (STL - FL) vs `Pre-Game` (TBJ - FL) vs `Pre-Game Snack` (CIN - AZ) vs `Pre-Game Hot Snack` (TXR - AZ) - four distinct services. No normalization. If any print code normalizes casing or trims " Snack"/" Hot Snack" suffixes, per-account price + count math will break silently.
4. **`STL - FL` and `TBR - FL` carry Spring Training variant services** as distinct rows (`Breakfast - ST`, `Breakfast - MiLB`, `Breakfast - MiLB ST`). The spring copper title chip fires at the calendar level but the meal stack has no way to know these are the "spring-flavor" of the same meal. Aggregation semantics are a design question.
5. **`TBJ - FL` has ONE anomaly `actualCount = 6645`** in the sample window. Almost certainly a data-entry typo (three digits meant, four typed). Not a print bug, but worth flagging because print's "no rounding" ruling means whatever the DB says goes to the PDF. If the finance team pulls a bill export tomorrow, that 6645 goes to the invoice.
6. **`homestand_id` is populated for `CIN - OH` only** (`HS6`, `HS7`, `HS8`, ...). NULL for every other account. If any print visualization groups by homestand id, only CIN - OH will produce groups.
7. **`is_doubleheader` DH data quality**: `CIN - KY` Jun 19 shows `is_doubleheader = true` on an AWAY row. In practice a DH is two games; the sc_homestand_schedule table has one row per date. Consumers must understand that "DH on this date" means "two games happened this day" without any further detail in the print data.
8. **CORP account exists** and gets returned by the accounts census. It has `billing_model = null` and no operating data. The Export UI does not currently offer any print options for CORP because Kevin's `selectedAccount` picker in the UI filters CORP out of the operator dropdown. But if some future flow points the print route at `account=CORP`, the sheet will render with all cells blank and no diagnostic message.
9. **`opsCalendarSheet.js` uses `loadYearSummary` which is missing `hasActuals`/`hasProjection`** at the day level (Section D.4). This means every ops-calendar cell for `future` status renders as blank, not as PROJECTED. Kevin's Ops Calendar is a compliance surface but half of its intended states silently disappear.

---

## Four-bug summary table

| # | Report | Root cause (exact line) | Evidence pointer | Proposed fix (one sentence) | Ruling Kevin must make |
|---|---|---|---|---|---|
| **1** | MLB month renders completely blank | `loadMonthData()` in `src/lib/dataStore/serviceCalendar.js:685+` builds day objects that do NOT include `dayType`/`opponent`/`gameTime`/`is_doubleheader`. `monthSheet.js:208` reads `d.dayType` which is always `undefined`; `homestandByDate` never populates for schedule accounts. | Section D.3 (`loadMonthData` return shape); Section G (`CIN-OH_Month_2026-07.pdf` blank) | Extend `loadMonthPrintData` to query `sc_homestand_schedule` directly for `has_homestand_schedule = true` accounts (mirror of the existing `loadScheduleOverlay` call the code already makes for `has_schedule_overlay`). | Confirm: fix at the print loader (isolated, low blast) or fix at the shared `loadMonthData` (broader, but corrects any other consumer). Kevin picks. |
| **2** | MiLB / AAA month has state fills but zero games | Same root cause as #1 - `homestandByDate` never populates for AAA accounts because they route through `has_homestand_schedule`, not the overlay flag. | Section D.3; Section G (`CIN-KY_Month_2026-07.pdf` states + zero games) | Same fix as #1 - the `loadHomestandContext` path (already exists in the app) needs to feed `homestandByDate` for the AAA variant too. | Same as #1. |
| **3** | PDF - season schedule menu item never appears for MLB / AAA schedule accounts on overview | `src/app/api/service-calendar/route.js:446-458` builds `responsePayload.account` and emits `hasScheduleOverlay: hasScheduleOverlayFlag` but silently omits `hasHomestandSchedule: hasHomestandScheduleFlag`. Overlay accounts get the item; homestand accounts never do. | Section E (sc-load payload); Section G (item present for STL - FL, absent for CIN - OH) | Add `hasHomestandSchedule: hasHomestandScheduleFlag` to the `account` object in the route's response payload. | None - one-line server addition. |
| **4** | TBJ - FL green dies after early July (also affects STL - FL period + every ops calendar for future dates) | `resolveDayState()` in `src/lib/print/assets.js:186` falls through to `day.hasProjection && !day.hasActuals` for `"future"` status. Neither `loadMonthData` nor `loadYearSummary` propagates those flags to the day level (Section C, D.4). Both undefined → falsy → returns `null` → cell renders blank instead of PROJECTED. | Section C (TBJ - FL Jul 15 / Aug 1 / Sep 1 with services carrying projected counts but `hasProjection = undefined` at day level); Section D.4 (`loadYearSummary` flag counts across year = 0); Section G (`STL-FL_Period_P8.pdf` blank from Jul 13 forward) | Either (a) extend `loadMonthData` + `loadYearSummary` to emit day-level `hasActuals`/`hasProjection` (mirrors `sc_daily_revenue.has_actuals` / `.has_projection` view fields that ALREADY exist per-service), OR (b) change `resolveDayState` to accept the day's `services` array and compute `hasProjection` inline. | Kevin picks (a) or (b). Also: does "future date with `projected_count > 0` on ANY service" = PROJECTED, or must every service carry a projection? (Recommendation: any-service is enough - the compliance signal is "did we plan this day.") |

---

## Guardrails observed

- **Read-only against the DB**: every probe was `select` only; no writes, no schema changes.
- **Read-only against the codebase**: no `.js` files modified; only the census doc + probe script committed.
- No fixes attempted. The corrective brief lands after Kevin's design-side realignment.
- No merge.
