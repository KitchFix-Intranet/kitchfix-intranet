# Supabase Migration Plan — KitchFix Ops Hub

> **Status: Committed.** Decision made 2026-05-14.
> **Last updated:** 2026-05-14
> **Owner:** Kevin Fietek
> **Estimated duration:** 3-5 months calendar time, depending on weekly capacity.
> **Approach:** Strangler fig — staged migration by data category, not big-bang cutover.

---

## How to use this doc

**This is a living document.** It is the single source of truth for migration state. Read at the start of every session, update at the end of every session, commit to the repo as part of the work it describes.

**This doc supplements \`docs/MIGRATION.md\`.** The original migration plan described phases 0-5 of broader architectural work. Phase 4 (Database Migration) is now pulled forward and reshaped into this dedicated plan. The other phases either continue, defer, or are absorbed into this migration. See "Impact on the original migration plan" below.

**Stale doc = broken doc.** If the "last updated" date is more than 2 weeks old, treat with suspicion and verify against the actual repo and Supabase state.

---

## The Decision

**Date:** 2026-05-14
**Decided by:** Kevin Fietek (solo developer/founder)
**Decision:** Migrate the KitchFix Ops Hub backend from Google Sheets to Supabase (PostgreSQL).

**Rationale:**

1. **The Sheets architecture has reached its limit.** R12 (rate limit risk) fired live on 2026-05-13. Today's audit revealed legacy dead code burning quota unnecessarily. The pattern indicates a system architecture under strain, not just a bug to fix.

2. **Every feature built on Sheets between now and migration is wasted effort.** Code written against the current backend will need to be rewritten during migration. Pausing feature work for a migration sprint costs less long-term than continuing to build on a backend that's leaving.

3. **The technical debt is becoming structural.** Sheets has no schema enforcement, no transactions, no proper relationships, no indexes. As KitchFix grows (more users, more data, more features), these limitations compound. Migrating sooner means migrating less.

4. **The destination matches the existing stack.** Supabase (Postgres + auth + edge functions) is built for the Next.js + Vercel ecosystem. Native fit, well-documented, large community.

5. **Strategic instinct.** Kevin has raised Supabase across multiple sessions. Engineer's instinct about their own system is usually right; this matches the pattern of "you can feel it's the right time."

**What this decision does NOT commit to:**
- A specific timeline (5 months is an estimate, not a deadline)
- An all-or-nothing migration — some operator-edited config may stay on Sheets
- A specific auth strategy (NextAuth vs Supabase Auth is an open question — see below)
- Specific Postgres features (Row Level Security, Edge Functions, Realtime, Storage — to be evaluated stage by stage)

---

## The Approach: Strangler Fig

The migration is **staged by data category and risk**, not all-at-once. Each stage:
- Ships when complete (no half-migrated states left in production)
- Can be paused between stages if other priorities emerge
- Lower-risk stages teach Supabase patterns before higher-risk stages
- Each stage delivers user-visible improvement (faster pages, fewer rate limit incidents)

**Rejected alternatives:**

- **Big-bang cutover.** Stop all feature work, rewrite everything, deploy in one weekend. Too risky for a solo dev; one unforeseen issue blocks production for everyone.
- **Hybrid permanent state.** Keep both backends forever. Hybrid is the worst of both worlds — twice the integration code, twice the things that break, ongoing cognitive overhead. Most teams that try hybrid regret it within 12 months. We commit to a single destination.
- **Pre-clean Sheets first as a separate step.** Cleaning is intrinsic to the migration. Doing it twice (once in Sheets, then again mapping to Postgres) is wasted effort. The audit and the schema design happen together.

---

## The Stages

### Stage 0 — Audit + Abstraction Layer (current stage)

**Goal:** Know what data exists, what's actually used, and create a clean data-access boundary in code.

**Why this comes first:** You can't migrate intelligently when you don't yet know what data is real. Today's discovery (dashboard reading 3 dead tabs on every load) is proof. The audit IS the prep.

**Tasks:**

- [x] Dashboard route dead-read cleanup (PR #23, 2026-05-14)
- [ ] Audit People Portal route (\`src/app/api/people/route.js\`)
- [ ] Audit Ops Hub route (\`src/app/api/ops/route.js\`)
- [ ] Audit Service Calendar route
- [ ] Audit Directory route
- [ ] Audit cron routes
- [ ] Cross-reference all reads with the actual sheet contents (HUB + COLLECTION). Tabs with 0 data rows that are also unused = delete code.
- [ ] Refactor \`src/lib/sheets.js\` into a cleaner data-access layer. Goal: a stable interface that can later route to either Sheets or Supabase without callers caring.
- [ ] Document the abstraction interface so future feature work uses it consistently.

**Output:** Repo is "migration-ready." Codebase is leaner, data access is abstracted, we know what's real.

**Estimated effort:** 4-8 sessions of focused work. ~3-4 weeks calendar time.

---

### Stage 1 — Supabase Setup + Schema Design

**Goal:** Supabase project provisioned. Postgres schema designed and deployed. No code touching it yet.

**Tasks:**

- [ ] Create Supabase project (production + staging)
- [ ] Decide auth strategy:
  - Option A: Keep NextAuth + Google OAuth, use Supabase only for data (simpler migration)
  - Option B: Migrate auth to Supabase Auth (more unified, more migration risk)
  - Recommendation pending until Stage 0 complete
- [ ] Design the Postgres schema based on the audit findings:
  - One table per current sheet "concept" (not 1:1 with tabs — clean as you go)
  - Real foreign keys
  - Real indexes
  - Real data type enforcement
- [ ] Deploy schema to staging Supabase project
- [ ] Set up Row Level Security (RLS) policies (or decide explicitly to defer until later)
- [ ] Decide backup strategy (Supabase has built-in PITR backups; need to confirm what tier we're on)
- [ ] Connect to Vercel via Vercel-Supabase integration

**Output:** Empty Supabase ready to receive data.

**Estimated effort:** 2-3 sessions. ~1-2 weeks calendar time.

---

### Stage 2a — Migrate Read-Only HUB Tabs

**Why first:** These tabs change slowly. Code reads them on every page load. Biggest quota win, lowest risk.

**Tabs in scope:**
- \`accounts\`
- \`contacts\`
- \`period_data\`
- \`hero_images\`
- \`kitchFix_philosophy\`
- \`dir_links\`
- \`work_locations\`
- \`kiosk_info\`
- \`admins\`
- \`notifications\`
- \`homestand_schedule\`
- \`labor_budgets\`
- \`service_config\`
- \`vendor_master\`
- \`vendor_accounts\`
- \`library_manifest\`
- \`personnel_celebrations\`
- \`news_posts\`
- \`gl_codes\`
- \`did_you_know\`
- \`wastenot_resources\`
- \`kk_values\`
- \`ai_prompts\`

**Approach:**
1. Write migration script that one-time-copies each tab to its Postgres equivalent
2. Build sync mechanism: Sheets → Postgres on schedule (since operators may still edit Sheets initially)
3. Update affected API routes to read from Supabase instead of Sheets
4. Operators continue editing Sheets, sync keeps Postgres current
5. Verify in production for 1-2 weeks
6. Eventually: cut over operator editing to admin UI (or accept Sheets-as-source-of-truth with auto-sync)

**Tabs explicitly NOT in this stage (in development, don't touch):**
- \`preservice_content\` (Pre-Service Briefing Tool)
- \`HUB__Performance_*\`, \`COLL__Cycle_Review_*\`, \`COLL__WOW_*\`, \`COLL__Scorecards\` (KPI Dashboard parked)
- \`ops_newsfeed\` (in development)

**Estimated effort:** 4-6 sessions. ~2-3 weeks calendar time.

---

### Stage 2b — Migrate People Portal Data

**Why second:** Mostly forms. Submissions/drafts/notifications/notification_log are write-heavy but contained — they don't sprawl into other features. Good practice for transactional migration before the harder Ops Hub work.

**Tabs in scope:**
- \`submissions\` (96 rows, active)
- \`drafts\` (17 rows, active)
- \`notification_log\` (411 rows, active)
- \`employee_roster\` (99 rows, read-only via Rippling sync — keep in mind)

**Approach:**
- Schema design accounts for the People Portal's specific JSON payload pattern (currently stored as JSON in a Sheet column — Postgres has native JSONB which is better)
- Dual-write during transition: write to both Sheets and Postgres
- Migrate reads to Postgres first
- Verify, then cut writes to Postgres-only
- Eventually: archive Sheets tab to cold storage

**Tabs explicitly NOT in this stage (in development, don't touch):**
- \`incidents\` (in development, do not touch)
- \`_archived_*\` tabs (verify if these are real archives or can be deleted)

**Estimated effort:** 4-6 sessions. ~2-3 weeks calendar time.

---

### Stage 2c — Migrate Ops Hub Data

**Why third:** Most complex, most volume, most risk. By this stage we've already done a HUB migration and a People migration — we know our patterns.

**Tabs in scope:**
- \`inventory_submissions\` (28 rows, active)
- \`invoice_submissions_26\` (386 rows, active — high volume)
- \`labor_plans\` (16 rows, active)
- \`labor_sold_revenue\` (8 rows, active)
- \`service_audit_log_26\` (8 rows, active)

**Approach:**
- Schema designed carefully for invoice OCR pipeline (currently stuffs JSON into sheet columns)
- Dual-write during transition
- Carefully sequence: read migration first, then writes
- Invoice upload pipeline gets attention — it's the highest-impact write path

**Tabs explicitly NOT in this stage (in development, don't touch):**
- \`deep_clean_days\` (in development)
- \`service_day_overrides_26\` (empty, likely related to in-dev work)

**Estimated effort:** 6-10 sessions. ~3-5 weeks calendar time.

---

### Stage 2d — Migrate Service Calendar Data

**Why last:** Service Calendar is a relatively new module. Smaller surface than Ops Hub but still transactional.

**Tabs in scope:**
- All \`service_*\` tabs and projections/actuals data
- Plus shared HUB tabs already covered in Stage 2a

**Estimated effort:** 3-4 sessions. ~2 weeks calendar time.

---

### Stage 3 — Decommission Sheets dependencies

**Goal:** Sheets retained only for what genuinely benefits from operator editing. Most reads/writes happen against Postgres.

**Likely Sheets retainees:**
- Configuration tabs that operators actively edit (vendor master, schedules, accounts) — if we don't build admin UIs
- Reporting exports for finance teams

**Likely Sheets deletions:**
- All transactional tabs (submissions, invoices, inventory, labor)
- All log tabs (notification_log, etc.)
- All empty/dead tabs (kudos_log, wastenot_log, etc. — already removed from reads in PR #23)

**Estimated effort:** 2-3 sessions. ~2 weeks calendar time.

---

## The Abstraction Layer (Stage 0 detail)

The data-access abstraction is the most important technical pattern of this migration. Done right, it lets us swap backends underneath features without rewriting features.

**Current state:** \`src/lib/sheets.js\` has 14 exported functions, called from 91 places across the API routes. Most callers know they're talking to Sheets (use sheet IDs, tab names, column indexes).

**Target state:** Callers use a higher-level API:
- \`getAccounts()\` instead of \`readSheetSA(SHEET_IDS.HUB, "accounts")\`
- \`getSubmissionsForUser(email)\` instead of scanning all rows manually
- \`createInvoice(data)\` instead of \`appendRow(...)\`

Behind those calls, the implementation can route to Sheets today, Postgres tomorrow.

**Design principles:**
1. **Domain language, not storage language.** Callers ask for "accounts," not "rows from a tab"
2. **Single source of truth per concept.** One way to get a contact, not three
3. **Error handling at the boundary.** Callers get clean errors, not undefined sheet quirks
4. **Type definitions** (even in JS, JSDoc or eventual TS migration) so callers know shapes

This work happens **before** any Supabase code is written. The abstraction is the bridge that lets the migration happen surgically.

---

## Impact on the original migration plan (docs/MIGRATION.md)

Today's commitment reshapes the original Phase 1-5 plan:

### Phase 1 — Foundation (still active)

**Status: ~85% complete, finish what's started.**

| Task | Status | New consideration |
|---|---|---|
| #1 Tests | ✅ Closed (PR #11-13) | Keep — tests prevent migration regressions |
| #2 OAuth scope reduction | Open | **DEFER** until post-migration. Touches auth, unrelated to data layer. |
| #3-9 Various security/infra | ✅ Closed | Keep — independent of data layer |
| #10 Observability | ✅ Phase A closed (Sentry) | **Phase B observability instrumentation CANCELLED** — R12 goes away post-migration. Don't build for a backend that's leaving. |
| #11-13 Branch protection, backups, deps | ✅ Closed | Keep |
| #14 Branch protection | ✅ Closed | Keep |

**Updated Phase 1 exit gates:**
- ✅ Tests cover critical paths
- ✅ CI runs every PR
- ✅ Branch protection on main
- ✅ Backup safety net online + restore-verified
- ✅ Deps pinned and audit-clean
- ✅ Error observability live (Sentry Phase A)

**Phase 1 is effectively closed.** The OAuth scope reduction was the last item; deferring it to post-migration is acceptable because:
- The risk it mitigates (over-broad Drive access) is small for an internal tool
- Post-migration, the entire Drive access pattern may change (Supabase Storage instead)
- Fixing it now would require directory route refactoring that may be wasted post-migration

### Phase 2 — TypeScript conversion

**Status: DEFERRED.**

Reasoning: Converting \`.js\` to \`.ts\` for code that's about to be partially rewritten is wasted effort. Wait until post-migration, when the codebase is stable.

Exception: any new files written during the migration should be TypeScript from day one if it doesn't slow us down. Don't backport, but don't add to the JS pile either.

### Phase 3 — Refactor + architecture cleanup

**Status: ABSORBED into Stage 0 of this migration.**

The data-access layer refactor *is* Phase 3 for the parts of the code that matter. The rest of Phase 3 (component cleanup, routing improvements, etc.) defers to post-migration.

### Phase 4 — Database migration

**Status: SUPERSEDED by this doc.**

This plan replaces Phase 4. It's pulled forward and scoped more concretely.

### Phase 5 — Multi-tenancy / SaaS

**Status: DEFERRED, but informed by this migration.**

Supabase has multi-tenant patterns built-in (RLS, organization tables). If we design the schema with multi-tenancy in mind from the start, Phase 5 becomes much easier when it arrives. Worth noting during schema design even though we're not building it now.

---

## Open Questions

These get resolved as we hit each stage, not all at once:

1. **Auth strategy:** Keep NextAuth or migrate to Supabase Auth? Decision deferred to Stage 1.
2. **Realtime?** Supabase has built-in realtime subscriptions. Useful for live-updating dashboards, but adds complexity. Evaluate during Stage 2b/2c.
3. **Edge Functions vs Vercel functions?** Supabase has its own serverless runtime. Could replace some Vercel API routes. Decision deferred until we see what makes sense per stage.
4. **Storage:** Drive currently holds invoice PDFs. Supabase Storage could replace this. Evaluate during Stage 2c (Ops Hub migration).
5. **Backup strategy:** Supabase has PITR. Verify retention policy matches or exceeds our current daily Sheets backup. May replace \`/api/cron/backup-sheets\` entirely.
6. **Cost trajectory:** Free tier sufficient through audit + early stages. Pro tier (\$25/mo) likely needed by Stage 2b or 2c.
7. **Read replica vs single instance:** Default is fine for our load. Revisit if performance becomes an issue.

---

## What's still active (independent of migration)

These continue normally because they don't depend on the data layer:

- Sentry monitoring (Phase A, shipped today)
- Daily Sheets backup cron (running daily; will be replaced by Supabase PITR eventually)
- Branch protection
- All security/auth work that's not OAuth-scope-specific
- Bug fixes in active features
- Pre-Service Briefing Tool (specced, can be built — but build against the abstraction layer once it exists, so it survives migration)

## What's cancelled

These work items are removed from the active backlog:

- **R12 visibility instrumentation (Phase B observability).** The rate-limit problem dissolves post-migration. Not worth building instrumentation for a deprecated backend.
- **Persistent quota tracking (Upstash/Vercel KV for Sheets quota).** Same reason.
- **\`inventoryActions.js\` migration to \`SHEET_IDS\`.** Code that's being rewritten doesn't need refactoring.

## What's deferred to post-migration

- Task #2 (OAuth scope reduction)
- Phase 2 (TypeScript conversion)
- Most of Phase 3 (refactor, beyond the data layer abstraction)
- Phase 5 (multi-tenancy)
- KPI Dashboard work (was already parked)
- Culinary Management Platform build (was already specced-not-built)

---

## Risks (specific to this migration)

| ID | Risk | Status | Mitigation |
|---|---|---|---|
| M1 | Migration takes longer than expected (8+ months) | Likely | Stage-by-stage approach allows pausing. Don't commit to dates, commit to stages. |
| M2 | Production downtime during cutover | Likely some | Plan cutover windows, communicate to team in advance, dual-write during transition |
| M3 | Data loss during migration | Mitigated | Daily Sheets backups continue throughout. Postgres also gets PITR. Verify before destructive operations. |
| M4 | Postgres learning curve slows us down | Likely | Accept this. Plan first migrations with extra time buffer. Use Supabase docs heavily. |
| M5 | Team morale: no new features for months | Real concern | Communicate the strategic rationale. Frame each stage as user-visible improvement (faster, more reliable). Pre-Service Briefing Tool could ship during migration as a goodwill feature. |
| M6 | Vendor lock-in to Supabase | Acknowledged | Supabase is open-source Postgres underneath. If we ever need to leave, the schema and data are portable. Storage and auth are more locked-in but not catastrophic. |
| M7 | Scope creep during migration | Likely | Strict boundary: don't add features during migration. The migration is the work. New features wait until done. |
| M8 | Solo developer burnout | Real concern | Pace work. Don't grind. Take session-end discipline seriously. Doc updates protect against context loss. |

---

## Working agreements (specific to migration)

These supplement the working agreements in \`MIGRATION.md\`:

1. **The migration is the priority.** When in doubt, work on migration tasks, not feature requests.
2. **Don't add features to features being migrated.** When working on Ops Hub data migration, don't add new Ops Hub features. They get rewritten anyway.
3. **Schema decisions are durable.** Postgres schema changes after data is in production are harder than getting them right the first time. Don't rush stage 1.
4. **Test against staging Supabase first.** Always. Production Supabase is downstream of testing.
5. **Dual-write transitional states are first-class.** Plan them, name them, decommission them deliberately.
6. **The audit work is real work.** Reading the codebase and understanding data flow IS migration work, not preamble.

---

## Captain's Log

- **2026-05-14** — Migration committed. Strangler fig approach chosen over big-bang. Stages: 0 (audit + abstraction), 1 (Supabase setup), 2a (read-only HUB), 2b (People Portal), 2c (Ops Hub), 2d (Service Calendar), 3 (decommission). Dashboard cleanup PR #23 reclassified as Stage 0 Step 1. Most of Phase 2-5 of the original `MIGRATION.md` plan deferred or absorbed.

  **How the decision arose:** Today's planned work was Sentry Phase A install + Phase B observability scoping + Task #2 OAuth scope reduction. Shipped Sentry (PR #21) and its docs (PR #22) on plan. Then noticed during local dashboard testing that the `/api/dashboard` route was reading kudos/waste/logs/celebrations on every page load — none of which the current dashboard UI displays. Audit confirmed: ~3 dead Sheets reads + 1 dead write + 3 dead metric computations + dead helper function per dashboard load. PR #23 surgically removed them (~200 lines deleted, 3x faster dashboard load, ~500 fewer Sheets calls/day for 25 users).

  **What the discovery surfaced:** This pattern (legacy backend reads that survived UI rewrites) is likely systemic across all routes — `people/route.js` has 25+ action handlers and ~2165 lines, `ops/route.js` has multiple bootstrap actions with 13+ reads. Started a full-codebase audit; uploaded HUB + COLLECTION xlsx files for ground-truth verification. Discovered that several core "feature" tabs (kudos_log, paf_log, incidents at the time, kudos_bonus_log, labor_logs, invoice_logs) have 0 data rows — features exist in code but never adopted, or are still in development.

  **The strategic conversation:** Kevin raised that the Sheets-as-backend architecture is a learning-while-building artifact accumulating cluttered tabs, and that the rate-limit incident yesterday + today's dead-code discovery indicate it may be time to think about Supabase. Discussed: (a) honest tradeoffs of staying on Sheets vs migrating, (b) hybrid as a rejected option, (c) cleanup-first vs migrate-with-cleanup-integrated, (d) strangler fig as the right pattern. Decision: commit to migration, staged by data category and risk. Pre-clean-Sheets-first rejected as a separate step because cleanup is intrinsic to migration.

  **What this changes:** Phase B observability instrumentation officially CANCELLED — the R12 problem dissolves post-migration; not worth instrumenting a backend that's leaving. Task #2 (OAuth scope reduction) DEFERRED to post-migration. Phase 2 (TypeScript), most of Phase 3, Phase 5 (multi-tenancy) all deferred. Pre-Service Briefing Tool can still ship during migration if built against the abstraction layer.

  **Captured ground truth:** Sheet inventory doc (`docs/SHEET_INVENTORY_2026-05-14.md`) records which tabs are populated vs empty vs in-development. Future sessions should NOT re-download xlsx files to rediscover this.

  **DO NOT TOUCH list (confirmed with Kevin):** `incidents`, `preservice_logs`, `preservice_content`, `deep_clean_days`, `ops_newsfeed`, all `HUB__Performance_*` and `COLL__Cycle_Review_*` / `COLL__WOW_*` / `COLL__Scorecards` (KPI Dashboard parked). These read/write paths must remain untouched during audit and migration.

  **Next session opens with:** Stage 0 audit of `src/app/api/people/route.js` — the People Portal route. Bootstrap action is at line 638. Use the same pattern as dashboard cleanup: read what's computed, verify frontend usage, mark dead reads. Don't touch incident-related handlers.