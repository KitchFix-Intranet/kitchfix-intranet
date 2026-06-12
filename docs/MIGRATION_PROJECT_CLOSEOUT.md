# Supabase Migration Project — Close-Out

**Status:** CLOSED 2026-06-12
**Project ran:** ~2026-04 through 2026-06-12
**Canonical current-state doc:** [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md)
**This doc:** the project's handoff artifact - what was done, what was decided, what comes next, and what a builder needs to pick this up cold.

---

## A. Project summary

The Supabase migration project was a multi-month effort to move the KitchFix Ops Hub's data layer from Google Sheets to Supabase Postgres, executed as a **strangler-fig dual-write + per-module cutover** pattern. Each module was migrated independently: schema design -> backfill -> dual-write -> read flip -> Sheets retained as rollback net. Six modules cut over (News, Directory, People-submissions, Vendor, Invoice, Playbook/OPD). The project closed when the meta-finding emerged: the migration playbook was built for finished features needing a data-layer swap; the remaining roadmap items were either half-built, unused, or slated for rebuild, and applying the playbook to them would be the wrong tool. Future data work proceeds in **build mode** - new features built Supabase-native using the dataStore orchestrator pattern, unmigrated modules left on Sheets until they're rebuilt or retired.

---

## B. Current state of truth

### Modules CUT OVER to PG

| Module | Tables | Read state | Write state | Cutover date |
|---|---|---|---|---|
| **M1 News** | `news_interactions` | PG | dual-write (Sheets + PG) | 2026-05-27 (PR #61/#63) |
| **M2 Directory** | `accounts`, `contacts`, `hero_images`, `work_locations` | PG (per-module flags for 5 consumers) | dual-write | 2026-05-27 (PR #69/#71/#73) |
| **M3 People-submissions** | `submissions` (PAFs, incidents structure, etc.) | PG | dual-write | 2026-05-27 (PR #75-#78) |
| **M4 (infra)** | dataStore.js split into per-module files | n/a | n/a (refactor only) | 2026-05-28 (PR #86) |
| **M5 Vendor** | `vendor_master`, `vendor_accounts`, `vendor_aliases` | PG | dual-write | 2026-05-29 (PR #87/#88/#89) |
| **M6 Invoice** | `invoice_submissions`, `invoice_rejections`, `ai_line_items`, `gl_codes` | PG | dual-write | 2026-06-03 (PR #95/#96 + 6.3-6.6) + fix bundle 2026-06-12 (PR #138, pr-9-1 migration, PR #139) |
| **Playbook / OPD** | `documents`, `document_relationships`, `document_surfaces`, `document_issues`, plus Sousai `document_chunks` | PG (PG-native, never a Sheets cutover) | PG | Built directly on PG via `@/lib/supabase` |

### Features that remain on SHEETS (and why)

| Surface | Reason it's on Sheets | Disposition (see §D) |
|---|---|---|
| `/ops` Labor / Season Planner | Real, used, but migration is half-redesign (per-account year-grid + year-coded tabs); LEAVE until annual rebuild | Leave |
| `/ops` Legacy Inventory Count | Superseded by Smart Inventory (parked); retire when SI fate decided | Leave -> retire year-end |
| `/financial` | Pure HTTP proxy to /ops Labor; dies with Labor | Leave |
| `/service-calendar` | Real, used, but complex per-account year-grid + year-coded tabs; the one genuine migration remaining | Migrate (standalone project) |
| `/people` Incidents | Code fully wired but never used (0 rows ever); side-effect-entangled; rebuild Supabase-native when prioritized | Leave (rebuild later) |
| `/people` Leadership Dugout | Hybrid: WOW Plans wired (~25 rows real) + Cycle Review stubs (15+ unwired actions); rebuild as one piece when returned to | Leave (rebuild later) |
| Smart Inventory tools | Parked - prototype #1 over-built; v2 vision is queries-over-facts, no cron | Parked |
| Module 8 cron (Railway, separate repo) | Gated on Smart Inventory's fate | Parked with SI |

### What "parked" means

**Smart Inventory (Module 7)** + **Module 8 cron (Railway)** are parked:
- Code stays running as-is for now
- The cron continues writing to PG nightly (the schema is live; PG mirrors verified before the 2026-06-12 pivot)
- Data accumulates - it's input for the eventual v2 build
- No active development; no migration in either direction
- Fate decided when SI un-parks (likely a queries-over-facts rebuild, see [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md))

### Dual-write posture

All six cut-over modules **still dual-write** Sheets + PG. Sheets is the rollback net. **Sheets retirement is deferred indefinitely** - there is no urgent reason to stop the dual-write, and there's a structural reason it can't happen yet anyway:

> **Structural gap - flag this:** `src/lib/cutover.js` has no decommission state. The four states it recognizes today (OFF / DUAL-WRITE-BUILDING / CUT-OVER / MISCONFIGURATION) all keep Sheets writes ON. Removing a table from `DUAL_WRITE_TABLES` does NOT stop Sheets writes - it stops PG writes, producing the silent state-4 misconfiguration. To actually turn Sheets writes off (PG becomes sole writer, Sheets freezes as backup), the orchestrators need either inverted semantics or a third `FREEZE_SHEETS_TABLES` flag. Neither is built. **Real future work** but not urgent.

Operational cost of the gap: Sheets API availability gates write availability for every cut-over module (Sheets-first writes throw if Sheets fails, never reaching PG). In practice this hasn't been an issue.

---

## C. Key decisions + reasoning (so nothing gets re-litigated)

### C.1 Invoice-capture-to-PG: the silent dual-write gap + fix bundle (2026-06-12)

**What went wrong:**
- Module 6 cut over 2026-06-03 with dual-write to Sheets + PG.
- A schema migration (`pr-9-1-ai-line-items-raw-fields.sql`) was authored to add 9 "Stage A" columns to `ai_line_items` (item_number, pack_size, amount, etc.) for richer OCR extraction.
- The Stage A **code** deployed ~2026-06-09/10 (commits 263c49f, 678912d, 21254ac, 50a5816) and started sending those columns on every invoice insert.
- The Stage A **migration was never applied** to PG. The columns didn't exist.
- Result: every invoice write since 2026-06-10 threw `PGRST204 Could not find the 'amount' column...` on the PG side. The dual-write orchestrator's catch handler at `invoiceActions.js:1395` marked these as `ai_scan_status='failed'` - indistinguishable from "OCR scan itself failed."
- **We were blind to ~3 days of silent write failures.** 27 invoices' worth of line items existed in Sheets but not in PG, with no signal anything was wrong.

**The compounding distractor:** during the audit, OCR was also producing duplicate `line_num` values (Claude mislabeled line 38 twice on one Ben E Keith invoice, line 10 twice on a Cheney Brothers). The PG partial unique index `ai_line_items_new_dedup_idx ON (invoice_uuid, line_num) WHERE is_historical=FALSE` rejected these. We initially thought this was the root cause. It explained 2 of 34 invoices. The other 32 were the missing migration.

**The fix bundle (all shipped 2026-06-12):**
1. **PR #138 — visibility fix.** Added `pg_failed` to the `ai_scan_status` CHECK + new `ai_scan_error TEXT` column on `invoice_submissions`. Modified the catch handler at `invoiceActions.js:1395` to inspect the error message for the `[dataStore.invoice.pg]` prefix and route PG failures to `pg_failed` + capture the verbatim error. This made future silent gaps impossible.
2. **pr-9-1 migration applied** in Supabase Studio. Added the 9 Stage A columns + widened `invoice_submissions.type` CHECK to include `cc_receipt` + added `catch_weight_marker` CHECK.
3. **PR #139 — re-sequence line_num.** In `extractAndStoreLineItems`, changed `lineNum: item.lineNum || 0` to `lineNum: idx + 1`. Re-sequences line_num as a clean 1..N over the actual extracted lines instead of trusting Claude's labels. Both confirmed dup-line cases (Ben E Keith, Cheney Brothers) had real distinct items mis-numbered, not duplicate rows - re-sequencing preserves data; deduplicating would lose lines.

**Verification:** before/after audit. Pre-fix: 0 of 37 gap invoices' payloads landed cleanly. Post-fix: 46 of 46 land. Visibility fix proven in prod by 13 `pg_failed` rows captured today with the verbatim `Could not find the 'amount' column` error - the smoking gun.

### C.2 No-wipe decision (2026-06-12)

The original recovery plan was to wipe PG invoice + inventory data ("prototype-1 data") and let it rebuild from clean writes going forward. Was scoped: 11 tables, FK-safety audit complete, table-by-table sign-off ready.

**The pivot:** discussion shifted to using the existing `is_historical` mechanism instead (already exists on the 4 invoice tables; the partial unique indexes gate on `is_historical=FALSE`). Then discussion shifted again to: **don't wipe, don't mark - keep all historical data.** The prototype-1 data has latent value; SI's eventual v2 may want to look at it; nothing forces a clean break.

**Decision:** keep all historical data. No wipe, no v1 marking. Both systems (invoice capture + cron) keep building the PG database. When SI un-parks, revisit critical look at the accumulated data then.

### C.3 Smart Inventory parking (2026-06-12)

Smart Inventory (Module 7) and the Railway cron (Module 8) were on track for the four-flag atomic cutover. They were close - schema applied, all PG mirrors verified, RQ tool merged in PR #136.

**The decision:** park instead. Reasoning is in [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md) at length. Short version: prototype-1 was over-built (700 of 893 review_queue rows were arithmetic_fail, dominated by Ben E Keith / Cheney Brothers / Kuna distributor invoices producing PACK/Cases conflation). The v2 vision is **queries-over-facts**: no cron, no batch matching pass, no review queue. Instead, the OCR'd line-item facts are the only source of truth; inventory views are computed on demand by querying those facts (e.g., "what's our last-known price for tomato whole peeled pear at CIN - AZ?" -> SELECT from ai_line_items). Each item becomes a "creature with a profile" - aggregated identity built from its facts.

**Cron's fate:** the cron's role (matching line items to a catalog) goes away in v2 because there's no catalog to match against. Module 8 effectively gets deleted in v2. For now it keeps running; the data it produces is preserved as input for the v2 design phase.

### C.4 Remaining-roadmap dispositions (2026-06-12)

See §D below. Short version: of 7 remaining items, only Service Calendar is a genuine migration. The rest are leave-on-Sheets-rebuild-later (Labor, Financial, Legacy Inv Count, Incidents, Dugout) or defer-with-SI (Module 8). The "migrate finished features" playbook ended at Module 6.

### C.5 The meta-finding

The first six modules (News, Directory, People-submissions, Vendor, Invoice, Playbook) had something in common: they were **finished features** with real users, real data, and clean code paths that needed a data-layer swap. The Stage 1 dual-write playbook fit them perfectly.

**The remaining items don't have that shape.** Investigation kept finding:
- Stubs disguised as features (Leadership Dugout has 15+ action handlers that return `{ todo: action }` and touch zero data)
- Wired-but-unused features (Incidents has 0 rows ever submitted despite the full Drive/Calendar/Slack/email pipeline)
- Pure HTTP proxies pretending to be backends (Financial is 54 lines of `proxyToOps`)
- Per-account year-grid shapes that don't map cleanly to PG (Labor, Calendar)
- Soon-to-be-rebuilt code (Smart Inventory's prototype-1)

Applying the dual-write migration playbook to these would be the wrong tool. **The migration-as-data-layer-swap era ended at Module 6.** Future data work is build mode: new features built Supabase-native using the dataStore orchestrator pattern, unmigrated modules left on Sheets until they're rebuilt or retired.

This isn't a failure of the migration project. It's the natural endpoint: the playbook was designed for one specific shape (finished feature, data swap), and that shape is now exhausted.

---

## D. Remaining roadmap - dispositions

| Item | Disposition | Reasoning |
|---|---|---|
| **Service Calendar** | **MIGRATE** as its own dedicated project | The one genuine migration remaining. Real, used (97 service_config rows + ongoing day-level writes, 10 wired actions, no stubs). But the per-account year-grid + year-coded tab shape is complex - it's a real schema design problem, not a swap. Worth its own project. |
| **Ops Labor (Season Planner)** | **LEAVE ON SHEETS**, rebuild new version next year | Migration is half-redesign anyway. Same per-account year-grid shape as Calendar. The labor tool will likely be redesigned as part of the annual financial cycle; better to rebuild on PG fresh than migrate-then-redesign. |
| **Financial** | **LEAVE ON SHEETS** (proxy on Labor) | Backend is 54 lines of HTTP proxy to /ops Labor. Dies with Labor at year-end. Real financial dashboard is a future build, not a migration target. |
| **Legacy Inventory Count** | **LEAVE ON SHEETS**, retire year-end | Superseded by Smart Inventory (parked). Migrating something we plan to retire is waste. Keep running for monthly count submissions until SI v2 is built and absorbs the use case. |
| **Module 8 Railway cron** | **LEAVE**, parked with Smart Inventory | Cron's role (catalog matching) likely goes away in SI v2 (queries-over-facts has no catalog to match against). Decision rides with SI un-parking. |
| **Incidents** | **LEAVE ON SHEETS**, build Supabase-native when prioritized | Still needs design work (side-effect entanglement: Drive folder + Calendar event + Slack post + email + PDF + escalation deadlines all happen on submit). Sheets version is functional with 0 rows ever submitted - no coverage gap, no data to migrate. Build native when this becomes a priority. |
| **Leadership Dugout** | **LEAVE ON SHEETS**, standalone build-with-migration when returned to | Hybrid: WOW Plans wired (~25 rows real data) + Cycle Review stubs (15+ unwired actions). Building Cycle Review on PG while keeping WOW Plans on Sheets is inconsistent; migrating WOW Plans now and rebuilding Cycle Review later means a hybrid module. Better to defer the whole thing and build it as one coherent piece when the People Portal gets attention. |

**Net:** 1 migration (Calendar), 5 leave-on-Sheets (Labor, Financial, Legacy Inv, Incidents, Dugout), 2 parked (SI, Module 8 cron). No active "build" work as of the close-out date; build work resumes when business priorities surface.

---

## E. Proven patterns + hard-won lessons

### Patterns that worked

**Recon-first, read-only before changes.** Every non-trivial change started with a probe script in `scripts/_probe_*.mjs`. Read-only investigation > assuming. The pattern repeated dozens of times and prevented bad fixes more than once (e.g., the cross-vendor mismatch theory was ruled out via probe before any code change - it would have been weeks of wrong-tree barking).

**Verify the real artifact, not the abstraction.** Live column probes (`SELECT amount FROM ai_line_items` -> 42703) beat reading migration files. Eye-verify rows (not counts) caught Sheets-side empties hiding behind non-zero counts. The migration file said the column existed; the live DB said otherwise; the live DB was right.

**"A null is honest, a back-computed value is a lie."** The Stage A OCR prompt rule (`docs/migrations/pr-9-1-ai-line-items-raw-fields.sql` header). When a field can't be read reliably, return null - don't fall back to amount÷unitPrice or default to "case." Null is observable; a back-computed value silently passes downstream gates with wrong data. The cron's arithmetic-fail review queue was producing 700 of 893 rows because Claude was back-computing pack/case conflation; the fix was forcing Claude to return null + deriving in code.

**Make silent failures LOUD and named.** The pg_failed + ai_scan_error pattern (PR #138). Before: PG dual-write throws caught at `invoiceActions.js:1395` -> marked `ai_scan_status='failed'` -> indistinguishable from OCR failures -> silent gap. After: distinct status `pg_failed` + verbatim error message captured in `ai_scan_error` -> impossible for the same gap to recur silently. The general lesson: **named error states beat generic ones; verbatim captures beat summaries.**

**Fix-before-wipe-before-rebuild ordering.** When the original recovery plan was a destructive PG wipe, the discipline was: fix the write path first (so the rebuild lands clean), confirm clean writes on real traffic, then wipe, then verify rebuild. The order is non-negotiable: a clean restart that immediately re-gaps isn't clean. (In the end the wipe was canceled, but the discipline of the ordering was right.)

**Dual-write with Sheets as rollback net until PG proves itself.** Every module's cutover left Sheets writes ON for a soak period - in some cases indefinitely. Sheets being the rollback target meant we could un-flip the read flag (`READ_FROM_POSTGRES`) and serve from Sheets again without losing data. Used in practice: the Module 6 invoice fix played out while Sheets was still writing the canonical data, so the 27 stranded invoices weren't actually lost - they were in Sheets the whole time.

**The dataStore orchestrator + flag-dispatch pattern.** `src/lib/dataStore/<module>.js` exposes an orchestrator function (e.g., `insertAILineItems(uuid, items, opts)`) that dispatches to a Sheets adapter + a PG adapter based on `isDualWrite(tab)` and `isReadFromPostgres(tab, module)` checks. This is the pattern the migrated modules use. **All future builds must use it.** See §H for the contrast against the old direct-Sheets pattern.

**Verify against the live DB before destructive ops.** The wipe-safety audit (the SQL query we ran in Studio against `pg_constraint` / `information_schema.referential_constraints`) caught every FK direction directly from the catalog instead of reconstructing from migration files. When the wipe was scoped, the audit confirmed zero KEEP -> WIPE inbound FKs. Even though the wipe was canceled, the audit pattern is the right one for any future destructive op.

### Failure modes that bit us (named and direct)

**Shipped pr-9-1 in code but never applied to PG, blind to silent write failures for ~3 days until #138 caught it.** The Stage A code deployed ~2026-06-09/10 and started sending 9 new columns on every invoice insert. The migration sat in `docs/migrations/pr-9-1-ai-line-items-raw-fields.sql` unapplied. Every insert threw `PGRST204 Could not find the 'amount' column` - silently caught by the dual-write handler and marked `ai_scan_status='failed'`. Indistinguishable from OCR failures until PR #138 added the `pg_failed` named state. **Lesson learned: a schema migration in the repo is not the same thing as a schema migration applied to PG. Verify-at-deploy** (or, future improvement: a deploy-time check that fails the build if the live schema doesn't include columns the new code writes).

**Cross-vendor mismatch was a wrong-tree theory that ate time before we ruled it out.** Initial reading of the gap data showed Shamrock / Sysco / Peddler's Son disproportionately. Hypothesis: vendor name resolution was failing. Probe ruled it out - all 12 top failing vendors resolved cleanly on exact lowercase match. The real cause was the missing migration. **Lesson learned: data patterns can correlate without causation; run the probe that confirms the mechanism, don't infer from the distribution.**

**Assumed Leadership Dugout was a finished feature ready for a clean swap.** First investigation surfaced one API route with 14+ action handlers. Looked like a migration target. Deeper read: most of the handlers are stubs returning `{ todo: action }`. The "finished feature" assumption was wrong. **Lesson learned: count wired-vs-stub actions before scoping a migration. The route file's existence doesn't tell you the feature is wired.**

**Per-account-grid + year-coded-tab Sheets shapes don't map cleanly to PG.** Labor and Calendar both use per-account spreadsheets (lookup via `accounts.SpreadsheetId`) with year-coded tabs (`Projections - 2026`, `Actuals - 2026`, `Clicker Counts - 2026`). The grid shape (one row per date, columns per service) doesn't normalize cleanly without flattening to event rows. The year rotation is an annual operational task. **Lesson learned: not every Sheets shape is a row-set. Grid shapes need a schema-design pass, not a swap.**

**Test infrastructure proxied silently because nobody confirmed it ran the PR code.** The Playwright e2e suite runs against the prod URL hardcoded in `.github/workflows/e2e.yml`, not the PR preview. Green-on-PR meant "prod is up + saved auth still valid," not "PR code works." Pre-existing observation; surfaced when a PR's check failed because the auth-state secret had expired. **Lesson learned: a green CI check is only as meaningful as the thing it actually exercises. Read the workflow.**

**Documentation drift across canonical docs created a multi-source-of-truth mess.** CLAUDE.md, PROJECT_DASHBOARD.md, ARCHITECTURE.md, INVENTORY_MODULE.md all described the system state independently and drifted in parallel. The 2026-06-11 doc audit (which produced MIGRATION_STATUS.md as the canonical doc) was the response. This close-out is the second half: archiving the drifted docs and pointing everything at the canonical. **Lesson learned: one canonical doc + many pointers > N parallel docs that all claim authority.**

---

## F. Open items + status

| Item | Status | Where |
|---|---|---|
| Task #132 - stale-doc reconciliation | Resolved by this close-out (Sept-Oct 2025 drift docs aligned/archived) | This PR |
| Task #136 - leadership-dugout recon | Closed; recon informed the disposition decision in §D | n/a |
| June 19 post-fix audit | Scheduled in [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) "Scheduled audits" section | One week after the 2026-06-12 fix bundle; confirms `pg_failed` holds at zero on a week of normal traffic |
| OAuth scope (full `drive` vs `drive.file`) | **Standing item** - not resolved by the migration project | Original CLAUDE.md "Findings" item; still applies |
| Sheets-decommission structural gap | **Standing item** - not urgent | The cutover.js four-state limitation noted in §B; needs a third flag or inverted semantics to actually freeze Sheets writes |
| Incidents side-effect entanglement | **Standing item** - applies whenever Incidents work resumes | Drive folder + Calendar event + Slack + email + PDF + escalation all on submit; needs design before rebuild |

---

## G. Pointers to depth

| Doc | Role |
|---|---|
| [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) | **Canonical current-state.** Source of truth for module status, cutover flags, structural-gap details. Read after this close-out. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The 30,000-ft architectural view: stack, data layer (now dual: Sheets + PG), auth boundary, request flow, module map, background jobs, external integrations. Read for spatial mental model. |
| [`CONVENTIONS.md`](CONVENTIONS.md) | Action-dispatch API pattern, CSS prefixes, sheet column conventions. Read before touching a route or component. |
| [`GOTCHAS.md`](GOTCHAS.md) | Hard-won lessons accumulated over the project. Read before debugging anything that smells familiar. |
| [`BUSINESS_NOTES.md`](BUSINESS_NOTES.md) | Domain rules, account-specific quirks, calculation methodology. Consult before assuming business logic is wrong. |
| [`TEAM_KNOWLEDGE.md`](TEAM_KNOWLEDGE.md) | Team-facing how-to / policy / glossary / account-specific knowledge. Seed corpus for the future Sous AI intranet search. |
| [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md) | Smart Inventory's parked state + the v2 queries-over-facts vision in full. Read when SI un-parks. |
| [`SPEC_INTRANET_AI_SEARCH.md`](SPEC_INTRANET_AI_SEARCH.md) | Product thinking parking lot for the future Sous AI search feature. |
| [`migrations/`](migrations/) | All applied SQL migrations, in apply order. Read for schema history. |
| [`MODULE_6_DATA_AUDIT.md`](MODULE_6_DATA_AUDIT.md), [`MODULE_7_INV-2_PLAN_CORRECTION.md`](MODULE_7_INV-2_PLAN_CORRECTION.md) | Per-module deep audits/plans. Reference material for the modules they name. |
| [`FINANCE_STACK_AUDIT.md`](FINANCE_STACK_AUDIT.md), [`FINANCE_STACK_PLAN.md`](FINANCE_STACK_PLAN.md) | The 1294-line code audit + 1087-line plan that scoped Modules 4-8 (the finance stack: dataStore split, vendor, invoice, smart inventory, cron). Historical reference. |

---

## H. How to resume / what a build needs

### If you're picking this up to build something new

1. **Read this doc.** You're already here.
2. **Read [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md)** for the live state.
3. **Read [`ARCHITECTURE.md`](ARCHITECTURE.md)** for the spatial mental model.
4. **Check [`GOTCHAS.md`](GOTCHAS.md)** before debugging anything that smells familiar.
5. **Build Supabase-native** (see "The orchestrator pattern" below).

### The orchestrator pattern (THE pattern for new work)

New features built today MUST use the `dataStore` orchestrator + flag-dispatch pattern. This is the pattern the six cut-over modules use. Do NOT use the old direct-Sheets pattern.

**The pattern:**

```js
// src/lib/dataStore/<your-module>.js

// PG adapter (private)
async function insertThingPostgres(thing) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("things").insert([thing]);
  if (error) throw new Error(`[dataStore.<module>.pg] insertThing: ${error.message}`);
}

// Sheets adapter (private, mirrors PG)
async function insertThingSheets(thing) {
  await appendRowSA(SHEET_IDS.COLLECTION, "things_tab", rowFromThing(thing));
}

// Orchestrator (public, exported)
export async function insertThing(thing) {
  await insertThingSheets(thing);                    // unconditional
  if (isDualWrite("things")) {                       // flag-gated
    await insertThingPostgres(thing);
  }
}
```

**Routes import from `@/lib/dataStore`, NOT from `@/lib/sheets` or `@/lib/supabase` directly.** The orchestrator decides which store to read/write based on the cutover flags (`DUAL_WRITE_TABLES`, `READ_FROM_POSTGRES`, `READ_FROM_POSTGRES_<MODULE>`).

**The wrong pattern (old, do not copy):**

Several still-on-Sheets modules use the **old direct-Sheets pattern**: route handlers (or helper libraries) import `readSheetSA`/`appendRowSA`/`updateRangeSA` from `@/lib/sheets` and call Sheets directly with no orchestrator and no flag dispatch. Examples:

- `src/app/api/people/leadership-dugout/route.js` (route + 4 helper libs: `performanceChain.js`, `wowPlanActions.js`, `performanceAcl.js`, `performanceActions.js`)
- `src/app/api/ops/route.js` (Labor / inventory count / submit handlers)
- `src/app/api/service-calendar/route.js`
- `src/app/api/people/route.js` Incidents handlers (via `incidentActions.js`)

**These are NOT the model. Do not copy from them when building new work.** They exist because their modules haven't migrated yet (and per §D, mostly won't). If you're tempted to mirror their pattern, you're about to build on the wrong foundation - read an already-migrated module's dataStore file instead (`dataStore/invoice.js`, `dataStore/vendor.js`, `dataStore/directory.js`, `dataStore/submissions.js`, `dataStore/newsInteractions.js`, `dataStore/opd.js`).

### The three-repo setup

1. **`kitchfix-intranet`** (this repo) - the Next.js app + Vercel crons + Supabase schema migrations under `docs/migrations/`. Hosts production via Vercel.
2. **`kitchfix-inventory-cron`** (separate repo) - the Railway cron (Module 8). Nightly batch matching of invoice line items to the inventory catalog. Writes PG. Lives independently.
3. **Supabase project** - the live Postgres database. Schema lives in `docs/migrations/` SQL files; applied manually in Supabase Studio. **Migrations don't auto-apply on deploy** - this is the gap that produced the 2026-06-12 silent-gap incident. When applying a migration, verify via Studio + run a verification probe (`scripts/_verify_*.mjs`) before the code that depends on it deploys.

### How dual-write + flags work

The cutover control plane is `src/lib/cutover.js`. Two env-var-derived flag sets:

```js
DUAL_WRITE_TABLES=table_a,table_b,...        // mirror to PG on writes
READ_FROM_POSTGRES=table_a,table_b,...       // read from PG (instead of Sheets)
READ_FROM_POSTGRES_<MODULE>=table_a,...      // per-module read flag override
```

Default empty = OFF (Sheets-only). Today's steady state for the six cut-over modules: both flag sets include their tables. Orchestrators check `isDualWrite(tab)` and `isReadFromPostgres(tab, module)` at every call site.

**The structural gap noted in §B:** there is no flag for "stop writing to Sheets." Removing a table from `DUAL_WRITE_TABLES` stops PG writes (state-4 misconfiguration), not Sheets. Future work; not urgent.

### Operating model (how this project ran)

This isn't obvious from the code, so it's written down for continuity:

- **Advisor-Claude** (or you, Kevin, directly) specs work in plain terms. The advisor doesn't have access to the machine.
- **Claude Code agent** (this kind of agent, with Bash + Edit + Read tools) executes everything on the machine: branch creation, file edits, SQL runs via probe scripts, git commits, PR opens. The agent reports back; the agent does not merge.
- **Kevin merges every PR himself.** No agent-side merges. No auto-merges. Branch-and-PR for every change.
- **Destructive ops require explicit table-by-table sign-off.** No `DROP`, no mass `DELETE`, no `git reset --hard`, no `git push --force`, no `--no-verify`, no overwriting of in-progress work without an explicit request naming the specific operation. When in doubt: report and ask.
- **No direct commits to main.** Even small typo fixes go through a branch + PR.
- **Read-only probes are the default** for investigation. Writes happen in a controlled second step after the user approves the proposed action.

This worked because the agent and Kevin trade roles cleanly: agent does the work, Kevin owns the decisions + the merge button. The operating model is the reason the project produced ~140 PRs without a single bad merge.

If you're picking this up with a new agent: the same operating model applies. Read this section. Do not merge PRs. Do not run destructive ops without explicit sign-off. Default to read-only investigation. Branch + PR for everything.

---

**End of close-out. The project ran ~10 weeks, shipped six modules, fixed one silent-gap incident, made two correct parking decisions, and ended at the natural endpoint where the playbook no longer fits the remaining work. Good run.**
