# SC navigation subsystem - interaction map (2026-07-11)

Purpose: Give the next reader (or the next CC session) a full picture of the nav/URL/state subsystem without archaeology. Baseline for interpreting the Phase 2 log traces.

Scope: `src/app/service-calendar/ServiceCalendar.js` (the only file in the SC subtree that touches `useRouter`, `useSearchParams`, or the routed-view state).

Related surfaces (read-only participants):
- `season/PeriodHeaderNav.js` (host of "< Season", prev/next period, today) - passes clicks up via callbacks; no state of its own.
- `season/MonthHeaderNav.js` (same for month drill).
- `AccountDropdown` (in-file component) - controlled by `selectedAccount`; its onChange dual-pushes.
- `TopNav` (elsewhere) - clicks "Service Calendar" and pushes `/service-calendar?reset=1` to signal "fresh-land".

## State inventory (what can change routed view)

| Piece                  | Owner                          | Written by                                                                 |
|------------------------|--------------------------------|----------------------------------------------------------------------------|
| `scope`                | `useState`                     | URL-sync effect only                                                       |
| `lens`                 | `useState`                     | URL-sync effect only                                                       |
| `isAdminView`          | `useState`                     | URL-sync effect only                                                       |
| `periodKey`            | `useState`                     | URL-sync effect + `periodKey`-validity reset effect                        |
| `monthKey`             | `useState`                     | URL-sync effect only                                                       |
| `selectedAccount`      | `useState`                     | accounts-init effect (mount) + AccountDropdown onChange (direct setState)  |
| `floorRedirectDone`    | `useRef`                       | F2 landing effect (latch + clear on `?reset=1`)                            |
| `accounts`             | `useState`                     | accounts-init effect only                                                  |
| `rawRoles`             | `useState`                     | accounts-init effect only                                                  |
| `hasHomeAccount`       | `useState`                     | accounts-init effect only                                                  |
| `roleTier`             | `useState`                     | accounts-init effect only                                                  |
| `periodRanges`         | `useState`                     | year-summary fetch (dep-driven)                                            |

Derived (per-render):
- `isYearView   = !isAdminView && scope==='year'   && (lens==='calendar' || lens==='period')`
- `isPeriodView = !isAdminView && scope==='period' && lens==='period'`
- `isMonthView  = !isAdminView && scope==='month'  && lens==='calendar'`
- `isAdmin      = isScAdmin(session?.user?.email)` (from session hook)
- `hasHomestandSchedule = !!data?.homestandMap`
- `drillPeriodIdx = periodRanges?.findIndex(r => r.period === periodKey) ?? -1`
- `canPrevPeriod = drillPeriodIdx > 0`
- `canNextPeriod = drillPeriodIdx >= 0 && drillPeriodIdx < (periodRanges?.length ?? 0) - 1`

## Effects (fire order, deps, reads, writes)

### E-accounts-init  (line 394-460)
- Deps: `[showToast]` (stable). Fires ONCE per mount.
- Reads: `?account=` from URL (mount-time snapshot only; not a dep).
- Writes: `accounts`, `selectedAccount` (first time), `roleTier`, `rawRoles`, `hasHomeAccount`.
- Fallback chain for initial `selectedAccount`: `[?account, defaultAccount, "CIN - AZ"]`, filtered by "in the loaded account list."

### E-account-reset  (line 475-491)
- Deps: `[selectedAccount]`.
- Fires on every account change (including the first set from init).
- Writes: `data=null`, `yearData=null`, `yearToday=null`, `monthCache={}`, `periodRanges=null`, `partialError=null`, `drillLoadState="idle"`.
- Does NOT clear `periodKey` / `monthKey` - those live in the URL.

### E-month-fetch  (line 494-504)
- Deps: `[selectedAccount, mk, showToast, reloadKey, today]`.
- Guard: `!selectedAccount`.
- Fetches `sc-load` for the calendar month `mk` (always current month).
- Writes: `data`, `loading`, `focusDay`, `bulkMode`, `bulkSelected`, `bulkPanelOpen`.

### E-year-summary-fetch  (line 506-535)
- Deps: `[scope, lens, isAdminView, selectedAccount, reloadKey, today]`.
- Guard: `needsYearData = isYearView`; `needsPeriodRanges = lens === "period"`. Returns if neither.
- Fetches `sc-year-summary`.
- Writes: `yearLoadState`, `yearData`, `yearToday`, `periodRanges` (this is the source of periodRanges).

### E-period-months-fetch  (line 546-588)
- Deps: `[lens, selectedAccount, periodKey, periodRanges, reloadKey, today, monthCache]`.
- Guard: `lens !== "period" || !selectedAccount || !periodKey || !periodRanges`.
- Fetches missing months for the current period.
- Writes: `monthCache`, `partialError`, `drillLoadState`, `loading`.

### E-month-drill-fetch  (line 596-628)
- Deps: `[isMonthView, selectedAccount, monthKey, reloadKey, today, monthCache]`.
- Guard: `!isMonthView || !selectedAccount || !monthKey`; cache-hit short-circuit.
- Fetches `sc-load` for the drilled month.
- Writes: `monthCache`, `partialError`, `drillLoadState`, `loading`.

### E-periodKey-init  (line 635-640) ← *"periodKey-validity reset effect" in the brief*
- Deps: `[lens, periodRanges, periodKey, today]`.
- Guard: `lens !== "period" || !periodRanges?.length`; also short-circuits if `periodKey` is already a valid entry in periodRanges.
- Writes: `periodKey` (to today's period, or the first period if today is out of range).
- **Behavior on cold-load with `?period=X`**: URL-sync sets `periodKey=X`. This effect then fires. If X IS in `periodRanges`, it short-circuits. If X is NOT (key-format mismatch, e.g. `"1"` vs `"P1"`, or unknown period), it OVERWRITES `periodKey` to today's period. That overwrite does NOT update the URL - it leaves the URL and state disagreeing.

### E-URL-sync  (line 659-681) ← *the pre-#399 shape restored*
- Deps: `[searchParams, isAdmin]`.
- Reads: `?view`, `?period`, `?month` (does NOT read `?account`).
- Writes: `isAdminView`, `scope`, `lens`, `periodKey`, `monthKey`.
- Precedence: `view=admin & isAdmin` → admin ; else `period` → period ; else `month` (YYYY-MM shape) → month ; else → year default.
- **Does NOT read or write `selectedAccount`.** #399 tried to and self-refired.

### E-F2-landing  (line 695-761)
- Deps: `[rawRoles, hasHomeAccount, isAdmin, periodRanges, searchParams, today, router, selectedAccount]`.
- Ref: `floorRedirectDone` (persists across fires within a mount).
- Branches:
  1. `?reset=1` → clear latch, `router.replace` to strip reset param, return.
  2. Latch true → return.
  3. Explicit scope in URL (`view`|`period`|`month`) → latch true, return. **← the audit's suspect (a): explicit-scope path does not clear latch on subsequent URL changes.**
  4. `!periodRanges?.length` → return.
  5. `landing.landOnCurrentPeriod === false` → return.
  6. Compute target period → latch true, `router.replace(?period=target)`.
- **On cold-load with `?period=X`**: branch 3 fires - latch stays TRUE for the entire mount lifetime.

## The 15 push/replace call sites (Phase 1 instrumentation targets)

Named in a form the log traces will use.

| Tag                        | Line   | Kind      | Trigger                                     |
|----------------------------|--------|-----------|---------------------------------------------|
| `F2/reset-strip`           | 736    | replace   | E-F2-landing, `?reset=1` branch             |
| `F2/floor-land`            | 760    | replace   | E-F2-landing, floor default landing         |
| `jumpToDay`                | 1671   | push      | jumpTargets click (needs/overdue)           |
| `adminToggle/off`          | 1695   | push      | handleAdminToggle when leaving admin        |
| `adminToggle/on`           | 1699   | push      | handleAdminToggle when entering admin       |
| `climbToSeason`            | 1711   | push      | `< Season` button                            |
| `prevPeriod`               | 1719   | push      | period stepper `<`                          |
| `nextPeriod`               | 1724   | push      | period stepper `>`                          |
| `todayJump/period`         | 1729   | push      | period Today chip                           |
| `prevMonth`                | 1746   | push      | month stepper `<`                           |
| `nextMonth`                | 1753   | push      | month stepper `>`                           |
| `todayJump/month`          | 1758   | push      | month Today chip                            |
| `dropdown`                 | 1806   | push      | AccountDropdown onChange (dual-push)        |
| `seasonDrill/month`        | 1988   | push      | Season overview → month drill click         |
| `seasonDrill/period`       | 1994   | push      | Season overview → period drill click        |

## Handler guard summary (what could early-return)

| Handler              | Guards                                                                    |
|----------------------|---------------------------------------------------------------------------|
| `handleClimbToSeason`| None (unconditional push)                                                 |
| `handlePrevPeriod`   | `!periodRanges?.length` OR `findIndex(periodKey) <= 0`                    |
| `handleNextPeriod`   | `!periodRanges?.length` OR `findIndex(periodKey) < 0` OR `idx >= last`    |
| `handleTodayJump`    | `!periodRanges?.length` OR no period contains today                       |
| `handlePrevMonth`    | `!monthKey` OR `month <= 1`                                               |
| `handleNextMonth`    | `!monthKey` OR `month >= 12`                                              |
| `handleMonthTodayJump` | `!today`                                                                 |
| `AccountDropdown`    | None (unconditional dual push)                                            |
| `handleAdminToggle`  | None (unconditional push)                                                 |

## Known-bad interaction shapes (Phase 3 suspect ledger)

Each of these is a HYPOTHESIS to confirm or clear with logs, not a diagnosis.

**(H1) Cold-load `?period=X` + key-format mismatch → dead period stepper.**
Cold-load sets `periodKey="X"` before `periodRanges` arrives. Once `periodRanges` arrives, E-periodKey-init may OVERWRITE `periodKey` if `X` doesn't match any `periodRanges[i].period`. Handlers use `findIndex(periodKey)`; if the overwrite lags the click, `idx = -1`, early return. Log evidence: the E-periodKey-init log firing AFTER the handler, with `periodKey` value.

**(H2) Handler stale-closure via memoized nav callbacks.**
The nav handlers depend on `periodKey` / `periodRanges` in their `useCallback` deps. If the parent re-renders between click and effect and passes a stale-closure to PeriodHeaderNav (unlikely in React 19 but possible), the handler reads a stale `periodKey`.

**(H3) `router.push` inert due to identical target URL.**
If a handler builds the same URL as the current one, Next.js router silently no-ops. Cold-load `?account=CIN-KY&period=1` + click `< Season` produces `/service-calendar?account=CIN-KY`. Different from current URL - should update. But if the URL-sync effect wrote periodKey=null in response to a same-tick internal replace we can't see, there could be a race where the URL "looks" cleaned by a state pass but the router history still holds the old URL. Log evidence: `climbToSeason` fires (log), address bar unchanged (Kevin observes), URL-sync effect body does NOT re-fire OR fires with the SAME searchParams.

**(H4) `useSearchParams` reference stability under `router.push`.**
If Next.js 16 returns the SAME `URLSearchParams` reference across a `router.push` in Client Components (a Next quirk seen elsewhere), the URL-sync effect's `[searchParams, isAdmin]` deps miss the change. State never syncs to the new URL. Log evidence: `climbToSeason` push logs, but URL-sync effect body does not log a re-fire OR logs with an unchanged searchParams snapshot.

**(H5) F2 landing effect eats the first clean-URL push same-tick.**
Explicit-scope cold-load latches `floorRedirectDone` on branch 3 (no replace). Later click "< Season" produces a clean URL; F2 re-fires:
- Branch 1: no `?reset=`. Skip.
- Branch 2: latch true, early return.

So F2 should NOT intervene. But if roleTier=floor + hasHomeAccount + landing.landOnCurrentPeriod=true, and if for any reason the latch were cleared (e.g. an interceded `?reset=1` from TopNav that Kevin didn't observe), F2 would `router.replace(?period=today)` right after the push. Log evidence: F2 fires, sees explicit scope=false, computes landing, replaces to `?period=X` right after the click.

**(H6) `router` not stable across renders.**
`useRouter()` in Next.js 16 App Router typically returns a stable object. If it's NOT stable (some patch versions had this), the F2 effect's `router` dep triggers re-fires on every render, and each re-fire re-latches. Not directly the bug but a noise source.

**(H7) Suspense/streaming boundary re-mount.**
If a parent Server Component streams data and re-renders the Client Component around the click time, all state resets to initial (scope="year", periodKey=null, floorRedirectDone.current=false). Handler could see this transient. Log evidence: any state at click-time reads as post-init defaults.

## Architectural verdict (honest)

The subsystem has fundamentally sound bones (one URL-sync + one F2 latch + dual-push dropdown), but it is CARRYING RISK because:

- Two writers own `periodKey` (URL-sync + E-periodKey-init) with no mediation. E-periodKey-init can silently overwrite what the URL wrote, without updating the URL. This is the exact shape of drift Kevin's brief describes ("URL and state disagree").
- The F2 latch is a ref-scoped state machine with 5 branches spread across one effect body. Any new URL surface (a future `?scope=`, a modal deep-link, etc.) needs a hand-audit of every branch to preserve invariants.
- `hasExplicitScope` includes `period` and `month`, so ANY drilled-in URL latches for the mount. That is intentional but couples "F2 must not re-land" with "period stepper must work" - if F2 is stuck in a bad state, the stepper handler sees no upstream effect from clicks.

**Verdict**: Sound for narrow bug fixes (H1-H4 are localized). If Phase 2 logs surface H5 or H7, escalate: at that point the effect web probably needs a single-source-of-truth reducer/controller. Sketch would be: `useReducer` with actions `URL_HYDRATE`, `CLICK_TO_SEASON`, `CLICK_PERIOD`, `CLICK_MONTH`, `DROPDOWN`, `F2_LAND`, `RESET`; the reducer computes the target URL synchronously and the effect fires one `router.replace` from the reducer's output. But that is scope Kevin decides - do not build without approval.

## Phase 2 plan (what the instrumentation produces)

The tagged logs will emit `[SC-NAV]` prefixed records. Each of the 15 push sites logs `{site, target, currentUrl}`. Each effect logs `{name, deps, guard_verdict, branch}`. Nav handlers log `{name, guards, push_reached}`. Kevin captures the console for each matrix cell (E1-E6 × A1-A8). The matrix is then filled row-by-row from the logs:

- Handler fired? → look for `handler:<name>` log
- Guards passed? → guard log
- Push reached? → target log
- Address bar updated? → Kevin observes browser
- URL-sync effect fired? → `effect:url-sync` log
- Landing effect fired? branch? replace? → `effect:F2-landing` log with branch tag
- Final view correct? → Kevin observes

That is what closes Phase 3.
