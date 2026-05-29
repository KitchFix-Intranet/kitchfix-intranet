# Supabase Migration Plan - KitchFix Ops Hub

> **Status: Committed.** Decision made 2026-05-14.
> **Last updated:** 2026-05-14
> **Owner:** Kevin Fietek
> **Estimated duration:** 3-5 months calendar time, depending on weekly capacity.
> **Approach:** Strangler fig - staged migration by data category, not big-bang cutover.

> ## Operating mode update (2026-05-26)
>
> The pacing assumption in this doc ("3-5 months", capacity-not-speed) was superseded on 2026-05-26 by a fast-as-safe operating mode. The strategic plan here is still canonical for the "what"; the new mode governs the "how/when/pace."
>
> **Read `docs/MIGRATION_APPROACH.md` for the current operating mode.** Friday is a progress checkpoint.

---

## How to use this doc

**This is a living document.** It is the single source of truth for migration state. Read at the start of every session, update at the end of every session, commit to the repo as part of the work it describes.

**This doc supplements `docs/archive/migration/MIGRATION.md` (archived 2026-05-29; was the original Phase 1-5 plan).** That original plan described phases 0-5 of broader architectural work. Phase 4 (Database Migration) is now pulled forward and reshaped into this dedicated plan. The other phases either continue, defer, or are absorbed into this migration. See "Impact on the original migration plan" below.

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
- An all-or-nothing migration - some operator-edited config may stay on Sheets
- A specific auth strategy (NextAuth vs Supabase Auth is an open question - see below)
- Specific Postgres features (Row Level Security, Edge Functions, Realtime, Storage - to be evaluated stage by stage)

---

## The Approach: Strangler Fig

The migration is **staged by data category and risk**, not all-at-once. Each stage:
- Ships when complete (no half-migrated states left in production)
- Can be paused between stages if other priorities emerge
- Lower-risk stages teach Supabase patterns before higher-risk stages
- Each stage delivers user-visible improvement (faster pages, fewer rate limit incidents)

**Rejected alternatives:**

- **Big-bang cutover.** Stop all feature work, rewrite everything, deploy in one weekend. Too risky for a solo dev; one unforeseen issue blocks production for everyone.
- **Hybrid permanent state.** Keep both backends forever. Hybrid is the worst of both worlds - twice the integration code, twice the things that break, ongoing cognitive overhead. Most teams that try hybrid regret it within 12 months. We commit to a single destination.
- **Pre-clean Sheets first as a separate step.** Cleaning is intrinsic to the migration. Doing it twice (once in Sheets, then again mapping to Postgres) is wasted effort. The audit and the schema design happen together.

---

## The Stages

### Stage 0 - Audit + Abstraction Layer (current stage)

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

#### Audit findings - accumulated as audits complete

**2026-05-17:** Created `docs/BUSINESS_NOTES.md` as a living reference for niche business knowledge embedded in the codebase. The `/api/ops` dispatcher audit (PR #41) surfaced the first entry: MLB/MiLB/AAA P3 Auto-Inclusion rule. Future audits in the Ops Hub sequence (and beyond) should append rules to BUSINESS_NOTES.md as they surface them. This is higher leverage than embedding rules in this migration doc because the rules outlive the migration. BUSINESS_NOTES.md remains useful in 2027 when migration is done; this migration doc loses relevance once Phase 3 ships.

---

**Dashboard route** (`/api/dashboard`) - completed 2026-05-14
- 3 dead Sheets reads removed (kudos_log, wastenot_log, login_logs)
- 1 dead Sheets write removed (login_logs visit logging)
- 3 dead metric computations removed (kudos, waste, MOD)
- 1 dead helper function removed (calculateLoginStreak)
- ~200 lines deleted from route.js
- Dashboard load time: ~2.3s → ~860ms (3x faster)
- Shipped: PR #23

**People Portal GET handlers** (`/api/people`, GET) - completed 2026-05-14
- 7 of 8 actions audited (`incident-list` skipped per DO NOT TOUCH)
- All 7 audited: CLEAN
- Note: `bootstrap.counts.completedTotal` computed but unused (server-side dead computation, not a Sheets read - left in place, will be cleaned by abstraction layer redesign)
- Note: People Portal route serves both `/people` page AND global TopNav (notifications endpoint cross-cutting)

**People Portal POST handlers** (`/api/people`, POST) - completed 2026-05-14
- 10 of 14 actions audited (4 incident-related skipped)
- 9 of 10 CLEAN; 1 deleted
- Deleted: `submit-help` action + `HelpModal.js` component (~104 lines total) - replaced by global HelpFAB, never cleaned up
- Bug fixed: duplicate `await logNotification` in `submit-help-global` (was logging every help request twice)
- Shipped: PR #27

**Broken People reports** (`/api/people?action=generate-report` + `src/lib/peopleReport.js`) - completed 2026-05-14
- 1 broken feature deleted entirely (~621 lines)
- Was generating broken weekly/monthly emails via Vercel cron, ignored by recipient (filtered to junk folder)
- 2 cron entries removed from `vercel.json`
- Bug root causes (em-dash encoding, period date math) confirmed but not fixed - feature deleted instead per disciplined "don't fix broken stuff we're about to migrate" call
- Shipped: PR #26

**Directory route** (`/api/directory`) - completed 2026-05-14
- 9 of 9 actions audited
- All 9 CLEAN - zero dead code
- BUT: 4 architectural concerns surfaced (documented below)
- NOT shipped: discipline call to document concerns instead of building Sheets-specific workarounds for code we're about to rewrite in Postgres

**Cron daily** (`/api/cron/daily`) - completed 2026-05-14
- 4 of 5 categories CLEAN, 1 dead block
- Dead: news notifications block reading from non-existent `home_news` tab - never fired since deployment
- Active categories preserved: inventory countdowns (3d/2d/1d/today), inventory past-due, birthdays, anniversaries
- Removed 1 of 5 daily reads, ~17 lines deleted
- Shipped: PR pending (#28)

**Cron backup-sheets** (`/api/cron/backup-sheets`) - completed 2026-05-15
- File is 139 lines. Single-responsibility cron: 5x `drive.files.copy`, Slack summary, JSON response. Shipped 2 days prior (PR #14, 2026-05-13).
- Route is CLEAN - no dead code, no broken paths.
- Fixed (this PR):
  - **A1:** Header comment claimed schedule "2am UTC (9pm CT)"; actual schedule is `0 6 * * *` (06:00 UTC / 01:00 CT). Comment now matches `vercel.json` and `RUNBOOK.md:67`.
  - **A2:** `BACKUP_FOLDER_ID` env var (load-bearing - cron returns 500 without it) was undocumented in `docs/ENV_VARS.md`. Added to Drive folders table.
  - **B1 (Z):** `SHEET_IDS.GAME` constant lacked context. Added inline comment in `src/lib/sheets.js`: paused gamification pilot from the AppScript era, not in active use, intentionally excluded from the backup-sheets cron, may be revived later. Future audits won't re-raise the question.
  - **C2:** New GOTCHA captured in `docs/GOTCHAS.md` (Auth & Permissions section). The conditional `CRON_SECRET` auth check in this file (and similar patterns elsewhere) fails open if the env var is unset - production has it set so it's not exploitable today, but the fail-closed pattern is now documented for any new cron routes.
- Followups (captured, not fixed):
  - **B2:** This file's hand-rolled service-account auth (`getServiceAccountAuth()` at L37-46) is a second instance of the pattern already flagged in CLAUDE.md "Findings to know about #1" for `/api/people/route.js:80-151`. The Phase 1 hand-rolled-SA-auth cleanup target now covers both files; when consolidation to `getServiceAccountSheetsClient()` from `src/lib/sheets.js` happens, both get refactored together.
  - **Em-dash sweep:** `docs/RUNBOOK.md:67` contains "Ops Hub — Sheet Backups" with an em-dash. Out of scope for this PR. Worth a future standalone docs PR to sweep all docs for em-dashes, applying the established no-em-dashes preference.
- **Verdict:** Route is genuinely clean. 2 small drift items fixed (A1, A2), 1 deprecated-constant clarified inline (B1), 1 GOTCHA captured (C2), 2 captures for follow-up (B2, em-dash sweep).
- Shipped: PR #35 (this PR)

**SousAI feature deletion** (`/api/ops` - sous-portfolio + sous-analyze actions) - completed 2026-05-17
- Discovered during Stage 0 dependency map for the upcoming `/api/ops` audit. SousAI was an early experiment building an AI analysis bot into the Ops Hub (sous-portfolio for executive portfolio briefs, sous-analyze for per-period financial commentary). Not in active use; never progressed to general adoption.
- Deferring revival until the intranet is more built out and on Supabase. Future re-integration should build fresh against the Postgres data layer, not revive the Sheets-based prototype. Original implementation available in git history.
- Half-styled state (only one `.oh-sous-*` rule defined; rest of the classes had no rules and rendered with browser defaults) - consistent with this being an early experiment that didn't progress past the "drop in style hooks, fill in later" stage and never got completed.
- Pre-deletion main SHA: `a36fb9cd32f4dc2c83bc8a4729e6757d6552f480`. To recover the implementation: `git show a36fb9c:src/app/ops/components/labor/SousAI.js` (and similarly for the other 4 files).
- Deletion shape: ~365 lines across 5 files. 1 whole-file delete (`SousAI.js`, 113 lines), 4 surgical edits (`route.js` handlers 155 lines, `ExecutiveDashboard.js` 72 lines including orphan `useState`/`useEffect` import, `PeriodSnapshot.js` 17 lines, `ops-executive.css` 7 lines).
- No sheet data dependency. Both backend handlers were stateless: consumed pre-aggregated frontend data, called Anthropic via raw fetch, returned bullets. No Stage 1 schema implications.
- **Heads up for the next reviewer:** `ExecutiveDashboard.js` (host of these SousAI surgical edits) is part of the parked KPI Dashboard feature set per `docs/ARCHITECTURE.md:213` and `docs/SUPABASE_MIGRATION.md:534`. It has no production navigation entry point. Future KPI Dashboard cleanup PR (separately scoped, see backlog entry below) will likely delete `ExecutiveDashboard.js`, `PeriodSnapshot.js` (also same parked feature), `FinancialTool.js`, the `/financial` route, and 5 sibling `Exec*` files. SousAI's surgical edits here remain correct - they prevent shipping known-broken fetch calls into the parked feature - and will fold into the future deletion as no-op work.
- **Workaround note:** `ExecutiveDashboard.js` edits #3 (render block) and #4 (`runPortfolioAnalysis` function) required falling back from the Edit tool to bash awk because the file contains literal Unicode escape sequences (`↻`, `\u{1F52A}`, `⚠️`, etc.) that the Edit tool's parameter handling normalizes into rendered glyphs, breaking the content-match. Line-inspection pre-deletion (`sed -n` with line numbers) verified boundaries before each awk ran. This is a harness encoding quirk, not a code or workflow issue. Future-Kevin/future-Claude: if you hit string-not-found in the Edit tool on a file with `\uXXXX` source literals, fall back to awk-by-line-number with explicit boundary verification.
- Shipped: PR #40 (this PR)

**People leadership-dugout** (`/api/people/leadership-dugout`) - deferred 2026-05-15
- Status: very early/raw product, not stable enough for a meaningful Stage 0 audit.
- Will audit after the route reaches stable v1 status. Auditing in-progress work creates friction with the in-progress work.
- Not blocking Stage 0 completion; will be folded into Phase 3 migration prep when the feature stabilizes.

**Ops Hub dispatcher** (`/api/ops` - bootstrap, help-request, file-level structure) - completed 2026-05-17
- First of 6 planned audits covering the Ops Hub. This audit covers the dispatcher itself: GET/POST handler structure, auth pattern, shared imports, file-level helpers, the `bootstrap` action (main page load), and the `help-request` action. Subsequent audits (Inventory submission, Season Tracker, Invoice Capture, Vendor Portal, Smart Inventory) each cover their own action groups.
- Dispatcher is genuinely CLEAN. Auth pattern matches GET/POST. All imports used. File-level helpers (parseNum, opsNotify, sendOpsEmail, OPS_LEADERSHIP_EMAILS, date helpers) have real callers - none orphan.
- The hand-rolled SA auth pattern flagged in `CLAUDE.md` "Findings to know about #1" (people/route.js:80-151) and found in a second instance in PR #35 (cron/backup-sheets) is NOT present in this file. `/api/ops/route.js` uses the canonical `readSheetSA`/`appendRowSA`/`appendRow` helpers from `src/lib/sheets.js`. No SA-auth concern.
  - **Corrective addendum (2026-05-17, PR #43):** This line is technically correct (no hand-rolled JWT) but missed a subtler user-OAuth-write issue surfaced during Audit #2: a local `opsNotify(token, payload)` in `route.js:42` was wrapping `appendRow` (user OAuth) and shadowing the canonical `opsNotify(payload)` exported from `@/lib/opsUtils` (service account). PR #43 deletes the local version and consolidates all 5 call sites to the canonical lib version. Going forward this file uses service-account writes for all sheet operations.

- **Drift fix (inline with this PR):** Removed the dead `help-request` action handler from route.js (L1163-1173) and the orphan `src/app/ops/components/OpsHelpModal.js` (35 lines, whole-file delete). The handler called `notify(token, {...})` - a function that doesn't exist anywhere in the codebase. The action would have thrown `ReferenceError` if invoked, but `OpsHelpModal.js` (the only frontend caller) was orphan, so the bug was latent rather than live.

  **Product history:** Early in the intranet build, per-module help modals existed (`HelpModal` for People Portal, `OpsHelpModal` for Ops Hub). Later, the global `HelpFAB` system (`submit-help-global` action in `/api/people`) superseded per-module help. PR #27 deleted the People Portal version of the dead help-request system. This audit deletes the Ops Hub version that was missed in that cleanup. Same superseded-by-HelpFAB story, second instance found.

  **If per-module help is ever needed again,** build it fresh against whatever data layer is current (Postgres by Phase 3), not by reviving the Sheets-based dead code.

  **Pattern check before deletion:** confirmed zero third instances. Grep across `src/app/api/` for `submit-help|help-request|HelpModal` (excluding the live `submit-help-global`) returns only the in-scope hit. No further dead help systems hiding in other routes.

- **`bootstrap` action audit** (L685-776, main Ops Hub page load):
  - Reads 5 sheets in parallel via `Promise.all`: HUB.accounts, HUB.period_data, HUB.hero_images, COLLECTION.inventory_submissions, HUB.labor_budgets. All confirmed populated against `docs/SHEET_INVENTORY_2026-05-14.md`. No stale references.
  - Computes `activePeriodMap` from labor_budgets (which (account, period) combos have non-zero budget data).
  - Returns aggregated payload: accounts list, period date ranges, currentPeriod, heroImage, recent inventoryLog, isAdmin flag (via OPS_LEADERSHIP_EMAILS).
  - CLEAN. No dead reads, no broken paths, no architectural concerns.

#### Data shape for Stage 1 migration design (Ops Hub dispatcher scope)

Sheets/tabs read by the dispatcher (bootstrap action) and their column usage:

| Sheet/Tab | Columns used | Inferred types | Notes |
|---|---|---|---|
| `HUB.accounts` | col 0 (key), col 1 (name), col 2 (level) | strings; level is enum-like (MLB/MILB/AAA/PDC) | Other columns may be used by out-of-scope actions; capture during their audits |
| `HUB.period_data` | col 0 (name), col 1 (start), col 2 (end), col 3 (due) | name is string code (P1-P13); dates are strings parsed via `new Date()` | ~13 rows, small reference data |
| `HUB.hero_images` | all columns flattened via `row.flat()` | string URLs | Schema-loose; filter is "value contains 'http'" |
| `COLLECTION.inventory_submissions` | col 2 (email), col 3 (account), col 4 (period), col 5 (date), col 6-11 (numbers food/packaging/supplies/snacks/beverages/total), col 12 (notes) | currency strings parsed via `parseNum` | Transactional table |
| `HUB.labor_budgets` | col 0 (key), col 1 (period), col 2 (hourly), col 3 (salary), col 4 (revenue), col 5 (food), col 6 (pack) | numbers (raw, no currency formatting) | Drives the `activePeriodMap` computation |

**Joins / cross-references:**
- `accounts × labor_budgets` joined by account `key` to compute `activePeriodMap`. In Postgres this is an FK relationship: `labor_budgets.account_key REFERENCES accounts.key`.

**Domain rules surfaced by this audit:** see `docs/BUSINESS_NOTES.md` (specifically the "Account-level rules" section). The MLB/MiLB/AAA P3 Auto-Inclusion rule must be preserved through Stage 1 schema design. Implementation options and verification approach documented in BUSINESS_NOTES.md.

**Postgres design hints (dispatcher scope):**
- `accounts` table - small reference data (~20 rows). PK on `key` (string code). Columns: `name`, `level` (enum).
- `periods` table - tiny reference (~13 rows). PK on `name` (P1-P13). Columns: `start_date`, `end_date`, `due_date` as proper DATE type. Eliminates the string parsing in `toDate`.
- `labor_budgets` table - composite PK on `(account_key, period_name)`. FK to both `accounts` and `periods`. Budget columns as NUMERIC.
- `inventory_submissions` table - transactional with FK to `accounts` and `periods`. Currency columns as NUMERIC (eliminates `parseNum`). Timestamps as TIMESTAMP type.
- `hero_images` table - very small, very loose schema. Could be JSON config in a settings table rather than its own table.
- The `activePeriodMap` computation could be a database VIEW joining `accounts × labor_budgets` and applying the MLB/MiLB/AAA P3 rule.

**Currency parsing (`parseNum`) becomes unnecessary in Postgres** - NUMERIC columns return numbers directly. The 10 `parseNum()` calls in this file disappear with the migration.

**Date parsing (`toDate`) becomes unnecessary for dispatcher reads** - Postgres DATE/TIMESTAMP types return proper Date objects.

**Verdict:** Dispatcher is genuinely clean. 1 latent bug found and fixed (dead help-request + orphan OpsHelpModal, second instance of the dead-help-system pattern previously seen in PR #27). 5 in-scope sheet tabs cross-checked against SHEET_INVENTORY (all live, no stale references). One business rule explicitly captured in `docs/BUSINESS_NOTES.md` (P3 auto-include).

- Shipped: PR #41 (this PR)

**Ops Hub inventory submission flow** (`/api/ops` - submit-inventory, inventory-history) - completed 2026-05-17
- Second of 6 planned audits covering the Ops Hub. Covers the two actions servicing `InventoryTool.js`: the `submit-inventory` POST handler (writes rows to `COLLECTION.inventory_submissions`, triggers AP fanout) and the `inventory-history` GET handler (reads recent rows for the History tab).
- Both actions function. No new dead code. Several P1 cleanups around correctness (client-trusted total, UTC date stamping, no idempotency) and UX (cross-account history slice). One architectural finding crosses into Audit #1 territory - documented separately below and broken out into its own focused PR (see "opsNotify duplicate" entry).

- **Drift fixes (inline with this PR):**
  - Removed `.filter(() => true)` no-op in inventory-history (dead code, 1 line).
  - Added section header dividers for inventory actions in both GET and POST handlers, matching the Invoice/Vendor section header convention (parity item; no functional change).
  - Fixed indentation drift across both handlers (cosmetic; ~10 lines).

- **submit-inventory action audit** (called from `InventoryTool.js` handleSubmit):
  - **C1 (P1) Client-trusted `total`.** Server destructured `total` from request body and wrote it as-is. A client bug or tampered request could store a `total` that does not match `food + packaging + supplies + snacks + beverages`. Fixed: server now recomputes `total` from the component values; the body field is ignored.
  - **C2 (P1) No idempotency on double-tap.** Floor-first concern. A chef double-tapping the Submit button on lounge wifi could write two rows with different server-generated UUIDs. Fixed: client now generates UUID at Review-button time and passes it in body; server reads `inventory_submissions` col A before append and returns the existing result if UUID is already present.
  - **C3 (P1) UTC date stamping.** `now.toISOString().split("T")[0]` stamped the date column with UTC date. A 9pm Central submission on Friday wrote a Saturday date. Fixed: client now sends `localDate` (YYYY-MM-DD from `new Date()` in browser local time) in body; server uses it directly.
  - **C4 (P3) Return shape leak.** Handler returned the raw `appendRowSA` result (`{success, updatedRange}` or `{success, error}`) which leaked internal range info. Fixed: normalized to `{success: true, uuid}` on success.
  - **C5 (P3) Server-side validation gap.** Client validation requires `food OR packaging OR supplies > 0`. Server had no equivalent check, so a direct POST to `/api/ops` could write an all-zeros row. Fixed: server mirrors the client rule and returns 400 on violation. Captured in `BUSINESS_NOTES.md` for migration as a CHECK constraint.

- **inventory-history action audit** (called from `InventoryTool.js` loadHistory):
  - **H1 (P1) Cross-account history bleed.** Server returned the last 25 rows across ALL accounts. Client filtered to the selected location *client-side*, so during heavy submission periods the cross-account top-25 could contain zero rows for the requesting user's site and the History tab would show empty even after a successful submission moments before. Also a privilege-boundary concern: the cross-account dollar figures were visible in raw network responses to any authenticated user via DevTools. Fixed: server now accepts an `account` query param, filters rows to that account before the 25-row slice, and the client passes its selected location.
  - **H2 (P2) `.reverse().slice(0, 25)` reverses entire array before slicing.** Scales linearly with sheet size. Fixed: `.slice(-25).reverse()`.
  - **H3 (P2) Array-index `id`.** Used `id: i` (the post-filter array index) as the row identifier. Fragile to any reordering. Fixed: use col-0 UUID, fall back to index only if UUID is missing.
  - **H4 (P3) Orphan columns on read.** `email` (col 2) and `timestamp` (col 1) are written by submit-inventory but never returned by inventory-history. `bootstrap.inventoryLog` returns `email` but not `timestamp`. Documented in the data-shape table below as a Stage 1 design item, not fixed in this PR.

- **Cross-handler observation - partial redundancy with `bootstrap`.** Bootstrap (Audit #1 scope) returns the full unfiltered inventoryLog at `/api/ops?action=bootstrap`. inventory-history returns the last 25 rows for a single account. The two reads overlap but serve different views: bootstrap powers period-status calculations across the whole hub; inventory-history powers the History tab in InventoryTool. Not deduplicated in this PR. Stage 1 schema design should consolidate to a single parameterized query.

- **Architectural finding (broken out to a separate PR):** Audit #1 stated "no SA-auth concern in this file" because no JWT is hand-rolled. That is correct but missed a subtler issue: `route.js:42` defines a local `opsNotify(token, payload)` that writes via `appendRow` (user OAuth), while `src/lib/opsUtils.js:96` exports a canonical `opsNotify(payload)` that writes via `appendRowSA` (service account). The local version has 5 call sites in route.js. This is the same shape as Directory audit Concern 1: user OAuth used for a write that does not need it. Folding the dedup into Audit #2 would expand scope into labor-actuals (Audit #3 territory) and 3 other handlers. Pulled out into its own follow-up PR so Audit #2 stays surgical and Audit #3 can review labor-actuals with the canonical opsNotify in place. Tracked as a 2026-05-17 captain's log entry below.

#### Data shape for Stage 1 migration design (inventory submission scope)

`COLLECTION.inventory_submissions` - 13 columns:

| Col | Field | Type today | Notes |
|---|---|---|---|
| 0 | uuid | string (UUID v4) | Written by submit-inventory. Read by submit-inventory (dedup check) post-Audit #2 and by inventory-history (row id) post-Audit #2. **PK candidate in Postgres.** |
| 1 | timestamp | ISO string | Written but never returned. Audit-trail column. **TIMESTAMPTZ in Postgres.** |
| 2 | email | string | Returned only by `bootstrap.inventoryLog`. Not returned by inventory-history. **FK to users table; symmetrize across reads in Stage 1.** |
| 3 | account | string code | FK to `accounts.key`. |
| 4 | period | string code (P1-P13) | FK to `periods.name`. |
| 5 | date | string (YYYY-MM-DD) | Currently client-supplied local date post-Audit #2. **DATE in Postgres.** |
| 6-10 | food, packaging, supplies, snacks, beverages | currency strings on read, numbers on write | `parseNum` parsed on read. **NUMERIC in Postgres - parseNum gone.** |
| 11 | total | currency string on read, number on write | Currently server-recomputed at write post-Audit #2. **GENERATED column in Postgres - eliminates client-trust bug structurally.** |
| 12 | notes | string | Free-text. **TEXT in Postgres.** |

**Postgres design hints:**
- `inventory_submissions` table: PK on `uuid`. FKs to `accounts(key)`, `periods(name)`. Numeric cols. `total` as generated column.
- CHECK constraint: `food > 0 OR packaging > 0 OR supplies > 0` enforces the validation rule (see BUSINESS_NOTES `## Calculation methodology / Inventory submission validation rule`).
- Account-level row-level security (Postgres RLS) replaces the server-side account filter from H1. Stage 1 should consider RLS policies keyed on `accounts.key` so the application layer no longer carries authorization logic for cross-account reads.
- `inventory-history` query becomes `SELECT ... FROM inventory_submissions WHERE account = $1 ORDER BY timestamp DESC LIMIT 25` - the `.slice(-25).reverse()` problem disappears.
- Consolidate `bootstrap.inventoryLog` and `inventory-history` to a single parameterized query in Stage 1 (cross-handler observation above).

**Verdict:** Both actions function and now correctly handle the four floor-first risks (client-trusted total, UTC dates, double-tap, cross-account bleed). One architectural pattern (`opsNotify` duplicate) surfaced and broken out to a focused follow-up PR. Two BUSINESS_NOTES entries added (AP fanout, validation rule).

- Shipped: PR #42 (this PR)

**Ops Hub Season Tracker** (`/api/ops` - labor-bootstrap, submit-labor-actuals, submit-sold-revenue, add-deep-clean) - completed 2026-05-17
- Third of 6 planned audits covering the Ops Hub. Covers the four actions servicing the Season Tracker module: labor-bootstrap (read path that powers both chef and admin views, including the buildLaborContext and buildPDCContext helpers), submit-labor-actuals (the primary chef submission action), submit-sold-revenue (TXR-V revenue entry), and add-deep-clean (operator-added deep-clean day scheduling).
- All four actions function. Cumulative variance math is sound. Three real bug fixes shipped (streak ordering, idempotency, user-OAuth writes). Three BUSINESS_NOTES entries captured for migration preservation (TXR-V math, append-only pattern, streak methodology).

- **Drift fixes (inline with this PR):**
  - Added section header dividers: `// ── Labor Actions (GET) ──` for labor-bootstrap and `// ── Labor Actions (POST) ──` for the three submit handlers (parity with Audit #2's Inventory header pattern).
  - Hoisted `safeRead` to a file-level helper, eliminating the local duplicate in submit-labor-actuals (third duplicate of the same helper - prior duplicates in GET handler and submit-labor-actuals, flagged in Audit #2 as not fixed).
  - Indentation drift normalized across submit-labor-actuals handler.

- **submit-labor-actuals action audit:**
  - **C1 (P1) Streak calculation iterated in submission order, not homestand order.** `Object.values(latestByHS)` preserved insertion order, which was sheet row order = chronological submission order. A chef who submitted HS3 before HS1 got a different streak than one who submitted in order, even with identical variances. Fixed: sort `acctPlans` by homestand sequence (extracted from `homestandId` string) before the streak loop.
  - **C2 (P1) No idempotency on double-tap.** Floor-first concern. Same pattern as Audit #2 inventory. Fixed: client generates submission UUID at Submit-button time, server reads `labor_plans` col 0 before append, returns existing result if UUID is already present.
  - **C3 (P1) User-OAuth write.** `appendRow(token, ...)` for `labor_plans` required user to have edit permission on COLLECTION sheet. Same Directory audit Concern 1 pattern as the opsNotify duplicate (PR #43). Fixed: swap to `appendRowSA`.

- **submit-sold-revenue action audit:**
  - **C4 (P1) User-OAuth write.** Same pattern as C3, for `labor_sold_revenue`. Fixed: `appendRowSA`.

- **add-deep-clean action audit:**
  - **C5 (P1) User-OAuth write.** Same pattern, for `deep_clean_days`. Fixed: `appendRowSA`.

- **labor-bootstrap action audit (including buildLaborContext + buildPDCContext helpers):**
  - Read path is clean. TXR-V derived-ratio math at L350-355 is correct (captured in BUSINESS_NOTES for migration). The `.pop()` latest-wins pattern at L335 works correctly (captured in BUSINESS_NOTES).
  - No fixes in this PR. Read-path improvements (cross-account efficiency, helper consolidation) are Stage 1 schema design targets.

- **Findings documented but not fixed in this PR (deferred to Stage 1 or later PRs):**
  - Client-trusted `budgetEnvelope`, `carryForward`, `actualSpent` in submit-labor-actuals. Works today because client gets budget from server; would corrupt on any future client-side display bug. Server should recompute from `HUB.labor_budgets` (post-Postgres, this is a JOIN, not an extra read).
  - TXR-V combo submission has no atomicity: `handleSubmitFlex` in `SeasonPlanner.js:280-294` posts revenue then labor in sequence with no rollback. Documented as Stage 1 transaction target.
  - `submit-sold-revenue` lacks UUID col 0 (other tables have it). Schema inconsistency, Stage 1 cleanup target.
  - `submit-sold-revenue` has no server-side validation that the account is in REVENUE_FLEX_ACCOUNTS. Could submit revenue for a fixed-budget account silently. Stage 1 CHECK constraint target.
  - `add-deep-clean` has no UUID col 0 and no delete counterpart. Immutable schedule by default. Stage 1 schema decision: soft-delete or accept immutability.
  - Dead schema columns in `labor_plans`: `actualFood` and `actualPackaging` are written as 0. Comment in code admits "not tracked in planner". Stage 1 drop target.
  - `carryForward` parameter flows client → server → sheet but is always 0 from frontend. Either remove (Stage 1) or repurpose for a future feature.
  - Notes silently truncated to 300 chars in submit-labor-actuals. Mild floor-first issue; consider explicit reject post-migration.
  - `FinancialTool.js` (parked KPI Dashboard, backlog item #11) has 4 calls to labor-bootstrap. Those calls become dead when KPI Dashboard is deleted. Not in audit scope.

#### Data shape for Stage 1 migration design (Season Tracker scope)

Three tables in scope:

**`COLLECTION.labor_plans`** - 15 columns:

| Col | Field | Type today | Notes |
|---|---|---|---|
| 0 | uuid | string (UUID v4) | Written by submit-labor-actuals. **PK candidate in Postgres.** |
| 1 | timestamp | ISO string | Written. **TIMESTAMPTZ in Postgres.** |
| 2 | email | string | **FK to users table.** |
| 3 | account | string code | **FK to `accounts.key`.** |
| 4 | homestandId | string code (e.g. HS1, HS2, ...) | **FK to `homestands.id`.** |
| 5 | budgetEnvelope | currency string on read, integer on write | Currently client-supplied (deferred concern). **NUMERIC; Stage 1 should derive from labor_budgets join.** |
| 6 | carryForward | integer on write | Always 0 today. **Drop or repurpose in Stage 1.** |
| 7 | actualLaborSpent | integer on write | The single chef-controlled value. **NUMERIC.** |
| 8 | variance | integer on write | Currently client-supplied. **Generated column in Postgres: `(budgetEnvelope - actualLaborSpent)`.** |
| 9 | cumulativeVariance | integer on write | Currently server-computed at write time. **Window function in Postgres - eliminates the stored column.** |
| 10 | streak | integer on write | Currently server-computed at write time. **Window function or trigger-maintained.** |
| 11 | notes | string (max 300 chars enforced via slice) | **TEXT, with CHECK constraint or trigger for max length.** |
| 12 | revenueActual | integer on write | TXR-V only; 0 otherwise. **NUMERIC NULL.** |
| 13 | actualFood | always 0 | Dead. **Drop column.** |
| 14 | actualPackaging | always 0 | Dead. **Drop column.** |

**`COLLECTION.labor_sold_revenue`** - 5 columns today:

| Col | Field | Notes |
|---|---|---|
| 0 | account | **FK to accounts.key.** |
| 1 | homestandId | **FK to homestands.id.** |
| 2 | soldRevenue | integer. **NUMERIC.** |
| 3 | email | **FK to users.** |
| 4 | timestamp | **TIMESTAMPTZ.** |

**Stage 1 changes:** Add UUID PK col 0. CHECK constraint: only insertable for accounts where `is_revenue_flex = true`.

**`COLLECTION.deep_clean_days`** - 4 columns today:

| Col | Field | Notes |
|---|---|---|
| 0 | account | **FK to accounts.key.** |
| 1 | date | string YYYY-MM-DD. **DATE.** |
| 2 | email | **FK to users.** |
| 3 | timestamp | **TIMESTAMPTZ.** |

**Stage 1 changes:** Add UUID PK col 0. Consider soft-delete `deleted_at` column for D6 (no current delete path).

**Postgres design hints:**
- The `latestByHS` dedup pattern from submit-labor-actuals becomes `DISTINCT ON (account, homestand_id) ORDER BY timestamp DESC`.
- The TXR-V adjusted budget math becomes a computed view or column joining labor_budgets × labor_sold_revenue × accounts.is_revenue_flex.
- The streak and cumulativeVariance values currently stored in labor_plans can be derived from window functions on read; storing them is a Sheets-era artifact.

**Verdict:** All four actions function. Three real bug fixes shipped. Three BUSINESS_NOTES entries capture migration-critical business rules (especially TXR-V which would be lost without explicit documentation). Eight findings documented but not fixed (deferred to Stage 1 or future PRs) to keep audit scope surgical.

- Shipped: PR #44 (this PR)

**Ops Hub Invoice Capture + Vendor Portal** (`/api/ops` - 17 handlers in `src/lib/invoiceActions.js`) - completed 2026-05-18
- Bundled fourth + fifth of 6 planned Ops Hub audits. Bundle viability confirmed during 2026-05-17 recon: 10 invoice-* actions + 7 vendor-* actions share a single 1,962-line helper file. Largest audit by surface and depth in the run - 3-phase scoping (handleInvoiceGet, vendor block, handleInvoicePost), 19 findings F15-F33 from Phase 3 alone, ~3,200 lines of audit material consumed.
- Audit posture: ASK before flagging cross-account visibility as bug (KitchFix data-visibility-is-intentional, Phase 1 lesson). Don't reflexively flag AI prompts / console logging as noise (production observability). Apply floor-first lens hardest on invoice-submit. Use Q? severity liberally for business-context-dependent findings.

- **Drift fixes (inline with this PR):**
  - `safeRead` hoisted from `invoiceActions.js` to `src/lib/sheets.js` (shared with `route.js` post Audit #3).
  - 5 new SA helpers added to `sheets.js`: `safeRead`, `updateCellSA`, `deleteRowSA`, `findRowByValueSA`, `getSheetIdSA`. All client-supplied UUID-safe; all reusable across future Ops Hub audits.
  - `OPS_LEADERSHIP_EMAILS` extracted to `src/lib/admin.js` (single source of truth). Inline duplicate in `route.js:30-38` deleted.
  - Dead `VENDOR_ADMIN_EMAILS` constant deleted from `invoiceActions.js:1540-1548` (identical content to `OPS_LEADERSHIP_EMAILS`, zero callers across `src/` - drift bomb defused).
  - Orphan `updateVendorLastInvoiceDate` function deleted (zero callers anywhere).
  - Section comments renumbered in invoice-submit after F24/F25 reorder.
  - Latent `Math.floor(masterUpdates.length / 4)` reporting bug fixed organically during `handleVendorMerge` refactor to `batchUpdateRangesSA`.
  - `s.lynch@kitchfix.com` removed from `OPS_LEADERSHIP_EMAILS` (per user decision; s.lynch retains Invoice Admin + Labor Admin UI per intentional role separation - see TEAM_KNOWLEDGE.md "Three admin role scopes" entry).

- **handleInvoiceGet audit (Phase 1):**
  - **F4 + F5:** User-OAuth reads + duplicate local `safeRead` closure - fully service account via hoisted helpers. Affects invoice-bootstrap, vendor-search, invoice-history, invoice-admin-list paths.
  - **F7:** Slice-then-reverse perf consistency at 2 sites (invoice-bootstrap recentSubmissions, invoice-history). Same pattern as Audit #2 H2.

- **Vendor block audit (Phase 2):**
  - **F8:** Orphan `updateVendorLastInvoiceDate` helper deleted.
  - **F9:** All 7 vendor handlers + 2 internal helpers (`setVendorActive`, `learnVendorAlias`) swapped to service account (~30 call sites). Selective preservation: `handleVendorMerge` Slack notifications stay as-is (no token required).
  - **F13:** safeRead consistency - no local closures left in vendor block.
  - **F14:** Batching wins via `updateRangeSA` (handleVendorUpdate, cols D-R contiguous) + `batchUpdateRangesSA` (handleVendorMerge, dupe soft-deletes + account reassignments).
  - **F12 (sub-phase 4):** Vendor-deactivate admin gate stopgap using `OPS_LEADERSHIP_EMAILS`. Chef-friendly error message: "Vendor deactivation requires admin approval. Contact Kevin to deactivate a vendor." Full chef-request approval workflow deferred to follow-up PR.

- **handleInvoicePost audit (Phase 3):**
  - **F15-F18, F20, F26 selective, F27:** Mechanical SA swaps across 10 actions + batching wins. F26 (invoice-submit) is the selective swap: sheet ops → SA, Drive uploads (`uploadStampedPDF`, `uploadInvoicePages`) STAY user-OAuth (chef identity in Drive audit trail), Gmail (`sendInvoiceEmail`, `sendRejectionEmail`) STAYS user-OAuth (email comes FROM chef/admin).
  - **F17 (sub-phase 5):** 33-line raw Sheets v4 fetch in invoice-delete-dupe collapsed to 8-line `findRowByValueSA` + `getSheetIdSA` + `deleteRowSA` call. No more raw fetch + bearer-token gymnastics anywhere in handleInvoicePost.
  - **F19a (sub-phase 6):** Vendor-ID collision retry loop. Pre-fetched existing vendor IDs from `vendor_master`. 5 attempts to find a non-colliding `${prefix}-NNN` candidate. Returns error if exhausted. Closes the statistical-certainty-at-scale gap from `Math.random() * 900` over a 3-letter prefix space.
  - **F19b (sub-phase 6):** Vendor-add client-UUID idempotency at two checkpoints - `vendor_master` col J (idx 9) and `vendor_accounts` col X (idx 23). Schema expansion at the END of each existing schema; no conflict. Catches both "new vendor" and "existing vendor + new account link" double-taps.
  - **F24 + F25 (sub-phase 6):** Invoice-submit client-UUID idempotency + REORDER so dedup check happens BEFORE Drive upload phase. F25 idempotency runs ALWAYS (catches correction double-tap). Existing field-based duplicate guard still suppressed for corrections (`!correctedFromUuid`). Combined into one sheet read serving both purposes. **Orphan PDFs from duplicate-blocked submissions are eliminated.**
  - Frontend payload changes (3 files): `InvoiceTool.js`, `VendorAddModal.js`, `VendorSetup.js`. Generate UUID once per submit-click, include in payload. Offline-queue path in `InvoiceTool.js` preserves UUID through localStorage queue → replay flow.

- **Findings documented but not fixed in this PR (deferred to Stage 1 or future PRs):**
  - **F21/F22/F29:** Fail-open AI integrations + partial-success-is-success patterns (intentional floor-first design - documented in BUSINESS_NOTES.md to prevent accidental "tightening" in future refactors).
  - **`triggerAIScan` and `updateScanStatus`** (out of audit scope - helpers, not action handlers) still use user-OAuth. Calls `appendRows(token, ...)` at L1466 and L1469. Small follow-up PR candidate.
  - **`ensureLineItemTab` has 3 raw Sheets v4 fetch calls** (same F17 pattern, lives outside handleInvoicePost at L122). Follow-up cleanup PR candidate using the new `getSheetIdSA` + helpers.
  - **3 frontend admin lists are intentionally distinct** (NOT a refactor target - role separation is design intent; see TEAM_KNOWLEDGE.md "Three admin role scopes").
  - **Pre-existing React component-during-render warnings** in `InvoiceTool.js:843`, `VendorSetup.js:281-291`, `VendorAddModal.js:37` (separate frontend lint cleanup PR; not introduced by this audit).
  - **F25 race window:** Read-then-write idempotency is sub-second-vulnerable in Sheets-era. Stage 1 Postgres UNIQUE constraint eliminates this. Documented in BUSINESS_NOTES.md "F25 race window" entry.
  - **Chef-request vendor deactivation approval workflow** (full F12 fix beyond stopgap) - separate follow-up PR.
  - **Invoice number storage format flag (potential data quality concern):** Kevin's review of the AI invoice line-item collection spreadsheet on 2026-05-18 surfaced that Cut+Dry invoice numbers appear in scientific notation (e.g. `9.06696945E8`) in the exported xlsx. This may be: (a) an xlsx export artifact (cell contains string, downloads as float), OR (b) actual cell value corruption (cell contains float, original string lost). Spot-check needed: open the Google Sheet (not xlsx export) and inspect one such cell. If the underlying cell is the float, Cut+Dry invoice references are being destroyed at storage write and the F32 [PRESERVE THROUGH MIGRATION] BUSINESS_NOTE just got more urgent - the OCR is doing the right thing per the prompt but the sheet write is losing data. Stage 1 schema must enforce `invoice_number` as TEXT (never numeric) regardless of cause.

#### Data shape for Stage 1 migration design (Invoice + Vendor scope)

Three tables in scope.

**`COLLECTION.invoice_submissions_26`** - 23 columns (col 0 is the F25 client_uuid):

| Col | Field | Type today | Notes |
|---|---|---|---|
| 0 | uuid / client_uuid | string (UUID v4) | F25 idempotency key. **PK candidate in Postgres. UNIQUE constraint eliminates race window.** |
| 1 | timestamp | ISO string | Written at submit. **TIMESTAMPTZ.** |
| 2 | email | string | submittedBy. **FK to users.** |
| 3 | account | string code | **FK to `accounts.key`.** |
| 4 | vendor | string | Display name. **FK to vendors via vendor_id.** |
| 5 | vendorId | string (PREFIX-NNN) | **FK to vendors.id.** |
| 6 | invoiceNumber | string | Normalized for dedup (see BUSINESS_NOTES). **TEXT + generated `invoice_number_normalized` column for the UNIQUE INDEX.** |
| 7 | invoiceDate | string YYYY-MM-DD | **DATE.** |
| 8 | totalAmount | number | **NUMERIC(12,2).** |
| 9 | glRows | JSON string | **JSONB.** |
| 10 | driveUrls | JSON string array | Stamped PDF Drive URLs. **TEXT[] or JSONB; consider replacing with storage refs post-migration.** |
| 11 | pageCount | integer | Page count of original photos. |
| 12 | aiScanComplete | "TRUE" / "FALSE" | Toggled when async AI scan finishes. **BOOLEAN.** |
| 13 | status | enum-like ("sent", "returned", "corrected", "deleted") | **CHECK constraint or Postgres enum.** |
| 14 | statusChangedAt | ISO string | **TIMESTAMPTZ.** |
| 15 | formType | string | "invoice" / "credit_memo" / etc. |
| 16 | rawDriveUrl | string | Raw (unstamped) archive PDF URL. **TEXT.** |
| 17-20 | rejection fields | reason, note, rejectedBy, rejectedAt | **Move to separate `invoice_rejections` table FK'd to submissions.** |
| 21 | correctedFromUuid | UUID string or empty | **FK to same table (`corrected_from_uuid REFERENCES invoice_submissions(uuid)`).** |
| 22 | dupeDismissed | "not_duplicate" or empty | Single-cell admin override. **Optional BOOLEAN with default false.** |

**Stage 1 changes for this table:**
- Add `CREATE UNIQUE INDEX ON invoice_submissions (vendor, invoice_number_normalized, invoice_date, total_amount) WHERE status != 'corrected' AND corrected_from_uuid IS NULL` (Invoice duplicate detection rule from BUSINESS_NOTES).
- `client_uuid` becomes UNIQUE constraint - eliminates F25 race window.
- Rejection fields normalize to their own table.

**`HUB.vendor_master`** - existing 9 cols + col J (idx 9) NEW for F19b:

| Col | Field | Type today | Notes |
|---|---|---|---|
| 0 | vendorId | string (PREFIX-NNN) | F19a retry-on-collision today. **Stage 1 should use `gen_random_uuid()` or serial PK.** |
| 1 | name | string | |
| 2 | category | string | |
| 3 | website | string | |
| 4 | notes | string | "DELETED" sentinel for soft-deletes (vendor merge). **Replace with `deleted_at TIMESTAMPTZ`.** |
| 5 | createdBy | email string | **FK to users.** |
| 6 | createdAt | ISO string | **TIMESTAMPTZ.** |
| 7 | lastInvoiceDate | unused | Dead column (was the orphan helper's target; helper deleted in this PR). **Drop in Stage 1.** |
| 8 | aliases | string (pipe-separated) | Migrate to `TEXT[]` or separate `vendor_aliases` table. |
| 9 | client_uuid (NEW Audit #4) | string (UUID v4) | F19b idempotency. **Stage 1: UNIQUE constraint.** |

**`HUB.vendor_accounts`** - existing 23 cols + col X (idx 23) NEW for F19b:

| Col | Field | Notes |
|---|---|---|
| 0 | rowId | `${vendorId}_${account-prefix}`. Functions as composite key. |
| 1 | vendorId | **FK to vendor_master.** |
| 2 | account | **FK to accounts.key.** |
| 3-17 | contact + delivery + portal fields | per Phase 2 recon. Portal credentials in cols J/K/L are intentionally plaintext (TEAM_KNOWLEDGE entry). |
| 18 | active | "TRUE" / "FALSE". **BOOLEAN.** |
| 19 | createdBy | email. **FK users.** |
| 20 | createdAt | ISO string. **TIMESTAMPTZ.** |
| 21 | (blank) | Dead per Phase 2 F11. **Drop in Stage 1.** |
| 22 | accountNotes | free text. |
| 23 | client_uuid (NEW Audit #4) | F19b idempotency. **Stage 1: UNIQUE constraint.** |

**Postgres design hints:**
- **F25/F19b idempotency:** `client_uuid` columns become UNIQUE constraints, eliminating the read-then-write race window. Application layer translates Postgres constraint-violation errors to `{success: true, deduplicated: true}` for graceful retry semantics.
- **F24 dedup-before-Drive-upload:** In Postgres, the dedup check becomes a SELECT before storage upload, but storage uploads can be triggered AFTER the row insert with the row's UUID for cleaner rollback semantics.
- **Vendor soft-delete:** Replace "DELETED" sentinel with `deleted_at TIMESTAMPTZ`. Queries default to `deleted_at IS NULL`.
- **Vendor alias auto-learning** becomes a trigger or service-layer hook on invoice_submissions INSERT.
- **GL codes** flatten to a single `gl_codes` table with `account_key` FK (was per-account tab structure - see BUSINESS_NOTES "GL_CODES per-account tab structure").

**Verdict:** Largest audit of the run by surface (3-phase, ~3,200 lines of audit material, 19 findings F15-F33 from Phase 3 alone). Three real bug fixes shipped (F24/F25 orphan-PDF race + invoice-submit idempotency, F19a vendor-ID collision, F19b vendor-add idempotency). Five new helpers added to `sheets.js` (foundation for Stage 1 ports). One stopgap admin gate (F12 vendor-deactivate) with follow-up PR scoped. Five BUSINESS_NOTES entries + nine TEAM_KNOWLEDGE entries capture migration-critical and team-facing knowledge that would otherwise have been lost. Three findings documented as intentional design (cross-account visibility, vendor portal credentials, three admin role scopes) to prevent future audit "fixes" of correct behavior.

- Shipped: PR #47 (this PR)

**Remaining Ops Hub audit queue:**
- Audit #6: Smart Inventory (`/api/ops/inventory` subroute, 117 lines)

**Audit #4+#5 follow-up backlog (post-PR-#47):**
- Chef-request vendor deactivation approval workflow (F12 full fix beyond stopgap) - 1-2 day effort, ~3-4 files touched, follow-up to PR #47.
- `triggerAIScan` + `updateScanStatus` user-OAuth swap (out of scope from Audit #4+#5 Phase 3) - small follow-up PR.
- `ensureLineItemTab` raw Sheets v4 fetch swap to `getSheetIdSA` + helpers (same F17 pattern, different location) - small follow-up PR.
- `InvoiceTool.js` / `VendorSetup.js` / `VendorAddModal.js` pre-existing React component-during-render warnings (lint cleanup PR) - separate frontend cleanup pass.

#### Directory route architectural concerns (Stage 1 schema design must address)

These are real concerns we chose to document rather than fix in Sheets. They become non-issues post-migration with Postgres features.

**Concern 1: User OAuth used for write operations** (affects 6 handlers: `admin-update-account`, `admin-add-account`, `admin-deactivate-account`, `admin-reactivate-account`, `admin-update-contacts`, `admin-update-heroes`)

The directory POST handlers use `getSheetsClient(token)` - user's OAuth token - to write to Sheets. Every other write path in the codebase uses the service account. This means every admin user must have edit permission on the HUB spreadsheet for these to work. **Migration consideration:** Stage 1 schema should design these as service-account writes from the start.

**Concern 2: Destructive write pattern in `admin-update-contacts`**

The handler does `delete N rows → append N rows` in sequence. If the function crashes (Vercel timeout, network failure) between delete and append, contact rows for that account are permanently lost. Recovery requires daily backup restore. **Migration consideration:** Postgres transaction wraps this trivially. Stage 1 schema design should account for atomic multi-row updates of relational data (account ↔ contacts is a foreign key relationship in Postgres).

**Concern 3: Destructive write pattern in `admin-update-heroes`**

Same shape as Concern 2. `clear column A → write new values`. If clear succeeds but update fails, all hero images are lost from production until next backup restore. **Migration consideration:** Same transaction-based fix.

**Concern 4: Multi-step writes in `admin-update-account` have no transactional safety**

The handler does 3 sequential writes: update accounts row → update work_locations row → update dir_links row. Partial failure leaves data in an inconsistent state across tabs. **Migration consideration:** Stage 1 schema should design account/work_location/links as relational tables with proper foreign keys. The 3-write sequence becomes one transaction in Postgres.

#### Cron architectural concerns

**Concern: `notification_log` full-scan dedup cost**

The daily cron reads all of `notification_log` (411 rows currently) every morning to check if a notification was already fired today. As `notification_log` grows (it currently grows ~5-15 rows per day), this scan gets linearly slower and consumes more Sheets quota. Will eventually hit R12 (rate limit) on its own. **Migration consideration:** Stage 1 schema design should index `notification_log` by `(date, event_type, dedup_key)` for instant dedup lookups instead of full scans. Or implement notifications with a different pattern entirely (Postgres triggers, event tables, etc.).

---

### Stage 1 - Supabase Setup + Schema Design

**Goal:** Supabase project provisioned. Postgres schema designed and deployed. No code touching it yet.

**Tasks:**

- [ ] Create Supabase project (production + staging)
- [ ] Decide auth strategy:
  - Option A: Keep NextAuth + Google OAuth, use Supabase only for data (simpler migration)
  - Option B: Migrate auth to Supabase Auth (more unified, more migration risk)
  - Recommendation pending until Stage 0 complete
- [ ] Design the Postgres schema based on the audit findings:
  - One table per current sheet "concept" (not 1:1 with tabs - clean as you go)
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

### Stage 2a - Migrate Read-Only HUB Tabs

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

### Stage 2a.5 - Migrate image hosting to Supabase Storage

**Why this stage exists:** Discovered during Stage 0 audit of `/api/directory`. The intranet currently hosts images on Google Drive, served through a server-side proxy (`/api/directory?action=drive-image`). This is using Drive as an accidental CDN - purpose-built tools (Supabase Storage) do this better, faster, with less code.

**What gets migrated:**
- Hero images (HUB `hero_images` tab - currently Drive URLs)
- Stadium header images (HUB `accounts` tab column H - currently Drive URLs)
- Team logos (HUB `accounts` tab column I - currently Drive URLs)
- Map/satellite images (HUB `accounts` tab column R - currently Drive URLs, accessed via `drive-image` proxy)
- Any other Drive-hosted image references across the codebase

**Why this is between 2a and 2b:**
- Depends on Supabase being set up (Stage 1)
- Touches HUB tables already migrated in Stage 2a - image URL columns change from Drive URLs to Supabase Storage URLs
- Resolves the user-OAuth Drive operation in `drive-image` (only one in codebase, was blocking Task #2)
- Better to do before Stage 2b so People Portal also benefits from the new image hosting

**Approach:**
1. Create Supabase Storage buckets:
   - `kf-heroes` (public) - hero images
   - `kf-accounts` (public) - stadium headers, team logos, map images
2. Write migration script: for each Drive URL in HUB tabs, download file, upload to Supabase Storage with structured naming (e.g., `accounts/STL-MO/logo.png`), update sheet column with new URL
3. Verify all images load via Supabase Storage URLs in dev
4. Deploy to production
5. Delete `drive-image` action handler from `/api/directory/route.js`
6. Update `TeamCard.js` to use direct image URLs (no proxy fetch needed)

**Estimated effort:** 2-3 sessions. ~1-2 weeks calendar time. Most time is migration script + validation, not code changes.

**Side effects:**
- Removes ~35 lines from `route.js` (drive-image action)
- Eliminates 2 Drive API calls per card flip (faster perceived load)
- Closes the last user-OAuth Drive operation in the codebase
- Sets up the pattern for invoice PDF storage migration later (Stage 2c)

---

### Stage 2b - Migrate People Portal Data

**Why second:** Mostly forms. Submissions/drafts/notifications/notification_log are write-heavy but contained - they don't sprawl into other features. Good practice for transactional migration before the harder Ops Hub work.

**Tabs in scope:**
- \`submissions\` (96 rows, active)
- \`drafts\` (17 rows, active)
- \`notification_log\` (411 rows, active)
- \`employee_roster\` (99 rows, read-only via Rippling sync - keep in mind)

**Approach:**
- Schema design accounts for the People Portal's specific JSON payload pattern (currently stored as JSON in a Sheet column - Postgres has native JSONB which is better)
- Dual-write during transition: write to both Sheets and Postgres
- Migrate reads to Postgres first
- Verify, then cut writes to Postgres-only
- Eventually: archive Sheets tab to cold storage

**Tabs explicitly NOT in this stage (in development, don't touch):**
- \`incidents\` (in development, do not touch)
- \`_archived_*\` tabs (verify if these are real archives or can be deleted)

**Estimated effort:** 4-6 sessions. ~2-3 weeks calendar time.

---

### Stage 2c - Migrate Ops Hub Data

**Why third:** Most complex, most volume, most risk. By this stage we've already done a HUB migration and a People migration - we know our patterns.

**Tabs in scope:**
- \`inventory_submissions\` (28 rows, active)
- \`invoice_submissions_26\` (386 rows, active - high volume)
- \`labor_plans\` (16 rows, active)
- \`labor_sold_revenue\` (8 rows, active)
- \`service_audit_log_26\` (8 rows, active)

**Approach:**
- Schema designed carefully for invoice OCR pipeline (currently stuffs JSON into sheet columns)
- Dual-write during transition
- Carefully sequence: read migration first, then writes
- Invoice upload pipeline gets attention - it's the highest-impact write path

**Tabs explicitly NOT in this stage (in development, don't touch):**
- \`deep_clean_days\` (in development)
- \`service_day_overrides_26\` (empty, likely related to in-dev work)

**Estimated effort:** 6-10 sessions. ~3-5 weeks calendar time.

---

### Stage 2d - Migrate Service Calendar Data

**Why last:** Service Calendar is a relatively new module. Smaller surface than Ops Hub but still transactional.

**Tabs in scope:**
- All \`service_*\` tabs and projections/actuals data
- Plus shared HUB tabs already covered in Stage 2a

**Estimated effort:** 3-4 sessions. ~2 weeks calendar time.

---

### Stage 3 - Decommission Sheets dependencies

**Goal:** Sheets retained only for what genuinely benefits from operator editing. Most reads/writes happen against Postgres.

**Likely Sheets retainees:**
- Configuration tabs that operators actively edit (vendor master, schedules, accounts) - if we don't build admin UIs
- Reporting exports for finance teams

**Likely Sheets deletions:**
- All transactional tabs (submissions, invoices, inventory, labor)
- All log tabs (notification_log, etc.)
- All empty/dead tabs (kudos_log, wastenot_log, etc. - already removed from reads in PR #23)

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

## Impact on the original migration plan (docs/archive/migration/MIGRATION.md)

Today's commitment reshapes the original Phase 1-5 plan:

### Phase 1 - Foundation (still active)

**Status: ~85% complete, finish what's started.**

| Task | Status | New consideration |
|---|---|---|
| #1 Tests | ✅ Closed (PR #11-13) | Keep - tests prevent migration regressions |
| #2 OAuth scope reduction | Open | **DEFER** until post-migration. Touches auth, unrelated to data layer. |
| #3-9 Various security/infra | ✅ Closed | Keep - independent of data layer |
| #10 Observability | ✅ Phase A closed (Sentry) | **Phase B observability instrumentation CANCELLED** - R12 goes away post-migration. Don't build for a backend that's leaving. |
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

### Phase 2 - TypeScript conversion

**Status: DEFERRED.**

Reasoning: Converting \`.js\` to \`.ts\` for code that's about to be partially rewritten is wasted effort. Wait until post-migration, when the codebase is stable.

Exception: any new files written during the migration should be TypeScript from day one if it doesn't slow us down. Don't backport, but don't add to the JS pile either.

### Phase 3 - Refactor + architecture cleanup

**Status: ABSORBED into Stage 0 of this migration.**

The data-access layer refactor *is* Phase 3 for the parts of the code that matter. The rest of Phase 3 (component cleanup, routing improvements, etc.) defers to post-migration.

### Phase 4 - Database migration

**Status: SUPERSEDED by this doc.**

This plan replaces Phase 4. It's pulled forward and scoped more concretely.

### Phase 5 - Multi-tenancy / SaaS

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
- Pre-Service Briefing Tool (specced, can be built - but build against the abstraction layer once it exists, so it survives migration)

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

These supplement the working agreements in `docs/archive/migration/MIGRATION.md`:

1. **The migration is the priority.** When in doubt, work on migration tasks, not feature requests.
2. **Don't add features to features being migrated.** When working on Ops Hub data migration, don't add new Ops Hub features. They get rewritten anyway.
3. **Schema decisions are durable.** Postgres schema changes after data is in production are harder than getting them right the first time. Don't rush stage 1.
4. **Test against staging Supabase first.** Always. Production Supabase is downstream of testing.
5. **Dual-write transitional states are first-class.** Plan them, name them, decommission them deliberately.
6. **The audit work is real work.** Reading the codebase and understanding data flow IS migration work, not preamble.

---

## Captain's Log

- **2026-05-14** - Migration committed. Strangler fig approach chosen over big-bang. Stages: 0 (audit + abstraction), 1 (Supabase setup), 2a (read-only HUB), 2b (People Portal), 2c (Ops Hub), 2d (Service Calendar), 3 (decommission). Dashboard cleanup PR #23 reclassified as Stage 0 Step 1. Most of Phase 2-5 of the original `MIGRATION.md` plan deferred or absorbed.

  **How the decision arose:** Today's planned work was Sentry Phase A install + Phase B observability scoping + Task #2 OAuth scope reduction. Shipped Sentry (PR #21) and its docs (PR #22) on plan. Then noticed during local dashboard testing that the `/api/dashboard` route was reading kudos/waste/logs/celebrations on every page load - none of which the current dashboard UI displays. Audit confirmed: ~3 dead Sheets reads + 1 dead write + 3 dead metric computations + dead helper function per dashboard load. PR #23 surgically removed them (~200 lines deleted, 3x faster dashboard load, ~500 fewer Sheets calls/day for 25 users).

  **What the discovery surfaced:** This pattern (legacy backend reads that survived UI rewrites) is likely systemic across all routes - `people/route.js` has 25+ action handlers and ~2165 lines, `ops/route.js` has multiple bootstrap actions with 13+ reads. Started a full-codebase audit; uploaded HUB + COLLECTION xlsx files for ground-truth verification. Discovered that several core "feature" tabs (kudos_log, paf_log, incidents at the time, kudos_bonus_log, labor_logs, invoice_logs) have 0 data rows - features exist in code but never adopted, or are still in development.

  **The strategic conversation:** Kevin raised that the Sheets-as-backend architecture is a learning-while-building artifact accumulating cluttered tabs, and that the rate-limit incident yesterday + today's dead-code discovery indicate it may be time to think about Supabase. Discussed: (a) honest tradeoffs of staying on Sheets vs migrating, (b) hybrid as a rejected option, (c) cleanup-first vs migrate-with-cleanup-integrated, (d) strangler fig as the right pattern. Decision: commit to migration, staged by data category and risk. Pre-clean-Sheets-first rejected as a separate step because cleanup is intrinsic to migration.

  **What this changes:** Phase B observability instrumentation officially CANCELLED - the R12 problem dissolves post-migration; not worth instrumenting a backend that's leaving. Task #2 (OAuth scope reduction) DEFERRED to post-migration. Phase 2 (TypeScript), most of Phase 3, Phase 5 (multi-tenancy) all deferred. Pre-Service Briefing Tool can still ship during migration if built against the abstraction layer.

  **Captured ground truth:** Sheet inventory doc (`docs/SHEET_INVENTORY_2026-05-14.md`) records which tabs are populated vs empty vs in-development. Future sessions should NOT re-download xlsx files to rediscover this.

  **DO NOT TOUCH list (confirmed with Kevin):** `incidents`, `preservice_logs`, `preservice_content`, `deep_clean_days`, `ops_newsfeed`, all `HUB__Performance_*` and `COLL__Cycle_Review_*` / `COLL__WOW_*` / `COLL__Scorecards` (KPI Dashboard parked). These read/write paths must remain untouched during audit and migration.

**Next session opens with:** Stage 0 audit of `src/app/api/people/route.js` - the People Portal route. Bootstrap action is at line 638. Use the same pattern as dashboard cleanup: read what's computed, verify frontend usage, mark dead reads. Don't touch incident-related handlers.

  **AFTERNOON UPDATE (2026-05-14 PM):** Plan executed AND exceeded. Stage 0 audit work continued past morning prediction:
  - People GET handlers (7 of 8) - all CLEAN
  - Broken People reports deleted (PR #26, ~621 lines) - Vercel cron was generating broken emails Kevin had filtered to junk
  - People POST handlers (10 of 14) - 9 CLEAN + 1 deleted (PR #27)
  - Directory route (9 of 9) - all CLEAN code, but 4 architectural concerns documented (PR #28)
  - Stage 2a.5 added - image hosting migration to Supabase Storage (PR #28)
  - Cron daily (5 of 5 categories) - 4 CLEAN + 1 dead block removed (PR #29)
  - Total: 9 PRs shipped today (#21-#29). Five cleanups, three docs, one strategic pivot.

  **REVISED next-session opening:** Stage 0 audit of `src/app/api/cron/analytics/route.js`. See `docs/HANDOFF_2026-05-14-pm.md` for the concrete next action and full state.

  **Remaining Stage 0 audit queue (updated 2026-05-15):**
  - `/api/ops` - DEFERRED to own dedicated session per Kevin's call (largest, most complex)

  **Completed today:**
  - `/api/cron/backup-sheets` - audit complete (PR #35, 2026-05-15)
  - `/api/people/leadership-dugout` - deferred until route reaches stable v1 (this PR, 2026-05-15)

  Stage 0 abstraction layer design - NOT YET STARTED. Audit is necessary but not sufficient for Stage 0 completion.

  **Working agreement adopted today:** When audit finds architectural concerns in code being migrated, document the concerns rather than build Sheets-specific workarounds. We don't invest in code we're throwing away. Concerns become Stage 1 schema design inputs.

- **2026-05-15** - Analytics module fully decommissioned in a 3-PR sequence (PRs #31/#32/#33). The analytics sheet had hit Google's 10M-cell limit on 2026-05-12; writes were gated off behind `ANALYTICS_ENABLED` (default off). Stage 0 audit of `/api/cron/analytics` (the next-session opener queued above) concluded that the entire module had no plausible product use case: the read surface (`/analytics` dashboard) was visible only to k.fietek and was never used in steady state, and the write surface was already dormant. Decision: delete the module rather than rebuild on Postgres.

  **Teardown shape (3 PRs over one session, ~2,408 lines deleted):**
  - **PR #31 - surface deletion (2,294 lines).** Deleted `src/app/analytics/page.js` (509), `src/app/analytics/analytics.css` (517), `src/app/api/analytics/route.js` (297), `src/app/api/cron/analytics/route.js` (959). Removed the cron entry from `vercel.json` and the email-gated Analytics link from `TopNav.js`. Bundled as one PR to avoid the 404 window from splitting the cron + dashboard removals.
  - **PR #32 - callsite cleanup (114 lines).** Stripped every `logEvent`/`logEventSA`/`logHealthSA` import and call from 8 route files: `dashboard`, `directory`, `service-calendar`, `ops`, `ops/inventory` (dead import), `people`, `people/leadership-dugout`, `cron/daily`. `auth.js` and `cron/incident-reminders` were excluded - `auth.js` is in the danger zone and `incident-reminders` was in its post-incident-feature stabilization window.
  - **PR #33 - lib stub + doc sweep (this PR).** `src/lib/analytics.js` reduced from 397 lines to a 12-line no-op stub exporting only `logEventSA`. Once `auth.js` and `incident-reminders` are safe to edit, the file gets deleted entirely. `ANALYTICS_SHEET_ID` and `ANALYTICS_ENABLED` removed from `docs/ENV_VARS.md`; corresponding env vars must be removed from Vercel manually. Doc sweep covered `ENV_VARS.md`, `ARCHITECTURE.md` (6 analytics refs + 2 stale cron rows from PR #26 drift + 2 missing rows added for cron-table coherence with `vercel.json`), `MIGRATION.md` (Phase 3 commentary rewritten), and `RUNBOOK.md` (section retitled "Analytics module deleted").

  **The strategic frame for future analytics:** Custom analytics is not currently planned. Errors go to Sentry, traffic to Vercel Analytics, operational data to Supabase dashboards once Phase 3 ships. If custom dashboards become necessary later, they will be built on Postgres queries against real usage data, not preemptively as instrumentation across the codebase.

  **Stage 0 audit also surfaced 195 pre-existing lint issues across the codebase.** Worth a dedicated lint-cleanup pass post-migration. Particularly notable: `react-hooks/set-state-in-effect` violations in `TopNav.js:270` (setEmail inside an effect body) and `WowPlanPreDay1.js` (form state initialization inside an effect) - these are real React anti-patterns that could cause subtle bugs, not just style issues. Not actionable now (out of Stage 0 scope), but flagged here so it doesn't get lost.

  **What Stage 0 audit queue looks like after this:** `/api/cron/analytics` is closed (deleted). Remaining: `/api/cron/backup-sheets` (quick), `/api/people/leadership-dugout` (light audit only, in active dev), `/api/ops` (deferred to own session). Then Stage 0 abstraction layer design.

- **2026-05-15 (post-PR-33-merge)** - Three backlog items surfaced during the analytics teardown, captured here so they don't get lost:

  1. **e2e CI is hardcoded against production, not the PR preview.** `.github/workflows/e2e.yml` sets `PLAYWRIGHT_BASE_URL: https://kitchfix-intranet.vercel.app` in the test step's env. Every PR's Playwright run exercises prod, authenticated via a cached `PLAYWRIGHT_AUTH_STATE_B64` secret - meaning PR-side regressions can't actually be caught by this CI (the PR's code never runs in the test) and any prod flake blocks merges. Surfaced when PR #33's CI failed on `tests/vendors/card-detail.spec.ts` against a slow prod redirect that had nothing to do with PR 3's code (which only touched `src/lib/analytics.js` and docs). Re-run passed on retry.

     **Original estimate (PR #34):** ~30 min - swap `PLAYWRIGHT_BASE_URL` to a preview URL via either `patrickedqvist/wait-for-vercel-preview` or Vercel's `repository_dispatch` webhook pattern.

     **Refined estimate (2026-05-15 research):** the URL swap is the easy part. The real blocker is **cookie domain scoping**. NextAuth in `src/lib/auth.js` uses default cookie config (no custom `cookies:` block), so session cookies are host-only. The cached `PLAYWRIGHT_AUTH_STATE_B64` is keyed to `kitchfix-intranet.vercel.app` (prod). Preview deploys live at `kitchfix-intranet-<hash>-<team>.vercel.app` - a different host - so the cached cookies do not apply. Switching the URL alone would just shift failures from "occasional prod flake" to "every PR fails at /login redirect."

     **Real fix has three parts:**
     - Workflow change: add preview-URL extraction step, pass URL to Playwright (low risk, ~15 min)
     - `src/lib/auth.js` change: add `cookies` config setting `domain: '.vercel.app'` (or wider) conditional on `VERCEL_ENV === 'preview'` so prod cookie behavior is unchanged (auth danger zone - careful)
     - Verification: deploy to a preview, manually log in, confirm auth works on both prod and preview before merge

     **Dependency / batching call:** this should batch with the hand-rolled SA auth consolidation flagged in PR #35's audit finding B2 (both `getServiceAccountAuth` in `cron/backup-sheets/route.js:37-46` and the same pattern in `people/route.js:80-151`, both candidates for consolidation into `getServiceAccountSheetsClient()`). That consolidation already plans to be careful in the auth-adjacent area; adding the cookie-domain change at the same time amortizes the verification overhead and avoids two separate danger-zone touches.

     **Don't ship as standalone today.** Right tooling step is to wait for the SA auth consolidation work, do both at once, verify together.

  2. **`/ops` redirect takes 3.3s.** Curl probes during PR #33 diagnosis: `/login` returns 200 in 290ms; `/` redirects in 117ms; `/ops` redirects in **3.3 seconds**. The 307 is correct behavior (auth-gated route → /login for unauth users), but a 3-second redirect is anomalous. Candidates: Vercel cold start, middleware overhead (note the `middleware.ts` → `proxy.ts` deprecation warning still firing in build output, possibly related), or a slow auth check on the request path. User-perceptible latency on the most-trafficked route. Worth investigating in a future session.

  3. **Playwright 15s element-visibility timeouts may be insufficient when prod is slow.** The flaky failure in (1) was likely a 15s `toBeVisible` timeout firing during one of the slow-redirect moments from (2). The test suite currently has 3 tests; if it grows, revisit wait strategies (network idle, more specific selectors) or bump per-step timeouts. Lower priority - largely masked by (1), since preview deploys are more predictable than prod.

  **All three are paused, not actively worked.** They sit in the post-migration backlog. (1) is genuinely small if you want to slot it earlier.

- **2026-05-17 (during SousAI deletion prep)** - Double-encoded UTF-8 mojibake discovered in CSS comments

  Discovered via byte-level inspection of `src/app/ops/css/ops-executive.css` while mapping the SousAI deletion (PR #40). Some CSS comment section dividers in source files contain corrupted em-dash sequences - 9 bytes (`c3 a2 e2 80 9d e2 82 ac`) where 3 bytes (`e2 80 94`) should be. The canonical-docs em-dash sweep (PR #36) wouldn't have caught this; that sweep replaced literal em-dash bytes, and mojibake bytes don't match.

  **Scope:** 5 CSS files, 90 total mojibake instances:
  - `src/app/people/people.css` - 44 instances
  - `src/app/ops/css/ops-vendor.css` - 16
  - `src/app/ops/css/ops-executive.css` - 13 (one removed inline with the SousAI block in PR #40)
  - `src/app/ops/css/ops-shared.css` - 10
  - `src/app/ops/css/ops-inventory.css` - 7

  All in CSS comment dividers (section labels like `/* — Section Title — */`). No JS/JSX files affected. No functional impact - comments only. Visually ugly when reading the CSS files.

  **Fix:** small dedicated CSS-cleanup PR. Likely a single sed pass replacing the mojibake byte sequence with `-` to satisfy the no-em-dashes preference, since em-dashes were the original intent before the double-encoding event. Extends the source-code em-dash sweep backlog item to include mojibake handling.

  Not blocking any active work.

- **2026-05-17 (during SousAI deletion prep)** - KPI Dashboard / FinancialTool parked-feature cleanup needed

  Discovered during the ExecutiveDashboard reachability check for SousAI deletion (PR #40). The `/financial` route, `FinancialTool.js`, `ExecutiveDashboard.js`, `PeriodSnapshot.js`, and 5 sibling `Exec*` components (`ExecDonutChart`, `ExecSVGTrend`, `ExecRevenueVsCost`, `ExecSparkline`, `ExecDivisionCard`) are all part of the parked KPI Dashboard feature. Files dated 2026-02-26, untouched for three months.

  No production navigation links to `/financial`. Page exists, route is reachable if user types the URL, but no operator surface points there. Pre-existing "parked" status documented at `ARCHITECTURE.md:213` ("removed from active architecture") and `SUPABASE_MIGRATION.md:534` (DO NOT TOUCH list includes "KPI Dashboard parked").

  **Scope of future deletion PR** (~1,800-2,000 lines, 7-8 files):
  - `src/app/financial/page.js` (whole file)
  - `src/app/financial/FinancialTool.js` (554 lines)
  - `src/app/ops/components/executive/ExecutiveDashboard.js` (382 lines, post-SousAI deletion)
  - `src/app/ops/components/labor/PeriodSnapshot.js` (~457 lines, post-SousAI deletion) - same parked feature, importer is the parked FinancialTool
  - 5 sibling Exec* files in `executive/` folder
  - `src/app/api/financial/route.js` (1,828 bytes)
  - Surgical edits to `HelpFAB.js:15` (remove `/financial` context label)
  - Possibly `ops-executive.css` (depends on whether anything else uses it post-deletion)
  - Doc updates: remove `/financial` from `ARCHITECTURE.md` route table; update KPI Dashboard "parked" note to "deleted"

  **Sheet tabs that fed the KPI Dashboard** (documented in `SUPABASE_MIGRATION.md:244` do-not-touch list): `HUB__Performance_*`, `COLL__Cycle_Review_*`, `COLL__WOW_*`, `COLL__Scorecards`. These don't get touched in code deletion (we don't modify sheets remotely), but they become candidates for not-migrating-to-Postgres in Phase 3. Worth a separate captain's log when KPI Dashboard deletion ships to update the do-not-touch list.

  **Not blocking any active work.** Same shape as the mojibake finding - real cleanup item, future PR, captured here so it doesn't get lost.

- **2026-05-17 (during Audit #2 - inventory submission flow)** - opsNotify duplicate consolidation needed

  `src/app/api/ops/route.js:42` defines a local `opsNotify(token, payload)` that writes via user-OAuth `appendRow`; `src/lib/opsUtils.js:96` exports a canonical `opsNotify(payload)` that writes via service-account `appendRowSA`. Five call sites in `route.js` use the local legacy version. Same shape as Directory audit Concern 1: user OAuth used for a write that does not need it.

  **Corrective addendum to Audit #1:** Audit #1's "no SA-auth concern in this file" line is technically correct (no hand-rolled JWT), but it missed the user-OAuth-write-via-wrapper - the local `opsNotify` is the gap. That line in `SUPABASE_MIGRATION.md` (the Ops Hub dispatcher audit entry) gets a corrective addendum once the consolidation ships.

  **Scope of the future consolidation PR:**
  - Delete the local `opsNotify` definition in `route.js:42-55`.
  - Import canonical `opsNotify` from `@/lib/opsUtils`.
  - Drop the `token` arg at 5 call sites. Touches submit-inventory (just shipped in Audit #2), submit-labor-actuals (Audit #3 territory), and 3 other handlers (likely invoice + vendor adjacent).
  - Update Audit #1 entry with the corrective addendum.

  **Why a separate PR:** Folding into Audit #2 would expand scope into labor-actuals (Audit #3 territory) and 3 other handlers, blowing up the audit's surgical scope. Pulled into its own follow-up so Audit #2 ships clean and Audit #3 reviews labor-actuals against the canonical `opsNotify` in place.

  **Not blocking any active work.** Same shape as the mojibake and KPI Dashboard findings - real cleanup item, future PR, captured here so it doesn't get lost.

  **Shipped: PR #43.** Local `opsNotify` deleted; 5 call sites consolidated to canonical `@/lib/opsUtils.opsNotify`; indentation drift at submit-labor-actuals and submit-sold-revenue cleaned up while in the area. Audit #1 entry updated with corrective addendum (above).