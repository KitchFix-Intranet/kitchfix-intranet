# SC Status - shipped-state + remaining work

> **Purpose:** the live current-state doc for the Service Calendar module. Architecture reference = [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md). This doc is the ship-state audit + remaining-work punch list.
>
> **Last verified:** 2026-07-12
>
> **Ledger discipline:** every claim in "Shipped" traces to a PR#, commit, or migration file. Every item in "Remaining" says who's blocking it (Kevin ruling / Kevin schedule / no owner). Unknowns stay labeled unknown.

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
- **M-2 pending** as the envelope's first production consumer. Detail surface + click retarget on the pilot account.

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
