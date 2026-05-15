# Migration Plan — KitchFix Ops Hub Architectural Arc

> **Last updated:** 2026-05-14 (Supabase migration committed — see redirect below)
> **Last commit at update:** see `git log` for this file's most recent edit
> **Owner:** Kevin Fietek
> **Estimated duration:** 5–6 months calendar time. Some phases gated by calendar (dual-write validation windows) regardless of effort.
> **Capacity assumption:** 20–40 hrs/week. If finishing phases ahead of schedule, the right move is depth, not speed — strengthen the test suite, add observability, polish UX, write better docs. Don't pull Phase N+1 forward.

> ## ⚠️ REDIRECT — Read this first
>
> As of 2026-05-14, the project direction has been reshaped. The original Phase 4 (Database Migration) has been pulled forward and is now the active focus.
>
> **Current direction:** See `docs/SUPABASE_MIGRATION.md` for the active migration plan, current stage, and reprioritized task list.
>
> **This doc is preserved as historical record.** The Phase 1 work it describes is largely complete (11 of 13 tasks closed, with #2 deferred to post-migration). Phases 2-5 are deferred, absorbed into the migration, or superseded by it. See `docs/SUPABASE_MIGRATION.md` § "Impact on the original migration plan" for the explicit mapping.
>
> **At session start:** read `docs/SUPABASE_MIGRATION.md` first. Refer to this doc for historical context only.

---

## How to use this doc

**This is a living document.** It is the single source of truth for project state. It is read at the start of every session, updated at the end of every session, and committed to the repo as part of the work it describes.

**Section update rules** are stated in the header of each section. Some sections are locked (strategic frame, architectural decisions); others update every session (phase status, followups log, captain's log).

**Stale doc = broken doc.** If the "last updated" date is more than 2 weeks old, treat the doc with suspicion and verify against the actual repo before relying on it.

---

## Session-start checklist

Read top-to-bottom before any work. Three minutes well spent.

```
[ ] git status — confirm clean tree and which branch I'm on
[ ] git log --oneline -5 — confirm I'm where I think I am
[ ] Read this doc through "Phase Status" — confirm what we agreed to do this session
[ ] Confirm any pasted handoff matches the doc's current state — flag drift
[ ] Verify dev server starts clean: npm run dev (sanity check before touching anything)
```

If any of these fail or surprise me, stop and reconcile before writing code.

---

## Working agreements (Kevin + Claude)

These describe the dance. Both sides keep the discipline; neither side waives it for "just this one thing."

**Claude's side**
- Read this doc before responding to "what's next" or "where are we" questions
- Pull live code from the repo before answering questions about how the system works — don't work from memory
- Propose-before-execute on any non-trivial change: state the plan, get sign-off, then act
- Push back honestly when a plan is weak; flag risks the user might not see
- Surface scope drift the moment it appears — name new followups before they get lost
- Use Find-this / Replace-with-this patches for surgical edits; full file replacements only for sprawling changes
- At session end, draft updates to this doc and propose them for review and commit

**Kevin's side**
- Run `git status` before every commit. The doc cannot save you from this; you have to look.
- Review and commit doc updates at session end — the doc only stays current if you actually merge it
- Tell Claude when you're stopping or pivoting so the doc gets updated correctly
- Push back on Claude when proposals feel wrong; honest disagreement is the design

**Both sides**
- Sessions that don't end with a doc update are sessions that decay. Default to "we update before we sign off."

---

## Strategic Frame

> **Update rule: locked. Don't edit without explicit strategic re-direction and a captain's-log entry explaining why.**

**Goal:** Evolve the intranet from a working solo-built tool into a production-grade operational platform, optionally capable of being spun out as a multi-tenant SaaS product (KitchFix Ops).

**Operating principle:** Floor-first — every change evaluated against whether it works for a chef on a phone in a walk-in cooler with wet hands.

**Strategic goal beneath the migration:** Build a foundation trustworthy enough that future operational tools and widgets can be built on it at speed without fear of regression. The migration isn't the goal — the velocity of future tool-building is the goal.

---

## Locked Architectural Decisions

> **Update rule: locked May 11, 2026. Don't edit silently. A decision change is a captain's-log entry plus an inline note explaining the reason and date.**

1. **Multi-tenancy: YES.** Every transactional Postgres table gets `tenant_id` from day one. KitchFix = `tenant_id 1`. Preserves SaaS optionality without forcing the spinout.
2. **Naming: Option A.** Suite is "KitchFix Ops". `/ops` URL prefix dissolves in Phase 5 into top-level routes (`/season`, `/inventory`, `/invoices`, `/vendors`).
3. **Module migration order: dependency-ordered, NOT Hub-ordered.** Sequence: Incidents → Vendors → Invoices → Inventory → Service Calendar → Season Tracker → PAF → New Hire → Action Center & Admin Queue → Leadership Dugout → Reports → Directory (stays on Sheets) → Financial → Dashboard (last, pure aggregator). *(Analytics removed from sequence 2026-05-15 — module decommissioned in PRs #31/#32/#33; see Phase 3 commentary below and captain's log.)*
4. **Three architectural axes:** Supabase Postgres + TypeScript + shadcn/ui + Tailwind v4. All three eventually.
5. **Migration discipline:** One axis per module per pass. Never combine two axes in a single change.
6. **Tests-first:** Phase 1 builds the Playwright test suite before any architectural changes.
7. **Workflow:** Feature branch → Claude Code (or surgical zsh) → localhost → push → Vercel preview → manual merge via GitHub UI. Preview verification is REQUIRED for middleware/auth PRs.
8. **Co-Authored-By trailers stay on Claude Code commits.**
9. **Capacity assumption:** 20–40 hrs/week. Finishing ahead of schedule = depth, not pulling work forward.

---

## Phase Status

> **Update rule: every session-end. Tasks move statuses, get marked closed with PR #s, get notes when work surfaces complications.**

### Phase 0: Foundations
**Status: ✅ Complete (May 11, 2026).**

All tasks closed: private repo, Vercel previews, ANTHROPIC_API_KEY hygiene, Claude Max 20x plan, repo moved to `~/dev/kitchfix-intranet`, GitHub Desktop + gh CLI authenticated, Claude Code installed, side-project isolation verified, calibration done, stale `dev` branch deleted, foundational docs created (`CLAUDE.md`, `.claude/settings.json`, `docs/RUNBOOK.md`, `docs/ENV_VARS.md`, `docs/MIGRATION.md`), `src-backup/` removed.

### Phase 1: Stabilize Before Migrating
**Status: 🟡 In progress — 11 of 13 original tasks closed + 11 housekeeping items closed as of 2026-05-13.**

#### Original Phase 1 tasks

| # | Task | Status | PR | Notes |
|---|---|---|---|---|
| 1 | Auth boundary cleanup (`route.js` hand-rolled JWT → service account) | Open | — | Needs quiet Saturday — touches sign-in |
| 2 | OAuth scope reduction (`drive` → `drive.file`) | Open | — | Needs quiet Saturday — touches sign-in |
| 3 | Turbopack opt-in | ✅ | #4 | Shipped May 11. Verified still default in 16.2.6. |
| 4 | Analytics sheet rotation/bridge | ✅ | #8 | Closed May 12. Feature-flagged via `ANALYTICS_ENABLED`. Module subsequently deleted in full 2026-05-15 (PRs #31/#32/#33); Phase 3 Postgres rebuild cancelled. See Phase 3 commentary. |
| 5 | Dependency pinning evaluation | ✅ | #15 | Closed May 13. All 9 caret-range deps pinned to exact versions. |
| 6 | lucide-react upgrade | ✅ | — | Closed May 11 as no-op (1.14.0 already current) |
| 7 | Daily sheet backup cron | ✅ | #14 | Closed May 13. Runs 06:00 UTC, 5 sheets, restore drilled and verified. |
| 8 | Anthropic SDK consolidation | Open | — | Needs spec before code — touches Invoice OCR |
| 9 | `/api/health` endpoint | Open | — | Attempted May 11, reverted. Possibly blocked on Task 17. |
| 10 | Observability stack (Sentry) | 🟡 Scoped 2026-05-13 | — | Plan: Sentry on free Developer tier (errors only, no Better Stack — internal app, users will report downtime). Phase A = SDK install + basic error tracking. Phase B = custom Sheets API health instrumentation (R12 visibility). Next concrete step: create Sentry account (~5 min) before SDK install. |
| 11 | (duplicate of #3) | ✅ | — | Same as #3 |
| 12 | Playwright test harness | ✅ | #9 | Closed May 12. 3 read-only tests. Expansion to 30–40 tests is future work. |
| 13 | GitHub Actions CI | ✅ | #11 | Closed May 13. Runs against production on every PR. |
| 14 | Branch protection on main | ✅ | — | Closed 2026-05-13 end-of-session. Required GitHub Pro upgrade ($4/mo) for private-repo enforcement. Configured: PR required + Playwright CI pass + branch up-to-date + restrict deletions + block force pushes. Active. |
| 15 | Analytics taxonomy cleanup | Cancelled | — | Obsolete — analytics module deleted 2026-05-15. No taxonomy to clean. |
| 16 | Fix `.claude/settings.json` npm publish rule | Open | — | 5-min fix |
| 17 | Migrate `middleware.ts` → `proxy.ts` | Open | — | Deprecation warning still firing after 16.2.6 bump. Unknown effort. May block Task 9 (`/api/health`). |

#### Non-task work closed this session (not in original Phase 1 plan)

| Item | PR | Notes |
|---|---|---|
| Next.js security bump 16.1.6 → 16.2.6 | #16 | Closes 19 high-severity advisories (CVE-2026-23869). `npm audit` → 0 vulnerabilities. Live smoke-tested across 5 modules. |
| `SHEET_IDS.INVENTORY` cleanup | #18 | One-line fix: `process.env.INVENTORY_SHEET_ID \|\| ""` → hardcoded literal. Closes documented footgun. |
| `supportsAllDrives` audit | — | Grepped 4 files, 12 ops. **All already patched.** Verification work was the deliverable. |
| Backup restore drill | — | Tab-level restore drilled end-to-end on `HUB-DRILL-2026-05-13` copy. ~2 minutes. **Critical — proves the backup is real.** |
| `GOTCHAS.md` + `RUNBOOK.md` updates | #17 | 3 new gotcha entries, full rewrite of restore section, new "Git & Workflow" gotcha section. |
| `logHealthSA` unused import removal | #10 | Cleanup |
| Playwright CI workflow | #11 | (Same as Task 13 above; tracked here for completeness) |
| `auth.setup.ts` URL regex flexibility | #12 | Supports both localhost and production targets |
| Docs: `TESTING.md` + `GOTCHAS.md` (auth-state scoping) | #13 | Documented R11 risk |
| `CRON_SECRET` rotation | — | Old value leaked in chat transcript; rotated May 13. All three Vercel envs updated. Old value confirmed dead via curl. |
| Vercel Deployment Protection bypass token | — | Generated and stored as `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secret. Reserved; not currently consumed by CI. |
| `.gitignore` update | — | Added `HANDOFF_*.md` pattern |

#### Phase 1 exit gate status

| Gate | Status |
|---|---|
| Test suite covers critical paths | ✅ harness exists; expansion future work |
| CI runs on every PR | ✅ |
| Branch protection on main | ✅ Closed end-of-day 2026-05-13 (PR-free; ruleset config + GitHub Pro upgrade) |
| Observability live | ❌ Task #10 — needs scoping |
| Backup safety net online | ✅ cron + restore both verified |
| Dependencies pinned and audit-clean | ✅ |

**Two real gates remain:** branch protection (5 min) and observability scoping (real work). Phase 1 exit is close.

### Phase 2: TypeScript Conversion
**Status: Not started. Blocked on Phase 1 exit.**

Module-by-module, dependency-ordered. Same module sequence as locked decision #3. For each module: convert `.js`/`.jsx` → `.ts`/`.tsx`, add type definitions, type API route handlers, type React components. No runtime behavior changes. Tests still pass.

**Exit criterion:** Entire codebase is TypeScript. Build is type-clean. No new bugs introduced.

### Phase 3: Postgres Migration
**Status: Not started. Blocked on Phase 2 exit.**

Move data from Google Sheets to Supabase, module-by-module, same dependency order. Each module gets a **2-week dual-write validation window**. Highest-risk phase.

Per module: design schema (with `tenant_id`), stand up Supabase tables, implement dual-write (Sheets AND Postgres), 2-week validation, cut reads to Postgres, decommission Sheets writes. Then next module.

Special handling for **Incidents** module (R9): side-effect entanglement (Drive folder + Calendar event + Slack + email + PDF + escalation timestamps fire from one submission). Architecture for side-effect modules must be settled before Phase 3 begins.

**Directory STAYS ON SHEETS** — read-only config, low write volume.

**Analytics REMOVED** — Analytics removed in PRs #31/#32/#33 (2026-05-15). Analytics will be addressed post-migration via Sentry (error tracking), Vercel Analytics (traffic), and Supabase dashboards (operational data). A custom analytics surface is not currently planned. If custom dashboards become necessary, they will be built on Postgres queries from real usage data, not preemptively.

**Exit criterion:** All modules except Directory on Postgres. Sheets writes decommissioned. Multi-tenant boundaries in place.

### Phase 4: UI Modernization (shadcn/ui + Tailwind v4)
**Status: Not started. Blocked on Phase 3 exit.**

Replace custom CSS prefix system (`oh-`, `oh-vp-`, `oh-inv-mgmt-`, `sc-`, `pp-`, `kf-`, `an-`) with shadcn/ui components on Tailwind v4. Module-by-module, same dependency order. Preserve design language (amber for focus, navy for primary CTAs, red reserved for errors) and motion specs (240ms / 420ms / 180ms).

**Exit criterion:** Custom CSS prefix system fully replaced. Design language preserved.

### Phase 5: Cleanup & SaaS-Readiness
**Status: Not started. Blocked on Phase 4 exit.**

- Dissolve `/ops` URL namespace → top-level routes
- Finalize multi-tenant boundaries (row-level security policies in Supabase)
- Tenant onboarding flow (if SaaS)
- Billing integration (if SaaS)
- Final documentation pass
- Operational baseline (backups, monitoring, alerting all final-form)

#### Phase 5 cleanup items identified during prior sessions

- **`SHEET_IDS.COLLECTION` retirement.** Hardcoded constant matches `PEOPLE_DB_SHEET_ID` env var (historical artifact). Retire in favor of single canonical `COLLECTION_SHEET_ID` env var.
- **`inventoryActions.js` import migration.** ~80 call sites of `process.env.INVENTORY_SHEET_ID` should migrate to `import { SHEET_IDS }` pattern. Closes env-var dependency entirely. (Identified May 13.)
- **Directory route SA migration.** `src/app/api/directory/route.js` is the only Drive-using file still on user OAuth. Read-only and works; migrate to SA pattern for consistency. (Identified May 13.)
- **`SHEET_IDS` env-var-ification decision.** Should the remaining 5 hardcoded sheet IDs become env-var-driven for staging support? Architectural call. (Identified May 13.)

**Exit criterion:** Platform in final architectural state. Either operating cleanly as KitchFix-internal or ready to onboard a second tenant.

---

## Followups & Discoveries Log

> **Update rule: immediately when discovered, not at session-end.** This is the section that fails most often without discipline. Anything noticed during a task that isn't part of the task lands here the moment it surfaces.

Format per entry: `[Priority] Discovery (date, context). Effort estimate. Owner-action.`

### P1 — Must address before Phase 1 exit
*None open. The Next.js bump was the only open P1; closed May 13 via PR #16.*

### P2 — Should address in next 1–2 sessions

- **Sheets API rate-limit headroom audit.** (Discovered 2026-05-13 during PR #16 smoke testing.) Rapid module navigation tripped 60-reads/min/user quota with cascading 429s. Real production risk under traffic spikes. Mitigation options: in-memory caching of hot reads, request coalescing within bootstrap, batchGet consolidation, quota increase request. Per-OAuth-user limit — SA routes unaffected. **Needs scoping session in fresh head.** See R12.

### P3 — Nice-to-have, no time pressure

- **Whole-sheet restore drill.** (Discovered 2026-05-13.) Tab-level drilled; whole-sheet only documented. ~30 min when scheduled.
- **`inventoryActions.js` import migration.** (Discovered 2026-05-13.) ~80 call sites — see Phase 5 cleanup items.
- **`SHEET_IDS` env-var-ification decision.** (Discovered 2026-05-13.) See Phase 5 cleanup items.
- **Directory route SA migration.** (Discovered 2026-05-13.) See Phase 5 cleanup items.
- **Backup retention policy.** ~90-day pruning sub-cron. Schedule for ~August (after real accumulation period).
- **Anthropic SDK consolidation.** Task #8. Needs spec first.
- **`.claude/settings.json` npm publish rule fix.** Task #16. 5-min fix.

### Discovered earlier, still parked

- **`SHEET_IDS.COLLECTION` retirement** (Phase 5)
- **R11 — Auth state environment-scoping in CI** (mitigated by docs; ongoing low risk)

---

## Risk Register

> **Update rule: every session-end. New risks added with discovery context. Existing risks updated when status changes.**

| # | Risk | Status | Mitigation |
|---|---|---|---|
| R1 | Test suite gaps — Phase 3 dual-write divergence could go undetected if Playwright coverage thin | 🟡 Harness exists (3 tests); expansion pending | Build harness as Phase 1 priority before any data migration |
| R2 | Dual-write divergence — Sheets and Postgres drift apart during 2-week validation | Open (Phase 3 risk) | Comparison tooling, weekly review of divergence reports |
| R3 | Supabase outage — new external dependency that doesn't exist today | Open (Phase 3 risk) | Monitor Supabase status; rollback plan to Sheets-only |
| R4 | Maintainer burnout — solo dev, 5-6 month arc | 🟡 Active mitigation | Documented procedures; HANDOFF_*.md hygiene used May 13 successfully |
| R5 | Bad commit to prod — direct push, missing CI gate, fatigue merge | 🟡 CI exists; branch protection pending Task #14 | Branch protection elevated priority after May 13 near-misses |
| R6 | Side project contamination — Holtburg game project at `~/Holtburg/` | Mitigated | HARD RULE physical directory separation, verified clean May 11 |
| R7 | Multi-tenancy data leak — query forgets `tenant_id` filter | Open (Phase 3+ risk) | Supabase row-level security at DB layer, not app layer |
| R8 | AI feature regression — TypeScript/Postgres migrations break OCR or AI Pulse | Open | AI features get explicit test coverage in Playwright suite |
| R9 | Incidents side-effect entanglement — Drive + Calendar + Slack + email + PDF + escalation all from one submission | Open (Phase 3 risk) | Settle architecture for side-effect modules before Phase 3 |
| R10 | Loss of operational distance — discipline that protected $10M+ ops hardest to maintain when full-time on codebase | Active | Trust docs and procedures more, not less |
| R11 | Auth state environment-scoping in CI — `storageState` cookies domain-locked | Mitigated | Documented in `GOTCHAS.md` + `TESTING.md` with refresh procedure |
| **R12** | **Sheets API rate limits — 60 reads/min/user can be tripped by rapid module navigation. Also affects the service account (per-project quota), not just user OAuth.** | **🟡 Identified and confirmed live 2026-05-13. No mitigation implemented yet. Higher priority than initially scoped — SA routes also affected.** | **Caching layer, request coalescing, or quota increase. Observability work (Sentry + custom health endpoint) is partly how we detect this in production. Scoping in next session.** |

---

## Pre-Specified, Not Built (Out of Scope for the Migration)

> **Update rule: items move in or out as explicit decisions are made. A decision to build something here moves it into the relevant Phase.**

Documented but explicitly NOT part of the migration arc. Lives in the broader product backlog:

- Culinary Management Platform (replacing Galley Solutions) — specced, stakeholders identified
- Pre-Service Briefing Tool — fully specced, content library (100 topics, bilingual), design locked
- Pre-Service print materials — bilingual wall postings (Batch 1 partial: S02, S05, S08, S09); pending Spanish-speaker validation
- Count History and Price Dashboard tools within Inventory Manager
- Custom domain `ops.kitchfix.com` — one CNAME, free on Vercel
- Standalone Slack maintenance logger (Railway-hosted) for STL-FL facility
- Backup retention policy (~90 days)

---

## Specifically Out of Scope

> **Update rule: same as above. Items only move out of this list with explicit decision + captain's-log entry.**

- **KPI Dashboard.** Built prematurely. Not referenced in current architecture, data flow, or tool connections until/unless reintroduced explicitly.
- Tailwind expansion beyond shadcn migration (no CSS-in-JS, no Material UI, no Chakra)
- Backend rewrites beyond Phase 3 (Google Sheets dual-architecture locked for non-migrated modules)
- Navigation/IA overhauls outside Phase 5's `/ops` dissolution
- Test framework alternatives (Playwright locked in)

---

## Captain's Log

> **Update rule: every session-end. One date-stamped line per session. Five-month arc means six months of these — when you're tired in October and want to know "did I ever drill X," grep this.**

- **2026-05-11** — Phase 0 closed. Foundations in place. Phase 1 begins.
- **2026-05-12** — PR #4 (Turbopack), PR #8 (analytics feature flag), PR #9 (Playwright harness). Closed Tasks #3, #4, #12.
- **2026-05-13 (morning)** — PRs #10–#13 shipped: `logHealthSA` cleanup, Playwright CI, auth.setup.ts regex, docs (TESTING + GOTCHAS auth-state). `CRON_SECRET` rotated. R11 captured.
- **2026-05-13 (push day)** — PRs #14–#18 shipped. Daily backup cron live + restore drilled. Next.js 16.2.6 security bump (19 advisories closed). All deps pinned. `SHEET_IDS.INVENTORY` footgun closed. `supportsAllDrives` audit verified clean. 3 new gotchas + restore runbook documented. R12 identified (rate limits). Phase 1 went from 46% to 77% closure. **Two near-misses of committing to main due to silent `git checkout -b` failures — recovery procedure now documented in GOTCHAS.**
- **2026-05-13 (doc creation)** — This living doc replaced the static migration plan. Session-start checklist and working agreements added. All Phase 1 status reflects end-of-day state.
- **2026-05-13 (end-of-day, post-observability scoping)** — Task #14 closed (branch protection on main, required GitHub Pro upgrade $4/mo). Observability scoping done — chose Sentry alone (not Better Stack) for an internal-tool scale, free Developer tier ($0/mo). R12 refined to reflect SA also affected. Phase 1 closure: 11 of 13 tasks. One Phase 1 gate remains (observability install — next session). Sentry account creation is the literal next concrete action.
- **2026-05-15** — Analytics module fully decommissioned (PRs #31/#32/#33). Stage 0 audit of `/api/cron/analytics` concluded the module had no plausible product use case post-migration. Decision change recorded in three places: (1) module migration order at #3 above — "Analytics" removed from the Phase 3 sequence with inline date note; (2) Task #4 row in Phase 1 task table — closed-status note updated to record full deletion 2026-05-15; (3) Phase 3 commentary section — "Analytics REBUILDS on Postgres" replaced with "Analytics REMOVED" framing (Sentry for errors, Vercel Analytics for traffic, Supabase dashboards for operational data; custom analytics not currently planned). Task #15 (Analytics taxonomy cleanup) marked Cancelled — obsolete. Full teardown narrative in `docs/SUPABASE_MIGRATION.md → 2026-05-15` captain's log entry.

---

## Bottom Line

**Five phases. Six months. Three architectural axes** (Postgres + TypeScript + shadcn). **One axis per module per pass. Tests first. Dependency-ordered everything. Multi-tenancy from day one. Preserve the work; don't rebuild from scratch.**

The goal isn't speed to Supabase. The goal is a foundation trustworthy enough that the work after this migration — new operational tools that protect the bottom line — gets built faster and safer than it could on the current Sheets foundation.

**Where we are 2026-05-13:** Phase 0 complete. Phase 1 at ~77% closure. The two highest-leverage Phase 1 outcomes — Playwright test harness and CI gates — are both live. Backup safety net is live AND verified by restore drill. Dependency tree is patched and pinned. Two gates remain before Phase 1 exit: branch protection (5 min) and observability scoping. Phase 2 unblocks when Phase 1 closes.