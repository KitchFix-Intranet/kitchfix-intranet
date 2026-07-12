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
- **sc-19** (#413) - Spring Training styling at three sites: dark-copper wedge on sm tiles (bottom-left, `#8A4A1B`), ST pill on lg drill-in tiles, chrome bar rider. Phase-driven scope: all 5 PDC accounts inherit automatically.
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

---

## Remaining work (as it actually stands)

Not "sized roadmap" - decisions and follow-ups with clear blockers.

### Dunedin verdict (sc-17b Studio-apply)

- **State**: sc-17b file exists on main. Whether Kevin has applied it in Studio is external state.
- **Ask**: Kevin confirms sc-17b applied. If yes, TBJ - FL overlay + inherited sc-18 wedges are LIVE. If no, state is code-live-data-empty (inert but safe).
- **Owner**: Kevin.

### CI migration-gate hardening (proposed, awaiting Kevin's go)

- **Motivation**: two silent-gap incidents in 48h (sc-16 07-11 pre-rule; sc-17 07-12 through the draft rule via flip-and-merge). CLAUDE.md's draft-PR rule is discipline, not enforcement.
- **Proposal**: workflow that scans PR head for new `docs/migrations/*.sql` and gates merge on an explicit review-comment ("sc-XX applied in Studio: YES") from Kevin.
- **State**: not designed, not built. Awaiting Kevin's go on the approach before scoping.
- **Owner**: Kevin (approval) + CC (build).

### CIN - AZ fee decision (awaiting Kevin)

- **Context**: CIN - AZ is PDC per_meal today. Per the API survey ([`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md) Task 2), Cactus League spring games at Goodyear could power a spring overlay for the account (same shape as sc-17/17b). But whether CIN - AZ should ever move to a fee-based billing shape is a separate business decision awaiting Kevin.
- **Owner**: Kevin.

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

### Coming Soon gate drop + function review

- **State**: SC is dev-gated behind Coming Soon per `docs/PROJECT_DASHBOARD.md`. Gate drop = launch.
- **Prerequisite**: overall webapp function review (per `PROJECT_DASHBOARD.md`'s "Active threads" next-step-4). SC-011 (200% zoom / text-scaling) parked for this conversation.
- **Owner**: Kevin.

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

Main IS protected via a **repository ruleset** named `main protection` (id 16364953), not the classic branch-protection API. The classic `GET /repos/.../branches/main/protection` endpoint returns 404 because rulesets are a separate surface (`GET /repos/.../rulesets` reveals them). The ruleset is `enforcement: active` with an empty `bypass_actors` list, so the rules apply to every actor including repo admins. Current rules: deletion blocked, non-fast-forward blocked, pull-request required (0 required approvals but stale reviews dismissed on push + all review threads must resolve before merge). All three merge methods (merge / squash / rebase) allowed. **The "no direct commits to main" convention is mechanically enforced.** The CI migration-gate hardening proposal above lands as a required status check added to this ruleset - the workflow emits a check keyed on Studio-apply confirmation and the ruleset requires the check to pass before merge unlocks.

---

## Pointers

- [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md) - architecture reference (two-flag model, data flow, visual system, phases, nav, migration index, rulings ledger)
- [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md) - money authority
- [`SC_PDC_PHASES.md`](SC_PDC_PHASES.md) - phase data source
- [`DESIGN_AUDIT_LEDGER.md`](DESIGN_AUDIT_LEDGER.md) - design-audit history
- [`SC_DRILLDOWN_DECISIONS.md`](SC_DRILLDOWN_DECISIONS.md) - global visual-parity levers
- [`audits/SC_17_INVESTIGATION_2026-07-11.md`](audits/SC_17_INVESTIGATION_2026-07-11.md) - two-flag rationale
- [`audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md`](audits/SC_MLB_API_DEPTH_SURVEY_2026-07-12.md) - API capability survey
