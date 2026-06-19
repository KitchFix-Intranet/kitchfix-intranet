# Service Calendar - CC Handoff to Next Session

**Author:** CC (the Claude Code agent currently working with Kevin)
**Date:** 2026-06-18
**Audience:** the next CC instance picking up the Service Calendar work.
**Repo:** `/Users/kevinfietek/dev/kitchfix-intranet`
**Active branch:** `fix/sc-p0-cleanup` (PR #193 - 4 commits, not merged)
**Last merged to main:** PR #192 (`docs/dashboard-sc-day-2`) on top of PR #191 color-consistency.

This is a "no surprises" briefing. Read it end to end before touching SC code. Everything that follows is the actual state of the repo as I left it - line numbers checked against HEAD.

---

## 1. The 30-second mental model

The Service Calendar (SC) is the daily meals-served ledger for KitchFix accounts. It runs entirely on Postgres (dev-gated to k.fietek + joe@kitchfix.com). One UI surface handles three account display modes:

| Mode | Accounts | Billing | UI character |
|---|---|---|---|
| **Per-meal (PDC)** | CIN-AZ, TBJ-FL, TBR-FL, TXR-AZ, STL-FL | `actuals_drive_invoice` (or `flat_fee` for STL-FL) | Green-dominant, revenue + urgency, "X of Y entered" + $XXk |
| **MLB fee** | CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V | `flat_fee` + homestand rows | Schedule view, no urgency colors, "X of Y game days" + N homestands |
| **MiLB hybrid** | CIN-KY, TBJ-NY | `actuals_drive_invoice` | Per-meal mechanics + DAY/NIGHT borders + light-green scheduled-game-day dots |

**The three modes share one component** (`ServiceCalendar.js`) and one stylesheet (`ops-sc.css`). The fork is at the CSS layer via `data-billing` + `data-category` attribute selectors. Don't make per-mode forks at the JS layer unless you absolutely have to.

**STL-FL is the trap case.** It's `flat_fee` billing but has zero `sc_homestand_schedule` rows. The fee-display gate is `billingModel === "flat_fee" && !!data?.homestandMap` - the route omits `homestandMap` when it's empty, so STL-FL falls through to per-meal display. Kevin's explicit decision: STL-FL operators are required to use actuals.

---

## 2. File map (line numbers as of HEAD on `fix/sc-p0-cleanup`)

| Path | Lines | Role |
|---|---|---|
| `src/app/service-calendar/page.js` | ~30 | Server wrapper, auth guard, renders `<ServiceCalendar />` |
| `src/app/service-calendar/ServiceCalendar.js` | 1092 | Main client component. Year + Month views, bulk mode, day detail overlay, account dropdown |
| `src/app/service-calendar/DayDetail.js` | 410 | Day overlay (the meals-entry form). Renders inside `sc-overlay-card` |
| `src/app/service-calendar/ServiceConfig.js` | 351 | Admin config drawer (price edits, deactivate, change requests) |
| `src/app/service-calendar/ops-sc.css` | 952 | Sole stylesheet. Base styles + `[data-billing="flat_fee"]` overrides + `[data-category="MiLB"]` overrides |
| `src/app/api/service-calendar/route.js` | 565 | GET (sc-hero, sc-accounts, sc-load, sc-year-summary) + POST (sc-submit-day, sc-bulk-submit, sc-config-update, sc-config-add, sc-config-request, sc-day-override, sc-submit-clickers) |
| `src/lib/dataStore/serviceCalendar.js` | 1186 | Orchestrator. Direct PG queries. No Sheets dual-write (SC was cut over fully in PR #149) |

The page is registered at `/service-calendar`. There's currently no `/service-calendar/admin` separate from the gear-icon-in-header `ServiceConfig` drawer.

---

## 3. Surface-by-surface audit (where each visible UI element renders)

### 3.1 Header (always visible above the year/month grid)

`ServiceCalendar.js:481-540`

- Root: `<div className="sc-root" data-density="compact" data-billing={isFeeAccount ? "flat_fee" : "per_meal"} data-category={data?.account?.category || ""}>` at line 481 - **this is the master attribute scope**.
- Account dropdown: `AccountDropdown` component defined at line 39-79.
- Account-type chip: `sc-cat sc-cat--{category.toLowerCase()}` (pdc/mlb/milb) at line 486.
- Gear button: opens `ServiceConfig` modal. Line 487.
- Mode group (Year / Month / Today): line 491-499.
- Year text input: line 537-539 (just a static `<input>` - the year switcher is a stub).

### 3.2 Year view

`ServiceCalendar.js:773-961` (the `{viewMode === "year" && ...}` block).

| Element | Lines | CSS class |
|---|---|---|
| Outer wrapper | 773-774 | `sc-year-body sc-fade-in` |
| **At-a-glance stats banner** | 778-803 | `sc-year-banner` (added in PR #193 commit 2) |
| **Year grid (12 month cards)** | 805-921 | `sc-year-grid` |
| Single month card | 838-918 | `sc-year-card`, current month gets `sc-year-card--current` |
| Card header (month name + "View →") | 842-845 | `sc-year-card-header`, `sc-year-card-name`, `sc-year-card-cue` |
| DOW header strip | 848-850 | `sc-heatmap-header`, `sc-heatmap-dow` |
| Heatmap dot grid | 853-918 | `sc-heatmap`, `sc-heatmap-row`, `sc-dot--*` |
| Empty-state caption | 923 | `sc-year-card-noservice` ("Off-season" - shared text across all modes) |
| Fee account stats row | 925-928 | `sc-year-card-stats` + "N homestands" right side |
| Per-meal stats row | 936-941 | `sc-year-card-stats` + $XXk right side |
| Progress bar (both modes) | 929-934 / 942-946 | `sc-year-bar` + `sc-year-bar-fill--complete\|--progress` (hidden when `pct === 0`) |
| **Color legend** | 951-959 | `sc-year-legend` (moved BELOW the grid in PR #193 commit 2) |

### 3.3 Month view

`ServiceCalendar.js:541-770` (the `{viewMode === "month" && ...}` block).

- Metrics strip: `sc-metrics`, four `sc-metric` cards. Lines 543-575.
- Calendar grid: `sc-calendar`, `sc-week`, `sc-tile`. Lines 577-720.
- Fee-account tile fork: lines 595-722 has multi-branch logic (active homestand week / prep day / between-homestands / off-day).
- Month footer (sticky bulk-mode bar): lines 727-770.

Bulk-select day toggling is on each tile via `toggleBulkSelect`. The bulk panel overlays in `ServiceCalendar.js:983-1059`.

### 3.4 Day detail overlay

`DayDetail.js` (whole file). Triggered from `ServiceCalendar.js:963-981` when `focusDay && focusDayData`.

Three modes inside DayDetail:
- **Edit form** (default): meals-entry input rows.
- **Review screen** (after save): shows the diff vs projections.
- **Success screen**: confirms write went through (gated by API response per P0-2).

### 3.5 Service config drawer

`ServiceConfig.js` (whole file). Triggered by the gear icon in the header.

- Editable price field per service (uses `editPrices` map keyed by `${groupName}::${serviceName}`).
- Active/Inactive toggle per service.
- Save button persists via `sc-config-update` action (admin-only) or `sc-config-request` action (site lead - non-admin).
- Important: **prices hydrate at line 33** as `String(Number(s.price).toFixed(2))` so the input always shows 2 decimals (fix from PR #193 commit 1).

---

## 4. Three display modes - CSS scoping

**The root attribute carries the fork:**

```jsx
<div className="sc-root" data-density="compact"
     data-billing={isFeeAccount ? "flat_fee" : "per_meal"}
     data-category={data?.account?.category || ""}>
```

That single div opens the doors for two cascades.

### 4.1 `[data-billing="flat_fee"]` overrides

`ops-sc.css:491-771`. Applied ONLY when `isFeeAccount === true` (so STL-FL doesn't trip it).

| Target | Line | Effect |
|---|---|---|
| `.sc-dot--future` | 491-494 | Light-green `#bbf7d0` "scheduled, not yet entered" |
| `.sc-dot--entered` | 495-497 | `#0F6E56` dark green |
| `.sc-dot--prep` | 498-500 | Pale mint `#d1fae5` for PREP/OPEN/CLOSE/CLEAN |
| `.sc-dot--off-season` | 501-503 | Light grey `#f1f5f9` between homestands |
| `.sc-dot--needs-entry / --overdue / --no-service` | 508-511 | Defensive: coerce to scheduled light green (no fee account should have urgency colors) |
| `.sc-dot--home / --away / --day-off` | 517-519 | Box-shadow ring suppressed (homestand structure already encoded in dot color) |
| `.sc-badge--needs / --overdue` | 525-526 | `display: none` |
| `.sc-tile-rev--projected / --future` | 529-530 | `display: none` (no per-meal revenue on flat-fee tiles) |
| Refinement pass (depth) | 535-558 | Bumped saturation + box-shadow lift on dots |
| `.sc-year-card-rev` | 565-568 | Navy `#1e3a8a`, weight 700 (homestand count typography) |
| `.sc-year-bar` | 574-577 | 4px taller track (3px on per-meal) |
| `.sc-year-card-noservice` | 585-591 | Centered "Off-season" layout |
| `.sc-year-card { min-height: 220px }` | 595 | Larger card for the off-season caption to sit at |
| `.sc-year-card` border/hover | 598-608 | Subtle slate border, hover tint |
| `.sc-year-legend` | 613-619 | Top-border, top-padded (because legend now sits BELOW grid) |
| `.sc-legend-dot--off-season` | 635 | The away/off swatch (added in PR #193 commit 4 - the legend chip was rendering blank until this rule landed) |
| Month-view tile variants | 638-768 | Active homestand week / prep / between-homestands / today-pill / footer |

### 4.2 `[data-category="MiLB"]` overrides

`ops-sc.css:783-876`. Applied to CIN-KY and TBJ-NY.

| Target | Line | Effect |
|---|---|---|
| `.sc-tile--no-service / --off-day` | 783-806 | MiLB-specific muting (off-day recess so active homestand week pops) |
| `.sc-dot--home / --away / --day-off` | 816-818 | Game-type ring suppressed (DAY/NIGHT border accent is the schedule signal instead) |
| `.sc-tile--active .sc-tile-meals` | 858-862 | Bumped weight on game-day tiles |
| `.sc-tile-rev--actual / --projected` | 863-868 | Darker green for actual, dark grey for projected |
| `.sc-tile--active .sc-tile-game` | 873-877 | Bolder DAY/NIGHT label + letterspacing |

### 4.3 The shared (no-attribute) cascade

`ops-sc.css:1-489` + `:782-855` (the MiLB / per-meal dot rules).

Key base rules:
- `.sc-dot--upcoming-game` (line 821-824): Light green `#bbf7d0` for MiLB scheduled game days
- `.sc-dot--future-service` (line 833-836): Light green `#bbf7d0` for PDC future days with projection
- `.sc-dot--today` (line 846-850): Navy `#153968` ring via outset box-shadow

All three modes' "scheduled / not yet entered" semantic uses the same `#bbf7d0` swatch. That's the unification from PR #191 + PR #193 commit 2.

---

## 5. Orchestrator (`src/lib/dataStore/serviceCalendar.js`)

### 5.1 Top-level exports

| Line | Export | Purpose |
|---|---|---|
| 254 | `loadAccountConfig(accountKey)` | Service catalog + prices for one account |
| 395 | `loadMonthData(accountKey, year, month)` | Per-day meals/revenue + status for one month |
| 457 | `loadHomestandContext(accountKey, firstDate, lastDate)` | Per-date `{ homestandId, dayType, opponent }` lookup. Empty `{}` if no rows. |
| 757 | `loadYearSummary(accountKey, year)` | 12-month rollup + per-day status for year heatmap |
| 827 | `saveActuals(accountKey, serviceDate, entries, email)` | Upsert touched entries for one day |
| 886 | `saveBulkActuals(accountKey, entries, email)` | Upsert touched entries across multiple days |
| 988 | `updateServiceConfig(accountKey, changes, email)` | Admin: apply price/deactivate/reactivate changes |
| 1119 | `addService(accountKey, ...)` | Admin: add a new service to an account |
| 1184 | `submitConfigRequest(accountKey, request, email)` | Site lead: queue a config change for admin review |

### 5.2 Year summary - return shape

This is the one frontend devs trip on. See `serviceCalendar.js:411-432` for the doc-comment.

```js
{
  year: 2026,
  months: [
    {
      month: "2026-06",
      totalServiceDays: 30,
      daysWithActuals: 18,
      totalProjectedMeals: 4200,
      totalActualMeals: 2860,
      totalProjectedRevenue: 38500,
      totalActualRevenue: 22100,
      revenueVariance: -16400,
      days: [
        { date: "2026-06-01", status: "entered", gameType: "", actualMeals: 240 },
        ...
      ],
      // Only present for flat_fee accounts with homestand data:
      homestandSummary: {
        gameDays: 12,
        gameDaysEntered: 8,
        prepDays: 4,
        homestandIds: ["HS1", "HS2", "HS3"]
      }
    },
    ...
  ]
}
```

**`actualMeals` per day was added in PR #193 commit 3** (orchestrator change at lines 568-578 + 669-674). Year-view dots use it for the hover tooltip "Mon Jun 23 — 240 meals".

### 5.3 The `classify()` function

`serviceCalendar.js:599-653`. Lives inside `loadYearSummaryPostgres`. Decides what status each day gets on the year heatmap.

```
Fee-account branch (line 617-623):
  - billingModel === "flat_fee" && hasHomestandData (the 4 MLB fee accounts)
  - !hs                                                -> "off-season"
  - hs.dayType !== "GAME" (PREP/OPEN/CLOSE/CLEAN)     -> "prep"
  - hs.hasAct                                          -> "entered"
  - else (game day, no actuals)                        -> "future"

Per-meal branch (line 625-652):
  - hasAct && !anyNonZeroAct (operator confirmed all-zero)  -> "no-service"
  - hasAct (operator logged anything > 0)                    -> "entered"
  - !hasAct && hasProj && !anyNonZeroProj                    -> "no-service" (PR #167 - past zero-projection days)
                                                                Gate: only when NOT (flat_fee + hasHomestandData)
                                                                So STL-FL DOES get this branch (gate matches isFeeAccount)
  - isPast && isOverdue                                       -> "overdue"
  - isPast                                                    -> "needs-entry"
  - future                                                    -> "future"
```

The status set the frontend sees: `entered`, `no-service`, `needs-entry`, `overdue`, `future`, `prep`, `off-season`.

The frontend then remaps `"future"` based on context in the dot renderer:
- MiLB + scheduled gameType (DAY/NIGHT) -> `"upcoming-game"` (light green)
- PDC + STL-FL (non-fee per-meal) -> `"future-service"` (light green)

That remap is at `ServiceCalendar.js:912-919`.

### 5.4 `loadMonthData` - return shape

Doc at `serviceCalendar.js:269-296`. Used by the month view + day detail. Returns per-day projection + actuals + status + lock flags. The frontend reads `data.days[]` from this.

### 5.5 `fetchAllPaginated` - the pagination wrapper

`serviceCalendar.js:132-146`. **Important for SC.** Supabase REST defaults to 1000-row pages. PDC accounts can have 13 services × 31 days = 403 rows per month, and a year query is 12 months. The wrapper loops `.range(from, from + PAGE - 1)` until a short page returns. Without this, the year query silently truncated at 1000 rows (PR #159 fix).

---

## 6. Route (`src/app/api/service-calendar/route.js`)

### 6.1 GET actions

| Action | Line | Returns |
|---|---|---|
| `sc-hero` | 202 | KPI tiles for the hub home (count of accounts, etc.) |
| `sc-accounts` | 224 | Account list for dropdown + `defaultAccount` lookup via `user_accounts` table |
| `sc-load` | 245 | Full month payload: account, serviceGroups, days, homestandMap (fee only), accounts |
| `sc-year-summary` | 328 | The `loadYearSummary` output re-keyed (see below) |

### 6.2 POST actions

| Action | Line | Body | Returns |
|---|---|---|---|
| `sc-submit-day` | 397 | `{ accountKey, date, entries: [{ colIndex, value }] }` | `{ success, ... }` |
| `sc-bulk-submit` | 419 | `{ accountKey, entries: [{ colIndex, date, value }] }` | `{ success, savedCount }` |
| `sc-config-update` | 438 | `{ accountKey, changes: [{ type, groupName, serviceName, ... }] }` | `{ success, updated }` (admin-only) |
| `sc-config-add` | 484 | `{ accountKey, groupName, serviceName, price, taxFree, flatFee, nonRevenue }` | `{ success, colIndex }` (admin-only) |
| `sc-config-request` | 517 | `{ accountKey, requestType, ... }` | `{ success }` (site-lead queue) |
| `sc-day-override` | 534 | (stub - not migrated to PG) | `{ success: true }` |
| `sc-submit-clickers` | 545 | (stub - not migrated to PG) | `{ success: true }` |

### 6.3 The year-summary re-key (THE FOOTGUN)

`route.js:343-367`. The route renames orchestrator fields before sending:

```js
months: summary.months.map((m) => ({
  month:            m.month,
  period:           "",
  camp:             "",
  totalDays:        m.totalServiceDays,        // RENAMED
  daysWithActuals:  m.daysWithActuals,
  projectedRevenue: m.totalProjectedRevenue,   // RENAMED
  actualRevenue:    m.totalActualRevenue,      // RENAMED
  projectedCovers:  m.totalProjectedMeals,     // RENAMED
  actualCovers:     m.totalActualMeals,        // RENAMED
  days:             m.days,
  // homestandSummary passes through untouched
}))
```

**Read the response shape (`totalDays`, `actualCovers`) in the frontend, NOT the orchestrator shape.** I tripped on this exact thing in PR #193 commit 2 - the `yearBannerStats` useMemo read `m.totalServiceDays` and rendered "169 of 0 days recorded". Now reads `m.totalDays` + `m.actualCovers`. Comment is at `ServiceCalendar.js:439-443`.

### 6.4 The `sc-load` response shape

`route.js:303-324`:
```js
{
  success: true,
  account: { key, category, name, billingModel, spreadsheetId: "" },
  metaColCount: 4,           // or 5 for PDC
  serviceGroups: [...],
  days: [...],
  overrides: [],
  accounts: [...],
  homestandMap: { ... }      // ONLY present when fee + non-empty
}
```

The `spreadsheetId` field on `account` is a vestigial empty string for legacy parity. **The route's POST handlers ignore `spreadsheetId` and `sheetRow` in the body** (Sheets-era leftovers). All `handleSave`/`handleBulkSave`/`handleConfirmAsProjected` calls drop them now (PR #193 commit 1).

---

## 7. The state machine in `ServiceCalendar.js`

### 7.1 useState declarations

`ServiceCalendar.js:85-102`:
- `accounts` - the dropdown list
- `selectedAccount` - current account key
- `year` (hardcoded 2026), `month`, `viewMode` ("year" or "month")
- `data` - the `sc-load` response (account, serviceGroups, days, homestandMap)
- `yearData` - the months array from `sc-year-summary`
- `loading`, `saving`, `reloadKey`
- `focusDay` - the open day-detail overlay date
- `showConfig` - boolean for ServiceConfig drawer
- `bulkMode`, `bulkSelected` (Set), `bulkPanelOpen`, `bulkValues`

### 7.2 useEffect loads

`ServiceCalendar.js:104-153`:
- 104: Load accounts list on mount via `?action=sc-accounts`. Initializes `selectedAccount` to `defaultAccount` if returned (user_accounts mapping).
- 134: Re-load month data via `?action=sc-load&account=X&month=YYYY-MM` whenever `selectedAccount` / `year` / `month` / `reloadKey` changes.
- 146: Re-load year data via `?action=sc-year-summary&account=X&year=YYYY` whenever `selectedAccount` / `year` / `reloadKey` changes.

### 7.3 Derived gates

**`isFeeAccount`** at `ServiceCalendar.js:187-188`:
```js
const isFeeAccount =
  data?.account?.billingModel === "flat_fee" && !!data?.homestandMap;
```

**`isMilb`** at line 196:
```js
const isMilb = data?.account?.category === "MiLB";
```

**`homestandMap`** at line 189: `data?.homestandMap || {}` - always-defined object for the consumer.

These three gates are declared TOGETHER, ABOVE the useMemo blocks that reference them. JS TDZ bites if you move them - the `feeMetrics` useMemo deps array references `isFeeAccount`. Comment at lines 184-186 explains.

### 7.4 useMemo computations

| useMemo | Line | Inputs | Output |
|---|---|---|---|
| `dayMap` | 155 | `data` | Map keyed by date for O(1) day lookup |
| `priceLookup` | 156 | `data` | Map of `colIndex -> price` |
| `metrics` | 158-172 | `data, priceLookup` | Per-meal monthly totals: projMeals, actMeals, projRev, actRev, complete, needsEntry, overdue, total |
| `feeMetrics` | 201-256 | `isFeeAccount, data, homestandMap` | Fee-monthly metrics: gameDays, gameDaysEntered, currentHomestand, currentHomestandRange, currentHomestandGameDays, currentHomestandGameDaysEntered |
| `weeks` | 405 | `year, month` | Calendar weeks grid for month view |
| `yearBannerStats` | 435-463 | `yearData` | At-a-glance year banner: todayLabel, daysRecorded, totalDays, needsEntry, overdue, mealsYTD, gameDaysEntered, totalGameDays |

`feeMetrics` does double duty - the "currentHomestand" calc identifies the homestand containing today, the nearest upcoming if between homestands, or the last in the month as fallback (lines 235-244).

### 7.5 useCallback handlers

| Callback | Line | Purpose |
|---|---|---|
| `showToast` | (defined in a hook earlier - find it) | Toast notifications |
| `dayStatus` | 258-286 | Frontend `classify()` mirror for month-view tile coloring |
| `daySummary` | 288-296 | Per-day meals + revenue (uses actuals if present, else projections) |
| `handleSave` | 301-323 | Single-day actuals submit. Returns `{ success, error? }` so DayDetail can gate success screen |
| `handleConfirmAsProjected` | 325-337 | "Confirm as projected" button - writes the projections as actuals |
| `handleBulkSave` | 340-376 | Touched-only bulk write across selected days (the P0-1 fix) |
| `handleBulkConfirm` | 378 | (similar) |
| `toggleBulkSelect` | 401 | Add/remove date from `bulkSelected` Set |
| `goToToday` | 408 | Jump to current month + open day-detail for today |
| `navDay` | 414 | Prev/next day inside day-detail overlay |

---

## 8. Bug fixes applied across the SC arc (chronological)

This catalog covers PRs #165 through #193 + branches that were merged. If you see weird code, check whether one of these explains it.

### Engine + data layer
- **PR #149** - Service Calendar PG cutover (route rewire + admin gate + dedupe + import; 5,276 lines). Sheets-era code paths torn out.
- **PR #156** - P0-1 (touched-only save) + P0-2 (await save before success screen).
- **PR #158** - Day status derived from ACTUALS not projections (3 UI surfaces). A day with all-zero projections but real actuals is `entered`, not `no-service`.
- **PR #159** - Per-service active/inactive includes actuals; year-view pagination fix (the `fetchAllPaginated` wrapper); month noService check; payload cleanup.
- **PR #160** - SousAI Drive ingestion retired (Phase A A7) - unrelated to SC but landed same day.
- **PR #165** - Config editor price UPSERT fix (was creating duplicate rows on re-save).
- **PR #167** - Past zero-projection days classify as no-service (per-meal only). Gate: `!(billingModel === "flat_fee" && hasHomestandData)`. Without this, future zero-projection days flipped to `future` and rendered as light-green `upcoming-service` on the year heatmap.

### Fee account display fork
- **PR #168** - `sc_homestand_schedule` PG table + seed (408 rows, 4 MLB accounts).
- **PR #170** - GRANT fix for `sc_homestand_schedule` (service-role couldn't SELECT).
- **PR #172** - Fee-account display fork: homestand-driven UI for the 4 MLB fee accounts.
- **PR #174** - Schedule view tuning (no urgency colors, navy dots, MLB fee polish).
- **STL-FL gate fix** (PR #189) - Frontend `isFeeAccount` and backend `classify()` aligned so STL-FL (flat_fee billing but no homestand rows) gets per-meal zero-projection treatment.
- **Zero-projection future days fix** (PR #188) - As above for future days.

### Year view polish
- **PR #186** - TODAY ring on year heatmap; PDC `upcoming-service` light-green dots; `user_accounts` auto-select on login (31 rows seeded from contacts).
- **PR #191** - Year-view color consistency pass: MiLB upcoming-game unified to MLB navy; empty-state captions standardized to "Off-season"; TODAY ring from amber to brand navy `#153968`; MLB year-card pill styling stripped.
- **MiLB hybrid display** - DAY/NIGHT borders, off-day recession, sky-blue upcoming (later changed to light green in PR #193).

### PR #193 (active branch) - 4 commits

**Commit 1 - `cab3b22`** "price rounding, remove debug text, clean dead payload fields":
- `ServiceConfig.js:33` - prices round to 2 decimals on hydrate: `String(Number(s.price).toFixed(2))`.
- `ServiceConfig.js:294` - removed `Col {svc.colIndex}` debug text (was rendering 36-char UUID under each service name).
- `ServiceCalendar.js:325-337` (`handleConfirmAsProjected`) - dropped dead `spreadsheetId` + `sheetRow` from POST body (matches `handleSave` and `handleBulkSave`).
- Verified out-of-band that `accounts.name` is populated for all 11 SC accounts (CIN-AZ + CIN-OH both = "Cincinnati Reds"). Probe script at `scripts/_probe-sc-account-names.mjs` (untracked).

**Commit 2 - `941ae75`** "year view polish - stats banner, legend to bottom, color unification, typography":
- Stats banner above the grid: `sc-year-banner` div with pipe-separated stats (per-meal/MiLB shape vs fee shape).
- Color legend moved from above the grid to BELOW the grid. Border swapped from bottom to top.
- All three modes' "scheduled / not yet entered" → `#bbf7d0` light green (was navy on MLB + MiLB).
- MLB prep → `#d1fae5` pale mint (was periwinkle `#a5b4fc`).
- Fee defensive coercion + box-shadow tints updated to match green palette.
- `.sc-year-card-name` typography: fixed `14px / weight 800` (was responsive body / 700).
- Progress bar consistency: `--complete` (green) / `--progress` (amber) state classes; fee navy→green gradient dropped.

**Commit 3 - `a75a90f`** "year view review punch list - banner fields, legend, DOW, tooltips, +5":
- Banner field names fixed: `m.totalDays` + `m.actualCovers` (was reading orchestrator names that the route renames).
- MLB legend gained "Away / off" item.
- Progress bar track hidden when `pct === 0` (wrapped in `{pct > 0 && ...}`).
- "HS" → "homestands" with `1 homestand` / `N homestands` pluralization.
- Fee meals label: "meals YTD" → "meals recorded YTD".
- Banner date shortened: "Today: June 18, 2026" → "Today: Jun 18".
- DOW letters: 10px / `#9ca3af` (was 8px / `#d1d5db`).
- Heatmap dot `title=` tooltips. Surfaces `actualMeals` per day from the orchestrator (added to `dayState` aggregation at `serviceCalendar.js:568-578` and to `dayEntry` at line 669-674).
- New `fmtDotDate` helper at `ServiceCalendar.js:42-46`.

**Commit 4 - `37cb5de`** "MLB legend away/off swatch matches the calendar grey":
- Added the missing `.sc-legend-dot--off-season` CSS rule at `ops-sc.css:633-635`. The legend chip from commit 3 was rendering blank because the CSS class had no background rule.

---

## 9. The data-attribute scoping pattern (use this, don't fork the JS)

When you need mode-specific styling, prefer the CSS attribute selector over a JSX `isFeeAccount ? ... : ...` ternary.

```css
/* Default (per-meal): */
.sc-tile-rev { color: #0F6E56; }

/* Fee account override: */
[data-billing="flat_fee"] .sc-tile-rev { display: none; }

/* MiLB override: */
[data-category="MiLB"] .sc-tile-rev--actual { color: #064e3b; font-weight: 700; }
```

This keeps the JSX clean and the diff small. The exception is when the mode needs different DOM elements (e.g., the fee account year card has "N homestands" instead of "$XXk") - then the ternary is correct.

`data-density` is used by ServiceCalendar at the root and on overlay cards (`comfortable` for the day detail) but isn't currently styled to differentiate. It's there for future scaling.

---

## 10. Homestand map integration

`loadHomestandContext` at `serviceCalendar.js:457-478`. Reads `sc_homestand_schedule` PG table (seeded by `scripts/_seed_sc_homestand_schedule.mjs`).

Returns:
```js
{
  "2026-06-15": { homestandId: "HS5", dayType: "GAME",  opponent: "STL" },
  "2026-06-14": { homestandId: "HS5", dayType: "PREP",  opponent: null },
  ...
}
```

`dayType` values: `GAME`, `PREP`, `OPEN`, `CLOSE`, `CLEAN`. Only `GAME` counts toward `gameDaysEntered`.

The route fetches the homestand map for `flat_fee` accounts only and includes it in the `sc-load` response only when it has keys (line 291-301). That empty-skip is what makes the STL-FL fall-through work.

`loadYearSummary` calls `loadHomestandContext` separately for the full-year range when `billingModel === "flat_fee"` (line 524-529), then uses it inside `classify()` to drive the fee-account branch.

---

## 11. What's left (per Kevin's working dashboard)

From `docs/PROJECT_DASHBOARD.md` "next step" list:
- **Close Day button** - one-tap zeros writer for cancelled service days. Not yet built.
- **Full design review of per-meal month/day views** per `docs/DESIGN_REVIEW_PERSONA.md`.
- **Dev gate expansion to operators** - account by account, CIN-AZ first.
- **Re-import right before cutover** to catch Sheets entries during testing.
- **Admin Dashboard** - confirmed deliverable (separate page from the inline `ServiceConfig` drawer).
- **Fun Money Tracker** - confirmed deliverable.
- **Fee schedule table for KPI Dashboard** - stores flat annual amounts for fee accounts.

### My read on what's worth doing next

1. **Banner UX polish (one PR).** The banner I added is one horizontal sentence with pipe separators. Kevin's review mentioned breaking it into proper KPI tiles. Doable in a follow-up PR.
2. **Per-meal future-month opacity decay.** PDC accounts show Aug-Dec as a uniform sea of light green. A `decay` based on distance-from-today would re-introduce hierarchy. Quick CSS calc.
3. **Month view + day detail design review.** Not yet started. Kevin called this out explicitly as next.
4. **Close Day button.** UX is small but the data-layer side needs thought - is it a per-day flag on a new table, or just a `sc-submit-day` with all zeros + a note? Read `serviceCalendar.js` doc-comments at lines 765-799 for saveActuals semantics first.
5. **Admin command center** - the user keeps calling it "OPD Command rebuild" but I think they want a separate SC admin page too. Confirm scope before scaffolding.

---

## 12. Operating-mode reminders for the next CC

- **No em-dashes.** Use hyphens (`-`) in everything you write. Established preference. (See `~/.claude/projects/-Users-kevinfietek/memory/feedback_no_em_dashes.md`.)
- **No silent scope additions.** Flag spec additions BEFORE folding them in. Surface and wait. Kevin built a `feedback_no_silent_scope_additions` memory specifically about this.
- **Branch + PR; Kevin merges.** Don't push to main. Don't deploy. Build verify is required.
- **`.env*` is off-limits.** Never read, never write, never echo.
- **Side project isolation.** Game project at `~/Holtburg/holtburg-hollow/` is OUT of scope. Never reference it.
- **Migrations don't auto-apply on deploy.** SQL in `docs/migrations/` is manual-paste in Supabase Studio + verify probe.
- **Don't touch the Danger Zone files** without explicit approval: `src/lib/sheets.js`, `src/lib/cutover.js`, `src/lib/auth.js`, `src/middleware.js`, `vercel.json`, `next.config.mjs`, `package.json`, anything in `docs/migrations/`.
- **STL-FL is special** - flat_fee billing but per-meal display. Always check `hasHomestandData` gate, not just `billingModel === "flat_fee"`.
- **Account-key canonical format has spaces:** `"CIN - AZ"`, not `"CIN-AZ"`. Same for `"TXR - TX - H"`.

---

## 13. Quick orientation commands

When you first land in this branch:

```bash
git log --oneline -10                  # See the 4 PR #193 commits at top
git status --short                     # Expect lots of untracked _probe / _audit scripts in scripts/
git diff main...HEAD --stat            # Show what this PR changes vs main
npx next build                         # Verify it builds (takes ~60s)
```

Active branch is `fix/sc-p0-cleanup`. PR #193 is open. Don't merge - Kevin merges. Don't deploy.

To pick up where I left off, the smallest next step that adds real value is one of:
- **Banner -> KPI tiles** (cosmetic, low risk, ships fast)
- **Future-month opacity decay on PDC** (single-component change)
- **Month view design review** (read-only, no code)

The bigger arcs (Close Day button, Admin Dashboard, Fee schedule table for KPI dashboard) all need design scoping with Kevin first.

---

## 14. Useful greps

```bash
# Every status value the orchestrator can return:
grep -n "return \"\|s.hasAct\|isPast\|isOverdue" src/lib/dataStore/serviceCalendar.js | head -30

# Every data-billing rule in CSS:
grep -n '\[data-billing' src/app/service-calendar/ops-sc.css

# Every data-category rule in CSS:
grep -n '\[data-category' src/app/service-calendar/ops-sc.css

# Every fetch from the SC route:
grep -n '/api/service-calendar' src/app/service-calendar/*.js

# Find all useMemo / useCallback in the component:
grep -n 'useMemo\|useCallback' src/app/service-calendar/ServiceCalendar.js
```

---

End of handoff. Good luck. Kevin's a strong technical partner - lean on him for decisions, don't guess.
