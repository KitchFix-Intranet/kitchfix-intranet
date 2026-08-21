# scripts/probes/

Audit-trail scripts. Each one was written to prove a single thing at a
single moment. They are evidence, not running code.

## Ground rules

- **Not maintained.** These scripts capture the state of the corpus +
  code at the moment they were written. A probe that was accurate on
  the day it was authored may fail today because the table it reads has
  a new column, a row shape has changed, or the code path it exercises
  has been rewritten. Do not treat them as executable specification.
- **Not the derive.** No probe is on any request path. Nothing in
  `src/` imports from this directory. Deleting the whole tree would
  not change behavior; the value is documentary.
- **Read-only by default.** Every probe here is expected to be
  `.select()`-only against Postgres. A small set intentionally exercise
  round-trip write paths (insert-then-delete verification, RPC
  invocations); those are called out in the write-path notes below.
- **Never commit credentials.** Every probe reads secrets via
  `process.env.*` - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  Rippling/BillCom keys, etc. If you write a new probe, follow the
  same pattern. `.env*` is off limits per the top-level rule.

## How they run

Most probes assume the standard `--env-file` incantation:

```
node --env-file=/absolute/path/to/.env.local \
  scripts/probes/<probe-name>.mjs
```

A few Python probes (`_probe_price_audit_join.py`,
`_probe_pricing_summit_pl_extract.py`) take their env from the shell.

## Probes that write (not read-only)

These probes execute Postgres writes as part of their verification.
Most follow an insert-then-delete round-trip pattern for post-migration
sanity checks; a couple call `.rpc()` against server-side functions.
None are safe to re-run blindly - inspect the code first.

- `_probe_amount_column_state.mjs` - insert-then-delete sanity check
  that PostgREST sees `ai_line_items.amount` (proves pr-9-1 applied).
- `_probe_inv1_ghost_tables.mjs` - `sb.rpc(fn, {})` - RPC probe
  driven by a variable function name; effect depends on which RPC.
- `_probe_inv1_live_schema.mjs` - `sb.rpc("exec_sql", { sql })` -
  arbitrary SQL executor (INV-1 recon).
- `_probe_labor_rpc_coverage.mjs` - `.rpc("labor_actuals_coverage")` /
  `.rpc("labor_actuals_rpc_coverage")`; server functions.
- `_probe_m3_no_projection.mjs` - deletes and restores a single
  `sc_daily_projections` row to prove the M-3 refusal path.
- `_probe_p3_131_verify.mjs` - seeds sentinel `review_queue` /
  `ai_line_items` rows, verifies undo, cleans up.
- `_probe_p3_batch1_verify.mjs` - same pattern for P3 batch 1.
- `_probe_p3_batch2_verify.mjs` - same pattern for P3 batch 2.
- `_probe_p3_batch3_verify.mjs` - same pattern for P3 batch 3.
- `_probe_pr_9_1_post_apply.mjs` - insert-then-delete round-trip
  post pr-9-1 apply.

Every other probe below is `.select()`-only. If a new probe adds a
write, add it to this list.

## Probe index

### G3 collision-audit family (`_g3_*`)

Investigation of the 68ed4977 category-name collision + the Ruling 4
follow-on question set from the purchasing engine build.

- `_g3_cat_display_value.mjs` - inspected raw JSON for cat 68ed4977 to find the category display_value.
- `_g3_cat_to_name_majority.mjs` - reproduced the applier's category-id -> majority-name join.
- `_g3_ext_id_formats.mjs` - sampled ten rows for cat 68ed4977 to characterise external_id shape.
- `_g3_investigate_68ed4977.mjs` - deep look at 68ed4977: dominant departments / work locations / merchants.
- `_g3_join_by_amt.mjs` - joined rippling_spend to CSV by amount for the pair investigation.
- `_g3_probe_catname_map.mjs` - replicated worksheet buildCategoryIdToName and printed the three no-name cats.
- `_g3_probe_equip_cat.mjs` - dumped IDs mapping to Equipment via re-run.
- `_g3_probe_unnamed_third.mjs` - identified the unnamed third collision category.
- `_g3_step1_date_split_68ed4977.mjs` - Step 1: per-DB-row date split of category_id 68ed4977.
- `_g3_step1_probe.mjs` - initial G3 orientation probe.
- `_g3_step1b_date_split.mjs` - filtered CSV rows on the two collision Category Names.
- `_g3_step2_dump_rulings.mjs` - dumped the 21 RULINGS keys.
- `_g3_step3_bucket_movement.mjs` - portfolio + TBR-FL bucket movement, non-excluded purchasing_actuals grouped into the spec 8-row shape.
- `_g3_step3_probe_db.mjs` - Step 3 db-side probe.
- `_g3_step3b_probe_more.mjs` - Step 3b: distinct account_keys.
- `_g3_step3c_probe_labels.mjs` - Step 3c: label enumeration.
- `_g3_step456_balance_unrouted_sentinel.mjs` - Steps 4/5/6: routed + unrouted + excluded balance vs total rippling_spend; unrouted top-5 by category_id.
- `_g3_step4_csv_categories.mjs` - Step 4: CSV category enumeration.
- `_g3_step4b_csv_deep.mjs` - Step 4b: CSV deep dive.
- `_g3_step5_join_txn.mjs` - Step 5: txn-level join.
- `_g3_step6_ids.mjs` - Step 6: id enumeration.
- `_g3_step7_build_catmap.mjs` - Step 7: build the cat map.
- `_g3_step7b_investigate.mjs` - Step 7b: purchasing_actuals totals by category via raw join.
- `_g3_step7c_actuals_join.mjs` - Step 7c: actuals join.
- `_g3_step8_actuals_by_cat.mjs` - Step 8: actuals by cat.
- `_g3_verify_dues_vs_pleaseselect.mjs` - Dues vs Please-Select verification.
- `_g3_verify_majority_join.mjs` - Majority-join verification.
- `_g3_verify_please_select.mjs` - Identified which category_id maps to "**Please Select A Category**".
- `_g3_verify_worksheet.mjs` - Worksheet reproduction check.
- `_g3_verify_worksheet_collision.mjs` - Worksheet collision reproduction.
- `_g3_which_ruling_missing.mjs` - Ad-hoc: which of the 21 RULINGS keys did not match any CSV/DB category name.

### G7 engine-determinism family (`_g7_*`)

Snapshot + lock probes for the purchasing engine determinism gate.

- `_g7_env_preflight.mjs` - reports PRESENT/ABSENT only for required env vars; never prints values.
- `_g7_lock_check.mjs` - lock-table pre-run check; expects empty.
- `_g7_snapshot.mjs` - computed the SHA-256 checksum of purchasing_actuals (sorted by `(source, source_line_id)`, paginated 1000/page) that the G7 Section A determinism gate used to prove three consecutive derives byte-identical.

### PR1B verify (`_pr1b_*`)

- `_pr1b_part_c_d_verify.mjs` - PR 1b Parts C + D: kpi_budgets coverage recon for TXR-TX-V.

### INV-P8b invariant / recon family (`_inv_*`)

Read-only recon + assert probes for the INV-P8b card-pipeline vs
Rippling report reconciliation.

- `_inv_p8b_asserts_probe.mjs` - in-memory unit test of the pre-write assert helpers; zero DB access.
- `_inv_p8b_dig.mjs` - dig #1: first_seen_at 2026-08 concentration + weekly distribution.
- `_inv_p8b_dig2.mjs` - dig #2: normalized_amount USD conversion + purchase_type distribution.
- `_inv_p8b_dig3.mjs` - dig #3: does walkSpendLines return all history vs the FYTD custom-report window.
- `_inv_p8b_dig4.mjs` - dig #4: characterise ours-only inside-window parents; sample raw payload.
- `_inv_p8b_recon.mjs` - primary INV-P8b recon: card pipeline vs unfiltered Rippling report; Postgres + CSV only, no API calls.

### Purchasing engine / KPI probes (`_probe_kpi_*`, `_probe_labor_*`, `_probe_v*`, `_probe_H*`)

Acceptance and calibration probes for the labor / KPI stack.

- `_probe_H1_derivation.mjs` - proves the H1 fix derives period_no client-side and groups correctly.
- `_probe_H1_periods.mjs` - H1 periods enumeration.
- `_probe_kpi_8a_verify.mjs` - KPI PR 8a verify.
- `_probe_kpi_8a2_verify.mjs` - KPI PR 8a-2 acceptance gate; read-only, Postgres-only.
- `_probe_kpi_budgets.mjs` - KPI-2 post-load probe reading expected values from the local corpus.
- `_probe_kpi_homestand.mjs` - Homestand PR-1 acceptance; in-process assertion.
- `_probe_kpi_portfolio.mjs` - V6 PR-1: portfolio + region aggregation gates.
- `_probe_kpi_role_gates.mjs` - V-role-gates acceptance: G1..G7 from spec §7.
- `_probe_kpi_salary_toggle.mjs` - Salary PR 3 · C4 acceptance probe.
- `_probe_kpi_signal_style.mjs` - V34 pixel probe against `/kpi/labor` (TEST_MODE).
- `_probe_kpi_spine.mjs` - KPI spine sanity probe.
- `_probe_kpi_v35.mjs` - V35 acceptance: hybrid synthetic-DOM injection into the real page.
- `_probe_kpi_v36_table.mjs` - V36 acceptance: CSS-only, synthetic-DOM.
- `_probe_kpi_v39_txrv.mjs` - V37/V39 acceptance for TXR-TX-V.
- `_probe_kpi_v40.mjs` - V40 acceptance: two salary math bugs, toggle clarity, cold-load.
- `_probe_labor_budget_acceptance.mjs` - M-1 labor-budget acceptance.
- `_probe_labor_plans.mjs` - one-off dump of labor_plans + homestand_schedule shape.
- `_probe_labor_rpc_coverage.mjs` - guard against the silent-truncation class PR-A hit (v42-1); WRITES.
- `_probe_salary_s1.mjs` - Salary PR 1 · C4: probes S1..S1g.
- `_probe_salary_s2.mjs` - Salary PR 2 · C3: probes S2..S7 + sentinel.
- `_probe_v25_aggregate_population.mjs` - V25-3 permanent probe: aggregate range vs member sum.
- `_probe_v32_prior_comparison.mjs` - V32-13/V32-15 verification vs Supabase.
- `_probe_v33_clipped.mjs` - V33 C1 acceptance: zero clipped .kpi-sig-fact-lab and .kpi-sig-fact-val.
- `_probe_v42_client.mjs` - V42 PR-B acceptance: live HTTP against `next dev` with TEST_MODE.
- `_probe_v42_dom.mjs` - V42 PR-B: rendered DOM assertion.
- `_probe_v42_render_volume.mjs` - V42 per-account render volume.
- `_probe_v42_sentinel.mjs` - V42 PR-A: proves migration + derive changed nothing structural.

### Service Calendar probes (`_probe_sc_*`, `_probe_m*`)

Read-only investigations for the SC redesign + migration arc.

- `_probe_after_state_projection.mjs` - projection of what the rederive will produce ONCE migration lands.
- `_probe_before_state.mjs` - baseline snapshot BEFORE the work-location-attribution migration.
- `_probe_m2_year_summary.mjs` - M-2 smoke: year-summary payload emits `homestands` for CIN-OH (pilot) but not for fence-class accounts.
- `_probe_m3_no_projection.mjs` - M-3 hardest-gate #2: prove the no-projection path refuses; WRITES (delete+restore).
- `_probe_m6_post_fix_state.mjs` - Module 6 post-visibility-fix state; new-invoice extraction lands in PG right now?
- `_probe_m6_today_uploads.mjs` - what did today's invoice uploads do; PR #138 divide.
- `_probe_pr_m_projections_variance.mjs` - SC projection calibration recon for PR-M TXR-AZ vs CIN-AZ.
- `_probe_sc_19_collision_check.mjs` - sc-19 migration planning; Part 4 DATE_DRIFT + AAA MISSING_IN_DB.
- `_probe_sc_actionable_by_month.mjs` - per (account, month) actionable-day census for Phase 3-B re-gate.
- `_probe_sc_archive_edge_ranges.mjs` - find (account, service, active_until) inside currently-selectable ranges for the P2B archive-edge guard.
- `_probe_sc_bug_b_riders.mjs` - Bug B PR riders (Kevin 2026-07-14): HOME game days on the 4 MLB fee accounts.
- `_probe_sc_daytype_metadata_three_way_diff.mjs` - Part 3 three-way diff: sc_homestand_schedule.day_type vs sc_day_metadata.game_type vs a third source.
- `_probe_sc_drift_slack_smoke.mjs` - one-shot post to SLACK_SC_WEBHOOK_URL to confirm the webhook before the nightly cron.
- `_probe_sc_ledger_all_zero_batches.mjs` - find existing all-zero same-timestamp batches in sc_daily_actuals_history for the Ledger mark-no-service collapse.
- `_probe_sc_load_txr_month_addendum.mjs` - Part 2 addendum: exact server-side sc-load path.
- `_probe_sc_part4_bidirectional_diff.mjs` - Part 4 Steps 2-4: bidirectional DB<->API diff on all 8 schedule-bearing accounts.
- `_probe_sc_part4_milb_name_resolve.mjs` - Part 4 Step 1: resolve AAA + FSL team IDs by NAME (Kevin ruling: no hardcoded sportIds).
- `_probe_sc_pattern_dates_targeted.mjs` - Kevin's exact "blank" pattern dates: dump every render field.
- `_probe_sc_r3_2_gate.mjs` - PROBE 1 for R3-2 gate ruling (2026-08-01).
- `_probe_sc_r3_2_trap.mjs` - PROBE 2 for R3-2 (2026-08-01); amended per owner ruling.
- `_probe_sc_r3_5_st_names.mjs` - PROBE A for R3-5: which accounts have services whose name ends in " - ST".
- `_probe_stl_mo_pattern.mjs` - STL-MO pattern investigation.

### Rippling spend + purchasing probes (`_probe_rippling_*`, `_probe_normalize_verify.mjs`, `_probe_derive_pay_segments_s1i.mjs`, `_probe_collision_cat_totals.mjs`)

- `_probe_collision_cat_totals.mjs` - reconcile cat_id 68ed4977: total FYTD vs non-excluded split by exclusion reason (Kevin ask 2026-08-21).
- `_probe_daily_grain.mjs` - PR-3a daily-grain acceptance for labor actuals.
- `_probe_daily_source_purity.mjs` - PR-3a daily-source branch exerciser.
- `_probe_derive_pay_segments_s1i.mjs` - S1i permanent probe for the 2026-08-19 rippling_id re-issue class.
- `_probe_normalize_verify.mjs` - local verify: pull raw JSONB from rippling_raw_spend_lines_latest and re-run the normalize step.
- `_probe_rippling_spend_attribution_axes.mjs` - Bug 3 deliverable: department.display_value + work_location distributions.
- `_probe_rippling_spend_extra_fields.mjs` - does spend_transaction carry any field beyond what walkSpendLines pulls.
- `_probe_rippling_spend_payload.mjs` - pre-fix probe: real rippling_raw_spend_lines_latest row inspection.
- `_probe_work_location_ids.mjs` - work_location_id + work_location_label pairs.

### AI extraction / invoice pipeline probes (`_probe_ai_*`, `_probe_arithmetic_*`, `_probe_extraction_*`, `_probe_shadow_*`, `_probe_review_queue_*`, `_probe_upload_compliance.mjs`)

Investigations of the invoice extraction pipeline, arithmetic-hold
class, catalog match, and Sheets/PG dual-write drift.

- `_probe_ai_li_dual_write_gap.mjs` - dual-write gap on ai_line_items.
- `_probe_ai_line_items_drift.mjs` - alarm ai_line_items drift (PG 7575 vs Sheets 2965); tests Module 6 backfill hypothesis.
- `_probe_ai_line_items_h3_redo.mjs` - H3 redo with correct UUID join through invoice_submissions.
- `_probe_aili_late_dates.mjs` - PG rows with created_at >= 2026-06-10.
- `_probe_ailineitems_sheets_vs_pg.mjs` - Sheets vs PG row-level ai_line_items diff.
- `_probe_amount_column_state.mjs` - ai_line_items.amount schema state; WRITES (insert+delete).
- `_probe_arithmetic_fail_dropdown_coverage.mjs` - arithmetic_fail rows with suggestedMatchId: do they carry catalog detail.
- `_probe_arithmetic_holds.mjs` - arithmetic_fail held rows + the math that put them there.
- `_probe_arithmetic_holds_breakdown.mjs` - arithmetic_fail breakdown by vendor / week / account.
- `_probe_bug1_a1_vs_a2_split.mjs` - Part 1: classify Bug 1 dup excess rows by A1 vs A2 upstream scenario.
- `_probe_bug2_cross_vendor_recon.mjs` - Bug 2: cross-vendor dup groups in current Sheets item_catalog.
- `_probe_bug2_find_real_lines.mjs` - real ai_line_items rows producing cross-vendor dups.
- `_probe_bug2_third_pepper.mjs` - item_dc50ec3d lookup (STL-MO third pepper).
- `_probe_catalog_detail_coverage.mjs` - catalog items carry the detail data the inline peek needs.
- `_probe_docx_chunking_readiness.mjs` - readiness for docx chunking.
- `_probe_dual_write_gap_full_history.mjs` - full-history dual-write gap.
- `_probe_dugout_sheet_sizes.mjs` - row counts per dugout Sheets tab.
- `_probe_dup_coverage_split.mjs` - classify Sheets item_catalog dup groups as Bug 1 vs Bug 2.
- `_probe_dup_line_inspection.mjs` - inspect two line-38 rows on fd004ff4 verbatim.
- `_probe_duplicate_invoices.mjs` - Block 3 cleanup: duplicate invoice submissions audit.
- `_probe_effective_date_coverage.mjs` - how often the effective_date-null bug fires.
- `_probe_enum_members.mjs` - enum-membership probe via PG's "invalid input value for enum" error.
- `_probe_extract_doc_set_1.mjs` - extraction across doc set 1.
- `_probe_extraction_baseline.mjs` - baseline: read existing raw_json for 15 held-out invoices.
- `_probe_extraction_rawjson.mjs` - ai_line_items.rawJson for arithmetic_fail holds.
- `_probe_extraction_samples.mjs` - Drive links for catch-weight invoices + WCW comparison.
- `_probe_extraction_timing.mjs` - Stage A raw_json field appearance timing.
- `_probe_failure_taxonomy.mjs` - arithmetic_fail taxonomy across top-N failing vendors.
- `_probe_gap_static_trace.mjs` - static trace of the 34 dual-write gap invoices.
- `_probe_inv1_ghost_tables.mjs` - INV-1 ghost-table check; WRITES (rpc).
- `_probe_inv1_live_schema.mjs` - INV-1 live schema recon; WRITES (rpc exec_sql).
- `_probe_inv1_live_schema_v2.mjs` - INV-1 recon v2 via PostgREST OpenAPI (read-only).
- `_probe_inv1_table_name_grep.mjs` - INV-1 table-name grep.
- `_probe_inventory_items_dup_recon.mjs` - PG.inventory_items dup groups pre-Module 7 cleanup.
- `_probe_inventory_tabs.mjs` - list tab names in INVENTORY spreadsheet.
- `_probe_invmgr_sheets_vs_pg.mjs` - inventory manager Sheets vs PG.
- `_probe_invoice_status.mjs` - invoice AI-scan status + line count for one submission.
- `_probe_is_historical_state.mjs` - is_historical=TRUE vs FALSE per table.
- `_probe_late_inv_pg_status.mjs` - late-invoice PG status.
- `_probe_mechanism_c_line_lookup.mjs` - mechanism C repro follow-up: Sheets ai_line_items lookup.
- `_probe_ocr_failure_characterization.mjs` - OCR/extraction failure rate at scale (last 30 days).
- `_probe_orphan_uuids_sheets.mjs` - orphan uuid in AI_LINE_ITEMS per-account tabs.
- `_probe_overcount_stl_mo_state.mjs` - 6 STL-MO invoices flagged overcount_suspect_reextract.
- `_probe_p3_131_verify.mjs` - Task #131: undoMatchPostgres + undoReconcilePostgres DELETE the row; WRITES (insert+delete).
- `_probe_p3_batch1_verify.mjs` - P3 batch 1 RQ PG mirror verification; WRITES.
- `_probe_p3_batch2_verify.mjs` - P3 batch 2 RQ PG mirror verification; WRITES.
- `_probe_p3_batch3_verify.mjs` - P3 batch 3 round-trip undo verification; WRITES.
- `_probe_p3_batch4_verify.mjs` - P3 batch 4 round-trip undo verification against Sheets.
- `_probe_parse_tracker.mjs` - parse-tracker inspection.
- `_probe_people.mjs` - People derive acceptance.
- `_probe_pg_failed_today.mjs` - ai_scan_error capture for today's pg_failed rows.
- `_probe_pg_schema_inventory.mjs` - live PG tables + row counts.
- `_probe_pg_unknown_count.mjs` - tables that returned null count.
- `_probe_phase2_recon.mjs` - Phase 2 recon.
- `_probe_pipeline_audit.mjs` - inventory/invoice pipeline audit.
- `_probe_post_fix_report.mjs` - post-fix verification numbers.
- `_probe_pr3b_live.mjs` - PR-3b live acceptance against real HTTP.
- `_probe_pr_8_1_state_check.mjs` - PR 8.1: probe/PROBE junk rows + real invoice landing.
- `_probe_pr_8_1_vendor_resolution.mjs` - PR 8.1 vendor resolution algorithm mirror.
- `_probe_pr_9_1_post_apply.mjs` - pr-9-1 post-apply column visibility + read/write; WRITES.
- `_probe_range_resolver.mjs` - PR-2 range resolver + budget pro-rate acceptance (pure functions).
- `_probe_rescan_candidates.mjs` - rescan-canary candidates: status=failed/null and PG=0 AND Sheets=0.
- `_probe_review_queue_cleanup_preview.mjs` - preview-only output for the review_queue cleanup (string log only).
- `_probe_review_queue_dedup_plan.mjs` - review_queue dedup recon + delete preview.
- `_probe_review_queue_respect_shadow.mjs` - PR A shadow-tally for review-queue-respect.
- `_probe_shadow_diagnostic.mjs` - shadow-mode diagnostic: weightLineValue populated in ai_line_items.
- `_probe_sheets_item_catalog_dup_growth.mjs` - Sheets item_catalog dup groups methodology parity vs PG.
- `_probe_silent_gap_complete_with_zero.mjs` - the 6 invoices flagged ai_scan_complete=TRUE but 0 ai_line_items.
- `_probe_silent_gaps.mjs` - silent-gap invoices class-wide.
- `_probe_stage_a_in_raw_json.mjs` - Stage A fields in raw_json on gap-invoice Sheets rows.
- `_probe_suspected_catchweight_coverage.mjs` - pending arithmetic_fail rows suspected catch-weight coverage.
- `_probe_unit_fragmentation.mjs` - distinct unit strings across inventory data + clustering.
- `_probe_upload_compliance.mjs` - upload-compliance recon.
- `_probe_vendor_coverage_gap.mjs` - vendor resolution coverage for top failing vendors.
- `_probe_vendor_volume.mjs` - vendor volume + line-item concentration census.

### Pricing summit + Redaction (`_probe_pricing_*`, `_probe_price_*`, `_probe_R3_*`)

- `_probe_R3_redact_export.mjs` - Push 3 · R3 artifact: prove the redacted export leaks zero worker names.
- `_probe_price_audit_join.py` - price audit join (Python).
- `_probe_pricing_summit_pg_dump.mjs` - dump sc_service_prices / sc_fee_schedule / sc_services as markdown for evidence docs.
- `_probe_pricing_summit_pg_effective_prices.mjs` - PG effective-dated per-service prices for 2026-07-01; mirrors the sc_daily_revenue LATERAL JOIN.
- `_probe_pricing_summit_pl_extract.py` - PL extract (Python).

### News (`_probe_news_*`)

- `_probe_news_image_urls.mjs` - dump postId + title + col M URL per news_posts row; `--fix` rewrites uc?export=view URLs.
