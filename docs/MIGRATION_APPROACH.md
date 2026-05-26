# Migration Approach - 2026-05-26 Update

> **Status:** Current operating mode for the Sheets to Supabase migration.
> **Updated:** 2026-05-26 (post Stage 1 PR 1 + Sheets audit complete).
> **Supersedes:** the capacity-not-speed pacing assumption from earlier sessions / CLAUDE.md.
> **Companion docs:** `docs/SUPABASE_MIGRATION.md` (strategic long-form plan, still canonical for the "what"), `docs/SHEETS_AUDIT*.md` (LIVE/DEAD/ORPHAN verdicts that drive what migrates).

---

## What changed

After two weeks of Stage 0 close-out and Stage 1 kickoff (28 PRs through 2026-05-22, then 5 PRs in one day on 2026-05-26 including the dual-write scaffolding, backfill script, and complete three-part Sheets audit), the constraint on this migration has shifted.

The old assumption (CLAUDE.md "Capacity, not speed, is the constraint" + MIGRATION.md "if finishing ahead of schedule, the right move is depth, not speed") produced multi-pass audits and per-table caution. That was the right mode when the questions were "what's actually in the sheets" and "is the dual-write pattern safe."

Both questions are now answered:
- **The audit answers "what."** `docs/SHEETS_AUDIT.md` (code side) + `docs/SHEETS_AUDIT_DATA_SIDE.md` (data side) + `docs/SHEETS_AUDIT_SYNTHESIS.md` (cross-reference + verdicts) inventory every read/write and produce per-tab LIVE / UNUSED-LIVE / DEAD / ORPHAN / REFERENCE / SCHEMA-ONLY / EXTERNAL-WRITTEN / BUG / MISLABELED verdicts. The 82-tab count collapses to ~25 LIVE tables of real substance.
- **The dual-write pattern answers "how safely."** Stage 1 PR 1 (`src/lib/supabase.js` + `src/lib/cutover.js` + `src/lib/dataStore.js`) shipped dormant + smoke-tested. The pattern survives merge with flags off and exercises live on the Wednesday cutover.

With those two questions settled, re-asking them per module is gold-plating. The goal shifts from "be exhaustively careful at each step" to "finish the whole intranet migration to Supabase cleanly, before building new features."

**Friday is a progress checkpoint.**

---

## The new mode: fast-as-safe

### KEEP - what makes speed safe (do not drop)

- **Recon before building** - but ONE pass that answers the question, not exhaustive multi-pass re-confirmation.
- **Dual-write** before reading from Postgres. Sheets stays the rollback target through the cutover window.
- **Reversible cutovers** - every read flip is preceded by dual-write proving PG mirror is accurate, and is reversible by flipping the flag back.
- **Verify before flipping reads** - either by a divergence monitor, by comparing post-write counts, or by spot-checking specific records. Never flip reads on assumption.
- **Prove pattern before scaling** - news_interactions is module 1 and proves the pattern live. Don't batch anything before the pattern is proven on a real cutover.
- **Build schema from audit LIVE verdicts, never from sheet structure.** Dead columns / orphan tabs / empty tabs / reference-only columns (e.g. contacts H/I/J Kiosk Emails / Manager / Region) do NOT migrate. See `docs/SHEETS_AUDIT_SYNTHESIS.md` for per-tab verdicts.

### DROP - gold-plating that does not change outcomes

- **No more full-day or multi-pass audits.** The big audit is DONE. Do not re-audit. Subsequent recon is per-module and one-pass.
- **No exhaustive recon when one pass suffices.** Read what you need to answer the design question, then design, then build.
- **No per-table PRs for the easy append-only tables.** The audit confirmed which append-only tables are clean: ops logs (inventory_submissions, labor_plans, labor_sold_revenue, deep_clean_days), Smart Inventory append logs (item_aliases, price_history, count_sessions, count_items, merge_history, zone_corrections), audit logs (service_audit_log_26, COLL__Performance_Audit_Log), AI line items, login_logs, wastenot_log. BATCH these together in a single PR (or two grouped PRs) rather than one per table.
- **No pausing for confirmation at every micro-step.** Pause at meaningful decision points and PR boundaries, not every sub-action. Move through routine steps; report at natural checkpoints (after recon completes, after design lands, after dry-run runs, at PR open, at PR merge call).

### Decision points that DO still warrant a pause

- Scope decisions (which tables in this PR; collapse vs separate; rename or preserve).
- Schema design choices (PK strategy, column type decisions, FK enforcement timing).
- Anything irreversible: cutover flag flips, live runs of write scripts, schema migrations, destructive git operations.
- When recon surfaces something that contradicts the audit's verdict or the design assumption. Surface the discrepancy, do not paper over it.

---

## The sequence

**Module-by-module for hard modules, batched for easy ones.** The audit's verdicts split the work cleanly:

### HARD modules - one PR each (or split as needed)

1. **news_interactions** (Stage 1 PR 1, SHIPPED). Cutover Wednesday 2026-05-27 (Kevin manual): set DUAL_WRITE_TABLES -> run backfill --execute -> set READ_FROM_POSTGRES. Proves the pattern.
2. **directory** (module 2, FULLY DESIGNED 2026-05-26). 4-table schema: accounts (with dir_links 4 cols folded in), contacts A-G (col-G bug fix during build, H/I/J stay in Sheet as reference), work_locations kept real, hero_images. 3 new dataStore primitives needed: delete, replace-list, multi-table coordinated write. Per-module read flags. Accounts col-T (Region) write-boundary preservation flagged. Builds after cutover proves the pattern.
3. **People Portal: submissions** (single-table state machine, ~5 CA sites). Lower-risk pattern-prover for the bigger state machine that follows.
4. **People Portal: incidents** (52-col state machine, 22+ CA sites, multi-writer with cron). The heavyweight; benefits from the submissions pattern being mature.
5. **People Portal: drafts + notification_log** (cleanup; smaller).
6. **Invoice config** (vendor_master + vendor_accounts).
7. **invoice_submissions_26** (finance-critical, finished pattern).

### EASY modules - BATCHED (append-only, audit-confirmed clean)

After news_interactions and directory cut over, the dual-write + backfill pattern is fully proven. The append-only tables can ship as batched PRs:

- **Batch A: Ops logs** - inventory_submissions, labor_plans, labor_sold_revenue, deep_clean_days.
- **Batch B: Smart Inventory append logs** - item_aliases, price_history, count_sessions, count_items, merge_history, zone_corrections. Account for the inventory AI cron as an external writer (the Railway repo `kitchfix-inventory-cron` writes some of these; the dual-write must include the cron's writes too or the PG mirror stays stale).
- **Batch C: Audit logs** - service_audit_log_26, COLL__Performance_Audit_Log, login_logs, wastenot_log.
- **Batch D: AI line items** - the 9 per-account tabs in AI_LINE_ITEMS, plus the "Invoice Uploads" fallback.

Each batch ships as a single PR with one dataStore extension covering N tables. The reason batching works here: the design is identical per table (APPEND only, no upsert, no state machine, no multi-table coupling). What's risky in hard modules (cell-addressing, deletes, replace-list, atomicity) doesn't exist in append-only land.

### Smart Inventory item_catalog - hard, separate

item_catalog is the highest-volume table (2,688 rows, 124 dead trailing columns to trim, many CA sites). Migrate as its own module after the append-only batches prove the AI-cron-as-external-writer pattern.

### Deferred (post-Stage-1 or out-of-scope)

- **service-calendar** (Projections / Actuals grids in per-account spreadsheets; half-built per dashboard). Defer until the module stabilizes.
- **performance / Leadership Dugout** (Cycle Review feature unshipped; tabs are schema-only). Defer until feature ships.
- **GL_CODES** (12 per-account read-only chart-of-accounts tabs). Likely stays Sheets-as-config, low migration value.
- **HUB orphan tabs** (employee_roster + content tabs + legacy vendors/gl_codes + the 5 fully-empty tabs). Per audit synthesis: do NOT migrate. Confirm intent during Friday checkpoint; either delete or keep as Sheets reference.

---

## Goal

Whole intranet on Supabase, clean foundation, as fast as is safe.

Friday is a progress checkpoint - not a deadline. By Friday we should have:
- news_interactions live on Postgres (Wednesday)
- directory built + cut over OR built + ready for cutover
- The hard-modules sequence underway with the pattern proven
- A read of the audit verdicts against any newly-surfaced realities, with the migration plan adjusted if anything changed

After Friday, the assessment is whether the pace is right. If yes, continue. If too aggressive or too cautious, recalibrate.

---

## What to do when this approach changes

Update this doc in place. The previous mode (capacity-not-speed, multi-pass audit) is captured in the original CLAUDE.md and the original MIGRATION.md / SUPABASE_MIGRATION.md headers. This doc is the current overlay; if the overlay changes, the new approach goes here with a dated header entry.

If the underlying strategic plan in `docs/SUPABASE_MIGRATION.md` changes substantively (different stages, different schema strategy, different cutover model), update THAT doc - this one only governs pace and operating mode within the existing plan.
