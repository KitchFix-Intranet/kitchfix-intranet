# SC Status - shipped-state + remaining work

> **Purpose:** the live current-state doc for the Service Calendar module. Architecture reference = [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md). This doc is the ship-state audit + remaining-work punch list.
>
> **Last verified:** 2026-08-01
>
> **Ledger discipline:** every claim in "Shipped" traces to a PR#, commit, or migration file. Every item in "Remaining" says who's blocking it (Kevin ruling / Kevin schedule / no owner). Unknowns stay labeled unknown.
>
> **Build history through M-4b:** [`archive/ENTRY_REDESIGN_MASTER_SCOPE_2026-07-30.md`](archive/ENTRY_REDESIGN_MASTER_SCOPE_2026-07-30.md). This doc is the living record from there on. Rulings that change behaviour land here in the session they are made.

---

## Shipped (last 48 hours: PRs #391 - #413, sc-13 through sc-19)

### Schedule model (the two-flag architecture)

- **sc-13** - AWAY row support on `sc_homestand_schedule` for the 4 MLB accounts + reader wiring. Merged pre-#403.
- **sc-15** - `game_time TIMESTAMPTZ` + `day_night` + `is_doubleheader` columns on `sc_homestand_schedule` + the day/night pill on lg drill-in tiles.
- **sc-16** - `accounts.has_homestand_schedule BOOLEAN` flag + CIN - KY (Louisville Bats, sportId=11) + TBJ - NY (Buffalo Bisons, sportId=11) rows. **Silent-gap incident 2026-07-11**: reader merged before Studio-apply; reverted (#404), relanded (#406) after apply.
- **sc-17** - `accounts.has_schedule_overlay BOOLEAN` flag + STL - FL (Palm Beach Cardinals, sportId=14) 66 HOME rows. Overlay-only, orthogonal to `has_homestand_schedule`.
- **sc-17b** - TBJ - FL (Dunedin Blue Jays, sportId=14) 66 HOME rows on top of sc-17's column. Applied-date: **Kevin to confirm** (state without apply = code-live, data-empty, safe - no user-visible effect).

### Visual system (sc-18, sc-19, design-review 4-in-1)

- **sc-18** (#412) - indigo game-day corner wedge on sm overview tiles (top-right, `#4338CA`, `polygon(0 0, 100% 0, 100% 100%)`). Overlay accounts only. Sm-tile philosophy amended from ONE mark to TWO.
- **sc-19** (#413) - Spring Training styling at three sites: sun-copper wedge on sm tiles (bottom-left, `#C2410C` since 2026-07-12; originally `#8A4A1B`), ST pill on lg drill-in tiles + chrome bar rider (both `#8A4A1B` text). Two-step ramp of one copper family: dark-for-text (pill + rider), saturated-for-fill (wedge). Phase-driven scope: all 5 PDC accounts inherit automatically.
- **Design-review 4-in-1** (#409) - four fixes:
  - `8145caa` actionable-only counters for X of Y entered
  - `ba35495` legend FIGURES row swatches render in full
  - `b55343d` chrome drill row single-line + Today pill sheds date
  - `30ec2ba` today date badge grows to short pill at 2 digits

### Nav subsystem (#407 - the cold deep-URL freeze fix)

- `src/app/service-calendar/layout.js` created with `export const dynamic = "force-dynamic"`. Root-cause fix for the App Router static-shell + query-param hydration bug.
- `src/middleware.js` TEST_MODE bypass: `if (TEST_MODE === "true" && VERCEL !== "1") return next()`. Double-gated to prevent production leak.
- `tests/sc-nav-matrix.spec.ts` - 26-URL matrix regression net.
- Full read-only investigation preserved in [`audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md`](audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md).

### CI (#408 - PR previews + in-runner matrix)

- Two jobs, two event streams. Job A (`matrix`, on `pull_request`) builds in-runner + drives nav matrix with TEST_MODE bypass. Job B (`preview-smoke`, on `deployment_status`) reads the PR's Vercel preview URL from the event payload + runs a dependency-free smoke check.
- No more `PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app` - the hardcoded prod-URL smoke is gone.
- Vercel Preview Protection returns 302 SSO redirects for automated pulls; smoke check accepts 2xx / 3xx / 401 as "serving".

### Documentation companion

- **Two-flag model** documented in [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md).
- **Migration ledger** (sc-1 through sc-17b) documented in the same.
- **Rulings ledger** (dated design decisions) documented in the same.
- **Corner grammar** (top-right = event, bottom-left = season) documented in the same + [`SC_DRILLDOWN_DECISIONS.md`](SC_DRILLDOWN_DECISIONS.md).
- **API depth survey** promoted to [`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md).

### M-1 labor budget plane (2026-07-28, sc-20 + sc-21, PRs #546-#550)

- **sc-20** - `sc_labor_budgets` table (per account, per period; supersede-rather-than-update; hourly + salary + revenue_forecast + effective_from + superseded_at + reason CHECK 1..280 chars). Partial UNIQUE `(account_key, period) WHERE superseded_at IS NULL` for one live row per tuple. `accounts.labor_ratio NUMERIC(6,4)` CHECK `IS NULL OR (> 0 AND < 1)`. Extends `sc_config_changelog.entity_type` CHECK to include `labor_ratio`.
- **sc-21** - period convention correction: sc-20 stored `"P4"..."P10"` but `sc_day_metadata.period` is bare numeric (`"4".."10"`, matching the URL contract `?period=8`). Every homestand envelope emitted `null` at gate because `deriveLaborBudgets` joins on the raw string. sc-21 strips the P prefix, corrects TXR-TX-H P10 to 15714.26 (7 × 15714.29 = 110,000.03; owner ruling: P10 absorbs the 3¢ so the season sums to exactly $110K), swaps the CHECK to bare-numeric. Statement order matters: DROP-check must precede UPDATE (fresh-apply defect fixed in PR #550).
- **`src/app/service-calendar/season/laborBudgetDerivation.js`** - the M-1 allocator. Cents-based Hamilton (largest-remainder) allocation per period. Formula: `dailyRate(P) = P.hourly_budget / (game-derived homestand days in P)`; `homestandBudget(H) = SUM over touched P of dailyRate(P) × (days of H in P)`. Round ONCE at the emitted envelope; the per-period breakdown reconciles by construction. Missing-vs-zero discipline: any missing budget row returns `{ envelope: null, reason: ... }` for touched blocks. NEVER $0.
- **`src/app/service-calendar/admin/LaborBudgetsPanel.js`** - admin editor for per-period budgets + the TXR-V labor ratio. Supersede-rather-than-update wired end-to-end.
- **`scripts/_probe_labor_budget_acceptance.mjs`** - acceptance gate. Compares cents-integer envelope sums to cents-integer P&L season totals. Four accounts diff = 0¢ EXACT.
- **M-2 SHIPPED (2026-07-29, PR #556)** as the envelope's first production consumer. Homestand scope + detail surface on CIN - OH pilot; block-click retarget on the SeasonStepper for pilot accounts.

### M-3 homestand close-out plane (2026-07-29, sc-22, PR #561)

- **sc-22** - `sc_homestand_closeout` table (per account, per homestand_key; supersede-rather-than-update mirrors sc_labor_budgets). Partial UNIQUE `(account_key, homestand_key) WHERE superseded_at IS NULL` for one live row per block. Columns: labor_actual, labor_source (`manual` | `rippling_import`), budget_snapshot (frozen at confirm), service_confirmed_at, confirmed_by, reopen_reason, reopened_by, superseded_at, superseded_by, notes. Grants: `SELECT, INSERT, UPDATE` to service_role; **no DELETE** by design (ledger supersedes, does not erase). This grant policy retired the M-3 synthetic atomicity probe - the probe could never clean up after itself and pay a real residue in a billing table to test a Postgres invariant.
- **`sc_confirm_closeout` plpgsql function** - the transaction wrapper. Three writes in one implicit transaction: supersede the prior live row on `sc_homestand_closeout`, insert the new live row, bulk-upsert `sc_daily_actuals`. Owner ruling 2026-07-29: NO BUSINESS LOGIC in plpgsql. The route decides which days are exceptions, what count each service gets, and whether a projection is missing; the function is a transactional passthrough. Guard: RAISE EXCEPTION when a reopen omits `reopen_reason`.
- **`api/service-calendar/route.js` sc-submit-closeout action** - the single write path for MLB actuals. Validates exceptions against the game-day schedule (span-only, game days only per Q7B). Resolves each `(service, service_date)` pair against `active_until` per the archive-edge predicate (mirrors `DayDetail.js:243-246`). Refuses with HTTP 400 when any game-day service pair is missing a projection and is not marked as an exception, naming the pair. Route catches the reopen-without-reason RPC exception and returns 400 (not 500) with `field: "reopenReason"` for inline validation.
- **`src/app/service-calendar/v2/homestand/CloseoutPanel.js`** - state-driven visibility (`upcoming` -> hidden; `in-progress` -> disabled note; `actuals-due` -> active confirm form; `closed-out` -> summary + reopen). Exception picker over game days in the block span only. Missing-projection surface renders server-flagged pairs so a chef can mark them as exceptions or ask admin. Missing-vs-zero rule applied to the labor input: presence guard runs on the raw string BEFORE coerce-to-number, so an untouched input cannot save $0.
- **Status enum widened**: `upcoming | in-progress | actuals-due | closed-out`. Was three values (`upcoming | in-progress | ended`) at M-2; `ended` retires.
- **MLB tile inertness (Q7A ruling)**: `onDayClick` on period + month tiles gates on `DERIVE_HOMESTANDS_ACCOUNTS`. MLB accounts derive counts from projections + exceptions at close-out; no day-level count entry.
- **MLB entry fence (2026-07-29, PR #564)**: closes the seven other openers into `setFocusDay(date)` that M-3 left open: overview rail queue rows, fee-account rail queue rows, period drill rail rows, month drill rail rows, plus year-scope + drill-scope needs/overdue chip jumps. Two remaining `setFocusDay(date)` sites (`onNextExceptionHandler`, `navDay`) reachable only from an already-open modal are naturally unreachable once the openers are gated.
- **`scripts/_probe_m3_no_projection.mjs`** - the safety-rule probe. Transiently deletes one projection row, POSTs the confirm, asserts HTTP 400 + named pair + no writes, restores the projection. Uses a NextAuth session minted in-probe under identity `probe@kitchfix.com` (never a real person per standing rule).

### M-4a homestand overview + rail SPENT hero + spring wedge (2026-07-29, sc-23 + sc-24, PR #566)

- **sc-23** - stranded projection resolution on STL - MO (row shape divergence between projections and homestand span, isolated to that team). Applied in Studio 2026-07-29.
- **sc-24** - `sc_day_metadata.game_type` populated for STL - MO carry-over dates so the homestand derivation sees the game shape (was NULL, dropped by the derivation's game-type filter). Applied in Studio 2026-07-29.
- **Homestand overview** (`src/app/service-calendar/v2/homestand/HomestandDetail.js`) - SPENT hero + progress bar; season-to-date pinned bottom; single-closeout dedupe; month-boundary explainer with the single-day range collapse fix. `resolveSpringDateSet` marks the spring window on the strip using the PDC-sibling map.
- **PDC sibling map** (`src/app/service-calendar/season/mlbSpringSibling.js`) - `MLB_TO_PDC_SIBLING` maps CIN-OH -> CIN-AZ, STL-MO -> STL-FL, TXR-TX-H -> TXR-AZ, TXR-TX-V -> TXR-AZ. Feeds the spring wedge on the strip. The map lives in one place so a re-sibling ripple has one edit point.
- **`periodBudgets` copy-through** - `src/app/api/service-calendar/route.js` sc-year-summary handler was dropping `periodBudgets` on the way out; `src/lib/dataStore/serviceCalendar.js` now emits it from `strippedBudgets`. The M-4b rail depends on this shape.

### M-4b MLB rail rev3 + tile nav + slim stepper + payroll dividers (2026-07-30, `feat/sc-m4b-cards`)

**Built then reversed - do NOT rebuild these.**

- **M22 empty-scope suppression (REVERSED)**: hid empty month + period cards on the season overview for MLB accounts (`season/suppression.js` + wired into `SeasonShell` month + period loops). Owner ruling 2026-07-30: the full twelve-month + thirteen-period overview stays on MLB accounts. MLB chefs support other accounts when their own season is not running, so hiding months their own team is not playing removes exactly the context that makes the calendar useful to them. `season/suppression.js` deleted; `detectNoService` / `detectOffSeason` reverted to module-internal (they were exported only for the suppression consumer, and exported API with no consumer invites future misuse without context). `dateToHomestandKey` in `season/homestandDerivation.js` kept - still needed for step 6 tile navigation.
- **Card money (REVERSED)**: step 5 shipped per-card money on month + period cards (period card its own budget figure; month card `Draws from P7 + P8`; both cards listed the homestands they touched with scope-native counts). Owner ruling 2026-07-30: month and period cards go back to pure calendar. No budget line, no `Draws from` label, no homestand list, no money of any kind on a card. The three step-5 files were deleted whole: `season/ScopeCardMoneySection.js`, `season/scopeCardDerivation.js`, `season/scopeCardMoneySection.css`; `MonthCard.js` / `PeriodCard.js` / `SeasonShell.js` reverted byte-clean against pre-step-5 commit `4d5f9d4`. Money surfaces on the season view live on the rail (season-scope) + the homestand detail (block-scope). **Cards themselves carry no money.**
- **MiLB fence breach (M-0 documented trap, third recorded instance)**: card money was gated on the data-shaped `hasHomestandSchedule` boolean, which is `true` for CIN - KY and TBJ - NY (AAA accounts). Both accounts rendered "BUDGET not recorded" on every period card until the card-money revert. **Standing rule**: any gate on an MLB-only surface uses the explicit `MLB_HOMESTAND_SURFACE_ACCOUNTS` set, never `hasHomestandSchedule` or any other data-shaped boolean. The set is a hard fence; `hasHomestandSchedule` is a data shape and includes AAA by construction.

**Built and kept.**

- **MLB rail rev3** (`src/app/service-calendar/v2/OpsRail.js` + `rail.css`) - past · now · future. Hero + pinned in-progress card (when in-progress exists; no placeholder when it does not) + three groups: Closed out (collapsed default), Actuals due (open default), Upcoming (collapsed default). Row-that-expands-inline-card pattern. Continuous 3px left accent via `--sc-item-accent` CSS custom property propagating to row + card border-left. **Only actuals-due gets the green filled CTA**; every other row uses the outlined variant. **One row open at a time across ALL groups**. Took four passes (rev1 broken, rev2 shape wrong, rev3 approved after live review).
- **Slim stepper** (`src/app/service-calendar/season/SeasonStepper.js` + `seasonStepper.css`) - strip + month anchors only; no spotlight / footer / hint / caption. Bare numbers on every block; proportional flex by span days. Standard state tokens matching day tiles (`--sc2-state-entered-bg/fg`, `--sc2-state-needs-bg/fg-strong`, `--sc2-state-in-progress-bg/fg`). Current block: solid blue `#1e5aa8` (via `--sc2-state-in-progress-bg` in `src/app/tokens.css`) + white text + tallest. Mobile tap target `calc(var(--row-height) + var(--space-1))` = 44px minimum on Compact density.
- **Tile navigation (step 6)** - MLB game-day tiles on the season grid open the homestand detail via `?homestand=<key>`. `makeTileHomestandClick(accountKey, homestands, onHomestandClick)` factory in `src/app/service-calendar/season/homestandDerivation.js` returns per-tile handler or null. `dateToHomestandKey(dateIso, homestands)` maps a game date to its block key by linear scan over the M-3 payload. Non-game-day tiles + non-MLB tiles + AAA tiles stay inert on the season grid.
- **Payroll-week divider (rider)** (`src/app/service-calendar/v2/homestand/DayStrip.js`) - 1px hairline between a Sunday cell and the next Monday cell inside the strip domain. Monday-Sunday payroll week (Kevin, 2026-07-30). Skips the leading pre-day seam (`i > 1` guard); skips seams that already carry a month-boundary marker. HS10 (Jul 27 - Aug 6) fires exactly one divider between Aug 2 (Sun) and Aug 3 (Mon). Short blocks inside one payroll week fire zero. Legend entry `Payroll week` ships with the divider.

**Found - do NOT rediscover these.**

- **Stale `.scv2` overrides in `src/app/service-calendar/v2/overview.css:976-1082`** - painted the stepper `#2b466b` / `#c8a24a` / `#e6e9ed` / `height: 16px` etc., outranking the base `seasonStepper.css` via `.scv2` prefix specificity. Entire block deleted. Discipline: when a stepper token change does not show up in the paint, grep the whole SC CSS tree for the class before assuming the token wiring is wrong. Owner: "Your own test caught it by comparing the painted value to the token. That is the right instinct."
- **Drill-overlay z-index interaction with interactive tiles**: `MonthCard`'s `.sc-season-month-card-drill { z-index: 1; position: absolute; inset: 0 }` covers the entire card and swallows every tile click. Interactive tiles need `z-index: 2`. Fix: `.sc-season-month-card-cell .sc-daysq--interactive { position: relative; z-index: 2; }` in `src/app/service-calendar/season/season.css`. PeriodCard's article-button pattern also required `stopPropagation` inside `makeTileHomestandClick`'s returned handler so tile clicks do not bubble up and fire the period drill.
- **Spring wedge + PDC sibling map**: an MLB account's spring window comes from its PDC sibling's schedule (owner ruling; MLB rosters travel to PDC in spring). `resolveSpringDateSet` reads `MLB_TO_PDC_SIBLING` to pick the sibling; the sibling's game dates paint the wedge on the MLB strip.
- **Payroll week: Mon-Sun (Kevin, 2026-07-30)**. Payroll runs through Rippling; budget includes overtime at 1.5x over 40 hours per week. Dividers shipped inside the strip domain. **Week summaries are OUT OF SCOPE** for the same reason cards carry no money: the budget is per-homestand, not per-day, so any week-level figure would require pro-rating a block's envelope across weeks - a manufactured number that reconciles against nothing. Adding a payroll import later does not unblock the summary; the shape of the budget does.
- **The rail took four passes.** rev1 shipped `- SPENT` dash instead of `$0`, used `--sc2-surface-card` (light-mode white) on the navy rail causing contrast failure, and fired "Season complete" mid-season. rev2 shape was wrong - owner wanted past · now · future with pinned in-progress + three groups, not a single action card with chevron nav. rev3 is the approved shape. Discipline for future rail work: sketch the pinned-vs-grouped layout against the owner spec before wiring state.

### Polish rounds R1 - R3 (2026-07-30 through 2026-08-01)

- **R1** (PR #577, 2026-07-30) - `sc-polish-r1: Today button, Books hero, queue bound, Period prefix, print doc note`. Today button drills + pulses on arrival; row-cap on the expanded queue from the row + JS constant.
- **R2** (PR #580, 2026-07-30/31) - `sc-polish-r2: drill hero reframe, queue-to-3, ring to bar, Handoff retarget`. R2-1 hero reframe on OpsRailBase; R2-2 ring replaced by `RailProgressBlock` (bar + caption); R2-3 queue-to-3 + drill spacing. Surfaced the P3-B Handoff flight defect at gate; retirement decision deferred (landed as PR #588).
- **R3-1 unit-word alignment** (PRs #582, four in-branch commits from `e81f2bf` through `0c9cc0b`) - fee-shape tile + rail + subtotal + no-service dialog swept from "served" to "meals". Owner ruling on the LEDGER_HEAD_FEE column: "Qty" to match per-meal, not "Meals" (would create a new mismatch). Missed-then-caught site at `NoServiceConfirm` (`DayEntryV2.js:1975`); folded on v4 per grep-pattern lesson (tight patterns miss ternary-nested literals). `contract.js` note reworded from "Counts are planning only" to "Counts are the service record" per owner's standing constraint "say what counts are FOR, never what they are NOT".
- **R3-4 dollar fence** (PR #582 alongside R3-1) - route-local `isFeeNoDollarAccount(billingModel, hasHomestandSchedule)` at `route.js:237` nulls revenue on `sc-load` + `sc-year-summary` emissions when `billing_model === "flat_fee" && !hasHomestandSchedule`. STL - FL only among current active accounts. Counts + priceAtDate preserved. ANNUAL FEE $2,300,000 rail block kept per R3-4a.
- **R3-2 Match gate + skip guard** (PR #584) - `hasProjectedRevenue` in GroupBlock renamed to `hasProjectedMeals`; test becomes `gsProjected.meals > 0` at three sites (`DayEntryV2.js:1476, :1500, :1502`). Fee-shape's revenue-always-zero broke the old revenue-based gate silently; meals-based gate opens the buttons on STL - FL correctly and is byte-identical on per-meal (measured: `_probe_sc_r3_2_gate.mjs` across 6 ENTRY_V2 non-fee accounts, 3857 rows, zero flip sites). Match fill loop at `fillGroupWithProjections` gains `if (day.projected[s.colIndex] == null) continue;` - skips services with absent projections; explicit projected 0 still fills. Trap population before fix (`_probe_sc_r3_2_trap.mjs` since 2026-07-18, no-service-excluded): 9 rows across TBR - FL (7) and TXR - AZ (2), all on 2 (account, day) pairs.
- **R3-5 Spring Training section** (PR #585) - synthetic display construct on STL - FL for the four " - ST" services (self-fencing via name-suffix match per `_probe_sc_r3_5_st_names.mjs` - only account carrying " - ST" services is STL - FL). Section renders at top when in the spring block or when any ST service carries projection/actual (rule 3 override); off-phase, collapses into the inactive-groups drawer. `springDateSet` threaded via `dayEntryProps` at `ServiceCalendar.js:3852` (one line). New file `v2/entry/SpringTrainingSection.js` (extracted with `ServiceRow.js` to break an import cycle in the fix). Rule 4 fix: while ST renders at top, regular groups do not collapse (fallback MiLB Breakfast + Lunch + Palm Beach Cardinals stay at top-level on in-phase days). Fee rail hero now reads `feeServedTotals` from parent (one source, cannot drift from the pinned bar) - was a local sum over ST-stripped groups that read ~0 while the bar read 800.
- **Handoff flight retirement** (PR #588) - see the retirement entry below in Remaining.

### Period lock + undo, step 1 of 2 (2026-08-01, sc-25)

Server-side only; no UI in this step. UI wires in step 2 once the rules hold.

- **Migration sc-25 (`docs/migrations/sc-25-period-lock.sql`)** adds:
  - `sc_daily_actuals_history.change_type TEXT NOT NULL DEFAULT 'update' CHECK IN ('update','delete')`. A save-of-zero (change_type='update', new_count=0) is now distinguishable from a reset (change_type='delete', new_count=0). Reader convention: distinguish by change_type, not by the value.
  - `sc_daily_actuals` BEFORE DELETE trigger + `sc_daily_actuals_delete_audit()` function. Every DELETE now writes a history row. Prior state: DELETE removed rows silently, so an undo with no record was impossible to add safely without this.
  - `sc_is_period_closed(TEXT, TEXT) RETURNS BOOLEAN`. **Swap point.** v1 body: `MAX(service_date) < CURRENT_DATE` from `sc_day_metadata` for the (account, period) pair. v2 (future): consult a `sc_period_locks` table populated when AP pulls a period. Migration comment documents the swap contract so a future rewrite touches this one function, not every caller.
  - `sc_is_day_locked(TEXT, DATE) RETURNS BOOLEAN`. Resolves the day's period from `sc_day_metadata`; delegates to `sc_is_period_closed`. Unknown days (no metadata row OR period IS NULL) return TRUE - **unknown fails safe: locked.**
- **Shared helper `src/lib/scPeriodLock.js`** - `assertDaysUnlockedForWrite(accountKey, dates, email)`. Short-circuits on `isScAdmin(email)` (SLT override = `SC_ADMIN_EMAILS`, same 8 people). Returns null on permit, `{ code: 'PERIOD_LOCKED', lockedDates, message }` on refusal.
- **Wired into three write paths** in `src/app/api/service-calendar/route.js`:
  - `sc-submit-day` (single-day save + mark-no-service via `noService: true`)
  - `sc-bulk-submit` (multi-day save; every date in the batch checked; one locked date fails the whole batch to stay consistent with the existing all-or-nothing contract)
  - `sc-submit-closeout` (MLB close-out; every game date in the block span checked)
- **NOT wired**: `sc-add-note` (notes stay open on a locked period per owner ruling - annotation is separate from the number). Also not the `sc-admin-*` actions (they change catalog, not day data; already `isScAdmin`-gated).
- **Grace window (v1 date-proxy only)**: `sc_is_period_closed` carries a `c_grace_days CONSTANT INT := 3`. A period stays open for 3 days after its `MAX(service_date)`. Reason: operators enter yesterday's counts today; a Sunday-close entered Monday would otherwise be an operator's first experience of a "closed" refusal on the last day of every period. The grace window disappears under v2 - once AP has actually pulled a period, "closed" means closed with no grace math. Named constant so the swap is one delete.
- **Fail-safe alignment**: both `sc_is_day_locked` and `sc_is_period_closed` return TRUE for the unknown case. The first fires when no metadata row exists for the day (or period IS NULL); the second when no rows exist in `sc_day_metadata` for the (account, period) pair. Same direction so a future direct caller of `sc_is_period_closed` (nothing today) does not stumble into an "unknown reads as open" trap.
- **Step-2 ledger reader needs `change_type` awareness**: the delete trigger writes a history row that today's ledger reader renders as "someone updated N services." A reset will read as an update until step 2 teaches the ledger to distinguish `change_type='delete'`. Carried into step 2's scope; step 1 is server-only.
- **New action `sc-reset-day`** in the same route: deletes actuals for one (account, date), appends a companion note via `addDayNoteEntry` (author from session). Refuses when locked unless caller is SLT. Placeholder note wording ("Day reset - all counts cleared") pending owner ruling before step-2 ships.
- **Distinct error shape**: refusals return HTTP 403 with `{ code: 'PERIOD_LOCKED', lockedDates: [...], message }`. Machine-readable so step 2's UI can render specific copy instead of "something went wrong."

### Admin PR 1 - price / fee backdate bypasses the day lock (2026-08-04)

**The hole:** `sc-config-update` (price) and `sc-admin-fee-set` (fee) never called `assertDaysUnlockedForWrite`. A backdated write inserts a new row into `sc_service_prices` or `sc_fee_schedule` keyed by `(id, effective_date)`; `sc_daily_revenue` resolves per-day prices via a LATERAL that picks the newest row with `effective_date <= service_date` at query time. A backdate silently rewrites what closed periods report on the next read - lock never fires, no day is touched.

**Owner ruling (2026-08-04): warn and record, do not block.** Everyone who reaches admin is already the population the day-lock's SLT override exists for. Blocking here would just move contract corrections into SQL with no reason field, no author, no history. So edits stay allowed and become impossible to do accidentally.

**Shipped:**
- **`src/lib/scBackdateReport.js`** - shared helper. `describeBackdateImpact({ type, accountKey, effectiveDate, serviceId?, newPrice? })` returns `{ closedPeriods, affectedDayCount, revenueDeltaCents, deltaSource }`. Two phases: (1) enumerate closed periods from `sc_day_metadata` + `sc_is_period_closed` (always runs, cheap); (2) revenue delta via `sc_daily_revenue` for the price case only. Phase 2 wrapped in a 1500ms `Promise.race`; on timeout or query error the response falls back to periods-only with `revenueDeltaCents: null`. Fee case skips phase 2 entirely (fees do not per-day-attribute through `sc_daily_revenue`; per-period fee attribution is a proration + payment-cadence design question separate from this PR).
- **`composeBackdateReason({ closedPeriods, affectedDayCount, revenueDeltaCents, operatorReason })`** - the server-composed prose prefix. Format documented in the helper's header so a future migration could parse it structurally if anyone ever needs to. Load-bearing prefix; operator's tail truncated with `…` if the composed string exceeds the 280-char CHECK on `sc_config_changelog.reason`. Client-authored prefixes are stripped before the server prepends its own (defense against forgery on an audit field).
- **`sc-admin-backdate-preview` endpoint** in `src/app/api/service-calendar/route.js` - the panel-facing preview. Admin-gated. Returns the same payload the helper produces.
- **Wired into both write paths.** `sc-config-update` (price) and `sc-admin-fee-set` (fee) call `describeBackdateImpact` + `composeBackdateReason` before delegating to the orchestrator. On preview error the write proceeds without the prefix rather than failing closed. Server ALWAYS composes; client-submitted prefixes are stripped.
- **`PriceEditPanel.js` + `FeeEditPanel.js`** - reactive inline warning under the Backdate radio. Preview fires as the operator picks Backdate + enters a valid date; the inline `.sc-admin-eff-warning` box renders "facts, then the caveat" - closed periods by name, revenue delta (price only) or an explicit unavailable note, then the invoicing caveat verbatim. Today and Future radios never trigger the preview - by construction they cannot reach a closed period. **Bounce fix (owner ruling on #620, 2026-08-04):** the first shipped shape used a Save-time modal that operators never saw because the pre-existing inline `.sc-admin-eff-warning` kept the pre-bounce copy; owner measured "126 calendar days" instead of "P4, P5, P6 and P7, which are closed." The inline warning now carries the closed-period detail, the modal was removed, and the sc-25 header comment records the copy shape + the future v2 upgrade path (when `sc_is_period_closed` means AP-has-pulled, "which is closed" becomes "has been billed" and the invoicing caveat disappears).
- **`sc-25-period-lock.sql` header comment** - amended with a "Scope of the lock" section naming price and fee bypass. The next person reasoning about what the lock guarantees reads it there.

**Why prose prefix, not a JSONB column** (contrast with the bulk-note ruling, which chose the opposite). Bulk notes needed a machine-readable discriminator because the ledger renders a chip on every day and code has to ask "did this come from a batch"; any text-based marker would be forgeable. The changelog record here has no such consumer - nobody queries it. The requirement is that someone reading `sc_config_changelog.reason` sees that a closed period was rewritten, by whom, and why. Prose satisfies that. Building a column for a consumer that does not exist is the speculative-schema move.

**What is untouched.** `assertDaysUnlockedForWrite`, `sc_is_day_locked`, `sc_is_period_closed`, and `scPeriodLock.js` are byte-identical. Day writes still refuse on a locked period. No schema change. No migration file. The Postgres-function alternative (a `sc_backdate_preview()` RPC that opens a transaction, inserts the hypothetical price row, SELECTs the view, and rolls back) was considered and deferred pending an explicit ruling; the current implementation reads the view's emitted `projected_count` / `actual_count` / `projected_revenue` / `actual_revenue` / `actual_price_effective_date` and computes the delta as `count * newPrice - view_revenue`, which reproduces the view's own formula (`revenue = count * price`) with a substituted price parameter - not an independent-sum reimplementation.

**Not yet done** (Admin PR 1 scope is deliberately narrow to price + fee):
- Backdated archive / reactivate paths bypass the lock in the same way and warrant the same treatment; separate PR.
- No positive-price CHECK on `sc_service_prices.price`; a hand-crafted admin POST with `to: -5` still passes today's server validation. Separate PR.

### Fiscal calendar generator gap (recorded 2026-08-01)

There is **no fiscal-calendar generator** in the codebase. `sc_day_metadata` is populated exclusively by `scripts/_seed_sc_from_xlsx.mjs` reading each account's workbook and mirroring its own date span. Consequences:
- Ten accounts stopped at 2026-12-20 (their workbooks' end); TBR-FL's B&G subtab extended to 2026-12-29 (Christmas-week rows). Not a period-definition disagreement - a workbook-artifact.
- P13 as authored is a 3-week period (Nov 30 - Dec 20) - documented in the corrected `SC_SPREADSHEET_MAPPING.md:36` comment.
- **2027 calendar will drift the same way unless the 2027 workbooks are audited to a common date span BEFORE the seed script runs**, OR a fiscal-calendar generator lands (independent of workbooks; writes rows across a canonical `(fiscal_year, period, week)` grid) so the seed script only supplies operational data. No action taken this PR; recorded so the drift class is known before the reseed arc.

### Migration gate CI (#416, mechanical enforcement of the DRAFT rule)

- **What shipped**: `.github/workflows/migration-gate.yml` emits a `Migration gate` status check on every PR. Job A (`pull_request`) scans for added `docs/migrations/*.sql` - none -> pass instantly; any -> FAIL with a summary listing the files + the canonical phrase. Job B (`issue_comment`) matches `applied in Studio: YES` from an `OWNER`-association comment, resolves the PR head SHA, emits a `Migration gate` check_run as success on that SHA. Per-SHA reset: any push re-runs the scan.
- **Ruleset**: after PR #416 merges, Kevin adds `Migration gate` as a required status check on the `main protection` ruleset (id 16364953). From that click, migration-bearing PRs are mechanically unmergeable until the confirmation fires.
- **What this closes**: the 2026-07-12 flip-and-merge failure class. The DRAFT-open discipline was necessary but not sufficient - a manual flip of the DRAFT toggle could still land migration-dependent code before the SQL rolled. The required check is the enforcement layer.
- **Procedure**: `docs/RUNBOOK.md` -> "Confirming a migration-gated PR".

---

## Remaining work (as it actually stands)

Not "sized roadmap" - decisions and follow-ups with clear blockers.

### Dunedin verdict - RESOLVED (2026-07-12)

- Kevin ran sc-17b in Studio 2026-07-12 ("Success. No rows returned"); TBJ - FL home tiles now render opponent chips + day/night pills + inherited sc-18 game-day wedges as designed. **TBJ - FL overlay is fully LIVE.**

### CIN - AZ service fee - RULED + SHIPPED (2026-07-12, PR #417)

- **Ruling (Kevin, 2026-07-12)**: CIN - AZ (Goodyear PDC, `billing_model=actuals_drive_invoice`) bills a real contract service fee alongside per-meal revenue. The two are separate P&L lines per [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md); per-meal continues to drive from `sc_daily_revenue`, and the fee lands in `sc_fee_schedule` as its own additive contract-revenue row.
- **Mechanism (PR #417)**: `src/lib/dataStore/serviceCalendar.js` gained `FEE_ELIGIBLE_PER_MEAL = ["CIN - AZ"]` alongside the fee-schedule reader. `loadFeeSchedulePostgres` now returns any active account matching `billing_model === 'flat_fee' OR team_key IN FEE_ELIGIBLE_PER_MEAL`. Writes + history were already agnostic to billing_model. Consumers (export today, KPI later) key on fee-row existence, so once the row is added the fee flows through the money model automatically.
- **Not touched**: calendar tile render (per-meal shape unchanged), `resolveDayKind` / `classifyDayStatus`, actionable-day counters, any migration (JS-side filter; no schema change).
- **Kevin enters the real fee amount** via the admin surface after merge. If a future per_meal account also bills a fee, add its team_key to `FEE_ELIGIBLE_PER_MEAL` (one-line code change; no migration).
- **Was**: "CIN - AZ fee decision (awaiting Kevin)" - resolved as of 2026-07-12.

### R3-3 - REMOVED FROM POLISH ROUND (2026-08-01)

- **Was**: wire a bulk-entry trigger on the STL - FL surface. `DrillRail` renders the `Bulk entry` button at `:487-497` gated on `onBulkModeToggle`; STL - FL is fee-routed to `OpsRail` which has no bulk trigger and no `onBulkModeToggle` wiring. Operator on STL - FL cannot reach bulk at all today.
- **Recon finding (2026-08-01)**: bulk on a fee account is not a button, it is a project. `BulkEntry` passes `variant="bulk"` to `GroupBlock` unconditionally - hides the amount cell but SHOWS the rate cell. On STL - FL every service has price $0; `ServiceRow` renders the rate string per row (`renderRate` output). **R3-4's dollar fence is bypassed** because it fences payload emission on `sc-load`/`sc-year-summary`, not the service-catalog data path bulk consumes. R3-5's Spring Training section has no meaning in bulk - the four " - ST" services would render as loose rows inside their real MLB / MiLB groups. `sc-bulk-submit` write path has no server-side projection-presence check; a manually-typed 0 for an unprojected service goes to the server (R3-2's client-side skip covers Match only).
- **Ruling**: R3-3 is its own future piece, not polish. Wiring the trigger today would expose an STL - FL operator to the fee-shape rendering the last three rounds removed from the single-day path. Concrete gaps to close before the button is safe: fee variant in `BulkEntry` (drop the rate cell), ST-section rendering decision, cross-period backlog reach (`bulkSelected` is scoped to `activeDrillDays` today).
- **Owner**: Kevin (schedule).

### R3-6 - CLOSED with NO CHANGE (2026-08-01)

- **Was**: move the MiLB Snack service on STL - FL into the Palm Beach Cardinals group. `sc_services.group_id` is a plain FK; a single UPDATE would re-parent every historical row in `sc_daily_revenue` and shift past-month "BY GROUP" export totals (MiLB decreases, PBC increases).
- **Recon finding (2026-08-01, `_probe_sc_r3_6_snack.mjs`)**: Snack has zero alignment with Palm Beach Cardinals game days. Snack has 357 projection rows (all zero-valued) spanning 2025-12-29 to 2026-12-20 - matches the MiLB catalog structure. 51 actual rows, 2 non-zero: (a) 2026-03-05 with Snack=1 on a day where every LIVE service on the account has actual=1 (catalog-wide artifact, not operational), (b) 2026-05-22 with Snack=15 alongside regular MiLB Breakfast=81 + Lunch=117 and zero PBC service entries (pure MiLB-only day). Snack's non-zero usage aligns with regular MiLB operations, not PBC game days.
- **Ruling**: Snack is a MiLB service that sees rare use. The complaint about a "lonely zero row" is about display, not classification. No migration.
- **Follow-up**: whether the display should treat a low-frequency MiLB service differently on off-days is a separate ruling; not owned in R3.

### Seed marker for actuals imports (owner decision, 2026-08-01)

- **Decision**: when actuals are seeded from the team spreadsheets, every imported row carries `created_by = "spreadsheet_seed"`. Applied at import time; cannot be reconstructed afterwards.
- **No new column and no migration.** `sc_daily_actuals` already carries `created_by` and `updated_by`. The three states this yields:
  - `created_by="spreadsheet_seed"` + `updated_by="spreadsheet_seed"` -> imported and never touched.
  - `created_by="spreadsheet_seed"` + `updated_by=<person>` -> imported, then confirmed by a human.
  - `created_by=<person>` -> entered from scratch (no import phase).
  A boolean flag could not answer that third distinction.
- **Only visible surface**: the existing Ledger row renders the author verbatim - a seeded day reads `spreadsheet_seed entered counts` when someone opens it. No badge, no tile change, no new UI. Deliberate.
- **Owner**: Kevin (scheduling the import). CC (executing the import once ruled).

### Season PDF fails on PDC accounts - unknown whether by design (2026-07-31)

- **Measured in production**: `GET /api/service-calendar/print?scope=season&account=CIN - AZ&year=2026` returns `500 {"error":"Account CIN - AZ has no schedule to print","phase":"load","elapsedMs":61}`.
- Same call for TBJ - FL and CIN - OH returns `200 application/pdf`. The failure is confined to accounts with neither `has_homestand_schedule` nor `has_schedule_overlay` - i.e. pure PDC.
- **Unknown whether pure PDC accounts are meant to have a printable season sheet.** The Season sheet's own conditional (`available only for accounts with has_homestand_schedule OR has_schedule_overlay` per the module doc) suggests no; the ExportControl menu offering it on CIN - AZ suggests yes. One of the two is wrong.
- **Not investigating.** Logged so it is not rediscovered.
- **Owner**: Kevin to rule which side is correct - hide the menu item on pure PDC, or teach the Season loader to render one honestly.

### P3-B Handoff clone flight - RETIRED (2026-08-01, PR #588)

- **Diagnosis**: phase 2 never committed. Observed sequence `0 -> 1 -> 3 -> 5 -> 0` on every save on every account. `HandoffPill` mounted on the phase-3 commit; `HandoffLayer`'s phase-3 effect read `pillSourceRef` in the same tick and got null, hit the early return at `HandoffLayer.js:41`, aborted. Structurally impossible on every save.
- **Owner ruling (2026-08-01)**: retire, not fix. Every save-feedback path an operator relies on is independent of the flight - session strip, tile flip, modal close/advance, month-complete card. Cost to keep it working was unbounded (three code-visible gaps + one runtime unknown); cost to retire was bounded (373 net LOC removed).
- **Removed (PR #588)**: `v2/handoff/HandoffLayer.js` (whole file), `HandoffPill` component + mount + `registerPillSource` call in `DayEntryV2.js`, `registerFlightTarget` wiring in `Rail.js`'s `RailProgressBlock`, `<HandoffLayer />` mount + import in `ServiceCalendar.js`, phase machine + `BEAT_DELAYS` + `flightTargetRef` + `pillSourceRef` + `isFlippingDate` in `coordinator.js`, pill + clone CSS + three orphan selectors (`.sc-rail-queue-row--clearing`, `.sc-rail-section-meta--ticked`, `.sc-v2-entry--sliding-next`) in `handoff.css`.
- **Kept**: `sessionMap` + `commitSession` / `commitSessionOnly` (read by DrillRail `SessionStrip` + OpsRail `OpsSessionStrip`), `MonthCompleteCard` + `showMonthComplete`, finalize timer at 1350ms (single setTimeout that fires `onFinalize` for next-day advance / modal close), `HandoffProvider` wrapping the root export, tile flip (workspace-level via `prevHasActualsMap`, always was independent), rail queue re-derive (always was independent).
- **Module keeps its name.** `v2/handoff/` + `coordinator.js` not renamed in the same commit that gutted them; separate decision, later, if ever.
- **On v2 after retirement**: operator sees tile flip + session strip update + modal close/advance + (when applicable) month-complete card. No pill, no toast. `silentSuccess: true` on `executeConfirm` still suppresses the recorded toast. Owner is designing the replacement save-confirmation as its own piece; no stopgap toast added.
- **v1 (MLB fee)** toast still fires - byte-identical to pre-P3-B. MLB never mounted the Handoff.
- **Audit reference**: SC_STATUS commit body of `297f28f`; audit narrative in the PR #588 description.

### Price roundCents-then-extend drift on off-schedule fallback (2026-08-03, sized for a ruling)

- **Where the drift lives**: `serviceCalendar.js:175` defines `roundCents = Math.round(n * 100) / 100`. Comment at :169-177 verbatim:
  > Money rounding helper. All price-display surfaces compare and render 2-decimal numbers; the DB stores NUMERIC(12,5) so legacy seed rows can carry contract-derived precision (e.g. 18.42147). Applying roundCents at the orchestrator boundary keeps the entire display/ compare layer at the canonical money form without touching storage. Use this on every price coming OUT of the orchestrator.
- **Where it is actually applied**: `loadAccountConfig` at :475 and :482 (current + upcoming price on `serviceGroups.services[].price`); `loadYearSummary` at :620 and :627 (same fields for the year summary). All four go through `roundCents`. Write paths at :2456, :2468, :2862 use roundCents for change-detection - not display.
- **Where it is NOT applied**: `loadMonthDataPostgres:853` reads `sc_daily_revenue.price_at_date` as `Number(r.price_at_date) || 0` - **raw NUMERIC(12,5), no roundCents**. `route.js:262` passes it through unchanged. So `d.priceAtDate` on the client is 5dp; `svc.price` on the client is 2dp.
- **Blast radius**: R13 (round-per-line, not round-per-price-then-extend) drift ONLY fires when `priceAtDate` is undefined AND the fallback goes to `svc.price`. That's the off-schedule fallback path just added in PR fix/sc-bulk. Every other extended-amount surface (`ServiceRow`, `enteredTotals`, `BillRailFee`, per-day totals on scheduled services) uses `priceAtDate` which is raw, so R13 holds there. **The drift is confined to off-schedule entries.**
- **Largest realistic error (measured against live sc_service_prices, 161 rows, `price_kind='projected'`)**:
  - Max sub-cent drift per unit: **$0.005** (TBR - FL / Lunch - MiLB ST, raw $21.675 -> rounded $21.68). 96 of 161 rows carry sub-cent precision; only 8 hit the 0.5¢ ceiling.
  - Highest observed `sc_daily_projections.projected_count`: **300**. p95 = 240. p90 = 155.
  - **Theoretical ceiling on the fallback path: $0.005 × 300 = $1.50** for a single off-schedule row at max count on the worst-drift service.
  - Typical off-schedule case (a small correction, say 10 units): $0.005 × 10 = **$0.05** - below single-cent display resolution.
- **Two candidate fixes were considered, both rejected (2026-08-03 ruling)**. Naming them so a future reader does not spend a session rediscovering the trade-offs:
  - **Carry a raw price alongside the rounded one on the service object** (e.g. `svc.price` rounded + `svc.priceRaw` raw). Rejected: every future reader of a service object then has to know which of two price fields to use, and picking wrong produces a silent money error. Permanent footgun traded for a bounded one.
  - **Drop `roundCents` from the load boundary** (`loadAccountConfig` :475 + :482, `loadYearSummary` :620 + :627), keeping raw NUMERIC(12,5) prices through to display, with a paired `.toFixed(2)` in the rate formatter. Rejected: this is the genuinely clean fix in isolation, but it walks straight back into the incident the comment at :438-441 documents - 95 of 159 rows reading as changed in the admin editor because stored precision exceeded display precision. Not worth re-opening a real regression with a real history for a path that fires on off-schedule entries only.
- **Honest position**: the load-boundary change is probably right eventually, as part of a deliberate price-precision pass where the change-detection compare is fixed at the same time. It is not right as a rider on a bulk-entry PR.
- **Owner's call** (if reconsidered later): both fixes above have larger blast radius than the bounded $1.50-per-row defect. Fix requires the paired change-detection fix, which is its own scope.

### Day-detail modal remounts during post-save refetch (deferred architectural fix, 2026-08-03)

- **What happens**: on a clean save, `handleSave` invalidates the containing month via `setMonthCache(prev => { delete next[mk]; ... })` + `setReloadKey(k => k + 1)` (`ServiceCalendar.js:1927-1931`). The next render recomputes `periodDays` (`:1189-1206`), which returns `null` because `monthsNeeded.some(mk => !monthCache[mk])` is true. `activeDrillDays` collapses -> `focusDayData` collapses -> the mount gate at `:3826` (`focusDay && focusDayData && ...`) evaluates false -> `DayEntryV2` unmounts. When the refetch lands 400-1000ms later, the gate re-enables and a fresh `DayEntryV2` remounts with empty state.
- **Owner's live measurement (2026-08-03)**: 400ms gap on TXR - AZ July 13 save; longer on July 14 save. Same failure class as the P3-A ring-unmount-during-refetch defect.
- **Why not fixed today**: the two candidate architectural fixes are both scope-heavy and one has a bad history.
  - **Surgical monthCache patch** (write the just-saved day back into the cache instead of dropping the month): explicitly attempted twice and reverted per the comment at `ServiceCalendar.js:1884-1892` ("Fix 2 (optimistic patch) was attempted here twice and reverted after failing the gate both times"). Not tractable without deeper cache/render work.
  - **Latch `focusDayData`** (keep the last known non-null value in a ref, fall back to it during refetch nulls so the mount gate stays true): tractable and would benefit every dialog on this surface, not just the save-confirm case. But it's a workspace-level cache-render change with broader blast radius than any single-dialog PR should carry. Belongs to Phase-1 refetch/render work per the same comment.
- **Workaround shipped (SaveConfirmation hoist)**: `SaveConfirmation` state hoisted to `ServiceCalendarInner`; overlay mounted at workspace level with a viewport-scale scrim at `--z-popover`. Structurally independent of the modal's mount cycle. Owner's other dialogs (Discard/NoService/Reset confirm) do not have this defect because their lifecycle sits entirely BEFORE the monthCache invalidation (dialog closes -> save/reset fires -> invalidation queues -> modal unmounts, all sequenced).
- **When to fix**: whenever the workspace-level cache/render work is scheduled. The latch is the load-bearing piece; every other dialog inherits the fix for free.
- **Owner**: Kevin (schedule). No CC action until scoped.

### Authed preview e2e (follow-up from #408's honest limitation)

- **Gap**: the preview-smoke job cannot reach the API surface (Vercel Preview Protection). Would need a `VERCEL_AUTOMATION_BYPASS_SECRET` header in the smoke request.
- **State**: secret is configured in repo settings (per `docs/TESTING.md` prior state); not currently threaded into the smoke check.
- **Owner**: CC when Kevin is ready to prioritize.

### Old Playwright specs (tdz / auth.setup)

- **Legacy state**: `tests/sc-tdz-hotfix.spec.ts` and `tests/auth.setup.ts` predate the #408 CI rewrite. Auth setup is not invoked by the current workflow; TDZ hotfix is a guard spec kept live.
- **Question**: is `auth.setup.ts` still needed? The local `test:e2e:setup` command references it; CI does not.
- **Owner**: CC to audit + propose cleanup PR when SC is otherwise quiet.

### January 2027 queue (spring + FCL overlays, TBD re-pull)

Per the API survey ([`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md) capability ranking):

- **Spring overlays** for STL - FL / TBJ - FL / CIN - AZ. Same shape as sc-17b. STL / TOR / CIN parent spring schedules at Roger Dean / TD Ballpark / Goodyear. 100% API coverage, 0 TBD.
- **FCL overlays** for STL - FL / TBJ - FL. FCL Cardinals (1370) + FCL Blue Jays (1390) home games at Roger Dean Complex / Bobby Mattick. Adds granularity inside the peer-derived FCL phase block.
- **TBD re-pull** for AAA accounts (CIN - KY, TBJ - NY). sc-16's HOME/AWAY snapshot as of 2026-07-11 will have TBD firm-ups mid-season; `ON CONFLICT DO UPDATE` in sc-16 makes a re-pull idempotent.
- **`/seasons` sanity check** (sc-19 standing ruling) - annual January cross-check of `phaseCalendar.js` spring / FCL boundaries against the MLB Stats API.
- **State**: all deferred until January 2027 unless Kevin surfaces sooner.
- **Owner**: Kevin (prioritization) + CC (execution).

### Launch roadmap (Kevin's ruling, 2026-07-12)

Sequential path to desktop-launch + mobile follow-on. Absorbs the previous standalone "Coming Soon gate drop" item.

1. **Final design polishes** (PR #418, SHIPPED 2026-07-13): spring wedge color, chrome-bar wrap regression, notes cache staleness.
2. **PDF schedule export** for overview + drill-down. **SHIPPED WITH PDC/PDCO DRILL PARKED**: Wave 1 (#419) + Wave 2 (#420) + Wave 3 v2 restyle (#422) + corrective wave (post-Wave-3, 2026-07-13). **PDC + PDCO drill PDF (`scope=month` + `scope=period`) is PARKED behind Coming Soon** per Kevin's ruling 2026-07-13 pending the wall-poster redesign. See [`docs/design/PDC_PRINT_REDESIGN.md`](design/PDC_PRINT_REDESIGN.md) for the redesign arc + resume procedure. Gate: ExportControl menu greys the drill item with a `COMING SOON` tag on PDC/PDCO accounts + `/api/service-calendar/print` returns 404 for `scope=month|period` on PDC/PDCO account keys (defense-in-depth against bookmarks). Season PDF, Ops Calendar PDF, and all Excel exports for PDC/PDCO accounts stay live; **all MLB + AAA drill scopes stay live** (approved product per Sheet 5, outside the redesign). Corrective wave landed four fixes surfaced by the ground-truth data census (`docs/design/PRINT_DATA_CENSUS.md`): games into MLB + AAA month sheets at the print loader, one-line `hasHomestandSchedule` addition to the sc-load account payload (unlocks the PDF Season menu item for all six homestand accounts), day-level `hasActuals` + `hasProjection` on `loadMonthData` + `loadYearSummary` (unblocks PROJECTED-green for future days across TBJ - FL / STL - FL / every ops calendar), and an exhaustive `resolveDayState` (no more silent-drop of `future` / `away`). Meal stack rebuilt to the `msl` grammar (`docs/design/SC_PRINT_MEALSTACK_ADDENDUM.html`): verbatim service names, `is_non_revenue`-only exclusion, density-detected 6.5px floor when max services per day > 4. Past game days without actuals render NO ACTUALS + game info + no meal stack (R6). **MLB accounts get zero state layer on any print surface (R5 superseded)** - their actuals are Kevin's test entries; the intranet has no actuals-owed concept for MLB. Ops Calendar MLB variant: plain day cells + period-start navy + M chip only (F dropped); legend slimmed to `PERIOD START` + `INVOICE / CC EOD MONDAY`. Four sheets now faithful to `docs/design/SC_PRINT_SPEC_v2.html` (`v1` kept for history) plus the meal-stack addendum. v2 introduces the SERVED / PROJECTED / NO ACTUALS / NO SERVICE state model, retires the year sparkline in favor of the Ops Calendar (compliance surface with period-start navy squares, spring bars, M/F header chips), and adds AWAY cells + day numbers to full-schedule seasons plus a blended service-calendar variant for overlay PDCs. Serverless headless Chrome via `puppeteer-core` + `@sparticuz/chromium`; fonts self-hosted; timezone per-account via `ACCOUNT_HOME_TZ`. Export menu: drill-in gets Excel + PDF this scope (**PDC/PDCO drill PDF greyed COMING SOON**) + Excel year fallback; overview gets Excel + PDF season (schedule accounts only, blended variant for overlay accounts) + PDF ops calendar (all accounts; label renamed from "year at a glance"). **Contact-sheet law**: every print PR from now on converts each PDF via `pdftoppm`, views every PNG, and posts a paragraph-per-sheet in the PR body.

- **Follow-up standalone PR (queued)**: `period_data` → PG migration. **Rescoped 2026-07-13 (polish wave)**, then further amended same day: the ring on the Ops Calendar is **parked to 2027** (Kevin's O4 park amendment) - `getInventoryDueIndex()` returns `{}` for every year until a 2027 schedule is entered in `src/lib/print/inventoryCalendar.js`; the ring CSS + legend logic stay in `assets.js` as dormant machinery. The remaining rationale for a `period_data` → PG migration stands: (a) retire the Sheets HUB read from `/api/cron/daily/route.js` (which fires "Inventory due in Nd" notification bells) so the daily cron doesn't need Sheets quota, (b) dedupe with `sc_day_metadata.period` (fiscal calendar in one PG source), (c) provide the substrate for Smart Inventory v2, and (d) at 2027 re-enable, be the single source that BOTH the ring and the notification bell read (the 2026 pre-merge diff surfaced a 7-of-13 divergence between the Sheets HUB `dueDate` column and Kevin's supplied schedule; a shared source removes that class of drift entirely). No visual surface currently blocked on this migration.
3. **Full pricing alignment** across all accounts to 100% accuracy including off-contract specifics (Kevin supplies), then client bill export.
4. **Full-scale system + codebase test, cleanup, drop the Coming Soon gate → desktop DONE**. Absorbs the prior "Coming Soon gate drop" item + overall webapp function review + SC-011 (200% zoom parked for this pass).
5. **Mobile** (details TBC).

### Parked projects (resume on Kevin's ruling)

- **PDC/PDCO drill PDF (wall-poster redesign)** - PARKED 2026-07-13. The current drill PDF is superseded-in-waiting by the Option 4 "Two-Zone Poster" prototype. Menu is greyed + route returns 404 on `scope=month|period` for PDC/PDCO account keys. Season / Ops Calendar / Excel + all MLB + AAA drill PDFs unaffected. Redesign arc + six open rulings + resume procedure in [`docs/design/PDC_PRINT_REDESIGN.md`](design/PDC_PRINT_REDESIGN.md); prototype PR #427 merged as documentation. Kevin's full design feedback pending. Sits beside the Smart Inventory v2 park (see [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) §C.3) as the other cold-resume workstream.
- **Schedule-drift watchdog Stages 2/3 (auto-draft + auto-apply)** - PARKED to 2027 review. Stage 1 (detect + Slack notify) is LIVE via `/api/cron/schedule-drift` (see `RUNBOOK.md` "How to trigger a cron manually" + `modules/SERVICE_CALENDAR.md` "Drift detection"). Stage 2 (nightly cron generates a review-ready migration draft) + Stage 3 (idempotent ON CONFLICT auto-apply for drift classes with unambiguous resolution: DATE_DRIFT into free slots, PPD status flag updates) would close the manual-migration loop. Kevin's ruling 2026-07-14: not before the 2026 season closes; the current manual flow gives him a review checkpoint every schedule update that mechanization would surrender. Resume when a full 2026 season of Stage 1 alert data provides the priors for Stage 2 classifier confidence.
- **Option A (`sc_homestand_schedule` array-shape for DH + PPD makeup dates)** - PARKED 2026-07-14 post-cron-ship. Sized 1-2 day PR (see audit §P4.5). Adds `game_number` column + composite unique index; loader shape flips from `{ date: entry }` to `{ date: [entry, ...] }`; consumer updates in ServiceCalendar / PeriodWorkspace / DaySquare / print; re-extract closes the 25 unreconciled Part 4 rows in `KNOWN_ISSUES`. Waits on: pricing summit (billing base for AAA + FSL feeds the shape trade-offs) + a full 2026 season of Stage 1 drift data to confirm the population.

### Roster indicators (survey Task 6, deferred by default)

- **State**: rosters were surveyed and found deeply disconnected from kitchen-relevant headcount signal (players don't include kitchen staff, extended-camp bodies, or rehab bodies in a useful way).
- **Default stance**: skeptical - would need a specific Kevin hypothesis about a phase where roster count actually predicts kitchen volume before building.
- **Owner**: Kevin (hypothesis first).

---

## Known issues (pre-launch, tracked)

### Bug A - transient month-swap on the Screen Month drill (parked)

**State**: not reproducible from a clean load. Observed by Kevin once (2026-07-13ish); July drill for TXR - TX - H painted with April's payload under correct July date labels. Diagnosis at `/tmp/txr_schedule_audit.md` addendum + Bug A follow-up:

- Server, cache-key composition, route param math, fetch-effect race - all exonerated on code-read + probe.
- No named file:line mechanism from code alone.
- Surface: **screen Month drill** (Kevin's ruling 2026-07-14; app nav bar visible in the screenshots; all-caps "MON TUE WED" traces to CSS `text-transform: uppercase` in `src/app/service-calendar/season/periodWorkspace.css:535` applied to a title-case source `["Mon","Tue","Wed",...]` in `PeriodWorkspace.js:781`).
- Zombie `useState(new Date().getMonth())` at `ServiceCalendar.js:267` (never mutated after mount) is the leading suspect for a path-dependent transient. Every render surface for the drill body reads from URL-based monthKey, not from the zombie's `data`. Kevin's August screenshots (correct data, correct label) argue against any deterministic month offset.

**Hard rule (Kevin, 2026-07-14)**: no fix ships without a named file:line mechanism. Bug A stays parked as a pre-release known-issue.

**Reproduction checklist** (any ONE data point unblocks the fix):

- [ ] Surface: SCREEN Season overview / SCREEN Month drill / SCREEN Period workspace / PDF export (which scope). SCREEN has the plane icon + sun/moon pill glyph + `text-transform:uppercase` MON header; PDF has the PDF viewer chrome around it.
- [ ] Account: exact `team_key`.
- [ ] Exact click path from a known starting URL to the "wrong" render (approx timing; account switch or back-button use noted).
- [ ] Capture: FULL URL bar at the moment wrong data is visible AND one sc-load Network row (request URL + response payload, minimum `days[0].date` + first homestandMap key). Alternatively: `console.log(monthCache)` snapshot.

Filing target: paste into a GitHub issue (or Kevin ping CC) with the four boxes filled.

### Bug B - vanishing schedule days (FIXED - merged 2026-07-14 in #430)

**Was**: Getaway AWAY dates immediately preceding a home opener (plus any HOME game day lacking projections) rendered as bare "off" tiles on the SCREEN Month drill for schedule-bearing accounts. Root cause: `loadMonthDataPostgres` built `days[]` from `sc_daily_revenue` view rows only, with no schedule-truth fallback. 27+ dates across the 4 MLB fee accounts + AAA (TBJ - NY: 12 dates) + PDCO (STL - FL: 24 dates) affected.

**Fix (PR #430, merged 2026-07-14)**: `addMissingScheduleDates` helper in `src/lib/dataStore/serviceCalendar.js` called by both loaders; unions homestand + overlay dates from `sc_homestand_schedule` / `loadScheduleOverlay` and materializes any missing day in the loader's map. Schedule truth wins over projection presence per the doctrine at [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md) "Schedule truth hierarchy". Unit tests: `scripts/content/__tests__/sc-fee-fallback.test.mjs` (32/32 green). E2E deferred to roadmap 4.

**Acceptance**: fallback live in production; verified via Kevin's MLB.com side-by-sides that the four originally-flagged tiles restored (TXR 8/2 vs HOU, TXR 8/30 vs MIL, CIN 8/13 vs CWS, CIN 8/30 vs CHC). Companion counter-only migration sc-18 applied in Studio 2026-07-14 (5 rows: CIN 5/29 + 8/20 game_type -> HOME; TXR H/V 3/26/28/29 nulls -> AWAY). Companion sc-19 date-drift SAFE_NOW single-row migration applied same day (STL - MO pk 823042, 2026-06-25 -> 2026-07-23).

---

## Dead doc candidates (Kevin decides - no unilateral action)

These docs are session-log style or bundle-recon-style, superseded by shipped state + the new canonical docs above. Propose archive to `docs/archive/`.

- `docs/archive/handoffs/HANDOFF_CC.md` (2026-07-02, archived 2026-07-17) - CC handoff for the pre-audit drill-in polish arc.
- `docs/archive/handoffs/HANDOFF_CHAT.md` (2026-07-02, archived 2026-07-17) - chat-side handoff of the same arc.
- `docs/SC_CC_HANDOFF.md` (2026-06-19) - SC-specific CC handoff from Bundle 1/2.
- `docs/SC_BUNDLE1_RECON.md` (2026-06-19) - Bundle 1 recon (bundle shipped, closed).
- `docs/SC_ADMIN_RECON_REPORT.md` (2026-06-18) - Admin Stage 1 recon (shipped).
- `docs/SC_ADMIN_STAGE2_RECON.md` (2026-06-18) - Admin Stage 2 recon (shipped).

**Nothing archived unilaterally.** Kevin's disposition (archive vs keep) recorded here after his ruling.

---

## Working-directory finding

`CLAUDE.md`'s "Side project isolation" rule + "Session start checklist" reference `/Users/kevinfietek/dev/kitchfix-intranet`, but the primary working directory on this machine is now `/Users/kevinfietek/dev/kf-cell-states`. Docs updated to reflect `kf-cell-states` where applicable. If Kevin wants the working-dir back to `kitchfix-intranet`, that's a repo-organization decision; docs updated to match the actual state today.

## Branch-protection finding

Main IS protected via a **repository ruleset** named `main protection` (id 16364953), not the classic branch-protection API. The classic `GET /repos/.../branches/main/protection` endpoint returns 404 because rulesets are a separate surface (`GET /repos/.../rulesets` reveals them). The ruleset is `enforcement: active` with an empty `bypass_actors` list, so the rules apply to every actor including repo admins. Current rules: deletion blocked, non-fast-forward blocked, pull-request required (0 required approvals but stale reviews dismissed on push + all review threads must resolve before merge). All three merge methods (merge / squash / rebase) allowed. **The "no direct commits to main" convention is mechanically enforced.** Migration gate shipped via #416; the required-check procedure lives in [`RUNBOOK.md`](RUNBOOK.md) "Confirming a migration-gated PR".

---

## Pointers

- [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md) - architecture reference (two-flag model, data flow, visual system, phases, nav, migration index, rulings ledger)
- [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md) - money authority
- [`SC_PDC_PHASES.md`](SC_PDC_PHASES.md) - phase data source
- [`DESIGN_AUDIT_LEDGER.md`](DESIGN_AUDIT_LEDGER.md) - design-audit history
- [`SC_DRILLDOWN_DECISIONS.md`](SC_DRILLDOWN_DECISIONS.md) - global visual-parity levers
- [`audits/SC_17_INVESTIGATION_2026-07-11.md`](audits/SC_17_INVESTIGATION_2026-07-11.md) - two-flag rationale
- [`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md) - API capability survey
