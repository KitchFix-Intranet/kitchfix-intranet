# Service Calendar Module

> **Status:** LIVE (dev-gated behind Coming Soon at time of writing). Sitting on Sheets + PG dual, mid-migration to PG-native. The one genuine migration remaining per [`MIGRATION_STATUS.md`](../MIGRATION_STATUS.md); most SC state now lives on PG through the `sc_*` schema.
>
> **What this doc is:** the canonical architecture reference for the SC module - account taxonomy, data flow, visual system, phase integration, nav, testing, migration index, rulings ledger. Read this before touching SC code. Point at it from PR bodies instead of restating in every review.
>
> **What lives elsewhere:** money model = [`SC_MONEY_MODEL.md`](../SC_MONEY_MODEL.md). Phase data source = [`SC_PDC_PHASES.md`](../SC_PDC_PHASES.md). Design-audit history = [`DESIGN_AUDIT_LEDGER.md`](../DESIGN_AUDIT_LEDGER.md). Global visual-parity decisions = [`SC_DRILLDOWN_DECISIONS.md`](../SC_DRILLDOWN_DECISIONS.md). Shipped-state + remaining work = [`SC_STATUS.md`](../SC_STATUS.md). This doc holds architecture; those hold the operational detail.

---

## Account taxonomy

The `accounts` PG table classifies each account by `billing_model` (the historical shape) plus two boolean flags that gate schedule behavior. Effective kind is derived by `resolveDayKind()` in `src/app/service-calendar/dayResolvers.js`.

### Billing models (from the seed)

| billing_model | Meaning | Examples |
|---|---|---|
| `per_meal` (default) | Per-meal, meal-count-driven revenue | CIN - AZ, CIN - KY, TBJ - FL, TBJ - NY, TBR - FL, TXR - AZ |
| `flat_fee` | Fixed annual contract fee | CIN - OH, STL - FL, STL - MO, TXR - TX - H, TXR - TX - V |
| `actuals_drive_invoice` | Per-meal but MLB-adjacent shape (AAA level) | CIN - KY, TBJ - NY |

### The two schedule flags (orthogonal by design)

| Flag | Column | Type | Purpose | Where it lives |
|---|---|---|---|---|
| **Homestand schedule** | `accounts.has_homestand_schedule` | `BOOLEAN NOT NULL DEFAULT false` | Full schedule (HOME + AWAY). **Classification-driving**: gates `resolveDayKind`, `classifyDayStatus`, actionable-day counters. | sc-2 (initial 4 MLB accounts), sc-16 (add CIN - KY + TBJ - NY AAA accounts) |
| **Schedule overlay** | `accounts.has_schedule_overlay` | `BOOLEAN NOT NULL DEFAULT false` | HOME games only, **informational**. Additive to whatever kind the account already renders as. Does NOT touch classify, kind, or counters. | sc-17 (STL - FL) + sc-17b (TBJ - FL) |

**Live flag distribution** (as of 2026-07-12):

| team_key | Level | billing_model | has_homestand_schedule | has_schedule_overlay | Rendered kind |
|---|---|---|---|---|---|
| CIN - AZ | PDC | per_meal | false | false | per-meal |
| CIN - KY | AAA | actuals_drive_invoice | **true** | false | mlb-per-meal |
| CIN - OH | MLB | flat_fee | **true** | false | mlb-fee |
| STL - FL | PDC | flat_fee | false | **true** | fee-no-dollar (overlay) |
| STL - MO | MLB | flat_fee | **true** | false | mlb-fee |
| TBJ - FL | PDC | actuals_drive_invoice | false | **true** | per-meal (overlay) |
| TBJ - NY | AAA | actuals_drive_invoice | **true** | false | mlb-per-meal |
| TBR - FL | PDC | per_meal | false | false | per-meal |
| TXR - AZ | PDC | per_meal | false | false | per-meal |
| TXR - TX - H | MLB | flat_fee | **true** | false | mlb-fee |
| TXR - TX - V | MLB | flat_fee | **true** | false | mlb-fee |

The two flags are **orthogonal**: any account can have zero, one, or (in theory) both. Today no account has both; the design supports it.

### Why the flags are orthogonal (the sc-17 rationale)

Flipping `has_homestand_schedule=true` for STL - FL would break the account three ways ([`SC_17_INVESTIGATION_2026-07-11.md`](../audits/SC_17_INVESTIGATION_2026-07-11.md) has the full derivation):

1. `resolveDayKind` returns `"mlb-fee"` instead of `"fee-no-dollar"` - loses the no-$ discipline.
2. `classifyDayStatus` routes rowless dates to `"off-season"` - catastrophic for a PDC that serves daily regardless of the schedule.
3. Post-#409 actionable-day counters collapse the denominator when off-season days drop out of both sides.

`has_schedule_overlay` sidesteps all three: it feeds a separate render path that additively prepends the opponent chip + day/night pill when the account is flagged AND the date has a `GAME` row. No kind change, no classify change, no counter change.

### HOME-only hard rule (schedule overlay)

STL - FL and TBJ - FL are FSL PDC accounts that serve daily. Inserting AWAY rows would either force operationally-wrong "away" tiles or require a classifier guard that trades correctness at one axis for complexity at another. **No AWAY rows on overlay accounts. Ever.** A future pass MUST NOT "complete" this migration by adding AWAY rows to overlay-flagged accounts.

The extractor (`scripts/_extract_milb_schedule.mjs`) enforces this via a `homeOnly: true` flag per club in the CLUBS list.

---

## Data flow (loaders -> API -> orchestrator -> workspace -> DaySquare)

### Server-side (Postgres)

```
sc_service_prices                 <- effective-dated prices (projected + actual kinds)
sc_daily_revenue (view)           <- LATERAL join to newest price per (service, date)
sc_month_summary (view)           <- month-scope aggregate
sc_service_config                 <- per-account services + groups + active_until
sc_fee_schedule                   <- annual contract fees
sc_homestand_schedule             <- schedule rows: HOME + AWAY, day_type + opponent + game_pk + game_time + day_night + is_doubleheader
sc_day_metadata                   <- per-day meta (notes, period)
sc_day_note_entries               <- authored notes ledger (append-only, server-derived author)
sc_daily_actuals + _history       <- actuals + edit trail (BEFORE UPDATE trigger populates history)
sc_config_changelog               <- admin write log
sc_phase_calendar                 <- PDC phase blocks (sc-11)
```

### Loaders (`src/lib/dataStore/serviceCalendar.js` - **danger zone**)

- `loadAccountList` / `loadAccountInfo` - reads `accounts` including both schedule flags.
- `loadHomestandContext(accountKey, first, last)` - reads ALL `sc_homestand_schedule` rows (HOME + AWAY) for the date range. Called only when `has_homestand_schedule=true`.
- `loadScheduleOverlay(accountKey, first, last)` - reads `day_type='GAME'` rows ONLY (belt-and-suspenders against future AWAY leakage on overlay accounts). Called only when `has_schedule_overlay=true`.

Both loaders return maps keyed by ISO date; the orchestrator threads them into the workspace payload.

### API route (`src/app/api/service-calendar/route.js`)

`sc-load` / `sc-year-summary` responses now include:

- `hasHomestandSchedule` boolean
- `hasScheduleOverlay` boolean
- `homestandContext` (when the flag is TRUE) - the sc-16 payload
- `scheduleOverlay` (when the flag is TRUE) - the sc-17 payload

The two payloads are additive; the render layer chooses which to consume based on kind.

### Client (`src/app/service-calendar/*`)

- `ServiceCalendar.js` - top-level orchestrator; derives `phaseTimeline` + `springDateSet` via `useMemo` from `phaseCalendar.js`.
- `SeasonShell.js` + `PeriodWorkspace.js` - thread `springDateSet` + `phaseTimeline` through the prop chain.
- `season/MonthCard.js` + `season/PeriodCard.js` - per-cell `renderCell` threads `isGameDayOverlay` + `isSpringPhase`.
- `DaySquare.js` + `DaySquare.css` - the atom. Renders the two sanctioned marks (see Visual system below).
- `season/LegendInfoPopup.js` + `.css` - legend rows for both marks.
- `season/PeriodHeaderNav.js` + `MonthHeaderNav.js` - chrome bar with the phase pill + Spring Training rider.

---

## Visual system

### Sm-tile philosophy (the two-marks rule)

The sm overview tile carries **exactly four elements**: color, border, date number, and up to two sanctioned corner marks. Nothing else. This rule is enshrined in verbatim comments in `DaySquare.js`, `DaySquare.css`, and `LegendInfoPopup.js` and MUST NOT be relaxed without an explicit design conversation.

The two sanctioned marks and the corner grammar:

| Corner | Mark | Meaning | Color | Trigger |
|---|---|---|---|---|
| **Top-right** | Indigo wedge | Game day (transient, per-day) | `#4338CA` (indigo-700) | `has_schedule_overlay=true` AND the date has a `GAME` row |
| **Bottom-left** | Copper wedge | Season (multi-day, phase-driven) | `#8A4A1B` (copper-800) | Date falls inside a Spring Training block from `phaseCalendar.js`; PDC accounts only |

**Corner grammar**: top-right = event (transient), bottom-left = season (multi-day). If a third mark is ever needed, it goes on a corner that carries its axis - do not reopen the icon channel.

Both wedges are rendered via `::before` / `::after` pseudo-elements + `clip-path: polygon(...)` on the sm tile. `overflow: hidden` + border-radius clips inner wedges to rounded corners. The lg drill-in tile carries neither wedge (the DayDetail modal has full width for context).

### Counter semantics (#409 ruling)

Actionable-day counters (`X of Y entered` in the chrome + workspace hero) count **actionable days only**. Off-season days and away days are excluded from both the numerator AND the denominator. Rationale: a CIN - OH June with 30/30 game days shouldn't read differently from a June where 6 of the 30 dates are AWAY - both numerator and denominator move together, and the operator's actionable ratio stays honest.

### Pill / chip pipeline (aligned via the #353-363 design audit arc)

- Filled Option B pills (per Kevin's Round 2 ruling).
- Pill-under-opponent stack on MLB tiles.
- Away = teal + airplane glyph.
- Today = grow-to-pill at 2-digit dates (design review 4/4 fix, commit `30ec2ba`).
- Chrome bar = single line, "Today" label (design review 3/4 fix, commit `b55343d`).
- Legend FIGURES row swatches render in full (2/4 fix, commit `ba35495`).

### Legend rows

The verbose legend popup ([`LegendInfoPopup.js`](../../src/app/service-calendar/season/LegendInfoPopup.js)) carries a "Calendar context" section with:

- Today ring
- Note indicator (chat-bubble glyph)
- **Game day** (sc-18 wedge preview at half-scale)
- **Spring Training** (sc-19 wedge preview at half-scale)

Legend swatches render outside the sm-gate per the #409 figure-row fix, so the previews match the on-tile marks 1:1 even though the wedges only appear on live sm tiles.

---

## Phase integration

Phase data lives in two places:

- **Source of truth**: `src/app/service-calendar/season/phaseCalendar.js` `PER_ACCOUNT_2026` object. Hand-anchored, Kevin-approved. Reserved for the 5 PDC accounts: CIN - AZ, TXR - AZ, TBR - FL, TBJ - FL, STL - FL.
- **Postgres mirror**: `sc_phase_calendar` (sc-11 migration, 48 seeded rows). Used by the operator Excel export's BY PHASE table.

### Phase-driven scope, not per-account (sc-19 lesson)

The 5 PDC accounts each carry a `spring-training` phase block. The sc-19 styling (copper wedge + ST pill + chrome rider) derives from `rangeIntersectsSpring(timeline, start, end)` on the client - all 5 accounts get the treatment automatically because the phase block exists in `phaseCalendar.js`. Zero per-account UI code. This is the design working as intended; Kevin's Flag 2 ruling on PR #413 reconfirmed it.

### Report-date, not game-window (STL - FL Spring block)

`phaseCalendar.js` STL - FL Spring runs **Feb 9 - Mar 22**, not the MLB Stats API's Feb 20 - Mar 24 spring bracket. Rationale: PDC kitchens feed bodies from the day players report, not the day the first Grapefruit League game plays. Kevin's Flag 1 ruling on PR #413 recorded this permanently. Verified up-to-date in [`SC_PDC_PHASES.md`](../SC_PDC_PHASES.md).

### January sanity check (sc-19 standing ruling)

Each January, cross-check `phaseCalendar.js` boundaries against the MLB Stats API:

```
GET https://statsapi.mlb.com/api/v1/seasons?sportId=1&season=<yr>   # MLB spring bounds
GET https://statsapi.mlb.com/api/v1/seasons?sportId=16&season=<yr>  # FCL summer bounds
```

**`phaseCalendar.js` remains the source of truth.** The API is a verifier. If the API says the spring window shifted by a week, that's a signal to review with ops, not to auto-overwrite. Detail in [`SC_PDC_PHASES.md`](../SC_PDC_PHASES.md) "Annual sanity check".

---

## Nav architecture

### Force-dynamic (why cold deep-URL loads used to freeze)

`src/app/service-calendar/layout.js` exports `dynamic = "force-dynamic"` for the entire SC route segment. Landed via PR #407.

**Root cause of the pre-#407 bug**: Next 16 App Router's default is to prerender the client component shell statically. Cold navigation to a param-carrying URL (e.g., `/service-calendar?account=STL-MO&scope=period&period=P02`) hits the prerendered shell, hydrates with empty query state, then `router.push` operations no-op because the router's internal state stays pinned to the empty-query prerender. Symptoms: buttons render, buttons look enabled, clicks do nothing.

**Fix**: `force-dynamic` marks the route segment as always-server-rendered. Every visit starts from a fresh server render carrying the correct `searchParams`, hydration matches the URL, `router.push` behaves normally.

### TEST_MODE middleware bypass (double-gated)

`src/middleware.js` short-circuits at the top when `TEST_MODE === "true" AND VERCEL !== "1"`:

```js
if (process.env.TEST_MODE === "true" && process.env.VERCEL !== "1") {
  return NextResponse.next();
}
```

The double-gate prevents any production deploy from ever routing without auth (Vercel always sets `VERCEL=1`). TEST_MODE is safe to set in CI runner envs + local Playwright loops; it becomes inert in production even if accidentally exported.

The bypass is what makes the CI matrix job possible: the runner boots the app locally with `TEST_MODE=true`, Playwright drives the SC UI directly without OAuth. All data actions are stubbed via `page.route`.

### Nav matrix regression net

`tests/sc-nav-matrix.spec.ts` drives a 26-URL matrix through the SC nav subsystem. Every scope combination (season / period / month, with and without account, all account keys) is exercised as both cold-load (fresh navigation) and warm-nav (from a prior state). The matrix asserts:

- `router.push` produces the expected URL change.
- The corresponding view mounts (`.sc-workspace-grid-row`, `.sc-full-season-card`, etc.).
- Zero `ReferenceError` accumulates across the render (guard against TDZ / free-variable classes documented in [`GOTCHAS.md`](../GOTCHAS.md)).

The matrix is required on every PR touching SC (`.github/workflows/e2e.yml` job A).

---

## Testing + CI

### Two jobs, two event streams (`.github/workflows/e2e.yml`)

**Job A (`matrix`)**: runs on `pull_request`. Builds the PR's code in-runner (`npx next build`), starts it with the TEST_MODE bypass, drives the nav-matrix spec. Placeholder env vars (`AUTH_URL=http://localhost:3000`, `AUTH_SECRET=ci-placeholder-not-a-secret`, etc.) keep the workflow self-contained - no Kevin-setup step required.

**Job B (`preview-smoke`)**: runs on `deployment_status`. Vercel's GitHub App emits this event when the PR's preview finishes building. The job reads `github.event.deployment_status.environment_url` (the PR's OWN preview URL) and runs a dependency-free smoke check that the preview responds as expected. Accepts 2xx / 3xx / 401 as "serving" (Vercel Preview Protection returns 302 SSO redirect for automated pulls - that's OK; the smoke check treats it as "the preview built and is up").

**Honest limitation**: the preview smoke cannot reach the API surface (would require the Vercel bypass token). This is a documented follow-up ("authed preview e2e"). Job A + the browser-level nav matrix cover code-change regressions; job B covers "did the preview build."

### What replaced the old "test production" pattern

Prior to #408, `.github/workflows/e2e.yml` pointed at the hardcoded prod URL. Passing there proved "prod is up," not "this PR's code works." The `PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app` string is now gone from the workflow - grep returns zero hits.

### Test artifacts to know about

- `tests/sc-nav-matrix.spec.ts` - the #407 regression net.
- `tests/sc-tdz-hotfix.spec.ts` - the #378 TDZ / free-variable guard (extended in #382).
- `tests/.auth/user.json` - legacy auth state from the pre-#408 production-target era. Not used by the current workflow; kept for local `test:e2e:setup` fallback.

---

## Migration index

Applied dates known from the git log + commit dates. Where a Studio-apply date isn't recorded in a commit / audit, "Kevin to confirm" is the honest label.

| Migration | File | Purpose | Merged | Applied (Studio) |
|---|---|---|---|---|
| sc-1 | `sc-1-service-calendar-schema.sql` | Core SC schema (services, actuals, metadata) | 2026-06 | 2026-06 |
| sc-1b | `sc-1b-add-non-revenue-flag.sql` | Non-revenue flag on services | 2026-06 | 2026-06 |
| sc-2 | `sc-2-homestand-schedule.sql` | `sc_homestand_schedule` + initial 4 MLB accounts | 2026-06 | 2026-06 |
| sc-3 | `sc-3-user-accounts-seed.sql` | User -> home account seed | 2026-06 | 2026-06 |
| sc-4 | `sc-4-config-changelog.sql` | `sc_config_changelog` audit table | 2026-06 | 2026-06 |
| sc-5 | `sc-5-fee-schedule.sql` | `sc_fee_schedule` + 5 seeded 2026 fees | 2026-06-19 | 2026-06-19 |
| sc-6a | `sc-6a-catalog-active-until.sql` | `active_until DATE` on services + groups | 2026-06-19 | 2026-06-19 |
| sc-6b | `sc-6b-catalog-aware-views.sql` | View recreate reading `active_until` | 2026-06-19 | 2026-06-19 |
| sc-7 | `sc-7-changelog-latest-view.sql` | Changelog latest-view | 2026-06 | 2026-06 |
| sc-8a | `sc-8a-price-kind-column.sql` | `price_kind` enum on service prices | 2026-06 | 2026-06 |
| sc-8b | `sc-8b-actual-prices-and-view.sql` | Actual prices + view (superseded by sc-8c) | 2026-06 | 2026-06 (backed out via sc-8c) |
| sc-8c | `sc-8c-remove-double-discounted-actuals.sql` | Remove 53 double-discounted rows | 2026-07-09 | 2026-07-09 |
| sc-9 | `sc-9-day-note-entries.sql` | `sc_day_note_entries` authored notes ledger | 2026-07-09 | 2026-07-09 |
| sc-11 | `sc-11-phase-calendar.sql` | `sc_phase_calendar` (48 seeded PDC phase rows) | 2026-07-10 | 2026-07-10 |
| sc-12 | `sc-12-mlb-schedule-reconciliation.sql` | MLB schedule reconcile | 2026-07-10 | 2026-07-10 |
| sc-13 | `sc-13-away-schedule-load.sql` | AWAY rows on `sc_homestand_schedule` | 2026-07-10 | 2026-07-10 |
| sc-15 | `sc-15-home-game-time.sql` | `game_time TIMESTAMPTZ` + `day_night` + `is_doubleheader` | 2026-07-11 | 2026-07-11 |
| sc-16 | `sc-16-milb-schedule-parity.sql` | `has_homestand_schedule` flag + CIN - KY / TBJ - NY AAA rows | 2026-07-11 | **2026-07-11** (silent-gap incident before apply - see below) |
| sc-17 | `sc-17-stl-fl-home-overlay.sql` | `has_schedule_overlay` column + STL - FL flag + 66 HOME rows | 2026-07-12 | 2026-07-12 |
| sc-17b | `sc-17b-tbj-fl-home-overlay.sql` | TBJ - FL flag flip + 66 HOME rows (extends sc-17) | 2026-07-12 | Kevin to confirm |
| sc-18 | (code-only; no SQL) | Indigo game-day corner wedge on sm tiles | 2026-07-12 | n/a |
| sc-19 | (code-only; no SQL) | Spring Training styling (copper wedge + ST pill + chrome rider) | 2026-07-12 | n/a |

**Note on sc-14**: no `sc-14-*.sql` file exists in `docs/migrations/`. The number was reserved for a prep/open/close removal that was scoped in [`SC_14_PREP_OPEN_CLOSE_REMOVAL_REVIEW_2026-07-10.md`](../audits/SC_14_PREP_OPEN_CLOSE_REMOVAL_REVIEW_2026-07-10.md); the actual removal shipped via code changes without a paired migration.

### Silent-gap history (48 hours, two incidents)

Both incidents are variants of the same class: **schema-dependent code merged before the paired migration was applied in Studio**.

- **2026-07-11 (sc-16)**: PR #403 landed the sc-16 reader (SELECT for `has_homestand_schedule`); the migration hadn't run in Studio yet. Every `accounts` SELECT returned 500 (missing column). Revert PR #404, reland PR #406 after apply.
- **2026-07-12 (sc-17)**: post-#403 the CLAUDE.md "migration-gated PRs open as DRAFT" rule was added. #410 (sc-17 STL - FL) opened as DRAFT; the DRAFT was flipped to ready-for-review and merged before the sc-17 SQL had rolled in Studio. Same failure class (schema-dependent read into missing column). The rule was designed for; the discipline broke around it.

**Migration gate SHIPPED (2026-07-12, PR #415)**: `.github/workflows/migration-gate.yml` emits a `Migration gate` status check on every PR. Job A (`pull_request`) scans for added `docs/migrations/*.sql` - none -> pass instantly; any -> FAIL with a summary listing the files + the canonical phrase. Job B (`issue_comment`) validates `applied in Studio: YES` from an `OWNER`-association comment and emits a `Migration gate` check_run as success on the PR head SHA via the Checks API. Per-SHA reset: any subsequent push re-runs Job A, so a confirmation never outlives the code it confirmed. Once Kevin adds `Migration gate` to the required checks on the `main protection` ruleset, this failure class is mechanically closed. Procedure: [`RUNBOOK.md`](../RUNBOOK.md) -> "Confirming a migration-gated PR".

---

## Rulings ledger (standing design rulings, dated)

The rulings ledger captures decisions that outlive their originating conversation. Order = date.

| Date | Ruling | Rationale | PR |
|---|---|---|---|
| 2026-07-06 | Day tile = meals-first (stack `meal count` prominent, `$` quiet beneath) | Reduces `$3K / 305` fraction-read; softens the density. | #327 (drill), #331 (today) |
| 2026-07-06 | Totals card = half-height strip; kill the projection-gap delta | Projection targets invent false goals; entered $ carries the load. | #328 |
| 2026-07-06 | Today cell = navy frame + filled navy date chip (Option A), lg only | Sm year view keeps its ring; no bottom pill. | #331 |
| 2026-07-06 | Month drill = own scope, `?month=YYYY-MM`, month header omits phase | A month spans phases. | #325 / #326 |
| 2026-07-08 | STL - FL falls through per-meal branch by design; MLB homestand = pure schedule | Fee ruling split; keeps STL - FL's daily-service discipline. | #353 |
| 2026-07-09 | Per-meal zero = `no-service` (beige/complete). Homestand zero on GAME day = `entered` (recorded cancellation). Do NOT harmonize. | Deliberate classifier asymmetry; correct model. | #365 / #366 |
| 2026-07-09 | Bulk endpoints do NOT accept `rideNote` | A single note across N days blurs which day it was meant for. | #367 |
| 2026-07-09 | `SC_MONEY_MODEL.md` wins conflicts | Canonical money authority (sc-8c aligned). | #368 |
| 2026-07-11 | HOME-only hard rule for overlay accounts (STL - FL, TBJ - FL) | AWAY rows would break daily-service PDC classification. | #410 / #411 |
| 2026-07-11 | Two-flag orthogonal model (`has_homestand_schedule` vs `has_schedule_overlay`) | Orthogonal design lets the two axes stay independent. | #410 |
| 2026-07-11 | Migration-gated PRs open as DRAFT | Prevents synchronous-merge silent-gaps; incident 2026-07-11. | CLAUDE.md rule |
| 2026-07-12 | Sm-tile "TWO sanctioned marks" philosophy (color + border + date + top-right event mark + bottom-left season mark) | Prevents unbounded icon channel; corner grammar is stable. | #412 (game wedge), #413 (season wedge) |
| 2026-07-12 | Corner grammar: top-right = event, bottom-left = season | Consistent axis mapping across future marks. | #413 |
| 2026-07-12 | Counter semantics: actionable-day only (off/away excluded from numerator AND denominator) | Numerator + denominator move together; ratio stays honest. | #409 (`8145caa`) |
| 2026-07-12 | `phaseCalendar.js` is the source of truth; API is a verifier | STL - FL Spring = Feb 9 - Mar 22 (report-date, not game-window). | #413 |
| 2026-07-12 | Phase-driven scope, not per-account | 5 PDC accounts inherit spring styling automatically. | #413 |
| 2026-07-12 | Annual January sanity check against `/api/v1/seasons?sportId=1|16` | Verifier only; boundaries stay hand-anchored. | #413, [`SC_PDC_PHASES.md`](../SC_PDC_PHASES.md) |

---

## Danger zones (SC-specific)

Standard danger-zone rules from [`CLAUDE.md`](../../CLAUDE.md) apply. SC-specific hot spots:

- `src/lib/dataStore/serviceCalendar.js` - the orchestrator. Every SC data path lands here. Preserve dual-write and the sc-16/sc-17 flag branch structure.
- `src/app/api/service-calendar/route.js` - the router. Both flags must SELECT into `loadAccountList` + `loadAccountInfo` for classification to work at all scopes.
- `src/app/service-calendar/dayResolvers.js` - `resolveDayKind` + `classifyDayStatus`. Any kind or classify change ripples through every tile at every scope.
- `docs/migrations/sc-*.sql` - migrations don't auto-apply. See "Silent-gap history" above. Migration-gated PRs open as DRAFT.

---

## Pointers

- [`SC_STATUS.md`](../SC_STATUS.md) - shipped-state summary + remaining work
- [`SC_MONEY_MODEL.md`](../SC_MONEY_MODEL.md) - canonical money authority
- [`SC_PDC_PHASES.md`](../SC_PDC_PHASES.md) - phase data source + January sanity-check ruling
- [`DESIGN_AUDIT_LEDGER.md`](../DESIGN_AUDIT_LEDGER.md) - design-audit history (Sections 1-3 + Owner Rounds + cleanup phase)
- [`SC_DRILLDOWN_DECISIONS.md`](../SC_DRILLDOWN_DECISIONS.md) - global visual-parity levers
- [`audits/SC_17_INVESTIGATION_2026-07-11.md`](../audits/SC_17_INVESTIGATION_2026-07-11.md) - two-flag rationale
- [`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](../audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md) - API capability survey
- [`audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md`](../audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md) - nav subsystem read that led to #407
- [`audits/SC_MILB_SCHEDULE_PARITY_TASK1_2026-07-11.md`](../audits/SC_MILB_SCHEDULE_PARITY_TASK1_2026-07-11.md) - sc-16 background
