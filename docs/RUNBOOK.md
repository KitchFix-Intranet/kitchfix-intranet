# Runbook — KitchFix Ops Hub

> **Purpose:** How to do operational things on this system. If you can't find the procedure here, add it after you've done it once.
>
> **Last verified:** 2026-05-11
> **Rule:** Every change to infrastructure must update this doc in the same commit.

---

## Standard development loop

1. Confirm you're at `~/dev/kitchfix-intranet` and on main with clean tree:
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
10. Merge via GitHub UI (squash or regular merge — either is fine)
11. Pull main locally: `git checkout main && git pull origin main`
12. Delete local branch: `git branch -d branch-name`

## How to roll back a bad deploy

**Fastest path — Vercel instant rollback:**

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
2. Add the variable. Decide scope — usually "Production and Preview" (rarely Production-only)
3. Update local `.env.local` with the same value
4. Update `docs/ENV_VARS.md` with the variable name, one-line description, and which module uses it
5. Commit the doc update — same commit as the code change that uses the new var
6. Trigger a redeploy if Vercel didn't auto-detect

## How to invite a new user

KitchFix uses Google Workspace OAuth. There is no user table to add to.

1. Add the user to Google Workspace if they're not already in `@kitchfix.com`
2. Tell them to visit `https://kitchfix-intranet.vercel.app` and sign in with their Google account
3. First login self-provisions their session — no admin action needed
4. To grant admin access to specific modules, add their email to the relevant tab in the HUB sheet:
   - Ops Hub admin: `OPS_LEADERSHIP_EMAILS` constant (in code — Phase 1 backlog: move to HUB)
   - People Portal admin: `admins` tab in HUB
   - Analytics admin: hardcoded to `k.fietek@kitchfix.com` (in code)
   - Service Calendar admin: k.fietek + j.curtin

## How to restore a Google Sheet from backup

Once daily Apps Script backups are running (Phase 1 task):

1. Open Drive folder: `KitchFix Sheet Backups / {sheet name}`
2. Find the most recent good snapshot dated before the bad change
3. Right-click → "Make a copy" → name it with today's date and "RESTORED"
4. Open the copy, verify the data looks correct
5. If the entire sheet is to be restored:
   - Copy the new sheet's ID (from the URL)
   - Update the sheet ID in `src/lib/sheets.js` constants (or env var if applicable)
   - Deploy
6. If only a tab needs to be restored:
   - In the production sheet, archive the broken tab (rename with `_BROKEN_<date>`)
   - In the snapshot copy, copy the good tab to the production sheet
7. Document the incident in a postmortem committed to `docs/incidents/`

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

- `/api/cron/daily` — 13:00 UTC daily
- `/api/cron/analytics` — 14:00 UTC daily
- `/api/cron/incident-reminders` — 14:00 UTC daily
- `/api/people?action=generate-report&period=weekly` — Mondays 13:00 UTC
- `/api/people?action=generate-report&period=monthly` — 1st of month 13:00 UTC

To trigger manually:

```bash
curl -X GET "https://kitchfix-intranet.vercel.app/api/cron/daily" \
  -H "Authorization: Bearer $CRON_SECRET"
```

(Replace `$CRON_SECRET` with the value from Vercel env vars.)

## How to check production health

Quick checks:

- Visit `https://kitchfix-intranet.vercel.app` — login page should render
- Sign in and load `/` — dashboard should render with hero, news, celebrations
- Check Vercel deployments — top deployment should be "Ready" with green dot
- Check Sentry (once installed in Phase 1) — no new errors in last hour
- Check Better Stack (once installed in Phase 1) — `/api/health` returning 200

## Captain's log

*Add new procedures here as they're learned. Date, what prompted the addition, where it lives.*

- **2026-05-11** — Initial runbook captured during Phase 0. Standard dev loop, rollback, env var addition, user invite, sheet restore, secret rotation, manual cron trigger, health check.
