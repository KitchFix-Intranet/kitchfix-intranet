# KitchFix Intranet — Migration Status (canonical)

**Last verified:** 2026-06-11
**This is the canonical current-state doc.** Other docs should point here for migration status rather than describing it themselves. The 2026-06-11 doc audit established that status claims scattered across `CLAUDE.md`, `PROJECT_DASHBOARD.md`, `ARCHITECTURE.md`, and the module READMEs drift in parallel — this file consolidates one verified source.

---

## Executive summary

The intranet is **mid-migration from Google Sheets to Supabase Postgres**, executed as a strangler-fig dual-write/per-module cutover. As of 2026-06-11:

- **6 of 8 modules cut over** to PG with dual-write to Sheets as rollback net (News, Directory, People-submissions, Vendor, Invoice, Playbook).
- **Module 7 Smart Inventory is in flight** — schema + backfill complete, all PG mirrors verified live across batches 1-4 this session, RQ tool merged via PR #136 today (admin-gated, Sheets-only until the final cutover). Code-ready for the §3 four-flag atomic cutover.
- **The remaining tail** (Labor, Incidents, legacy monthly-count, Financial, Service Calendar, Module 8 cron, and the unbuilt Sheets-decommission capability) is enumerated below with verified scope.

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

## Smart Inventory cutover — exact remaining gate

The Module 7 cutover is the §3 four-flag atomic flip per `docs/MODULE_7_INV-2_PLAN_CORRECTION.md`. **The four flags must flip together — they cannot be staged.**

### Why atomic (from the plan correction, §3)

- `resolveReviewQueueMatch` fires its PG writes if ANY of `review_queue` OR `item_aliases` OR `price_history` flag is on.
- `resolveReviewQueueLine` fires its PG writes if ANY of `review_queue` OR `ai_line_items` flag is on.
- `review_queue` appears in both gates, so the two gates share a flag.

Flipping any subset causes PG writes to tables whose own flags are still off, splitting a single resolve action across a half-migrated surface — the exact silent-divergence failure mode this project exists to prevent.

### Cutover prerequisites — all cleared

| Gate | Status |
|---|---|
| §2a P1 — enum `ALTER TYPE`s for `manual_resolve` / `manual_resolve_reverted` | ✓ applied live to Supabase via Studio |
| §2a P2 — four-bug arithmetic-fail INSERT fix in `resolveReviewQueueLinePostgres` | ✓ shipped via PR #136 |
| §2a P3 — all 10 RQ mirrors (8 PG + 2 Sheets reversers) verified live | ✓ via batches 1-4 sentinel-row probes this session |
| Task #131 — PG-vs-Sheets revert parity decision (vanish via DELETE) | ✓ resolved, shipped via PR #136 |

### Remaining gates before flag flip

1. **Cron-side mop** — one-time cleanup of the existing PG.inventory_items duplicate population (~73 PG groups / 88 excess rows as of last probe). The Bug 1 cron fix (cron commit `e73ff43`) stops new dups from being produced; the existing population needs a separate cleanup pass before cutover so the post-flip PG state is clean.
2. **48h coverage probe** — `scripts/_probe_dup_coverage_split.mjs` runs against the cron's nightly output. Need 1-2 clean nightly runs post-Bug-1-fix to confirm dup-group count stops growing. Re-run 2026-06-12 morning + 2026-06-13 morning to close.

### Not a gate (clarification)

The **legacy `/ops` monthly-count flow is SEPARATE from Smart Inventory** — distinct Sheets tab (`inventory_submissions` on `SHEET_IDS.COLLECTION`), distinct spreadsheet, distinct data layer (direct `appendRowSA` in `/api/ops`, not via `dataStore.inventory`). Migrating Smart Inventory does NOT involve the monthly-count flow. See the roadmap item below for the legacy monthly-count decision.

---

## Remaining work — sized roadmap

Ordered by what's gated on what. Sizing estimates are based on the per-surface Pass-2 deep-trace.

### 1. Smart Inventory four-flag cutover

- **State:** code-ready, P3 complete
- **Gated on:** cron-side mop + 48h cron coverage probe (2026-06-12 + 2026-06-13 nightly runs)
- **Work:** flip 4 flags atomically in Vercel env (`DUAL_WRITE_TABLES` += `review_queue,ai_line_items,item_aliases,price_history` → no-cache redeploy → smoke test → add same 4 to `READ_FROM_POSTGRES_OPS` → no-cache redeploy → 24-48h wait window). Operational scheduling, not engineering.

### 2. Leadership Dugout — QUICK

- **State:** Sheets-only display tool (read-only)
- **Scope:** Repoint reads to PG. No writes. No backfill (data already in PG via M3 submissions if applicable, or shared tabs already cut over).
- **Est:** ~2-4h. Likely small enough to batch with another module.

### 3. Financial — AUDIT-FIRST

- **State:** Pass-2 found `/api/financial/route.js` is a 53-line proxy to `/api/ops` that is **currently unused** — the frontend (`FinancialTool.js:10-12`) calls `/api/ops` directly per `const API = '/api/ops'`. The proxy was created in anticipation of a backend split that never happened.
- **Decision needed:** retire the dead proxy scaffolding, OR build the actual `/api/financial` split before touching data. Migrating `/financial` data effectively means migrating Labor (same data pipe).
- **Not a straight migration** — needs a routing-architecture decision first. Est dependent on direction.

### 4. Labor / Season Planner — BIG (~15-25h)

- **State:** Pure Sheets, 7 tabs across 2 spreadsheets, 3 write paths
- **Reads:** `SHEET_IDS.HUB / accounts / period_data / homestand_schedule / labor_budgets` + `SHEET_IDS.COLLECTION / labor_plans / deep_clean_days / labor_sold_revenue`
- **Writes:** `appendRowSA` to `labor_plans`, `labor_sold_revenue`, `deep_clean_days` (all append-only)
- **Scope:** 3-5 new PG tables, ~5 new dataStore orchestrators, multi-year backfill of `labor_plans`. `accounts` already PG; `period_data` and `homestand_schedule` are reference data.
- **Side effects:** None — append-only data, no Drive/Calendar/Slack entanglement.
- **Brings along for free:** `/financial` (same data pipe) + `/ops/executive` (the ExecutiveDashboard component reads labor-bootstrap data via FinancialTool).
- **Est:** ~15-25h by analogy to M5/M6 cutover playbook. Bigger than Vendor (3 tabs), comparable to Invoice in scope.

### 5. Incidents — HARD, NOT QUICK (~15-25h)

**Common misconception to correct:** the existing doc references say *"incidents structure-only EMPTY per audit"* — this is sometimes read as "PG schema already exists, just needs backfill, will be quick." That is **wrong**.

- **State:** PURELY Sheets — 6 read sites + 1 append + multiple cell updates in `/api/people/route.js` against `SHEETS.INCIDENTS` on `SHEET_IDS.COLLECTION`. **NO `dataStore/incident.js` exists.** No dormant adapter, no orchestrators. The "PG schema" referenced in audits is a design artifact in the Sheets audit, never built or applied.
- **Hard part:** external side-effect entanglement, NOT data volume. An incident submission fires: Drive folder tree creation, Drive file uploads, Calendar event creation (`createIncident30DayEvent`), Slack notifications, Gmail send, PDF generation with `pdf-lib`, SOP escalation deadline computation. Status transitions fire additional Slack + Calendar updates. The row stores Drive folder ID, Drive URL, PDF URL, escalation timestamp, calendar event ID — coupled across 4 external systems.
- **Migration complexity:** the dual-write window needs special handling so side effects don't fire twice. Either (a) gate side effects on a single canonical-store flag separate from the data dual-write, or (b) make side effects idempotent enough to fire on each store-write, or (c) accept a "Sheets-side fires side effects, PG-side just mirrors data" asymmetry during the window. Each option has design implications worth a dedicated audit before the schema PR.
- **Est:** ~15-25h covering the design audit + schema + dormant adapters + handler rewire + backfill + cutover. The side-effect coordination work alone is comparable to a small module.

### 6. Legacy `/ops` monthly-count — DECIDE FIRST

- **State:** Sheets-only, distinct from Smart Inventory. Single tab (`inventory_submissions` on COLLECTION), 13-column shape (5 dollar amounts per period per account: food/packaging/supplies/snacks/beverages totals + notes), 1 read site (`inventory-history` GET), 1 write site (`submit-inventory` POST).
- **Question:** does Smart Inventory **supersede** this flow? Smart Inventory does item-by-item per-zone counts; legacy monthly-count is per-category dollar totals. If Smart Inventory's eventual count-submit flow rolls up to those totals, the legacy flow is redundant and should be retired, not migrated.
- **Decision needed BEFORE migrating:** confirm whether the legacy 5-totals flow has any users today, and whether Smart Inventory will produce the same totals as derived rollups.
- **Est:** ~3-5h **IF** migrated (single-tab append-only, trivial). **0h** if retired. Make this a conscious decision before doing the work.

### 7. Service Calendar — LAST

- **State:** Pure Sheets, deliberately deferred per `docs/PROJECT_DASHBOARD.md` recommended-sequence item 11 (*"defer service-calendar/performance/GL_CODES"*)
- **Rationale for deferral:** complex multi-day schedule data with day-level config + actuals, lower-traffic surface
- **Est:** unscoped. Defer until Labor and Incidents are done.

### 8. Module 8 — Railway cron (separate repo)

- **Repo:** `kitchfix-inventory-cron` (parallel to the intranet)
- **State:** Sheets-only writes today. Cron processes invoice line items and writes to `item_catalog` (Sheets) per the legacy schema.
- **Gated on:** Smart Inventory going live (the cron needs to write to PG via the same dataStore dispatch the intranet uses). The cron's read of PG is what makes Sheets decommission-able for Smart Inventory tabs.
- **Est:** unscoped; spans the cross-repo boundary. Per the migration order, this is the last engineering work before the migration arc is "done."

### 9. Sheets decommission capability — UNBUILT

The control-plane gap noted above. Today no module can flip Sheets writes OFF — the code lacks the mechanism. Real "Sheets becomes frozen backup, PG is sole writer" requires:
- inverted orchestrator semantics, OR
- a third flag (`FREEZE_SHEETS_TABLES` or equivalent)
- plus per-orchestrator audit to confirm no behavior depends on Sheets-being-written

**Est:** ~6-10h for the code change + per-module verification, deferred until the cron is migrated and the Sheets quota / reliability becomes a real concern (it isn't today).

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
| People hub — **Incidents** | `/people` → `incidents` | IncidentTool; reads + writes Sheets directly via `/api/people` against `SHEETS.INCIDENTS` | **NOT STARTED** (Sheets-only; no dormant adapter) |
| People hub — Leadership Dugout | `/people` → `leadership-dugout` | LeadershipDugoutTool; reads via `/api/people/leadership-dugout` (Sheets direct) | **NOT STARTED** (Sheets-only read-only) |
| People hub — Admin queue | `/people` → `admin` | Mixed: M3 submissions actions + Sheets for incidents | Mixed |
| Ops hub — home | `/ops` → `home` | OpsHome card grid (display only) | n/a |
| Ops hub — Inventory (LEGACY monthly count) | `/ops` → `inventory` | InventoryTool; reads + writes `inventory_submissions` tab on COLLECTION via `/api/ops` (Sheets direct) | **NOT STARTED** (Sheets-only) — *decision pending: replace vs migrate* |
| Ops hub — **Smart Inventory + Review Queue** (admin-gated) | `/ops` → `inv-manager` | InventoryManager + ReviewQueueScreen; reads + writes via `dataStore.inventory` (8 PG mirrors present, flags OFF) | **IN-FLIGHT** (Sheets-only effective behavior until four-flag cutover) |
| Ops hub — Labor / Season Planner | `/ops` → `labor` | LaborTool; reads + writes 7 Sheets tabs via `/api/ops` | **NOT STARTED** (Sheets-only) |
| Ops hub — Invoices | `/ops` → `invoices` | M6 Invoice (PG) | **CUT OVER** |
| Ops hub — Vendors | `/ops` → `vendors` | M5 Vendor (PG) | **CUT OVER** |
| Ops hub — Executive | (no `/ops` route; component live on `/financial`) | `<ExecutiveDashboard>` — pure presentation component; data via labor-bootstrap (Sheets) | Rides labor's data pipe |
| Financial | `/financial` | FinancialTool; calls `/api/ops` directly (proxy `/api/financial` exists but unused, see Roadmap §3) | **NOT STARTED** (rides labor pipe; needs proxy decision first) |
| Service Calendar | `/service-calendar` | ServiceCalendar; reads + writes Sheets via `/api/service-calendar` | **NOT STARTED** (deferred) |
| Playbook | `/playbook` | OPD docs + Sousai search; reads from PG via `getServiceClient` direct (not via dataStore) | **PG-NATIVE** (never lived in Sheets) |
| Playbook admin | `/playbook/admin` | Same as above | **PG-NATIVE** |

### Pass-2 clarifications worth surfacing

- **"Action Center" = the `activity` view** in People. Not a separate surface. PG cut over via M3.
- **Sousai is a library, not a page.** `src/lib/sousai/*` is the AI search backend used by `/api/playbook`. There's no `/playbook/sousai` route.
- **`/financial` is a labor passthrough.** The data layer is 100% the `/api/ops` labor-bootstrap pipe; the proxy file exists but is bypassed. Migrating labor migrates financial.
- **`/ops/executive`** is **not inert** despite a parked comment in `/ops/page.js`. The component is live on `/financial` (mounted by FinancialTool). It's a pure presentation component, no fetch of its own.

---

## Doc accuracy note

The 2026-06-11 MD audit pass found significant staleness across the existing status-describing docs:

- **`CLAUDE.md`** still frames the work as "Phase 3 = Pending, starting with Incidents." Pre-migration framing; broken pointers to archived `MIGRATION.md`, `SPEC_INTRANET_AI_SEARCH.md`, `TEAM_KNOWLEDGE.md`.
- **`docs/PROJECT_DASHBOARD.md`** header dated 2026-05-28, status line says "3 modules cut over / NEXT: Module 4 TBD." Body has PR descriptions through ~#99 but the front matter reads as if Modules 4-7 haven't happened.
- **`docs/ARCHITECTURE.md`** "Last verified 2026-05-05," describes the database as Google Sheets without mentioning PG.
- **`docs/modules/INVENTORY_MODULE.md`** says "Pre-Module-7. Work not started." Module 7 is in flight.
- **`README.md`** module table predates the migration.

These need follow-up update or supersedes-by-pointer fixes. Until they're reconciled, **this file is the canonical current-state truth**. Other docs should point here for status rather than describing it themselves.

When updating those docs:
- For state claims that drift quickly (migration progress, module counts), replace with a pointer to this file.
- For stable framing (architecture patterns, conventions, design principles), update in place.
- Use the supersedes-by-pointer pattern (proven on `docs/MODULE_7_DATA_AUDIT.md` PART 4 → `MODULE_7_INV-2_PLAN_CORRECTION.md`) when full rewriting isn't worth it.

---

## See also

- `docs/MODULE_7_INV-2_PLAN_CORRECTION.md` — INV-2 cutover prerequisites + §3 four-flag atomic constraint
- `docs/architecture/CUTOVER_PLAYBOOK.md` — canonical cutover procedure (validated across M5/M6)
- `docs/MIGRATION_APPROACH.md` — operating mode (fast-as-safe, still authoritative)
- `docs/FINANCE_STACK_PLAN.md` — the original 12-PR scope (mostly executed; reference for remaining M7/M8)
- `src/lib/cutover.js` — the control plane itself
