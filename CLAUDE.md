# CLAUDE.md - KitchFix Ops Hub

You are joining a working production codebase. This file is your briefing. Read it fully before touching anything.

## What this project is

The KitchFix Ops Hub is a Next.js 16 / React 19 internal intranet that serves Executive Chefs, site leads, and ops leadership across MLB, MiLB, PDC, and corporate kitchen accounts - an operational portfolio exceeding $10M annually. It is the operational backbone of a real business with real users. **Production is `main`. There is no staging environment.** Every change merged to `main` deploys to production automatically.

The maintainer is Kevin Fietek, solo developer and Director of Operations. He is the only person with commit access.

## What we are doing right now (May 2026)

We are mid-migration through a multi-phase architectural arc. Read `docs/MIGRATION.md` for the full plan. The short version:

- **Phase 0 - Done.** Foundations: repo private, previews working, Claude Code adopted, src-backup removed.
- **Phase 1 - In progress.** Safety net and ergonomics: test suite, CI, observability, AI SDK consolidation, runbook, backup scripts. **No architectural changes in Phase 1.**
- **Phase 2 - Pending.** TypeScript foundation. Convert `src/lib/*.js` to `.ts`.
- **Phase 3 - Pending.** Supabase migration, module by module, starting with Incidents.
- **Phase 4 - Pending.** shadcn/ui + Tailwind v4 + mobile-first + PWA.
- **Phase 5 - Pending.** Route splitting, naming (Option A - `/ops` dissolves into top-level modules), Dashboard rebuild.

The migration order for Phase 3 is dependency-ordered (not Hub-ordered): Incidents → Vendors → Invoices → Inventory → Service Calendar → Season Tracker → Analytics → PAF → New Hire → Action Center & Admin Queue → Leadership Dugout → Reports → Directory → Financial → Dashboard.

## Read these before doing anything

In this order, every session:

1. `docs/ARCHITECTURE.md` - five-pillar Sheets model, auth boundary, module map
2. `docs/CONVENTIONS.md` - action-dispatch APIs, CSS prefixes, sheet column conventions
3. `docs/GOTCHAS.md` - hard-won lessons. Read before debugging anything that smells familiar.
4. `docs/MIGRATION.md` - the migration plan
5. `docs/BUSINESS_NOTES.md` - living reference for niche business knowledge (domain rules, account-specific quirks, stakeholder preferences, calculation methodology, historical context). Consult before assuming business logic is wrong. Update when audits or debug sessions surface new rules. Items tagged [PRESERVE THROUGH MIGRATION] must survive Stage 1 schema design.

The first four documents are canonical for technical questions. BUSINESS_NOTES.md is canonical for domain rules. The repo itself is the ground truth - if a doc disagrees with the code, flag the doc drift, don't silently pick one.

## Working agreement

**Tests-first.** Phase 1's centerpiece is a Playwright test suite covering happy paths for every module. Until that suite is in place and CI is wired, every architectural change must be manually verified on a Vercel preview deploy before merging to main. No exceptions.

**One axis per module per migration.** When we get to Phase 2/3/4, we never change a module's data layer and UI framework and language in the same pass. TypeScript first, then Postgres, then shadcn. In separate PRs. Each fully shipped before the next starts.

**Dual-write for data migrations.** Phase 3 module migrations follow a six-step pattern: schema → data-access layer → dual-write to both stores → shadow-read validation → cutover with feature flag → decommission. Two-week dual-write window minimum per module. Reversibility is mandatory.

**Branch-and-PR for everything.** No direct commits to main. Feature branch → push → Vercel preview → PR → review the diff → merge. CI runs on every PR (once it's set up in Phase 1).

**The runbook is code.** Every infrastructure change (env var added, Vercel setting changed, cron schedule modified) updates `docs/RUNBOOK.md` in the same commit. Same for env vars touching `docs/ENV_VARS.md`. Don't ship infra changes without doc updates.

**Capacity, not speed, is the constraint.** The maintainer works on this full-time. There's no need to compress phases or skip validation windows to "move faster." When ahead of schedule, use the time for depth (stronger tests, better docs, more polish) rather than pulling future phases forward. The arc's pacing is deliberate - each phase needs to settle before the next builds on it.

**Floor-first.** Every UI change must work on a 375px viewport before it ships. The mental model: a chef on a phone in a 38°F walk-in cooler with wet hands.

## Danger zones

These files have outsized blast radius. Edit only with explicit user approval and never in autonomous "make it work" mode:

- `src/lib/sheets.js` - the data layer. Changes here affect every module.
- `src/lib/auth.js` - NextAuth config. Breaking this logs everyone out.
- `src/middleware.js` - request gating. Breaking this exposes routes.
- `vercel.json` - cron schedules and deploy config. Wrong values break production silently.
- `next.config.mjs` - framework config. Wrong values break the build.
- `package.json` - dependencies. Don't `npm uninstall` anything without confirming.
- Anything matching `.env*` - **never read, never write, never echo contents to terminal or chat.** If you need to know what an env var contains, ask Kevin.

## Findings to know about (from May 11, 2026 calibration)

These are real issues identified in the codebase that are in the Phase 1 backlog:

1. **Two parallel service-account implementations exist.** The canonical one lives in `src/lib/sheets.js` (`getServiceAccountSheetsClient()`). There is a second, hand-rolled JWT path in `src/app/api/people/route.js` (lines 80-151) that uses `getServiceToken` / `importPrivateKey` / `signJwt` via `crypto.subtle` for domain-wide delegation. Its local `readSheet` / `appendRow` / `updateCell` / `updateRow` helpers do **not** have the `SA` naming suffix despite using the service account. This breaks the convention that makes the auth boundary visually obvious. Phase 1 cleanup target.

2. **OAuth scope is overly permissive.** `src/lib/auth.js` requests full `drive` scope rather than `drive.file`. Any code path that accidentally uses a user token has full Drive access, not just per-file. Phase 1 reduction target.

3. **`next dev` is opting out of Turbopack.** `package.json` has `"dev": "next dev --webpack"`. Next 16 defaults to Turbopack, which is significantly faster. Five-minute Phase 1 win.

4. **Analytics sheet has hit Google Sheets' 10M cell limit.** Events are silently failing in production. Phase 3 Postgres migration of Analytics fixes this permanently; in the meantime, may need to archive old rows.

5. **`googleapis` and `google-auth-library` are pinned with caret ranges** (`^171`, `^10`). No lockfile constraints. Supply-chain concern. Phase 1 evaluation.

6. **Incidents module has external side-effect entanglement.** A single submit creates a Drive folder tree, uploads files, creates a Calendar event, posts Slack, sends email, builds a stamped PDF, and computes SOP escalation deadlines. The row stores Drive folder ID, Drive URL, PDF URL, escalation timestamp, and calendar event ID. The Phase 3 dual-write pattern needs special handling for Incidents to avoid duplicate side-effects during the two-week window. Settle this before Phase 3 begins.

## Communication style

Direct and concise. This is a working environment, not a tutorial. If you're uncertain, say so. If something is wrong, push back - agreement isn't helpful. If a plan is weak, say it's weak. The maintainer values honest expert pushback over politeness.

Commit messages are terse and lowercase. Examples from the repo's history: "new hire updates," "smart inventory," "incident report v3," "leadership push." Don't impose Conventional Commits. Match the existing voice.

## What you can do without asking

- Read any file in the repo (except `.env*`)
- Run `npm run dev`, `npm run lint`, `npm run build`
- Run `git status`, `git diff`, `git log`, `git branch`
- Suggest changes as patches or full file contents in chat

## What you must ask before doing

- Editing any file in the Danger Zones list
- Running any `git` command that mutates state (`commit`, `push`, `merge`, `branch -d`)
- Installing or uninstalling packages
- Running any cron route locally (e.g., `/api/cron/daily`)
- Touching any file matching `.env*`
- Running database migrations (once Supabase is in)
- Modifying `vercel.json` or `next.config.mjs`

## Side project isolation (HARD RULE)

The maintainer has a separate game project. It lives at `~/Holtburg/holtburg-hollow/`. The two projects must never know about each other. You are working only in `~/dev/kitchfix-intranet/`. Do not reference the game project. Do not search for files outside this directory. If the maintainer mentions the game in conversation, redirect back to the intranet - those should stay in their own session.

## Session start checklist

When starting a fresh session, after reading the docs above:

1. Confirm `pwd` is `/Users/kevinfietek/dev/kitchfix-intranet`
2. Confirm `git status` is clean
3. Confirm `git branch --show-current` matches what the maintainer expects
4. State the phase and task you understand to be in scope
5. Wait for the maintainer to confirm before proceeding

## When you're done with a piece of work

- Update `docs/RUNBOOK.md` if you changed infrastructure
- Update `docs/ENV_VARS.md` if you added an env var
- Update `docs/MIGRATION.md` exit criteria checkboxes if applicable
- Add a one-line entry to the relevant doc's "Captain's log" if a convention or gotcha was learned
- Commit and push the feature branch - do not merge to main yourself
