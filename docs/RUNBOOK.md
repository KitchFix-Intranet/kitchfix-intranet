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
- **2026-07-12 (later)** - Added "Confirming a migration-gated PR" procedure. Migration gate CI shipped via PR #415 (`.github/workflows/migration-gate.yml`). Job A scans PR head for added `docs/migrations/*.sql`; Job B validates the `applied in Studio: YES` confirmation from the repo OWNER and emits a `Migration gate` check_run on the PR head SHA. Per-SHA reset means a confirmation never outlives the code. Kevin adds `Migration gate` as a required status check on the `main protection` ruleset after PR #415 lands - from that click, migration-bearing PRs are mechanically unmergeable until the confirmation fires.

---

## Confirming a migration-gated PR (LIVE since #415)

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