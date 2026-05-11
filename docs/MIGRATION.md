# Migration Plan — KitchFix Ops Hub Architectural Arc

> **Status:** Phase 0 complete (May 11, 2026). Phase 1 starting.
> **Owner:** Kevin Fietek
> **Estimated duration:** 5-6 months calendar time. Some phases gated by calendar (dual-write validation windows) regardless of effort. Capacity assumption: 20-40 hrs/week. If finishing phases ahead of schedule, the right move is depth, not speed — strengthen the test suite, add more observability, polish UX, write better docs. Don't pull Phase N+1 forward.
> **Strategic goal:** Evolve the intranet from a working solo-built tool into a production-grade operational platform capable of running KitchFix and optionally being spun out as a multi-tenant SaaS product.

---

## Locked decisions

1. **Multi-tenancy:** Yes. Every transactional Postgres table gets a `tenant_id` column from day one. KitchFix is `tenant_id = 1`.
2. **Naming:** Option A. The suite is **KitchFix Ops**. The current `/ops` umbrella dissolves during route-splitting. Its tools become top-level modules: `/season`, `/inventory`, `/invoices`, `/vendors`.
3. **Module migration order:** Dependency-ordered. Incidents → Vendors → Invoices → Inventory → Service Calendar → Season Tracker → Analytics → PAF → New Hire → Action Center & Admin Queue → Leadership Dugout → Reports → Directory → Financial → Dashboard.
4. **Architectural axes:** Postgres (Supabase), TypeScript, shadcn/ui + Tailwind v4. All three.
5. **Migration discipline:** One axis at a time per module. Never two simultaneously.
6. **Tests-first:** Phase 1 builds the Playwright suite against the current Sheets-backed system before any architecture changes.
7. **Workflow:** Branch → Claude Code → localhost → push → Vercel preview → manual merge to main in GitHub Desktop or GitHub UI.

---

## Guiding principles

**Never break production.** Dual-write, feature-flag, behind-the-test-suite. If a migration step doesn't have a rollback path, it's not ready to ship.

**One axis per module per migration.** TypeScript conversion, Postgres migration, and shadcn redesign happen in three separate passes, in that order, on each module.

**Tests catch behavior changes, not opinions.** Playwright tests assert end-to-end behavior. They don't pin implementation details. Each module's test suite must pass before, during, and after its migration.

**The runbook is code.** Every infrastructure change updates `docs/RUNBOOK.md` in the same commit. Same for env vars touching `docs/ENV_VARS.md`.

**Floor-first survives the migration.** Every UI change is validated on a phone-sized viewport before it ships.

**The arc is reversible.** Each phase has rollback procedures. Each module's data migration runs dual-write for two weeks minimum before Sheets goes read-only, and another two weeks before Sheets is removed. Total reversibility window per module: 4 weeks minimum.

---

## Phase 0 — Foundations ✓ COMPLETE (May 11, 2026)

- [x] Repo private
- [x] Vercel preview deploys confirmed working
- [x] Max 20x plan active
- [x] No `ANTHROPIC_API_KEY` in shell
- [x] Repo relocated to `~/dev/kitchfix-intranet`
- [x] `src-backup/` deleted, PR #1 merged
- [x] GitHub Desktop repointed
- [x] `gh` CLI authenticated for terminal git
- [x] Claude Code installed, authenticated, calibrated
- [x] First end-to-end branch → PR → preview → merge workflow completed

---

## Phase 1 — Safety net and ergonomics (weeks 2-3, ~30 hours)

**Goal:** Make production safer than it's ever been, without changing any architecture. Build the test suite that will catch regressions throughout the rest of the migration.

### Tasks

1. **Playwright test harness against the current system.** 30-40 happy-path tests covering critical flows for every module. Test data isolation via a dedicated test tab in COLLECTION sheet.

2. **GitHub Actions CI.** Run ESLint, TypeScript check (placeholder for now, becomes real in Phase 2), and Playwright tests on every PR. Block merge if any fail. Add branch protection on `main`: require CI passing, require 1 review.

3. **Observability stack.**
   - Sentry: server + client error capture with Slack integration
   - Better Stack (or Uptime Robot): synthetic uptime monitoring of `/api/health`
   - Vercel Analytics: enable
   - `/api/health` endpoint: returns 200 if it can read one row from HUB, 500 otherwise

4. **Anthropic SDK consolidation.** Replace three raw `fetch` calls (in `invoiceActions.js` 3x and `inventoryActions.js` 1x) with `@anthropic-ai/sdk`. Create `src/lib/ai.ts` with shared client, retry logic, timeout handling, and centralized logging.

5. **Daily Sheets backup.** Google Apps Script in each of the five sheets. Triggers 2 AM Central daily. Copies to timestamped Drive folder. 30-day retention. Slack alerts on success/failure.

6. **lucide-react upgrade.** ~~Bump from 1.14 to current. Audit icon imports.~~ Closed 2026-05-11 as a no-op — `^1.14.0` is already the latest release. The 1.x line is lucide-react's *current* lineage (it cut 1.0.0 on 2026-03-20, reset upward from 0.x); it is not a stale pre-reset version. Icon imports audited: one importer (`src/components/people/IncidentLibrary.js`, 6 icons), all valid in 1.14.0, no renames affect us. See Captain's log.

7. **Documentation.**
   - `docs/RUNBOOK.md` (expand from skeleton)
   - `docs/ENV_VARS.md` (verify all values against Vercel dashboard)
   - `docs/MIGRATION.md` (this document, ongoing)

8. **Analytics taxonomy cleanup.** Audit current `logEventSA` calls. Build canonical taxonomy in `src/lib/analyticsTaxonomy.ts`. One-time normalization pass on the analytics sheet.

### Additional tasks from May 11 calibration

9. **Auth boundary cleanup.** Consolidate the hand-rolled JWT path in `src/app/api/people/route.js` (lines 80-151) to use `src/lib/sheets.js`'s canonical service account client. Rename local non-SA helpers to use the SA suffix.

10. **OAuth scope reduction.** Change `src/lib/auth.js` from full `drive` scope to `drive.file`. Test that all Drive operations still work (they will — the service account does the writes, not the user token).

11. **Turbopack opt-in.** ~~Change `package.json` script from `next dev --webpack` to `next dev`. Verify build works. Should reduce local dev startup time significantly.~~ Shipped 2026-05-11 in PR #4 (commit 83fd0d5) — removed the `--webpack` flag from the `package.json` dev script. Verified the Turbopack banner appears on `npm run dev` startup; production builds were already on Turbopack via the Next 16 default. See Captain's log.

12. **Analytics sheet rotation.** Archive old analytics events to a separate sheet to free up cells. Bridge measure until Phase 3 moves analytics to Postgres.

13. **Dependency pinning evaluation.** Decide whether to pin `googleapis` and `google-auth-library` to specific versions or accept the caret range. Decision and rationale documented.

### Exit criteria

- [ ] Playwright suite with 30+ tests covering critical paths for every module
- [ ] CI runs tests on every PR and blocks merge on failure
- [ ] Branch protection on main: CI required, 1 review required
- [ ] Sentry, Better Stack, Vercel Analytics live; alerts working
- [ ] `/api/health` endpoint live and monitored
- [ ] All Anthropic calls go through `src/lib/ai.ts`
- [ ] Daily sheet backups confirmed running for 7 consecutive days
- [x] lucide-react — closed 2026-05-11 as no-op; already on latest (1.14.0)
- [ ] `RUNBOOK.md`, `ENV_VARS.md`, `MIGRATION.md` complete
- [ ] Auth boundary cleanup done
- [ ] OAuth scope reduced
- [x] Turbopack flipped on — shipped 2026-05-11 (PR #4)
- [ ] Production hasn't broken once during this phase

---

## Phase 2 — TypeScript foundation (weeks 4-6, ~30 hours)

**Goal:** Convert load-bearing infrastructure to TypeScript so the Postgres migration can use real types.

### Conversion order

`src/lib/*.js` → `src/lib/*.ts`, file by file:

1. `opsUtils.js` — defines core types (`Account`, `Period`, `Vendor`)
2. `sheets.js` — typed Sheets client, return types on every helper
3. `auth.js` — typed session, token, callbacks
4. `analytics.js` — uses the new `analyticsTaxonomy.ts` types
5. `drive.js` — typed file metadata, typed upload responses
6. `gmail.js` — typed message construction
7. `incidentSchema.js`, `incidentActions.js`, `inventoryActions.js`, `invoiceActions.js`
8. `peopleReport.js`, `stampInvoice.js`, others

### Rules

- Strict mode on from day one (`"strict": true` in `tsconfig.json`)
- `any` is allowed but flagged with `// TODO: type properly`
- No JS-to-TS conversion of pages or components in this phase
- Each file conversion is its own commit
- CI runs Playwright on every PR
- Date helpers (`formatDate`, `fmt`, `parseDate`) consolidate to `src/lib/dates.ts`

### Exit criteria

- [ ] All files in `src/lib/` are `.ts`
- [ ] `tsconfig.json` strict mode enabled
- [ ] Date helpers consolidated
- [ ] CI type-check is real
- [ ] All Playwright tests still pass

---

## Phase 3 — Supabase migration, module by module (weeks 7-16, ~120 hours)

**Goal:** Move every transactional data store from Google Sheets to Supabase Postgres. Sheets remains as a config layer for human-edited reference data only.

### Setup (week 7)

- Create Supabase project. Free tier initially; upgrade to Pro ($25/mo) when warranted.
- Configure auth: link to existing Google OAuth. NextAuth stays in front; Supabase auth is for RLS only.
- Schema baseline:
  - `tenants` table. Insert `(1, 'KitchFix')`.
  - `users` table linked to NextAuth identity.
  - RLS policies: every transactional table requires `tenant_id = current_setting('app.current_tenant')::int`.
- Set up `src/lib/db.ts` abstraction.
- Generate TypeScript types from Supabase. Commit to `src/lib/database.types.ts`.

### Standard migration pattern (per module)

1. **Schema design.** Map existing Sheets columns to Postgres. Add foreign keys, indexes, `tenant_id`, `created_at`, `updated_at`. Migration SQL in `supabase/migrations/`.
2. **Data-access layer.** Add module functions to `src/lib/db.ts`. Typed against Supabase types.
3. **Dual-write.** Update action handlers to write to both Sheets and Postgres. Reads still from Sheets. Run for 1 week.
4. **Shadow read validation.** Comparison job reads both stores, logs divergence to Sentry. Run for 1 week. Fix all divergences.
5. **Cutover.** Flip reads to Postgres behind feature flag. Sheets writes continue. Monitor 48 hours.
6. **Decommission.** After 2 weeks of clean Postgres reads, stop writing to Sheets. After another 2 weeks, archive the sheet tab.

Per-module reversibility window: 4 weeks minimum.

### Module sequence

1. **Incidents** (weeks 7-8). Proves the pattern. Smallest blast radius.
   - **CRITICAL:** Incidents has external side-effect entanglement (Drive folders, Calendar events, Slack, email, PDF). The dual-write pattern needs special handling to avoid duplicate side-effects. Plan this before starting.
2. **Vendors** (weeks 9-10). Reference data Invoices depends on.
3. **Invoices + AI Line Items** (weeks 10-12).
4. **Inventory** (weeks 12-13). Includes Railway cron coordination.
5. **Service Calendar** (week 13).
6. **Season Tracker / Labor** (week 14).
7. **Analytics events** (week 14). Resolves the 10M cell limit issue.
8. **PAF submissions** (week 15).
9. **New Hire Wizard** (week 15).
10. **Action Center & Admin Queue** (week 15).
11. **Leadership Dugout** (week 16).
12. **Reports** (week 16). Pure read-side.
13. **Financial** (week 16). Mostly aggregation.

**Directory stays on Sheets.** Reference data, human-edited, low volume. Migrating it gains nothing. Deliberate exception.

**Dashboard migrates last.** Pure aggregator. Phase 5.

### Exit criteria

- [ ] All transactional data in Postgres
- [ ] All modules' reads from Postgres
- [ ] No Sheets writes (except Directory)
- [ ] RLS policies enforced on every table
- [ ] Multi-tenancy verified by inserting a second test tenant and confirming isolation
- [ ] Historical Sheets archived to Drive
- [ ] All Playwright tests pass against Postgres-backed system
- [ ] Zero production incidents during the phase

---

## Phase 4 — shadcn/ui + Tailwind v4 + mobile-first (weeks 17-21, ~60 hours)

**Goal:** Replace the hand-built vanilla CSS component system with shadcn/ui. Mobile-first becomes the default. PWA support added.

### Setup (week 17)

- Install shadcn/ui CLI, generate `components.json`
- Add primitives: `Button`, `Dialog`, `Input`, `Label`, `Select`, `Textarea`, `Table`, `Card`, `Toast`, `DropdownMenu`, `Tabs`, `Sheet`, `Skeleton`, `Avatar`, `Badge`
- Configure Tailwind v4 with `@theme` directive for KitchFix brand tokens
- Configure shadcn theme to match brand

### Migration order

Same as Phase 3, each module's UI migrates after its data migration is finalized:

1. Rebuild components: replace `oh-modal-`, `oh-btn-`, etc. with shadcn primitives
2. Mobile-first redesign: 375px viewport validation, ≥44px touch targets, correct iOS keyboard types, pull-to-refresh where appropriate

### PWA setup (week 19, parallel)

- Service worker setup (`next-pwa` or manual)
- App manifest with KitchFix branding
- Offline shell: app loads with cached data on no network
- Queued writes for offline mode
- Installable to home screen on iOS and Android

### Polish layer (week 21)

- Cmd-K command palette via `cmdk`
- Skeleton loading states everywhere
- Standardized toast notifications
- Designed empty states for every list view

### Exit criteria

- [ ] Every module's UI uses shadcn primitives
- [ ] No `oh-*-` prefixed CSS classes remain
- [ ] Every screen validated at 375px and 1024px
- [ ] PWA installable on iOS and Android
- [ ] Offline shell renders with cached data
- [ ] Offline writes queue and sync on reconnect
- [ ] Cmd-K palette covers every common action
- [ ] All Playwright tests still pass

---

## Phase 5 — Route splitting, naming, Dashboard, polish (weeks 22-24, ~30 hours)

**Goal:** Implement Option A naming and IA. Split giant route files. Dashboard becomes the suite's home, properly aggregating from Postgres.

### Route splitting

`src/app/api/people/route.js` (2,165 lines, 24 actions) becomes:
- `src/app/api/people/paf/route.ts`
- `src/app/api/people/new-hire/route.ts`
- `src/app/api/people/incidents/route.ts`
- `src/app/api/people/action-center/route.ts`
- `src/app/api/people/admin-queue/route.ts`
- `src/app/api/people/reports/route.ts`
- `src/app/api/people/leadership-dugout/route.ts`

**CRITICAL:** Build a shared auth/config loader first. The action-dispatch pattern's hidden benefit is single HUB config load per request — splitting without this gives N× more HUB API calls. Identified during May 11 calibration.

Similar split for `src/app/api/ops/route.js`. Shared imports move to `src/lib/people/` and `src/lib/ops/`.

### IA changes (Option A)

`/ops` route dissolves. Top-level modules:
- `/season` (was `/ops` → Season Tracker tab)
- `/inventory` (was `/ops` → Inventory tab)
- `/invoices` (was `/ops` → Invoice Capture tab)
- `/vendors` (was `/ops` → Vendor Portal tab)

Top nav reorganizes. Redirects from old URLs in place for 90 days.

### Suite naming pass

- Suite is **KitchFix Ops**. Updates to `<title>`, manifest, README, all docs.
- Each module retains its name.
- "Ops Hub" references removed from anything user-facing.

### Dashboard rebuild

- Real-time data via Supabase subscriptions where it adds value
- SQL-driven aggregation
- Personalized to viewer
- Mobile-first

### Documentation finalization

- `/docs/ARCHITECTURE.md` rewritten for new architecture
- Old "Sheets-as-database" content moved to `/docs/HISTORY.md`
- `/docs/MIGRATION.md` marked complete with retrospective

### Exit criteria

- [ ] No route file over 400 lines
- [ ] `/ops` dissolved, new top-level routes live with redirects
- [ ] Suite uniformly named "KitchFix Ops" everywhere user-facing
- [ ] Dashboard rebuilt with real-time data
- [ ] Documentation up to date
- [ ] All Playwright tests pass
- [ ] Production hasn't broken once during the entire arc

---

## Risk register

**R1: Test suite is wrong or incomplete.** Mitigation: every module's tests reviewed against actual user workflows during Phase 1. Add tests retroactively when gaps discovered.

**R2: Dual-write window allows data divergence.** Sheets is canonical during dual-write. Shadow-read job in Step 4 catches divergence. No cutover until divergence is zero for a week.

**R3: Supabase outage or pricing change.** Postgres is portable. `src/lib/db.ts` abstraction means we can swap providers. Daily Supabase backups + weekly logical dumps to Drive.

**R4: Burnout.** Phase structure means safe to pause between phases — production always in stable state. Pause weeks built in.

**R5: Bad commit reaches production.** CI must pass. Vercel preview sanity-check on phone before merge. Branch protection. Sentry alerts. Rollback documented in runbook.

**R6: Side project contamination.** Separate directories, separate `CLAUDE.md`, separate terminals.

**R7: Multi-tenancy bugs leak data across tenants.** Phase 3 tests run against two tenants asserting isolation. "Test tenant" added day one of Phase 3.

**R8: AI feature quality regresses during SDK consolidation.** Playwright tests cover invoice OCR and inventory matching, must pass before and after.

**R9 (added May 11): Incidents side-effect entanglement during dual-write.** Single incident submit fires Drive folder creation, Calendar event, Slack, email, PDF stamping. Naive dual-write could fire these twice or zero times. Settle architecture before Phase 3 starts.

**R10 (added May 11): Loss of operational distance.** With the maintainer now full-time on this codebase, every architectural choice risks becoming a personal preference rather than a structured decision. The discipline that protected $10M as a part-time dev is hardest to maintain when this becomes a full-time identity. Mitigation: trust the docs and procedures more, not less. The CLAUDE.md, RUNBOOK, ENV_VARS, and MIGRATION docs exist to protect future-self from present-self. Every shortcut feels small at the time and looks expensive in retrospect.

---

## Captain's log

- **2026-05-11** — Document created during Phase 0 completion. Five phases scoped. Three architectural axes locked. Multi-tenancy locked yes. Naming locked Option A. Migration order locked dependency-ordered. Six calibration findings added to Phase 1 backlog. Risk R9 added based on Claude Code's identification of Incidents side-effect entanglement. Risk R10 added based on maintainer's transition to full-time work on the codebase.
- **2026-05-11** — Phase 1 Task 6 (lucide-react upgrade) closed as a no-op. The task was scoped on a misread of lucide-react's version history: `^1.14.0` was assumed to be an old pre-reset version with `0.5xx` being current. The reverse is true — lucide-react ran the `0.x` lineage for years, then cut `1.0.0` on 2026-03-20 and is now at `1.14.0` (2026-04-29), which is the current `latest` dist-tag and already what's in `package.json`. Verified against the npm registry. Only one file imports it — `src/components/people/IncidentLibrary.js` (Pin, ShieldCheck, ClipboardList, BookmarkCheck, MapPin, GraduationCap) — and all six resolve in 1.14.0; no renames or removals between the assumed-old and actual-current versions because there is no gap. No `npm install`, no `package.json` change, no code edits. Lesson: don't infer "stale" from a version number alone; check the registry's dist-tags.
- **2026-05-11** — Phase 1 Task 11 (Turbopack opt-in) shipped (PR #4, commit 83fd0d5). One-line change in `package.json`: dropped the `--webpack` flag from the `dev` script. Production was already building with Turbopack via the Next 16 default; only local dev was opting out — the fix just aligns local with production. Separately, during today's local dev session the Analytics 10M-cell-limit issue (calibration finding #4) was confirmed live: analytics events are silently failing in production because the sheet is full. **Priority for next session — address this before any other Phase 1 task.**
