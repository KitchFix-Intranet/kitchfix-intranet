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
| **Bottom-left** | Copper wedge | Season (multi-day, phase-driven) | `#C2410C` (copper-600 fill) | Date falls inside a Spring Training block from `phaseCalendar.js`; PDC accounts only. Kevin's density-review ruling 2026-07-12: fill takes the saturated step; text sites (ST pill + chrome rider) keep `#8A4A1B` (copper-800). |

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

**Migration gate SHIPPED (2026-07-12, PR #416)**: `.github/workflows/migration-gate.yml` emits a `Migration gate` status check on every PR. Job A (`pull_request`) scans for added `docs/migrations/*.sql` - none -> pass instantly; any -> FAIL with a summary listing the files + the canonical phrase. Job B (`issue_comment`) validates `applied in Studio: YES` from an `OWNER`-association comment and emits a `Migration gate` check_run as success on the PR head SHA via the Checks API. Per-SHA reset: any subsequent push re-runs Job A, so a confirmation never outlives the code it confirmed. Once Kevin adds `Migration gate` to the required checks on the `main protection` ruleset, this failure class is mechanically closed. Procedure: [`RUNBOOK.md`](../RUNBOOK.md) -> "Confirming a migration-gated PR".

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

## Printable schedules (PDF export, Wave 3 v2)

The SC print export ships four sheets - Month, Period, Season, Ops Calendar - as PDFs alongside the existing xlsx workbook export. **Pixel authority**: `docs/design/SC_PRINT_SPEC_v2.html` (Kevin-approved 2026-07-13, `#422`). `docs/design/SC_PRINT_SPEC_v1.html` kept for history only.

**Wave shipping**:
- Wave 1 (`#419`) - Month + Period + Season (v1 grammar).
- Wave 2 (`#420`) - Year sheet (v1 sparkline).
- Wave 3 (`#422`) - **v2 restyle** of all sheets; Year retired and replaced by Ops Calendar.

### State model (all service-bearing sheets)

Single vocabulary across every service-bearing sheet:

- **SERVED** - actuals row exists for the date (never keyed on date-is-past). Fill `--svc` (`#D3E2C8`).
- **PROJECTED** - no actuals, projection exists / date upcoming. Fill `--proj` (`#EBF3E4`) + 1.5px inset `--projline` (`#A8C796`) border.
- **NO ACTUALS** - service was expected, date is past account-local, no actuals row. Fill `--nd` (`#FBF1EA`), day number + micro `NO ACTUALS` label in `--ndink` (`#B45327`). **THE COMPLIANCE SIGNAL.**
- **NO SERVICE** - soft `--soft` fill + micro `NO SERVICE` label. One name everywhere; `OFF` is retired.

The classifier's amber-vs-red split (`needs-entry` vs `overdue`) collapses to a single **NO ACTUALS** state in print - the compliance signal doesn't need the two-tier ramp on paper. See `resolveDayState()` in `src/lib/print/assets.js`.

**Meal figures print exactly as stored - no rounding, served or projected.** Every service legend carries the AS-OF line: `AS OF {date} - SERVED = ACTUALS ENTERED · PROJECTED AFTER`.

### Print-tuned green pair (intentional divergence from screen tokens)

`--svc` (`#D3E2C8`) + `--proj` (`#EBF3E4`) + `--projline` (`#A8C796`) diverge intentionally from the app's on-screen `--status-entered-bg` (`--green-300` = `#7DC78B`). The screen green survives backlit rendering but blows out under grayscale laser and kills the day-number contrast on paper. **Do NOT sweep the print pair to the screen tokens** - the divergence is print-survival. Comment anchors the divergence in `assets.js` sheetCss.

### Route

`GET /api/service-calendar/print` - session-gated, `runtime: 'nodejs'`, `maxDuration: 60`. Params: `account`, `scope` (`month | period | season | year`), `year`, plus `month` (YYYY-MM) for month scope or `period` (N / PN) for period scope. `scope=year` renders the Ops Calendar in v2 (URL param retained for backwards compat; yearSheet.js retired).

### Sheet-by-sheet

- **Month + Period - MLB fee** (spec Sheet 5, approved): home fill (`--homefill` `#DCE5F3`) + opponent + time; away fill (`--awayfill` `#EFEDE6`) + `@OPP` + no time. **NO state grid, NO meal stack** - MLB accounts are gated at the resolver (opts.accountLevel === "MLB" → null) so no service state can leak in from a stray test actual. **Period pills at boundaries** (see the Period Pills section below - supersedes the v2 "period-boundary line + in-grid `Pn` REMOVED" line: pills LIVE on the drill grid). Title P-tag stays.
- **Month + Period - AAA per-meal + PDC overlay + PDC per-meal** (spec Sheet 6/7, corrective wave 2026-07-13): full state-fill grid + game overlay + meal stack. Applies uniformly across AAA (CIN - KY, TBJ - NY), PDCO (STL - FL, TBJ - FL), PDC (CIN - AZ, TXR - AZ, TBR - FL) per R4. AWAY days on AAA render `--awayfill` + grey `@OPP` (`.awy`) like the MLB sheet grammar; the meal stack overlays if the day carries service counts. GAME days on AAA / PDCO render `--homefill` + navy `.opp` + `.tm` time + meal stack. **R6**: past game days without actuals render `.nd` (NO ACTUALS copper) + opp + time + **no meal stack** (projections don't print on past days). Spring copper title chip fires on PDC / PDCO variants when the scope intersects a spring block. **Period pills at boundaries** (see below).
- **Meal stack (msl grammar per `docs/design/SC_PRINT_MEALSTACK_ADDENDUM.html`, corrective wave)**: full-cell-width flex rows, one per service - `<span class="r"><n>ServiceName</n><v>Count</v></span>` - with a hairline rule and a bold `<span class="t"><n>Total</n><v>Sum</v></span>` row. Service names print **verbatim** (case preserved - `Pre-game` ≠ `Pre-Game`); long names wrap via `overflow-wrap: anywhere`. **Exclusion is `is_non_revenue === true` ONLY** (R3) - the pre-corrective wave name regex is retired; flat-fee services like Coffee Service and Fountain Bev print like any other row. Included services = every row with a non-zero value for the state's key (`actualCount` when SERVED, `projectedCount` when PROJECTED). **Density**: when the month's densest day carries more than 4 services with non-zero counts, the loader stamps `.dense` on the table + emits a `console.warn` identifying the month, and the CSS steps the line font to a 6.5px floor (Total 7.5px). Cell height is 108px; the `.msl` container is absolute-positioned with reserved bottom (`.hm .msl { bottom: 30px }`, `.aw .msl { bottom: 20px }`) so game info stays visible under the stack.
- **Season - MLB / AAA full-schedule** (spec Sheets 1 + 2, polish wave 2026-07-13, #428 amendment): **letter portrait, 3-column month grid, one page** per Kevin's M1 ruling. Day numbers (5.5px, top-left) in each cell; HOME (navy fill + opponent + compact time + optional " DH") + AWAY (light fill + opponent code only, no time). Counts `N H · N A`. **Cell time strips the trailing TZ suffix** (` ET` / ` CT` / ` MT` / ` PT`) per the #428 season-squish fix - TZ context travels via the `Times local · {tz}` legend note. Applies to every variant including MLB (MLB seasons had the ET on tile times pre-#428 too; the strip runs unconditionally in `buildSeasonMonthCells`). Legend: `Home Game` + `@AWAY` + `Times local · ET` (DAY GAME + DH · DOUBLEHEADER dropped from legend per M2; cell styling for both stays - copper day-game time still renders, DH affix still renders on doubleheader dates). Square tiles via `aspect-ratio: 1/1` on `.sg span`.
- **Season - PDC overlay (blended SERVICE CALENDAR)** (spec Sheet 3, polish wave 2026-07-13, #428 amendment): **letter portrait, 3-column month grid, one page** - flipped from landscape after square tiles broke the landscape 3-col layout to two pages (S3 fallback: "if squares break the page, flip this variant to portrait and flag it"). Ghost renamed from "HOME SCHEDULE" to "SERVICE CALENDAR". Service days layer under the affiliate HOME games via `opsServiceState` collapse - **one green means entered OR past-and-expected OR future-with-projection**, running continuously from season start to end (S2). Home-game style always wins the cell on game days. **Cell time strips the TZ suffix** per the #428 season-squish fix (same mechanism as MLB / AAA seasons). Counts stay `N HOME` (affiliate games only; the account is home-only by design). Legend: `SERVICE DAY` + `NO SERVICE` + `Home Game` + `Times local · ET` (S1: DAY GAME + DH · DOUBLEHEADER dropped from legend).
- **Ops Calendar** (spec Sheet 4, polish wave 2026-07-13): letter portrait; **12 mini-months in a 4-column × 3-row grid** (was 3-col × 4-row pre-polish - the reflow was needed to hold square tiles + 6-cell-row months on one page). Square tiles via `aspect-ratio: 1/1` on `.yg span`. Grid separation uses the darker `--grid` `#C9C3B5` token (G1) for paper definition.
  - **Non-MLB accounts** (PDC, PDCO, AAA): **SERVICE DAY collapse** via `opsServiceState` - single green (`.svc`) replaces the SERVED / PROJECTED / NO ACTUALS split from the pre-polish 4-state model on this overview surface. `no-service` stays baseline soft. Period start (`.ps`) navy square replaces day number. Spring (`.spb`) 2.5px copper top bar - kept ONLY at year scale. M + F header chips. Legend (data-driven per O4 park amendment): `SERVICE DAY` + `PERIOD START` + `SPRING` (mini day-cell swatch with copper top bar via `.kk-spring`) + `M INVOICE / CC EOD MONDAY` + `F ACTUALS EOD FRIDAY`. Trailer: `AS OF {date}` only.
  - **MLB accounts** (level === "MLB", R5 superseded 2026-07-13): **NO state layer**. Plain day cells everywhere - no green, no copper, no soft fill - because MLB actuals are Kevin's test entries and the intranet has no actuals-owed concept for MLB accounts. Period-start navy squares stay. **M chip only** (F chip dropped - no actuals deadline exists). Legend: `PERIOD START` + `M INVOICE / CC EOD MONDAY`.
  - **Inventory-due ring: PARKED to 2027** per Kevin's O4 amendment (2026-07-13). CSS (`.yg .inv`, `.yg .ps.inv`, `.kk-inv` swatch) and legend logic stay in place as dormant machinery; `getInventoryDueIndex()` returns `{}` for every year until a 2027 schedule is entered in `src/lib/print/inventoryCalendar.js`. When the year's index is empty, the ring never renders on any variant AND the `INVENTORY DUE` legend entry is data-driven-omitted. Re-enable procedure documented at the O4 section below.
  - **Games do NOT appear on any variant.**
- **Overview vs drill SERVICE DAY vs 4-state**: Kevin's polish wave collapses the four states (SERVED / PROJECTED / NO ACTUALS / NO SERVICE) into a single `SERVICE DAY` green on the two OVERVIEW surfaces (Ops Calendar non-MLB + Season blended). The DRILL sheets (Month + Period) keep the 4-state model pending a design-side redesign discussion. `opsServiceState()` in `src/lib/print/assets.js` handles the overview collapse; `resolveDayState()` is untouched.

### resolveDayState() contract

The single mapping from classifier `day.status` to a v2 print state, in `src/lib/print/assets.js`. **Exhaustive** against every status observed in `sc_daily_revenue`-derived output (`entered`, `no-service`, `overdue`, `needs-entry`, `future`, `away`) - the pre-corrective-wave fallthrough silently dropped `future` (Bug 4) and `away`. Every classifier status has an explicit branch; unknown statuses `console.warn` and return `null`.

Signature: `resolveDayState(day, opts)` where `opts.accountLevel` is the R5 MLB gate. Callers thread the account level in explicitly:

- `opsCalendarSheet.js` - `renderCell(iso, d, statusByDate, periodStarts, springDates, opts)` receives opts + calls `resolveDayState(stat, { accountLevel })`.
- `monthSheet.js` - `renderCell()` reads `account.level` from ctx and calls `resolveDayState(stat, { accountLevel: account.level })`.
- `seasonSheet.js` - `buildSeasonMonthCells(..., accountLevel)` threads level to `seasonServiceState(stat, { accountLevel })`.

The R5 gate returns null before any status match, so MLB accounts never render state cells regardless of what `sc_daily_revenue` says.

### Day-level state flags (R2)

`loadMonthData` and `loadYearSummary` in `src/lib/dataStore/serviceCalendar.js` emit day-level `hasActuals` + `hasProjection` booleans (true if ANY service on the day carries the respective value, mirroring the per-service `sc_daily_revenue.has_actuals` / `.has_projection` view fields). The additive fields feed print's `resolveDayState` future-day branch (`hasProjection && !hasActuals → PROJECTED`); existing screen consumers that read `hasAnyActuals` remain unchanged. Without these day-level flags, the `future` classifier status silently dropped to `null` (Bug 4: TBJ - FL green died after early July).

### Period pills (#428 amendment, 2026-07-13)

Every day cell that is the FIRST date of a fiscal period renders a **navy-fill pill labeled `Pn STARTS`** at the top-right. Every day cell that is the LAST date of a fiscal period renders a **navy-outline pill labeled `Pn ENDS`** at the top-right. Applies to every drill variant (MLB, AAA, PDC, PDCO) at both month and period scope.

**Supersedes** the v2 spec's `Period-boundary line + in-grid Pn REMOVED` grammar - pills are the boundary marker on the drill grid, not the removed period-boundary rule from Wave 1. Title P-tag (e.g. `P7 - P8`) stays as summary metadata.

**Data**: `loadMonthPrintData` queries `sc_day_metadata` for the whole year and computes `periodPillStarts` (date → periodNumber) and `periodPillEnds` (date → periodNumber). Year-scoped fetch is required because the month grid range alone can't distinguish "actual period boundary" from "first visible date of an already-in-progress period." Both maps thread through the ctx into every variant's render path. Period-scope (`loadPeriodPrintData`) merges these from the first ctx since they're year-scoped, so E2 period-scope rendering carries the same pill logic across cross-month periods.

**Words vs bare**: the pill text is the words per Kevin's #428 amendment. Tested on the densest cell (TBJ - FL July 13, PROJECTED green cell with 3-row meal stack + P8 STARTS pill; text fits in the top-right corner without crowding the day number, stack, or opp/time). If a future density scenario forces bare-Pn fallback, a legend entry becomes mandatory.

**CSS**: `.ppill{position:absolute;top:6px;right:8px;font-size:6.5px;font-weight:800;padding:1.5px 4px;border-radius:6px;}` with `.ppill.s{background:var(--navy);color:#fff;}` and `.ppill.e{background:#fff;color:var(--navy);border:1.5px solid var(--navy);padding:0 3.5px;}`.

**Conflict rule**: if a single date carries both an END and the next period's START, ENDS wins visual priority (outline over fill) so the pill outline stays legible. In practice `sc_day_metadata` yields consecutive dates for boundaries (e.g. P7 ends 7/12, P8 starts 7/13), not colinear ones, so the conflict doesn't fire on the current 2026 schedule.

**Period-scope call**: the #428 brief scoped pills to month sheets. This implementation extends pill rendering to period-scope drill sheets too (STL - FL P8 shows P8 STARTS on the 7/13 corner + P8 ENDS on the 8/9 corner) - flagged as a visible divergence in the PR body for Kevin's veto rather than choosing silently. If Kevin vetoes, the fix is a one-line variant gate at `renderCell` on the period-scope path.

### Grid engine (polish wave 2026-07-13)

Two root fixes applied to all drill scopes and variants:

- **E1**: month grid is no longer a fixed 6 rows (42 cells). `buildMonthGrid()` now pops any trailing row that is entirely out-of-month. In-week spillover cells (Jul 1-5 sharing June's final week) are correct and kept; a fully-ghost trailing row was the bug. Months like Feb / Jul 2026 render 5 rows; months like Aug / Nov 2026 keep 6 rows because their 6th week contains at least one in-month day.
- **E2**: period scope renders the period's WEEKS, not the calendar month containing the period start. `loadPeriodPrintData()` computes `[periodStart, periodEnd]` from `sc_day_metadata.period`, calls `loadMonthData` for every month the period touches (usually 1-2), merges the status + services + homestand + period maps, and builds a period-scoped grid via `buildPeriodGrid()`. Rows run from the Monday of `periodStart`'s week through the Sunday of `periodEnd`'s week; cells outside `[periodStart, periodEnd]` ghost via the same `outOfMonth` flag the renderer already treats as blank. STL - FL P7 renders 4 weeks (Jun 15 - Jul 12); STL - FL P8 renders 4 weeks (Jul 13 - Aug 9).

### Inventory due-date calendar (O4) - PARKED (2026), returns with 2027

**Status (2026-07-13, polish-wave O4 amendment)**: PARKED. Kevin's ruling: no inventory due dates on the calendar this year. The ring surface returns with the 2027 schedule. Implementation is dormant, not deleted: `src/lib/print/inventoryCalendar.js` `getInventoryDueIndex()` returns `{}` for every year until a 2027 schedule is entered; the ring CSS (`.yg .inv`, `.yg .ps.inv`, `.kk-inv` swatch) stays in `src/lib/print/assets.js` as dormant machinery; the Ops Calendar legend is data-driven and omits the `INVENTORY DUE` entry on every variant (MLB included) whenever the year's index is empty.

**Why the flip**: the pre-merge diff (see PR #426 comment) surfaced that Kevin's supplied 2026 schedule diverged from the Sheets HUB `period_data.dueDate` column for 7 of 13 periods (P1-P7; deltas +1 to +48 days). The Sheets HUB is what the notification-bell cron (`src/app/api/cron/daily/route.js`) reads to fire "Inventory due in Nd" events. Printing rings that disagree with the bell would fragment the operator's mental model, and reconciling the 2026 numbers isn't the wave's job. Parking is the honest move.

### Re-enable procedure (2027)

When the 2027 schedule is authored:

1. **Diff against Sheets HUB first**. Read `period_data` via `src/lib/opsUtils.js` `getPeriods()`; compare each period's `dueDate` column to the intended 2027 code-constant value. Any mismatch is a finding Kevin rules on BEFORE anything ships. The printed ring and the notification bell must agree - use the same table format as the 2026 pre-merge check for verbatim reporting.
2. **Populate `INVENTORY_DUE_2027`** in `src/lib/print/inventoryCalendar.js` following the reference block preserved in that file's comment (Kevin's 2026 schedule kept verbatim with the P1 + P2 shared-3/14 flag).
3. **Add the year branch** to `getInventoryDueIndex()`: `if (year === 2027) return INVENTORY_DUE_INDEX_2027;`.
4. **Regenerate the four Ops Calendar PDFs**, verify rings render on the intended dates + the `INVENTORY DUE` legend entry reappears via the data-driven check.
5. Retire the parked note in `inventoryCalendar.js` header + update this section back to LIVE.

### Reference: Kevin's 2026 schedule (parked, not active)

Preserved so the 2027 authoring can compare intent + pattern. NOT used by the current build - `getInventoryDueIndex(2026)` returns `{}`.

| Period | Due date | Notes |
|---|---|---|
| P1 | 2026-03-14 | shared with P2 - flagged |
| P2 | 2026-03-14 | shared with P1 - flagged |
| P3 | 2026-03-26 | |
| P4 | 2026-04-22 | |
| P5 | 2026-05-19 | |
| P6 | 2026-06-16 | |
| P7 | 2026-07-13 | composite: also P8 period start (ring-on-navy target when re-enabled) |
| P8 | 2026-08-09 | |
| P9 | 2026-09-06 | |
| P10 | 2026-10-04 | |
| P11 | 2026-11-01 | |
| P12 | 2026-11-29 | |
| P13 | 2026-12-27 | |

**O4 micro-census verdict (2026-07-13)**: no PG source exists for inventory due dates. Probed exhaustively (`sc_period_data`, `sc_periods`, `period_data`, `fiscal_periods`, `sc_fiscal_periods`, `sc_period_dates`, `sc_calendar_periods`, and ~20 other name variants including `inventory_*`, `inv_due_dates`, `sc_inv_due_dates` - all return "table not found in schema cache"). Sheets HUB `period_data` tab remains the sole source in the codebase, read by `src/lib/opsUtils.js` `getPeriods()` (columns: label, start, end, dueDate) and `src/app/api/cron/daily/route.js` (notification scheduler). Precedent for the code-constant approach kept in place: `src/app/service-calendar/season/phaseCalendar.js` `PER_ACCOUNT_2026`.

### Data sources (all in PG)

- **Per-day state**: `classifyDayStatus()` in `src/lib/dataStore/serviceCalendar.js` via `sc_daily_revenue` (has_actuals, has_projection, actual_count, projected_count, game_type). Same source the operator sees on screen 1:1.
- **Period dates**: `sc_day_metadata.period` per-day; `loadYearSummary` builds `periodRanges: [{period, start, end}]` used by both the on-screen chrome and the Ops Calendar's period-start squares.
- **Games**: `sc_homestand_schedule` (HOME + AWAY for schedule accounts; GAME rows only for overlay accounts).
- **Spring blocks**: `phaseCalendar.js` `PER_ACCOUNT_2026` (5 PDC accounts).
- **Timezone (game times)**: `ACCOUNT_HOME_TZ` in `src/app/service-calendar/gameTimeFormat.js`. No new map needed.

### Fonts + seal

Fonts self-hosted (Bebas Neue + Mulish 400/600/700/800) via `@fontsource/*` packages, inlined as data URIs into `<head>` at render time - zero runtime Google Fonts fetch. KitchFix seal from `public/PFS_PrimaryLogo_White_Circle.png`, inlined as data URI in the brand band.

### Export UI (`ExportControl.js`)

Flat list of format-explicit menu items:
- Drill-in (period / month): Excel this scope / PDF this scope / Excel full year fallback.
- Overview (year): Excel full year / PDF - season schedule (schedule accounts only, blended service-calendar variant for overlay accounts) / **PDF - ops calendar** (ALL accounts; label renamed from "year at a glance" in Wave 3).

### Local proof (per Kevin's ruling)

`scripts/sc-print/gen-all-pdfs.mjs` runs loader → renderer → puppeteer end-to-end on the developer's machine. Kevin's SSO click is confirmation, not discovery. Attach all PDFs to the PR body; artifacts folder is gitignored.

`scripts/sc-print/loader-smoke.mjs` exercises every print loader across representative account shapes as the regression guard.

**Route**: `GET /api/service-calendar/print`
- Query params: `account` (canonical spaced form), `scope` (`month` | `period` | `season`), `year` (YYYY), `month` (YYYY-MM, when scope=month), `period` (N or PN, when scope=period).
- Session-gated (401 for anonymous). Same shape as the xlsx route at `/api/service-calendar/export`.
- Runtime: `nodejs` (edge cannot spawn a subprocess). `maxDuration: 60` covers chromium cold-start + render.
- Returns `application/pdf` with `Content-Disposition: inline; filename=KitchFix_SC_<Account>_<Slug>_<YYYY-MM-DD>.pdf`.
- `X-SC-Print-Ms` timing header on the response.

**Mechanism**: `puppeteer-core` + `@sparticuz/chromium` — serverless headless Chrome renders the HTML sheet templates to PDF. Chromium tarball (~55MB) is bundled ONLY into this route's function via `next.config.mjs` `outputFileTracingIncludes`, keeping it off every other function. Fonts (Bebas Neue + Mulish 400/600/700/800) are self-hosted via `@fontsource/*` packages and inlined as data URIs into `<head>` at render time - zero runtime Google Fonts fetch. The KitchFix seal is read from `public/PFS_PrimaryLogo_White_Circle.png` and inlined as a data URI in the brand band.

**Pixel authority**: `docs/design/SC_PRINT_SPEC_v1.html` (Kevin-approved 2026-07-13). When the module code and the spec disagree, the spec wins.

**Sheets**:
- **Month** - available for ALL accounts. Fee accounts render homestand games via sc-13/15; per-meal PDCs may have game-free months and the grid renders honestly either way. Spring row = 3px copper (`#C2410C`) inset bottom band on any week that intersects a `phaseCalendar.js` spring block. Period boundary = 2px navy top rule on the first week row of a new fiscal period plus a micro `Pn` mark in the first day cell. Day game = first pitch before 2 PM account-local -> copper time; timezone derived from `src/app/service-calendar/gameTimeFormat.js` `ACCOUNT_HOME_TZ`.
- **Period** - same template as Month. Title row swaps to `PERIOD 8` + fiscal-range `FEB 16 - MAR 15`. Grid = calendar month containing the period start; out-of-period cells render as blank spillover. All other treatments (spring, P-boundary, day-game, NS, footer legend) identical to Month.
- **Season** - available only for accounts with `has_homestand_schedule` OR `has_schedule_overlay`. Full-schedule accounts render both HOME (navy fill, opponent + time + optional " DH" affix) and AWAY (light fill, opponent code only, no time); overlay accounts (STL - FL, TBJ - FL) get the `HOME SCHEDULE` right-ghost variant and `N HOME` count in each month header - their data is home-only by design (66 rows) and the sheet says so honestly. Season-ends trim + micro `SEASON ENDS SEP 20` label under the final month.
- **Year** (Wave 2, #420) - letter portrait. Twelve mini-months in a 3-column grid; each is a 28-cell (7-column x 4-row) sparkline. Cell grammar: `svc` default = tan (`#E9E6DC`, service day), `.sp` = copper wash (`#EFC5A9`, day inside a Spring Training block), `.gm` = solid navy (`#16305E`, home game day), `.of` = hollow hairline (weekly off default at column 7). Priority: game > spring > weekday-off > service. HOME games only (away days render as ordinary service or off). **Offseason honesty**: derived from data. Only schedule-carrying accounts (`has_homestand_schedule || has_schedule_overlay`) trigger the collapse; a month is "empty" iff zero games + zero spring days, and a run of >= 2 trailing empty months collapses into a single `OFFSEASON - {MON} - {MON}` panel spanning the full grid. Non-trailing empty months render as mini-grids for calendar completeness. Per-meal PDCs without schedules (e.g. CIN - AZ) render all 12 months - their "empty" months carry the spring cells (Feb/Mar for the 5 PDC accounts) which is the "service rhythm on a page" framing.

**Export UI** (`src/app/service-calendar/season/ExportControl.js`) - flat list of format-explicit menu items (UX shape: flat list rather than a Format submenu; picked flat because the list stays at <= 3 items). Drill-in (period/month) shows Excel this scope / PDF this scope / Excel full year fallback. Overview (year) shows Excel full year / PDF - season schedule (schedule-accounts-only) / PDF - year at a glance (ALL accounts).

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
