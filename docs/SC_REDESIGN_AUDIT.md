# SC Redesign - W0 Audit

W0 of the SC Redesign Program. Findings that gate W1 (foundations) and shape
W2-W9 slicing. Read-only pass. No production code changes in this PR.

**Note**: this file replaces a prior scope-audit for an earlier redesign
attempt (referenced `SC_REDESIGN_SPEC.md` / `SC_REDESIGN_PLAN.md`, both
never committed). The prior version is preserved in git history.

**Program scope**: [`SC_REDESIGN_PROGRAM_SCOPE.md`](SC_REDESIGN_PROGRAM_SCOPE.md).
**Entry v2 scope**: [`SC_ENTRY_V2_SCOPE.md`](SC_ENTRY_V2_SCOPE.md).
**Visual intent** (raw hex, prototype shortcuts by design, not a code source):
[`design/sc-v2/SC_FullApp_Redesign_v2.html`](design/sc-v2/SC_FullApp_Redesign_v2.html),
[`design/sc-v2/SC_LiveBill_v4.html`](design/sc-v2/SC_LiveBill_v4.html).

Standing law: production is built from `src/app/tokens.css` semantic tokens
and the existing `season/` atoms. Render HTMLs are look-only. Nothing here
copies their CSS.

---

## Q1. ServiceCalendar.js ownership map (2,572 lines)

`src/app/service-calendar/ServiceCalendar.js` is the state hub - it fetches,
routes, saves, and hosts every drill overlay. Sections in order of appearance:

| Lines      | Responsibility                                  | Owns state / handlers                                         |
|------------|--------------------------------------------------|---------------------------------------------------------------|
| 1-83       | Imports, `monthsBetween`, `buildScUrl`, CAT_ORDER| Pure helpers, URL builder                                     |
| 85-216     | `aggregateWorkspaceMetrics(days)`                | Period / week subtotals for PeriodWorkspace + SeasonShell    |
| 218-254    | Inline `AccountDropdown` component               | Escape-close useEffect                                        |
| 256-374    | State declarations (~50 useState + refs)         | scope/lens/isAdminView, monthCache, bulkMode, syncingKeys     |
| 408-474    | Mount: accounts + roles fetch                    | `computeInitialView()`, selectedAccount, roleTier             |
| 489-518    | Account switch reset + sc-load (current month)   | data, monthCache invalidation                                 |
| 520-548    | sc-year-summary fetch                            | yearData, periodRanges, yearToday, asOf                       |
| 560-642    | Period + month drill fetch (parallel monthCache) | drillLoadState, partial-error handling                        |
| 649-654    | Period key init (land on today's period)         | periodKey                                                     |
| 673-695    | URL sync (view/period/month, never account)      | scope, lens, periodKey, monthKey, isAdminView                 |
| 709-775    | Floor-role landing redirect (F2)                 | router.push into current period                               |
| 786-935    | Memos: dayMap, syncingDates, priceLookup, periodDays, periodMetrics, periodHomestandMap, monthDays, monthMetrics, phaseTimeline | drill derivations                     |
| 984-1067   | Neighbor prefetch + account-mode classification  | idle-prefetch, hasHomestandSchedule, isFeeAccount             |
| 1089-1272  | Mount ref guard + F3 save-queue driver           | isMountedRef, inFlightControllersRef, replay/kickReplay       |
| 1313-1423  | `handleSave` (day entry)                         | sc-submit-day, surgical monthCache invalidation, toast        |
| 1441-1506  | `handleAddNote`                                  | sc-add-note                                                   |
| 1509-1612  | `handleBulkSave` (custom values)                 | queue on network fail, per-day fanout                         |
| 1615-1681  | `handleBulkConfirm` (match projections)          | fill from `day.projected`                                     |
| 1684-1730  | Bulk UI wiring, day-overlay guards, focus dialogs| toggleBulkSelect, navDay, useDialogA11y x4                    |
| 1735-1780  | Year banner stats memo                           | needsEntry / overdue / meals YTD counts                       |
| 1788-1818  | Jump targets (first overdue / needs-entry)       | handleJumpToNeeds, handleJumpToOverdue                        |
| 1826-1901  | View toggles + nav handlers                      | handleAdminToggle, period/month prev/next, today jump         |
| 1903-1956  | Nav bool derivations + AccountDropdown JSX       | canPrev/NextPeriod, month clamps                              |
| 1958-2008  | Hero section render                              | hero image, admin toggle button, AsOf pill                    |
| 2009-2110  | ChromeBar + StickyContext + body wrapper         | account picker, season-view toggle, export, drill nav         |
| 2111-2152  | SeasonShell render (year overview)               | isYearView branch                                             |
| 2155-2196  | PeriodWorkspace render (period drill)            | isPeriodView branch                                           |
| 2204-2238  | PeriodWorkspace render (month drill)             | isMonthView branch, reuses same component                     |
| 2246-2268  | StateLegend + AdminPanel render                  | conditional bottom band; isAdminView in-page view             |
| 2274-2299  | DayDetail overlay (modal)                        | focusDay + guarded close                                      |
| 2301-2368  | Bulk-entry overlay (custom values)               | multi-service form -> handleBulkSave                          |
| 2374-2460  | Bulk-review overlay (match projections)          | scoreboard -> handleBulkConfirm                               |
| 2469-2567  | Bulk-custom-review overlay (custom totals)       | per-day revenue scoreboard -> handleBulkSave                  |

### Cut-line proposals

Reuse the existing hook idiom (`useDialogA11y`, `useAnimatedNumber`,
`saveQueue.js`). Extract behavior into hooks, not new components - state
stays at the parent for the coupling reasons in the next subsection.

- **W2 ribbon extraction (small)**. `AccountDropdown` component to
  `season/AccountDropdown.js` (~40 lines). JSX site at 1931-1956 becomes a
  one-liner import. Low coupling: reads `accounts`, `selectedAccount`,
  fires onChange.
- **W3-W5 rail surfaces (medium)**. Drill-nav bool derivations
  (`canPrevPeriod`, `canNextPeriod`, `isCurrentPeriod`, month clamps) plus
  the four period/month nav callbacks - move together into
  `useDrillNav({ lens, periodKey, monthKey, periodRanges, router,
  selectedAccount })`. Rail JSX consumes the returned bools + handlers.
- **W6 MLB surface (medium)**. The eight drill derivation memos (810-935)
  move together into `usePeriodDrill({ lens, periodKey, monthKey,
  periodRanges, monthCache })` returning `{ periodDays, periodMetrics,
  periodHomestandMap, periodScheduleOverlay, monthDays, monthMetrics,
  monthHomestandMap, monthScheduleOverlay, phaseTimeline, springDateSet }`.
- **W9 final decomposition (large)**. Four hook extractions:
  - `useScData(selectedAccount, scope, lens, ...)` covers 408-642, 984-1032,
    944-960. Owns `data`, `yearData`, `monthCache`, `periodRanges`,
    `drillLoadState`, `yearLoadState`, `asOf`, prefetch.
  - `useScRouting(searchParams, roleContext)` covers 673-775. Returns
    `{ scope, lens, periodKey, monthKey, isAdminView }`.
  - `useScSaveQueue()` covers 1089-1272. Returns
    `{ syncingKeys, refreshSyncing, kickReplay }`. Natural fit -
    `saveQueue.js` already exists as a companion module.
  - `useScSaveHandlers({ data, dayMap, activeDrillDays, ... })` covers
    1313-1681. Returns the four save callbacks.

The four bulk overlays (2301-2567) are ~270 lines of JSX with heavy state
reads. Keep in-file for W9 - moving requires either prop-drilling every
bulk state or introducing a BulkModeProvider context, which is out of
scope.

### Post-W9 target

Realistic landing: **1,400-1,700 lines** with the extractions above. The
scope doc's "under ~800" is aspirational - achieving it requires lifting
the bulk overlays and the three view-branch JSX blocks (SeasonShell,
PeriodWorkspace x2) into their own compositional wrappers, which
duplicates prop threading without simplifying the state graph. Kevin
should decide at W9 whether the additional structural churn is worth it;
1,400 is the honest floor without a bulk-state context refactor.

### Cross-file coupling (why children can't just move)

- **PeriodWorkspace** (2,155-2,238) consumes bulk state (`bulkMode`,
  `bulkSelected`, five bulk callbacks). Lifting the grid out of
  ServiceCalendar requires either a BulkModeProvider or eleven props.
- **DayDetail** (2,274-2,299) is a modal; focusDay + guarded close must
  stay at the host for keyboard nav and unsaved-changes guard.
- **DaySquare** consumes `syncingDates` (per-account filtered save queue).
  Rendered inside PeriodWorkspace; the queue lives at ServiceCalendar. F3
  driver has to stay above both.
- **ChromeBar** consumes yearBannerStats + drill-nav handlers. Fine to
  split its subcomponents (PeriodHeaderNav, MonthHeaderNav already are)
  but the top-level ChromeBar stays a prop-thread target.

---

## Q2. Stranded branch disposition

Two branches remain on the remote with `feat/sc-*-redesign` prefixes.
Neither is on `main`; both need a call.

### `feat/sc-month-view-redesign`

- **Head**: `a6f7aee` (merge of main into branch).
- **Substance commit**: `cd5f028` "sc month view redesign: density + pace +
  unified colors + inline legend".
- **Divergence**: 612 commits ahead of main, 0 behind. The "ahead" count
  is inflated by the two `Merge pull request` commits (#198, #200)
  brought in by the last merge-main - the actual new work is one commit.
- **Verdict**: **superseded**. The month view now renders through
  `PeriodWorkspace` in month mode (ServiceCalendar.js:2204-2238), which
  was built after this branch. Any density / legend polish landed via
  later PRs (the season/legendItems + StateLegend systems are live).
  Recommend delete after Kevin cross-checks that no unique idea in
  `cd5f028` is worth cherry-picking.

### `feat/sc-redesign-stage2-period-view`

- **Head**: `d6c4f1f` (merge of `feat/sc-redesign-stage3-period-workspace`,
  PR #269).
- **Substance commits**: `97fa51e` (stage 1: SeasonShell + calendar grid),
  `7e86265` (stage 2: real strip + period grid + FullSeasonCard),
  `73cd266` (stage 3: period workspace).
- **Divergence**: 442 commits ahead of main, 1 behind.
- **Verdict**: **already live via later PRs**. Every artifact on this
  branch is present in `src/app/service-calendar/season/` at the current
  HEAD - SeasonShell, PhaseStrip, MonthCard, PeriodCard, PeriodWorkspace,
  FullSeasonCard. The "1 behind" tells us main has moved past whatever
  was on this branch, not the reverse. Recommend delete.

Both branch deletions are one-line `git push origin --delete` operations
Kevin should do himself (mutating shared state; W0 is read-only).

---

## Q3. Season-summary payload shape

Endpoint: `sc-year-summary` in `src/app/api/service-calendar/route.js:490-525`.
Loader: `loadYearSummaryPostgres` in
`src/lib/dataStore/serviceCalendar.js` (returns `{ year, months, today,
periodRanges }` at line 1396).

Response body (JSON):

```
{
  success: true,
  accountKey,
  today:        { date, period, week },
  periodRanges: [{ period, start, end }, ...],
  months: [{
    month:                "YYYY-MM",
    period:               "",          // Sheets vestige, always empty
    camp:                 "",          // Sheets vestige, always empty
    totalDays, daysWithActuals,
    projectedRevenue, actualRevenue,
    projectedCovers,  actualCovers,
    days: [{
      date, status, gameType, actualMeals,
      hasNoteEntries, hasActuals, hasProjection,
      // conditional (fee accounts with homestand schedule):
      homestandId, dayType, opponent, dayNight, gameTime, isDoubleheader,
      // conditional (overlay accounts):
      hasScheduleGame
    }],
    homestandSummary?                    // fee accounts only
  }]
}
```

Consumers:

- **SeasonShell** (season/SeasonShell.js): passes `months` down; reads
  `periodRanges` for period bucketing.
- **MonthCard** (season/MonthCard.js): consumes `days[]`,
  `projectedRevenue`, `actualRevenue`, `projectedCovers`, `actualCovers`,
  `homestandSummary`. Ignores `month.period`, `camp`, `totalDays`,
  `daysWithActuals` (all derived from `days[]` via `dayPredicates.js`
  instead - Sheets vestige fields).
- **PeriodCard** (season/PeriodCard.js): computes per-period metrics from
  `days[]` at line 204-217, does NOT read month aggregates.
- **FullSeasonCard**: sums `actualRevenue` / `projectedRevenue` across
  months; consumes `homestandSummary.gameDays` /
  `homestandSummary.gameDaysEntered` for fee accounts.

Extension surface for the redesign:

- **Safe to add per-day fields** (e.g. `phase`, `noteCount`,
  `deliveryWindow`) - `days[]` is read as opaque records by MonthCard
  daysMap + PeriodCard bucketing.
- **Safe to add month-level aggregates** (e.g. `weeklySums`) - all
  consumers use `|| 0` defensive guards.
- **Not safe to remove**: `status`, `hasActuals`, `hasProjection`,
  `homestandId`, `dayType`, `homestandSummary.gameDays` /
  `.gameDaysEntered` / `.homestandIds`. Every one has a hard consumer.
- **Dead-field cleanup candidate for W9**: `month.period` and `month.camp`
  (empty strings, no consumer). Safe to drop from the payload once
  nothing in the client reads them - grep confirms clean.

---

## Q4. PeriodWorkspace week sums under R13

**Verdict: R13-clean.**

Week sums live in `WeekSubtotals` (season/PeriodWorkspace.js:1013-1088).
They read `weekMetrics[label]` prebuilt by `aggregateWorkspaceMetrics`
(ServiceCalendar.js:85-216). The metrics function accumulates
`day.totals.projectedRevenue` / `day.totals.actualRevenue` per week
(lines 184, 204).

Those `day.totals` values come from `loadMonthDataPostgres` at
`src/lib/dataStore/serviceCalendar.js:856-890`, which rounds each
per-service line to 2dp BEFORE summing into the day total:

```
projectedRevenue += Math.round((s.projectedRevenue || 0) * 100) / 100;
if (s.hasActuals) actualRevenue += Math.round((s.actualRevenue || 0) * 100) / 100;
```

That is the R13 policy applied at the persistence boundary. Every
downstream summation - day tile, period metrics, week card, month card,
DayDetail scoreboard - adds already-rounded penny values. No drift
accumulates. The `round2()` helper in `season/format.js` is the display
guard for anything that crosses the boundary via a different path (e.g.
projection-derived numbers computed client-side); the aggregation path
does not need to re-apply it.

One nuance: `WeekSubtotals` hides itself for `hasHomestandSchedule`
accounts (line 1029, SC-073 owner ruling 2026-07-09). The week grid still
exists in `weekMetrics` (cheap; may resurface for a dashboard) but the
render is intentionally omitted for the 4 MLB-fee accounts. This is
current behavior, not a bug - noting so W4/W5 doesn't accidentally
"restore" it.

---

## Q5. Homestand meal-sum derivation

**Verdict: derived from `days[]` at read time.** The payload never carries
homestand-scoped meal totals - they're computed in `deriveHomestands`
(`season/homestandDerivation.js:46-116`) by bucketing `days[]` on
`homestandId` and summing `actualMeals` per bucket.

Key call sites:

- `season/PeriodCard.js:216`: `homestands = new Set(days.filter(d =>
  d.dayType !== "EXHIBITION" && d.dayType !== "AWAY").map(d =>
  d.homestandId).filter(Boolean))`.
- `season/MonthCard.js:239-245`: reads `monthSummary.homestandSummary`
  (that IS payload-provided; loader-computed alongside `days[]`).
- `season/FullSeasonCard.js:37-59`: consumes `gameDaysEntered`,
  `totalGameDays` from the aggregate `homestandSummary` for the fee band.

Two provenance edges to be aware of at redesign:

- **AWAY rows carry `homestand_id = NULL`** (sc-13, 2026-07-10). The
  `d.homestandId` filter at homestandDerivation.js:51 is load-bearing -
  any redesign summation that walks `days[]` for homestands must
  reproduce that filter.
- **EXH-prefixed homestand IDs** exist for spring training (sc-12,
  2026-07-10). PeriodCard excludes them from the homestand count
  (line 216); MonthCard's `homestandSummary` is built server-side and
  matches that policy per the loader path.

Rail summary components in the v2 render show a "Games:" line - safe to
build from `deriveHomestands(days)` on the client; no schema change
needed, but any new server aggregate should carry the same EXH/AWAY
rules or drift is guaranteed.

---

## Q6. MLB Period mode

**Verdict: exists as a feature-detected variant of the shared Period
view, not a separate mode.**

There is no dedicated `MlbPeriodView` component. What we have:

- `isPeriodView` (ServiceCalendar.js:387) is the sole "period drill"
  routing bool. It's used identically for every account category.
- Inside PeriodWorkspace, three flags fork behavior:
  - `hasHomestandSchedule` (from `data.account.hasHomestandSchedule`) -
    swaps subtitle wording (game-count instead of dollar total), hides
    week subtotals, drives the homestand strip.
  - `isFeeAccount` - swaps units (meals instead of dollars) in a few
    slots.
  - `isMilb` (in legend + LegendInfoPopup) - swaps legend content for
    MiLB day/night rules.
- The MLB fee-account customizations live in PeriodCard.js:204-227
  ("homestand-fee" subtitle branch) and MonthCard.js:388-401 (the fee
  status band).

For the redesign, the "MLB Period mode" is thus a *set of feature-flag
paths inside the shared PeriodWorkspace*, not a peer view. W6's "MLB
surface" work applies to those flag paths - specifically the homestand
rail summary the v2 render implies. No new routing state needed; the
existing feature detection carries the signal.

---

## Q7. Entry-point inventory

URL routes:

- `/service-calendar` (`src/app/service-calendar/page.js`, `layout.js`) -
  the sole SC surface. `force-dynamic` layout for cold deep-link support.
- `/service-calendar/admin`
  (`src/app/service-calendar/admin/page.js:26`) - legacy path, redirects
  to `/service-calendar?view=admin`. In-page admin panel gate at
  `AdminPanel.js:5-6` (isScAdmin).

Query-param contract (inherited by W2-W3):

| Param            | Values                     | Semantics                                                              | Consumer                           |
|------------------|-----------------------------|-----------------------------------------------------------------------|------------------------------------|
| `?account=`      | team_key (`CIN-OH`, ...)    | Selected account. Read once at mount; preserved across `?reset=1`.    | ServiceCalendar.js:66 + reset path |
| `?view=`         | `admin`                     | Toggles AdminPanel in-page. Gated (isScAdmin).                        | ServiceCalendar.js:1841            |
| `?month=`        | `YYYY-MM`                   | Drill-in to month view.                                                | ServiceCalendar.js:688-689         |
| `?period=`       | `P1`...`P13`                | Drill-in to period view. Wins over `?month=` if both set.             | ServiceCalendar.js:680-681         |
| `?reset=`        | `1`                         | Clears drill state; returns to year view. TopNav intercept fires it.  | ServiceCalendar.js:747             |
| `?clientToday=`  | `YYYY-MM-DD`                | Anchors isPast/isLocked on operator's local calendar (not UTC).       | route.js:78-94                     |
| `?day=`          | `YYYY-MM-DD`                | **Added W5.** Drill-only tile-targeting: scrolls the tile into view + adopts it as the roving-focus target so keyboard Enter opens intentionally. NEVER auto-opens DayDetail. Ignored in year view. Cleared by `?reset=1` and on leaving the drill. Introduced for rail queue rows + footer CTAs. | ServiceCalendar.js drill URL-sync effect |

Nav entries:

- `TopNav.js:68` - "Service" icon links to `/service-calendar`. Intercept
  at 429-430: if already on SC, push `?reset=1` instead of navigate.
- `OpsHome.js:191` - Service Calendar card on Ops Home.

**No cross-module deep links exist.** Nothing in People, Playbook, Ops
Home, Directory, News, Vendor, Invoice, or Incidents links directly to a
specific SC period or day. That's redesign-favorable - the URL contract
above is purely internal.

API entries (server actions, no UI):

- `sc-hero` - random hero image.
- `sc-accounts` - list + user default + roles.
- `sc-load` - month data (services, projections, actuals, notes, homestand).
- `sc-year-summary` - Q3 payload.
- `sc-submit-day`, `sc-add-note`, `sc-bulk-submit` - writes.
- `sc-config-update`, `sc-admin-fee-set`, `sc-admin-archive-*`,
  `sc-admin-reactivate-*`, `sc-admin-add-*` - admin writes.
- `/api/service-calendar/print` - PDF month/year print.
- `/api/service-calendar/export` - XLSX export.

---

## Q8. Dead-CSS map

Twelve stylesheets total, 5,919 lines. Grep of every declared class
against `src/app/service-calendar/**/*.{js,jsx}` yields the following
dead-class counts. "Dead" = declared, never applied via `className=` or
its template-string equivalents.

| Stylesheet                       | Lines | Dead classes | Dead % | Recommendation                                 |
|----------------------------------|-------|--------------|--------|------------------------------------------------|
| `stateLegend.css`                |   271 |           10 |    38% | **Delete first.** Highest ratio; small file.   |
| `seasonStepper.css`              |   194 |           13 |    30% | Delete after `SeasonStepper.js` cross-check.   |
| `DaySquare.css`                  |   893 |           29 |    25% | Delete the `--state-*` and `--badge-*` families that classifyDayStatus stopped emitting. |
| `ops-sc.css`                     |   439 |           13 |    22% | Delete `.oh-sc-coming-*` splash + `.sc-cat--*` legacy header.|
| `season.css`                     | 1,003 |           32 |    21% | Audit `.sc-season-banner*` family (banner refactored out).|
| `dayDetail.css`                  | 1,272 |           23 |    11% | Spot-remove; low priority.                     |
| `periodWorkspace.css`            |   767 |            4 |     4% | Keep.                                          |
| `chromeBar.css`                  |   429 |            0 |     0% | Keep.                                          |
| `legendInfoPopup.css`            |   237 |            0 |     0% | Keep.                                          |
| `exportControl.css`              |   181 |            0 |     0% | Keep.                                          |
| `submissionToast.css`            |   150 |            0 |     0% | Keep.                                          |
| `stickyContext.css`              |    83 |            0 |     0% | Keep.                                          |

**Total dead**: ~124 classes, ~5-8% of aggregate CSS. Not the win I
hoped for as a pre-cut - most SC CSS is genuinely in use. But there's a
clean batch worth taking as a W1 warm-up (stateLegend + seasonStepper +
the `--state-*` families in DaySquare + `.oh-sc-coming-*` + the retired
banner family in season.css). ~80 classes deletable without risk.

**No `.scv2` scaffolding exists yet** - `grep -rn "sc-v2\|SC_V2\|.scv2"
src/` returns nothing. The `.scv2` root-class strategy from the scope doc
is not started; W1 will introduce it fresh.

---

## Q9. Hero-section dependencies

Hero is small and self-contained. Lines 1958-2008 in ServiceCalendar.js.

Dependencies (all reads, no writes):

- `heroImage` state, loaded once at mount via `sc-hero` action
  (route.js:305-330). Random pick from the SC image pool.
- `firstName` from the auth session (welcome subtitle).
- `isAdmin` (roleTier bool) - gates the admin toggle button.
- `isAdminView` - flips the button icon between "lock" (enter admin)
  and "back arrow" (leave admin) so the operator always has an exit.
- `handleAdminToggle` (ServiceCalendar.js:1841) - the URL push for
  `?view=admin` on and off.
- `asOf` timestamp + `handleRefresh` - the freshness pill in the
  bottom-right corner, styled with `.sc-hero-asof` modifier over the
  base `.sc-chrome-bar-asof` class.

**Redesign implications**:

- The hero is the natural site for the v2 command bar (`.cmd` in the
  render). Moving admin toggle + AsOf into a redesigned band is safe -
  both are already local reads.
- `sc-hero` fetch is one-shot at mount; the redesign can keep, replace
  with a static asset, or drop entirely without touching anything else.
- No hero code reads drill state (`lens`, `periodKey`, `monthKey`) - the
  hero can be replaced in isolation before any drill work starts.

---

## Q10. Other things that stood out

- **Bulk state weight**. 56 references to bulk state in ServiceCalendar.js
  (bulkMode, bulkSelected, bulkValues, bulkPanelOpen, bulkReviewOpen,
  bulkCustomReviewOpen + the handlers). That's ~10% of the file's
  identifier surface tied to bulk. Any real slim-down of ServiceCalendar
  either lifts bulk to a provider or accepts that the four overlays stay.
- **State reset breadth on account switch** (lines 489-505). Six caches
  cleared at once, plus `inFlightControllersRef.abort()`. Simple and
  correct today, but if W9 splits fetches into a hook, that hook has to
  own the same abort semantics or the switch race returns.
- **Payload vestige fields**. `month.period` (empty string) and
  `month.camp` (empty string) are Sheets migration leftovers - no
  consumer. Trivial cleanup in the loader plus payload shape.
- **`clientToday` param is load-bearing**. `?clientToday=YYYY-MM-DD` is
  sent on both sc-load and sc-year-summary to anchor isPast/isLocked on
  the operator's local calendar. Any redesigned data-fetch layer must
  preserve it or overnight boundaries will misclassify.

---

## Baselines

### JS line counts (SC surface)

`src/app/service-calendar/`:

| File                       | Lines |
|----------------------------|-------|
| ServiceCalendar.js         | 2,572 |
| DayDetail.js               | 1,573 |
| DaySquare.js               |   761 |
| Icons.js                   |   210 |
| computeInitialView.js      |   160 |
| dayResolvers.js            |   152 |
| gameTimeFormat.js          |    84 |
| page.js                    |   167 |
| layout.js                  |    46 |
| saveQueue.js               |   197 |
| useAnimatedNumber.js       |    68 |
| useDialogA11y.js           |   109 |

`src/app/service-calendar/season/`:

| File                       | Lines |
|----------------------------|-------|
| PeriodWorkspace.js         | 1,191 |
| MonthCard.js               |   532 |
| PeriodCard.js              |   390 |
| ExportControl.js           |   359 |
| SeasonShell.js             |   323 |
| LegendInfoPopup.js         |   308 |
| ChromeBar.js               |   280 |
| phaseDerivation.js         |   261 |
| PeriodHeaderNav.js         |   237 |
| PhaseStrip.js              |   233 |
| legendItems.js             |   196 |
| phaseCalendar.js           |   188 |
| SeasonStepper.js           |   183 |
| FullSeasonCard.js          |   176 |
| homestandDerivation.js     |   154 |
| StateLegend.js             |   124 |
| MonthHeaderNav.js          |   119 |
| StickyContext.js           |   114 |
| dayPredicates.js           |    86 |
| SubmissionToast.js         |    83 |
| submissionMessages.js      |    67 |
| format.js                  |    59 |
| mlbSeasonPhase.js          |    57 |
| ProgressBar.js             |    43 |

**JS total (SC surface)**: 11,862 lines.

### CSS line counts

| File                              | Lines |
|-----------------------------------|-------|
| dayDetail.css                     | 1,272 |
| season.css                        | 1,003 |
| DaySquare.css                     |   893 |
| periodWorkspace.css               |   767 |
| ops-sc.css                        |   439 |
| chromeBar.css                     |   429 |
| stateLegend.css                   |   271 |
| legendInfoPopup.css               |   237 |
| seasonStepper.css                 |   194 |
| exportControl.css                 |   181 |
| submissionToast.css               |   150 |
| stickyContext.css                 |    83 |

**CSS total (SC surface)**: 5,919 lines.

**Aggregate SC surface (JS + CSS)**: 17,781 lines.

### WCAG AA math for the v2 navy-rail palette

All computed from the v2 render's `--navy-rail:#15273c` background and
associated text/border colors. Ratio formula per WCAG 2.1 §1.4.3;
threshold 4.5:1 for regular text, 3.0:1 for AA-large (18pt or 14pt bold),
7.0:1 for AAA.

| Pair                                                       | Ratio  | Result             |
|------------------------------------------------------------|--------|--------------------|
| rail bg `#15273c` vs body text `#e8edf3`                    | 12.86  | AAA                |
| rail bg `#15273c` vs total `#eafff2`                        | 14.48  | AAA                |
| rail bg `#15273c` vs list-name `#c9d7e8`                    | 10.36  | AAA                |
| rail bg `#15273c` vs qrow title `#d5e0ee`                   | 11.34  | AAA                |
| rail bg `#15273c` vs ln.att `#f2d49a`                       | 10.57  | AAA                |
| rail bg `#15273c` vs meta `#8fa4bd`                         |  5.92  | AA                 |
| rail bg `#15273c` vs muted label `#7f95af`                  |  4.92  | AA                 |
| rail bg `#15273c` vs `.rsec` section `#6f88a5`              |  4.14  | AA-large only      |
| rail bg `#15273c` vs `.ln.gh` ghost meta `#5f7ea3`          |  3.60  | AA-large only      |
| rail bg `#15273c` vs `.rbtn.quiet` border `#2c4867`         |  1.61  | FAIL (non-text ok) |
| cmd navy `#1a3050` vs white `#ffffff`                        | 13.27  | AAA                |
| cmd navy `#1a3050` vs seg-inactive `#c8d4e2`                 |  8.83  | AAA                |
| cmd navy `#1a3050` vs cmeta `#b7c4d4`                        |  7.49  | AAA                |
| cmd navy `#1a3050` vs cpill `#eef2f7`                        | 11.80  | AAA                |
| green-bright `#37a866` vs btn text `#04220f`                 |  5.61  | AA                 |
| cream `#f7f3ea` vs navy-deep `#122238` body ink              | 14.46  | AAA                |
| card `#ffffff` vs navy-deep `#122238` (month-card headers)   | 16.01  | AAA                |

**Verdict**: navy-rail palette is contrast-safe for text. Two flags
carry into W1 semantic-token mapping:

1. `.rsec` uppercase section headers at `#6f88a5` are 10-11px in the
   render - too small to qualify for AA-large. Bump one step brighter
   (say `#88a0bd`) or accept as design intent for a secondary label
   with icon/bg backup.
2. `.ln.gh` ghost meta at `#5f7ea3` is intentionally faint (placeholder
   projected data). If the pattern survives the redesign, gate it on
   `prefers-contrast: more` for the accessibility case; otherwise
   audit whether the ghosted state remains part of the v2 language.

Non-text pairs (borders, dividers, decorative gradients) are exempt from
AA text-contrast rules.

---

## Q8 correction (post-W1, 2026-07-18)

W1 (PR #460) landed the first dead-CSS deletion pass. At deletion time,
grep-verifying producers against JSX exposed a methodology flaw in the
Q8 table above: the dead-class scan was built on a static-string grep
that did not cover template-literal class construction. The `sc-{block}
--${var}` pattern is used liberally throughout the SC surface, so any
class whose modifier is produced by an iteration or a `type`/`kind`
prop looked "dead" to the audit scan but is fully live.

Concretely, the following audit "dead" families were verified LIVE at
W1 deletion time and skipped:

- `stateLegend.css` all 10 modifiers - built by
  `` `sc-state-legend-swatch--${mod}` `` at StateLegend.js:120 +
  LegendInfoPopup.js:226.
- `seasonStepper.css` all 13 modifiers - built by
  `--${kind}` / `--${cls}` template literals at SeasonStepper.js:69,
  99, 104, 144.
- `DaySquare.css` `.sc-daysq--{state}` all 10 modifiers - built by
  `` `sc-daysq--${meta.mod}` `` at DaySquare.js:199.
- `DaySquare.css` `.sc-daysq-badge--*` family - built by
  `` `sc-daysq-badge--${meta.mod}` `` at DaySquare.js:286.
- `DaySquare.css` `.sc-daysq-milb-glyph--*` +
  `.sc-daysq-dn-pill--*` - built by `--${type}` at DaySquare.js:662,
  687.
- `ops-sc.css` `.oh-sc-coming-*` - LIVE: it IS the production Coming
  Soon gate (page.js:101-112) rendered for every non-SC_ADMIN user.
- `ops-sc.css` `.sc-cat--*` - built by
  `` `sc-cat--${category.toLowerCase()}` `` at ChromeBar.js:70 + four
  admin editor sites.

**Numeric correction**: the audit's per-file "dead %" and the
"~124 dead classes total" summary above are overstated by roughly 90%.
The single genuinely-dead batch found at W1 deletion time was the
`.sc-season-banner*` family in `season.css` - 10 selectors +
one `@keyframes` block + two media-query overrides, totalling 49
lines. Every other flagged class either has a dynamic producer, a
gating consumer (Coming Soon), or a runtime attribute selector the
static grep did not follow.

**Authoritative record**: PR #460's dead-CSS ledger is authoritative
for W1. Future workstream deletion passes MUST verify producers at
deletion time, per the W1 prompt's "moment of truth" rule - do NOT
trust the Q8 table above as a deletion checklist. It captures the
1:1-name-match subset only.

**Ledger impact on the W9 net-count criterion**: interim workstreams
will harvest little from Q8-style scanning. The bulk of the net-count
comes at W9 when whole v1 blocks (hero, legacy skins, retired
overlays) are deleted as coherent units, not class-by-class from the
existing files. This does not change the exit criterion; it does
change the expected cadence (small quarterly cleanup deltas, then
one large delete at decommission).
