# CLAUDE.md - KitchFix Ops Hub

You are joining a working production codebase. This file is your briefing. Read it fully before touching anything.

> 📌 **Migration project phase CLOSED 2026-06-12.** For the project handoff, see [`docs/MIGRATION_PROJECT_CLOSEOUT.md`](docs/MIGRATION_PROJECT_CLOSEOUT.md). For current per-module Sheets-vs-PG state, see [`docs/MIGRATION_STATUS.md`](docs/MIGRATION_STATUS.md). This CLAUDE.md captures the long-stable bits (architecture framing, safety rules, danger zones, working agreement) - state-of-the-world claims live in those two docs.

## What this project is

The KitchFix Ops Hub is a Next.js 16 / React 19 internal intranet that serves Executive Chefs, site leads, and ops leadership across MLB, MiLB, PDC, and corporate kitchen accounts - an operational portfolio exceeding $10M annually. It is the operational backbone of a real business with real users. **Production is `main`. There is no staging environment.** Every change merged to `main` deploys to production automatically.

The maintainer is Kevin Fietek, solo developer and Director of Operations. He is the only person with commit access.

## Current project state (June 2026 onward)

The Supabase migration project closed 2026-06-12. **The intranet now sits on a Sheets + PG dual data layer.** Six modules cut over to PG with dual-write to Sheets as rollback net: News, Directory, People-submissions, Vendor, Invoice, Playbook/OPD. Smart Inventory (Module 7) and the Railway cron (Module 8) are parked - prototype #1 was over-built; the v2 vision is queries-over-facts with no cron (see [`docs/modules/INVENTORY_MODULE.md`](docs/modules/INVENTORY_MODULE.md)). Remaining surfaces (Labor, Financial, Legacy Inv Count, Service Calendar, Incidents, Leadership Dugout) sit on Sheets with per-item dispositions in [`docs/MIGRATION_PROJECT_CLOSEOUT.md`](docs/MIGRATION_PROJECT_CLOSEOUT.md) §D.

**Build mode, not migration mode.** New features are built Supabase-native using the `dataStore` orchestrator + flag-dispatch pattern (the pattern the six cut-over modules use). **Do NOT copy from still-on-Sheets modules** (dugout, labor, calendar, incidents, financial proxy) - they use the old direct-Sheets pattern that's no longer the model. See `docs/MIGRATION_PROJECT_CLOSEOUT.md` §H for the pattern contrast.

**Migrations don't auto-apply on deploy.** SQL files in `docs/migrations/` are not run by Vercel - they're applied manually in Supabase Studio. The 2026-06-12 silent-gap incident happened because Stage A code deployed before the matching pr-9-1 migration was applied. When shipping schema changes: apply in Studio first, verify via probe script, then ship the dependent code.

## Read these before doing anything

In this order, every session:

1. [`docs/MIGRATION_PROJECT_CLOSEOUT.md`](docs/MIGRATION_PROJECT_CLOSEOUT.md) - the project handoff (decisions, dispositions for remaining items, proven patterns + lessons, how to resume). Read this first.
2. [`docs/MIGRATION_STATUS.md`](docs/MIGRATION_STATUS.md) - canonical current-state (which modules are on PG vs Sheets, cutover control plane, structural gaps).
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - 30,000-ft view: stack, the Sheets + PG dual data layer, auth boundary, module map.
4. [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) - action-dispatch APIs, CSS prefixes, sheet column conventions.
5. [`docs/GOTCHAS.md`](docs/GOTCHAS.md) - hard-won lessons. Read before debugging anything that smells familiar.
6. [`docs/BUSINESS_NOTES.md`](docs/BUSINESS_NOTES.md) - living reference for niche business knowledge (domain rules, account-specific quirks, stakeholder preferences, calculation methodology, historical context). Consult before assuming business logic is wrong.
7. [`docs/TEAM_KNOWLEDGE.md`](docs/TEAM_KNOWLEDGE.md) - team-facing knowledge corpus (how-to, policy, glossary, account-specific, tool reference). Seed corpus for the future Sous AI intranet search feature.
8. [`docs/SPEC_INTRANET_AI_SEARCH.md`](docs/SPEC_INTRANET_AI_SEARCH.md) - passive brain dump for product thinking about the future Sous AI intranet search feature.

The close-out + status docs are canonical for current state. ARCHITECTURE.md is canonical for the spatial mental model. BUSINESS_NOTES.md is canonical for domain rules. The repo itself is the ground truth - if a doc disagrees with the code, flag the doc drift, don't silently pick one.

## Working agreement

**Tests-first.** Phase 1's centerpiece is a Playwright test suite covering happy paths for every module. Until that suite is in place and CI is wired, every architectural change must be manually verified on a Vercel preview deploy before merging to main. No exceptions.

**One axis per module per migration.** When we get to Phase 2/3/4, we never change a module's data layer and UI framework and language in the same pass. TypeScript first, then Postgres, then shadcn. In separate PRs. Each fully shipped before the next starts.

**Dual-write for data migrations.** Phase 3 module migrations follow a six-step pattern: schema → data-access layer → dual-write to both stores → shadow-read validation → cutover with feature flag → decommission. Two-week dual-write window minimum per module. Reversibility is mandatory.

**Branch-and-PR for everything.** No direct commits to main. Feature branch → push → Vercel preview → PR → review the diff → merge. CI runs on every PR (once it's set up in Phase 1).

**Migration-gated PRs open as DRAFT.** If a PR's code reads or writes any schema object (column, table, view, function, RLS policy) that is created or altered by a not-yet-applied migration, the PR opens as a **draft** with a checklist item `☐ sc-XX migration applied in Studio (Kevin confirms)`. The PR is marked ready-for-review ONLY after Kevin confirms the migration is applied in Studio and the verify probes pass. Rationale: on 2026-07-11 the sc-16 reader (#403) merged before the sc-16 migration ran; every `accounts` SELECT 500'd until the revert. Draft state prevents a synchronous merge from re-creating the silent-gap. Applies to every migration-dependent code change, not just SC.

**The discipline broke around the rule (2026-07-12).** The sc-17 PR opened as DRAFT correctly, but was flipped to ready-for-review and merged before the Studio-apply completed - same silent-gap class in the same 48h window. The draft-state check requires a manual flip; there is no mechanical check that the SQL applied.

**Migration gate SHIPPED (2026-07-12, PR #416).** `.github/workflows/migration-gate.yml` emits a "Migration gate" status check on every PR. Job A (on `pull_request`) diffs the PR head against the merge-base for added `docs/migrations/*.sql` files - none found -> the check passes instantly (the common case, zero friction); one or more found -> the check FAILS with a summary listing the files and printing the canonical confirmation phrase. Job B (on `issue_comment`) matches any comment containing `applied in Studio: YES` from an `author_association == 'OWNER'` comment (Kevin), resolves the PR's current head SHA, and emits a `Migration gate` check_run as success on that SHA. GitHub's required-check aggregation reads the LATEST check_run with that name on the SHA, so the confirmation flips the gate green. **Per-SHA reset**: any push re-runs Job A on the new head; a confirmation never outlives the code it confirmed - flip-and-merge cannot survive a push. Kevin adds `Migration gate` as a required status check on the `main protection` ruleset once this workflow lands; from that click, migration-bearing PRs are mechanically unmergeable until the canonical confirmation fires.

**Branch-protection reality (2026-07-12).** Main IS protected, via a **repository ruleset** named `main protection` (id 16364953), not the classic branch-protection API. The classic endpoint returns 404 because rulesets are a separate surface (`GET /repos/{owner}/{repo}/rulesets` reveals them). The ruleset is `enforcement: active` with an empty `bypass_actors` list, so the rules apply to every actor including repo admins. Current rules: deletion blocked, non-fast-forward blocked, pull-request required (0 required approvals but stale reviews dismissed on push + all review threads must resolve before merge). Required status checks include `Nav matrix (local build)` (#407/#408) and, once Kevin clicks it into place after PR #416 lands, `Migration gate`. All three merge methods (merge / squash / rebase) allowed.

**The runbook is code.** Every infrastructure change (env var added, Vercel setting changed, cron schedule modified) updates `docs/RUNBOOK.md` in the same commit. Same for env vars touching `docs/ENV_VARS.md`. Don't ship infra changes without doc updates.

**Capacity, not speed, is the constraint.** The maintainer works on this full-time. There's no need to compress phases or skip validation windows to "move faster." When ahead of schedule, use the time for depth (stronger tests, better docs, more polish) rather than pulling future phases forward. The arc's pacing is deliberate - each phase needs to settle before the next builds on it.

**Floor-first.** Every UI change must work on a 375px viewport before it ships. The mental model: a chef on a phone in a 38°F walk-in cooler with wet hands.

**Bidirectional-diff law.** Any DB <-> external-truth audit must walk BOTH directions - every DB row -> external record AND every external record -> DB row on its correct current identifier. A one-way walk hides re-anchored records: on 2026-07-14 the STL - MO pk 823042 DATE_DRIFT (a postponed game the API relocated 6/25 -> 7/23) sat in the DB for a week because Part 1's DB->API walk found every DB row matched some API game, but the reverse walk was never run. See `docs/audits/SC_SCHEDULE_TRUTH_AUDIT_2026-07.md` "ARC CLOSEOUT" for the full case.

## Danger zones

These files have outsized blast radius. Edit only with explicit user approval and never in autonomous "make it work" mode:

- `src/lib/sheets.js` - the Sheets-side data layer. Changes here affect every module that still touches Sheets (which is all six cut-over modules dual-writing + every not-yet-migrated module).
- `src/lib/cutover.js` - the migration control plane. Changes here change every cut-over module's behavior simultaneously.
- `src/lib/dataStore/*.js` - per-module orchestrators. Each file is the load-bearing data path for its module. The dual-write pattern (Sheets unconditional + PG conditional via `isDualWrite`) is preserved in every orchestrator - if you break it, you break the rollback net.
- `src/lib/auth.js` - NextAuth config. Breaking this logs everyone out.
- `src/middleware.js` - request gating. Breaking this exposes routes.
- `vercel.json` - cron schedules and deploy config. Wrong values break production silently.
- `next.config.mjs` - framework config. Wrong values break the build.
- `package.json` - dependencies. Don't `npm uninstall` anything without confirming.
- `docs/migrations/*.sql` - migrations don't auto-apply. New migration files require manual Studio paste + a verify probe before the dependent code ships. See [`docs/MIGRATION_PROJECT_CLOSEOUT.md`](docs/MIGRATION_PROJECT_CLOSEOUT.md) §E for the 2026-06-12 silent-gap incident this rule comes from.
- Anything matching `.env*` - **never read, never write, never echo contents to terminal or chat.** If you need to know what an env var contains, ask Kevin.

## Standing findings (post-migration-project)

These are real issues in the codebase. Several items from the May 2026 calibration were resolved during the migration project; the surviving items below are what's still live.

1. **OAuth scope is overly permissive.** `src/lib/auth.js` requests full `drive` scope rather than `drive.file`. Any code path that accidentally uses a user token has full Drive access, not just per-file. Reduction target whenever auth gets attention.

2. **Incidents module has external side-effect entanglement.** A single submit creates a Drive folder tree, uploads files, creates a Calendar event, posts Slack, sends email, builds a stamped PDF, and computes SOP escalation deadlines. The row stores Drive folder ID, Drive URL, PDF URL, escalation timestamp, and calendar event ID. **The Incidents feature has 0 rows ever submitted** despite the full machinery being wired - it's never been used in production. Disposition is "rebuild Supabase-native when prioritized" (see CLOSEOUT §D). The side-effect coordination still needs design work whenever that rebuild happens.

3. **Sheets-decommission structural gap.** `src/lib/cutover.js` has no flag to turn Sheets writes OFF for cut-over modules. Removing a table from `DUAL_WRITE_TABLES` stops PG writes (state-4 misconfiguration), not Sheets writes. Not urgent (Sheets quota / reliability isn't a real concern today) but worth knowing.

### Resolved during the migration project (no longer live)

- **Two parallel service-account implementations** - resolved. The hand-rolled JWT path (`getServiceToken` / `importPrivateKey` / `signJwt` via `crypto.subtle`) in `src/app/api/people/route.js` has been removed; everything routes through `getServiceAccountSheetsClient()` in `src/lib/sheets.js`.
- **`next dev` opting out of Turbopack** - resolved. `package.json` is now `"dev": "next dev"` (Next 16 defaults to Turbopack).
- **Analytics sheet 10M cell limit** - resolved by teardown. The dashboard/cron/API surface was deleted (PR 1-3 of the analytics teardown); only a no-op `logEventSA` stub remains in `src/lib/analytics.js` while `auth.js` and `incident-reminders` still import it.
- **`googleapis` + `google-auth-library` caret pins** - resolved. Now exact-pinned at `"10.5.0"` and `"171.4.0"`.

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

The maintainer has a separate game project. It lives at `~/Holtburg/holtburg-hollow/`. The two projects must never know about each other. You are working only in the current intranet checkout (either `~/dev/kf-cell-states/` or `~/dev/kitchfix-intranet/` on this machine - both are worktrees of the same intranet repo). Do not reference the game project. Do not search for files outside the intranet working directory. If the maintainer mentions the game in conversation, redirect back to the intranet - those should stay in their own session.

## Session start checklist

When starting a fresh session, after reading the docs above:

1. Confirm `pwd` matches the current working directory. On this machine that's `/Users/kevinfietek/dev/kf-cell-states` as of 2026-07-12; the historical `/Users/kevinfietek/dev/kitchfix-intranet` remains a valid `main`-worktree checkout of the same repo
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
