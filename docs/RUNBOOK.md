# Runbook - KitchFix Ops Hub

> **Purpose:** How to do operational things on this system. If you can't find the procedure here, add it after you've done it once.
>
> **Last verified:** 2026-07-12
> **Rule:** Every change to infrastructure must update this doc in the same commit.

---

## Standard development loop

1. Confirm you're at the working directory (currently `~/dev/kf-cell-states` on Kevin's local; historical value: `~/dev/kitchfix-intranet`) and on main with clean tree:
pwd && git status && git branch --show-current
2. Pull latest: `git pull origin main`
3. Create feature branch: `git checkout -b type/short-description`
   - Type prefixes: `chore/`, `fix/`, `feat/`, `docs/`, `refactor/`, `test/`
4. Make changes (manually or via Claude Code)
5. Test on localhost: `npm run dev`
6. Commit: `git add -A && git commit -m "lowercase terse message"`
7. Push branch: `git push -u origin branch-name`
8. Verify Vercel preview deploys cleanly
9. Open PR via GitHub
10. Merge via GitHub UI (squash or regular merge - either is fine)
11. Pull main locally: `git checkout main && git pull origin main`
12. Delete local branch: `git branch -d branch-name`

## How to roll back a bad deploy

**Fastest path - Vercel instant rollback:**

1. Go to https://vercel.com/kitchfix-intranets-projects/kitchfix-intranet/deployments
2. Find the last known-good production deployment (look for green "Ready" + "Current" badges in the past)
3. Click the `…` menu on that deployment → "Promote to Production"
4. Confirm. Vercel reroutes production traffic to that deployment within ~10 seconds.
5. Open `https://kitchfix-intranet.vercel.app` and verify the site is healthy.

**Then fix the underlying issue:**

1. Open the PR that caused the bad deploy
2. Either revert it (`git revert <commit-sha>`) on main, or push a fix-forward branch
3. Once fixed and merged, Vercel will deploy the new main; the rollback becomes moot

## How to add a new environment variable

1. In Vercel: Project Settings → Environments → click the relevant environment (Production / Preview / Development)
2. Add the variable. Decide scope - usually "Production and Preview" (rarely Production-only)
3. Update local `.env.local` with the same value
4. Update `docs/ENV_VARS.md` with the variable name, one-line description, and which module uses it
5. Commit the doc update - same commit as the code change that uses the new var
6. Trigger a redeploy if Vercel didn't auto-detect

## How to invite a new user

KitchFix uses Google Workspace OAuth. There is no user table to add to.

1. Add the user to Google Workspace if they're not already in `@kitchfix.com`
2. Tell them to visit `https://kitchfix-intranet.vercel.app` and sign in with their Google account
3. First login self-provisions their session - no admin action needed
4. To grant admin access to specific modules, add their email to the relevant tab in the HUB sheet:
   - Ops Hub admin: `OPS_LEADERSHIP_EMAILS` constant (in code - Phase 1 backlog: move to HUB)
   - People Portal admin: `admins` tab in HUB
   - Analytics admin: hardcoded to `k.fietek@kitchfix.com` (in code)
   - Service Calendar admin: k.fietek + j.curtin

## How to restore a Google Sheet from backup

Daily backups run via `/api/cron/backup-sheets` at 06:00 UTC (01:00 CT). Backups land in Drive folder ID `1-Gedxfa0-e0FT6b562qx4Z_fIkj1oQtI` ("Ops Hub - Sheet Backups"). Covered: HUB, COLLECTION, GL_CODES, AI_LINE_ITEMS, INVENTORY. ANALYTICS is deliberately skipped (generated data, cell-quota sensitive).

Each backup is a full sheet copy named `{NAME}-backup-{YYYY-MM-DD}`. Retention is currently unlimited - backups accumulate; pruning is a future sub-cron.

### Scenario 1: A tab was wiped or corrupted (most common)

**Drilled and verified 2026-05-13.** Takes ~2 minutes.

1. Open the backup folder. Find the most recent good snapshot dated before the bad change. For yesterday's accidental wipe, that's the same-day backup if the wipe happened after 01:00 CT, or the prior day's if before.
2. Open the backup file. Find the tab that needs restoring.
3. Right-click the tab → **"Copy to" → "Existing spreadsheet"**.
4. In the picker, navigate to and select the live sheet (HUB, COLLECTION, etc.). Click **"Select"**.
5. Google copies the tab into the live sheet as `Copy of {tabname}`. The original (broken) tab is still there.
6. In the live sheet:
   - Rename the broken tab to `{tabname}_BROKEN_{YYYY-MM-DD}` (right-click → Rename). Don't delete it yet - keeps an audit trail.
   - Rename `Copy of {tabname}` to the original name `{tabname}` (right-click → Rename).
7. Reload any module that reads the restored tab. Confirm data is back.
8. After 24h of stable operation, delete the `_BROKEN_` tab.

### Scenario 2: An entire sheet is gone or corrupted (rare, catastrophic)

Not drilled yet - procedure is theoretical until tested. Schedule a drill before relying on this.

1. Open the most recent backup of the missing sheet.
2. File → Make a copy → name it `{ORIGINAL_NAME}_RESTORED_{YYYY-MM-DD}`.
3. Share the new copy with the service account `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com` as Editor.
4. Copy the new sheet's ID (from the URL).
5. Update the sheet ID:
   - If in `src/lib/sheets.js` constants → edit, commit, push, deploy.
   - If in env var → update on Vercel (Production + Preview), redeploy.
6. Verify by hitting an endpoint that reads from the restored sheet (e.g., `/api/dashboard` for HUB).
7. Document the incident in `docs/incidents/`.

### Don't drill on live sheets

To practice the procedure or verify a recent backup is intact:

1. Right-click the live sheet in Drive → "Make a copy" → name it `{ORIGINAL}-DRILL-{YYYY-MM-DD}`.
2. Run the wipe + restore on the drill copy. Zero risk to live data.
3. Delete the drill copy when done.

## How to rotate a secret

For the service account private key, OAuth client secret, or any API key:

1. Generate the new secret in the upstream service (Google Cloud Console, Anthropic Console, etc.)
2. In Vercel: Project Settings → Environments → update the env var in Production AND Preview
3. Update `.env.local` with the new value
4. **Do not commit the new value to git.** Verify `.env*` is in `.gitignore` (it is)
5. Test on localhost with new value
6. Push a no-op commit to trigger redeploy with new env vars
7. Verify production works
8. Revoke the old secret in the upstream service

## How to trigger a cron manually

Crons are at:

- `/api/cron/daily` - 13:00 UTC daily
- `/api/cron/incident-reminders` - 14:00 UTC daily
- `/api/people?action=generate-report&period=weekly` - Mondays 13:00 UTC
- `/api/people?action=generate-report&period=monthly` - 1st of month 13:00 UTC

To trigger manually:

```bash
curl -X GET "https://kitchfix-intranet.vercel.app/api/cron/daily" \
  -H "Authorization: Bearer $CRON_SECRET"
```

(Replace `$CRON_SECRET` with the value from Vercel env vars.)

## Analytics module deleted

The custom analytics system was decommissioned 2026-05-15 in PRs #31/#32/#33. There is no `/analytics` dashboard, no analytics cron, and no `logEvent*` writes anywhere in production code. `src/lib/analytics.js` exists only as a no-op stub (kept while `src/lib/auth.js` and `src/app/api/cron/incident-reminders/route.js` still import `logEventSA`; touching those files is out of scope for now).

Future analytics live outside this repo: **Sentry** (errors), **Vercel Analytics** (traffic), **Supabase dashboards** (operational data once Phase 3 ships). A custom analytics surface is not currently planned - see `docs/archive/migration/MIGRATION.md → Phase 3 commentary` (note: the original Phase 1-5 plan; partially superseded by `docs/SUPABASE_MIGRATION.md`).

## How to check production health

Quick checks:

- Visit `https://kitchfix-intranet.vercel.app` - login page should render
- Sign in and load `/` - dashboard should render with hero, news, celebrations
- Check Vercel deployments - top deployment should be "Ready" with green dot
- Check Sentry (once installed in Phase 1) - no new errors in last hour
- Check Better Stack (once installed in Phase 1) - `/api/health` returning 200

## Captain's log

*Add new procedures here as they're learned. Date, what prompted the addition, where it lives.*

- **2026-05-11** - Initial runbook captured during Phase 0. Standard dev loop, rollback, env var addition, user invite, sheet restore, secret rotation, manual cron trigger, health check.
- **2026-05-12** - Added "Analytics writes are feature-flagged off" section. Prompted by Phase 1 Task 12 (analytics sheet hit the 10M-cell limit; writes gated behind `ANALYTICS_ENABLED`, default off). Covers how to re-enable writes for debugging and why doing so isn't a fix.
- **2026-05-13** - Rewrote "How to restore a Google Sheet from backup" - backups went from "Phase 1 task" to live (`/api/cron/backup-sheets`, see PR #14). Documented two scenarios: tab-level restore (drilled and verified) and whole-sheet restore (theoretical, needs drilling). Added "drill on a copy" safety practice - never drill on live sheets.
- **2026-05-15** - Removed `/api/cron/analytics` from the manual-trigger list. Analytics dashboard + cron + dashboard API deleted in PR 1 of the 3-PR analytics teardown (callsite cleanup in PR 2, `src/lib/analytics.js` stubbing + `ANALYTICS_SHEET_ID` removal + full doc sweep in PR 3).
- **2026-05-15 (PR 3/3)** - Rewrote the "Analytics writes are feature-flagged off" section as "Analytics module deleted". `src/lib/analytics.js` reduced from 397 lines to a 12-line no-op stub exporting only `logEventSA`. Removed `ANALYTICS_SHEET_ID` and `ANALYTICS_ENABLED` env var references from this doc and `docs/ENV_VARS.md` - these env vars must also be removed from Vercel manually. Future analytics is Sentry/Vercel Analytics/Supabase, not a custom surface.
- **2026-07-12** - Added "TEST_MODE middleware bypass" + "PR-preview + nav-matrix CI" sections. TEST_MODE ships live via #407 (`src/middleware.js`); CI split into two-job matrix + preview-smoke via #408. Working-dir line acknowledges that the local checkout has moved from `~/dev/kitchfix-intranet` to `~/dev/kf-cell-states` on the current machine. Last-verified header bumped.
- **2026-07-12 (later)** - Added "Confirming a migration-gated PR" procedure. Migration gate CI shipped via PR #416 (`.github/workflows/migration-gate.yml`). Job A scans PR head for added `docs/migrations/*.sql`; Job B validates the `applied in Studio: YES` confirmation from the repo OWNER and emits a `Migration gate` check_run on the PR head SHA. Per-SHA reset means a confirmation never outlives the code. Kevin adds `Migration gate` as a required status check on the `main protection` ruleset after PR #416 lands - from that click, migration-bearing PRs are mechanically unmergeable until the confirmation fires.
- **2026-07-13** - Added "SC print PDF export (Wave 1, #419)" section. New route `/api/service-calendar/print` renders schedule sheets via `puppeteer-core` + `@sparticuz/chromium` (~55MB chromium tarball). Bundle scoped to just this route via `next.config.mjs` `outputFileTracingIncludes`; other functions stay lean. Fonts self-hosted (`@fontsource/bebas-neue` + `@fontsource/mulish`), no runtime Google Fonts fetch. Cold-start budget: 2-4s for chromium extraction. `maxDuration: 60`. No new env vars.
- **2026-07-13 (later)** - Wave 2 (#420) added Year sheet to `/api/service-calendar/print`. Route accepts `scope=year` in addition to month/period/season; letter portrait vs the other three's letter landscape via a per-scope `landscape` flag on `page.pdf()`. No new deps, no new env vars, no schema changes. Same operational profile (cold-start, deploy size, failure mode) as Wave 1.
- **2026-07-13 (Wave 3)** - `#422` v2 restyle. Four sheets rebuilt to `docs/design/SC_PRINT_SPEC_v2.html`. New state model (SERVED / PROJECTED / NO ACTUALS / NO SERVICE) applied across every service-bearing sheet; Year sheet retired and replaced by Ops Calendar (letter portrait, period-start navy squares + spring 2.5px copper top bar + M/F header chips; games do NOT appear). Sheet 5 MLB/MiLB variant untouched (approved). Sheets 6/7 gain state fills + PDC meal stacks. Season sheets gain day numbers + AWAY cells; overlay PDCs get the blended SERVICE CALENDAR variant. No new deps, no new env vars, no schema changes. **Inventory-due glyph deferred** pending a follow-up `period_data` → PG migration PR (period_data currently in Sheets HUB, gates the daily-notifications cron too). Print-tuned green pair diverges intentionally from `--status-entered-bg` for paper survival.
- **2026-07-13 (corrective wave)** - Post-Wave-3 four-bug corrective. Landed on top of `#423` (which had already patched .awy grey + PDCO stack scope + meal-stack content). Four fixes: (1) MLB month blank + (2) MiLB month games missing - `loadMonthPrintData` now queries `sc_homestand_schedule` directly via existing `loadHomestandContext` / `loadScheduleOverlay` helpers; the dead `monthData.days[i].dayType` mapping loop is deleted. (3) PDF - season schedule menu item unlocked for the six homestand accounts - `src/app/api/service-calendar/route.js` sc-load payload now emits `hasHomestandSchedule` alongside `hasScheduleOverlay`. (4) TBJ - FL PROJECTED-green flip - `loadMonthData` + `loadYearSummary` emit day-level `hasActuals` + `hasProjection` additively; `resolveDayState` is now exhaustive against the six observed classifier statuses (unknown = `console.warn`). Meal-stack rebuilt to the `msl` grammar in `docs/design/SC_PRINT_MEALSTACK_ADDENDUM.html`: full-cell-width rows, verbatim service names (case preserved), `is_non_revenue`-only exclusion (name regex retired), density detector + 6.5px floor + `console.warn` for the month that hit it. Applied to PDC + PDCO + AAA variants (R4); MLB stays stack-free. Past game days without actuals render NO ACTUALS + game info + no numbers (R6). MLB accounts get zero state layer on any print surface (R5 superseded) - Ops Calendar MLB variant: plain day cells + period-start navy + M chip only (F dropped), legend slimmed to PERIOD START + INVOICE/CC EOD. `resolveDayState` opts.accountLevel gates the MLB path explicitly (not silent fallthrough). Cell height bumped 84 → 108px so 4-row stack + game info fits. Contact-sheet law: every future print PR must convert each PDF via `pdftoppm`, view every PNG, and post a paragraph per sheet in the PR body.
- **2026-07-13 (polish wave)** - Kevin's export-tour feedback. G1: print-only `--grid` `#C9C3B5` token (~2 shades darker than `--hair`) applied to cell borders for paper definition. Overview surfaces (Ops Calendar non-MLB + Season overlay-blended) collapse the 4-state model to a single **SERVICE DAY** green via `opsServiceState()` in `assets.js` - `resolveDayState()` unchanged (drill sheets keep the 4-state). Ops Calendar: 4-col × 3-row mini-month layout with square tiles (`aspect-ratio: 1/1`). Legend picks up mini spring swatch (`.kk-spring`); DAY GAME chip dropped from season + MLB/AAA drill legends. Season MLB/AAA + PDCO all flip to portrait 3-col month grid (S3 fallback for overlay after square tiles broke landscape). Season legend renames `HOME · OPPONENT + FIRST PITCH {TZ}` → `Home Game`; DH · DOUBLEHEADER dropped from legend (cell affix stays). MLB + AAA drill: shorter cells (78 / 88px), DAY GAME dropped from legend, footer suffix (`SERVED = ACTUALS ENTERED · PROJECTED AFTER`) dropped. PDCO drill cells nudged 108 → 100px as a page-fit accommodation (styling untouched pending redesign discussion). Grid engine: (E1) fixed 6-row month grid killed - trailing all-out-of-month rows are popped; in-week spillover kept. (E2) period scope now renders period's WEEKS, not the containing calendar month - `loadPeriodPrintData` fetches every month the period touches, merges maps, builds a period-scoped grid; STL - FL P7 = 4 weeks, P8 = 4 weeks. NEW page-count gate: `pdfinfo` MUST report 1 page per PDF (mechanical check runs on every print PR now). PDC/PDCO drill styling explicitly out of scope beyond G1 + grid engine, pending design-side redesign discussion. No new deps, no schema changes, no migrations.
- **2026-07-13 (polish wave O4 amendment)** - Kevin's post-review ruling: inventory-due ring PARKED to 2027. Trigger: pre-merge diff surfaced 7-of-13 mismatches between Kevin's supplied 2026 schedule and the Sheets HUB `period_data.dueDate` column (see PR #426 comment); printing rings that disagree with the notification-bell cron would fragment the operator's mental model. Reconciling 2026 wasn't the wave's job. Dormancy pattern: `src/lib/print/inventoryCalendar.js` `getInventoryDueIndex()` returns `{}` for every year until a 2027 schedule is entered; ring CSS (`.yg .inv`, `.yg .ps.inv`, `.kk-inv`) stays in `assets.js` as one-file-away re-enable; Ops Calendar legend is data-driven and omits the `INVENTORY DUE` entry when the year's index is empty (this year: absent on every variant including MLB). Kevin's 2026 schedule preserved verbatim as REFERENCE in the calendar file's comment for the 2027 authoring pass. Re-enable procedure documented in `docs/modules/SERVICE_CALENDAR.md`: (1) HUB diff first, (2) reconcile any mismatch before shipping, (3) populate `INVENTORY_DUE_2027`, (4) regen + verify. Regenerated the four Ops Calendar PDFs to prove absence: zero rings anywhere, no legend entry. Other 10 PDFs byte-identical to the pre-amendment set.

---

## SC print PDF export (Wave 1, #419)

`GET /api/service-calendar/print` renders Month / Period / Season sheets to PDF via serverless headless Chrome. Session-gated; returns `application/pdf`. Same shape as the xlsx export at `/api/service-calendar/export`.

Operational notes:
- **Deps**: `puppeteer-core` (~7MB) + `@sparticuz/chromium` (~67MB including a ~55MB chromium tarball) + `@fontsource/bebas-neue` + `@fontsource/mulish` (fonts self-hosted per Kevin's guardrail: no runtime Google Fonts fetch).
- **Bundle scoping**: `next.config.mjs` `outputFileTracingIncludes` scopes the chromium tarball + font WOFF2s + KitchFix seal to `/api/service-calendar/print` ONLY. Other functions stay lean.
- **Cold start**: expect 2-4s for chromium tarball extraction on the first invocation after a deploy (extracts into `/tmp`, reuses on warm invocations). Warm renders complete in <1s for a single sheet.
- **Runtime**: `node` (edge cannot spawn a subprocess). `maxDuration: 60`.
- **No new env vars**.
- **Failure mode**: on error, the route returns `500 { success: false, error, phase, elapsedMs }` as JSON so the browser never receives a broken .pdf download.

Spec authority: `docs/design/SC_PRINT_SPEC_v1.html` (Kevin-approved 2026-07-13). Module reference: `docs/modules/SERVICE_CALENDAR.md` "Printable schedules".

## Confirming a migration-gated PR (LIVE since #416)

Any PR adding a file under `docs/migrations/*.sql` opens with a **red `Migration gate` check** (from `.github/workflows/migration-gate.yml` Job A). The `main protection` ruleset requires this check, so the merge button is locked until it flips green. Procedure:

1. **Apply the SQL in Supabase Studio.** Paste the migration file's `BEGIN`/`COMMIT` block, run, wait for confirmation. This is the actual work; everything below is just recording it.
2. **Run the verify probes.** Each migration file includes commented-out probe blocks at the bottom. Uncomment individually and run against Studio to confirm row counts, column presence, flag distribution. Do not skip - the probes catch schema drift and typos before the reader deploys against a bad state.
3. **Post the canonical confirmation comment on the PR.** Comment body must contain the exact phrase `applied in Studio: YES`. Convention is to lead with `Migration gate: sc-XX applied in Studio: YES` for readability, but the matcher only requires the trailing phrase from an author with `author_association == 'OWNER'` (the repo owner).
4. **Watch the check flip.** Job B (`issue_comment` trigger, `confirm-and-emit`) fires within seconds, resolves the PR head SHA, and emits a `Migration gate` check_run as success on that SHA. The required-check aggregation reads the LATEST check by name; the merge button unlocks.
5. **Merge.** The `main protection` ruleset's PR requirement + all-review-threads-resolved still apply as usual.

**Per-SHA scope.** If a push lands on the PR after the confirmation, Job A re-runs on the new head. If migration files are still present in the new diff vs merge-base, the check goes red again and a fresh confirmation comment is required on the new SHA. This is deliberate: flip-and-merge (the 2026-07-12 failure class) cannot survive a push, and neither can accidentally-approved-then-changed migration content.

**Rejection paths (for future readers)**:
- Comment from a non-`OWNER` author with the phrase -> the workflow enters Job B, fails at the association check, and emits a red check_run on the DEFAULT BRANCH SHA (irrelevant to the PR). The PR's own red `Migration gate` from Job A stays put; the merge stays blocked.
- Comment on a closed/merged PR -> Job B fails defensively (doesn't emit a check on a stale head SHA).

## TEST_MODE middleware bypass (Playwright, LIVE)

`src/middleware.js` short-circuits at the top of the chain when `TEST_MODE === "true" AND VERCEL !== "1"`. Double-gated so a stray production export never opens the app. Value is set in the CI runner env (see `.github/workflows/e2e.yml` job A) or optionally in a local shell for Playwright development. Never on Vercel.

- **CI use**: job A boots the in-runner build with `TEST_MODE=true npx next start`. All data routes are stubbed via `page.route`.
- **Local use**: `TEST_MODE=true npm run dev` to iterate on Playwright specs without going through OAuth. Toggle off for anything that touches real auth.
- **Deep detail**: [`docs/TESTING.md`](TESTING.md) "TEST_MODE bypass".

## PR-preview + nav-matrix CI (LIVE)

`.github/workflows/e2e.yml` has two jobs since PR #408:

- **Job A (`matrix`)**: runs on `pull_request`. In-runner build + TEST_MODE + `tests/sc-nav-matrix.spec.ts` (26-URL matrix). Placeholder auth env vars (nothing to configure per PR).
- **Job B (`preview-smoke`)**: runs on `deployment_status`. Reads the PR's own Vercel preview URL from the event payload + runs a dependency-free smoke check. Accepts `2xx / 3xx / 401` as "serving" (Vercel Preview Protection returns 302 SSO).

Prior state (test against a hardcoded prod URL) is retired - `grep 'kitchfix-intranet.vercel.app' .github/workflows/e2e.yml` returns zero hits.