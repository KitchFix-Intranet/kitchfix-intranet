# KitchFix Intranet — Migration Status (canonical)

> 🔒 **Migration project phase CLOSED 2026-06-12.** See [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) for the project handoff (what was done, decisions made, dispositions for remaining items, proven patterns + lessons, how to resume). This doc remains the canonical CURRENT-STATE reference for which modules sit on PG vs Sheets and how the cutover control plane works.

**Last verified:** 2026-06-12
**This is the canonical current-state doc.** Other docs should point here for migration status rather than describing it themselves. The 2026-06-11 doc audit established that status claims scattered across `CLAUDE.md`, `PROJECT_DASHBOARD.md`, `ARCHITECTURE.md`, and the module READMEs drift in parallel — this file consolidates one verified source.

---

## Executive summary

The intranet sits on a **Sheets + PG dual data layer**, the product of a strangler-fig dual-write/per-module migration that ran ~2026-04 through 2026-06-12. As of 2026-06-12:

- **6 modules CUT OVER** to PG with dual-write to Sheets as rollback net (News, Directory, People-submissions, Vendor, Invoice, Playbook/OPD).
- **Smart Inventory (Module 7) + Module 8 cron PARKED** 2026-06-12 - prototype #1 was over-built (see [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md) for the parking reasoning + the queries-over-facts v2 vision). Data accumulates as input for v2.
- **Remaining roadmap items (Calendar, Labor, Financial, Legacy Inv Count, Incidents, Dugout)** sit on Sheets with per-item dispositions ranging from "migrate as standalone project" (Calendar - one genuine migration remaining) to "leave + rebuild later" (most). See §"Remaining roadmap" below; full reasoning in the close-out doc.
- **Sheets retirement is deferred indefinitely** for the cut-over modules. Sheets stays as rollback; there's also a structural gap (§"Structural gap" below) that means there's no code mechanism to turn Sheets writes off yet.

---

## The cutover control plane

All migration state flows through `src/lib/cutover.js`. Understand this file or none of the rest makes sense.

### Two env-var-derived flag sets, parsed at module load

```js
const dualWriteTables       = parseTableSet(process.env.DUAL_WRITE_TABLES);
const readFromPostgresTables= parseTableSet(process.env.READ_FROM_POSTGRES);
const readFromPostgresPerModule = parsePerModuleReadFromPostgres(); // READ_FROM_POSTGRES_<MODULE>=...
```

Defaults are empty Sets when env vars are unset. The orchestrators at every dataStore call site gate behavior on `isDualWrite(tab)` and `isReadFromPostgres(tab, module)`.

### The orchestrator pattern (load-bearing)

Every `dataStore` write orchestrator **writes Sheets unconditionally**, then mirrors to PG iff `isDualWrite(tab)` is true. There is no "skip Sheets" branch in the write path. This is what produces the four states below.

### Four states recognized today

| State | Flag pattern | Behavior |
|---|---|---|
| **1. OFF** | Neither flag | Reads + writes Sheets only. PG never touched. Default on merge. |
| **2. DUAL-WRITE BUILDING** | `DUAL_WRITE_TABLES` only | Reads Sheets, writes BOTH. Builds PG mirror under load before flipping reads. |
| **3. CUT OVER** | `DUAL_WRITE_TABLES` + `READ_FROM_POSTGRES` | Reads PG (now source of truth), writes BOTH. **Steady state for migrated modules.** |
| **4. MISCONFIGURATION** | `READ_FROM_POSTGRES` only | Reads PG, writes Sheets only → PG goes stale silently. **Operationally avoided; not blocked in code.** |

The implicit invariant *"READ_FROM_POSTGRES implies DUAL_WRITE_TABLES"* is maintained operationally, not enforced in code.

### Structural gap — there is NO "decommission" state

**The current code cannot turn Sheets writes OFF.** Removing a table from `DUAL_WRITE_TABLES` does NOT stop Sheets writes — it stops PG writes, producing state-4 misconfiguration.

To actually decommission Sheets for a table (PG becomes sole writer, Sheets freezes as backup), the orchestrators would need either:
- inverted semantics (skip the Sheets write when the table is in `READ_FROM_POSTGRES` but not in `DUAL_WRITE_TABLES`), OR
- a third flag (e.g. `FREEZE_SHEETS_TABLES`).

Neither is built. **This is real future work**, listed in the roadmap below. Today it has small but non-zero cost: Sheets API availability gates write availability for every cut-over module (Sheets-first writes throw if Sheets fails, never reaching PG).

---

## Module status — the core table

Six modules cut over, one in flight, the rest enumerated in the roadmap section.

| Module | Surfaces it drives | State | Date / evidence |
|---|---|---|---|
| **M1 News** (`news_interactions`) | Home news feed, dashboard interactions | **CUT OVER** | 2026-05-27 (PR #61 / #63) — first dual-write cutover |
| **M2 Directory** (`accounts`, `contacts`, `hero_images`, `work_locations`) | `/directory`; shared `accounts` read by 5+ modules via per-module flags | **CUT OVER** | 2026-05-27 (PR #69 / #71 / #73) |
| **M3 People submissions** (`submissions`) | `/people` dashboard, activity (Action Center), New Hire wizard, PAF, Admin queue | **CUT OVER** | 2026-05-27 (PR #75-#78) |
| **M4 dataStore split** (infra) | All module facades | N/A (infra refactor) | 2026-05-28 (PR #86) |
| **M5 Vendor** (`vendor_master`, `vendor_accounts`, `vendor_aliases`) | `/ops` → Vendors portal | **CUT OVER** | 2026-05-29 (PR #87 / #88 / #89; 31 vendors / 54 accounts / 49 aliases backfilled) |
| **M6 Invoice** (`invoice_submissions`, `invoice_rejections`, `ai_line_items`, `gl_codes`) | `/ops` → Invoice capture + admin | **CUT OVER** | 2026-06-03 (PR #95-#96 + 6.3-6.6; 661+ submissions, 5938+ line items, 300 gl_codes live) |
| **M7 Smart Inventory** (`inventory_items`, `item_aliases`, `price_history`, `review_queue`, `count_sessions`, `count_items`, `merge_history`, `storage_locations`) | `/ops` → Smart Inventory + Review Queue (admin-gated to k.fietek + joe) | **IN-FLIGHT** | INV-1 schema applied; INV-3 backfill done (3759 inventory_items, 6665 price_history); P3 all 10 RQ PG mirrors verified live (batches 1-4 this session); P1 enum ALTER TYPEs applied live; Task #131 resolved via vanish/DELETE; RQ tool merged to main via PR #136 today; flags OFF |
| **Playbook / OPD** (PG-native: `documents`, `document_relationships`, `document_surfaces`, `document_issues`, plus Sousai chunks) | `/playbook`, `/playbook/admin` | **PG-NATIVE** (never a Sheets cutover) | Built directly on PG via `@/lib/supabase` (not via dataStore dispatch); separate from the migration count |

---

## Smart Inventory — PARKED 2026-06-12

Module 7 (Smart Inventory) and Module 8 (Railway cron) were on track for the four-flag atomic cutover - cutover prerequisites cleared, all 10 RQ PG mirrors verified live. Parked instead.

**Why parked:** prototype #1 was over-built. 700 of 893 review_queue rows were arithmetic_fail (PACK/Cases conflation). The v2 vision is **queries-over-facts**: no cron, no batch matching pass, no review queue - inventory views computed on demand from OCR'd line-item facts. Each item is "a creature with a profile" - aggregated identity built from its facts. Full reasoning in [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md).

**What "parked" means in practice:**
- Code stays running as-is; the cron continues writing PG nightly (data accumulates as input for v2).
- The legacy `/ops` monthly-count flow stays on Sheets and keeps serving real submissions until SI v2 absorbs the use case.
- No active development; no migration in either direction.
- Fate decided when SI un-parks (likely a queries-over-facts rebuild + Module 8 retirement).

The previously-listed Smart Inventory cutover gates are no longer applicable - the four-flag flip will not happen. See [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) §C.3 for the parking decision detail.

---

## Remaining roadmap — dispositions (2026-06-12)

The migration project closed 2026-06-12. The dispositions below replace the prior "sized roadmap" - they're decisions about each remaining item, not engineering scope estimates. Full reasoning in [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) §D.

### Service Calendar — MIGRATE (the one genuine migration remaining)

- **Disposition:** migrate as a standalone project when prioritized
- **Why:** real, used (97 service_config rows + ongoing day-level writes, 10 wired actions, no stubs)
- **Why "standalone project" and not "more migration debt":** per-account year-grid + year-coded tab shape (`Projections - 2026`, `Actuals - 2026`, `Clicker Counts - 2026`) doesn't map cleanly to PG. It's a real schema design problem - grid-shape to event-row normalization + an annual tab-rotation operational concern - not a swap. Worth its own scoped effort.
- **Current state:** [`src/app/api/service-calendar/route.js`](../src/app/api/service-calendar/route.js) (~800 lines post sc-17 additions), the `dataStore/serviceCalendar.js` orchestrator (danger zone), 17+ live migrations sc-1 through sc-17b powering `sc_service_prices`, `sc_daily_revenue`, `sc_homestand_schedule`, `sc_phase_calendar`, etc. **Note (2026-07-12):** significant PG activity has landed since this doc's original "no orchestrator, no PG schema" wording; the SC module is now materially PG-backed for the schedule + phase subsystems + pricing. Canonical architecture ref: [`modules/SERVICE_CALENDAR.md`](modules/SERVICE_CALENDAR.md). Shipped-state + remaining work: [`SC_STATUS.md`](SC_STATUS.md). This close-out disposition ("migrate as standalone project") is still the framing for the remaining Sheets-side portions; the SC migration is a rolling effort landing per-subsystem.

### Labor / Season Planner — LEAVE ON SHEETS, rebuild next year

- **Disposition:** leave on Sheets; rebuild on PG when the annual labor cycle gets attention
- **Why:** migration is half-redesign anyway (same per-account year-grid shape as Calendar). The labor tool will likely be redesigned as part of the annual financial cycle - better to rebuild on PG fresh than migrate-then-redesign.
- **Current state:** lives inside [`src/app/api/ops/route.js`](../src/app/api/ops/route.js) monolith (1238 lines, 16+ actions), writes `labor_plans` (24 rows), `labor_sold_revenue` (12), `deep_clean_days` (0) on COLLECTION; reads per-account `Projections - 2026` and `Actuals - 2026` tabs

### Financial — LEAVE ON SHEETS, dies with Labor

- **Disposition:** leave; not a standalone migration target
- **Why:** [`src/app/api/financial/route.js`](../src/app/api/financial/route.js) is 54 lines of pure HTTP proxy to /ops Labor. The real backend is Labor. A standalone /financial backend would be a future build, not a migration.

### Legacy Inventory Count — LEAVE ON SHEETS, retire year-end

- **Disposition:** keep running on Sheets; retire when Smart Inventory v2 absorbs the use case
- **Why:** superseded by Smart Inventory (parked). 37 `inventory_submissions` rows. Single tab, single read action (`inventory-history`), single write action (`submit-inventory`). Migrating something we plan to retire is waste.

### Incidents — LEAVE ON SHEETS, build Supabase-native when prioritized

## Scheduled audits

Operational follow-ups on shipped work. Not engineering items - calendar checkpoints.

### Post-fix audit — invoice-capture-to-PG (week of June 19)

One week after the Module 6 dual-write fix (pr-9-1 + PR #138 + PR #139, shipped 2026-06-12), audit a week of live invoice uploads for zero failures/gaps. Confirm `pg_failed` holds at zero on normal traffic and new uploads land complete (line items + Stage A fields populated in PG). If clean -> invoice-capture-to-PG confirmed done. If a new failure cause appeared, `ai_scan_error` captured it -> fix, then done.

Quick check command: `node --env-file=.env.local scripts/_probe_dual_write_gap_full_history.mjs` (gap probe) + count of `ai_scan_status='pg_failed'` rows over the prior week.

## Remaining work — sized roadmap
- **Disposition:** keep the Sheets code running; rebuild on PG when the feature gets product attention
- **Why:** 0 rows ever submitted. Full submission code path IS built (Drive folder tree + Calendar event + Slack post + email + PDF generation + escalation deadlines per [`src/lib/incidentActions.js`](../src/lib/incidentActions.js)) but never used. No data to migrate, no coverage gap. The external side-effect entanglement is real and needs design before any rebuild.
- **Standing concern:** when the feature returns, design the side-effect coordination first - per CLAUDE.md's Phase-3 note, the dual-write window for incidents would need special handling so side effects don't fire twice. Skip the dual-write window entirely by building Supabase-native from scratch.

### Leadership Dugout — LEAVE ON SHEETS, standalone build-with-migration when returned to

- **Disposition:** defer the whole module
- **Why:** hybrid - WOW Plans wired (~25 rows real data across 4 active tabs) + Cycle Review stubs (15+ unwired action handlers returning `{ todo: action }`). Migrating WOW Plans now + building Cycle Review later means a hybrid module across both stores. Better as one coherent piece when People Portal gets product attention.
- **Current state:** [`src/app/api/people/leadership-dugout/route.js`](../src/app/api/people/leadership-dugout/route.js) (537 lines), 4 helper libs (`performanceChain.js`, `wowPlanActions.js`, `performanceAcl.js`, `performanceActions.js`), all direct Sheets, no orchestrator, no PG schema

### Module 8 — Railway cron (separate repo)

- **Disposition:** parked with Smart Inventory
- **Why:** cron's role (catalog matching) likely goes away in SI v2 (queries-over-facts has no catalog to match against). Decision rides with SI un-parking. Repo: `kitchfix-inventory-cron` (separate from intranet).

### Sheets decommission capability — STANDING GAP

The `cutover.js` control plane has no decommission state. Removing a table from `DUAL_WRITE_TABLES` stops PG writes (state-4 misconfiguration), not Sheets. Real "Sheets becomes frozen backup, PG is sole writer" requires inverted semantics OR a third `FREEZE_SHEETS_TABLES` flag. Not built; not urgent (Sheets quota / reliability isn't a real concern today). Worth fixing only if Sheets becomes a liability.

---

## Known signal noise + small latent bugs (post 2026-06-15 OCR work)

Three items surfaced during the post-fix recovery work that didn't warrant immediate fix but are documented here so they don't get mistaken for new problems.

### (a) Cron recon false-positives on "ai_scan_complete=TRUE with 0 ai_line_items"

The weekend cron recon (in `kitchfix-inventory-cron`) periodically reports invoices in this shape. Investigation on 2026-06-15 confirmed the cron is reading a stale/lagged view of PG: of 6 invoices it flagged that morning, 5 actually had line items in PG (counts 9, 4, 9, 43, 39) - the recon snapshot was just out of date. Only 1 was a true silent gap (a pre-fix 6/8 anomaly that was honest-state-corrected by setting it to `pg_failed`).

**This signal will recur in future weekend digests** until the cron's recon is rewritten. When it does: investigate by reading PG directly (`scripts/_probe_silent_gap_complete_with_zero.mjs` shows the pattern) rather than acting on the recon's claim. Real silent gaps would show `complete` + PG=0 AND Sheets=0; recon-stale ones show populated stores.

Fix lives in the cron repo. Low priority - the false positives are just noise in the digest, not a production problem.

### (b) Rescan canary's post-flight Sheets count reads with the wrong uuid

`scripts/_rescan_silent_gap.mjs` correctly passes `sub.client_uuid` to `extractAndStoreLineItems` (fixed 2026-06-13 in the sub.id-vs-client_uuid bug cleanup), but its post-flight verification at line ~366 reads Sheets with `String(r[0]).trim() === sub.id`. Read-side version of the same identifier bug. Result: the canary's "Sheets ai_line_items: 0" in the post-flight output is unreliable - it under-reports when the write actually succeeded.

The 2026-06-15 rescans of `5a447c0a` and `29c8ff9f` both printed "Sheets=0" in the canary output, but the orchestrator wrote Sheets unconditionally before any errors could occur, so the rows are there.

Fix: one-line change in the canary, swap `sub.id` to `sub.client_uuid` in the Sheets filter. Low priority because PG count is the load-bearing post-flight signal and that one IS correct.

### (c) f098571f Cheney Brothers has 18 Sheets rows vs 9 PG rows

A single invoice from 2026-06-11 has Sheets/PG imbalance: 18 Sheets rows but only 9 in PG. Likely a pre-fix artifact from an extraction that failed half-way and then retried, leaving Sheets duplicated. Not a silent gap (both stores have data), just unequal. Low priority cleanup target if Sheets/PG parity ever becomes important for this single invoice.

### (d) `appendRowsSA` swallow-failure shape in 3 other dual-write modules

`src/lib/sheets.js:146` `appendRowsSA` catches Sheets API errors and returns `{success:false, error}` instead of throwing. The invoice line-item path (`insertAILineItemsSheets` at `src/lib/dataStore/invoice.js:673`) was fixed in 2026-06-17 to check the return and throw, after the inverse silent-gap surfaced as PG-rows-with-no-Sheets-rows during the post-OCR-outage rescan. Three other production callers have the same swallow-failure shape and were NOT touched:

- `src/lib/dataStore/inventory.js:667` — `submitCountSessionSheets` (monthly count submit)
- `src/lib/dataStore/directory.js:726` — `replaceContactsForAccount` (per-account contacts replace)
- `src/lib/dataStore/shared.js:162` — generic replace-pattern primitive (foundation for additional modules)

Same bug shape: a Sheets API transient (rate limit, 5xx, network) is caught, message is `console.error`'d, function returns `{success:false}`, caller awaits and proceeds. For count/contacts this means the operation looks successful to the user but the row never lands in Sheets; depending on dual-write flag state, PG may or may not get the row, so either silent data loss OR silent drift.

The invoice fix used Option B (narrow: check the return only in the invoice path) because the other 3 modules weren't audited for what surfacing failures would do to their UX/flow. Follow-up audit needed: for each of the 3, decide whether to (i) check the return locally (mirroring the invoice fix), or (ii) make `appendRowsSA` itself throw (broader fix, fixes all callers including any future ones). Has not happened in production to date as far as we know; surfaced today only because 4 fresh subprocesses raced on the same spreadsheet during recovery. Sequential live traffic would rarely trip it. Not urgent but worth closing before a similar concurrency event surfaces it.

Related: the m6 migration's `COMMENT ON COLUMN invoice_submissions.ai_scan_error` says "NULL on Sheets-only OCR failures" — that comment became inaccurate when the invoice-side fix shipped (Sheets failures now capture cause). No data migration needed; comment is stale only. Update if/when the m6 migration is touched for another reason.

---

---

## Surface-to-module map (reference table)

Every intranet surface (route) → which module/data-store it's driven by → current effective state. Includes Pass-2 clarifications.

| Surface | Route | Module / data store | Effective state |
|---|---|---|---|
| Home dashboard | `/` | M1 News (PG) + Celebrations (Sheets) + ToolsGrid (config) + WeatherBadge | Mixed: PG for news interactions, Sheets for the rest |
| Directory | `/directory` | M2 Directory (PG) | **CUT OVER** |
| People hub — Dashboard view | `/people` → `dashboard` | DashboardView; reads `refreshHistory()` → `/api/people` → M3 submissions (PG) + incidents (Sheets) for counts | Mixed |
| People hub — **Action Center** (the `activity` view, name resolved Pass-2) | `/people` → `activity` | `<ActionCenter>` component; reads M3 submissions history | **CUT OVER** (M3, PG) |
| People hub — New Hire Wizard | `/people` → `newhire` | M3 submissions for the write; localStorage for drafts | **CUT OVER** (M3, PG) for the submit |
| People hub — Personnel Action Form | `/people` → `paf` | Same as New Hire | **CUT OVER** (M3, PG) for the submit |
| People hub — **Incidents** | `/people` → `incidents` | IncidentTool; reads + writes Sheets directly via `/api/people` against `SHEETS.INCIDENTS` | **LEAVE ON SHEETS** (0 rows ever submitted; rebuild Supabase-native when prioritized — see [`CLOSEOUT`](MIGRATION_PROJECT_CLOSEOUT.md) §D) |
| People hub — Leadership Dugout | `/people` → `leadership-dugout` | LeadershipDugoutTool; reads + writes via `/api/people/leadership-dugout` (Sheets direct) | **LEAVE ON SHEETS** (hybrid: WOW Plans wired + Cycle Review stubs; rebuild as one piece — see CLOSEOUT §D) |
| People hub — Admin queue | `/people` → `admin` | Mixed: M3 submissions actions + Sheets for incidents | Mixed |
| Ops hub — home | `/ops` → `home` | OpsHome card grid (display only) | n/a |
| Ops hub — Inventory (LEGACY monthly count) | `/ops` → `inventory` | InventoryTool; reads + writes `inventory_submissions` tab on COLLECTION via `/api/ops` (Sheets direct) | **LEAVE ON SHEETS** — retire when SI v2 absorbs the use case (see CLOSEOUT §D) |
| Ops hub — **Smart Inventory + Review Queue** (admin-gated) | `/ops` → `inv-manager` | InventoryManager + ReviewQueueScreen; reads + writes via `dataStore.inventory` (8 PG mirrors present, flags OFF) | **PARKED 2026-06-12** (queries-over-facts v2 vision — see [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md)) |
| Ops hub — Labor / Season Planner | `/ops` → `labor` | LaborTool; reads + writes 7 Sheets tabs via `/api/ops` | **LEAVE ON SHEETS** — rebuild next year (see CLOSEOUT §D) |
| Ops hub — Invoices | `/ops` → `invoices` | M6 Invoice (PG) | **CUT OVER** |
| Ops hub — Vendors | `/ops` → `vendors` | M5 Vendor (PG) | **CUT OVER** |
| Ops hub — Executive | (no `/ops` route; component live on `/financial`) | `<ExecutiveDashboard>` — pure presentation component; data via labor-bootstrap (Sheets) | Rides labor's data pipe |
| Financial | `/financial` | FinancialTool; calls `/api/ops` directly (proxy `/api/financial` exists but unused) | **LEAVE ON SHEETS** — dies with Labor (see CLOSEOUT §D) |
| Service Calendar | `/service-calendar` | ServiceCalendar; reads + writes Sheets via `/api/service-calendar` | **MIGRATE** as standalone project when prioritized — the one genuine migration remaining (see CLOSEOUT §D) |
| Playbook | `/playbook` | OPD docs + Sousai search; reads from PG via `getServiceClient` direct (not via dataStore) | **PG-NATIVE** (never lived in Sheets) |
| Playbook admin | `/playbook/admin` | Same as above | **PG-NATIVE** |

### Pass-2 clarifications worth surfacing

- **"Action Center" = the `activity` view** in People. Not a separate surface. PG cut over via M3.
- **Sousai is a library, not a page.** `src/lib/sousai/*` is the AI search backend used by `/api/playbook`. There's no `/playbook/sousai` route.
- **`/financial` is a labor passthrough.** The data layer is 100% the `/api/ops` labor-bootstrap pipe; the proxy file exists but is bypassed. Migrating labor migrates financial.
- **`/ops/executive`** is **not inert** despite a parked comment in `/ops/page.js`. The component is live on `/financial` (mounted by FinancialTool). It's a pure presentation component, no fetch of its own.

---

## Doc accuracy note

The 2026-06-11 audit found significant staleness across status-describing docs. The 2026-06-12 close-out resolved most of that drift:

- **`CLAUDE.md`** updated 2026-06-12 - current-state section rewritten, danger zones refreshed, findings cleaned up
- **`docs/PROJECT_DASHBOARD.md`** archived 2026-06-12 to `docs/archive/PROJECT_DASHBOARD_2026-05-28.md` (session log style; fully superseded by this doc + the close-out)
- **`docs/ARCHITECTURE.md`** updated 2026-06-12 - data layer section rewritten to reflect Sheets + PG dual reality, module map drift fixed, cron status updated
- **`docs/modules/INVENTORY_MODULE.md`** rewritten 2026-06-12 to reflect parked state + the queries-over-facts v2 vision

When updating any future doc that touches migration status:
- For state claims that drift quickly (migration progress, module counts), point at this file instead of describing them locally.
- For stable framing (architecture patterns, conventions, design principles), update in place.
- The close-out doc is the project handoff; this doc is the live current-state.

---

## See also

- [`MIGRATION_PROJECT_CLOSEOUT.md`](MIGRATION_PROJECT_CLOSEOUT.md) — the project handoff (decisions, dispositions, patterns + lessons, how to resume)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current architecture (Sheets + PG dual data layer, auth boundary, module map)
- [`modules/INVENTORY_MODULE.md`](modules/INVENTORY_MODULE.md) — Smart Inventory parked state + v2 queries-over-facts vision
- [`MODULE_7_INV-2_PLAN_CORRECTION.md`](MODULE_7_INV-2_PLAN_CORRECTION.md) — INV-2 cutover prerequisites (historical reference; SI parking superseded this plan)
- [`MIGRATION_APPROACH.md`](MIGRATION_APPROACH.md) — operating mode (fast-as-safe) and the agent/Kevin workflow
- [`FINANCE_STACK_PLAN.md`](FINANCE_STACK_PLAN.md) — the original 12-PR scope (executed through Module 6; remainder superseded by the close-out dispositions)
- [`src/lib/cutover.js`](../src/lib/cutover.js) — the control plane itself
