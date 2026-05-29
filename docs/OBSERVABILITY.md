# Observability - KitchFix Ops Hub

> **Last updated:** 2026-05-14
> **Owner:** Kevin Fietek
> **Scope:** Error monitoring via Sentry. Phase A complete. Phase B (Sheets API health) planned but not built.

---

## How to use this doc

Read before:
- Triaging a Sentry alert
- Changing any Sentry configuration
- Onboarding any future teammate to error response
- Deciding to upgrade Sentry tiers

This doc explains what's wired up, why, and how to operate it. It is intentionally opinionated - defaults reflect KitchFix's scale and constraints, not Sentry's marketing recommendations.

---

## What Sentry catches

| Layer | What's captured | Sample rate |
|---|---|---|
| Server-side (Node runtime) | API route errors, page render errors, server crashes | 30% on prod, 100% on preview |
| Edge runtime | Middleware errors, edge route errors | 30% on prod, 100% on preview |
| Client (browser) | Uncaught exceptions, errors during route transitions, errors in global error boundary | 100% always |
| Source maps | Production stack traces resolve to real file/line numbers | Auto-uploaded on every Vercel build |

## What Sentry does NOT catch

- Performance / span tracing (paid tier, deferred)
- Session replay - no video-like reproduction of user sessions (paid tier, deferred)
- Logs (paid tier, deferred)
- Sheets API rate-limit detection - see Phase B
- Cron jobs that fail to *fire* - Sentry only catches errors *inside* code that ran. If a cron never ran, no error to report. Future Slack-based heartbeats would cover this.
- Errors from local dev - \`enabled\` gate filters these out

## Configuration files (locked)

| File | Purpose | Notes |
|---|---|---|
| \`sentry.server.config.js\` | Server-side init | DSN from \`SENTRY_DSN\`, 30% prod sample rate |
| \`sentry.edge.config.js\` | Edge runtime init | Same pattern as server |
| \`src/instrumentation-client.js\` | Browser-side init | DSN from \`NEXT_PUBLIC_SENTRY_DSN\`, 100% sample rate |
| \`src/instrumentation.js\` | Wiring - loads server/edge configs at right time | Don't modify |
| \`src/app/global-error.jsx\` | Global error boundary for Next.js | Catches errors that escape page-level boundaries |
| \`next.config.mjs\` | Source map upload + project config | \`org: kitchfix\`, \`project: kitchfix-intranet\` |

## Why these defaults

**30% server sample rate on production.** Sentry's free tier is 5K errors/month. A single bad bug shipped to production can burn through 5K in a day. Sampling means we capture a representative slice without filling the quota during incidents. 30% is balanced between visibility and headroom.

**100% client sample rate.** Browser errors fire at much lower volume than server errors (1 user generates 1 error per session, vs server which sees every API call). 100% gives full visibility without quota risk.

**\`enabled\` gate.** Only Vercel deploys send events. Local dev errors stay local. Reason: dev errors are noise - failed hot reloads, intentional console errors, mid-typing bugs. Production and preview are the deployments worth monitoring.

**\`sendDefaultPii: true\`.** Sentry captures user email and IP automatically. Acceptable for an internal tool where all users have signed in and consented to internal data handling. **Revisit if KitchFix ever serves external tenants** (Phase 5 multi-tenancy) - at that point, PII capture becomes a compliance question.

**\`automaticVercelMonitors: false\`.** Sentry's Vercel cron monitoring requires Team tier and doesn't support App Router route handlers anyway. Disabled until both issues resolve.

## Environment variables

| Variable | Where | Required? |
|---|---|---|
| \`SENTRY_DSN\` | \`.env.local\` + Vercel (All Environments) | Yes - server reads this |
| \`NEXT_PUBLIC_SENTRY_DSN\` | \`.env.local\` + Vercel (All Environments) | Yes - client reads this |
| \`SENTRY_AUTH_TOKEN\` | \`.env.sentry-build-plugin\` (local) + Vercel (Production + Preview) | Yes - source map upload |

**Source map upload:** \`SENTRY_AUTH_TOKEN\` is an Organization Token (not Personal). Currently named \`kitchfix-intranet-build\` in Sentry. Scope: \`org:ci\`. If rotated, update both \`.env.sentry-build-plugin\` and Vercel.

**\`.env.sentry-build-plugin\` is gitignored.** The token is plaintext in this file. **Never paste this file's contents into chat, screenshots, or anywhere external.** This is documented in \`GOTCHAS.md\`.

---

## Alerts

### Current routing

| Alert rule | Channel | Trigger | Throttle |
|---|---|---|---|
| "Send a notification for high priority issues" | Slack \`#intranet-errors\` | New issue created in production | 30 min |

### Alert philosophy

The goal is **less than 5 alerts per week** in steady state. Anything more is noise; anything less is missing signal. Tune accordingly.

Avoid:
- Alerts on resolved-issue regressions (we don't need to be re-pinged for old bugs)
- Alerts on issue escalations (vague; doesn't help us decide what to do)
- Alerts on all events vs new issues (one bad bug = 100 pings)

### To add a new alert rule

1. Sentry → Issues → Alerts → Create Alert
2. Source: Project \`kitchfix-intranet\`
3. **Filter Issues: \`production\` only** (always - preview/dev noise is unwanted)
4. WHEN: a new issue is created (or specific condition)
5. THEN: Slack message to \`#intranet-errors\` workspace=KitchFix
6. Throttle: 30 min minimum

---

## Triage runbook

### Daily 5-minute check

Open Sentry once a day at a consistent time. Five minutes max. Look for:

- New unresolved issues in the last 24 hours
- Issue count climbing on existing issues
- "Affected users" count - 1 user × 50 events ≠ 50 users × 1 event

If nothing new and nothing alarming, close the tab. Consistency matters more than depth.

### Triage decision tree

For each new issue, decide which bucket within 30 seconds:

**Fix now**
- Affects multiple users
- Blocks a core workflow (login, invoice submission, inventory entry, dashboard load)
- Clear crash pattern (every page load throws)
- → Open a branch, fix, ship

**Fix this week**
- Annoying but workable
- Edge case or single-user issue
- Error users don't see (background failure with fallback)
- → Add to backlog, batch with other fixes

**Resolve as noise**
- Browser extensions throwing errors
- Transient network blips
- Scraper bots or bad inputs from unknown sources
- → Mark resolved in Sentry without fixing. Also set Sentry to "Ignore similar future occurrences."

The third bucket is the most underused. Don't let noise pile up. Your dashboard should reflect real problems, not all problems.

### Resolution workflow

Sentry's resolve states matter - they're not just "I read this":

- **Resolve** - "fixed in this commit" or "won't fix, ignore"
- **Resolve in next release** - "ships in next deploy, auto-mark-resolved on deploy"
- **Archive** - "I'm not looking at this right now, hide it"
- **Reopen** - auto-fires when a resolved issue happens again (regression)

**The pattern that works:** when you fix a bug in code, resolve the Sentry issue *when you commit the fix*. If the bug returns, Sentry auto-reopens with "regression" tag.

If you can't fix something right now, **archive** instead of resolve. Resolving without fixing creates fake-completion and dashboard rot.

---

## Quota management

**Free tier limits:**
- 5,000 errors per month
- 30-day retention
- 1 user (you)

**Where to monitor quota:** Sentry → Settings → Stats & Usage. Look at total events for the current month.

**Healthy KitchFix steady-state:** 50–200 events/month given internal-tool scale. Far below quota.

**Spike protection:** Auto-enabled on the project. When event volume crosses a threshold in a 2-hour window, Sentry auto-rate-limits to protect quota. You'll see this as "Rate Limited" events in the stats view.

**If quota gets close (>3,500/month):**
1. Check what's firing most - usually one bad issue accounts for >80% of events
2. Resolve the noisy issue or filter it via Sentry → Project Settings → Inbound Filters
3. If genuine traffic warrants higher limits, upgrade to Team tier (\$26/month, 50K errors/month)

---

## Failure modes to avoid

**Notification fatigue.** Too many alerts → ignored. Start minimal. Only add more when there's a specific gap.

**Dashboard rot.** Five-minute check skipped → issues pile up → dashboard becomes "that thing I don't open anymore." If you can't sustain daily checks, reduce alert volume to match what you'll actually look at.

**Resolution theater.** Bulk-resolving old issues without understanding them. They auto-reopen later with no memory of the original problem. Better: archive what you don't have time to triage.

**Sentry as documentation.** Letting the dashboard be your record of bugs. 30-day retention deletes the history. Better: commit messages describe the bug, not just the fix. Sentry is a triage tool, not long-term record.

**Quota panic.** A bad deploy burns 5K in an hour. You panic-deploy a fix, exhaust quota, miss subsequent errors. Spike protection mitigates this automatically - trust it.

---

## Phase B - Sheets API health (NOT YET BUILT)

Sentry's Phase A catches errors in code that ran. Phase B handles a different class of failure: the Sheets API rate-limit issue (R12 in `docs/archive/migration/MIGRATION.md`; Phase B itself was reframed by the Supabase migration - see `docs/SUPABASE_MIGRATION.md`).

**The problem:** Google Sheets API has a 60 reads/minute per-project quota. When exceeded, calls return 429 errors. The dashboard handles this gracefully by returning \`{count: 0}\` data instead of crashing - meaning users see broken UIs with no error to debug. Sentry won't catch this because no exception is thrown.

**The plan (specced, not built):**
- Quota-tracking middleware wraps Sheets API helpers in \`src/lib/sheets.js\`
- \`/api/health\` endpoint exposes current read counts + estimated quota usage
- Custom Sentry instrumentation: when a 429 fires, send a Sentry event with quota state
- Slack alert at 70% quota threshold
- See R12 in `docs/archive/migration/MIGRATION.md` for risk context

**Boundary:** Phase B is visibility-only. Caching, request coalescing, and quota increases are separate work (Phase B+, not yet scoped).

---

## When to upgrade Sentry

Today's tier: **Developer (free)**. Sufficient for KitchFix at current scale.

Triggers to revisit:
- **Errors consistently exceed 5K/month** → Team tier (\$26/mo, 50K errors/month)
- **A teammate needs Sentry access** → Team tier (free tier is 1 user only)
- **You need session replay** for user-reported bugs you can't reproduce → Team tier
- **You need performance tracing** for slow API routes → Team tier
- **You need > 30 days retention** for historical analysis → Team tier

Default answer: stay on free tier until a specific need motivates an upgrade. Don't upgrade speculatively.

---

## Operational gotchas

Captured here for fast reference. Full context in \`docs/GOTCHAS.md\`.

1. **Sentry wizard writes \`SENTRY_AUTH_TOKEN\` plaintext to \`.env.sentry-build-plugin\`.** Never paste this file's contents anywhere external.
2. **Slack alerts to private channels require inviting the Sentry app to that channel.** \`#intranet-errors\` is private; the Sentry app is invited. New private channels need the same step.
3. **Source map upload requires \`SENTRY_AUTH_TOKEN\` on Vercel.** Without it, production errors show minified gibberish. Verify via \`npm run build\` locally - output should show "Completed runAfterProductionCompile" after compile step.
4. **DSN is public by design.** It ships in client JS. Leaking it isn't a security incident, just lets others fill your quota with junk. Rotateable if needed.
5. **\`enabled\` gate excludes local dev.** If you want to verify Sentry capture locally, temporarily flip \`enabled: true\` in a config file (don't commit).

---

## Captain's log

- **2026-05-14** - Sentry Phase A install complete. PR #21 merged. Free Developer tier (14-day Business trial auto-drops to free). Org \`kitchfix\`, project \`kitchfix-intranet\`. Slack integration live; alert rule routing to \`#intranet-errors\`. End-to-end verified locally (test errors captured) and production deploy healthy. Phase B (Sheets API health) deferred to separate PR.
