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

1. **Final design polishes** (PR #418, this PR): spring wedge color, chrome-bar wrap regression, notes cache staleness.
2. **PDF schedule export** for overview + drill-down (renders-first before any build): MLB / MiLB full-season game schedules; STL - FL / TBJ - FL their affiliate home slates.
3. **Full pricing alignment** across all accounts to 100% accuracy including off-contract specifics (Kevin supplies), then client bill export.
4. **Full-scale system + codebase test, cleanup, drop the Coming Soon gate → desktop DONE**. Absorbs the prior "Coming Soon gate drop" item + overall webapp function review + SC-011 (200% zoom parked for this pass).
5. **Mobile** (details TBC).

### Roster indicators (survey Task 6, deferred by default)

- **State**: rosters were surveyed and found deeply disconnected from kitchen-relevant headcount signal (players don't include kitchen staff, extended-camp bodies, or rehab bodies in a useful way).
- **Default stance**: skeptical - would need a specific Kevin hypothesis about a phase where roster count actually predicts kitchen volume before building.
- **Owner**: Kevin (hypothesis first).

---

## Dead doc candidates (Kevin decides - no unilateral action)

These docs are session-log style or bundle-recon-style, superseded by shipped state + the new canonical docs above. Propose archive to `docs/archive/`.

- `docs/HANDOFF_CC.md` (2026-07-02) - CC handoff for the pre-audit drill-in polish arc.
- `docs/HANDOFF_CHAT.md` (2026-07-02) - chat-side handoff of the same arc.
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
