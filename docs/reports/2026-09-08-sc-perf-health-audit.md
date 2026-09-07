# SC PERFORMANCE + HEALTH AUDIT

**2026-09-08 · Report only, no code changed · Scope: `src/app/service-calendar/**`, `src/lib/billing/**`, `src/lib/scWeekFinalize.js`, `src/lib/scReviewState.js`, `src/lib/dataStore/serviceCalendar.js`, SC portions of the api route.**

---

## PART 1 - ACTUAL LOAD PERFORMANCE

### Measurement method

Direct DB probe (`scripts/probes/_probe_sc_load_timing.mjs`) reproduces the exact query shapes route.js fires on cold mount, against real production Supabase via service-role client. N=5 per shape, median reported. **This isolates DB + network cost from Next.js middleware, JSON serialization, and React hydration.** Actual browser-observed wall time will be higher; the delta is the non-DB overhead.

Ran against **TBJ - FL** (per-meal weekly, richest payload). Payload size: 466 rows for the current month, 6,598 rows for the full year.

### Measured server-side query times (median, ms)

| Query | first | median | p95 | Notes |
|---|---:|---:|---:|---|
| `sc-accounts` list | 272 | **93** | 272 | One accounts row per team_key |
| `sc-load` full route (4x Promise.all) | 166 | **124** | 166 | Bounded by the sc_daily_revenue read |
| ├ loadAccountConfig (2 queries) | 153 | 73 | 153 | groups + services |
| ├ sc_daily_revenue (month) | 100 | 100 | 112 | 466 rows, paginated |
| ├ accounts.billing_model | 70 | 56 | 70 | |
| ├ sc_day_note_entries (month) | 54 | 57 | 59 | |
| ├ sc_daily_actuals_history (month) | 70 | 64 | 70 | |
| └ accounts (info by team_key) | 59 | 60 | 64 | |
| `sc-year-summary` (main query, full year) | 216 | **216** | 234 | 6,598 rows |
| ├ sc_day_metadata (full year) | 58 | 59 | 71 | |
| └ accounts second-read (route.js:791) | 58 | 54 | 58 | **Extra query — see finding 5** |
| `sc-finalize-states` | 87 | 63 | 87 | weeks + cadence + meta, small |

### Simulated cold-mount wall time (from measurements)

Client sequence per code-read of `ServiceCalendar.js` :720 / :859 / :898 / :937 and `PeriodWorkspace.js` :229:

| Step | What | Time (ms) | Blocks next step? |
|---|---|---:|---|
| 1 | `sc-accounts` | 93 | Yes - sets `selectedAccount` |
| 2 | `sc-load(mk)` + `sc-year-summary` in parallel | 216 | Year-summary usually wins; must land before step 3 (needs `periodRanges`) |
| 3 | `sc-load` per period-month (up to 2, parallel) | 124 | No |
| | `sc-finalize-states` fires alongside step 3 | 63 | Not on critical path |
| | **Simulated server-side wall** | **~433** | |

### Where the 2.5s goes (measured + inferred)

**Measured server-side ceiling: ~433ms** for TBJ - FL cold mount. **The 2.5s Kevin observed in production carries ~2 seconds of non-DB overhead.** Best inference of what that overhead is, in likely order of magnitude:

1. **React hydration + client-side aggregation** — the `yearBannerStats` useMemo at `ServiceCalendar.js:3004` walks all 6,598 year rows on every yearData change; multiplied by rerenders during the account-swap effect chain, this alone can add hundreds of ms.
2. **Vercel Lambda cold start** — infrequently-hit routes cold-start at 200-500ms on Vercel serverless.
3. **NextAuth session hydration** — the `useSession` hook resolves via a network call to `/api/auth/session`, then rerenders; typically 100-300ms end-to-end.
4. **Network + TLS latency** — real users vary; ~50-200ms per round-trip depending on geography.
5. **Multiple render passes** — the account-switch effect chain fires 4 setState in one effect (setData, setYearData, setMonthCache, setPeriodRanges), each triggering renders; React 19's automatic batching helps but does not fully collapse them when they cross an async boundary.

### **Verdict on the 2.5s: mostly not fixable at the query layer.**

- No slow queries. Every action's median is <250ms.
- Server-side parallelism is already used. `Promise.all` at `route.js:481`, `Promise.allSettled` at `ServiceCalendar.js:936`.
- No unbatched N+1 patterns.
- Two duplicate fetches confirmed but neither extends wall time (see findings 3 + 5).

**The measurable fixes save maybe ~100-150ms server-side, ~200ms wall.** The remaining ~2 seconds is the platform (Vercel cold start + React hydration + auth + client compute over 6,598 rows). The largest single lever on the client is aggregating the year-summary payload server-side so the client doesn't walk 6,598 rows on every rerender - but that's a real refactor, not a one-line fix.

**A finding of "this is close to the query-side floor" is honest.** The perceived slowness is dominated by hydration + first-paint, which the loading-unification arc addressed (five states → skeleton → grid). The load did not get faster; it stopped LOOKING glitchy while loading. Kevin's original complaint about "feeling slow" is more about the number of visible state changes than about the wall-time integer.

---

## PART 2 - HEALTH SWEEP

Ten findings, ranked by risk within tier. Each carries a confidence marker.

### FIX (would cause a wrong number or broken flow)

**1. `isInServiceOnDay` predicate duplicated across client and server, with a stale line-number in the sync comment.**

- **Files**: `src/app/service-calendar/DayDetail.js:252` (client) + `src/app/api/service-calendar/route.js:2984` (server).
- **Evidence**: Both files define the predicate independently. Comment at `DayDetail.js:250` reads `Server-side mirror at src/app/api/service-calendar/route.js:2475-2478 must stay in sync` — the actual server location is 2984, so the comment is already lying. Both currently apply the same rule (`dayDate < String(svc.active_until).slice(0, 10)`), so no drift YET, but the language has no link between them.
- **Risk**: Correctness. Someone updates the client rule (e.g. relaxes the strict `<` to `<=`) and misses the server copy. The predicate gates whether a service is shown as available on a given day - a drift produces a UI that suggests a service can be entered when the server refuses the write (or vice versa: a service that appears grey in the UI but the server accepts the count).
- **Confidence**: **HIGH** (grep-verified both definitions, read both).

### CLEANUP (would confuse the next person to touch it)

**2. Duplicate comment block at `ServiceCalendar.js:1575-1610` — the same 17-line comment appears twice back-to-back.**

- **Evidence**: Lines 1575-1592 and 1593-1610 are identical text (both my PR #1050 gate-fix rationale). Merge artifact — my PR landed while another PR was in flight; the resolution kept both copies of the comment above the same `const isAccountLoading = (...)` assignment.
- **Risk**: Reader confusion. A skim of the file sees the same block twice and wonders what changed.
- **Confidence**: **HIGH** (read both blocks, byte-identical).

**3. Duplicate fetch on cold mount: current calendar month fetched twice.**

- **Files**: `ServiceCalendar.js:859` fetches sc-load for the CURRENT calendar month (stores in `data` state). Then `ServiceCalendar.js:937` fetches sc-load for EVERY month in the current period's range (stores in `monthCache`). If today's calendar month is inside the current period (the usual case), that month is fetched twice.
- **Evidence**: measured ~124ms per sc-load call. Since :937 fires in parallel with sibling period-month fetches (`Promise.allSettled`), the duplicate does NOT extend wall time. But it doubles DB compute + one API round-trip for that month.
- **Risk**: Not a correctness bug — both fetches read the same table. Wasted work. Also the source of the "grid rendered twice with different values" observation in Kevin's original trace: `data` populates from :859 first, then `monthCache[mk]` populates from :937 with the same data seconds later, causing a redundant rerender.
- **Confidence**: **HIGH** (traced code; timing measured).

**4. Dead CSS: `sc-daysq--loading` + its keyframe `scDaySqPulse`.**

- **Files**: `DaySquare.css:416-429` + `DaySquare.css:1029`.
- **Evidence**: The `--loading` modifier is emitted only when `resolveDayStatus(status, "loading")` is called. Every caller of `resolveDayStatus` (three sites: `PeriodCard.js:158`, `PeriodWorkspace.js:1398`, `MonthCard.js:445`) either passes `"failed"` or no loadState — none pass `"loading"`. The keyframe + block + `.scv2` scoped variant + `prefers-reduced-motion` override are all dead.
- **Risk**: None functional. Adds ~15 lines of CSS the bundler serves for no purpose. A future dev sees the class and thinks it's live.
- **Confidence**: **HIGH** (grep-verified every caller of `resolveDayStatus`).

**5. `sc-year-summary` reads the `accounts` table twice per call.**

- **File**: `route.js:791` re-reads `accounts.billing_model + has_homestand_schedule` after `loadYearSummary` already returns — the loader itself reads accounts internally. Route needs the flags for `stripYearRevenue` decision.
- **Evidence**: Direct measurement — the extra query costs 54ms median. `sc-year-summary` is on the critical path (blocks step 3), so this 54ms extends the cold-mount wall time.
- **Risk**: Wasted round-trip on the hottest cold-mount action. Fix would emit the two flags from `loadYearSummary`'s return shape and drop the second query. Modest but on the critical path — saves ~50ms wall.
- **Confidence**: **HIGH** (code-read + measured).

**6. Legacy `weekDays` prop + `legacyMissing` fallback in `WeekFinalizeControl`.**

- **File**: `src/app/service-calendar/v2/billing/WeekFinalizeControl.js:81` accepts a `weekDays` prop with the comment "legacy: array of day records (client-computed). PR-E prefers serverWeekInfo." Lines 144-150 keep a `legacyMissing = useMemo(() => missingDayList(weekDays), [weekDays])` fallback that fires when `serverWeekInfo == null`.
- **Evidence**: `serverWeekInfo` has been server-authoritative since PR-E landed weeks ago. Grep of every WFC mount site (`PeriodWorkspace.js:1312`) shows `serverWeekInfo` is always passed. The fallback path is dead in current usage but the code still evaluates the memoization on every render.
- **Risk**: Reader confusion (two paths for the same question) + drift risk if someone touches only one path. Cleanup would drop `weekDays`, `missingDayList`, `isDayComplete`, `legacyMissing`, `useServer` branching.
- **Confidence**: **MEDIUM** — the fallback IS technically reachable if `serverWeekInfo` ever fetch-fails, and the failsafe was probably deliberate at PR-E. Worth confirming with Kevin whether the failsafe should stay before removing.

**7. Three overlapping `loadState`-ish state variables + one derived `isAccountLoading`.**

- **File**: `ServiceCalendar.js:567 (yearLoadState)`, `:573 (drillLoadState)`, `:599 (loading)`, `:1611 (isAccountLoading)`.
- **Evidence**: Four fields, same domain ("is data ready"), no shared ordering. `loading` is set true by six different effects and set false by the same six's `.finally`. `yearLoadState` and `drillLoadState` are scoped state machines (idle/loading/loaded/failed). `isAccountLoading` is derived. A reader has to hold four concepts to reason about which one gates a given render.
- **Risk**: Extension risk — a future dev adds a fifth. Also a subtle rerender cost — every effect that toggles `loading` triggers a top-level rerender even if `isAccountLoading` doesn't change.
- **Confidence**: **MEDIUM** — this is a legitimate refactor candidate but "confuse the next person" is the honest tier; nothing wrong TODAY.

**8. Comment line-number drift.**

- **File**: `ServiceCalendar.js:147-148` — comment says "see wiring near line ~1740" but the actual `setSelectedAccount` wiring is at line 3245 (grep-verified).
- Related: `DayDetail.js:250` comment cites `route.js:2475-2478` for the isInServiceOnDay mirror; actual location is `:2984`.
- **Risk**: Reader misdirection. Small on its own, but Kevin's prompt specifically flagged this class of issue and I found two instances.
- **Confidence**: **HIGH** (grep-verified both).

### COSMETIC (note and leave)

**9. Dead keyframe `scSlide` at `dayDetail.css:17`.**

- Defined `@keyframes scSlide { from { opacity: 0; } to { opacity: 1; } }`, no `animation:` property references it anywhere in the codebase. Explore agent already flagged this.
- Confidence: **HIGH**.

**10. Stage 6 "will be deleted" cleanup markers with no tracking mechanism.**

- Files: `DaySquare.css:4`, `season/season.css:4`, `season/periodWorkspace.css:4`.
- Comments state legacy CSS will be "deleted at Stage 6" but there's no issue, milestone, or PR label enforcing it. If Stage 6 shifts, these become permanent debt.
- Confidence: **MEDIUM** — could be intentional deferred cleanup Kevin plans to run in a batch.

---

## What the sweep did NOT find (worth naming)

Kevin's prompt suggested more cruft than showed up. Some honest negatives:

- **No orphaned components** in scope. Every exported component in `src/app/service-calendar/**` is imported and rendered somewhere.
- **No duplicate toast components** (retired `SubmissionToast` / `SaveConfirmation` / `FinalizeToast` are gone; the code has only historical comment references).
- **No duplicate skeleton components in SC** (loading-arc PR 2 confirmed).
- **No obviously wrong migration comments** in `docs/migrations/*.sql` files under scope.
- **No unused imports** flagged by a quick grep sweep of SC top-level files.

Kevin's read that "we probably wrote on top of instead of replacing" is real but modest. The two significant instances are finding 6 (`legacyMissing` fallback that survived PR-E) and finding 7 (three loading flags). The rest is scattered dead CSS + comment drift.

---

## Recommendation on next steps

**No PR without a ruling.** In descending order of return-on-effort, if Kevin wants to trim:

1. **Finding 5** (accounts second-read merge) — ~50ms saved on the critical path, one-file change. Best ROI.
2. **Finding 3** (duplicate current-month fetch) — no wall-time saved but eliminates a rerender + halves DB work. Small file change.
3. **Finding 1** (`isInServiceOnDay` dedup) — move the predicate to a shared module both client and server import. Prevents drift. Modest change, meaningful safety.
4. **Finding 2** (duplicate comment block) — trivial delete.
5. Findings 4, 8, 9, 10 — CSS + comment cleanup, batch into one janitor PR.
6. **Findings 6 + 7** — larger refactors. Not urgent. Worth a design pass before a code change.

**Not recommended:** trying to move the 2.5s wall time floor by more than ~200ms without a real refactor (server-side aggregation of year-summary, or an incremental streaming render). That's a project, not a cleanup, and it's out of scope for the nine-day training runway.
