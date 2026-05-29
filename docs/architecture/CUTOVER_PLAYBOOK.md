# Cutover Playbook

> Canonical procedure for cutting a module from Sheets read/write to Postgres read/write in the KitchFix Ops Hub Sheets-to-PG migration. Follow this sequence in order. Departures from this sequence are caught at code review.

**Tier**: 1 (Architectural). First doc under `docs/architecture/`.

**Established**: 2026-05-29, after Module 5 (Vendor) cutover sealed and Module 6 (Invoice) PR 6.1 + 6.2 shipped. Distilled from the cutover histories of Modules 1, 2, 3, and 5; Module 6 PR 6.3 will be the first cutover executed against this playbook.

---

## When to use this playbook

- **Use it for**: cutting over an existing module from Sheets-as-source-of-truth to Postgres-as-source-of-truth. The pattern assumes the module has a Sheets ancestry that needs preserving plus a target PG schema.
- **Use it for**: new module rollouts that follow the same dual-write -> read-flip pattern (no Sheets ancestry, but the same cutover risk profile).
- **Does NOT apply to**: greenfield PG-only features with no Sheets-side counterpart and no rollback target. Those skip the dual-write window entirely.

## Pre-cutover prerequisites

The module must have completed the prep PRs in order before this playbook starts:

- **X.1** Schema + dormant adapters PR. Creates the PG tables. Adds orchestrators in `src/lib/dataStore/<module>.js` with both Sheets and PG adapters. Dual-write flag OFF. No handler calls yet.
- **X.2** Handler rewire PR. Replaces every Sheet I/O call site in the module's handlers with orchestrator calls. Passes `module: "<name>"` at every orchestrator call site (see Lesson 1 below). Dual-write flag still OFF. Behavior is byte-equivalent to pre-X.2 with flags off.
- **X.3** Backfill + cutover PR (THIS playbook covers X.3 execution).

If any prep PR is missing, STOP. Cutover is not ready. The expected sequence is X.1 -> X.2 -> X.3 with each PR fully merged before the next opens.

Worked example from Module 5:
- PR 5.1 (#87): schema + 8 dormant orchestrators
- PR 5.2 (#88): 13 handler rewires + S1/S2/D1/L8/L9 cleanups, -375 LOC net
- PR 5.3 (#89): 3-table backfill + merge_vendors PL/pgSQL atomicity
- PR #92: module-arg fix discovered mid-cutover (Lesson 1; see below)
- PR #93: revert of debug instrumentation (Lesson 2)
- Module 5 LIVE on Postgres 2026-05-29 with 31 vendors / 54 vendor_accounts / 49 vendor_aliases

---

## The audit-first principle

BEFORE writing any backfill code, run a data audit on the Sheets tables to be migrated. This pattern was established in PR #94 for Module 6 (Invoice). It exists because Module 5's PR 5.3 backfill was blocked at the upsert step by 2 duplicate `(vendor_id, account_key)` pairs in production Sheets that PG's UNIQUE constraint rejected (one a legacy F19b bypass, one a botched-merge artifact). Those took manual cleanup before the backfill could finish. Lesson 3 below.

The audit produces:

- **Row counts by status/category** so the backfill knows what it is loading.
- **Historical artifacts catalog**: rebuilds, orphans, dupes, typos, status-enum drift. Each gets a count and a preservation strategy.
- **Constraint-violating rows that PG would reject**: count and source per violation type.
- **A locked decision list** for the schema PR (status enum mapping, soft-delete handling, FK resolution, etc.).

Use `docs/MODULE_6_DATA_AUDIT.md` as the template structure. Its 8 sections cover executive summary, per-tab findings, cleanups required vs preserved, schema design implications, open questions for Kevin, summary counts, migration sequence impact, and the locked preservation-first architecture.

---

## The is_historical preservation-first doctrine

All backfilled rows get `is_historical = TRUE` and a `data_provenance` tag. Strict integrity constraints are conditional on `is_historical = FALSE` so they apply to new app writes but bypass historical rows.

This pattern was established in PR #94 (Module 6 audit) and ships first in PR 6.1's schema. It is the standard for all Module 6+ cutovers and is recommended for retroactive adoption when Modules 1, 2, 3, 5 see schema revisions.

### Why preservation-first

The 218 row-level artifacts surfaced in the Module 6 audit are real work product, not garbage. The 101 status-enum-drift rows reflect a column whose semantics changed over time; the 138 REBUILD-* line items reflect a 2026-04-03 batch re-extraction; the 71 orphans reflect submissions deleted from Sheets after extraction. Cleaning them means deleting real data. Preserving them with a tag means PG retains 100% of the historical signal while strict-integrity constraints apply only to future writes.

### Pattern: two base columns per table

```sql
is_historical    BOOLEAN NOT NULL DEFAULT FALSE
data_provenance  TEXT    NOT NULL DEFAULT 'app_scan'
                 CHECK (data_provenance IN ('app_scan', 'batch_rebuild', 'manual_entry', 'unknown'))
```

Strict constraints become conditional. Three constraint patterns:

- **Status enum**: `CHECK (is_historical = TRUE OR status IN ('sent', 'returned', 'corrected', 'deleted'))`
- **Partial UNIQUE INDEX**: `CREATE UNIQUE INDEX idx_x ON tab (a, b) WHERE is_historical = FALSE`
- **NOT NULL FK with historical bypass**: `CHECK (is_historical = TRUE OR parent_id IS NOT NULL)`

Reads do NOT default-filter by `is_historical`. Historical rows are real data; they appear in history, admin queues, dedup checks, and reports. Callers needing a specific slice pass `opts.scope = 'all'` (default) | `'historical'` | `'current'`.

Reference: `docs/MODULE_6_DATA_AUDIT.md` Section 8 for the full pattern, rationale, per-table effects, tradeoffs, and future cleanup path. A dedicated `docs/architecture/IS_HISTORICAL_PATTERN.md` is planned post-Module-6 cutover.

---

## The cutover sequence

13 steps. Each step states: what it does, who runs it, how to verify, what goes wrong if you skip it.

### Step 1: Pre-flight

**Who**: Claude Code (CC).

**What**: Verify prep PRs landed. Check `git log` for the X.1 + X.2 merge commits. Confirm the module's orchestrators exist at `src/lib/dataStore/<module>.js` and that handlers in the relevant route file call them with `module: "<name>"` opts. Confirm `DUAL_WRITE_TABLES` and `READ_FROM_POSTGRES*` for this module are not yet set in Vercel.

**Verify**: clean prep-PR history, `git grep "module: \"<name>\"" src/lib/<handlers>.js` returns hits at every orchestrator call site.

**Skip cost**: discovering mid-cutover that the rewire was incomplete (Lesson 1 territory). Catch it here, not at Step 11.

**Time**: 10 minutes.

### Step 2: Execute audit (if not done)

**Who**: CC produces the audit; Kevin locks decisions.

**What**: Read every source Sheets tab, count rows, catalog drift, identify constraint violations against the planned schema. Output a `docs/MODULE_<N>_DATA_AUDIT.md` following the Module 6 template. Surface open questions for Kevin; lock decisions before X.1 schema PR.

**Verify**: audit doc shipped, Section 8 (locked architecture) populated, X.1 schema PR amended if needed.

**Skip cost**: PG schema constraints surface latent data quality issues at backfill time (Lesson 3). Module 5 was the cost of skipping this step; PR #94 was the response.

**Time**: 2 to 6 hours depending on module size + tab count.

### Step 3: Write backfill script

**Who**: CC.

**What**: Build `scripts/backfill-<module>.mjs` using the shared runner at `scripts/_lib/backfill-runner.mjs`. The runner provides three strategies: `upsert`, `insert-if-empty`, `replace-null-pool`. Choose one per table.

Backfill writes set `is_historical = TRUE` and `data_provenance = '<tag>'` per the audit's per-table mapping. Reuse the audit's row-by-row classification logic (e.g., for Module 6, col N value -> status field + ai_scan_status field + provenance).

For multi-table modules, sequence tables in FK order (parents first). Module 5's order: vendors -> vendor_accounts -> vendor_aliases. Module 6's order: invoice_submissions -> invoice_rejections -> ai_line_items -> gl_codes.

For conflict semantics: `upsert` with `ignoreDuplicates: true` if existing row metadata should be preserved across re-runs (Module 5 alias case); `upsert` with default behavior if backfill is the authoritative writer (Module 5 vendors + vendor_accounts case).

**Verify**: script imports cleanly, includes header check, sidecar reads where needed, validators, post-write count verification.

**Skip cost**: hand-rolled backfill code each PR; bugs in row-count verification; inconsistent provenance tagging.

**Time**: 1 to 3 hours per module.

### Step 4: Dry-run against production Supabase

**Who**: Kevin runs `node --env-file=.env.local scripts/backfill-<module>.mjs` with `--dry-run` flag.

**What**: Dry-run reads production Sheets, transforms rows per the backfill mapping, prints what WOULD be written. No PG writes happen. Output goes to stdout. Captures total row count, per-table row count, per-strategy disposition (insert vs update vs skip-existing), constraint-violation list.

**Verify**: dry-run completes without throwing. Counts align with audit expectations. No surprise "0 rows" or "infinite loop" output.

**Skip cost**: backfill runs live with no preview; bad classification or schema mismatch corrupts PG state in seconds.

**Time**: 1 to 5 minutes per module (depends on Sheets size).

### Step 5: Kevin reviews dry-run output

**Who**: Kevin.

**What**: Eyeball dry-run output for: row count sanity (do the numbers match the audit?), per-tag breakdown (does the provenance distribution match expectations?), constraint-violation list (any unexpected violations?), spot-check the first 3 + last 3 rows in the output for each table (does the field mapping look right?).

**Verify**: Kevin gives go-ahead.

**Skip cost**: bad backfill runs live; rollback is "drop and re-run" which is slow plus carries risk of partial state.

**Time**: 15 to 30 minutes.

### Step 6: Execute live backfill

**Who**: Kevin runs `node --env-file=.env.local scripts/backfill-<module>.mjs --execute`.

**What**: Live writes. Runner prints per-batch progress and a final summary: rows attempted, rows inserted, rows updated, rows skipped, errors. On any error, runner stops and reports state.

**Verify**: final summary shows expected counts. Run a verification script (`scripts/verify-pr-<N>-<module>.mjs` or similar) that re-queries PG and confirms row counts match Sheets.

**Skip cost**: backfill incomplete, dual-write would then write rows that already exist as orphans, dedup logic gets confused.

**Time**: 1 to 30 minutes depending on row count. Module 3 (109 submissions) took ~5 minutes; Module 6 (~6448 rows across 4 tables) projected at ~15 minutes.

### Step 7: Spot-check verification

**Who**: Kevin + CC.

**What**: Pick 3 representative records per table. For each, read the PG row, read the Sheets row, byte-compare key fields. For `invoice_submissions`, compare uuid + timestamp + amount + status. For `ai_line_items`, compare invoice_uuid + line_num + description + extended_price. Mismatches are blockers.

This is also where any `is_historical = TRUE` tagging gets verified. The 3 spot-checks should include at least one "edge case" row from the audit's drift catalog.

**Verify**: 3 record pairs byte-match (or differ only by intended transformations like normalize, COALESCE, etc.).

**Skip cost**: silent backfill bugs land in PG, the read-flag flip surfaces them as "wrong data in production."

**Time**: 30 minutes.

### Step 8: PR open + review + merge

**Who**: CC opens, Kevin reviews + merges.

**What**: The backfill PR ships the backfill script + verification script + cutover-history entry in the module README + `PROJECT_DASHBOARD.md` row + this playbook update if a new lesson emerged.

**Verify**: PR description includes: live backfill counts, dry-run output snippet, 3 spot-check pairs, verification script PASS report, link to module audit + module README + this playbook.

**Skip cost**: cutover that exists only in production with no commit trail; future cutovers cannot learn from this one.

**Time**: 30 to 60 minutes.

### Step 9: Enable DUAL_WRITE_TABLES in Vercel

**Who**: Kevin.

**What**: In Vercel project settings, edit `DUAL_WRITE_TABLES` env var to APPEND this module's tabs. Module 5 appended `vendor_master, vendor_accounts, vendor_aliases`. Module 6 will append `invoice_submissions, invoice_rejections, ai_line_items, gl_codes`. Set on Production + Preview + Development. Then trigger a **redeploy WITHOUT build cache** from the Deployments tab (NOT a normal redeploy; see Lesson 2 below).

**Verify**: Vercel deployment completes. Boot log (if any temp instrumentation is in place) confirms env reached runtime and `isDualWrite("<tab>")` returns true. Otherwise verify by triggering an app write and observing the PG side gain a row.

**Skip cost**: PG writes never happen; the read-flag flip later in Step 11 then reads from an empty PG and breaks production.

**Time**: 5 minutes for the env change + 3 minutes for the no-cache redeploy.

### Step 10: Dual-write smoke test

**Who**: Kevin (in the app) + CC (verifying via Supabase).

**What**: Exercise every write path for the module through the app UI. For each path, after the action lands in Sheets, query PG to confirm the same row landed there. Pay attention to:

- **Insert paths**: a new row appears in PG with the same primary identifier (client_uuid or generated ID) as the Sheets row.
- **Update paths**: an existing PG row gets updated to match the Sheets change.
- **Delete paths** (if soft delete): the PG row's status field flips per the module's soft-delete convention.
- **Idempotency**: re-submitting the same client_uuid does NOT create a duplicate PG row. The orchestrator's F25 dedup signal should return `deduplicated: true` if applicable.

Module 6 (Invoice) writes to exercise: invoice-submit happy path, invoice-submit F25 retry (same uuid), invoice-reject, invoice-unreject, invoice-dismiss-dupe, invoice-delete-dupe with leadership email (soft delete), triggerAIScan happy path, triggerAIScan photo-only.

**Verify**: every write path produces matching Sheets + PG state. Any divergence is a blocker.

**Skip cost**: bugs in the dual-write path surface as "PG state drifted from Sheets" after the read-flag flip, with no rollback path other than disabling DUAL_WRITE_TABLES (which strands the divergence).

**Time**: 30 to 60 minutes.

### Step 11: Flip READ_FROM_POSTGRES_<MODULE> + no-cache redeploy

**Who**: Kevin.

**What**: In Vercel project settings, set the per-module read flag. For Ops Hub modules (vendor, invoice, smart inventory), this is `READ_FROM_POSTGRES_OPS` and you APPEND tabs (the env var is a comma-separated list parsed into a Set; see `src/lib/cutover.js` for the dispatcher).

Module 5 set `READ_FROM_POSTGRES_OPS = vendor_master,vendor_accounts,vendor_aliases`.

Module 6 will append: `READ_FROM_POSTGRES_OPS = vendor_master,vendor_accounts,vendor_aliases,invoice_submissions,invoice_rejections,ai_line_items,gl_codes`.

The per-module flag works via the `module: "<name>"` arg propagation that handlers pass to orchestrators (Lesson 1). Without that arg, `isReadFromPostgres(<tab>, opts.module)` silently falls back to the global flag check and the per-module env var is a no-op.

After setting, trigger a **redeploy WITHOUT build cache**.

**Verify**: visit the app, exercise a read path for the module. The data should still be present + correct. Check Sheets and PG side by side and confirm app served from PG matches what Sheets shows. Pick a recent row (last 24 hours) to confirm it appears in app reads.

**Skip cost**: reads stay on Sheets forever; cutover is not actually done; PG writes accumulate without being read.

**Time**: 5 minutes for the env change + 3 minutes for the no-cache redeploy + 30 minutes for read-side smoke testing.

### Step 12: Wait window

**Who**: Kevin watches; CC available if issues arise.

**What**: Leave the module in dual-write + read-from-PG state for at least 24 to 48 hours before considering any decommission of the Sheets-side path. The wait window catches:

- Edge cases that smoke tests missed.
- Recurring scheduled writes (crons, reminders) that may exercise paths not covered in Step 10.
- User-triggered paths from a wider audience than smoke testing covers.

During the wait window, both Sheets AND PG receive writes (dual-write is still on). Sheets remains the rollback target. If a regression surfaces, flip `READ_FROM_POSTGRES_<MODULE>` off (remove the tab from the env var) and reads return to Sheets immediately; PG state stays preserved for forensic analysis.

**Verify**: end of wait window, zero anomalies surfaced. Module is genuinely LIVE on PG.

**Skip cost**: subtle regressions land in production with no rollback net; debugging them requires reasoning across diverged Sheets + PG state.

**Time**: 24 to 48 wall-clock hours (not work hours).

### Step 13: Document cutover complete

**Who**: CC.

**What**: Update three docs:

- `docs/modules/<MODULE>_MODULE.md`: status header flipped to "Cut over <date> (LIVE on Postgres)"; backfill counts captured; lessons captured in Common pitfalls; full handler reference + invariants section populated if not already.
- `docs/PROJECT_DASHBOARD.md`: Item 11 progress paragraph extended; module's cutover narrative captured (final row counts, mid-flight bugs if any, lessons added).
- This playbook (`docs/architecture/CUTOVER_PLAYBOOK.md`): any new failure mode adds to Common Pitfalls; any new step gets added to the sequence; any new lesson adds to the battle-tested-lessons section.

`DUAL_WRITE_TABLES` for this module STAYS ON indefinitely as the rollback net. There is no urgency to remove it. Documented decommission decision is a separate later PR per the rollback-net design.

**Verify**: docs PR opens, merges, dashboard line item count +1.

**Skip cost**: future cutovers do not benefit from this one's lessons.

**Time**: 30 to 60 minutes.

---

## The three Module 5 cutover lessons (battle-tested)

These three are the load-bearing lessons from the Module 5 (Vendor) cutover. They were captured in PR #93's body and the `PROJECT_DASHBOARD.md` Item 11 narrative. They are the most-likely-to-bite failure modes for future cutovers.

### Lesson 1: Handler call sites MUST pass `module: "<name>"`

**What broke**: at Module 5 cutover Step 11 (flipping `READ_FROM_POSTGRES_OPS`), the env var would have had ZERO effect because the 5 vendor orchestrator call sites in `invoiceActions.js` did not pass the `module` arg. With `opts.module` undefined, `isReadFromPostgres(<tab>, undefined)` silently falls back to checking only the global `READ_FROM_POSTGRES` env var. The per-module flag mechanism is a no-op without the arg.

**How detected**: Kevin set up to flip the env var per the plan, but mid-cutover review of the orchestrator signatures revealed the arg was missing at all 5 sites. Caught BEFORE the env var was set, so no production breakage; the cutover stalled instead.

**How fixed**: PR #92 added `module: "ops"` to:
- `handleInvoiceGet` invoice-bootstrap (`getVendorsForBootstrap`)
- `handleInvoiceGet` vendor-search (`searchVendors`)
- `handleInvoicePost` OCR vendor match (`getVendorsForMatching`)
- `handleVendorList` (`getVendorsForList`)
- `handleVendorGet` (`getVendor`)

5 insertions / 4 deletions. No functional change pre-env-var-set; behavior matched pre-PR-#92 with `READ_FROM_POSTGRES_OPS` empty.

**Prevention for future cutovers**: the handler rewire PR (X.2) MUST audit every orchestrator call site for module arg propagation. Make it a checklist item in the X.2 PR recon. PR 6.2 (Module 6 X.2) did this correctly: `module: "ops"` passed at every one of the 13 invoice handler call sites at the time of the rewire, not retrofitted.

### Lesson 2: Vercel env changes need no-cache redeploys

**What broke**: Module 5 cutover Step 9 (enabling `DUAL_WRITE_TABLES`) appeared to have zero effect. Dual-write debug instrumentation (`isDualWrite` returning true, the PG branch being entered) all proved the code path was correct. But PG remained at 0 rows for hours. The verify script's "0 rows" reports were correct readings of PG; PG actually was empty.

**How detected**: PR #90 added boot-log instrumentation to `cutover.js` that printed the parsed `DUAL_WRITE_TABLES` Set on Lambda boot. PR #91 added 6-point logs inside the PG adapters (ENTRY, PRE-LOOKUP, POST-LOOKUP, PRE-WRITE, POST-WRITE, EXIT). When PR #91 deployed, the new boot logs fired and PG writes started landing. The "fix" was the redeploy itself.

**Root cause hypothesis**: Vercel was serving warm Lambdas with stale module state from a prior failed or cached deploy. The fresh build from PR #90's deploy cold-started all Lambdas, which apparently resolved a state Vercel had been holding. Cached redeploys may not pick up env changes; the env-var registry update reaches the runtime but cached Lambda containers retain a snapshot of pre-change module state.

**How fixed**: not a code fix; an operational rule. The Module 5 instrumentation reverted in PR #93 immediately post-cutover.

**Prevention for future cutovers**: ALWAYS use Vercel's "Redeploy without build cache" option after any env var change. From the Deployments tab, click the three-dot menu on the latest deployment, choose "Redeploy", and CHECK the "Use existing Build Cache" checkbox OFF (or click the explicit "Redeploy without cache" path if available). A normal redeploy may leave warm Lambdas serving stale state. The cost is ~2 to 3 extra minutes of build time per redeploy; the benefit is determinism.

### Lesson 3: PG schema constraints surface latent Sheets data integrity issues

**What broke**: Module 5 PR 5.3 backfill at Step 6 (execute live) hit PG error 21000: "ON CONFLICT DO UPDATE command cannot affect row a second time." Two duplicate `(vendor_id, account_key)` pairs in production Sheets violated the planned UNIQUE constraint:

- **TRU-437 / CIN - OH**: legacy F19b bypass (double-insert that the old client-uuid dedup missed).
- **SAM-470 / STL - FL**: botched-merge artifact. `handleVendorMerge` updates col B `vendor_id` but NOT col A `rowId`, so a merge can leave 2 rows pointing at the same `vendor_id + account_key` pair.

The Sheets-side code never enforced the uniqueness, so the dupes accumulated silently over months. PG's planned UNIQUE constraint surfaced them at the upsert step and blocked the entire backfill batch.

**How detected**: backfill aborted with PG error 21000. Verify script + Sheets read identified the 2 duplicate pairs.

**How fixed**: manual Sheets cleanup. One pair (TRU-437/CIN - OH) was a manual row deletion by Kevin. The other (SAM-470/STL - FL) needed a small orchestrator script that augmented the row's metadata into the keeper before deleting the duplicate. Backfill re-ran clean.

**Prevention for future cutovers**: the audit-first principle (PR #94) is this lesson's preventative response. Schedule a Sheets data audit pass BEFORE schema migration for each module. For Module 6 (Invoice), the audit checked:

- Duplicate `(invoice_number, vendor_id)` pairs (F19a/F19b dedup-constraint violations).
- Orphan rejection rows (rows referencing deleted submissions).
- Partial line item rows (missing required fields).
- Status enum drift (col N values outside the planned enum).

For Module 7 (Smart Inventory), the analogous checks will be:

- Duplicate primary_vendor mappings on items.
- Orphan storage_locations (zones referencing deleted accounts).
- Partial count rows (missing required fields).
- Pack-size dupes within an item.

The audit need NOT clean the data: per the `is_historical` doctrine, Module 6+ migrations preserve violators with `is_historical = TRUE` instead of forcing pre-migration cleanup. Module 5 predates the doctrine, which is why it required manual Sheets cleanup. Future modules following the doctrine accept the cleanup as a backfill-time decision rather than a pre-cutover blocker.

---

## Common pitfalls

Beyond the three lessons above, these patterns have either bitten or come close:

- **Forgetting handler-side filter for soft-deleted rows**. PR 6.2 introduced soft-delete via `status='deleted'` for `invoice-delete-dupe` (replaces the pre-PR-6.2 hard delete). The PG read path returns soft-deleted rows by default. Read-flag flip would surface them in history and admin lists unless the handler filters them out. PR 6.2 added the filter at `invoice-history` + `invoice-admin-list` to preserve the pre-PR-6.2 UX. Watch for this pattern when any module introduces soft delete.
- **Trying to merge cutover PRs out of order**. X.1 -> X.2 -> X.3 is the only valid sequence. Schema must land before adapters can dispatch; handlers must call orchestrators before backfill can write data the handlers will read; backfill must complete before dual-write flag enables. Each PR fully merged before the next opens.
- **Enabling `READ_FROM_POSTGRES_<MODULE>` before dual-write has been on for at least 24 hours**. The wait window (Step 12) is the rollback net. Flipping reads at hour 1 means there is no fallback if a bug surfaces; the Sheets path has not had a chance to fall behind, so reverting reads to Sheets is still safe, but the bug detection signal (Sheets and PG diverging) has not had time to accumulate.
- **Modifying schema in a cutover PR**. Schema changes belong in X.1. Cutover PRs are about backfill + flag flips + verification. If the cutover surfaces a needed schema change, ship a quick X.1.1 schema-only PR before continuing; do not amend the cutover PR to carry schema work.
- **Dropping `DUAL_WRITE_TABLES` entries during cutover**. The dual-write window is the rollback net. Even after read-flag flip, dual-write stays ON for the wait window and indefinitely after unless a separate decommission PR explicitly removes the tab. Module 5's dual-write tabs are still in `DUAL_WRITE_TABLES` as of this playbook's writing. No urgency to remove.
- **Skipping the audit because "this module looks clean"**. Module 5 was projected to be clean and surfaced 2 duplicate pairs. The audit cost is bounded (Step 2 is 2 to 6 hours); the cost of skipping is unbounded (open-ended debugging mid-cutover plus a forced manual cleanup). Always audit.
- **Pre-cleaning data in Sheets to "save the audit time"**. Pre-cleaning is destructive: you cannot un-delete a row you decided was bad. The `is_historical` doctrine (Module 6+) preserves drift in PG with a tag instead, which is reversible. If pre-Module-6 cutovers need historical re-tagging, do it as a PG-side update post-cutover, not a Sheets-side delete pre-cutover.

---

## Module-specific quirks

This playbook covers the generic pattern. For module-specific guidance see:

- **Module 1 (news_interactions)**: cut over 2026-05-27. Single table. No `is_historical` (predates the pattern). Captured in `PROJECT_DASHBOARD.md` Item 11. No dedicated module README.
- **Module 2 (directory)**: cut over 2026-05-27. 4 tables. No `is_historical`. The col-G preservation pattern in `replaceContactsForAccount` is the precursor to provenance tagging.
- **Module 3 (People Portal submissions)**: cut over 2026-05-27. PR D drift-fix is the canonical case for orchestrator-level timestamp coordination (per-adapter `new Date().toISOString()` calls produced ~226ms drift; fix stamps event-moment ONCE before dispatching to both adapters; one historical row carries the artifact).
- **Module 5 (Vendor)**: `docs/modules/VENDOR_MODULE.md`. Cut over 2026-05-29. 3 tables, 31 / 54 / 49 rows. Three lessons captured (above). Backfill required manual Sheets cleanup of 2 duplicate pairs (predates `is_historical`).
- **Module 6 (Invoice)**: `docs/modules/INVOICE_MODULE.md`. PR 6.1 + 6.2 shipped 2026-05-29. PR 6.3 (cutover) is the first cutover executed against this playbook. 4 tables, projected ~6448 rows. Will be the first cutover using the `is_historical` doctrine.
- **Module 7 (Smart Inventory)**: `docs/modules/INVENTORY_MODULE.md` (placeholder). Pre-Module-7. Not yet scoped to PR-level.

---

## Cross-module dependencies during cutover

If the module being cut over depends on another module's data, the read-flag flip for the dependent module reads from the dependency module's current state. Module 6 (Invoice) reads from Module 5 (Vendor) via `getVendorsForBootstrap`, `searchVendors`, `getVendorsForMatching`. Because Module 5 is already LIVE on PG, Module 6's reads of vendor data via these orchestrators come from PG even before Module 6 itself cuts over (the `module: "ops"` arg routes through `READ_FROM_POSTGRES_OPS` which already includes vendor tabs).

This means: cross-module reads work transparently AS LONG AS each module passes `module: "<consumer>"` correctly. The arg is the consumer's name, not the source table's module. Module 6 handlers pass `module: "ops"` whether they read invoice tables (their own) or vendor tables (Module 5's).

When sequencing cutovers, run the migration order in dependency order so a module's deps are LIVE on PG before that module's own reads flip. The dependency-ordered migration order from the audit synthesis: Incidents -> Vendors (DONE Module 5) -> Invoices (Module 6 in flight) -> Smart Inventory (Module 7) -> remaining People Portal.

---

## When this playbook needs updating

- **After every cutover**: review with the new lessons fresh. If a new failure mode surfaced, add it to Common Pitfalls. If a new step became necessary, add it to The Cutover Sequence.
- **When the dispatcher mechanism changes** (`src/lib/cutover.js` env var names, dispatch logic, isDualWrite semantics): update the step descriptions that reference those names.
- **When the wait window cadence changes**: Module 5 used a same-day cutover (Steps 9 through 13 within one calendar day). If a future module needs a longer wait window or different verification cadence, document the change here.
- **When the `is_historical` pattern evolves**: this playbook references `MODULE_6_DATA_AUDIT.md` Section 8 as the doctrine source until `docs/architecture/IS_HISTORICAL_PATTERN.md` ships (planned post-Module-6 cutover). When that doc ships, update the section pointers here.

The doc tiering policy applies: any cutover PR (Tier 1) that surfaces a new playbook-worthy lesson MUST update this doc in the same PR. The "Docs updated" list in the PR description should include `docs/architecture/CUTOVER_PLAYBOOK.md` when applicable.

---

## See also

- `docs/SUPABASE_MIGRATION.md` - the strategic long-form migration plan; cutover narrative inputs for Modules 1, 2, 3.
- `docs/MIGRATION_APPROACH.md` - current operating mode (fast-as-safe, replaces capacity-not-speed). Module 6 + 7 cutovers execute under this mode.
- `docs/PROJECT_DASHBOARD.md` Item 11 - current cutover status and migration narrative.
- `docs/MODULE_6_DATA_AUDIT.md` - the template for module-level data audits; Section 8 has the locked `is_historical` doctrine.
- `docs/FINANCE_STACK_PLAN.md` - per-module schema specifications + PR plan.
- `docs/modules/VENDOR_MODULE.md` - Module 5 cutover history; 3 lessons captured in Common pitfalls.
- `docs/modules/INVOICE_MODULE.md` - Module 6 status; pre-cutover (PR 6.1 + 6.2 shipped, PR 6.3 next).
- `src/lib/cutover.js` - the dispatcher implementation; `DUAL_WRITE_TABLES` parsing + per-module read flag composition.
- `scripts/_lib/backfill-runner.mjs` - shared backfill engine; three write strategies + sidecar reads + validators + post-write count verification.

---

## Captain's log

- **2026-05-29** - Initial draft post-Module-5 cutover + PR 6.1/6.2 ship. Distilled from VENDOR_MODULE.md, INVOICE_MODULE.md, MODULE_6_DATA_AUDIT.md, PROJECT_DASHBOARD.md Item 11, and PR #93's body. The 13-step sequence reflects what the 4 prior cutovers actually did, not an aspirational ideal. Module 6 PR 6.3 will be the first cutover executed step-by-step against this playbook; any deviations during PR 6.3 surface as playbook updates in the same PR.
